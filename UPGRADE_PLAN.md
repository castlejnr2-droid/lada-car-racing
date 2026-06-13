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

### Phase 4 — Camera & Cinematics — DONE, device-verified

**Features implemented**:
- **FOV kick on speed bursts**: `currentFov` lerps toward `FOV_BASE + min(FOV_KICK_MAX=4, excess * scale)` when the camera-followed car's speed exceeds `FOV_KICK_THR=6.6` (1.1 × BASE_SPEED). Returns to base at `FOV_LERP_BACK=0.06` per frame. `updateProjectionMatrix()` only when delta > 0.05.
- **Photo-finish slow-motion**: `isCloseFinish` = finish-time gap < `SLOWMO_TICKS=10` ticks. When true and leader is past `SLOWMO_START=0.90` × TRACK_LENGTH, playhead advance divided by `SLOWMO_FACTOR=3`. Playback-rate only.
- **Winner celebration orbit**: after `END_DRIVE` frames, camera arcs around winning car at `ORBIT_RADIUS=5.5` world units, `ORBIT_SPEED=0.028` rad/frame, blends in over 20 frames.
- **Camera shake on pothole hits**: triggered on `hitJustStarted && i === leadIdx` (camera-followed car). Random `camShakeDX/DY` decay via `exp(-(age/SHAKE_FRAMES)*3.5)` over 8 frames.

**Camera framing fix (post-device-test)**:
- FOV kick and shake now wired to `leadIdx` (camera-followed car), not hardcoded to car 0.
- Camera X tracks midpoint of all lanes (`laneX.reduce(...)/N = 0` for symmetric 2-car layout) so both cars stay equally in frame.
- `LANE_SPREAD = 4.8` → cars at ±1.2 world units. Initial `LANE_SPREAD=7.2` (±1.8) clipped Player 2 at screen edge.

**Silent error overlay**: pre-created hidden `<div>` (zero cost when silent), visible only on throw, removed on replay cleanup. Persists for debugging — only remove once device runs are consistently clean.

**vercel.json rule**: never add non-schema properties. `"toolbar": false` is not a valid Vercel schema key — it failed the build. Toolbar visibility is controlled from the Vercel dashboard.

**Dust particles (post-device-test)**:
- `sizeAttenuation: false` + `size: 5` (fixed pixels). `sizeAttenuation: true` caused giant squares when a burst spawned close to the camera.
- `dustColor` added to all three themes: tan (day), dark grit (dusk), white-grey puff (snow).

**Finish choreography (post-device-test)**:
Three cases handled by pre-computed `visFinishTick[]` + blend-zone remap:
1. **Blowout** (winner crosses first in raw sim): `visFinishTick = finishPlayheads` for all cars — no remap, raw positions used throughout.
2. **Close finish** (winner and loser cross within `SLOWMO_TICKS`): slow-mo already engaged; loser may need remap if it crossed first by a small margin.
3. **Loser-overshoot overtake** (winner has bigger overshoot but crosses later): loser's display position linearly remapped in final 18% of track (`finishBlendStart = 984`) to arrive at `TRACK_LENGTH` at `finishPlayheads[winner] + MIN_VIS_CROSS_GAP=4` ticks instead of its raw crossing time. Produces a gentle visible deceleration; no freeze, no teleport. All keyed to `playhead` (same time base as slow-mo) — no mismatch.

**Constants**:
```
FOV_BASE=65  FOV_KICK_MAX=4  FOV_KICK_THR=6.6  FOV_LERP_BACK=0.06
SHAKE_FRAMES=8  ORBIT_RADIUS=5.5  ORBIT_SPEED=0.028
SLOWMO_FACTOR=3  SLOWMO_START=0.90  SLOWMO_TICKS=10
FINISH_BLEND_DIST=TRACK_LENGTH*0.18  MIN_VIS_CROSS_GAP=4
```

### Phase 5 — HUD Polish — DONE, device-verified

**Features implemented**:

- **Progress bar**: per-car bars (6px each, 2px gap), gradient fill (dim at start, bright at tip), 3px white leading-edge pip. 28px left gutter holds rank labels.
- **Live rank badges**: `1ST` / `2ND` drawn both in bar gutter (7px, gold/grey) and below each car name label (10px, same colors). Hidden during celebration.
- **Speed readout**: `Math.round(interpSpeeds[leadIdx] * 10)` km/h, shown right-of-bar-strip during racing only. Scale factor 10: BASE_SPEED=6 → 60 km/h.
- **Countdown upgrade**: per-number colors — red (`#ff5544`) for 3, amber (`#ffaa22`) for 2, green (`#44ee44`) for 1, bright green (`#00ff88`) for GO. Brief translucent green screen flash at GO onset (7 frames, fades from alpha 0.32).
- **Results banner**: appears at `celebFrame=20`, fades in over 12 frames. Dark panel with winner-color border. Winner name + " wins" on first line (truncated if long). Optional `payoutLabel` string on second line (real races only — `Race.jsx` passes `"Prize: X.XX LADA"` computed as `BigInt(race.pot) - BigInt(race.house_fee || 0)`, matching `ResultScreen.jsx` exactly; demo races pass nothing). No-hyphen compliant throughout.

