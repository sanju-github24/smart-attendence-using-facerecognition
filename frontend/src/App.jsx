import { useState, useEffect, useCallback } from 'react'
import './index.css'
import LoginScreen      from './components/LoginScreen'
import TeacherDashboard from './components/TeacherDashboard'
import StudentDashboard from './components/StudentDashboard'
import AdminDashboard   from './pages/AdminDashboard'
import { getMySubjects } from './api'

const API             = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const SESSION_TIMEOUT = 30 * 60 * 1000  // 30 minutes in ms

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      const s = localStorage.getItem('smartattend_session')
      if (!s) return null
      const parsed = JSON.parse(s)
      // Check if session has expired on load
      if (parsed.expires_at && Date.now() > parsed.expires_at) {
        localStorage.removeItem('smartattend_session')
        return null
      }
      return parsed
    } catch { return null }
  })

  // ── Session timeout watchdog ──────────────────────────────────────────
  useEffect(() => {
    if (!session) return

    const remaining = session.expires_at ? session.expires_at - Date.now() : SESSION_TIMEOUT
    if (remaining <= 0) { handleLogout(true); return }

    const timer = setTimeout(() => handleLogout(true), remaining)
    return () => clearTimeout(timer)
  }, [session?.expires_at])

  // ── Refresh expires_at on user activity ───────────────────────────────
  const refreshExpiry = useCallback(() => {
    setSession(prev => {
      if (!prev) return prev
      const updated = { ...prev, expires_at: Date.now() + SESSION_TIMEOUT }
      localStorage.setItem('smartattend_session', JSON.stringify(updated))
      return updated
    })
  }, [])

  useEffect(() => {
    if (!session) return
    const events = ['click', 'keydown', 'mousemove', 'touchstart']
    // Throttle: only refresh if more than 1 min has passed since last activity
    let lastRefresh = Date.now()
    const handler = () => {
      if (Date.now() - lastRefresh > 60_000) {
        lastRefresh = Date.now()
        refreshExpiry()
      }
    }
    events.forEach(e => window.addEventListener(e, handler, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, handler))
  }, [session, refreshExpiry])

  async function handleLogin(data) {
    if (data.role === 'teacher') {
      try {
        const subjects = await getMySubjects(data.access_token)
        data.subjects = Array.isArray(subjects) ? subjects : []
      } catch { data.subjects = [] }
    }
    // Attach expiry timestamp — does NOT affect face registration state
    data.expires_at = Date.now() + SESSION_TIMEOUT
    localStorage.setItem('smartattend_session', JSON.stringify(data))
    setSession(data)
  }

  function handleLogout(expired = false) {
    localStorage.removeItem('smartattend_session')
    setSession(null)
    if (expired) {
      // Show a brief message — store it so LoginScreen can display it
      sessionStorage.setItem('logout_reason', 'Session expired. Please sign in again.')
    }
  }

  if (!session) return <LoginScreen onLogin={handleLogin} />

  if (session.role === 'admin')
    return <AdminDashboard token={session.access_token} onLogout={() => handleLogout()} />

  if (session.role === 'teacher')
    return (
      <TeacherDashboard
        user={session}
        token={session.access_token}
        subjects={session.subjects || []}
        onLogout={() => handleLogout()}
      />
    )

  return (
    <StudentDashboard
      user={session}
      token={session.access_token}
      onLogout={() => handleLogout()}
    />
  )
}