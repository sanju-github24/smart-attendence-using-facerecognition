# SmartAttend — Face Recognition Attendance System

Built with FastAPI + React + InsightFace (ArcFace)

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| 🎓 Student | student@college.com | test1234567 |
| 📖 Teacher | teacher@college.com | teach1234 |
| ⚙️ Admin | admin@college.edu | admin123 |

## How to Test

1. **Admin** → Login → create a Subject → assign Teacher to class
2. **Student** → Login → complete 5-pose face enrollment
3. **Teacher** → Login → select class → Start Session
4. **Student** → Login → Mark Attendance (face scan)
5. **Teacher** → End Session → view Full Report

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/login | Login — returns JWT |
| POST | /auth/register/student | Register student |
| POST | /auth/register/teacher | Register teacher |
| POST | /admin/subjects | Create subject |
| POST | /admin/assignments | Assign teacher to class |
| POST | /attendance/session/open | Teacher opens session |
| GET | /attendance/session/active | Student gets live sessions |
| POST | /attendance/mark | Student marks attendance |
| GET | /attendance/my | Student attendance summary |

## Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL (Supabase), InsightFace ArcFace
- **Frontend**: React, Vite, MediaPipe (face detection)
- **Auth**: JWT, bcrypt
- **Deploy**: Render (backend) + Vercel (frontend)
