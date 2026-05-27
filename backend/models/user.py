from sqlalchemy import (
    Column, Integer, String, Float, Boolean,
    DateTime, ForeignKey, Text, Enum, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base
import enum


class RoleEnum(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin   = "admin"


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String(255), unique=True, index=True, nullable=False)
    full_name     = Column(String(255), nullable=False)
    phone         = Column(String(20))
    password_hash = Column(String(255), nullable=False)
    role          = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.student)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    student_profile = relationship("Student", back_populates="user", uselist=False)
    teacher_profile = relationship("Teacher", back_populates="user", uselist=False)


class Student(Base):
    """
    A student belongs to one department, year, and semester.
    roll_number is unique per college.
    """
    __tablename__ = "students"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), unique=True)
    roll_number   = Column(String(50), unique=True, nullable=False)
    department     = Column(String(100), nullable=False)   # e.g. "Computer Science"
    year          = Column(Integer, nullable=False)        # 1-4
    semester      = Column(Integer, nullable=False)        # 1-8
    is_registered = Column(Boolean, default=False)         # face registered?
    registered_at = Column(DateTime(timezone=True))

    user           = relationship("User", back_populates="student_profile")
    face_embedding = relationship("FaceEmbedding", back_populates="student", uselist=False)
    attendances    = relationship("Attendance", back_populates="student")
    enrollments    = relationship("ClassEnrollment", back_populates="student")


class Teacher(Base):
    __tablename__ = "teachers"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), unique=True)
    department  = Column(String(100))
    employee_id = Column(String(50), unique=True)

    user         = relationship("User", back_populates="teacher_profile")
    assignments  = relationship("ClassAssignment", back_populates="teacher")
    sessions     = relationship("AttendanceSession", back_populates="teacher")


class Subject(Base):
    """
    A subject is a course (e.g. Data Structures, CS301).
    It belongs to a department + semester combination.
    Multiple teachers can teach the same subject to different classes.
    """
    __tablename__ = "subjects"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(200), nullable=False)
    code       = Column(String(50), unique=True, nullable=False)
    department  = Column(String(100), nullable=False)   # which department this subject belongs to
    semester   = Column(Integer, nullable=False)        # which semester (1-8)
    year       = Column(Integer, nullable=False)        # which year (1-4)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignments = relationship("ClassAssignment", back_populates="subject")


class ClassAssignment(Base):
    """
    Assigns a teacher to teach a subject to a specific class
    (branch + year + semester + section).
    One teacher can have many class assignments.
    Same subject can be assigned to different teachers for different sections.

    e.g. Dr. Kumar → Data Structures → CSE Branch → Year 2 → Sem 3 → Section A
         Dr. Rao   → Data Structures → CSE Branch → Year 2 → Sem 3 → Section B
    """
    __tablename__ = "class_assignments"
    __table_args__ = (
        UniqueConstraint('teacher_id', 'subject_id', 'department', 'year', 'semester', 'section',
                         name='uq_class_assignment'),
    )

    id         = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    department = Column(String(100), nullable=False)
    year       = Column(Integer, nullable=False)
    semester   = Column(Integer, nullable=False)
    section    = Column(String(10), default="A")        # A, B, C ...
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    teacher     = relationship("Teacher", back_populates="assignments")
    subject     = relationship("Subject", back_populates="assignments")
    enrollments = relationship("ClassEnrollment", back_populates="assignment")
    sessions    = relationship("AttendanceSession", back_populates="assignment")


class ClassEnrollment(Base):
    """
    A student is enrolled in a class assignment.
    Attendance sessions are only visible to enrolled students.
    """
    __tablename__ = "class_enrollments"
    __table_args__ = (
        UniqueConstraint('student_id', 'assignment_id', name='uq_enrollment'),
    )

    id            = Column(Integer, primary_key=True, index=True)
    student_id    = Column(Integer, ForeignKey("students.id"), nullable=False)
    assignment_id = Column(Integer, ForeignKey("class_assignments.id"), nullable=False)
    enrolled_at   = Column(DateTime(timezone=True), server_default=func.now())

    student    = relationship("Student", back_populates="enrollments")
    assignment = relationship("ClassAssignment", back_populates="enrollments")


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id             = Column(Integer, primary_key=True, index=True)
    student_id     = Column(Integer, ForeignKey("students.id"), unique=True)
    encrypted_data = Column(Text, nullable=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), onupdate=func.now())

    student = relationship("Student", back_populates="face_embedding")


class AttendanceSession(Base):
    """
    A teacher opens a session for a specific class assignment.
    Only enrolled students in that assignment can mark attendance.
    Teacher's IP is locked at session open.
    """
    __tablename__ = "attendance_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("class_assignments.id"), nullable=False)
    teacher_id    = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    teacher_ip    = Column(String(50), nullable=False)
    started_at    = Column(DateTime(timezone=True), server_default=func.now())
    expires_at    = Column(DateTime(timezone=True), nullable=False)
    is_active     = Column(Boolean, default=True)

    assignment  = relationship("ClassAssignment", back_populates="sessions")
    teacher     = relationship("Teacher", back_populates="sessions")
    attendances = relationship("Attendance", back_populates="session")


class Attendance(Base):
    __tablename__ = "attendances"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    status     = Column(String(20), default="present")  # present | late
    confidence = Column(Float)
    student_ip = Column(String(50))
    marked_at  = Column(DateTime(timezone=True), server_default=func.now())
    flagged    = Column(Boolean, default=False)
    
    # ─── ADDED COLUMNS FOR BIOMETRICS & MANUAL REVIEW ──────────────────
    flagged_reason = Column(String(255), nullable=True)
    photo_data     = Column(Text, nullable=True)
    review_result  = Column(String(50), nullable=True)
    reviewed       = Column(Boolean, default=False)  # <-- ADD THIS LINE
    # ──────────────────────────────────────────────────────────────────

    session = relationship("AttendanceSession", back_populates="attendances")
    student = relationship("Student", back_populates="attendances")