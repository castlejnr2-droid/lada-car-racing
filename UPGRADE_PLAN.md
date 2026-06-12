# Lada Car Racing — Visual & Polish Upgrade Plan

> **INSTRUCTION FOR CLAUDE**: Read this file in full before doing anything in a new session.
> All hard constraints below are absolute. When in doubt, stop and ask rather than guess —
> this app moves real tokens on TON mainnet.

---

## Architecture (read first)

- **Monorepo**: `frontend/` (React 18 + Vite + Three.js, deployed on Vercel via `vercel.json`),
  `backend/` (Node/Express + Postgres, deployed on Railway), `contracts/` (Tact escrow, TON mainnet).
- **The race is NOT player-controlled gameplay.** It is a deterministic cinematic replay.
  When both deposits land, the backend generates a 256-bit seed, runs `computeWinnerIndex(seedHex)`
  in `backend/src/services/events.js` to pick the winner, sends the Payout to the escrow contract,
  and stores `combined_seed` + `winner` in the DB. The frontend (`Race.jsx`) calls
  `runReplay(canvas, race.combined_seed, ...)` from `frontend/src/game/replay.js`, which re-runs
  the identical simulation (`frontend/src/game/physics.js` + `rng.js`) so the animation shows the
  same winner the contract paid.
- **The simulation IS the source of truth for who gets real money.** The backend copy and frontend
  copy must produce bit-identical results from the same seed.

---

## Hard Constraints (absolute — never violate)

### Frozen files — do NOT modify
- `frontend/src/blockchain/` — `tonConnect.js`, `escrowContract.js`, `jetton.js`
- `frontend/src/api/` — all API client files
- `contracts/` — everything
- Backend payout/indexer/escrow logic: `events.js` winner/payout flow, `indexer.js`,
  `housePayout.js`, `tonApi.js`, routes, schema
- The deposit payload encoding, gas amounts, and raceId handling are painstakingly debugged.

### Simulation is frozen after Phase 0
- `frontend/src/game/physics.js` — constants and logic are frozen
- `frontend/src/game/rng.js` — frozen
- The backend mirrored copy in `events.js` — frozen
- All visual richness must be a **presentation layer** that *consumes* `sim.history`
  (positions, speeds, hit flags per tick). Cosmetic motion must never feed back into
  positions or the winner.

### No player-controlled gameplay
- No steering, no acceleration input, no AI opponents, no power-ups that affect outcomes,
  no laps/checkpoints. Real tokens are wagered on a provably deterministic outcome.

### Public API of runReplay is preserved
- Signature: `runReplay(canvas, hexSeed, { onComplete, onTick, getViewMode, playerNames })`
- `Race.jsx` and `DemoRace.jsx` must keep working unchanged (or with minimal clearly-explained changes).

### Telegram WebView constraints
- WebGL1 fallback must keep working
- `LinearSRGBColorSpace` stays
- Pixel ratio capped at 2
- Audio only after user gesture
- No postprocessing passes
- Shadows only if cheap
- Keep draw calls low — target mid-range Android WebView

---

## Key Technical Decisions Made

### Playhead accumulator (Phase 0 bugfix, Phase 1 refinement)
The main loop uses a single float `playhead` (not an integer `physTick`) as state.
- `playhead` advances by `1 / PHYS_PER_FRAME` ONLY when `racing = !cdActive && endFrame < 0`
- `physTick = Math.floor(playhead)`, `alpha = frac(playhead)` when racing and not at last tick, else 0
- This guarantees alpha=0 during countdown and end sequence — no scene vibration
- Bounce and body sway are also gated on `racing` for the same reason

### PHYS_PER_FRAME = 2
With `BASE_SPEED = 6`, the sim finishes in ~200 ticks. At 60fps and PHYS_PER_FRAME=2,
visual race duration is ~6-7 seconds, matching the original feel before the speed fix.
Sub-tick interpolation (`curr + (next - curr) * alpha`) keeps motion smooth at effective 30Hz.

### SCENE_THEME object
All lighting, fog, and sky values are in one constant:
```js
const SCENE_THEME = {
  ambientColor, ambientIntensity, sunColor, sunIntensity,
  fogColor, fogNear, fogFar,
  skyHorizon: [r,g,b], skyZenith: [r,g,b],
  groundColor, earthColor, roadColor,
};
```
Sky shader reads `uHorizon`/`uZenith` as uniforms. Phase 3 creates `THEME_DUSK`,
`THEME_SNOW` objects and swaps the active one — no other code changes needed.

