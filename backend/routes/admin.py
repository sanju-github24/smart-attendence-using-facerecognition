"""
Admin / Management Routes
=========================
These routes let admins (or teachers with admin access) manage:
  - Subjects (create/list)
  - Class Assignments (assign teacher to subject+class)
  - Enrollments (enroll/unenroll students)
  - View all branches, years, semesters, sections in the system
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct
from pydantic import BaseModel
from typing import Optional
from core.database import get_db
from core.auth import get_current_user, require_teacher
import models.user as m

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Schemas ────────────────────────────────────────────────────────────

class CreateSubjectRequest(BaseModel):
    name    : str
    code    : str
    department  : str
    semester: int
    year    : int


class CreateAssignmentRequest(BaseModel):
    teacher_id: int
    subject_id: int
    department    : str
    year      : int
    semester  : int
    section   : str = "A"


class EnrollStudentRequest(BaseModel):
    student_id   : int
    assignment_id: int


# ── Subjects ───────────────────────────────────────────────────────────

@router.post("/subjects", status_code=201)
def create_subject(data: CreateSubjectRequest, db: Session = Depends(get_db)):
    if db.query(m.Subject).filter(m.Subject.code == data.code).first():
        raise HTTPException(400, f"Subject code '{data.code}' already exists")

    subject = m.Subject(
        name    = data.name,
        code    = data.code,
        department = data.department,
        semester= data.semester,
        year    = data.year,
    )
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return {"id": subject.id, "name": subject.name, "code": subject.code}


@router.get("/subjects")
def list_subjects(
    branch  : Optional[str] = None,
    year    : Optional[int] = None,
    semester: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List all subjects, optionally filtered by branch/year/semester."""
    q = db.query(m.Subject)
    if branch:   q = q.filter(m.Subject.department   == branch)
    if year:     q = q.filter(m.Subject.year     == year)
    if semester: q = q.filter(m.Subject.semester == semester)
    return [
        {"id": s.id, "name": s.name, "code": s.code,
         "department": s.department, "year": s.year, "semester": s.semester}
        for s in q.all()
    ]


# ── Class Assignments ──────────────────────────────────────────────────

