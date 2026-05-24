const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Auth ──────────────────────────────────────────────────────────────────

export async function login(identifier, password) {
  // supports email OR roll number login
  const fd = new FormData();
  fd.append('username', identifier);
  fd.append('password', password);
  const res  = await fetch(`${BASE}/auth/login`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Login failed');
  return data;
}

export async function registerStudent(payload) {
  // payload: { email, full_name, phone, password, roll_number, department, year, semester }
  const res  = await fetch(`${BASE}/auth/register/student`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Registration failed');
  return data;
}

export async function registerTeacher(payload) {
  const res  = await fetch(`${BASE}/auth/register/teacher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Registration failed');
  return data;
}

export async function getMe(token) {
  const res  = await fetch(`${BASE}/auth/me`, { headers: authHeaders(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to get profile');
  return data;
}

export async function getMyClasses(token) {
  // Returns student's enrolled class assignments with subject info
  const res = await fetch(`${BASE}/auth/my-classes`, { headers: authHeaders(token) });
  return res.ok ? res.json() : [];
}

export async function getMySubjects(token) {
  // Returns teacher's assigned subjects/classes
  const res = await fetch(`${BASE}/auth/subjects/my`, { headers: authHeaders(token) });
  return res.ok ? res.json() : [];
}

// ── Face Registration ─────────────────────────────────────────────────────

export async function getRegistrationStatus(token) {
  const res = await fetch(`${BASE}/registration/status`, { headers: authHeaders(token) });
  return res.json();
}

export async function submitFaceFrames(token, frames) {
  const fd = new FormData();
  frames.forEach((blob, i) => fd.append(`frame${i + 1}`, blob, `frame${i + 1}.jpg`));
  const res  = await fetch(`${BASE}/registration/submit-frames`, {
    method: 'POST',
    headers: authHeaders(token),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Registration failed');
  return data;
}

// ── Attendance (Teacher) ──────────────────────────────────────────────────

export async function openSession(token, assignmentId, durationMinutes) {
  // v2: uses assignment_id instead of subject_id
  const res  = await fetch(`${BASE}/attendance/session/open`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignment_id: assignmentId, duration_minutes: durationMinutes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to open session');
  return data;
}

export async function closeSession(token, sessionId) {
  const res = await fetch(`${BASE}/attendance/session/close/${sessionId}`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return res.json();
}

export async function getActiveSessionForAssignment(token, assignmentId) {
  const res = await fetch(`${BASE}/attendance/session/active/${assignmentId}`, {
    headers: authHeaders(token),
  });
  return res.ok ? res.json() : { active: false };
}

export async function getReport(token, assignmentId) {
  const res = await fetch(`${BASE}/attendance/report/${assignmentId}`, {
    headers: authHeaders(token),
  });
  return res.ok ? res.json() : { report: [], total_sessions: 0 };
}

// ── Attendance (Student) ──────────────────────────────────────────────────

export async function getActiveSessions(token) {
  // v2: returns all active sessions the student is eligible for
  const res = await fetch(`${BASE}/attendance/session/active`, {
    headers: authHeaders(token),
  });
  return res.ok ? res.json() : [];
}

export async function markAttendance(token, sessionId, imageBlob) {
  const fd = new FormData();
  fd.append('session_id', sessionId);
  fd.append('file', imageBlob, 'face.jpg');
  const res  = await fetch(`${BASE}/attendance/mark`, {
    method: 'POST',
    headers: authHeaders(token),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Failed to mark attendance');
  return data;
}

export async function getMyAttendance(token) {
  // v2: student's own attendance % per subject
  const res = await fetch(`${BASE}/attendance/my`, { headers: authHeaders(token) });
  return res.ok ? res.json() : [];
}
