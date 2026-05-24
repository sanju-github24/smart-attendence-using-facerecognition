"""
Face Service
============
Handles:
  1. Face embedding      — ArcFace 512-dim vector via InsightFace (ONNX, no TensorFlow)
  2. Embedding encryption — AES-256-GCM (nonce + tag + ciphertext, base64-encoded)
  3. Face matching       — cosine similarity against stored embedding
  4. Registration frame validation — needs ≥3/5 valid frames
"""

import cv2
import numpy as np
import base64
import json
from io import BytesIO
from PIL import Image
from typing import Optional
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from core.config import get_settings

settings = get_settings()

# ── Constants ──────────────────────────────────────────────────────────
MATCH_THRESHOLD = 0.68   # cosine similarity — above = same person
CONFIDENCE_MIN  = 0.50   # below this → flag for teacher review

# ── InsightFace app (lazy-loaded once) ────────────────────────────────
_app = None

def _get_app():
    global _app
    if _app is None:
        import insightface
        from insightface.app import FaceAnalysis
        _app = FaceAnalysis(
            name='buffalo_sc',          # lightweight ArcFace model (~100MB)
            providers=['CPUExecutionProvider'],
        )
        _app.prepare(ctx_id=-1, det_size=(640, 640))
    return _app


# ── Encryption helpers ─────────────────────────────────────────────────

def _get_key() -> bytes:
    """Decode the 32-byte hex key from settings."""
    return bytes.fromhex(settings.embedding_encryption_key)


def encrypt_embedding(embedding: list) -> str:
    """
    AES-256-GCM encrypt the embedding vector.
    Returns base64(nonce[16] + tag[16] + ciphertext).
    """
    key        = _get_key()
    nonce      = get_random_bytes(16)
    cipher     = AES.new(key, AES.MODE_GCM, nonce=nonce)
    data       = json.dumps(embedding).encode()
    ciphertext, tag = cipher.encrypt_and_digest(data)
    packed     = nonce + tag + ciphertext
    return base64.b64encode(packed).decode()


def decrypt_embedding(encrypted: str) -> list:
    """Reverse of encrypt_embedding — returns the original float list."""
    key    = _get_key()
    packed = base64.b64decode(encrypted.encode())
    nonce, tag, ciphertext = packed[:16], packed[16:32], packed[32:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    data   = cipher.decrypt_and_verify(ciphertext, tag)
    return json.loads(data.decode())


# ── Image helpers ──────────────────────────────────────────────────────

def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode uploaded bytes to a BGR numpy array."""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image — unsupported format or corrupt file")
    return img


def bgr_to_pil(bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


# ── Portrait blur (simple fallback without mediapipe) ──────────────────

def apply_portrait_blur(bgr: np.ndarray, blur_strength: int = 35) -> np.ndarray:
    """
    Simple face-region portrait effect without mediapipe.
    Detects face bounding box, blurs everything outside it.
    """
    try:
        app   = _get_app()
        faces = app.get(bgr)
        if not faces:
            return bgr

        # Build mask from face bounding box (expanded slightly)
        mask = np.zeros(bgr.shape[:2], dtype=np.float32)
        for face in faces:
            x1, y1, x2, y2 = [int(v) for v in face.bbox]
            pad = int((y2 - y1) * 0.3)
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(bgr.shape[1], x2 + pad)
            y2 = min(bgr.shape[0], y2 + pad)
            mask[y1:y2, x1:x2] = 1.0

        # Smooth mask edges
        mask     = cv2.GaussianBlur(mask, (51, 51), 0)
        mask_3ch = np.stack([mask] * 3, axis=-1)
        blurred  = cv2.GaussianBlur(bgr, (blur_strength | 1, blur_strength | 1), 0)
        output   = (bgr * mask_3ch + blurred * (1 - mask_3ch)).astype(np.uint8)
        return output

    except Exception:
        return bgr


# ── Face embedding ─────────────────────────────────────────────────────

def extract_embedding(bgr: np.ndarray, strict: bool = False) -> list:
    """
    Extract an ArcFace 512-dim embedding from an image using InsightFace.
    Raises ValueError if no face detected or multiple faces found.

    strict=True raises on low detection score (used for attendance matching).
    strict=False is more lenient (used for registration).
    """
    app   = _get_app()
    faces = app.get(bgr)

    if len(faces) == 0:
        raise ValueError("No face detected — ensure good lighting and face the camera directly")
    if len(faces) > 1:
        raise ValueError("Multiple faces detected — only one face per frame allowed")

    face = faces[0]

    # Detection confidence check
    det_score = float(face.det_score) if hasattr(face, 'det_score') else 1.0
    if strict and det_score < 0.6:
        raise ValueError(f"Face detection confidence too low ({det_score:.2f}) — please face the camera directly")

    if face.embedding is None:
        raise ValueError("Could not extract face embedding")

    embedding = face.embedding.tolist()   # 512-dim float list
    return embedding


def average_embeddings(embeddings: list) -> list:
    """Average multiple embeddings into one representative vector."""
    arr = np.array(embeddings, dtype=np.float32)
    avg = arr.mean(axis=0)
    # L2-normalise so cosine similarity works correctly
    norm = np.linalg.norm(avg)
    return (avg / norm).tolist() if norm > 0 else avg.tolist()


# ── Face matching ──────────────────────────────────────────────────────

def cosine_similarity(a: list, b: list) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-10))


def match_face(
    live_embedding: list,
    stored_encrypted: str,
) -> tuple:
    """
    Decrypt stored embedding and compare with live embedding.
    Returns (is_match, confidence_score).
    """
    stored = decrypt_embedding(stored_encrypted)
    score  = cosine_similarity(live_embedding, stored)
    return score >= MATCH_THRESHOLD, score


# ── Liveness helpers (server-side validation) ──────────────────────────

def check_face_present(bgr: np.ndarray) -> bool:
    """Quick check — is there exactly one face in the frame?"""
    try:
        app   = _get_app()
        faces = app.get(bgr)
        return len(faces) == 1
    except Exception:
        return False


def validate_registration_frames(frames_bytes: list) -> list:
    """
    Process up to 5 registration frames.
    - Skips frames where face detection fails (instead of hard-failing)
    - Needs at least 3 successful frames out of 5
    - Returns list of embeddings
    """
    embeddings = []
    errors     = []

    for i, frame_bytes in enumerate(frames_bytes):
        try:
            bgr = decode_image(frame_bytes)

            # Resize if too large — speeds up detection significantly
            h, w = bgr.shape[:2]
            if max(h, w) > 1280:
                scale = 1280 / max(h, w)
                bgr   = cv2.resize(bgr, (int(w * scale), int(h * scale)))

            emb = extract_embedding(bgr, strict=False)
            embeddings.append(emb)
            print(f"Frame {i + 1}: ✓ embedding extracted")

        except ValueError as e:
            errors.append(f"Frame {i + 1}: {e}")
            print(f"Frame {i + 1}: ✗ {e}")

    print(f"Registration: {len(embeddings)}/5 frames valid. Errors: {errors}")

    if len(embeddings) < 3:
        raise ValueError(
            f"Only {len(embeddings)}/5 frames had a detectable face. "
            f"Please ensure good lighting and face the camera directly. "
            f"Details: {'; '.join(errors)}"
        )

    return embeddings