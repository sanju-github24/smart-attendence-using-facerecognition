import { useState } from 'react'
import { login, registerStudent, registerTeacher } from '../api'

export default function LoginScreen({ onLogin }) {
  const [mode, setMode]       = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  // Login fields — accepts email OR roll number
  const [identifier, setIdentifier] = useState('')
  const [pass, setPass]             = useState('')

  // Shared signup
  const [sEmail, setSEmail]       = useState('')
  const [sPass, setSPass]         = useState('')
  const [sConfirm, setSConfirm]   = useState('')
  const [sFullName, setSFullName] = useState('')
  const [sPhone, setSPhone]       = useState('')

  // Student-only
  const [sRoll, setSRoll]       = useState('')
  const [sDept, setSDept]       = useState('')
  const [sYear, setSYear]       = useState('1')
  const [sSem, setSSem]         = useState('1')

  // Teacher-only
  const [sEmpId, setSEmpId] = useState('')
  const [sTDept, setSTDept] = useState('')

  function reset() {
    setError(''); setSuccess('')
    setIdentifier(''); setPass('')
    setSEmail(''); setSPass(''); setSConfirm(''); setSFullName(''); setSPhone('')
    setSRoll(''); setSDept(''); setSYear('1'); setSSem('1')
    setSEmpId(''); setSTDept('')
  }

  function switchMode(m) { reset(); setMode(m) }

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await login(identifier, pass)
      onLogin(data)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleStudentSignup(e) {
    e.preventDefault()
    if (sPass !== sConfirm) { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    try {
      await registerStudent({
        email: sEmail, full_name: sFullName, phone: sPhone,
        password: sPass, roll_number: sRoll,
        department: sDept, year: parseInt(sYear), semester: parseInt(sSem),
      })
      setSuccess('Account created! You can now sign in.')
      switchMode('login')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleTeacherSignup(e) {
    e.preventDefault()
    if (sPass !== sConfirm) { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    try {
      await registerTeacher({
        email: sEmail, full_name: sFullName, phone: sPhone,
        password: sPass, employee_id: sEmpId, department: sTDept,
      })
      setSuccess('Teacher account created! Please sign in.')
      switchMode('login')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const row = (label, input) => (
    <div>
      <label style={{ fontSize: '.8rem', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{label}</label>
      {input}
    </div>
  )

  const semOptions = (yearVal) => {
    const y = parseInt(yearVal)
    const sems = []
    for (let s = (y - 1) * 2 + 1; s <= y * 2; s++) sems.push(s)
    return sems
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* Background glows */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 520, height: 520, background: 'radial-gradient(circle, rgba(129,140,248,.08) 0%, transparent 70%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', bottom: '20%', right: '25%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(110,231,183,.05) 0%, transparent 70%)', borderRadius: '50%' }} />
      </div>

      <div className="fade-in" style={{ width: '100%', maxWidth: mode === 'login' ? 420 : 500 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, background: 'linear-gradient(135deg, var(--accent2), var(--accent))', borderRadius: 16, marginBottom: 14, boxShadow: '0 8px 32px rgba(129,140,248,.3)' }}>
            <span style={{ fontSize: 26 }}>🎓</span>
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 600, letterSpacing: '-.02em' }}>SmartAttend</h1>
          <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: '.88rem' }}>AI-powered attendance · v2</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, marginBottom: 20, gap: 4 }}>
          {[
            { key: 'login',          label: 'Sign In' },
            { key: 'signup-student', label: 'Student' },
            { key: 'signup-teacher', label: 'Teacher' },
          ].map(t => (
            <button key={t.key} onClick={() => switchMode(t.key)}
              style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', fontSize: '.8rem', fontWeight: 500, cursor: 'pointer', background: mode === t.key ? 'var(--surface2)' : 'transparent', color: mode === t.key ? 'var(--text)' : 'var(--muted)', transition: 'all .18s' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="card" style={{ boxShadow: 'var(--shadow)' }}>
          {error && (
            <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: '.875rem' }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ background: 'rgba(110,231,183,.1)', border: '1px solid rgba(110,231,183,.3)', color: 'var(--accent)', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: '.875rem' }}>
              {success}
            </div>
          )}

          {/* ── LOGIN ── */}
          {mode === 'login' && (
            <>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 20 }}>Welcome back</h2>
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {row('Email or Roll Number',
                  <input type="text" placeholder="you@college.edu or CS2021001" value={identifier} onChange={e => setIdentifier(e.target.value)} required />
                )}
                {row('Password',
                  <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} required />
                )}
                <button type="submit" className="btn-primary" style={{ marginTop: 4, width: '100%', padding: '13px', fontSize: '1rem' }} disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in →'}
                </button>
              </form>
              <p style={{ marginTop: 18, fontSize: '.8rem', color: 'var(--muted)', textAlign: 'center' }}>
                No account?&nbsp;
                <span onClick={() => switchMode('signup-student')} style={{ color: 'var(--accent2)', cursor: 'pointer', textDecoration: 'underline' }}>Sign up</span>
              </p>
            </>
          )}

          {/* ── STUDENT SIGNUP ── */}
          {mode === 'signup-student' && (
            <>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 20 }}>Create Student Account</h2>
              <form onSubmit={handleStudentSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Full name', <input type="text" placeholder="Arjun Sharma" value={sFullName} onChange={e => setSFullName(e.target.value)} required />)}
                  {row('Phone', <input type="tel" placeholder="9876543210" value={sPhone} onChange={e => setSPhone(e.target.value)} required />)}
                </div>
                {row('College email', <input type="email" placeholder="student@college.edu" value={sEmail} onChange={e => setSEmail(e.target.value)} required />)}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Roll number', <input type="text" placeholder="CS2021001" value={sRoll} onChange={e => setSRoll(e.target.value)} required />)}
                  {row('Department', <input type="text" placeholder="Computer Science" value={sDept} onChange={e => setSDept(e.target.value)} required />)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Year', (
                    <select value={sYear} onChange={e => { setSYear(e.target.value); setSSem(String((parseInt(e.target.value) - 1) * 2 + 1)) }}>
                      <option value="1">1st Year</option>
                      <option value="2">2nd Year</option>
                      <option value="3">3rd Year</option>
                      <option value="4">4th Year</option>
                    </select>
                  ))}
                  {row('Semester', (
                    <select value={sSem} onChange={e => setSSem(e.target.value)}>
                      {semOptions(sYear).map(s => (
                        <option key={s} value={s}>Semester {s}</option>
                      ))}
                    </select>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Password', <input type="password" placeholder="Min 8 chars" value={sPass} onChange={e => setSPass(e.target.value)} required minLength={8} />)}
                  {row('Confirm password', <input type="password" placeholder="Repeat" value={sConfirm} onChange={e => setSConfirm(e.target.value)} required />)}
                </div>
                <div style={{ background: 'rgba(129,140,248,.06)', border: '1px solid rgba(129,140,248,.15)', borderRadius: 10, padding: '10px 14px', fontSize: '.8rem', color: 'var(--muted)' }}>
                  ℹ️ You'll be auto-enrolled into all classes matching your department, year and semester.
                </div>
                <button type="submit" className="btn-accent" style={{ marginTop: 4, width: '100%', padding: '13px', fontSize: '1rem' }} disabled={loading}>
                  {loading ? 'Creating account…' : 'Create Student Account →'}
                </button>
              </form>
              <p style={{ marginTop: 16, fontSize: '.8rem', color: 'var(--muted)', textAlign: 'center' }}>
                Already have an account?&nbsp;
                <span onClick={() => switchMode('login')} style={{ color: 'var(--accent2)', cursor: 'pointer', textDecoration: 'underline' }}>Sign in</span>
              </p>
            </>
          )}

          {/* ── TEACHER SIGNUP ── */}
          {mode === 'signup-teacher' && (
            <>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 20 }}>Create Teacher Account</h2>
              <form onSubmit={handleTeacherSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Full name', <input type="text" placeholder="Dr. Priya Kumar" value={sFullName} onChange={e => setSFullName(e.target.value)} required />)}
                  {row('Phone', <input type="tel" placeholder="9876500000" value={sPhone} onChange={e => setSPhone(e.target.value)} required />)}
                </div>
                {row('College email', <input type="email" placeholder="teacher@college.edu" value={sEmail} onChange={e => setSEmail(e.target.value)} required />)}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Employee ID', <input type="text" placeholder="TCH001" value={sEmpId} onChange={e => setSEmpId(e.target.value)} required />)}
                  {row('Department', <input type="text" placeholder="Computer Science" value={sTDept} onChange={e => setSTDept(e.target.value)} required />)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {row('Password', <input type="password" placeholder="Min 8 chars" value={sPass} onChange={e => setSPass(e.target.value)} required minLength={8} />)}
                  {row('Confirm password', <input type="password" placeholder="Repeat" value={sConfirm} onChange={e => setSConfirm(e.target.value)} required />)}
                </div>
                <button type="submit" className="btn-primary" style={{ marginTop: 4, width: '100%', padding: '13px', fontSize: '1rem' }} disabled={loading}>
                  {loading ? 'Creating account…' : 'Create Teacher Account →'}
                </button>
              </form>
              <p style={{ marginTop: 16, fontSize: '.8rem', color: 'var(--muted)', textAlign: 'center' }}>
                Already have an account?&nbsp;
                <span onClick={() => switchMode('login')} style={{ color: 'var(--accent2)', cursor: 'pointer', textDecoration: 'underline' }}>Sign in</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
