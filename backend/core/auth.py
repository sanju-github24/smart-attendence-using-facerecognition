from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import base64

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from core.config import get_settings
from core.database import get_db
import models.user as user_model

settings = get_settings()

pwd_context    = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme  = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ── Password helpers ───────────────────────────────────────────────────

def _prehash(plain: str) -> str:
    """SHA-256 + base64 to keep input within bcrypt's 72-byte limit."""
    digest = hashlib.sha256(plain.encode()).digest()
    return base64.b64encode(digest).decode()


def hash_password(plain: str) -> str:
    return pwd_context.hash(_prehash(plain))


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_prehash(plain), hashed)


# ── JWT helpers ────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload.update({"exp": expire})
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI dependencies ───────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> user_model.User:
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(user_model.User).filter(user_model.User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_teacher(current_user=Depends(get_current_user)):
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="Teachers only")
    return current_user


def require_student(current_user=Depends(get_current_user)):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    return current_user