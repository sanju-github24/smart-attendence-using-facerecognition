import { useState, useEffect, useRef } from 'react';
import { getRegistrationStatus, getActiveSessions, markAttendance, getMyAttendance, getMyClasses } from '../api';
import FaceRegistration from '../pages/FaceRegistration';
import AttendanceTracker from './AttendanceTracker';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function StudentDashboard({ user, token, onLogout }) {
  const [regStatus, setRegStatus]             = useState(null);
  const [regLoading, setRegLoading]           = useState(true);
  // showFaceReg is only true if backend says not registered — never from token expiry
  const [showFaceReg, setShowFaceReg]         = useState(false);
  const [sessions, setSessions]               = useState([]);
  const [myAttendance, setMyAttendance]       = useState([]);
  const [myClasses, setMyClasses]             = useState([]);
  const [marking, setMarking]                 = useState(false);
  const [error, setError]                     = useState('');
  const [success, setSuccess]                 = useState('');
  const [showCam, setShowCam]                 = useState(false);
  const [camReady, setCamReady]               = useState(false);
  const [targetSessionId, setTargetSessionId] = useState(null);
  const [showTracker, setShowTracker] = useState(false);
  const [countdown, setCountdown]             = useState({});
  const videoRef  = useRef(null);
  const streamRef = useRef(null);

  const [markedSessions, setMarkedSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`marked_${user.user_id}`) || '[]'); }
    catch { return []; }
  });

  // ── On mount: check registration status ──────────────────────────────
  // IMPORTANT: 401 = token expired → call onLogout, NOT face registration
  useEffect(() => {
    async function init() {
      setRegLoading(true);
      try {
        const regRes = await fetch(`${API}/registration/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Token expired or invalid → logout, do NOT show face registration
        if (regRes.status === 401) {
          onLogout();
          return;
        }

        const regData = await regRes.json();
        setRegStatus(regData);

        // Only show face registration if student genuinely hasn't registered
        if (!regData.is_registered) setShowFaceReg(true);

        // Load classes and attendance in parallel (failures are non-critical)
        const [classData, attData] = await Promise.allSettled([
          getMyClasses(token),
          getMyAttendance(token),
        ]);
        setMyClasses(classData.status === 'fulfilled' && Array.isArray(classData.value) ? classData.value : []);
        setMyAttendance(attData.status  === 'fulfilled' && Array.isArray(attData.value)  ? attData.value  : []);

      } catch {
        // Network error — stay on dashboard, don't force face registration
        setRegStatus({ is_registered: true });
      } finally {
        setRegLoading(false);
      }
    }
    init();
  }, [token]);

  // ── Poll active sessions every 15s ────────────────────────────────────
  useEffect(() => {
    async function checkSessions() {
      try {
        const res = await fetch(`${API}/attendance/session/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) { onLogout(); return; }
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : []);
      } catch {}
    }
    checkSessions();
    const t = setInterval(checkSessions, 15000);
    return () => clearInterval(t);
  }, [token]);

  // ── Countdown timer ───────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const now  = Date.now();
      const next = {};
      sessions.forEach(s => {
        next[s.session_id] = Math.max(0, Math.floor((new Date(s.expires_at) - now) / 1000));
      });
      setCountdown(next);
    }, 1000);
    return () => clearInterval(t);
  }, [sessions]);

  // ── Camera ────────────────────────────────────────────────────────────
  async function startCamera(sessionId) {
    setTargetSessionId(sessionId);
    setShowCam(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamReady(true);
    } catch {
      setError('Camera access denied.');
      setShowCam(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setShowCam(false); setCamReady(false); setTargetSessionId(null);
  }

  async function captureAndMark() {
    if (!videoRef.current || !camReady) return;
    setMarking(true); setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      const blob   = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      const result = await markAttendance(token, targetSessionId, blob);
      setSuccess(`✅ Attendance marked! Confidence: ${result.confidence ? (result.confidence * 100).toFixed(0) : 95}%`);
      const updated = [...markedSessions, targetSessionId];
      setMarkedSessions(updated);
      localStorage.setItem(`marked_${user.user_id}`, JSON.stringify(updated));
      stopCamera();
    } catch (err) {
      if (err.message?.includes('401') || err.message?.toLowerCase().includes('unauthorized')) {
        onLogout();
        return;
      }
      setError(err.message);
    } finally { setMarking(false); }
  }

  function handleFaceRegComplete() {
    setShowFaceReg(false);
    // Refresh registration status after completing face registration
    fetch(`${API}/registration/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setRegStatus(d); })
      .catch(() => {});
  }

  // ── Loading ───────────────────────────────────────────────────────────
  if (regLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)', flexDirection: 'column', gap: 16 }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <circle cx="12" cy="12" r="9" strokeDasharray="40 20" />
        </svg>
        <span style={{ fontSize: '.9rem' }}>Loading your profile…</span>
      </div>
    );
  }

  // ── Face registration — only shown if backend confirms not registered ──
  if (showFaceReg) {
    return <FaceRegistration token={token} user={user} onComplete={handleFaceRegComplete} />;
  }


  if (showTracker) {
  return <AttendanceTracker token={token} user={user} onBack={() => setShowTracker(false)} />;
}


  // ── Main dashboard ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, background: 'linear-gradient(135deg,var(--accent2),var(--accent))', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎓</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>SmartAttend</div>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Student Portal</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="avatar">{initials(user.full_name)}</div>
          <div>
            <div style={{ fontWeight: 500, fontSize: '.88rem' }}>{user.full_name}</div>
            <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>
              {user.roll_number || 'Student'}{user.department ? ` · ${user.department}` : ''}
            </div>
          </div>
          <button onClick={onLogout} className="btn-ghost" style={{ marginLeft: 4, fontSize: '.82rem', padding: '8px 14px' }}>Sign out</button>
          <button
  onClick={() => setShowTracker(true)}
  style={{ fontSize: '.82rem', padding: '8px 14px', background: 'rgba(129,140,248,.12)', border: '1px solid rgba(129,140,248,.25)', borderRadius: 10, color: '#818cf8', cursor: 'pointer', fontWeight: 500 }}
>
  📊 Attendance
</button>
        </div>
      </div>

      {/* Alerts */}
      {error   && <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: '.875rem' }}>{error}</div>}
      {success && <div style={{ background: 'rgba(110,231,183,.1)', border: '1px solid rgba(110,231,183,.3)', color: 'var(--accent)', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: '.875rem' }}>{success}</div>}

      {/* Webcam modal */}
      {showCam && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 480, padding: '28px' }}>
            <h3 style={{ marginBottom: 16, fontWeight: 600 }}>📷 Face Verification</h3>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginBottom: 18 }}>Look directly at the camera, ensure good lighting</p>
            <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 20, background: 'var(--surface2)', aspectRatio: '4/3' }}>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                onLoadedMetadata={() => setCamReady(true)} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-accent" style={{ flex: 1, padding: '12px' }} onClick={captureAndMark} disabled={marking || !camReady}>
                {marking
                  ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin .7s linear infinite' }} />
                      Verifying…
                    </span>
                  : '✓ Mark Attendance'}
              </button>
              <button className="btn-ghost" onClick={stopCamera} style={{ padding: '12px 18px' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Active sessions */}
      <h2 style={{ fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14 }}>Live Sessions</h2>
      {sessions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '36px', marginBottom: 32, color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>No active sessions</div>
          <div style={{ fontSize: '.83rem' }}>Your teacher hasn't started a session yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {sessions.map(s => {
            const secs = countdown[s.session_id] || 0;
            const mins = String(Math.floor(secs / 60)).padStart(2, '0');
            const sec  = String(secs % 60).padStart(2, '0');
            const done = s.already_marked || markedSessions.includes(s.session_id);
            return (
              <div key={s.session_id} className="card fade-in" style={{ background: 'linear-gradient(135deg,rgba(129,140,248,.07),rgba(110,231,183,.04))', borderColor: done ? 'rgba(110,231,183,.3)' : 'rgba(129,140,248,.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div className="tag-live">LIVE</div>
                    <span style={{ fontWeight: 600 }}>{s.subject_name}</span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: '.78rem', color: 'var(--muted)' }}>{s.subject_code}</span>
                  </div>
                  <div style={{ fontSize: '.83rem', color: 'var(--muted)' }}>
                    {s.department} · Year {s.year} Sem {s.semester}
                    {s.section ? ` · ${s.section}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {!done && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'DM Mono', fontSize: '1.6rem', fontWeight: 500, color: secs < 60 ? 'var(--danger)' : 'var(--accent)' }}>{mins}:{sec}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>remaining</div>
                    </div>
                  )}
                  {done
                    ? <span className="badge badge-green">✓ Marked</span>
                    : <button className="btn-accent" style={{ padding: '11px 22px' }} onClick={() => startCamera(s.session_id)}>📷 Mark Now</button>
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* My Classes */}
      <h2 style={{ fontSize: '.78rem', color: 'var(--muted)', fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14 }}>My Classes</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        {myClasses.length === 0 && (
          <div className="card" style={{ color: 'var(--muted)', fontSize: '.88rem', textAlign: 'center', padding: '28px' }}>
            No classes found. Contact your admin to get enrolled.
          </div>
        )}
        {myClasses.map((c, i) => {
          const att = myAttendance.find(a => a.assignment_id === c.id || a.subject_code === c.subject_code) || {};
          const pct = att.attendance_pct ?? att.pct ?? null;
          return (
            <div key={c.id || i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '18px 22px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500 }}>{c.subject_name}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: '.75rem', color: 'var(--muted)' }}>{c.subject_code}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                    {c.department} · Yr{c.year} Sem{c.semester}{c.section ? ` · ${c.section}` : ''}
                  </span>
                  {pct !== null && pct < 75 && <span className="badge badge-red">⚠ Below 75%</span>}
                </div>
                {pct !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 4, maxWidth: 200 }}>
                      <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, background: pct < 75 ? 'var(--danger)' : pct > 85 ? 'var(--accent)' : 'var(--warn)', transition: 'width 1s ease' }} />
                    </div>
                    <span style={{ fontFamily: 'DM Mono', fontSize: '.85rem', color: pct < 75 ? 'var(--danger)' : 'var(--text)', fontWeight: 500 }}>{pct}%</span>
                  </div>
                )}
              </div>
              {att.present != null && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: '.9rem' }}>{att.present}/{att.total || '?'}</div>
                  <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>classes</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Face registration card */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: regStatus?.is_registered ? 'rgba(110,231,183,.1)' : 'rgba(251,191,36,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
          {regStatus?.is_registered ? '✅' : '👤'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, marginBottom: 2 }}>Face Registration</div>
          <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
            {regStatus?.is_registered
              ? `Registered${regStatus.registered_at ? ' on ' + new Date(regStatus.registered_at).toLocaleDateString() : ''} · AES-256 encrypted`
              : 'Not registered — required to mark attendance'}
          </div>
        </div>
        {regStatus?.is_registered
          ? <button className="btn-ghost" style={{ fontSize: '.85rem', whiteSpace: 'nowrap' }} onClick={() => setShowFaceReg(true)}>Update</button>
          : <button className="btn-accent" style={{ fontSize: '.85rem', whiteSpace: 'nowrap' }} onClick={() => setShowFaceReg(true)}>Register Face →</button>
        }
      </div>

    </div>
  );
}