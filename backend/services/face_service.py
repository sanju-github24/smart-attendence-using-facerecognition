"""
Face Service
============
Handles:
  1. Liveness detection  — blink + head-turn challenge via MediaPipe
  2. Face embedding      — ArcFace 512-dim vector via DeepFace
  3. Embedding encryption — AES-256-GCM (nonce + tag + ciphertext, base64-encoded)
  4. Face matching       — cosine similarity against stored embedding
  5. Portrait blur       — MediaPipe selfie segmentation for clean face isolation
"""

import cv2
import numpy as np
import base64
import json
from io import BytesIO
from PIL import Image
from typing import Optional
from deepface import DeepFace
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from core.config import get_settings

settings = get_settings()

# ── Constants ──────────────────────────────────────────────────────────
MATCH_THRESHOLD    = 0.68   # cosine similarity — above = same person
CONFIDENCE_MIN     = 0.50   # below this → flag for teacher review
MODEL_NAME         = "ArcFace"

# opencv is most lenient — good for registration
# retinaface is more accurate but strict — use for attendance matching
DETECTOR_BACKEND        = "opencv"
DETECTOR_BACKEND_STRICT = "retinaface"


# ── Encryption helpers ─────────────────────────────────────────────────

def _get_key() -> bytes:
    """Decode the 32-byte hex key from settings."""
    return bytes.fromhex(settings.embedding_encryption_key)


def encrypt_embedding(embedding: list[float]) -> str:
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


def decrypt_embedding(encrypted: str) -> list[float]:
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


# ── Portrait blur ──────────────────────────────────────────────────────

def apply_portrait_blur(bgr: np.ndarray, blur_strength: int = 35) -> np.ndarray:
    """
    Use MediaPipe selfie segmentation to blur the background while
    keeping the face/person sharp — like a portrait photo.
    """
    try:
        import mediapipe as mp
        mp_seg = mp.solutions.selfie_segmentation

        with mp_seg.SelfieSegmentation(model_selection=1) as seg:
            rgb    = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            result = seg.process(rgb)
            mask   = result.segmentation_mask   # float32, 0-1

        # Smooth mask edges
        mask_3ch = np.stack([mask] * 3, axis=-1)
        blurred  = cv2.GaussianBlur(bgr, (blur_strength | 1, blur_strength | 1), 0)
        output   = (bgr * mask_3ch + blurred * (1 - mask_3ch)).astype(np.uint8)
        return output

    except Exception:
        return bgr


# ── Face embedding ─────────────────────────────────────────────────────

def extract_embedding(bgr: np.ndarray, strict: bool = False) -> list[float]:
    """
    Extract an ArcFace 512-dim embedding from an image.
    Raises ValueError if no face detected or multiple faces found.
    Uses 'opencv' detector by default (lenient) for registration,
    'retinaface' when strict=True (for attendance matching).
    """
    rgb      = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    backend  = DETECTOR_BACKEND_STRICT if strict else DETECTOR_BACKEND

    try:
        result = DeepFace.represent(
            img_path         = rgb,
            model_name       = MODEL_NAME,
            detector_backend = backend,
            enforce_detection= True,
            align            = True,
        )
    except Exception as e:
        raise ValueError(f"Face detection failed: {str(e)}")

    if len(result) == 0:
        raise ValueError("No face detected in image")
    if len(result) > 1:
        raise ValueError("Multiple faces detected — only one face per frame allowed")

    return result[0]["embedding"]   # list of 512 floats


def average_embeddings(embeddings: list[list[float]]) -> list[float]:
    """Average multiple embeddings into one representative vector."""
    arr = np.array(embeddings, dtype=np.float32)
    avg = arr.mean(axis=0)
    # L2-normalise so cosine similarity works correctly
    norm = np.linalg.norm(avg)
    return (avg / norm).tolist() if norm > 0 else avg.tolist()


# ── Face matching ──────────────────────────────────────────────────────

def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-10))


def match_face(
    live_embedding: list[float],
    stored_encrypted: str,
) -> tuple[bool, float]:
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
        result = DeepFace.represent(
            img_path         = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB),
            model_name       = MODEL_NAME,
            detector_backend = DETECTOR_BACKEND,
            enforce_detection= True,
            align            = True,
        )
        return len(result) == 1
    except Exception:
        return False


def validate_registration_frames(frames_bytes: list[bytes]) -> list[list[float]]:
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