import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000';

// ─── Challenge definitions with detection config ───────────────────────────
const CHALLENGES = [
  {
    id: 'center',
    instruction: 'Look straight at the camera',
    hint: 'Center your face in the oval',
    emoji: '😐',
    auto: false,
    color: '#818cf8',
  },
  {
    id: 'turn_left',
    instruction: 'Turn head to your LEFT',
    hint: 'Rotate until left ear faces camera',
    emoji: '👈',
    auto: true,
    color: '#34d399',
    detect: ({ yaw }) => yaw < -0.20,          // negative yaw = head turned left (mirrored feed)
    holdMs: 700,
  },
  {
    id: 'turn_right',
    instruction: 'Turn head to your RIGHT',
    hint: 'Rotate until right ear faces camera',
    emoji: '👉',
    auto: true,
    color: '#34d399',
    detect: ({ yaw }) => yaw > 0.20,           // positive yaw = head turned right
    holdMs: 700,
  },
  {
    id: 'smile',
    instruction: 'Give a big, natural smile',
    hint: 'Show your teeth!',
    emoji: '😊',
    auto: true,
    color: '#fbbf24',
    detect: ({ mouthRatio }) => mouthRatio > 0.38,
    holdMs: 600,
  },
  {
    id: 'blink',
    instruction: 'Blink both eyes naturally',
    hint: 'A slow, deliberate blink',
    emoji: '😉',
    auto: true,
    color: '#f472b6',
    detect: ({ eyeRatio }) => eyeRatio < 0.18,  // both eyes nearly closed
    holdMs: 200,
  },
];

// ─── Geometry helpers ───────────────────────────────────────────────────────

/** Eye Aspect Ratio — classic Soukupová & Čech formula */
function eyeAspectRatio(eyePts) {
  // eyePts: array of [x,y] for 6 eye landmarks
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const v1 = dist(eyePts[1], eyePts[5]);
  const v2 = dist(eyePts[2], eyePts[4]);
  const h  = dist(eyePts[0], eyePts[3]);
  return (v1 + v2) / (2.0 * h);
}

/** Mouth aspect ratio (vertical / horizontal) */
function mouthAspectRatio(pts) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const v = dist(pts[13], pts[19]); // inner top-bottom
  const h = dist(pts[0],  pts[6]);  // corners
  return v / h;
}

/** Estimate yaw from face bounding box asymmetry — works without 3D model */
function estimateYaw(landmarks) {
  // Use nose tip relative to face center
  const noseTip    = landmarks[1];  // index 1 in face_mesh simplified
  const leftEye    = landmarks[33];
  const rightEye   = landmarks[263];
  const faceCenter = [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2];
  const eyeWidth   = Math.abs(rightEye[0] - leftEye[0]);
  if (eyeWidth < 1) return 0;
  return (noseTip[0] - faceCenter[0]) / eyeWidth; // normalised offset
}

// ─── MediaPipe Face Mesh loader ─────────────────────────────────────────────
let _faceMesh = null;
let _faceMeshReady = false;
let _faceMeshCallbacks = [];