### Particle pools (Phase 1)
- Exhaust: one `Points` object per car, `EXHAUST_PER_CAR=14` particles, age-based lifecycle
- Dust: pre-allocated pool `DUST_MAX_BURSTS=4` slots × `DUST_PER_BURST=22` particles,
  triggered on pothole hit onset (edge-detected: `curr.hits[i] && !prevHit`), zero runtime allocation
- Confetti: existing system unchanged

### Draw call budget (Phase 2 result, ~75-90 total)
| System | Draw calls |
|---|---|
| Road (asphalt, grass, earth, lines, pothole decals) | 9 |
| Panelki (3 texture variants × 2 sides, merged) | 6 |
| Birch trees (InstancedMesh: trunks + leaf puffs) | 2 |
| Lamp posts (4 merged meshes + 22 wire lines) | 26 |
| Road furniture (signs, billboards, star pole) | ~15 |
| Finish line | 3 |
| Sky (gradient sphere + 3 merged cloud layers) | 4 |
| Skyline (1 merged distant silhouette mesh) | 1 |
| Cars (GLB models) | 2 |
| Particles (confetti, exhaust×2, dust) | ~5 |
| **Total** | **~73 + 22 wire lines** |

### Merging strategy (Phase 2)
- Panelki: buildings grouped by window-texture variant, each group merged via `mergeGeometries`.
  Panel seams baked into `makeWinTex()` canvas texture — no separate seam geometry.
- Birch trees: `InstancedMesh` — trunk `CylinderGeometry(0.20, 0.28, 1, 7)` scaled Y per instance;
  leaf `SphereGeometry(1, 6, 5)` scaled uniformly. Bark ring meshes removed (invisible at distance).
- Lamp posts: poles, arms/visors, housings, glow discs each merged into one mesh.
  Additive glow discs (`THREE.AdditiveBlending`) at each lamp head for street-light feel.
- Clouds: 3 layers (far/mid/near), each a merged SphereGeometry mesh. Laterally drifted per frame
  at speeds 0.022/0.038/0.056 for parallax effect. Cloud meshes returned from `buildSky(scene)`
  and stored in `clouds` array in `runReplay` closure.
- Pothole decals: `makePotholeTexture()` cracked-oval canvas. 28 planes (2 lanes × 14 potholes)
  translated to exact `track.lanes[lane].potholes` Z positions and merged into 1 draw call.
  `renderOrder=1` + `polygonOffset` prevents z-fighting.

### Skyline (Phase 2)
`buildSkyline(scene)`: random box silhouettes at x=±95, heights 28-80m, merged into 1 draw call.
Color 0x8a8c98 (cooler/darker than panelki, reads as depth).

### Sim sync verification
`scripts/verify-sim-sync.js` — runs both implementations over N seeds, asserts identical winners,
prints win split. Run with: `node scripts/verify-sim-sync.js [count]`
Result at Phase 0: 5000 seeds, 0 mismatches, 50.3%/49.7% split (fair).

---

## Phase Status

### Phase 0 — Critical Bug Fix — DONE (committed, pushed)
**Commit**: `f2afa4f`
- Fixed `frontend/src/game/physics.js` `BASE_SPEED 3 → 6` to match backend `_BASE_SPEED=6`
- Added `PHYS_PER_FRAME=2` as presentation-layer pacing (replay.js only)
- Added sub-tick interpolation + `playhead` accumulator (after Phase 1 vibration fix)
- Added defensive winner mismatch check in `Race.jsx` (logs loudly if local sim disagrees with server)
- Created `scripts/verify-sim-sync.js` (5000-seed test, 0 mismatches)

### Phase 1 — Car Presentation — DONE, device-verified
**Commit**: `e122313` (+ vibration fix `4a3ae6f`)
- Wheel rotation via GLB node name search (`/wheel|tire|tyre|rim/i`), graceful fallback
- Pothole jolt: exponential-decay Y kick (0.20 units) + nose pitch (-0.09 rad) over 14 frames
- Dust burst pool on hit onset (22 particles × 4 slots, pre-allocated)
- Exhaust stream per car (14 particles, speed-scaled opacity, emitted at car rear in +Z)
- Body sway: continuous sin-wave Z roll (0.018 rad, different phase per car)
- Tinting: `lerp(baseColor, tint, 0.60)` + emissive `tint * 0.14` for readability at distance
- **Vibration fix**: switched from `frameCount % PHYS_PER_FRAME` alpha to `playhead` accumulator
  that only advances when `racing = !cdActive && endFrame < 0`