@router.post("/assignments", status_code=201)
def create_assignment(data: CreateAssignmentRequest, db: Session = Depends(get_db)):
    """Assign a teacher to teach a subject to a specific class."""
    teacher = db.query(m.Teacher).filter(m.Teacher.id == data.teacher_id).first()
    if not teacher:
        raise HTTPException(404, "Teacher not found")

    subject = db.query(m.Subject).filter(m.Subject.id == data.subject_id).first()
    if not subject:
        raise HTTPException(404, "Subject not found")

    # Check duplicate
    existing = db.query(m.ClassAssignment).filter(
        m.ClassAssignment.teacher_id == data.teacher_id,
        m.ClassAssignment.subject_id == data.subject_id,
        m.ClassAssignment.department     == data.department,
        m.ClassAssignment.year       == data.year,
        m.ClassAssignment.semester   == data.semester,
        m.ClassAssignment.section    == data.section,
    ).first()
    if existing:
        raise HTTPException(400, "This assignment already exists")

    assignment = m.ClassAssignment(
        teacher_id = data.teacher_id,
        subject_id = data.subject_id,
        department = data.department,
        year       = data.year,
        semester   = data.semester,
        section    = data.section,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    # Auto-enroll existing students matching branch+year+semester+section
    students = db.query(m.Student).filter(
        m.Student.department   == data.department,
        m.Student.year     == data.year,
        m.Student.semester == data.semester,
    ).all()

    enrolled = 0
    for student in students:
        already = db.query(m.ClassEnrollment).filter(
            m.ClassEnrollment.student_id    == student.id,
            m.ClassEnrollment.assignment_id == assignment.id,
        ).first()
        if not already:
            db.add(m.ClassEnrollment(student_id=student.id, assignment_id=assignment.id))
            enrolled += 1

    db.commit()

    return {
        "id"           : assignment.id,
        "subject"      : subject.name,
        "teacher"      : teacher.user.full_name,
        "department"       : data.department,
        "year"         : data.year,
        "semester"     : data.semester,
        "section"      : data.section,
        "auto_enrolled": enrolled,
    }


@router.get("/assignments")
def list_assignments(
    teacher_id: Optional[int] = None,
    branch    : Optional[str] = None,
    year      : Optional[int] = None,
    semester  : Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List all class assignments with optional filters."""
    q = db.query(m.ClassAssignment).join(m.Subject).join(m.Teacher)
    if teacher_id: q = q.filter(m.ClassAssignment.teacher_id == teacher_id)
    if branch:     q = q.filter(m.ClassAssignment.department     == branch)
    if year:       q = q.filter(m.ClassAssignment.year       == year)
    if semester:   q = q.filter(m.ClassAssignment.semester   == semester)

    return [
        {
            "id"          : a.id,
            "subject_name": a.subject.name,
            "subject_code": a.subject.code,
            "teacher_id"  : a.teacher_id,
            "teacher_name": a.teacher.user.full_name,
            "department"      : a.department,
            "year"        : a.year,
            "semester"    : a.semester,
            "section"     : a.section,
        }
        for a in q.all()
    ]


# ── Enrollments ────────────────────────────────────────────────────────

@router.post("/enrollments", status_code=201)
def enroll_student(data: EnrollStudentRequest, db: Session = Depends(get_db)):
    """Manually enroll a student in a class assignment."""
    student    = db.query(m.Student).filter(m.Student.id == data.student_id).first()
    assignment = db.query(m.ClassAssignment).filter(m.ClassAssignment.id == data.assignment_id).first()

    if not student:    raise HTTPException(404, "Student not found")
    if not assignment: raise HTTPException(404, "Class assignment not found")

    # Verify branch+year+semester match
    if (student.department   != assignment.department or
        student.year     != assignment.year   or
        student.semester != assignment.semester):
        raise HTTPException(400,
            f"Student is {student.department} Yr{student.year} Sem{student.semester} "
            f"but class is {assignment.department} Yr{assignment.year} Sem{assignment.semester}"
        )

    existing = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.student_id    == data.student_id,
        m.ClassEnrollment.assignment_id == data.assignment_id,
    ).first()
    if existing:
        raise HTTPException(400, "Student already enrolled")

    db.add(m.ClassEnrollment(student_id=data.student_id, assignment_id=data.assignment_id))
    db.commit()
    return {"message": f"Student {student.roll_number} enrolled in {assignment.subject.name}"}


@router.delete("/enrollments/{student_id}/{assignment_id}")
def unenroll_student(student_id: int, assignment_id: int, db: Session = Depends(get_db)):
    enrollment = db.query(m.ClassEnrollment).filter(
        m.ClassEnrollment.student_id    == student_id,
        m.ClassEnrollment.assignment_id == assignment_id,
    ).first()
    if not enrollment:
        raise HTTPException(404, "Enrollment not found")
    db.delete(enrollment)
    db.commit()
    return {"message": "Student unenrolled"}


# ── Discovery endpoints ────────────────────────────────────────────────

@router.get("/branches")
def list_branches(db: Session = Depends(get_db)):
    """All unique branches in the system."""
    rows = db.query(distinct(m.Student.department)).all()
    return sorted([r[0] for r in rows if r[0]])


@router.get("/structure")
def academic_structure(db: Session = Depends(get_db)):
    """
    Returns the full academic structure:
    branch → year → semester → sections with teacher assignments.
    Useful for admin dashboard overview.
    """
    assignments = db.query(m.ClassAssignment).join(m.Subject).join(m.Teacher).all()

    structure = {}
    for a in assignments:
        b = a.department
        y = str(a.year)
        s = str(a.semester)
        if b not in structure:
            structure[b] = {}
        if y not in structure[b]:
            structure[b][y] = {}
        if s not in structure[b][y]:
            structure[b][y][s] = []
        structure[b][y][s].append({
            "assignment_id": a.id,
            "subject"      : a.subject.name,
            "code"         : a.subject.code,
            "section"      : a.section,
            "teacher"      : a.teacher.user.full_name,
            "teacher_id"   : a.teacher_id,
        })
    return structure


@router.get("/teachers")
def list_teachers(db: Session = Depends(get_db)):
    """List all teachers — used when creating assignments."""
    teachers = db.query(m.Teacher).join(m.User).all()
    return [
        {
            "id"         : t.id,
            "full_name"  : t.user.full_name,
            "email"      : t.user.email,
            "employee_id": t.employee_id,
            "department" : t.department,
        }
        for t in teachers
    ]


@router.get("/students")
def list_students(
    branch  : Optional[str] = None,
    year    : Optional[int] = None,
    semester: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List students with optional filters."""
    q = db.query(m.Student).join(m.User)
    if branch:   q = q.filter(m.Student.department   == branch)
    if year:     q = q.filter(m.Student.year     == year)
    if semester: q = q.filter(m.Student.semester == semester)
    return [
        {
            "id"           : s.id,
            "roll_number"  : s.roll_number,
            "full_name"    : s.user.full_name,
            "department"       : s.department,
            "year"         : s.year,
            "semester"     : s.semester,
            "is_registered": s.is_registered,
        }
        for s in q.all()
    ]