/**
 * Synthesized audio for the race replay.
 * All sounds use the Web Audio API with oscillators and noise buffers.
 * Zero asset downloads.
 *
 * AudioContext is created lazily on the first call to resumeAudio(),
 * which must be called from within a user gesture handler (tap, click).
 * If AudioContext is unavailable or creation fails, every exported function
 * becomes a silent no-op so the caller never needs to check.
 *
 * Mute state is persisted to localStorage so it survives page reloads.
 */

const STORAGE_KEY = 'lada_muted';

// Module-level state — shared across races (DemoRace loops reuse same context)
let _ctx    = null;   // AudioContext
let _master = null;   // GainNode — master volume (0 when muted, 1 when live)

// Engine oscillator — one per active race, recreated on engineStart()
let _engineOsc    = null;
let _engineGain   = null;
let _engineFilter = null;

// Mute state is readable before AudioContext exists (for button initial render)
let _muted = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
})();

// ── Public state ───────────────────────────────────────────────────────────────

export function isMuted() { return _muted; }

export function muteToggle() {
  _muted = !_muted;
  try { localStorage.setItem(STORAGE_KEY, _muted ? '1' : '0'); } catch (_) {}
  if (_master && _ctx) {
    _master.gain.setTargetAtTime(_muted ? 0 : 1, _ctx.currentTime, 0.05);
  }
  return _muted;
}

// ── Initialization ─────────────────────────────────────────────────────────────

/**
 * Call this from within a user gesture (tap, click) to initialize the
 * AudioContext. Safe to call multiple times — idempotent after first success.
 * Never throws; logs a warning and stays silent if unavailable.
 */
export function resumeAudio() {
  if (!_ctx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _ctx    = new AC();
      _master = _ctx.createGain();
      _master.gain.value = _muted ? 0 : 1;
      _master.connect(_ctx.destination);
    } catch (e) {
      console.warn('[audio] AudioContext init failed:', e);
      _ctx = null;
      return;
    }
  }
  if (_ctx.state === 'suspended') {
    _ctx.resume().catch(() => {});
  }
}

// ── Engine sound ───────────────────────────────────────────────────────────────
// Continuous sawtooth oscillator, low-pass filtered to read as engine rumble.
// Pitch maps speed → frequency; gain ramps to zero during countdown and end.

export function engineStart() {
  if (!_ctx) return;
  engineStop();

  _engineOsc    = _ctx.createOscillator();
  _engineFilter = _ctx.createBiquadFilter();
  _engineGain   = _ctx.createGain();

  _engineFilter.type            = 'lowpass';
  _engineFilter.frequency.value = 480;
  _engineFilter.Q.value         = 1.4;

  _engineOsc.type            = 'sawtooth';
  _engineOsc.frequency.value = 80;

  _engineGain.gain.value = 0;   // start silent; engineUpdate ramps in

  _engineOsc.connect(_engineFilter);
  _engineFilter.connect(_engineGain);
  _engineGain.connect(_master);
  _engineOsc.start();
}

/**
 * Call every render frame. speed = interpolated sim speed of followed car.
 * racing = true only while the race is live (not during countdown or end).
 */
export function engineUpdate(speed, racing) {
  if (!_ctx || !_engineOsc) return;
  const now         = _ctx.currentTime;
  const targetFreq  = 80 + speed * 16;          // 80 Hz idle → ~180 Hz full speed
  const targetGain  = racing && speed > 0.5 ? 0.07 : 0;
  const gainTau     = racing ? 0.10 : 0.30;     // slow fade-out at end
  _engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.05);
  _engineGain.gain.setTargetAtTime(targetGain, now, gainTau);
}

export function engineStop() {
  if (_engineOsc) {
    try { _engineOsc.stop(); } catch (_) {}
    _engineOsc    = null;
    _engineGain   = null;
    _engineFilter = null;
  }
}

// ── Pothole hit (thud) ─────────────────────────────────────────────────────────
// Short burst of low-pass filtered white noise.

export function potholeHit() {
  if (!_ctx) return;
  const now    = _ctx.currentTime;
  const dur    = 0.14;
  const bufLen = Math.ceil(_ctx.sampleRate * dur);
  const buf    = _ctx.createBuffer(1, bufLen, _ctx.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src    = _ctx.createBufferSource();
  src.buffer   = buf;

  const filter          = _ctx.createBiquadFilter();
  filter.type           = 'lowpass';
  filter.frequency.value = 190;

  const g = _ctx.createGain();
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(filter);
  filter.connect(g);
  g.connect(_master);
  src.start(now);
  src.stop(now + dur + 0.02);
}

// ── Countdown beeps ────────────────────────────────────────────────────────────
// num=3,2,1 → short square-wave tick; num=0 → longer rising sine (GO tone).

export function countdownBeep(num) {
  if (!_ctx) return;
  const now  = _ctx.currentTime;
  const isGo = num === 0;

  const osc = _ctx.createOscillator();
  const g   = _ctx.createGain();

  if (isGo) {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1320, now + 0.22);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(g);
    g.connect(_master);
    osc.start(now);
    osc.stop(now + 0.30);
  } else {
    osc.type           = 'square';
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.10, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(g);
    g.connect(_master);
    osc.start(now);
    osc.stop(now + 0.09);
  }
}

// ── Finish fanfare ─────────────────────────────────────────────────────────────
// Short ascending arpeggio: C4 E4 G4 C5.

export function finishFanfare() {
  if (!_ctx) return;
  const now   = _ctx.currentTime;
  const notes = [261, 330, 392, 523];
  notes.forEach((freq, idx) => {
    const t   = now + idx * 0.11;
    const osc = _ctx.createOscillator();
    const g   = _ctx.createGain();

    osc.type            = 'triangle';
    osc.frequency.value  = freq;

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(g);
    g.connect(_master);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}
