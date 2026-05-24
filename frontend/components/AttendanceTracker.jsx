import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function authFetch(path, token) {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));
}

function safeToMiss(present, total) {
  const x = Math.floor((present - 0.75 * total) / 0.75);
  return Math.max(0, x);
}
function classesToReach75(present, total) {
  const x = Math.ceil((0.75 * total - present) / 0.25);
  return Math.max(0, x);
}

function LiveDot() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e05252', display: 'inline-block', animation: 'livePulse 1.4s infinite' }} />
      <span style={{ fontSize: '.68rem', color: '#e05252', fontWeight: 700, letterSpacing: '.06em' }}>LIVE</span>
    </span>
  );
}

function PctBadge({ pct }) {
  if (pct === null) return <span style={{ color: '#999', fontSize: '.82rem' }}>—</span>;
  const color = pct < 75 ? '#c0392b' : pct < 85 ? '#d4850a' : '#1a7a4a';
  const bg    = pct < 75 ? '#fdecea' : pct < 85 ? '#fef3e2' : '#eafaf1';
  return (
    <span style={{ background: bg, color, fontWeight: 700, fontSize: '.78rem', padding: '3px 10px', borderRadius: 20, border: `1px solid ${color}30` }}>
      {pct}%
    </span>
  );
}

export default function AttendanceTracker({ token, user, onBack }) {
  const [classes, setClasses]       = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [sessions, setSessions]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filterCourse, setFilterCourse] = useState('All Courses');
  const [filterStatus, setFilterStatus] = useState('All');
  const pollRef = useRef(null);

  async function loadAll() {
    try {
      const [classData, attData, sessData] = await Promise.allSettled([
        authFetch('/auth/my-classes', token),
        authFetch('/attendance/my', token),
        authFetch('/attendance/session/active', token),
      ]);
      if (classData.status === 'fulfilled') setClasses(Array.isArray(classData.value) ? classData.value : []);
      if (attData.status  === 'fulfilled') setAttendance(Array.isArray(attData.value)  ? attData.value  : []);
      if (sessData.status === 'fulfilled') setSessions(Array.isArray(sessData.value)   ? sessData.value : []);
      setLastUpdated(new Date());
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(loadAll, 10000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  const merged = classes.map(c => {
    const att = attendance.find(a =>
      a.assignment_id === c.assignment_id ||
      a.subject_code  === c.subject_code  ||
      a.subject_id    === c.subject_id
    ) || {};
    const present = att.present ?? 0;
    const total   = att.total ?? att.total_sessions ?? 0;
    const absent  = total - present;
    const pct     = total > 0 ? Math.round((present / total) * 100) : null;
    const isLive  = sessions.some(s => s.assignment_id === c.assignment_id || s.subject_code === c.subject_code);
    return { ...c, present, total, absent, pct, isLive };
  });

  // Totals
  const totalTaken   = merged.reduce((s, c) => s + c.total, 0);
  const totalPresent = merged.reduce((s, c) => s + c.present, 0);
  const totalAbsent  = merged.reduce((s, c) => s + c.absent, 0);
  const overallPct   = totalTaken > 0 ? Math.round((totalPresent / totalTaken) * 100) : null;
  const liveCount    = merged.filter(c => c.isLive).length;

  // Filters
  const courseOptions = ['All Courses', ...merged.map(c => c.subject_name).filter(Boolean)];
  const filtered = merged.filter(c => {
    const matchCourse = filterCourse === 'All Courses' || c.subject_name === filterCourse;
    const matchStatus =
      filterStatus === 'All' ? true :
      filterStatus === 'Low (<75%)' ? (c.pct !== null && c.pct < 75) :
      filterStatus === 'At Risk (75-84%)' ? (c.pct !== null && c.pct >= 75 && c.pct < 85) :
      filterStatus === 'Good (≥85%)' ? (c.pct !== null && c.pct >= 85) :
      filterStatus === 'Live' ? c.isLive : true;
    return matchCourse && matchStatus;
  });

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9', flexDirection: 'column', gap: 14, color: '#666', fontFamily: "'Noto Sans', sans-serif" }}>
      <div style={{ width: 36, height: 36, border: '3px solid #c8a94a', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontSize: '.9rem' }}>Loading attendance…</span>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: "'Noto Sans', 'Segoe UI', sans-serif", color: '#222' }}>
      <style>{`
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.6)} }
        @keyframes fadeUp    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .subj-row { transition: background .15s; }
        .subj-row:hover { background: #f7f9fc !important; }
        .portal-select {
          appearance: none;
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E") no-repeat right 12px center;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 8px 32px 8px 12px;
          font-size: .85rem;
          color: #333;
          cursor: pointer;
          min-width: 180px;
        }
        .portal-select:focus { outline: none; border-color: #c8a94a; }
        .stat-icon { width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ background: '#1a2340', color: '#fff', padding: '0 28px', display: 'flex', alignItems: 'center', height: 52, gap: 16, boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', borderRadius: 5, padding: '5px 14px', fontSize: '.82rem', cursor: 'pointer', marginRight: 8 }}>
          ← Back
        </button>
        <span style={{ fontSize: '1.05rem', fontWeight: 600, letterSpacing: '.01em' }}>My Attendance</span>
        <div style={{ flex: 1 }} />
        {liveCount > 0 && <LiveDot />}
        <span style={{ fontSize: '.75rem', color: 'rgba(255,255,255,.5)' }}>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={loadAll} style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', borderRadius: 5, padding: '5px 12px', fontSize: '.8rem', cursor: 'pointer' }}>
          ↻
        </button>
      </div>

      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '24px 20px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── LEFT STATS PANEL ── */}
        <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeUp .35s ease' }}>

          {/* Overall % — big number */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '22px 18px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.08)', border: '1px solid #e5e8ee' }}>
            <div style={{ fontSize: 3.2 + 'rem', fontWeight: 800, color: overallPct < 75 ? '#c0392b' : overallPct < 85 ? '#d4850a' : '#1a7a4a', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {overallPct ?? '—'}
            </div>
            <div style={{ fontSize: '.72rem', color: '#888', marginTop: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Attendance %
            </div>
            {/* Mini bar */}
            {overallPct !== null && (
              <div style={{ marginTop: 12, height: 6, background: '#eef0f4', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: 2, background: '#ccc', zIndex: 2 }} />
                <div style={{ height: '100%', width: `${overallPct}%`, background: overallPct < 75 ? '#e05252' : overallPct < 85 ? '#e6a020' : '#27ae60', borderRadius: 4, transition: 'width 1s ease' }} />
              </div>
            )}
            {overallPct !== null && (
              <div style={{ fontSize: '.68rem', color: '#aaa', marginTop: 5 }}>75% threshold</div>
            )}
          </div>

          {/* Stat cards */}
          {[
            { icon: '📅', label: '# of Classes Taken',    value: totalTaken,   color: '#1a2340', bg: '#eef0f7' },
            { icon: '✅', label: '# of Classes Present',  value: totalPresent, color: '#1a7a4a', bg: '#eafaf1' },
            { icon: '❌', label: '# of Classes Absent',   value: totalAbsent,  color: '#c0392b', bg: '#fdecea' },
            { icon: '📚', label: 'Total Subjects',        value: merged.length, color: '#1a4070', bg: '#eaf1fb' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.07)', border: '1px solid #e5e8ee', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="stat-icon" style={{ background: s.bg }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: '.68rem', color: '#888', marginTop: 2, lineHeight: 1.3 }}>{s.label}</div>
              </div>
            </div>
          ))}

          {/* Live sessions */}
          {liveCount > 0 && (
            <div style={{ background: '#fff5f5', border: '1px solid #fcc', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <LiveDot />
                <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#c0392b' }}>{liveCount} Live Session{liveCount > 1 ? 's' : ''}</span>
              </div>
              {sessions.map((s, i) => (
                <div key={i} style={{ fontSize: '.75rem', color: '#666', paddingLeft: 10, borderLeft: '2px solid #fcc', marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, color: '#333' }}>{s.subject_name || s.subject_code}</div>
                  <div>{s.department} · Sem {s.semester}</div>
                </div>
              ))}
            </div>
          )}

          {/* Poll indicator */}
          <div style={{ fontSize: '.68rem', color: '#aaa', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#27ae60', display: 'inline-block', animation: 'livePulse 2.5s infinite' }} />
            Refreshes every 10s
          </div>
        </div>

        {/* ── RIGHT MAIN PANEL ── */}
        <div style={{ flex: 1, animation: 'fadeUp .4s ease .05s both' }}>

          {/* Filter bar */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,.07)', border: '1px solid #e5e8ee', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <select className="portal-select" value={filterCourse} onChange={e => setFilterCourse(e.target.value)}>
              {courseOptions.map(o => <option key={o}>{o}</option>)}
            </select>
            <select className="portal-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              {['All', 'Live', 'Good (≥85%)', 'At Risk (75-84%)', 'Low (<75%)'].map(o => <option key={o}>{o}</option>)}
            </select>
            <span style={{ marginLeft: 'auto', fontSize: '.78rem', color: '#888' }}>
              {filtered.length} subject{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,.07)', border: '1px solid #e5e8ee', overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', background: '#1a2340', color: '#c8c8d8', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', padding: '11px 18px', gap: 8 }}>
              <div>Subject</div>
              <div style={{ textAlign: 'center' }}>Taken</div>
              <div style={{ textAlign: 'center' }}>Present</div>
              <div style={{ textAlign: 'center' }}>Absent</div>
              <div style={{ textAlign: 'center' }}>%</div>
              <div style={{ textAlign: 'center' }}>Can Miss</div>
              <div style={{ textAlign: 'center' }}>Status</div>
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '.88rem' }}>
                No subjects match this filter.
              </div>
            )}

            {filtered.map((c, i) => {
              const rowBg = i % 2 === 0 ? '#fff' : '#fafbfd';
              const pctColor = c.pct === null ? '#888' : c.pct < 75 ? '#c0392b' : c.pct < 85 ? '#d4850a' : '#1a7a4a';
              return (
                <div key={c.assignment_id || i} className="subj-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', background: rowBg, padding: '13px 18px', gap: 8, borderTop: i === 0 ? 'none' : '1px solid #edf0f5', alignItems: 'center' }}>

                  {/* Subject name + meta */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.isLive && <LiveDot />}
                      <span style={{ fontWeight: 600, fontSize: '.88rem', color: '#1a2340' }}>{c.subject_name}</span>
                      <span style={{ fontSize: '.72rem', color: '#888', background: '#f0f2f5', padding: '1px 7px', borderRadius: 4, fontFamily: 'monospace' }}>{c.subject_code}</span>
                    </div>
                    <div style={{ fontSize: '.72rem', color: '#999', marginTop: 3 }}>
                      {c.department} · Yr {c.year} · Sem {c.semester}{c.section ? ` · Sec ${c.section}` : ''}
                    </div>
                    {/* Progress bar */}
                    <div style={{ marginTop: 6, height: 4, background: '#edf0f5', borderRadius: 3, overflow: 'hidden', maxWidth: 200, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: 1.5, background: '#ccc' }} />
                      <div style={{ height: '100%', width: `${c.pct ?? 0}%`, background: c.pct < 75 ? '#e05252' : c.pct < 85 ? '#e6a020' : '#27ae60', borderRadius: 3, transition: 'width 1s ease' }} />
                    </div>
                  </div>

                  {/* Taken */}
                  <div style={{ textAlign: 'center', fontWeight: 600, fontSize: '.9rem', color: '#1a2340', fontVariantNumeric: 'tabular-nums' }}>
                    {c.total}
                  </div>

                  {/* Present */}
                  <div style={{ textAlign: 'center', fontWeight: 600, fontSize: '.9rem', color: '#1a7a4a', fontVariantNumeric: 'tabular-nums' }}>
                    {c.present}
                  </div>

                  {/* Absent */}
                  <div style={{ textAlign: 'center', fontWeight: 600, fontSize: '.9rem', color: c.absent > 0 ? '#c0392b' : '#888', fontVariantNumeric: 'tabular-nums' }}>
                    {c.absent}
                  </div>

                  {/* % */}
                  <div style={{ textAlign: 'center' }}>
                    <PctBadge pct={c.pct} />
                  </div>

                  {/* Can Miss */}
                  <div style={{ textAlign: 'center', fontSize: '.82rem', fontVariantNumeric: 'tabular-nums' }}>
                    {c.total > 0 ? (
                      <span style={{ color: safeToMiss(c.present, c.total) > 0 ? '#1a7a4a' : '#c0392b', fontWeight: 600 }}>
                        {safeToMiss(c.present, c.total)}
                      </span>
                    ) : '—'}
                  </div>

                  {/* Status */}
                  <div style={{ textAlign: 'center' }}>
                    {c.pct === null ? (
                      <span style={{ fontSize: '.73rem', color: '#aaa' }}>No data</span>
                    ) : c.pct >= 85 ? (
                      <span style={{ fontSize: '.72rem', background: '#eafaf1', color: '#1a7a4a', border: '1px solid #a9dfbf', padding: '3px 9px', borderRadius: 20, fontWeight: 600 }}>✓ Good</span>
                    ) : c.pct >= 75 ? (
                      <span style={{ fontSize: '.72rem', background: '#fef3e2', color: '#d4850a', border: '1px solid #f5cba7', padding: '3px 9px', borderRadius: 20, fontWeight: 600 }}>⚠ Watch</span>
                    ) : (
                      <div>
                        <span style={{ fontSize: '.72rem', background: '#fdecea', color: '#c0392b', border: '1px solid #f5b7b1', padding: '3px 9px', borderRadius: 20, fontWeight: 600, display: 'block', marginBottom: 4 }}>✗ Low</span>
                        <span style={{ fontSize: '.68rem', color: '#c0392b' }}>Need {classesToReach75(c.present, c.total)} more</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Table footer totals */}
            {filtered.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', background: '#f0f2f5', padding: '11px 18px', gap: 8, borderTop: '2px solid #e0e3ea', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '.8rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</div>
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '.9rem', color: '#1a2340' }}>{filtered.reduce((s, c) => s + c.total, 0)}</div>
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '.9rem', color: '#1a7a4a' }}>{filtered.reduce((s, c) => s + c.present, 0)}</div>
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '.9rem', color: '#c0392b' }}>{filtered.reduce((s, c) => s + c.absent, 0)}</div>
                <div style={{ textAlign: 'center' }}>
                  {(() => {
                    const t = filtered.reduce((s, c) => s + c.total, 0);
                    const p = filtered.reduce((s, c) => s + c.present, 0);
                    const pct = t > 0 ? Math.round((p / t) * 100) : null;
                    return <PctBadge pct={pct} />;
                  })()}
                </div>
                <div />
                <div />
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap', fontSize: '.72rem', color: '#888' }}>
            <span>📌 <strong>Can Miss</strong> = classes skippable before dropping below 75%</span>
            <span>📌 <strong>Need more</strong> = consecutive classes to reach 75%</span>
            <span style={{ color: '#aaa' }}>│ marker at 75% threshold</span>
          </div>
        </div>
      </div>
    </div>
  );
}