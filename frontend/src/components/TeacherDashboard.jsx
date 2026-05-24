import { useState, useEffect, useRef } from 'react';
import { openSession, closeSession, getReport, getActiveSessionForAssignment } from '../api';

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function useTimer(active) {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (active) {
      ref.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      clearInterval(ref.current);
      setElapsed(0);
    }
    return () => clearInterval(ref.current);
  }, [active]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Normalise: always use assignment_id regardless of what the API returns
function normaliseSubject(s) {
  return {
    ...s,
    assignment_id: s.assignment_id ?? s.id,   // prefer assignment_id, fall back to id
    subject_name:  s.subject_name  ?? s.name,
    subject_code:  s.subject_code  ?? s.code,
  };
}

export default function TeacherDashboard({ user, token, subjects, onLogout }) {
  const normSubjects = (subjects || []).map(normaliseSubject);

  const [activeSubject, setActiveSubject] = useState(normSubjects[0] || null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId]         = useState(null);
  const [duration, setDuration]           = useState(15);
  const [attendees, setAttendees]         = useState([]);
  const [view, setView]                   = useState('attendance');
  const [report, setReport]               = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');
  const timer = useTimer(sessionActive);

  const flagged = attendees.filter(a => a.flagged);
  const clean   = attendees.filter(a => !a.flagged);

  // Check for existing active session when switching subjects
  useEffect(() => {
    if (!activeSubject?.assignment_id) return;
    setAttendees([]);
    setSessionActive(false);
    setSessionId(null);
    setReport(null);
    setView('attendance');

    getActiveSessionForAssignment(token, activeSubject.assignment_id)
      .then(data => {
        if (data?.active) {
          setSessionId(data.session_id);
          setSessionActive(true);
        }
      })
      .catch(() => {});
  }, [activeSubject?.assignment_id]);

  // Poll attendance every 5s during active session
  useEffect(() => {
    if (!sessionActive || !activeSubject?.assignment_id) return;
    const interval = setInterval(async () => {
      try {
        const data = await getReport(token, activeSubject.assignment_id);
        const raw  = data.report || data.attendees || [];
        setAttendees(raw.map(r => {
          const confidence = r.confidence !== undefined ? r.confidence : 0.95;
          let status = 'absent';
          if (r.status === 'present' || r.present > 0) status = 'present';
          else if (r.status === 'late' || r.late > 0)  status = 'late';
          return {
            id:         r.student_id || r.id,
            name:       r.full_name || r.student_name || 'Unknown',
            roll:       r.roll_number || r.roll || '—',
            status,
            confidence,
            flagged:    r.flagged || r.flagged_count > 0 || confidence < 0.70,
            time:       r.marked_at ? new Date(r.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
            photoUrl:   r.photo_url || null,
          };
        }));
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [sessionActive, activeSubject?.assignment_id, token]);

  async function handleOpenSession() {
    if (!activeSubject?.assignment_id) {
      setError('No class selected or assignment ID missing.');
      return;
    }
    setLoading(true); setError('');
    try {
      const data = await openSession(token, activeSubject.assignment_id, duration);
      setSessionId(data.session_id);
      setSessionActive(true);
      setAttendees([]);
      setView('attendance');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleCloseSession() {
    try { if (sessionId) await closeSession(token, sessionId); } catch {}
    setSessionActive(false);
    setSessionId(null);
    loadReport();
  }

  async function loadReport() {
    if (!activeSubject?.assignment_id) return;
    try {
      const data = await getReport(token, activeSubject.assignment_id);
      setReport(data);
    } catch {}
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* Sidebar */}
      <aside style={{ width: 256, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: 'linear-gradient(135deg,var(--accent2),var(--accent))', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🎓</div>
            <span style={{ fontWeight: 600, fontSize: '1rem' }}>SmartAttend</span>
          </div>
        </div>

        <div style={{ padding: '20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="avatar" style={{ background: 'linear-gradient(135deg,var(--accent2),var(--accent))' }}>{initials(user.full_name)}</div>
            <div>
              <div style={{ fontWeight: 500, fontSize: '.88rem' }}>{user.full_name}</div>
              <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Teacher · {user.department || ''}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 12px', flex: 1 }}>
          <p style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', padding: '0 8px', marginBottom: 10 }}>My Classes</p>
          {normSubjects.map(s => (
            <button
              key={s.assignment_id}
              onClick={() => setActiveSubject(s)}
              style={{ width: '100%', textAlign: 'left', background: activeSubject?.assignment_id === s.assignment_id ? 'rgba(129,140,248,.12)' : 'transparent', border: 'none', borderRadius: 10, padding: '10px 12px', marginBottom: 4, color: activeSubject?.assignment_id === s.assignment_id ? 'var(--accent2)' : 'var(--text)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}
            >
              <span style={{ fontWeight: 500, fontSize: '.88rem' }}>{s.subject_name}</span>
              <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontFamily: 'DM Mono' }}>{s.subject_code}</span>
              <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>
                {s.department} · Yr{s.year} Sem{s.semester}{s.section ? ` · ${s.section}` : ''}
              </span>
            </button>
          ))}
          {normSubjects.length === 0 && (
            <p style={{ fontSize: '.83rem', color: 'var(--muted)', padding: '8px' }}>No classes assigned yet</p>
          )}
        </div>

        <div style={{ padding: '16px 12px' }}>
          <button onClick={onLogout} className="btn-ghost" style={{ width: '100%', fontSize: '.85rem' }}>Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto', maxHeight: '100vh' }}>
        {!activeSubject ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 40 }}>📚</div>
            <div>Select a class from the sidebar</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-.02em' }}>
                  {activeSubject.subject_name}
                </h1>
                <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginTop: 4 }}>
                  <span style={{ fontFamily: 'DM Mono' }}>{activeSubject.subject_code}</span>
                  {' · '}{activeSubject.department}
                  {' · '}Year {activeSubject.year} Sem {activeSubject.semester}
                  {activeSubject.section && ` · ${activeSubject.section}`}
                  {activeSubject.students_count != null && ` · ${activeSubject.students_count} students`}
                </p>
              </div>
              {sessionActive && <div className="tag-live">LIVE — {timer}</div>}
            </div>

            {error && (
              <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 20, fontSize: '.875rem' }}>{error}</div>
            )}

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
              {[
                { label: 'Present', value: clean.filter(a => a.status === 'present').length, color: 'var(--accent)' },
                { label: 'Late',    value: clean.filter(a => a.status === 'late').length,    color: 'var(--warn)' },
                { label: 'Review',  value: flagged.length,                                    color: 'var(--danger)' },
                { label: 'Total',   value: attendees.length,                                  color: 'var(--accent2)' },
              ].map(stat => (
                <div key={stat.label} className="card" style={{ padding: '18px' }}>
                  <div style={{ fontSize: '1.9rem', fontWeight: 600, color: stat.color, fontFamily: 'DM Mono' }}>{stat.value}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Session control */}
            {!sessionActive ? (
              <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>Start Attendance Session</div>
                  <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                    Only enrolled students · IP + face verified
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: 140 }}>
                    {[5, 10, 15, 30, 60].map(d => (
                      <option key={d} value={d}>{d} minutes</option>
                    ))}
                  </select>
                  <button className="btn-accent" onClick={handleOpenSession} disabled={loading}>
                    {loading ? 'Starting…' : '▶ Start Session'}
                  </button>
                  <button className="btn-ghost" onClick={loadReport} style={{ fontSize: '.85rem' }}>View Report</button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: 'rgba(248,113,113,.04)', borderColor: 'rgba(248,113,113,.2)' }}>
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>Session in progress</div>
                  <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Students can mark attendance · polling every 5s</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: '1.7rem', color: 'var(--danger)', fontWeight: 500 }}>{timer}</div>
                  <button className="btn-danger" onClick={handleCloseSession}>■ End Session</button>
                </div>
              </div>
            )}

            {/* Tab toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {['attendance', 'review', 'report'].map(v => (
                <button key={v} onClick={() => { setView(v); if (v === 'report') loadReport(); }}
                  style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.875rem', background: view === v ? 'var(--surface2)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {v === 'attendance' && `Attendance (${clean.length})`}
                  {v === 'review' && (
                    <>Needs Review {flagged.length > 0 && (
                      <span style={{ background: 'var(--danger)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: '.72rem' }}>{flagged.length}</span>
                    )}</>
                  )}
                  {v === 'report' && 'Full Report'}
                </button>
              ))}
            </div>

            {/* Attendance table */}
            {view === 'attendance' && (
              <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
                {clean.length === 0 ? (
                  <div style={{ padding: '52px', textAlign: 'center', color: 'var(--muted)' }}>
                    {sessionActive ? '⏳ Waiting for students to mark attendance…' : 'Start a session to collect attendance'}
                  </div>
                ) : (
                  <table>
                    <thead><tr>
                      <th style={{ paddingLeft: 22 }}>Student</th>
                      <th>Roll No.</th>
                      <th>Status</th>
                      <th>Confidence</th>
                      <th>Time</th>
                    </tr></thead>
                    <tbody>
                      {clean.map(a => (
                        <tr key={a.id} className="fade-in">
                          <td style={{ paddingLeft: 22 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div className="avatar" style={{ width: 32, height: 32, fontSize: '.78rem' }}>{initials(a.name)}</div>
                              <span style={{ fontWeight: 500 }}>{a.name}</span>
                            </div>
                          </td>
                          <td><span style={{ fontFamily: 'DM Mono', color: 'var(--muted)', fontSize: '.83rem' }}>{a.roll}</span></td>
                          <td><span className={`badge ${a.status === 'present' ? 'badge-green' : 'badge-yellow'}`}>{a.status}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 70, height: 4, background: 'var(--border)', borderRadius: 4 }}>
                                <div style={{ height: '100%', borderRadius: 4, width: `${(a.confidence || 0) * 100}%`, background: (a.confidence || 0) > 0.8 ? 'var(--accent)' : 'var(--warn)' }} />
                              </div>
                              <span style={{ fontFamily: 'DM Mono', fontSize: '.8rem', color: 'var(--muted)' }}>{((a.confidence || 0) * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{a.time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Review panel */}
            {view === 'review' && (
              <div className="fade-in">
                {flagged.length === 0 ? (
                  <div className="card" style={{ padding: '52px', textAlign: 'center', color: 'var(--muted)' }}>✓ No flagged entries — all confident face matches</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {flagged.map(a => (
                      <div key={a.id} className="card fade-in" style={{ borderColor: 'rgba(248,113,113,.25)' }}>
                        <div style={{ background: 'var(--surface2)', borderRadius: 10, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                          {a.photoUrl
                            ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : (
                              <>
                                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 40%, rgba(129,140,248,.15), transparent 70%)' }} />
                                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent2),var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', fontWeight: 700, color: '#fff', zIndex: 1 }}>{initials(a.name)}</div>
                              </>
                            )}
                          <div style={{ position: 'absolute', top: 10, right: 10 }}><span className="badge badge-red">Low confidence</span></div>
                        </div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.name}</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: '.8rem', color: 'var(--muted)', marginBottom: 14 }}>{a.roll}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                          <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 4 }}>
                            <div style={{ height: '100%', borderRadius: 4, width: `${(a.confidence || 0) * 100}%`, background: 'var(--danger)' }} />
                          </div>
                          <span style={{ fontFamily: 'DM Mono', fontSize: '.85rem', color: 'var(--danger)' }}>{((a.confidence || 0) * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn-success" style={{ flex: 1, fontSize: '.83rem' }}>✓ Approve</button>
                          <button className="btn-danger"  style={{ flex: 1, fontSize: '.83rem' }}>✗ Reject</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Report */}
            {view === 'report' && report && (
              <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>Full Attendance Report · {report.total_sessions || 0} sessions</span>
                  <span className="badge badge-blue">{activeSubject.subject_code}</span>
                </div>
                <table>
                  <thead><tr>
                    <th style={{ paddingLeft: 22 }}>Student</th>
                    <th>Present</th>
                    <th>Late</th>
                    <th>Absent</th>
                    <th>Attendance %</th>
                    <th>Status</th>
                  </tr></thead>
                  <tbody>
                    {(report.report || []).map(r => (
                      <tr key={r.student_id}>
                        <td style={{ paddingLeft: 22 }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 500 }}>{r.full_name}</span>
                            <span style={{ fontFamily: 'DM Mono', fontSize: '.75rem', color: 'var(--muted)' }}>{r.roll_number}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--accent)',  fontFamily: 'DM Mono' }}>{r.present}</td>
                        <td style={{ color: 'var(--warn)',    fontFamily: 'DM Mono' }}>{r.late}</td>
                        <td style={{ color: 'var(--danger)',  fontFamily: 'DM Mono' }}>{r.absent}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 4 }}>
                              <div style={{ height: '100%', borderRadius: 4, width: `${r.attendance_pct}%`, background: r.below_75 ? 'var(--danger)' : 'var(--accent)' }} />
                            </div>
                            <span style={{ fontFamily: 'DM Mono', fontSize: '.85rem' }}>{r.attendance_pct}%</span>
                          </div>
                        </td>
                        <td>{r.below_75 ? <span className="badge badge-red">⚠ Below 75%</span> : <span className="badge badge-green">✓ Good</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}