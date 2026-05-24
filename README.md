<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartAttend — Demo Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0b0d11;
    --surface:  #13161c;
    --border:   #1e2230;
    --text:     #e8eaf0;
    --muted:    #5a6080;
    --accent:   #4f7cff;
    --green:    #22d97a;
    --amber:    #f5a623;
    --pink:     #ff4f7c;
  }

  html { scroll-behavior: smooth; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Instrument Sans', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* Grid bg */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(79,124,255,.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(79,124,255,.04) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
    z-index: 0;
  }

  .wrap {
    position: relative;
    z-index: 1;
    max-width: 860px;
    margin: 0 auto;
    padding: 64px 24px 96px;
  }

  /* Header */
  .header {
    text-align: center;
    margin-bottom: 64px;
    animation: fadeUp .6s ease both;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: rgba(79,124,255,.1);
    border: 1px solid rgba(79,124,255,.25);
    color: var(--accent);
    font-family: 'DM Mono', monospace;
    font-size: .72rem;
    padding: 5px 14px;
    border-radius: 20px;
    margin-bottom: 22px;
    letter-spacing: .08em;
  }

  .badge::before {
    content: '';
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: blink 1.8s infinite;
  }

  h1 {
    font-family: 'Syne', sans-serif;
    font-size: clamp(2.2rem, 6vw, 3.4rem);
    font-weight: 800;
    letter-spacing: -.03em;
    line-height: 1.1;
    margin-bottom: 14px;
    background: linear-gradient(135deg, #e8eaf0 30%, #4f7cff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: 1rem;
    color: var(--muted);
    max-width: 480px;
    margin: 0 auto;
    line-height: 1.6;
  }

  /* Section label */
  .section-label {
    font-family: 'DM Mono', monospace;
    font-size: .68rem;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* Role cards */
  .roles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 48px;
  }

  .role-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
    position: relative;
    overflow: hidden;
    animation: fadeUp .5s ease both;
    transition: border-color .2s, transform .2s;
  }
  .role-card:hover {
    transform: translateY(-2px);
    border-color: var(--card-accent, var(--accent));
  }
  .role-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--card-accent, var(--accent));
    opacity: .7;
  }

  .role-card.student  { --card-accent: var(--green); animation-delay: .1s; }
  .role-card.teacher  { --card-accent: var(--accent); animation-delay: .2s; }
  .role-card.admin    { --card-accent: var(--pink); animation-delay: .3s; }

  .role-icon {
    width: 40px; height: 40px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    margin-bottom: 16px;
  }
  .student .role-icon  { background: rgba(34,217,122,.1); }
  .teacher .role-icon  { background: rgba(79,124,255,.1); }
  .admin   .role-icon  { background: rgba(255,79,124,.1); }

  .role-title {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 1rem;
    margin-bottom: 16px;
    color: var(--card-accent, var(--text));
  }

  .cred-row {
    margin-bottom: 10px;
  }
  .cred-label {
    font-size: .68rem;
    color: var(--muted);
    font-family: 'DM Mono', monospace;
    letter-spacing: .06em;
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .cred-value {
    background: rgba(255,255,255,.04);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 7px 12px;
    font-family: 'DM Mono', monospace;
    font-size: .82rem;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    transition: border-color .15s, background .15s;
    user-select: all;
  }
  .cred-value:hover {
    border-color: var(--card-accent, var(--accent));
    background: rgba(255,255,255,.07);
  }
  .copy-hint {
    font-size: .6rem;
    color: var(--muted);
    opacity: 0;
    transition: opacity .15s;
    white-space: nowrap;
  }
  .cred-value:hover .copy-hint { opacity: 1; }

  /* Flow section */
  .flow {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 48px;
    animation: fadeUp .5s ease .3s both;
  }

  .flow-title {
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 1rem;
    margin-bottom: 20px;
  }

  .flow-steps {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .flow-step {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 12px 0;
    position: relative;
  }
  .flow-step:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 15px;
    top: 36px;
    bottom: -12px;
    width: 1px;
    background: var(--border);
  }

  .step-num {
    width: 32px; height: 32px;
    border-radius: 50%;
    background: rgba(79,124,255,.12);
    border: 1px solid rgba(79,124,255,.25);
    color: var(--accent);
    font-family: 'DM Mono', monospace;
    font-size: .78rem;
    font-weight: 500;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }

  .step-body { padding-top: 5px; }
  .step-title { font-weight: 600; font-size: .9rem; margin-bottom: 3px; }
  .step-desc  { font-size: .8rem; color: var(--muted); line-height: 1.5; }

  .step-role-tag {
    display: inline-block;
    font-size: .65rem;
    font-family: 'DM Mono', monospace;
    padding: 2px 7px;
    border-radius: 4px;
    margin-right: 5px;
    font-weight: 500;
  }
  .tag-admin   { background: rgba(255,79,124,.1);  color: var(--pink);  }
  .tag-teacher { background: rgba(79,124,255,.1);  color: var(--accent); }
  .tag-student { background: rgba(34,217,122,.1);  color: var(--green); }

  /* URLs section */
  .urls {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 48px;
    animation: fadeUp .5s ease .4s both;
  }

  .url-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .url-row:last-child { border-bottom: none; }

  .url-method {
    font-family: 'DM Mono', monospace;
    font-size: .65rem;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(79,124,255,.1);
    color: var(--accent);
    flex-shrink: 0;
    width: 38px;
    text-align: center;
  }

  .url-path {
    font-family: 'DM Mono', monospace;
    font-size: .82rem;
    color: var(--text);
    flex: 1;
  }

  .url-desc {
    font-size: .78rem;
    color: var(--muted);
    text-align: right;
    flex-shrink: 0;
  }

  /* Footer */
  .footer {
    text-align: center;
    font-size: .75rem;
    color: var(--muted);
    font-family: 'DM Mono', monospace;
    padding-top: 32px;
    border-top: 1px solid var(--border);
    animation: fadeUp .5s ease .5s both;
  }

  .footer a {
    color: var(--accent);
    text-decoration: none;
  }

  /* Animations */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes blink {
    0%,100% { opacity: 1; }
    50%      { opacity: .3; }
  }

  /* Copied toast */
  .toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--green);
    color: #000;
    font-family: 'DM Mono', monospace;
    font-size: .78rem;
    font-weight: 500;
    padding: 8px 20px;
    border-radius: 20px;
    opacity: 0;
    transition: all .25s ease;
    pointer-events: none;
    z-index: 999;
    white-space: nowrap;
  }
  .toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
