import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── API helpers ────────────────────────────────────────────────────────
const get  = (path, token) => fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
const post = (path, body, token) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'Error'); return d; });

// ── Tiny reusable components ───────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [msg]);
  if (!msg) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999, padding: '12px 20px', borderRadius: 10, background: type === 'error' ? '#ef4444' : '#22c55e', color: '#fff', fontSize: '.88rem', fontWeight: 600, boxShadow: '0 4px 24px rgba(0,0,0,0.25)', maxWidth: 340 }}>
      {msg}
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f9fafb' }}>{title}</h3>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: 'block', fontSize: '.78rem', color: '#9ca3af', marginBottom: 5, fontWeight: 500 }}>{label}</label>}
      <input {...props} style={{ width: '100%', background: '#0f172a', border: '1px solid #374151', borderRadius: 8, padding: '9px 12px', color: '#f9fafb', fontSize: '.88rem', outline: 'none', boxSizing: 'border-box', ...props.style }} />
    </div>
  );
}

function Select({ label, children, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: 'block', fontSize: '.78rem', color: '#9ca3af', marginBottom: 5, fontWeight: 500 }}>{label}</label>}
      <select {...props} style={{ width: '100%', background: '#0f172a', border: '1px solid #374151', borderRadius: 8, padding: '9px 12px', color: '#f9fafb', fontSize: '.88rem', outline: 'none', boxSizing: 'border-box' }}>
        {children}
      </select>
    </div>
  );
}