### Phase 2 — Environment — DONE, device-verified
**Commits**: `cd4a98b` (main), `10b1f57` (debug instrumentation), `7187350` (road fix)
- Panelki: merged geometry per texture variant, 6 draw calls total, seams baked into texture
- Birch trees: InstancedMesh, 2 draw calls
- Lamp posts: merged geometry + additive glow discs, ~8 draw calls
- Pothole decals at exact sim positions, 1 merged draw call
- Skyline: 1 merged distant city silhouette
- Sky: 3 merged drifting cloud layers + SCENE_THEME shader uniforms
- SCENE_THEME structure for Phase 3 theme swapping
- `buildSky` returns cloud mesh array for per-frame drift animation in main loop

**Bug found on device (blank scene)**: `Object.assign(mesh, { rotation: ..., position: ... })`
throws `TypeError: Cannot assign to read only property 'rotation'` in strict-mode ES modules.
`rotation`, `position`, `scale`, `quaternion` on `Object3D` are non-writable — always use
`.rotation.x = ...` or `.rotation.set(...)` / `.position.set(...)` directly.

**Workflow rule added**: always open the desktop browser console and confirm zero JS errors
before pushing a device test build. Would have caught the Object.assign throw immediately.

**Error overlay**: pre-created hidden `<div>` (zero cost when silent), visible only on throw,
removed on replay cleanup. Stays in until a clean device run is confirmed.

### Phase 3 — Atmosphere Themes — DONE, device-verified
- `THEME_DAY`, `THEME_DUSK`, `THEME_SNOW` objects replace the single `SCENE_THEME` constant
- Theme index derived deterministically: `parseInt(hexSeed.slice(0,8), 16) % 3`
- Both players always see the same theme (same seed = same theme index)
- `buildSky(scene, theme)` — sky gradient + cloud color/opacity from theme
- `buildRoad(scene, N, laneX, track, theme)` — asphalt, grass, earth from theme
- `buildBirchTrees(scene, rng, theme)` — trunk + leaf color from theme
  - Day: green leaves; Dusk: near-black silhouette foliage; Snow: pale blue-white bare branches
- Fog, ambient light, sun color/intensity all swap with theme
- Zero simulation impact — physics.js untouched

**Finish-order visual fix — DONE, device-verified** (implemented alongside Phase 3 verification):
- `finishPlayheads[i]` pre-computed: sub-tick interpolated position where each car crosses TRACK_LENGTH
- During racing, non-winner cars held at `TRACK_LENGTH - 0.5` if they'd visually cross before the winner
- End-sequence smoothstep animates all cars to rank-ordered resting positions (winner ≥ 40 units past, non-winner ≤ 18 units past)
- Checkered banner added at finish line (`buildFinishLine` returns `{ material, bannerMaterial }`)
- WINNER label drawn in HUD `drawHud` when `celebFrame >= 0 && i === winnerIdx`
- Visual crossing order now always matches declared winner

### Phase 4 — Camera & Cinematics — DONE, awaiting device test

**Features implemented**:
- **FOV kick on speed bursts**: `currentFov` lerps toward `FOV_BASE + min(FOV_KICK_MAX=4, excess * scale)` when car 0 speed exceeds `FOV_KICK_THR=6.6` (1.1 × BASE_SPEED). Returns to base at `FOV_LERP_BACK=0.06` per frame. `updateProjectionMatrix()` called only when fov delta > 0.05.
- **Photo-finish slow-motion**: `isCloseFinish` = finish-time gap between cars < `SLOWMO_TICKS=10` ticks. When true and leading car is past `SLOWMO_START=0.90` × TRACK_LENGTH, playhead advance divided by `SLOWMO_FACTOR=3`. Playback-rate only — sim data untouched.
- **Winner celebration orbit**: after `END_DRIVE` frames, camera arcs around winning car at `ORBIT_RADIUS=5.5` world units, `ORBIT_SPEED=0.028` rad/frame. Blends in over 20 frames via `_blend = min(1, orbitAge/20)`. `lookTgt` lerps toward winner position at `0.04 + blend * 0.08`.
- **Camera shake on pothole hits**: triggered on `hitJustStarted && i === 0`. Random `camShakeDX/DY` offsets decay via `exp(-(age/SHAKE_FRAMES) * 3.5)` over `SHAKE_FRAMES=8` frames.

**Constants**:
```
FOV_BASE=65  FOV_KICK_MAX=4  FOV_KICK_THR=6.6  FOV_LERP_BACK=0.06
SHAKE_FRAMES=8  ORBIT_RADIUS=5.5  ORBIT_SPEED=0.028
SLOWMO_FACTOR=3  SLOWMO_START=0.90  SLOWMO_TICKS=10
```