</style>
</head>
<body>

<div class="wrap">

  <!-- Header -->
  <div class="header">
    <div class="badge">Demo Credentials</div>
    <h1>SmartAttend</h1>
    <p class="subtitle">Face-recognition attendance system. Use the credentials below to test each role.</p>
  </div>

  <!-- Role Cards -->
  <div class="section-label">Test Accounts</div>
  <div class="roles">

    <div class="role-card student">
      <div class="role-icon">🎓</div>
      <div class="role-title">Student</div>
      <div class="cred-row">
        <div class="cred-label">Email</div>
        <div class="cred-value" onclick="copy(this, 'student@college.com')">
          student@college.com
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
      <div class="cred-row">
        <div class="cred-label">Password</div>
        <div class="cred-value" onclick="copy(this, 'test1234567')">
          test1234567
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
    </div>

    <div class="role-card teacher">
      <div class="role-icon">📖</div>
      <div class="role-title">Teacher</div>
      <div class="cred-row">
        <div class="cred-label">Email</div>
        <div class="cred-value" onclick="copy(this, 'teacher@college.com')">
          teacher@college.com
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
      <div class="cred-row">
        <div class="cred-label">Password</div>
        <div class="cred-value" onclick="copy(this, 'teach1234')">
          teach1234
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
    </div>

    <div class="role-card admin">
      <div class="role-icon">⚙️</div>
      <div class="role-title">Admin</div>
      <div class="cred-row">
        <div class="cred-label">Email</div>
        <div class="cred-value" onclick="copy(this, 'admin@college.edu')">
          admin@college.edu
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
      <div class="cred-row">
        <div class="cred-label">Password</div>
        <div class="cred-value" onclick="copy(this, 'admin123')">
          admin123
          <span class="copy-hint">click to copy</span>
        </div>
      </div>
    </div>

  </div>

  <!-- Test Flow -->
  <div class="section-label">How to Test</div>
  <div class="flow">
    <div class="flow-steps">

      <div class="flow-step">
        <div class="step-num">1</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-admin">Admin</span> Create a Subject</div>
          <div class="step-desc">Login as admin → Subjects tab → fill name, code, department, year, semester → Create.</div>
        </div>
      </div>

      <div class="flow-step">
        <div class="step-num">2</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-admin">Admin</span> Assign Teacher</div>
          <div class="step-desc">Assignments tab → pick teacher + subject + department + year + semester + section → Assign. Students matching that dept/year/sem auto-enroll.</div>
        </div>
      </div>

      <div class="flow-step">
        <div class="step-num">3</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-student">Student</span> Register Face</div>
          <div class="step-desc">Login as student → complete the 5-pose biometric enrollment (center, left, right, smile, blink).</div>
        </div>
      </div>

      <div class="flow-step">
        <div class="step-num">4</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-teacher">Teacher</span> Start Session</div>
          <div class="step-desc">Login as teacher → select class from sidebar → choose duration → Start Session.</div>
        </div>
      </div>

      <div class="flow-step">
        <div class="step-num">5</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-student">Student</span> Mark Attendance</div>
          <div class="step-desc">Student dashboard shows the live session → tap Mark Attendance → face scan verifies identity.</div>
        </div>
      </div>

      <div class="flow-step">
        <div class="step-num">6</div>
        <div class="step-body">
          <div class="step-title"><span class="step-role-tag tag-teacher">Teacher</span> End Session & View Report</div>
          <div class="step-desc">Click End Session → switch to Full Report tab to see attendance % per student.</div>
        </div>
      </div>

    </div>
  </div>

  <!-- API Endpoints -->
  <div class="section-label">Key API Endpoints</div>
  <div class="urls">
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/auth/login</div>
      <div class="url-desc">Login — returns JWT token</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/auth/register/student</div>
      <div class="url-desc">Register student</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/auth/register/teacher</div>
      <div class="url-desc">Register teacher</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/admin/subjects</div>
      <div class="url-desc">Create subject</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/admin/assignments</div>
      <div class="url-desc">Assign teacher to class</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/attendance/session/open</div>
      <div class="url-desc">Teacher opens session</div>
    </div>
    <div class="url-row">
      <div class="url-method">GET</div>
      <div class="url-path">/attendance/session/active</div>
      <div class="url-desc">Student gets live sessions</div>
    </div>
    <div class="url-row">
      <div class="url-method">POST</div>
      <div class="url-path">/attendance/mark</div>
      <div class="url-desc">Student marks attendance</div>
    </div>
    <div class="url-row">
      <div class="url-method">GET</div>
      <div class="url-path">/attendance/my</div>
      <div class="url-desc">Student attendance summary</div>
    </div>
    <div class="url-row">
      <div class="url-method">GET</div>
      <div class="url-path">/admin/structure</div>
      <div class="url-desc">Full academic structure</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    SmartAttend · Face Recognition Attendance System · Built with FastAPI + React
    <br><br>
    Backend: <a href="https://smart-attendence-using-facerecognition.onrender.com">onrender.com</a>
    &nbsp;·&nbsp;
    All credentials are for demo purposes only
  </div>

</div>

<div class="toast" id="toast">Copied!</div>

<script>
  function copy(el, text) {
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.getElementById('toast');
      toast.textContent = `Copied: ${text}`;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    });
  }
</script>

</body>
</html>