**Payout derivation bug fixed (commit fd0ed8d)**: `Race.jsx` was computing payout as `pot * 95n / 100n` (client-side hardcoded 95%) rather than the server-authoritative `pot - house_fee`. Fixed to match `ResultScreen.jsx` exactly so both screens always show the same number for the same race.

**`drawHud` signature**: `(ctx, W, H, N, positions, speeds, leadIdx, playerNames, carMeshes, camera, cdFrame, celebFrame, winnerIdx, payoutLabel)`

**`runReplay` options**: added optional `payoutLabel = null`. `Race.jsx` passes it; `DemoRace.jsx` unchanged (gets null → demo banner variant).

**All HUD reads from sim history + interpolated display values — no new data sources.**

### Phase 6 — Sound — DONE, device-verified

**Features implemented**:

- **Engine sound**: Three detuned oscillators (saw 0¢, saw +28¢, square -18¢) create beating/rough idle. LFO amplitude modulation (9 Hz putt-putt at idle rising to ~22 Hz warble at speed) via GainNode AudioParam connection. Lowpass filter cutoff sweeps 400→1250 Hz. Looping bandpass-filtered noise for combustion texture. Frequency `80 + speed*16` Hz. Gain ramps in/out per race; module-level `_ctx`/`_master` persist across DemoRace auto-loops.
- **Pothole thud**: 0.14s white noise burst through 190 Hz low-pass filter, gain exponential decay. Fired on `hitJustStarted && i === leadIdx` (camera-followed car only, same gate as camera shake).
- **Countdown beeps**: Step transition detected each frame (`_lastBeepStep`). Digits 3/2/1 → short 880 Hz square tick (0.07s). GO → rising sine 880→1320 Hz (0.28s). `countdownBeep(num)` where num=3/2/1/0.
- **Finish fanfare**: C4 E4 G4 C5 ascending arpeggio (triangle wave, 0.11s spacing, 0.22s envelope each note). Fires once at `endFrame === END_DRIVE` via `_fanfareFired` flag.
- **Mute toggle**: `position: fixed; bottom: 16px; left: 12px` button injected into `document.body` by `runReplay`. Shows 🔊/🔇. State persisted to `localStorage` key `lada_muted`. Readable before AudioContext exists (initialized at module load from localStorage). Removed on replay cleanup.

**Implementation**:
- New file: `frontend/src/game/audio.js` — all synthesis, zero asset downloads
- `replay.js` imports 8 audio functions; `Race.jsx` and `DemoRace.jsx` unchanged
- `resumeAudio()` called at `runReplay` entry + on canvas `touchstart` (catches late-gesture case in Telegram WebView). If AudioContext unavailable, every function is a silent no-op.
- `_ctx`, `_master` are module-level (survive across DemoRace auto-loops). Engine oscillator is per-race (recreated each `engineStart()`).

**Audio event wiring in `loopBody`**:
| Event | Trigger | Function |
|---|---|---|
| Engine pitch | every frame | `engineUpdate(interpSpeeds[leadIdx], racing)` |
| Countdown beep | `_beepStep !== _lastBeepStep` while `cdActive` | `countdownBeep(3/2/1/0)` |
| Pothole thud | `hitJustStarted && i === leadIdx` | `potholeHit()` |
| Finish fanfare | `endFrame === END_DRIVE && !_fanfareFired` | `finishFanfare()` |

### Phase 7 — Demo Mode Parity — DONE (no code changes required)

**Audit result**: DemoRace and Race share the identical `runReplay` execution path with zero branching inside the function. All Phase 1-6 features are present in demo mode by design. Differences are intentional and verified:

| Feature | Demo behaviour | Verified |
|---|---|---|
| Phase 1 car visuals (wheels, jolt, dust, exhaust, sway) | Same `replay.js` | ✓ |
| Phase 2 environment (panelki, birches, lamps, skyline, clouds) | Same `replay.js` | ✓ |
| Phase 3 themes | `parseInt(hexSeed.slice(0,8), 16) % 3` — random seed always valid | ✓ |
| Phase 4 cinematics (FOV kick, shake, slow-mo, orbit) | Same `replay.js`; `leadIdx` from positions, not hardcoded | ✓ |
| Finish choreography | Same `replay.js` pre-computation | ✓ |
| Phase 5 HUD (ranks, speed, countdown, banner) | `payoutLabel = null` (not passed) → banner shows `"[Name] wins"` only, no payout line; `panH = 42` not 58 | ✓ |
| Phase 6 audio (engine, thud, beeps, fanfare, mute button) | `engineStart()`/`engineStop()` called by `runReplay` itself; mute button injected/removed on each loop; `_ctx`/`_master`/`_muted` module-level, survive auto-loop restarts | ✓ |