function Btn({ children, onClick, disabled, color = '#6366f1', small }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ background: disabled ? '#374151' : color, color: '#fff', border: 'none', borderRadius: 8, padding: small ? '6px 14px' : '10px 20px', fontSize: small ? '.78rem' : '.88rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

function Table({ cols, rows, empty = 'No data' }) {
  if (!rows.length) return <div style={{ color: '#6b7280', fontSize: '.85rem', textAlign: 'center', padding: '20px 0' }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
        <thead>
          <tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '8px 12px', color: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #1f2937', whiteSpace: 'nowrap' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
              {r.map((cell, j) => <td key={j} style={{ padding: '9px 12px', color: '#e5e7eb', verticalAlign: 'middle' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Subjects', 'Assignments', 'Teachers', 'Students'];

// ── Main Component ─────────────────────────────────────────────────────
export default function AdminDashboard({ token, onLogout }) {
  const [tab, setTab]             = useState('Overview');
  const [toast, setToast]         = useState({ msg: '', type: 'ok' });
  const [loading, setLoading]     = useState(false);

  // Data
  const [structure, setStructure] = useState({});
  const [subjects, setSubjects]   = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers]   = useState([]);
  const [students, setStudents]   = useState([]);

  // Forms
  const [subForm, setSubForm]     = useState({ name: '', code: '', department: '', year: '', semester: '' });
  const [asgForm, setAsgForm]     = useState({ teacher_id: '', subject_id: '', department: '', year: '', semester: '', section: 'A' });
  const [stuFilter, setStuFilter] = useState({ branch: '', year: '', semester: '' });

  const ok  = msg => setToast({ msg, type: 'ok' });
  const err = msg => setToast({ msg, type: 'error' });

  // Load data per tab
  useEffect(() => {
    if (tab === 'Overview')     loadStructure();
    if (tab === 'Subjects')     loadSubjects();
    if (tab === 'Assignments')  { loadAssignments(); loadTeachers(); loadSubjects(); }
    if (tab === 'Teachers')     loadTeachers();
    if (tab === 'Students')     loadStudents();
  }, [tab]);

  async function loadStructure()   { setStructure(await get('/admin/structure', token)); }
  async function loadSubjects()    { setSubjects(await get('/admin/subjects', token)); }
  async function loadAssignments() { setAssignments(await get('/admin/assignments', token)); }
  async function loadTeachers()    { setTeachers(await get('/admin/teachers', token)); }
  async function loadStudents(f = stuFilter) {
    const p = new URLSearchParams();
    if (f.branch)   p.set('branch', f.branch);
    if (f.year)     p.set('year', f.year);
    if (f.semester) p.set('semester', f.semester);
    setStudents(await get(`/admin/students?${p}`, token));
  }

  async function createSubject() {
    if (!subForm.name || !subForm.code || !subForm.department || !subForm.year || !subForm.semester)
      return err('Fill all subject fields');
    setLoading(true);
    try {
      const r = await post('/admin/subjects', { ...subForm, year: +subForm.year, semester: +subForm.semester }, token);
      ok(`Subject "${r.name}" created (ID ${r.id})`);
      setSubForm({ name: '', code: '', department: '', year: '', semester: '' });
      loadSubjects();
    } catch(e) { err(e.message); }
    setLoading(false);
  }

  async function createAssignment() {
    if (!asgForm.teacher_id || !asgForm.subject_id || !asgForm.department || !asgForm.year || !asgForm.semester)
      return err('Fill all assignment fields');
    setLoading(true);
    try {
      const r = await post('/admin/assignments', {
        ...asgForm,
        teacher_id: +asgForm.teacher_id,
        subject_id: +asgForm.subject_id,
        year: +asgForm.year,
        semester: +asgForm.semester,
      }, token);
      ok(`Assigned! ${r.auto_enrolled} students auto-enrolled.`);
      setAsgForm({ teacher_id: '', subject_id: '', department: '', year: '', semester: '', section: 'A' });
      loadAssignments();
    } catch(e) { err(e.message); }
    setLoading(false);
  }

  // ── Render ─────────────────────────────────────────────────────────
  const s = {
    page: { minHeight: '100vh', background: '#030712', color: '#f9fafb', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" },
    nav:  { background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 0, height: 56 },
    logo: { fontWeight: 800, fontSize: '1.1rem', color: '#6366f1', marginRight: 32, letterSpacing: '-.01em' },
    main: { maxWidth: 1100, margin: '0 auto', padding: '28px 20px' },
  };

  return (
    <div style={s.page}>
      <Toast msg={toast.msg} type={toast.type} onClose={() => setToast({ msg: '' })} />

      {/* Nav */}
      <div style={s.nav}>
        <span style={s.logo}>SmartAttend Admin</span>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', color: tab === t ? '#6366f1' : '#9ca3af', fontWeight: tab === t ? 700 : 400, fontSize: '.9rem', padding: '0 14px', height: 56, cursor: 'pointer', borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent' }}>
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <Btn onClick={onLogout} color='#374151' small>Logout</Btn>
      </div>

      <div style={s.main}>

        {/* ── OVERVIEW ── */}
        {tab === 'Overview' && (
          <>
            <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', fontWeight: 800 }}>Academic Structure</h2>
            {Object.keys(structure).length === 0
              ? <div style={{ color: '#6b7280' }}>No data yet. Create subjects and assignments first.</div>
              : Object.entries(structure).map(([dept, years]) => (
                <Card key={dept} title={`🏛 ${dept}`}>
                  {Object.entries(years).map(([yr, sems]) => (
                    <div key={yr} style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: '.8rem', color: '#6366f1', fontWeight: 700, marginBottom: 8 }}>Year {yr}</div>
                      {Object.entries(sems).map(([sem, classes]) => (
                        <div key={sem} style={{ marginBottom: 10, paddingLeft: 12, borderLeft: '2px solid #1f2937' }}>
                          <div style={{ fontSize: '.75rem', color: '#9ca3af', marginBottom: 6 }}>Semester {sem}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {classes.map(c => (
                              <div key={c.assignment_id} style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, padding: '8px 12px', fontSize: '.8rem' }}>
                                <div style={{ fontWeight: 600, color: '#e5e7eb' }}>{c.subject} <span style={{ color: '#6b7280' }}>({c.code})</span></div>
                                <div style={{ color: '#9ca3af', marginTop: 3 }}>Sec {c.section} · {c.teacher}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </Card>
              ))
            }
          </>
        )}

        {/* ── SUBJECTS ── */}
        {tab === 'Subjects' && (
          <>
            <Card title="Create Subject" action={<Btn onClick={createSubject} disabled={loading}>+ Create</Btn>}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Input label="Subject Name" placeholder="Data Structures" value={subForm.name} onChange={e => setSubForm(p => ({...p, name: e.target.value}))} />
                <Input label="Code" placeholder="CS301" value={subForm.code} onChange={e => setSubForm(p => ({...p, code: e.target.value}))} />
                <Input label="Department" placeholder="Computer Science" value={subForm.department} onChange={e => setSubForm(p => ({...p, department: e.target.value}))} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
                  <Input label="Year" type="number" min={1} max={5} placeholder="2" value={subForm.year} onChange={e => setSubForm(p => ({...p, year: e.target.value}))} />
                  <Input label="Semester" type="number" min={1} max={10} placeholder="3" value={subForm.semester} onChange={e => setSubForm(p => ({...p, semester: e.target.value}))} />
                </div>
              </div>
            </Card>

            <Card title={`All Subjects (${subjects.length})`}>
              <Table
                cols={['ID', 'Name', 'Code', 'Department', 'Year', 'Sem']}
                rows={subjects.map(s => [s.id, s.name, s.code, s.department, s.year, s.semester])}
                empty="No subjects yet"
              />
            </Card>
          </>
        )}

        {/* ── ASSIGNMENTS ── */}
        {tab === 'Assignments' && (
          <>
            <Card title="Create Assignment" action={<Btn onClick={createAssignment} disabled={loading}>+ Assign</Btn>}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Select label="Teacher" value={asgForm.teacher_id} onChange={e => setAsgForm(p => ({...p, teacher_id: e.target.value}))}>
                  <option value="">Select teacher…</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name} ({t.department})</option>)}
                </Select>
                <Select label="Subject" value={asgForm.subject_id} onChange={e => setAsgForm(p => ({...p, subject_id: e.target.value}))}>
                  <option value="">Select subject…</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name} — {s.department} Yr{s.year} Sem{s.semester}</option>)}
                </Select>
                <Input label="Department" placeholder="Computer Science" value={asgForm.department} onChange={e => setAsgForm(p => ({...p, department: e.target.value}))} />
                <Input label="Section" placeholder="A" value={asgForm.section} onChange={e => setAsgForm(p => ({...p, section: e.target.value}))} />
                <Input label="Year" type="number" min={1} max={5} placeholder="2" value={asgForm.year} onChange={e => setAsgForm(p => ({...p, year: e.target.value}))} />
                <Input label="Semester" type="number" min={1} max={10} placeholder="3" value={asgForm.semester} onChange={e => setAsgForm(p => ({...p, semester: e.target.value}))} />
              </div>
            </Card>

            <Card title={`All Assignments (${assignments.length})`}>
              <Table
                cols={['ID', 'Subject', 'Code', 'Teacher', 'Department', 'Yr', 'Sem', 'Sec']}
                rows={assignments.map(a => [a.id, a.subject_name, a.subject_code, a.teacher_name, a.department, a.year, a.semester, a.section])}
                empty="No assignments yet"
              />
            </Card>
          </>
        )}

        {/* ── TEACHERS ── */}
        {tab === 'Teachers' && (
          <Card title={`All Teachers (${teachers.length})`}>
            <Table
              cols={['ID', 'Name', 'Email', 'Employee ID', 'Department']}
              rows={teachers.map(t => [t.id, t.full_name, t.email, t.employee_id || '—', t.department || '—'])}
              empty="No teachers registered yet"
            />
          </Card>
        )}

        {/* ── STUDENTS ── */}
        {tab === 'Students' && (
          <>
            <Card title="Filter Students">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <Input label="Department" placeholder="Computer Science" value={stuFilter.branch} onChange={e => setStuFilter(p => ({...p, branch: e.target.value}))} />
                </div>
                <div style={{ width: 80 }}>
                  <Input label="Year" type="number" placeholder="2" value={stuFilter.year} onChange={e => setStuFilter(p => ({...p, year: e.target.value}))} />
                </div>
                <div style={{ width: 90 }}>
                  <Input label="Semester" type="number" placeholder="3" value={stuFilter.semester} onChange={e => setStuFilter(p => ({...p, semester: e.target.value}))} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Btn onClick={() => loadStudents()}>Search</Btn>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Btn onClick={() => { setStuFilter({ branch: '', year: '', semester: '' }); loadStudents({ branch: '', year: '', semester: '' }); }} color="#374151">Reset</Btn>
                </div>
              </div>
            </Card>

            <Card title={`Students (${students.length})`}>
              <Table
                cols={['ID', 'Roll No', 'Name', 'Department', 'Year', 'Sem', 'Face Registered']}
                rows={students.map(s => [
                  s.id, s.roll_number, s.full_name, s.department, s.year, s.semester,
                  s.is_registered
                    ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ Yes</span>
                    : <span style={{ color: '#f59e0b' }}>✗ No</span>
                ])}
                empty="No students found"
              />
            </Card>
          </>
        )}

      </div>
    </div>
  );
}