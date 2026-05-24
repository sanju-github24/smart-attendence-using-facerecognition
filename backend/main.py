"""
SmartAttend API v2
Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import get_settings
from core.database import Base, engine
from routes import auth, attendance, admin
from routes.registration import router as registration_router

settings = get_settings()

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title      = "SmartAttend API",
    version    = "2.0.0",
    description= "AI-powered attendance — branch/year/sem/section aware",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins =[settings.frontend_url, "http://localhost:3000", "http://localhost:5173"],
    allow_methods =["*"],
    allow_headers =["*"],
)

app.include_router(auth.router)
app.include_router(attendance.router)
app.include_router(admin.router)
app.include_router(registration_router)


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}