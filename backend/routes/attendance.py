"""
Attendance Routes
=================
POST /attendance/session/open        — teacher opens session for a class assignment
POST /attendance/session/close/{id}  — teacher closes session
GET  /attendance/session/active      — student gets active sessions for their enrolled classes
POST /attendance/mark                — student marks attendance (IP + face check)
GET  /attendance/report/{id}         — teacher gets report for an assignment
GET  /attendance/my                  — student gets their own attendance summary
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from collections import defaultdict
from core.database import get_db
from core.auth import get_current_user, require_teacher, require_student
from services.face_service import (
    decode_image, apply_portrait_blur,
    extract_embedding, match_face, CONFIDENCE_MIN,
)
from services.ip_service import get_client_ip, verify_student_ip
import models.user as m

router = APIRouter(prefix="/attendance", tags=["Attendance"])


class OpenSessionRequest(BaseModel):
    assignment_id   : int
    duration_minutes: int = 15


# ── Teacher: open session ──────────────────────────────────────────────

@router.post("/session/open")
def open_session(
    data   : OpenSessionRequest,
    request: Request,
    teacher=Depends(require_teacher),
    db     : Session = Depends(get_db),
):
    teacher_profile = db.query(m.Teacher).filter(m.Teacher.user_id == teacher.id).first()
    if not teacher_profile:
        raise HTTPException(404, "Teacher profile not found")

    # Verify this assignment belongs to this teacher
    assignment = db.query(m.ClassAssignment).filter(
        and_(
            m.ClassAssignment.id         == data.assignment_id,
            m.ClassAssignment.teacher_id == teacher_profile.id,
        )
    ).first()
    if not assignment:
        raise HTTPException(404, "Class assignment not found or not assigned to you")

    # Close any existing active session for this assignment
    db.query(m.AttendanceSession).filter(
        and_(
            m.AttendanceSession.assignment_id == data.assignment_id,
            m.AttendanceSession.is_active     == True,
        )
    ).update({"is_active": False})

    teacher_ip = get_client_ip(request)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=data.duration_minutes)

    session = m.AttendanceSession(
        assignment_id = data.assignment_id,
        teacher_id    = teacher_profile.id,
        teacher_ip    = teacher_ip,
        expires_at    = expires_at,
        is_active     = True,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return {
        "session_id"        : session.id,
        "subject"           : assignment.subject.name,
        "department"            : assignment.department,
        "year"              : assignment.year,
        "semester"          : assignment.semester,
        "section"           : assignment.section,
        "teacher_ip_locked" : teacher_ip,
        "expires_at"        : expires_at,
        "duration_minutes"  : data.duration_minutes,
    }


# ── Teacher: close session ─────────────────────────────────────────────

@router.post("/session/close/{session_id}")
def close_session(
    session_id: int,
    teacher    =Depends(require_teacher),
    db         : Session = Depends(get_db),
):
    teacher_profile = db.query(m.Teacher).filter(m.Teacher.user_id == teacher.id).first()
    session = db.query(m.AttendanceSession).filter(
        and_(
            m.AttendanceSession.id         == session_id,
            m.AttendanceSession.teacher_id == teacher_profile.id,
        )
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    session.is_active = False
    db.commit()
    return {"message": "Session closed"}


# ── Student: get active sessions for enrolled classes ──────────────────

@router.get("/session/active")
def get_active_sessions(
    current_user=Depends(require_student),
    db: Session = Depends(get_db),
):
    """
    Returns all currently active sessions for classes the student is enrolled in.
    Filters strictly by the student's branch + year + semester.
    """
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")

    now = datetime.now(timezone.utc)

    # Get all assignment IDs the student is enrolled in
    enrollment_ids = [
        e.assignment_id for e in
        db.query(m.ClassEnrollment).filter(
            m.ClassEnrollment.student_id == student.id
        ).all()
    ]

    if not enrollment_ids:
        return []

    # Get active sessions for those assignments
    sessions = db.query(m.AttendanceSession).filter(
        and_(
            m.AttendanceSession.assignment_id.in_(enrollment_ids),
            m.AttendanceSession.is_active  == True,
            m.AttendanceSession.expires_at >  now,
        )
    ).all()

    # Check which ones are already marked by this student
    result = []
    for s in sessions:
        already = db.query(m.Attendance).filter(
            and_(
                m.Attendance.session_id == s.id,
                m.Attendance.student_id == student.id,
            )
        ).first()

        result.append({
            "session_id"   : s.id,
            "assignment_id": s.assignment_id,
            "subject_name" : s.assignment.subject.name,
            "subject_code" : s.assignment.subject.code,
            "department"       : s.assignment.department,
            "year"         : s.assignment.year,
            "semester"     : s.assignment.semester,
            "section"      : s.assignment.section,
            "teacher_name" : s.teacher.user.full_name,
            "expires_at"   : s.expires_at,
            "already_marked": already is not None,
        })

    return result


# ── Student: mark attendance ───────────────────────────────────────────

@router.post("/mark")
async def mark_attendance(
    request   : Request,
    session_id: int        = Form(...),
    file      : UploadFile = File(...),
    student   =Depends(require_student),
    db        : Session = Depends(get_db),
):
    student_profile = db.query(m.Student).filter(m.Student.user_id == student.id).first()
    if not student_profile:
        raise HTTPException(404, "Student profile not found")
    if not student_profile.is_registered:
        raise HTTPException(403, "Register your face first before marking attendance")

    now     = datetime.now(timezone.utc)
    session = db.query(m.AttendanceSession).filter(
        m.AttendanceSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(404, "Session not found")
    if not session.is_active:
        raise HTTPException(403, "This session has been closed")
    if session.expires_at.replace(tzinfo=timezone.utc) < now:
        raise HTTPException(403, "Attendance window has expired")

    # Verify student is enrolled in this class
    enrollment = db.query(m.ClassEnrollment).filter(
        and_(
            m.ClassEnrollment.student_id    == student_profile.id,
            m.ClassEnrollment.assignment_id == session.assignment_id,
        )
    ).first()
    if not enrollment:
        raise HTTPException(403,
            f"You are not enrolled in this class "
            f"({session.assignment.department} Yr{session.assignment.year} "
            f"Sem{session.assignment.semester})"
        )

    # Branch + year + semester match check
    if (student_profile.department   != session.assignment.department or
        student_profile.year     != session.assignment.year   or
        student_profile.semester != session.assignment.semester):
        raise HTTPException(403,
            f"Your class ({student_profile.department} Yr{student_profile.year} "
            f"Sem{student_profile.semester}) does not match this session "
            f"({session.assignment.department} Yr{session.assignment.year} "
            f"Sem{session.assignment.semester})"
        )

    # IP verification
    student_ip = get_client_ip(request)
    verify_student_ip(student_ip, session.teacher_ip)

    # Duplicate check
    already = db.query(m.Attendance).filter(
        and_(
            m.Attendance.session_id == session_id,
            m.Attendance.student_id == student_profile.id,
        )
    ).first()
    if already:
        raise HTTPException(409, "You have already marked attendance for this session")

    # Load encrypted embedding
    face_record = db.query(m.FaceEmbedding).filter(
        m.FaceEmbedding.student_id == student_profile.id
    ).first()
    if not face_record:
        raise HTTPException(500, "Face data missing — please re-register your face")

    # Decode image + portrait blur
    content = await file.read()
    bgr     = decode_image(content)
    bgr_clean = apply_portrait_blur(bgr)

    # Extract + match face
    try:
        live_embedding = extract_embedding(bgr_clean)
    except ValueError as e:
        raise HTTPException(422, f"Face detection failed: {e}")

    is_match, confidence = match_face(live_embedding, face_record.encrypted_data)

    is_late = (now - session.started_at.replace(tzinfo=timezone.utc)).seconds > 300
    status  = "late" if is_late else "present"
    flagged = confidence < CONFIDENCE_MIN

    if not is_match:
        raise HTTPException(403,
            f"Face not recognised (confidence: {confidence:.0%}). "
            "Ensure good lighting and look directly at the camera."
        )

    record = m.Attendance(
        session_id = session_id,
        student_id = student_profile.id,
        status     = status,
        confidence = confidence,
        student_ip = student_ip,
        flagged    = flagged,
    )
    db.add(record)
    db.commit()

    return {
        "success"   : True,
        "status"    : status,
        "confidence": round(confidence, 3),
        "flagged"   : flagged,
        "message"   : "Attendance marked" + (" (late)" if is_late else ""),
    }


# ── Teacher: attendance report for an assignment ───────────────────────

@router.get("/report/{assignment_id}")
def attendance_report(
    assignment_id: int,
    teacher      =Depends(require_teacher),
    db           : Session = Depends(get_db),
):
    teacher_profile = db.query(m.Teacher).filter(m.Teacher.user_id == teacher.id).first()

    assignment = db.query(m.ClassAssignment).filter(
        and_(
            m.ClassAssignment.id         == assignment_id,
            m.ClassAssignment.teacher_id == teacher_profile.id,
        )
    ).first()
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    sessions     = db.query(m.AttendanceSession).filter(
        m.AttendanceSession.assignment_id == assignment_id
    ).all()
    total_sessions = len(sessions)
    session_ids    = [s.id for s in sessions]

    attendances = db.query(m.Attendance).filter(
        m.Attendance.session_id.in_(session_ids)
    ).all() if session_ids else []

    # Per-student summary
    counts: dict[int, dict] = defaultdict(lambda: {"present": 0, "late": 0, "flagged": 0})
    for a in attendances:
        counts[a.student_id][a.status] = counts[a.student_id].get(a.status, 0) + 1
        if a.flagged:
            counts[a.student_id]["flagged"] += 1

    # All enrolled students (even those with 0 attendance)
    enrollments = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.assignment_id == assignment_id
    ).all()

    report = []
    for e in enrollments:
        s   = e.student
        c   = counts.get(s.id, {"present": 0, "late": 0, "flagged": 0})
        att = c["present"] + c["late"]
        pct = round(att / total_sessions * 100, 1) if total_sessions > 0 else 0
        report.append({
            "student_id"    : s.id,
            "roll_number"   : s.roll_number,
            "full_name"     : s.user.full_name,
            "department"        : s.department,
            "year"          : s.year,
            "semester"      : s.semester,
            "present"       : c["present"],
            "late"          : c["late"],
            "absent"        : total_sessions - att,
            "attendance_pct": pct,
            "flagged_count" : c["flagged"],
            "below_75"      : pct < 75,
        })

    return {
        "assignment_id" : assignment_id,
        "subject"       : assignment.subject.name,
        "subject_code"  : assignment.subject.code,
        "department"        : assignment.department,
        "year"          : assignment.year,
        "semester"      : assignment.semester,
        "section"       : assignment.section,
        "total_sessions": total_sessions,
        "total_enrolled": len(enrollments),
        "report"        : sorted(report, key=lambda x: x["roll_number"]),
    }


# ── Student: my attendance summary ────────────────────────────────────

@router.get("/my")
def my_attendance(
    current_user=Depends(require_student),
    db: Session = Depends(get_db),
):
    """Returns attendance % per enrolled class for the logged-in student."""
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")

    enrollments = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.student_id == student.id
    ).all()

    result = []
    for e in enrollments:
        a = e.assignment
        # Total sessions for this assignment
        total = db.query(m.AttendanceSession).filter(
            m.AttendanceSession.assignment_id == a.id
        ).count()
        # Student's attended sessions
        attended = db.query(m.Attendance).join(m.AttendanceSession).filter(
            and_(
                m.AttendanceSession.assignment_id == a.id,
                m.Attendance.student_id           == student.id,
                m.Attendance.status.in_(["present", "late"]),
            )
        ).count()

        pct = round(attended / total * 100, 1) if total > 0 else 0
        result.append({
            "assignment_id": a.id,
            "subject_name" : a.subject.name,
            "subject_code" : a.subject.code,
            "teacher_name" : a.teacher.user.full_name,
            "department"       : a.department,
            "year"         : a.year,
            "semester"     : a.semester,
            "section"      : a.section,
            "total"        : total,
            "attended"     : attended,
            "pct"          : pct,
            "below_75"     : pct < 75,
        })

    return {
        "student_name": student.user.full_name,
        "roll_number" : student.roll_number,
        "department"      : student.department,
        "year"        : student.year,
        "semester"    : student.semester,
        "classes"     : result,
    }