function loadFaceMesh(onReady) {
  if (_faceMeshReady) { onReady(_faceMesh); return; }
  _faceMeshCallbacks.push(onReady);
  if (_faceMesh) return; // already loading

  const script1 = document.createElement('script');
  script1.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
  const script2 = document.createElement('script');
  script2.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';

  script2.onload = () => {
    _faceMesh = new window.FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
    });
    _faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    _faceMesh.initialize().then(() => {
      _faceMeshReady = true;
      _faceMeshCallbacks.forEach(cb => cb(_faceMesh));
      _faceMeshCallbacks = [];
    });
  };

  document.head.appendChild(script1);
  document.head.appendChild(script2);
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function FaceRegistration({ token, user, onComplete }) {
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const overlayRef    = useRef(null);
  const streamRef     = useRef(null);
  const meshRef       = useRef(null);
  const rafRef        = useRef(null);
  const holdTimerRef  = useRef(null);
  const activeStepRef = useRef(0);
  const framesRef     = useRef([]);
  const holdingRef    = useRef(false);

  const [step, setStep]           = useState('intro');
  const [current, setCurrent]     = useState(0);
  const [frames, setFrames]       = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [error, setError]         = useState('');
  const [camError, setCamError]   = useState('');
  const [meshLoaded, setMeshLoaded] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0-100
  const [detectedPose, setDetectedPose] = useState(null); // live debug metrics
  const [flashGreen, setFlashGreen]     = useState(false);

  // sync refs
  useEffect(() => { activeStepRef.current = current; }, [current]);
  useEffect(() => { framesRef.current = frames; }, [frames]);

  // ── Camera ────────────────────────────────────────────────────────────────
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCamError('Camera access denied. Please allow camera access and reload.');
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }

  // ── Load MediaPipe when challenges start ──────────────────────────────────
  useEffect(() => {
    if (step !== 'challenges') return;
    startCamera();
    loadFaceMesh(mesh => {
      meshRef.current = mesh;
      setMeshLoaded(true);
    });
    return () => stopCamera();
  }, [step]);

  // ── Detection loop ────────────────────────────────────────────────────────
  const processFrame = useCallback(() => {
    if (!meshRef.current || !videoRef.current || !overlayRef.current) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const video = videoRef.current;
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    meshRef.current.send({ image: video })
      .then(() => {})
      .catch(() => {});
    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  useEffect(() => {
    if (!meshLoaded || step !== 'challenges') return;

    const challenge = CHALLENGES[activeStepRef.current];
    let holdStart = null;

    meshRef.current.onResults(results => {
      const lms = results.multiFaceLandmarks?.[0];
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!lms) {
        setDetectedPose(null);
        return;
      }

      // Convert to pixel coords
      const W = canvas.width, H = canvas.height;
      const pts = lms.map(l => [l.x * W, l.y * H]);

      // ── Draw minimal face outline ──
      ctx.save();
      ctx.strokeStyle = 'rgba(129,140,248,0.4)';
      ctx.lineWidth = 1;
      const faceContour = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
      ctx.beginPath();
      faceContour.forEach((idx, i) => {
        if (!pts[idx]) return;
        i === 0 ? ctx.moveTo(pts[idx][0], pts[idx][1]) : ctx.lineTo(pts[idx][0], pts[idx][1]);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // ── Metrics ──
      const LEFT_EYE_IDX  = [33,160,158,133,153,144];
      const RIGHT_EYE_IDX = [362,385,387,263,373,380];
      const MOUTH_IDX = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];

      const leftEAR  = eyeAspectRatio(LEFT_EYE_IDX.map(i => pts[i]));
      const rightEAR = eyeAspectRatio(RIGHT_EYE_IDX.map(i => pts[i]));
      const avgEAR   = (leftEAR + rightEAR) / 2;

      const mouthPts  = MOUTH_IDX.map(i => pts[i]);
      const mouthR    = mouthAspectRatio(mouthPts);

      const yaw = estimateYaw(pts);

      const metrics = { eyeRatio: avgEAR, mouthRatio: mouthR, yaw };
      setDetectedPose(metrics);

      // ── Only run auto-detection for auto challenges ──
      const idx = activeStepRef.current;
      const ch  = CHALLENGES[idx];
      if (!ch.auto) return;

      const detected = ch.detect(metrics);

      if (detected) {
        if (!holdStart) holdStart = Date.now();
        const elapsed  = Date.now() - holdStart;
        const progress = Math.min(100, (elapsed / ch.holdMs) * 100);
        setHoldProgress(progress);

        if (elapsed >= ch.holdMs && !holdingRef.current) {
          holdingRef.current = true;
          captureAndAdvance();
        }
      } else {
        holdStart = null;
        setHoldProgress(0);
        holdingRef.current = false;
      }
    });

    rafRef.current = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [meshLoaded, step, processFrame]);

  // reset hold state when challenge changes
  useEffect(() => {
    setHoldProgress(0);
    holdingRef.current = false;
  }, [current]);

  // ── Capture helpers ───────────────────────────────────────────────────────
  function captureFrameBlob() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return Promise.resolve(null);
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    // Mirror to match what user sees
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.restore();
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
  }

  async function captureAndAdvance() {
    setFlashGreen(true);
    setTimeout(() => setFlashGreen(false), 500);

    const blob = await captureFrameBlob();
    if (!blob) return;

    const nextFrames = [...framesRef.current, blob];
    framesRef.current = nextFrames;
    setFrames(nextFrames);

    const nextIdx = activeStepRef.current + 1;
    if (nextIdx < CHALLENGES.length) {
      activeStepRef.current = nextIdx;
      setCurrent(nextIdx);
    } else {
      cancelAnimationFrame(rafRef.current);
      setStep('uploading');
      stopCamera();
      uploadFrames(nextFrames);
    }
  }

  // Manual capture (center pose)
  async function handleManualCapture() {
    setCountdown(3);
    for (let c = 2; c >= 0; c--) {
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(c === 0 ? null : c);
    }
    const blob = await captureFrameBlob();
    if (!blob) { setError('Capture failed. Try again.'); return; }

    framesRef.current = [blob];
    setFrames([blob]);
    activeStepRef.current = 1;
    setCurrent(1);
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function uploadFrames(blobs) {
    setError('');
    try {
      const form = new FormData();
      blobs.forEach((blob, i) => form.append(`frame${i + 1}`, blob, `frame${i + 1}.jpg`));

      const res = await fetch(`${API}/registration/submit-frames`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data.detail)
          ? data.detail.map(d => d.msg).join(', ')
          : data.detail;
        throw new Error(msg || 'Backend processing failed.');
      }
      setStep('done');
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  }

  function restart() {
    setFrames([]); framesRef.current = [];
    setCurrent(0); activeStepRef.current = 0;
    setError(''); setHoldProgress(0);
    holdingRef.current = false;
    setStep('challenges');
  }

  // ── Canvas resize to match video ──────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !overlayRef.current) return;
    const resize = () => {
      const v = videoRef.current;
      if (!v) return;
      overlayRef.current.width  = v.videoWidth  || 640;
      overlayRef.current.height = v.videoHeight || 480;
    };
    videoRef.current?.addEventListener('loadedmetadata', resize);
    return () => videoRef.current?.removeEventListener('loadedmetadata', resize);
  }, [step]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const challenge = CHALLENGES[current] || CHALLENGES[0];
  const accent = challenge.color;

  const s = {
    page: {
      minHeight: '100vh',
      background: '#070711',
      color: '#e2e2f0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: "'Sora', 'DM Sans', sans-serif",
    },
    card: {
      width: '100%', maxWidth: 540,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 20,
      padding: '2rem',
      backdropFilter: 'blur(12px)',
    },
    btn: (bg = accent) => ({
      background: bg,
      color: bg === '#f5f5ff' ? '#111' : '#fff',
      border: 'none', borderRadius: 10,
      padding: '13px 28px',
      fontSize: 14, fontWeight: 600,
      cursor: 'pointer',
      width: '100%',
      letterSpacing: '.02em',
      transition: 'opacity .2s',
    }),
  };

  return (
    <div style={s.page}>
      <div style={s.card}>

        {/* ── INTRO ──────────────────────────────────────────────── */}
        {step === 'intro' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '1.8rem' }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>🪪</div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-.01em' }}>Face Enrollment</h1>
              <p style={{ margin: '8px 0 0', color: '#7878a0', fontSize: '.85rem' }}>
                Captures 5 poses automatically — takes about 20 seconds.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.6rem' }}>
              {CHALLENGES.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: c.color + '22', color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: '.88rem', fontWeight: 500 }}>{c.instruction}</div>
                  <div>{c.emoji}</div>
                  {c.auto && <span style={{ fontSize: '.7rem', background: '#34d39922', color: '#34d399', padding: '2px 7px', borderRadius: 5, fontWeight: 600 }}>AUTO</span>}
                </div>
              ))}
            </div>

            <button style={s.btn('#818cf8')} onClick={() => setStep('challenges')}>
              Begin Enrollment →
            </button>
          </>
        )}

        {/* ── CHALLENGES ─────────────────────────────────────────── */}
        {step === 'challenges' && (
          <>
            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 6, marginBottom: '1.2rem' }}>
              {CHALLENGES.map((c, i) => (
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: i < frames.length ? '#34d399' : i === current ? accent : 'rgba(255,255,255,0.08)', transition: 'background .3s' }} />
              ))}
            </div>

            {/* Instruction */}
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{ fontSize: 32 }}>{challenge.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: 6, color: accent }}>
                {challenge.instruction}
              </div>
              <div style={{ fontSize: '.8rem', color: '#7878a0', marginTop: 4 }}>
                {challenge.hint}
              </div>
            </div>

            {/* Camera viewport */}
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '4/3', border: `2px solid ${flashGreen ? '#34d399' : accent}44`, transition: 'border-color .3s', marginBottom: '1rem' }}>

              <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }} />

              {/* MediaPipe overlay (NOT mirrored — we draw mirrored coords) */}
              <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

              {/* Oval guide */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 640 480" preserveAspectRatio="none">
                <ellipse cx="320" cy="230" rx="150" ry="190"
                  fill="none"
                  stroke={flashGreen ? '#34d399' : accent}
                  strokeWidth="2"
                  strokeDasharray={challenge.auto ? '8 5' : 'none'}
                  opacity="0.5"
                />
              </svg>

              {/* Flash overlay on capture */}
              {flashGreen && (
                <div style={{ position: 'absolute', inset: 0, background: '#34d39930', pointerEvents: 'none', borderRadius: 12 }} />
              )}

              {/* Countdown */}
              {countdown !== null && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 96, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{countdown}</div>
                </div>
              )}

              {/* Loading mediapipe */}
              {!meshLoaded && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(7,7,17,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, border: '3px solid #818cf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <div style={{ fontSize: '.85rem', color: '#7878a0' }}>Loading face detection…</div>
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}

              {/* Captured count */}
              <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 5, background: 'rgba(0,0,0,0.55)', padding: '5px 10px', borderRadius: 20 }}>
                {CHALLENGES.map((_, i) => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i < frames.length ? '#34d399' : 'rgba(255,255,255,0.15)' }} />
                ))}
              </div>

              {/* Live metrics debug (small) */}
              {detectedPose && (
                <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '5px 9px', fontSize: '10px', color: '#7878a0', lineHeight: 1.7, fontFamily: 'monospace' }}>
                  <div>yaw&nbsp;&nbsp;{detectedPose.yaw.toFixed(3)}</div>
                  <div>eye&nbsp;&nbsp;{detectedPose.eyeRatio.toFixed(3)}</div>
                  <div>mouth {detectedPose.mouthRatio.toFixed(3)}</div>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Hold progress bar (auto challenges) */}
            {challenge.auto && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', color: '#7878a0', marginBottom: 5 }}>
                  <span>Pose confidence</span>
                  <span style={{ color: holdProgress > 50 ? '#34d399' : '#7878a0' }}>{Math.round(holdProgress)}%</span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${holdProgress}%`, background: accent, borderRadius: 3, transition: 'width .1s linear' }} />
                </div>
              </div>
            )}

            {camError && <div style={{ color: '#f87171', fontSize: '.83rem', marginBottom: 10, textAlign: 'center' }}>{camError}</div>}
            {error    && <div style={{ color: '#f87171', fontSize: '.83rem', marginBottom: 10, background: '#f8717115', padding: '9px 12px', borderRadius: 8 }}>{error}</div>}

            {/* Action button — only for manual (center) step */}
            {!challenge.auto ? (
              <button
                style={s.btn()}
                onClick={handleManualCapture}
                disabled={countdown !== null || !!camError || !meshLoaded}
              >
                {countdown !== null ? `Capturing in ${countdown}…` : '📸 Capture Base Frame'}
              </button>
            ) : (
              <div style={{ textAlign: 'center', padding: '11px', background: `${accent}10`, borderRadius: 10, border: `1px solid ${accent}25`, fontSize: '.85rem', color: accent, fontWeight: 500 }}>
                <span style={{ marginRight: 8 }}>●</span>
                {holdProgress > 20
                  ? `Hold it… ${Math.round(holdProgress)}%`
                  : 'Detecting pose — follow the instruction above'}
              </div>
            )}
          </>
        )}

        {/* ── UPLOADING ──────────────────────────────────────────── */}
        {step === 'uploading' && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ marginBottom: 20 }}>
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.8" style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <circle cx="12" cy="12" r="9" strokeDasharray="42 20" />
              </svg>
            </div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px' }}>Processing Biometrics…</h2>
            <p style={{ color: '#7878a0', fontSize: '.85rem', margin: 0 }}>
              Building facial embeddings · Encrypting vectors
            </p>
          </div>
        )}

        {/* ── DONE ───────────────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#34d39920', border: '2px solid #34d39955', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 28 }}>✓</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#34d399', margin: '0 0 8px' }}>Enrollment Complete</h2>
            <p style={{ color: '#7878a0', fontSize: '.88rem', margin: '0 0 24px' }}>
              5 pose frames captured and securely stored.
            </p>
            <button style={s.btn('#34d399')} onClick={onComplete}>
              Continue to Dashboard
            </button>
          </div>
        )}

        {/* ── ERROR ──────────────────────────────────────────────── */}
        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>❌</div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f87171', margin: '0 0 10px' }}>Upload Failed</h2>
            <pre style={{ color: '#7878a0', fontSize: '.82rem', background: 'rgba(0,0,0,0.25)', padding: 12, borderRadius: 8, textAlign: 'left', whiteSpace: 'pre-wrap', margin: '0 0 22px', fontFamily: 'monospace' }}>{error}</pre>
            <button style={s.btn('#818cf8')} onClick={restart}>Re-attempt Enrollment</button>
          </div>
        )}

      </div>
    </div>
  );
}