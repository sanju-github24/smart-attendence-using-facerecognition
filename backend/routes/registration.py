"""
Face Registration Routes
========================
POST /registration/start        — begin session, get liveness challenge
POST /registration/submit-frames— upload 5 face frames, compute + store embedding
GET  /registration/status       — check if current student is registered
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import Annotated
from core.database import get_db
from core.auth import get_current_user, require_student
from services.face_service import (
    validate_registration_frames,
    average_embeddings,
    encrypt_embedding,
    apply_portrait_blur,
    decode_image,
)
import models.user as m
import cv2, base64

router = APIRouter(prefix="/registration", tags=["Face Registration"])


# ── Liveness challenge pool ────────────────────────────────────────────
# Frontend picks challenges from this and instructs the student.
CHALLENGES = [
    {"id": "blink",     "instruction": "Blink twice slowly"},
    {"id": "turn_left", "instruction": "Turn your head slightly to the left"},
    {"id": "turn_right","instruction": "Turn your head slightly to the right"},
    {"id": "nod",       "instruction": "Nod your head once"},
    {"id": "smile",     "instruction": "Give a natural smile"},
]


# ── Routes ─────────────────────────────────────────────────────────────

@router.get("/status")
def registration_status(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")
    return {
        "is_registered": student.is_registered,
        "registered_at": student.registered_at,
        "student_id"   : student.id,
    }


@router.get("/challenges")
def get_challenges():
    """Return the liveness challenges the frontend should display."""
    return {"challenges": CHALLENGES}


@router.post("/submit-frames")
async def submit_frames(
    # 5 face frame images sent as multipart files
    frame1: UploadFile = File(...),
    frame2: UploadFile = File(...),
    frame3: UploadFile = File(...),
    frame4: UploadFile = File(...),
    frame5: UploadFile = File(...),
    current_user=Depends(require_student),
    db: Session = Depends(get_db),
):
    """
    Receives 5 face frames captured during liveness challenges.
    - Validates each frame has exactly one detectable face
    - Averages the 5 ArcFace embeddings into one representative vector
    - AES-256-GCM encrypts the vector
    - Stores ciphertext in DB — raw embedding discarded immediately
    """
    student = db.query(m.Student).filter(m.Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(404, "Student profile not found")

    # Read all frames
    frames_bytes = []
    for frame in [frame1, frame2, frame3, frame4, frame5]:
        content = await frame.read()
        if len(content) > 5 * 1024 * 1024:   # 5 MB limit per frame
            raise HTTPException(400, f"Frame {frame.filename} exceeds 5 MB limit")
        frames_bytes.append(content)

    # Validate + extract embeddings (raises ValueError on bad frames)
    try:
        embeddings = validate_registration_frames(frames_bytes)
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Average → encrypt → store
    avg_embedding  = average_embeddings(embeddings)
    encrypted      = encrypt_embedding(avg_embedding)

    # Upsert FaceEmbedding record
    existing = db.query(m.FaceEmbedding).filter(
        m.FaceEmbedding.student_id == student.id
    ).first()

    if existing:
        existing.encrypted_data = encrypted
    else:
        db.add(m.FaceEmbedding(
            student_id    = student.id,
            encrypted_data= encrypted,
        ))

    # Mark student as registered
    student.is_registered = True
    student.registered_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "success": True,
        "message": "Face registered successfully. You can now mark attendance.",
        "frames_used": len(embeddings),
    }


@router.post("/preview-portrait")
async def preview_portrait(
    file: UploadFile = File(...),
    _=Depends(get_current_user),
):
    """
    Returns a portrait-blurred version of the uploaded frame.
    Used by the frontend to show the student what their camera feed looks like
    with background blur applied.
    """
    content = await file.read()
    bgr     = decode_image(content)
    blurred = apply_portrait_blur(bgr)

    # Encode result as JPEG and return as base64
    _, encoded = cv2.imencode(".jpg", blurred, [cv2.IMWRITE_JPEG_QUALITY, 88])
    b64 = base64.b64encode(encoded.tobytes()).decode()
    return {"image_b64": b64, "mime": "image/jpeg"}