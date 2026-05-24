from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import timedelta
from typing import Optional
from core.database import get_db
from core.auth import (
    hash_password, verify_password, create_access_token,
    get_settings, get_current_user, require_teacher, require_student
)
import models.user as m

router   = APIRouter(prefix="/auth", tags=["Auth"])
settings = get_settings()


# ── Schemas ────────────────────────────────────────────────────────────

class RegisterStudentRequest(BaseModel):
    email      : EmailStr
    full_name  : str
    phone      : str
    password   : str
    roll_number: str
    department : str        # e.g. "Computer Science"
    year       : int        # 1-4
    semester   : int        # 1-8


class RegisterTeacherRequest(BaseModel):
    email      : EmailStr
    full_name  : str
    phone      : str
    password   : str
    employee_id: str
    department : str


class RegisterAdminRequest(BaseModel):
    email      : EmailStr
    full_name  : str
    password   : str
    secret_key : str        # protects the endpoint


class TokenResponse(BaseModel):
    access_token: str
    token_type  : str = "bearer"
    role        : str
    full_name   : str
    user_id     : int


# ── Student Registration ───────────────────────────────────────────────

@router.post("/register/student", status_code=201)
def register_student(data: RegisterStudentRequest, db: Session = Depends(get_db)):
    if db.query(m.User).filter(m.User.email == data.email).first():
        raise HTTPException(400, "Email already registered")
    if db.query(m.Student).filter(m.Student.roll_number == data.roll_number).first():
        raise HTTPException(400, "Roll number already registered")
    if data.year < 1 or data.year > 4:
        raise HTTPException(400, "Year must be between 1 and 4")
    if data.semester < 1 or data.semester > 8:
        raise HTTPException(400, "Semester must be between 1 and 8")

    user = m.User(
        email         = data.email,
        full_name     = data.full_name,
        phone         = data.phone,
        password_hash = hash_password(data.password),
        role          = m.RoleEnum.student,
    )
    db.add(user)
    db.flush()

    student = m.Student(
        user_id     = user.id,
        roll_number = data.roll_number,
        department  = data.department,
        year        = data.year,
        semester    = data.semester,
    )
    db.add(student)

    # Auto-enroll student in all class assignments matching their
    # department + year + semester
    assignments = db.query(m.ClassAssignment).filter(
        m.ClassAssignment.department == data.department,
        m.ClassAssignment.year       == data.year,
        m.ClassAssignment.semester   == data.semester,
    ).all()

    db.flush()  # get student.id

    for asgn in assignments:
        enrollment = m.ClassEnrollment(
            student_id    = student.id,
            assignment_id = asgn.id,
        )
        db.add(enrollment)

    db.commit()

    return {
        "message"    : f"Student registered and auto-enrolled in {len(assignments)} class(es).",
        "user_id"    : user.id,
        "enrolled_in": len(assignments),
    }


# ── Teacher Registration ───────────────────────────────────────────────

@router.post("/register/teacher", status_code=201)
def register_teacher(data: RegisterTeacherRequest, db: Session = Depends(get_db)):
    if db.query(m.User).filter(m.User.email == data.email).first():
        raise HTTPException(400, "Email already registered")
    if db.query(m.Teacher).filter(m.Teacher.employee_id == data.employee_id).first():
        raise HTTPException(400, "Employee ID already registered")

    user = m.User(
        email         = data.email,
        full_name     = data.full_name,
        phone         = data.phone,
        password_hash = hash_password(data.password),
        role          = m.RoleEnum.teacher,
    )
    db.add(user)
    db.flush()

    teacher = m.Teacher(
        user_id     = user.id,
        department  = data.department,
        employee_id = data.employee_id,
    )
    db.add(teacher)
    db.commit()

    return {"message": "Teacher registered successfully.", "user_id": user.id}


# ── Admin Registration ─────────────────────────────────────────────────

ADMIN_SECRET = "smartattend_admin_2024"   # change this to something private

@router.post("/register/admin", status_code=201)
def register_admin(data: RegisterAdminRequest, db: Session = Depends(get_db)):
    if data.secret_key != ADMIN_SECRET:
        raise HTTPException(403, "Invalid admin secret key")
    if db.query(m.User).filter(m.User.email == data.email).first():
        raise HTTPException(400, "Email already registered")

    user = m.User(
        email         = data.email,
        full_name     = data.full_name,
        phone         = "",
        password_hash = hash_password(data.password),
        role          = m.RoleEnum.admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"message": "Admin registered successfully.", "user_id": user.id}


# ── Login ──────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Allow login via email OR roll number (for students)
    user = db.query(m.User).filter(m.User.email == form.username).first()

    if not user:
        # Try roll number lookup
        student = db.query(m.Student).filter(
            m.Student.roll_number == form.username
        ).first()
        if student:
            user = student.user

    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/roll number or password",
        )
    if not user.is_active:
        raise HTTPException(400, "Account deactivated — contact admin")

    role_str = user.role.value if hasattr(user.role, "value") else str(user.role)

    token = create_access_token(
        data={"sub": str(user.id), "role": role_str},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    return TokenResponse(
        access_token = token,
        role         = role_str,
        full_name    = user.full_name,
        user_id      = user.id,
    )


# ── /me ────────────────────────────────────────────────────────────────

@router.get("/me")
def get_me(current_user: m.User = Depends(get_current_user)):
    role_str = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    return {
        "id"       : current_user.id,
        "email"    : current_user.email,
        "role"     : role_str,
        "full_name": current_user.full_name,
    }


# ── Teacher's class assignments ────────────────────────────────────────

@router.get("/subjects/my")
def my_subjects(current_user=Depends(require_teacher), db: Session = Depends(get_db)):
    """
    Returns all class assignments for the logged-in teacher.
    Each entry = one class they teach (subject + department + year + sem + section).
    """
    teacher = db.query(m.Teacher).filter(m.Teacher.user_id == current_user.id).first()
    if not teacher:
        return []

    assignments = (
        db.query(m.ClassAssignment)
        .filter(m.ClassAssignment.teacher_id == teacher.id)
        .join(m.Subject)
        .all()
    )

    return [
        {
            "assignment_id": a.id,
            "subject_id"  : a.subject_id,
            "name"        : a.subject.name,
            "code"        : a.subject.code,
            "department"  : a.department,
            "year"        : a.year,
            "semester"    : a.semester,
            "section"     : a.section,
            "label"       : f"{a.subject.name} — {a.department} Yr{a.year} Sem{a.semester} Sec-{a.section}",
        }
        for a in assignments
    ]


# ── Student's enrolled classes ─────────────────────────────────────────

@router.get("/my-classes")
def my_classes(current_user=Depends(require_student), db: Session = Depends(get_db)):
    """
    Returns all class assignments a student is enrolled in,
    with teacher name and subject details.
    """
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        return []

    enrollments = (
        db.query(m.ClassEnrollment)
        .filter(m.ClassEnrollment.student_id == student.id)
        .join(m.ClassAssignment)
        .join(m.Subject, m.ClassAssignment.subject_id == m.Subject.id)
        .all()
    )

    return [
        {
            "enrollment_id": e.id,
            "assignment_id": e.assignment_id,
            "subject_name" : e.assignment.subject.name,
            "subject_code" : e.assignment.subject.code,
            "department"   : e.assignment.department,
            "year"         : e.assignment.year,
            "semester"     : e.assignment.semester,
            "section"      : e.assignment.section,
            "teacher_name" : e.assignment.teacher.user.full_name,
        }
        for e in enrollments
    ]