**Auto-loop compatibility** (`RESULT_HOLD_MS = 5000` between races):
1. `stopRef.current?.()` → `engineStop()`, removes mute button, cancels RAF, disposes renderer
2. `runReplay(newSeed, ...)` → `resumeAudio()` (no-op: ctx persists), new mute button appended
3. `loadCarModel().then()` → GLB cached after first load, `engineStart()` starts fresh oscillators
4. `_muted` preserved across loops; new button reads `isMuted()` and shows correct icon

**DemoRace-specific intentional differences** (all correct):
- Generic player names `['Player 1', 'Player 2']` instead of wallet usernames
- No `payoutLabel` passed → no fake payout shown in results banner
- Own `WinnerOverlay` React component (not `ResultScreen`) — shown on top of canvas while engine winds down
- `getViewMode` not passed (accepted in signature, never read in body — harmless dead parameter)

---

## Spectator Mode — DONE, device-verified (commit 319f646)

**Verified working**: list view, watch view, no-payout rule (results banner shows winner name only, no LADA figure), error handling for invalid/non-settled/refunded/not-found race IDs, deep link *receiving* via Telegram start_param `r_<raceId>`.

**Routes**: `/spectate` (list) and `/spectate/:raceId` (watch). Deep link via Telegram start_param `r_<raceId>` → navigates directly to watch view.

**Architecture**: `SpectatorWatch` calls `runReplay` identically to `Race.jsx` and `DemoRace.jsx`. No `payoutLabel` passed → results banner shows winner name only, no payout figures. `SPECTATING` badge (blue, top-left) distinguishes from `DEMO` (red) and own race (no badge). `runReplay` inherits all Phases 1-6 upgrades automatically.

**Entry point**: 4th tab "👁 Watch" in `Home.jsx` (via `/spectate` route setting `initialTab="watch"`). `Home` accepts `initialTab` prop so the same component serves both `/` and `/spectate`.

**Validation**: `SpectatorWatch` fetches via `fetchRace(id)`. Validates `state === 'settled'` and `combined_seed` present. Non-settled, refunded, not-found, and network errors each show a specific friendly message (no crashes, no blank screen).

**Backend change (read-only)**: Added `LEFT JOIN players p1/p2` to the `GET /api/races` list query to include `player1_username` / `player2_username`. Qualified all column references with `r.` to avoid `created_at` ambiguity. No write logic or schema touched.

**Files added/changed**:
- `backend/src/routes/races.js` — username join on list query only
- `frontend/src/api/races.js` — `fetchSettledRaces(limit)` added
- `frontend/src/components/tabs/WatchTab.jsx` — NEW: settled-race list, auto-refreshes every 5 s
- `frontend/src/components/SpectatorWatch.jsx` — NEW: full-screen spectator replay
- `frontend/src/App.jsx` — two new routes + `StartParamRedirect` for deep links
- `frontend/src/components/Home.jsx` — `initialTab` prop + Watch tab

**Share button — DONE (commit f5f781e)**:
- `📤 Share` button in `SpectatorWatch` (top-right corner, matches SPECTATING badge style; also in race-over overlay alongside "Back to watch list")
- `📤 Share` button on each `WatchTab` race card (`e.stopPropagation()` prevents card click from firing)
- `frontend/src/lib/share.js` — single module with `raceDeepLink(raceId)` and `shareRace(raceId)`
- Bot/app name read from `VITE_TG_BOT` / `VITE_TG_APP` env vars; defaults to `LadaCarRacingBot` / `play`
- Share path: `WebApp.openTelegramLink` with `https://t.me/share/url?url=<deepLink>&text=Watch this LADA race`
- Clipboard fallback: `navigator.clipboard.writeText(deepLink)` with 2s "Link copied" toast
- Round trip confirmed: generated link `startapp=r_<raceId>` matches exactly what `StartParamRedirect` parses

---

## Follow-up Roadmap

1. **Leaderboard seasons** — NEXT: backend already has leaderboard; add season resets and season prizes
2. **3+ player races** — physics already supports arbitrary lane count; UI and contract changes needed
3. **Cosmetic Lada skins as token sink** — purchasable GLB model variants or tints, stored per address

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
