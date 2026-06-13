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

// Engine — all nodes recreated on engineStart(), torn down on engineStop()
let _engOsc1      = null;   // sawtooth,  0¢  — base tone
let _engOsc2      = null;   // sawtooth, +28¢ — slightly sharp (creates beating)
let _engOsc3      = null;   // square,   -18¢ — slightly flat + buzzier timbre
let _engFilter    = null;   // lowpass, cutoff sweeps up with speed
let _engAmGain    = null;   // amplitude modulation target (LFO modulates its .gain)
let _engLfoOsc    = null;   // LFO sine — drives putt-putt pulse
let _engLfoDepth  = null;   // GainNode scaling LFO amplitude (depth of pulse)
let _engGain      = null;   // master engine gain — fades in/out at race start/end
let _engNoiseNode = null;   // looping white-noise buffer for combustion texture

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
//
// Signal chain:
//   osc1(saw, 0¢)  ─┐
//   osc2(saw,+28¢) ─┤→ sumGain → lpFilter → amGain → engGain → master
//   osc3(sqr,-18¢) ─┘     ↑cutoff/Q sweep       ↑
//                    lfoOsc(sine) → lfoDepth → amGain.gain (AudioParam)
//   noiseNode(loop) → bpFilter(200 Hz) → noiseGain(0.030) → engGain → master
//
// Three detuned oscillators produce a beating/rough idle rather than a clean tone.
// The LFO amplitude-modulates the signal at 9 Hz idle rising to ~22 Hz at speed,
// creating the putt-putt pulse that tightens into a warble under load.
// The bandpass-filtered noise adds combustion texture underneath.
// Filter cutoff sweeps from 400 Hz (idle, muffled) to ~1 250 Hz (full, airy).

