"""
Attendance Routes
=================
POST /attendance/session/open        — teacher opens session for a class assignment
POST /attendance/session/close/{id}  — teacher closes session
GET  /attendance/session/active      — student gets active sessions for their enrolled classes
GET  /attendance/session/active/{id} — teacher checks if assignment has active session
POST /attendance/mark                — student marks attendance (IP + face check)
GET  /attendance/report/{id}         — teacher gets report for an assignment
GET  /attendance/my                  — student gets their own attendance summary
POST /attendance/{id}/approve        — teacher approves a flagged attendance
POST /attendance/{id}/reject         — teacher rejects a flagged attendance
"""

import base64
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
        "department"        : assignment.department,
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


# ── Teacher: check active session for an assignment ────────────────────

@router.get("/session/active/{assignment_id}")
def get_active_session_for_assignment(
    assignment_id: int,
    teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    session = db.query(m.AttendanceSession).filter(
        and_(
            m.AttendanceSession.assignment_id == assignment_id,
            m.AttendanceSession.is_active     == True,
            m.AttendanceSession.expires_at    >  now,
        )
    ).first()
    if not session:
        return {"active": False}
    return {
        "active"    : True,
        "session_id": session.id,
        "expires_at": session.expires_at,
    }


# ── Student: get active sessions for enrolled classes ──────────────────

@router.get("/session/active")
def get_active_sessions(
    current_user=Depends(require_student),
    db: Session = Depends(get_db),
):
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")

    now = datetime.now(timezone.utc)

    enrollment_ids = [
        e.assignment_id for e in
        db.query(m.ClassEnrollment).filter(
            m.ClassEnrollment.student_id == student.id
        ).all()
    ]

    if not enrollment_ids:
        return []

    sessions = db.query(m.AttendanceSession).filter(
        and_(
            m.AttendanceSession.assignment_id.in_(enrollment_ids),
            m.AttendanceSession.is_active  == True,
            m.AttendanceSession.expires_at >  now,
        )
    ).all()

    result = []
    for s in sessions:
        already = db.query(m.Attendance).filter(
            and_(
                m.Attendance.session_id == s.id,
                m.Attendance.student_id == student.id,
            )
        ).first()

        result.append({
            "session_id"    : s.id,
            "assignment_id" : s.assignment_id,
            "subject_name"  : s.assignment.subject.name,
            "subject_code"  : s.assignment.subject.code,
            "department"    : s.assignment.department,
            "year"          : s.assignment.year,
            "semester"      : s.assignment.semester,
            "section"       : s.assignment.section,
            "teacher_name"  : s.teacher.user.full_name,
            "expires_at"    : s.expires_at,
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

    # Verify student is enrolled
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

    # Branch/year/semester match
    if (student_profile.department != session.assignment.department or
        student_profile.year       != session.assignment.year       or
        student_profile.semester   != session.assignment.semester):
        raise HTTPException(403, "Your class details do not match this session")

    # IP check
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

    # Face embedding record
    face_record = db.query(m.FaceEmbedding).filter(
        m.FaceEmbedding.student_id == student_profile.id
    ).first()
    if not face_record:
        raise HTTPException(500, "Face data missing — please re-register your face")

    # Read and store photo (always, regardless of match result)
    content   = await file.read()
    photo_b64 = base64.b64encode(content).decode()

    # Decode image for face processing
    bgr       = decode_image(content)
    bgr_clean = apply_portrait_blur(bgr)

    is_late = (now - session.started_at.replace(tzinfo=timezone.utc)).seconds > 300

    # ── Face detection ──────────────────────────────────────────────────
    try:
        live_embedding = extract_embedding(bgr_clean, strict=True)
    except ValueError as e:
        # Face not detected at all — flag immediately, still record
        record = m.Attendance(
            session_id     = session_id,
            student_id     = student_profile.id,
            status         = "flagged",
            confidence     = 0.0,
            student_ip     = student_ip,
            flagged        = True,
            flagged_reason = f"Face not detected: {e}",
            photo_data     = photo_b64,
            reviewed       = False,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        # Tell student only that it's pending — no error details
        return {
            "success"       : True,
            "status"        : "pending_review",
            "confidence"    : None,
            "flagged"       : True,
            "attendance_id" : record.id,
            "message"       : "Attendance recorded — pending verification",
        }

    # ── Face matching ───────────────────────────────────────────────────
    is_match, confidence = match_face(live_embedding, face_record.encrypted_data)

    # Flag if confidence below threshold OR not a match
    flagged        = (not is_match) or (confidence < CONFIDENCE_MIN)
    flagged_reason = None
    if flagged:
        if not is_match:
            flagged_reason = "Face mismatch — identity could not be confirmed"
        elif confidence < CONFIDENCE_MIN:
            flagged_reason = f"Low confidence match ({confidence:.0%}) — manual review required"

    status = "flagged" if flagged else ("late" if is_late else "present")

    record = m.Attendance(
        session_id     = session_id,
        student_id     = student_profile.id,
        status         = status,
        confidence     = round(confidence, 4),
        student_ip     = student_ip,
        flagged        = flagged,
        flagged_reason = flagged_reason,
        photo_data     = photo_b64,   # always store photo
        reviewed       = False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # Never expose confidence or flag reason to student
    return {
        "success"       : True,
        "status"        : "pending_review" if flagged else status,
        "confidence"    : None if flagged else round(confidence, 3),
        "flagged"       : flagged,
        "attendance_id" : record.id,
        "message"       : "Attendance recorded — pending verification" if flagged else
                          "Attendance marked" + (" (late)" if is_late else ""),
    }


# ── Teacher: approve a flagged attendance ─────────────────────────────

@router.post("/{attendance_id}/approve")
def approve_attendance(
    attendance_id: int,
    teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    teacher_profile = db.query(m.Teacher).filter(m.Teacher.user_id == teacher.id).first()

    att = db.query(m.Attendance).filter(m.Attendance.id == attendance_id).first()
    if not att:
        raise HTTPException(404, "Attendance record not found")

    # Verify the session belongs to this teacher
    if att.session.teacher_id != teacher_profile.id:
        raise HTTPException(403, "Not your session")

    att.flagged        = False
    att.reviewed       = True
    att.review_result  = "approved"
    att.status         = "present"
    db.commit()
    return {"ok": True, "status": "present"}


# ── Teacher: reject a flagged attendance ──────────────────────────────

@router.post("/{attendance_id}/reject")
def reject_attendance(
    attendance_id: int,
    teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    teacher_profile = db.query(m.Teacher).filter(m.Teacher.user_id == teacher.id).first()

    att = db.query(m.Attendance).filter(m.Attendance.id == attendance_id).first()
    if not att:
        raise HTTPException(404, "Attendance record not found")

    if att.session.teacher_id != teacher_profile.id:
        raise HTTPException(403, "Not your session")

    att.reviewed      = True
    att.review_result = "rejected"
    att.status        = "absent"
    db.commit()
    return {"ok": True, "status": "absent"}


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

    sessions       = db.query(m.AttendanceSession).filter(
        m.AttendanceSession.assignment_id == assignment_id
    ).all()
    total_sessions = len(sessions)
    session_ids    = [s.id for s in sessions]

    all_attendances = db.query(m.Attendance).filter(
        m.Attendance.session_id.in_(session_ids)
    ).all() if session_ids else []

    # Per-student summary
    counts: dict = defaultdict(lambda: {"present": 0, "late": 0, "flagged": 0, "absent": 0})
    for a in all_attendances:
        if a.status in ("present", "late"):
            counts[a.student_id][a.status] += 1
        if a.flagged and not a.reviewed:
            counts[a.student_id]["flagged"] += 1

    # Flagged records with photos — for the review panel
    flagged_records = []
    for a in all_attendances:
        if a.flagged and not a.reviewed:
            flagged_records.append({
                "attendance_id" : a.id,
                "student_id"    : a.student_id,
                "full_name"     : a.student.user.full_name,
                "roll_number"   : a.student.roll_number,
                "flagged_reason": a.flagged_reason,
                "confidence"    : a.confidence,
                "photo_url"     : f"data:image/jpeg;base64,{a.photo_data}" if a.photo_data else None,
                "marked_at"     : a.created_at if hasattr(a, "created_at") else None,
                "reviewed"      : a.reviewed,
                "review_result" : a.review_result if hasattr(a, "review_result") else None,
            })

    # All enrolled students
    enrollments = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.assignment_id == assignment_id
    ).all()

    report = []
    for e in enrollments:
        s   = e.student
        c   = counts.get(s.id, {"present": 0, "late": 0, "flagged": 0})
        att = c["present"] + c["late"]
        pct = round(att / total_sessions * 100, 1) if total_sessions > 0 else 0

        # Most recent attendance record for this student (for live view)
        latest = next(
            (a for a in sorted(all_attendances, key=lambda x: x.id, reverse=True)
             if a.student_id == s.id),
            None
        )

        report.append({
            "attendance_id"  : latest.id if latest else None,
            "student_id"     : s.id,
            "roll_number"    : s.roll_number,
            "full_name"      : s.user.full_name,
            "department"     : s.department,
            "year"           : s.year,
            "semester"       : s.semester,
            "present"        : c["present"],
            "late"           : c["late"],
            "absent"         : total_sessions - att,
            "attendance_pct" : pct,
            "flagged_count"  : c["flagged"],
            "flagged"        : latest.flagged if latest else False,
            "flagged_reason" : latest.flagged_reason if latest else None,
            "reviewed"       : latest.reviewed if latest else False,
            "review_result"  : getattr(latest, "review_result", None),
            "photo_url"      : f"data:image/jpeg;base64,{latest.photo_data}"
                               if latest and latest.photo_data else None,
            "marked_at"      : getattr(latest, "created_at", None),
            "status"         : latest.status if latest else "absent",
            "below_75"       : pct < 75,
        })

    return {
        "assignment_id"  : assignment_id,
        "subject"        : assignment.subject.name,
        "subject_code"   : assignment.subject.code,
        "department"     : assignment.department,
        "year"           : assignment.year,
        "semester"       : assignment.semester,
        "section"        : assignment.section,
        "total_sessions" : total_sessions,
        "total_enrolled" : len(enrollments),
        "flagged_records": flagged_records,   # separate list for review panel
        "report"         : sorted(report, key=lambda x: x["roll_number"]),
    }


# ── Student: my attendance summary ────────────────────────────────────

@router.get("/my")
def my_attendance(
    current_user=Depends(require_student),
    db: Session = Depends(get_db),
):
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")

    enrollments = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.student_id == student.id
    ).all()

    result = []
    for e in enrollments:
        a = e.assignment
        total = db.query(m.AttendanceSession).filter(
            m.AttendanceSession.assignment_id == a.id
        ).count()
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
            "department"   : a.department,
            "year"         : a.year,
            "semester"     : a.semester,
            "section"      : a.section,
            "total"        : total,
            "present"      : attended,
            "pct"          : pct,
            "below_75"     : pct < 75,
        })

    return {
        "student_name": student.user.full_name,
        "roll_number" : student.roll_number,
        "department"  : student.department,
        "year"        : student.year,
        "semester"    : student.semester,
        "classes"     : result,
    }