**Constraints respected**: all camera changes read from `sim.history` and `carMeshes[i].position` only. Photo-finish slow-mo adjusts `playhead` advance rate only — never modifies tick data or positions.

### Phase 5 — HUD Polish — NOT STARTED
**Goal**: Better 2D overlay drawn on the HUD canvas in `drawHud()`.

**Features**:
- **Live position indicator**: "1st" / "2nd" badge near each car label, updates each tick
- **Speed readout**: km/h approximation from `interpSpeed`, shown for the player's car (index 0)
- **Animated progress bar**: current bar is flat 5px strip. Make it taller (8px), add gradient,
  add a small car icon at the leading edge of each bar
- **Countdown upgrade**: current "3-2-1-GO!" is text only. Add scale-pulse, colour change
  per number (red=3, amber=2, green=1, bright green=GO), brief screen flash on GO
- **Results banner**: after race, overlay showing winner name and payout (95% of pot) in large text
  before transitioning to ResultScreen. Currently ResultScreen is shown immediately after replay.

**Note**: HUD is 2D canvas drawn each frame — very cheap. No WebGL changes needed.

### Phase 6 — Sound — NOT STARTED
**Goal**: Lightweight audio. Must init only after a user tap. Fail silently if WebAudio unavailable.

**Features**:
- **Engine pitch**: WebAudio oscillator, frequency mapped to `interpSpeed`. Base freq ~80Hz,
  scales to ~180Hz at full speed. Applied per car visible to camera (just car 0 for simplicity).
- **Pothole thud**: short noise burst triggered on `hitJustStarted`, -12dB, 0.15s duration
- **Countdown beeps**: 3 short tones (A4) on each count number, higher/longer tone on GO
- **Finish fanfare**: short ascending arpeggio on `onComplete`
- **Mute toggle**: persisted to `localStorage`. Small icon in corner (can be a HUD element).

**Implementation notes**:
- Create `frontend/src/game/audio.js` — separate file, imported by `replay.js`
- `initAudio()` called on first user gesture (tap "Watch Race" button in Race.jsx)
- All synthesis via Web Audio API oscillators + GainNodes — zero asset downloads
- `audio.js` must export a `muteToggle()` function and a `isMuted()` getter

### Phase 7 — Demo Mode Parity — NOT STARTED
**Goal**: Ensure every Phase 1-6 upgrade works in `DemoRace.jsx` (the new-player funnel).

**DemoRace specifics**:
- Uses random seed each loop: `randomSeed()` returns 32-char hex
- Loops automatically with `RESULT_HOLD_MS = 5000` between races
- Has its own winner overlay (not ResultScreen)
- Already uses `onTick` to capture sim for winner display

**Checklist**:
- All Phase 1 car animations work (they use `replay.js` directly — should already work)
- All Phase 2 environment works (same `replay.js` — should already work)
- Phase 3 themes: confirm `seed % 3` works with random seeds (always will)
- Phase 4 cinematics: confirm orbit and slow-mo work in looping mode
- Phase 5 HUD: confirm results banner clears properly before auto-loop starts
- Phase 6 audio: confirm audio re-init works after loop (same AudioContext, just retrigger)
- Test on device specifically in DemoRace loop for 3+ cycles

---

## Follow-up Roadmap (post Phase 7)

From the original brief, future features worth tracking:

1. **Spectator mode** — watch a race you're not in; same `runReplay` with read-only UI
2. **3+ player races** — physics already supports arbitrary lane count; UI and contract changes needed
3. **Leaderboard seasons** — backend already has leaderboard; add season resets and season prizes
4. **Cosmetic Lada skins as token sink** — purchasable GLB model variants or tints, stored per address

---

## Files That Matter Most

```
frontend/src/game/replay.js      — all 3D rendering and animation (Phase 1-4, 6)
frontend/src/game/physics.js     — FROZEN after Phase 0
frontend/src/game/rng.js         — FROZEN
frontend/src/components/Race.jsx — minimal: defensive winner check added in Phase 0
frontend/src/components/DemoRace.jsx — Phase 7 compatibility target
backend/src/services/events.js   — FROZEN (payout/winner logic)
scripts/verify-sim-sync.js       — run after any physics-adjacent change
```

## Deployment

- Frontend: push to `main` → Vercel auto-deploys (see `frontend/vercel.json`)
- Backend: Railway auto-deploys from `main`
- **Never use `netlify deploy`** — any Netlify config in repo is stale

## Never-Hyphens Rule
User-visible text must not contain hyphens or em dashes.