export function engineStart() {
  if (!_ctx) return;
  engineStop();

  // ── Three oscillators ──────────────────────────────────────────────────────
  _engOsc1 = _ctx.createOscillator();
  _engOsc2 = _ctx.createOscillator();
  _engOsc3 = _ctx.createOscillator();

  _engOsc1.type = 'sawtooth';
  _engOsc2.type = 'sawtooth';
  _engOsc3.type = 'square';       // square adds extra high-harmonic buzz

  _engOsc1.frequency.value = 80;
  _engOsc2.frequency.value = 80;
  _engOsc3.frequency.value = 80;

  // Fixed detune in cents — osc2/3 track osc1's frequency, offset permanently
  _engOsc2.detune.value = 28;     // +28¢: beating rate ≈ 1.6 Hz at idle
  _engOsc3.detune.value = -18;    // -18¢: beating rate ≈ 1.0 Hz at idle

  const sumGain = _ctx.createGain();
  sumGain.gain.value = 0.34;      // normalise 3 sources

  // ── Lowpass filter (cutoff sweeps with speed) ──────────────────────────────
  _engFilter = _ctx.createBiquadFilter();
  _engFilter.type            = 'lowpass';
  _engFilter.frequency.value = 400;    // idle: muffled carburettor thrum
  _engFilter.Q.value         = 1.6;

  // ── Amplitude modulation — LFO drives putt-putt pulse ─────────────────────
  // amGain.gain = DC offset (0.65) + LFO contribution (±lfoDepth)
  // At idle: gain swings ≈ 0.30–1.00 (heavy pulse)
  // At speed: gain swings ≈ 0.53–0.77 (light warble)
  _engAmGain = _ctx.createGain();
  _engAmGain.gain.value = 0.65;   // DC offset — never changed after init

  _engLfoOsc = _ctx.createOscillator();
  _engLfoOsc.type            = 'sine';
  _engLfoOsc.frequency.value = 9;   // Hz at idle

  _engLfoDepth = _ctx.createGain();
  _engLfoDepth.gain.value = 0.35;   // LFO amplitude at idle

  // ── Combustion noise ───────────────────────────────────────────────────────
  // 0.5 s looping white-noise buffer through a narrow bandpass, mixed low
  const noiseBuf  = _ctx.createBuffer(1, Math.ceil(_ctx.sampleRate * 0.5), _ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  _engNoiseNode        = _ctx.createBufferSource();
  _engNoiseNode.buffer = noiseBuf;
  _engNoiseNode.loop   = true;

  const noiseBpf          = _ctx.createBiquadFilter();
  noiseBpf.type           = 'bandpass';
  noiseBpf.frequency.value = 210;
  noiseBpf.Q.value         = 0.6;

  const noiseGain       = _ctx.createGain();
  noiseGain.gain.value  = 0.030;

  // ── Master engine gain (fade in/out per race) ──────────────────────────────
  _engGain = _ctx.createGain();
  _engGain.gain.value = 0;   // starts silent; engineUpdate ramps in

  // ── Wire the graph ─────────────────────────────────────────────────────────
  _engOsc1.connect(sumGain);
  _engOsc2.connect(sumGain);
  _engOsc3.connect(sumGain);
  sumGain.connect(_engFilter);
  _engFilter.connect(_engAmGain);

  // LFO → lfoDepth → amGain.gain AudioParam (adds to the DC offset of 0.65)
  _engLfoOsc.connect(_engLfoDepth);
  _engLfoDepth.connect(_engAmGain.gain);

  _engAmGain.connect(_engGain);

  _engNoiseNode.connect(noiseBpf);
  noiseBpf.connect(noiseGain);
  noiseGain.connect(_engGain);

  _engGain.connect(_master);

  // ── Start all sources ──────────────────────────────────────────────────────
  _engOsc1.start();
  _engOsc2.start();
  _engOsc3.start();
  _engLfoOsc.start();
  _engNoiseNode.start();
}

/**
 * Call every render frame.
 * speed  = interpolated sim speed of camera-followed car (0 … ~BASE_SPEED)
 * racing = true only while the race is live (not countdown, not end sequence)
 */
export function engineUpdate(speed, racing) {
  if (!_ctx || !_engOsc1) return;
  const now = _ctx.currentTime;

  // Base frequency: 80 Hz idle (Lada at ~700 RPM) → ~180 Hz at full chat
  const baseFreq = 80 + speed * 16;

  // LFO rate: 9 Hz putt-putt at idle → ~22 Hz warble at speed
  const lfoFreq  = 9 + speed * 2.2;

  // LFO depth: heavy pulse at idle, tightens at speed
  const lfoDepth = Math.max(0.12, 0.35 - speed * 0.038);

  // Filter cutoff: muffled thrum at idle → airy carburettor scream at speed
  const cutoff   = 400 + speed * 142;

  // Overall gain: ramp in when racing, slow fade-out at end
  const targetGain = racing && speed > 0.5 ? 0.09 : 0;
  const gainTau    = racing ? 0.10 : 0.30;

  // All three oscillators share the same base frequency; cents offsets are fixed
  _engOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
  _engOsc2.frequency.setTargetAtTime(baseFreq, now, 0.05);
  _engOsc3.frequency.setTargetAtTime(baseFreq, now, 0.05);

  _engLfoOsc.frequency.setTargetAtTime(lfoFreq,  now, 0.15);
  _engLfoDepth.gain.setTargetAtTime(lfoDepth,    now, 0.15);
  _engFilter.frequency.setTargetAtTime(cutoff,   now, 0.10);
  _engGain.gain.setTargetAtTime(targetGain,      now, gainTau);
}

export function engineStop() {
  for (const node of [_engOsc1, _engOsc2, _engOsc3, _engLfoOsc, _engNoiseNode]) {
    if (node) try { node.stop(); } catch (_) {}
  }
  _engOsc1 = _engOsc2 = _engOsc3 = null;
  _engLfoOsc = _engLfoDepth = null;
  _engAmGain = _engFilter = null;
  _engGain = _engNoiseNode = null;
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
