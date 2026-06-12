/**
 * 3D behind-the-car race replay — Three.js renderer.
 *
 * Camera follows the player's car (index 0) from behind and above, looking
 * down the road toward the finish line.
 * Cars are GLB 3D models (car.glb), cloned per player and tinted.
 * Road, finish line, and Soviet-era panel apartment blocks line the street.
 * A 2D canvas overlay (orthographic second pass) renders progress bar,
 * player name labels, and the countdown sequence.
 *
 * Drop-in replacement for the original 2D replay — same public signature:
 *   runReplay(canvas, hexSeed, { onComplete, onTick, playerNames })
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
// With BASE_SPEED=6 the sim finishes in ~half the ticks compared to BASE_SPEED=3.
// Setting PHYS_PER_FRAME=2 means "advance 1 physics tick every 2 render frames",
// which restores the original ~6-7 s visual race duration.
// Presentation layer only — never touches simulation constants.
const PHYS_PER_FRAME = 2;   // render frames per physics tick advance

const ROAD_W      = 14;   // total road width, world units
const LANE_SPREAD = 2.4;  // total lateral spread across all lanes (±0.6 for 2 cars)
const CAR_SCALE   = 1.5;  // GLB model uniform scale
const CAR_H       = 2.0;  // approximate car height for HUD label offset

const CAM_BACK   = 6;    // world units behind player (closer)
const CAM_HEIGHT = 2.5;  // camera height (lower, more dramatic)
const CAM_AHEAD  = 18;   // look-ahead from player's position
const CAM_LERP   = 0.07;

const COUNTDOWN_STEP  = 36;
const COUNTDOWN_GO    = 24;
const COUNTDOWN_TOTAL = 3 * COUNTDOWN_STEP + COUNTDOWN_GO;

const END_DRIVE     = 55;
const END_CELEBRATE = 50;
const END_HOLD      = 20;
const END_TOTAL     = END_DRIVE + END_CELEBRATE + END_HOLD;

// Per-car colour tints applied by traversing GLB materials (null = no change)
const CAR_TINTS = [
  null,                        // 0: original model colours
  new THREE.Color(0xc8472b),   // 1: Soviet red
  new THREE.Color(0x2d8a3a),   // 2: green
  new THREE.Color(0x5a22bb),   // 3: purple
  new THREE.Color(0xd97a10),   // 4: orange/gold
];

// Progress-bar colours matching the tint palette (CSS strings for 2D canvas)
const HUD_COLORS = ['#e8e0d0', '#c8472b', '#2d8a3a', '#5a22bb', '#d97a10'];

// ─── Car presentation constants ────────────────────────────────────────────────
const WHEEL_RADIUS    = 0.28;  // approx world-unit wheel radius after CAR_SCALE (for rotation math)
const JOLT_FRAMES     = 14;    // render frames the pothole impact jolt lasts
const EXHAUST_PER_CAR = 14;    // point particles in each car's exhaust stream
const EXHAUST_LIFE    = 18;    // render frames per exhaust particle
const DUST_PER_BURST  = 22;    // particles per pothole dust burst
const DUST_MAX_BURSTS = 4;     // concurrent burst slots (2 cars + margin)
const DUST_LIFE       = 24;    // render frames per dust particle
const TINT_STRENGTH   = 0.60;  // lerp weight toward tint hue (0=keep orig, 1=pure tint)

// ─── Scene theme — day (default) ──────────────────────────────────────────────
// All lighting, fog, and sky values live here so Phase 3 can swap the whole
// look by passing a different theme object without touching any other code.
const SCENE_THEME = {
  ambientColor:     0xdde8f0,
  ambientIntensity: 4.0,
  sunColor:         0xfff4e0,
  sunIntensity:     5.0,
  fogColor:         0xc0ccd8,
  fogNear:          TRACK_LENGTH * 0.45,
  fogFar:           TRACK_LENGTH * 1.1,
  skyHorizon:       [0.82, 0.86, 0.90],   // vec3 for sky shader
  skyZenith:        [0.45, 0.62, 0.80],
  groundColor:      0x5a7a35,             // grass shoulder
  earthColor:       0x7a6e52,             // outer dirt
  roadColor:        0x525252,             // asphalt
};


// ─── Public entry ──────────────────────────────────────────────────────────────
export function runReplay(canvas, hexSeed, {
  onComplete, onTick, getViewMode, playerNames = []
} = {}) {
  // Measure canvas CSS size (set by flex layout)
  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const W = Math.round(rect.width  > 0 ? rect.width  : canvas.offsetWidth  || window.innerWidth  || 360);
  const H = Math.round(rect.height > 0 ? rect.height : canvas.offsetHeight || window.innerHeight || 640);

  // Override the pixel-art CSS hint — 3D needs smooth scaling
  canvas.style.imageRendering = 'auto';

  // ── Canvas sanity ─────────────────────────────────────────────────────────
  console.log('[replay] canvas CSS size:', W, 'x', H,
    '| pixel size:', canvas.width, 'x', canvas.height,
    '| dpr:', dpr,
    '| visibility:', canvas.style.visibility || 'unset',
    '| display:', canvas.style.display || 'unset');

  // ── WebGL context probe ───────────────────────────────────────────────────
  // Probe availability without saving the context — let Three.js create its
  // own context below. Using `instanceof` on WebGL2RenderingContext is unsafe
  // in some embedded WebViews where the global may not be defined.
  let probeType = 'none';
  try {
    const gl2 = canvas.getContext('webgl2');
    if (gl2) { probeType = 'webgl2'; }
    else {
      const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl1) probeType = 'webgl1';
    }
  } catch (e) {
    console.warn('[replay] WebGL probe threw:', e);
  }
  console.log('[replay] WebGL probe:', probeType);
  if (probeType === 'none') {
    console.error('[replay] Aborting: no WebGL context available');
    return () => {};
  }

  // ── Renderer ──────────────────────────────────────────────────────────────
  // Do NOT pass `context` — let Three.js call getContext itself so it gets
  // the correct attributes (antialias etc.) and manages its own state.
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    console.error('[replay] THREE.WebGLRenderer failed:', e);
    return () => {};
  }
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, true);    // true: Three.js sets canvas.style.width/height explicitly
  renderer.autoClear = false;
  // Telegram WebView (and older Android WebGL) doesn't support SRGBColorSpace —
  // LinearSRGBColorSpace works in all environments.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  console.log('[replay] renderer OK — gl:', renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
    '| maxTextures:', renderer.capabilities.maxTextures,
    '| canvas px:', canvas.width, 'x', canvas.height);

  // ── Physics simulation ────────────────────────────────────────────────────
  const rng   = createRng(seedFromHex(hexSeed));
  const track = buildTrack(rng, 2);
  const sim   = simulate(track, rng);
  const N     = sim.history[0].positions.length;

  // Lane X positions: evenly spread within LANE_SPREAD (±0.6 for 2 cars)
  const laneX = Array.from({ length: N }, (_, i) =>
    ((i + 0.5) / N - 0.5) * LANE_SPREAD,
  );
  console.log('[replay] laneX computed:', laneX.map((x, i) => `car${i}=x${x.toFixed(3)}`).join(', '));

  // ── Main 3D scene ─────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  // Atmospheric haze — values from SCENE_THEME so Phase 3 can swap cleanly
  scene.fog = new THREE.Fog(SCENE_THEME.fogColor, SCENE_THEME.fogNear, SCENE_THEME.fogFar);

  // Lighting
  scene.add(new THREE.AmbientLight(SCENE_THEME.ambientColor, SCENE_THEME.ambientIntensity));
  const sun = new THREE.DirectionalLight(SCENE_THEME.sunColor, SCENE_THEME.sunIntensity);
  sun.position.set(30, 80, 40);
  scene.add(sun);

  // ── Sky with drifting cloud layers (returned for per-frame animation) ─────
  const clouds = buildSky(scene);

  // ── Main camera ───────────────────────────────────────────────────────────
  const camera  = new THREE.PerspectiveCamera(65, W / H, 0.1, TRACK_LENGTH * 2);
  // Cars move in -Z (into scene). Camera sits CAM_BACK behind car0 in Z.
  // camPos.z is updated exactly each frame (no lerp) to prevent depth lag.
  const camPos  = new THREE.Vector3(laneX[0] * 0.15, CAM_HEIGHT, CAM_BACK);
  const lookTgt = new THREE.Vector3(laneX[0] * 0.1, 0.3, -CAM_AHEAD);
  camera.position.copy(camPos);
  camera.lookAt(lookTgt);

  // ── HUD overlay (orthographic second pass) ────────────────────────────────
  // OrthographicCamera(left, right, top, bottom, near, far)
  // top=H, bottom=0 so Y increases upward — matched by the canvas flipY default.
  const hudScene  = new THREE.Scene();
  const hudCamera = new THREE.OrthographicCamera(0, W, H, 0, -1, 1);
  const hud = makeHudPlane(W, H, hudScene);

  // ── World geometry ────────────────────────────────────────────────────────
  buildRoad(scene, N, laneX, track);   // track supplies exact pothole positions
  const finishMesh = buildFinishLine(scene);
  buildPanelki(scene, rng);
  buildBirchTrees(scene, rng);
  buildLampPosts(scene);
  buildRoadFurniture(scene);
  buildSkyline(scene);

  // ── Car model containers ─────────────────────────────────────────────────
  // Start at z=-10 so cars are in front of the camera immediately
  const carMeshes = Array.from({ length: N }, (_, i) => {
    const group = new THREE.Group();
    group.position.set(laneX[i], 0, -10);
    scene.add(group);
    return group;
  });

  // ── Per-car animation state (presentation layer only) ────────────────────
  // Populated by loadCarModel once the GLB is parsed.
  const carAnims = Array.from({ length: N }, () => ({
    wheels:     [],    // Object3D refs for wheel nodes found by name in the GLB
    body:       null,  // model root Group — receives pitch, roll, jolt Y
    wheelAngle: 0,     // accumulated wheel rotation (radians)
    joltAge:    -1,    // render frames since pothole jolt began (-1 = none active)
    prevHit:    false, // hit state last frame — used to edge-detect jolt onset
  }));

  // ── Exhaust and dust particle systems ─────────────────────────────────────
  const exhaustSystems = makeExhaustSystems(scene, N);
  const dustPool       = makeDustPool(scene);

  // ── Confetti particle system ──────────────────────────────────────────────
  const confetti = makeConfettiSystem(scene);

  // ── Animation state ───────────────────────────────────────────────────────
  // playhead is the single source of truth for playback position.
  // It is a float in [0, history.length - 1] that advances by 1/PHYS_PER_FRAME
  // ONLY while the race is actively playing (not during countdown or end sequence).
  // physTick and alpha are both derived from it, so they are always 0 during
  // the countdown and frozen at the final tick during the end sequence — no shaking.
  let playhead      = 0;
  let lastOnTickIdx = 0;  // tracks the last integer tick boundary for onTick() calls
  let frameCount    = 0;
  let endFrame      = -1;
  let cancelled     = false;
  let rafId         = null;

  // ── GLB car model loader ──────────────────────────────────────────────────
  const GLB_URL = 'https://cdn.jsdelivr.net/gh/castlejnr2-droid/lada-car-racing@main/frontend/public/car.glb';

  function loadCarModel() {
    return new Promise((resolve) => {
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);

      console.log('[replay] loading car.glb from:', GLB_URL);

      loader.load(
        GLB_URL,
        (gltf) => {
          console.log('[replay] car.glb loaded. scene children:', gltf.scene.children.length, gltf.scene.children.map(c => c.name || c.type));
          if (cancelled) { resolve(); return; }

          let meshCount = 0;
          gltf.scene.traverse((child) => { if (child.isMesh) meshCount++; });
          console.log('[replay] mesh count in GLB:', meshCount);

          // Log bounding box of raw GLB to understand native model size
          const tmpBox = new THREE.Box3().setFromObject(gltf.scene);
          const tmpSize = new THREE.Vector3();
          tmpBox.getSize(tmpSize);
          console.log('[replay] GLB native bounding box size:', tmpSize.x.toFixed(3), tmpSize.y.toFixed(3), tmpSize.z.toFixed(3));

          for (const [i, group] of carMeshes.entries()) {
            const model = gltf.scene.clone(true);
            model.scale.setScalar(CAR_SCALE);
            model.rotation.y = 0;
            model.position.y = 0.5;
            model.frustumCulled = false;

            const tint = CAR_TINTS[i % CAR_TINTS.length];
            let clonedMeshes = 0;

            model.traverse((child) => {
              if (child.isMesh) {
                clonedMeshes++;
                child.frustumCulled = false;

                // MeshLambertMaterial: supports textures + lighting without heavy
                // PBR, which breaks in some Telegram WebView GL implementations.
                const src       = child.material;
                const baseColor = src?.color ? src.color.clone() : new THREE.Color(0xcccccc);
                let emissive    = new THREE.Color(0x000000);

                if (tint) {
                  // Lerp toward the tint hue so the colour reads clearly at
                  // race-camera distance even on small phone screens.
                  baseColor.lerp(tint, TINT_STRENGTH);
                  // Low-intensity emissive prevents the tint from going muddy in
                  // shadow areas (no overdraw cost on Lambert).
                  emissive = tint.clone().multiplyScalar(0.14);
                } else {
                  // Car 0 keeps original model colours; a tiny warm emissive
                  // lifts it out of shadow without shifting the hue.
                  emissive = new THREE.Color(0x14100a);
                }

                child.material = new THREE.MeshLambertMaterial({
                  color:       baseColor,
                  map:         src?.map         ?? null,
                  emissiveMap: src?.emissiveMap ?? null,
                  emissive,
                });
                child.castShadow    = false;
                child.receiveShadow = false;
              }
            });

            // Collect wheel nodes by name for rotation animation.
            // Falls back gracefully if the GLB uses non-standard naming.
            const wheelNodes = [];
            model.traverse((child) => {
              if (/wheel|tire|tyre|rim/i.test(child.name)) wheelNodes.push(child);
            });
            carAnims[i].wheels = wheelNodes;
            carAnims[i].body   = model;
            console.log('[replay] car', i,
              '| wheels found:', wheelNodes.length > 0 ? wheelNodes.map(w => w.name).join(', ') : 'none (rotation skipped)',
              '| meshes:', clonedMeshes,
              '| tint:', tint ? `#${tint.getHexString()}` : 'original',
            );

            group.add(model);
          }
          console.log('[replay] camera pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
          resolve();
        },
        (xhr) => {
          if (xhr.total) console.log('[replay] car.glb progress:', Math.round(xhr.loaded / xhr.total * 100) + '%');
        },
        (err) => {
          console.error('[replay] car.glb FAILED to load:', err);
          // Spawn bright red box at each car position so we can confirm scene is working
          if (!cancelled) {
            const fallbackMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
            for (const group of carMeshes) {
              const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 3.2), fallbackMat);
              box.position.y = 0.5;
              box.frustumCulled = false;
              group.add(box);
            }
          }
          resolve();
        },
      );
    });
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  function loop() {
    if (cancelled) return;
    frameCount++;

    const cdActive = frameCount <= COUNTDOWN_TOTAL;
    const racing   = !cdActive && endFrame < 0;

    // Advance playhead only while the race is actively playing.
    // This is the ONLY place playhead moves — countdown and end sequence leave
    // it frozen, which guarantees alpha=0 and no inter-tick oscillation.
    if (racing) {
      playhead = Math.min(playhead + 1 / PHYS_PER_FRAME, sim.history.length - 1);
    }

    // Derive physTick and interpolation alpha from the single playhead float.
    const physTickF = Math.floor(playhead);
    const physTick  = Math.min(physTickF, sim.history.length - 1);
    // alpha is the fractional part — zero when not racing or at the final tick.
    const alpha = (racing && physTick < sim.history.length - 1)
      ? (playhead - physTickF)
      : 0;

    // Fire onTick when physTick crosses a new integer boundary during racing.
    if (racing && physTick > lastOnTickIdx) {
      lastOnTickIdx = physTick;
      onTick?.(physTick, sim);
    }

    // Transition to the end sequence when playhead reaches the last tick.
    if (racing && playhead >= sim.history.length - 1) {
      endFrame = 0;
    } else if (!cdActive && endFrame >= 0) {
      endFrame++;
    }

    const curr = sim.history[physTick];
    const next = sim.history[Math.min(physTick + 1, sim.history.length - 1)];

    // Update car world positions and presentation animations
    for (let i = 0; i < N; i++) {
      const interpPos   = curr.positions[i] + (next.positions[i] - curr.positions[i]) * alpha;
      const interpSpeed = curr.speeds[i]    + (next.speeds[i]    - curr.speeds[i])    * alpha;
      const hit         = curr.hits[i];
      const anim        = carAnims[i];

      // ── Pothole jolt (edge-detect on hit onset) ───────────────────────────
      const hitJustStarted = hit && !anim.prevHit;
      if (hitJustStarted) anim.joltAge = 0;
      anim.prevHit = hit;
      if (anim.joltAge >= 0) anim.joltAge++;
      if (anim.joltAge > JOLT_FRAMES) anim.joltAge = -1;

      // ── Group position (X fixed, Y = road bounce, Z = race progress) ─────
      // Bounce only while racing — zero during countdown and end sequence.
      const bounce = racing
        ? Math.sin((frameCount / PHYS_PER_FRAME) * 0.32 + i * 1.85) * Math.max(0, interpSpeed - 1.2) * 0.04
        : 0;
      carMeshes[i].position.x = laneX[i];
      carMeshes[i].position.y = bounce;
      carMeshes[i].position.z = -interpPos;

      // ── Body pitch, roll, and jolt (applied to model root, not the group) ─
      if (anim.body) {
        const t = anim.joltAge >= 0 ? anim.joltAge / JOLT_FRAMES : 1;
        const decay = Math.exp(-t * 3.5);
        // Sharp Y kick on impact, decays over JOLT_FRAMES
        const joltY  = anim.joltAge >= 0 ? 0.20 * decay : 0;
        // Nose pitches down as the front wheel drops into the pothole
        const pitchX = anim.joltAge >= 0 ? -0.09 * decay : 0;
        // Gentle continuous sway — only while racing so cars sit still during countdown
        const swayZ  = racing ? Math.sin((frameCount / PHYS_PER_FRAME) * 0.55 + i * 2.3) * 0.018 : 0;

        anim.body.position.y = 0.5 + joltY;
        anim.body.rotation.x = pitchX;
        anim.body.rotation.z = swayZ;
      }

      // ── Wheel rotation ────────────────────────────────────────────────────
      // Distance per render frame = speed / PHYS_PER_FRAME; angle = dist / radius
      if (anim.wheels.length > 0) {
        anim.wheelAngle -= interpSpeed / (WHEEL_RADIUS * PHYS_PER_FRAME);
        for (const w of anim.wheels) w.rotation.x = anim.wheelAngle;
      }

      // ── Exhaust particles ─────────────────────────────────────────────────
      if (endFrame < 0) {
        updateExhaust(exhaustSystems[i], carMeshes[i].position, interpSpeed, frameCount);
      }

      // ── Dust burst on pothole hit onset ───────────────────────────────────
      if (hitJustStarted && endFrame < 0) {
        triggerDustBurst(dustPool, carMeshes[i].position);
      }
    }

    // Advance dust particles every frame regardless of car count
    animateDust(dustPool);

    // Interpolated positions for the HUD progress bar (same alpha keeps bar smooth)
    const interpPositions = curr.positions.map(
      (p, i) => p + (next.positions[i] - p) * alpha,
    );

    // Follow the leading car (furthest in -Z = most negative Z).
    // Z tracks exactly to prevent sideways drift from lag.
    let leadIdx = 0;
    for (let i = 1; i < N; i++) {
      if (carMeshes[i].position.z < carMeshes[leadIdx].position.z) leadIdx = i;
    }
    const pz = carMeshes[leadIdx].position.z;
    camPos.x += (laneX[leadIdx] * 0.15 - camPos.x) * CAM_LERP;
    camPos.y += (CAM_HEIGHT             - camPos.y) * CAM_LERP;
    camPos.z  = pz + CAM_BACK;
    camera.position.copy(camPos);
    lookTgt.set(laneX[leadIdx] * 0.1, 0.3, pz - CAM_AHEAD);
    camera.lookAt(lookTgt);

    // Finish line glow pulses during celebration
    finishMesh.material.emissiveIntensity = endFrame >= END_DRIVE ? 2.0 : 0.4;

    // Confetti burst for winner
    const celebFrame = endFrame >= END_DRIVE ? endFrame - END_DRIVE : -1;
    if (celebFrame >= 0 && celebFrame < END_CELEBRATE) {
      animateConfetti(confetti, carMeshes[sim.winner].position, celebFrame);
    }

    // Draw 2D HUD onto the overlay canvas
    drawHud(
      hud.ctx, W, H, N,
      interpPositions, playerNames,
      carMeshes, camera,
      cdActive ? frameCount : -1,
      celebFrame,
    );
    hud.tex.needsUpdate = true;

    // Drift cloud layers laterally — each layer at a different speed for depth
    for (const cl of clouds) {
      cl.mesh.position.x += cl.speed;
      if (cl.mesh.position.x > 320) cl.mesh.position.x -= 640;
    }

    // Render: 3D scene first, then 2D HUD on top
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);

    if (frameCount === 1) {
      const info = renderer.info.render;
      console.log('[replay] frame 1 render stats — calls:', info.calls,
        '| triangles:', info.triangles,
        '| scene children:', scene.children.length,
        '| cam pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2),
        '| cam target:', lookTgt.x.toFixed(2), lookTgt.y.toFixed(2), lookTgt.z.toFixed(2),
        '| car0 pos:', carMeshes[0]?.position.x.toFixed(2), carMeshes[0]?.position.y.toFixed(2), carMeshes[0]?.position.z.toFixed(2),
        '| car0 children:', carMeshes[0]?.children.length);
    }

    if (endFrame >= END_TOTAL) { onComplete?.(); return; }
    rafId = requestAnimationFrame(loop);
  }

  // Hold loop until GLB is loaded
  loadCarModel().then(() => {
    if (!cancelled) rafId = requestAnimationFrame(loop);
  });

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    canvas.style.imageRendering = '';
    renderer.dispose();
  };
}

// ─── Road ──────────────────────────────────────────────────────────────────────
// Asphalt + grass shoulders + edge lines + pothole decals at exact sim positions.
function buildRoad(scene, N, laneX, track) {
  const Z_START =  25;
  const Z_END   = -(TRACK_LENGTH * 1.35);
  const LEN     = Z_START - Z_END;
  const midZ    = (Z_START + Z_END) / 2;

  // Asphalt, grass, earth — colors from SCENE_THEME
  scene.add(Object.assign(
    new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, LEN),
      new THREE.MeshLambertMaterial({ color: SCENE_THEME.roadColor })),
    { rotation: new THREE.Euler(-Math.PI / 2, 0, 0), position: new THREE.Vector3(0, 0, midZ) },
  ));

  const GRASS_W = 7;
  const grassMat = new THREE.MeshLambertMaterial({ color: SCENE_THEME.groundColor });
  const earthMat = new THREE.MeshLambertMaterial({ color: SCENE_THEME.earthColor });
  const EARTH_W  = 110;
  for (const sx of [-1, 1]) {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(GRASS_W, LEN), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(sx * (ROAD_W / 2 + GRASS_W / 2), -0.005, midZ);
    scene.add(grass);

    const earth = new THREE.Mesh(new THREE.PlaneGeometry(EARTH_W, LEN), earthMat);
    earth.rotation.x = -Math.PI / 2;
    earth.position.set(sx * (ROAD_W / 2 + GRASS_W + EARTH_W / 2), -0.01, midZ);
    scene.add(earth);
  }

  // Edge lines + dashed centre line
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  for (const ex of [-ROAD_W / 2, ROAD_W / 2]) {
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ex, 0.03, Z_START),
        new THREE.Vector3(ex, 0.03, Z_END),
      ]), edgeMat));
  }
  const dashMat    = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 7, gapSize: 7 });
  const centerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.03, Z_START),
      new THREE.Vector3(0, 0.03, Z_END),
    ]), dashMat);
  centerLine.computeLineDistances();
  scene.add(centerLine);

  // ── Pothole decals — placed at exact sim pothole positions ─────────────────
  // Merged into one draw call so 28 decals cost the same as 1.
  if (track) {
    const potTex  = makePotholeTexture();
    const potMat  = new THREE.MeshBasicMaterial({
      map: potTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const decalGeos = [];
    for (let lane = 0; lane < track.lanes.length && lane < N; lane++) {
      const lx = laneX[lane];
      for (const pz of track.lanes[lane].potholes) {
        const g = new THREE.PlaneGeometry(2.2, 2.2);
        g.rotateX(-Math.PI / 2);
        g.translate(lx, 0.01, -pz);
        decalGeos.push(g);
      }
    }
    if (decalGeos.length > 0) {
      const merged = mergeGeometries(decalGeos);
      decalGeos.forEach(g => g.dispose());
      const m = new THREE.Mesh(merged, potMat);
      m.renderOrder = 1;
      scene.add(m);
    }
  }
}

// ─── Finish line ───────────────────────────────────────────────────────────────
function buildFinishLine(scene) {
  const fc   = document.createElement('canvas');
  fc.width   = 128;
  fc.height  = 32;
  const fctx = fc.getContext('2d');
  const sq   = 16;
  for (let col = 0; col < fc.width / sq; col++) {
    for (let row = 0; row < fc.height / sq; row++) {
      fctx.fillStyle = (col + row) % 2 === 0 ? '#f4f0e8' : '#111116';
      fctx.fillRect(col * sq, row * sq, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(fc);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(ROAD_W / 4, 1);

  const geo  = new THREE.PlaneGeometry(ROAD_W, 3.5);
  const mat  = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: new THREE.Color(0xffd700),
    emissiveIntensity: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.015, -TRACK_LENGTH);
  scene.add(mesh);

  const postMat = new THREE.MeshLambertMaterial({ color: 0xddcc88, emissive: new THREE.Color(0xffd700), emissiveIntensity: 0.3 });
  for (const sx of [-ROAD_W / 2, ROAD_W / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), postMat);
    post.position.set(sx, 3, -TRACK_LENGTH);
    scene.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 0.25, 0.25, 0.25), postMat);
  bar.position.set(0, 6, -TRACK_LENGTH);
  scene.add(bar);

  return mesh;
}

// ─── Soviet panel apartment blocks (panelki) ───────────────────────────────────
// Three facade texture variants. All buildings per variant+side are merged into
// one geometry — 3 variants × 2 sides = 6 draw calls for the entire streetscape.
// Panel seam lines are baked into the textures, eliminating hundreds of seam meshes.
function buildPanelki(scene, rng) {
  // Variant definitions: [bg colour hex string, window colour hex string, base colour int]
  const VARIANTS = [
    { bg: '#c8bfa8', win: '#8bb8cc', base: 0xC8BFA8 },  // beige / sky-blue windows
    { bg: '#b4b0a0', win: '#6ea8ba', base: 0xB4B0A0 },  // mid-gray / muted windows
    { bg: '#d0c8b4', win: '#9ac8d8', base: 0xD0C8B4 },  // warm tan / bright windows
  ];

  // One window+seam texture per variant (shared across all buildings of that variant)
  const textures = VARIANTS.map(({ bg, win }) => makeWinTex(bg, win));
  const materials = VARIANTS.map(({ base }, vi) =>
    new THREE.MeshLambertMaterial({ color: base, map: textures[vi] }),
  );

  const CLEARANCE = ROAD_W / 2 + 22;

  for (const side of [-1, 1]) {
    // Geometry buckets — one per variant (buildings assigned round-robin by rng)
    const buckets = [[], [], []];

    let z = 0;
    while (z < TRACK_LENGTH * 1.2) {
      const floorCount = 6  + Math.floor(rng() * 11);  // 6–16 stories
      const bayCount   = 5  + Math.floor(rng() * 9);   // 5–13 bays
      const h     = floorCount * 3.0;
      const w     = bayCount   * 3.5;
      const depth = 10 + rng() * 8;
      const gap   =  4 + rng() * 12;
      const xOff  = rng() * 8;
      const vi    = Math.floor(rng() * 3);              // variant index

      const bx = side * (CLEARANCE + w / 2 + xOff);
      const bz = -(z + depth / 2);

      const geo = new THREE.BoxGeometry(w, h, depth);
      geo.translate(bx, h / 2, bz);
      buckets[vi].push(geo);

      z += depth + gap;
    }

    // Merge each bucket into one mesh per variant — 3 draw calls per side
    for (let vi = 0; vi < 3; vi++) {
      if (buckets[vi].length === 0) continue;
      const merged = mergeGeometries(buckets[vi]);
      buckets[vi].forEach(g => g.dispose());
      scene.add(new THREE.Mesh(merged, materials[vi]));
    }
  }
}

// ─── Birch trees ───────────────────────────────────────────────────────────────
// Two InstancedMesh objects (trunks + leaf puffs) = 2 draw calls for all trees.
// Bark rings removed — invisible at race distance and expensive per-tree.
function buildBirchTrees(scene, rng) {
  const TREE_X   = ROAD_W / 2 + 4.0;
  const COUNT    = 22;                           // trees per side
  const SIDES    = 2;
  const MAX_PUFFS_PER = 5;
  const TOTAL_TREES = COUNT * SIDES;
  const TOTAL_PUFFS = TOTAL_TREES * MAX_PUFFS_PER;

  const trunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.20, 0.28, 1, 7),  // height=1, scaled per instance
    new THREE.MeshLambertMaterial({ color: 0xf0ece8 }),
    TOTAL_TREES,
  );
  trunkInst.frustumCulled = false;
  scene.add(trunkInst);

  const leafInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 5),             // r=1, scaled per instance
    new THREE.MeshLambertMaterial({ color: 0x4a8828 }),
    TOTAL_PUFFS,
  );
  leafInst.frustumCulled = false;
  scene.add(leafInst);

  const dummy = new THREE.Object3D();
  let tIdx = 0, pIdx = 0;

  for (const sx of [-TREE_X, TREE_X]) {
    for (let i = 0; i < COUNT; i++) {
      const wz     = -(i / COUNT) * TRACK_LENGTH * 1.15;
      const jitter = (rng() - 0.5) * 2.2;
      const trunkH = 7.0 + rng() * 2.5;
      const tx     = sx + jitter;

      // Trunk instance — scale Y = trunk height, X/Z = trunk radius
      dummy.position.set(tx, trunkH / 2, wz);
      dummy.scale.set(1, trunkH, 1);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(tIdx++, dummy.matrix);

      // Leaf puff instances
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs && pIdx < TOTAL_PUFFS; p++) {
        const r  = 1.1 + rng() * 0.9;
        const cx = (rng() - 0.5) * 1.8;
        const cy = trunkH + 1.2 + rng() * 1.6;
        const cz = (rng() - 0.5) * 1.8;
        dummy.position.set(tx + cx, cy, wz + cz);
        dummy.scale.setScalar(r);
        dummy.updateMatrix();
        leafInst.setMatrixAt(pIdx++, dummy.matrix);
      }
    }
  }

  // Park any remaining leaf slots far below scene
  dummy.position.set(0, -2000, 0);
  dummy.scale.setScalar(0.001);
  dummy.updateMatrix();
  for (let i = pIdx; i < TOTAL_PUFFS; i++) leafInst.setMatrixAt(i, dummy.matrix);

  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate  = true;
}

// ─── Streetlights with cobra-head lamps and power lines ───────────────────────
// Poles, arms, and housings are merged into 3 draw calls total (+ lines + glow).
// An additive glow disc batch under each lamp head adds visible street lighting
// without shadows or postprocessing.
function buildLampPosts(scene) {
  const POLE_H = 7;
  const SIDE_X = ROAD_W / 2 + 1.8;
  const COUNT  = 12;

  const poleMat = new THREE.MeshLambertMaterial({ color: 0x606068 });
  const headMat = new THREE.MeshLambertMaterial({
    color: 0xffe8a0, emissive: new THREE.Color(0xffd060), emissiveIntensity: 1.2,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffee80, transparent: true, opacity: 0.20,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });

  const poleGeos = [], armGeos = [], headGeos = [], glowGeos = [];

  for (const sx of [-SIDE_X, SIDE_X]) {
    const armDir = sx < 0 ? 1 : -1;
    const poleZ  = [];

    for (let i = 0; i < COUNT; i++) {
      const wz = -(i / (COUNT - 1)) * TRACK_LENGTH;
      poleZ.push(wz);

      // Pole — CylinderGeometry is already vertical; just translate
      const pg = new THREE.CylinderGeometry(0.06, 0.11, POLE_H, 6);
      pg.translate(sx, POLE_H / 2, wz);
      poleGeos.push(pg);

      // Arm
      const ag = new THREE.BoxGeometry(1.5, 0.09, 0.09);
      ag.translate(sx + armDir * 0.75, POLE_H, wz);
      armGeos.push(ag);

      // Visor (same material as poles/arms)
      const vg = new THREE.BoxGeometry(0.85, 0.07, 0.58);
      vg.translate(sx + armDir * 1.5, POLE_H + 0.06, wz);
      armGeos.push(vg);

      // Lamp housing (emissive material)
      const hg = new THREE.BoxGeometry(0.75, 0.18, 0.50);
      hg.translate(sx + armDir * 1.5, POLE_H - 0.09, wz);
      headGeos.push(hg);

      // Additive glow disc — small circle under each lamp head
      const gg = new THREE.CircleGeometry(0.85, 8);
      gg.rotateX(Math.PI / 2);  // face upward (light shining down)
      gg.translate(sx + armDir * 1.5, POLE_H - 0.22, wz);
      glowGeos.push(gg);
    }

    // Power wires with catenary sag
    const wireY = POLE_H - 0.3;
    for (let i = 0; i < poleZ.length - 1; i++) {
      const z0 = poleZ[i], z1 = poleZ[i + 1];
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(sx, wireY,       z0),
          new THREE.Vector3(sx, wireY - 0.5, (z0 + z1) / 2),
          new THREE.Vector3(sx, wireY,       z1),
        ]), wireMat));
    }
  }

  // 4 merged draw calls for all lamp geometry
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(armGeos),  poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(headGeos), headMat));
  scene.add(new THREE.Mesh(mergeGeometries(glowGeos), glowMat));
  [...poleGeos, ...armGeos, ...headGeos, ...glowGeos].forEach(g => g.dispose());

  // 4 point lights along road centre for warm ambient fill
  for (let i = 0; i < 4; i++) {
    const pt = new THREE.PointLight(0xffcc44, 0.7, 65);
    pt.position.set(0, POLE_H - 1, -(i / 3) * TRACK_LENGTH);
    scene.add(pt);
  }
}

// ─── Road furniture: Soviet star sign + speed signs + billboards ───────────────
function buildRoadFurniture(scene) {
  const poleMat  = new THREE.MeshLambertMaterial({ color: 0x888890 });

  // ── Red Soviet star on a tall pole at the start ───────────────────────────
  const STAR_POLE_H = 10;
  const starPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, STAR_POLE_H, 8), poleMat);
  starPole.position.set(ROAD_W / 2 + 3.5, STAR_POLE_H / 2, -8);
  scene.add(starPole);

  const sc = document.createElement('canvas');
  sc.width = 128; sc.height = 128;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#cc1111';
  sctx.fillRect(0, 0, 128, 128);
  sctx.fillStyle = '#ffdd00';
  sctx.font = 'bold 96px serif';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('★', 64, 68);
  const starTex = new THREE.CanvasTexture(sc);
  const starMat = new THREE.MeshLambertMaterial({
    map: starTex,
    emissive: new THREE.Color(0xff2200),
    emissiveIntensity: 0.5,
  });
  const starSign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), starMat);
  starSign.position.set(ROAD_W / 2 + 3.5, STAR_POLE_H + 1.1, -8);
  scene.add(starSign);
  const starBack = starSign.clone();
  starBack.rotation.y = Math.PI;
  scene.add(starBack);

  // ── Speed limit & warning road signs ─────────────────────────────────────
  const signs = [
    { z: -15,                    sx: -(ROAD_W / 2 + 2.8), label: '60', type: 'speed' },
    { z: -TRACK_LENGTH * 0.35,   sx:   ROAD_W / 2 + 2.8,  label: '!',  type: 'warn'  },
    { z: -TRACK_LENGTH * 0.7,    sx: -(ROAD_W / 2 + 2.8), label: '40', type: 'speed' },
  ];

  for (const { z, sx, label, type } of signs) {
    const sc2 = document.createElement('canvas');
    sc2.width = 64; sc2.height = 64;
    const ctx2 = sc2.getContext('2d');

    if (type === 'speed') {
      // Red circle — speed limit sign
      ctx2.fillStyle = '#ffffff';
      ctx2.fillRect(0, 0, 64, 64);
      ctx2.strokeStyle = '#cc1111';
      ctx2.lineWidth = 6;
      ctx2.beginPath(); ctx2.arc(32, 32, 28, 0, Math.PI * 2); ctx2.stroke();
      ctx2.fillStyle = '#111111';
      ctx2.font = 'bold 26px sans-serif';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText(label, 32, 33);
    } else {
      // Yellow triangle — warning sign
      ctx2.fillStyle = '#ffdd00';
      ctx2.beginPath(); ctx2.moveTo(32, 4); ctx2.lineTo(60, 58); ctx2.lineTo(4, 58); ctx2.closePath(); ctx2.fill();
      ctx2.strokeStyle = '#cc1111'; ctx2.lineWidth = 4; ctx2.stroke();
      ctx2.fillStyle = '#cc1111';
      ctx2.font = 'bold 28px sans-serif';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText(label, 32, 38);
    }

    const pH = 3.8;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, pH, 5), poleMat);
    sp.position.set(sx, pH / 2, z);
    scene.add(sp);

    const sMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(sc2), side: THREE.DoubleSide }),
    );
    sMesh.position.set(sx, pH + 0.55, z);
    scene.add(sMesh);
  }

  // ── Distant billboards ────────────────────────────────────────────────────
  const bbColors = [0xc8472b, 0x22558a, 0x2a7a38];
  const bbDefs   = [
    { z: -TRACK_LENGTH * 0.2, side: -1 },
    { z: -TRACK_LENGTH * 0.55, side:  1 },
    { z: -TRACK_LENGTH * 0.85, side: -1 },
  ];

  for (let i = 0; i < bbDefs.length; i++) {
    const { z, side } = bbDefs[i];
    const bbX  = side * (ROAD_W / 2 + 32);
    const bbH  = 5 + i * 0.8;
    const bbMat = new THREE.MeshLambertMaterial({ color: bbColors[i % bbColors.length] });
    const supMat = new THREE.MeshLambertMaterial({ color: 0x505055 });

    // Two support posts
    for (const dx of [-2.8, 2.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, bbH, 0.28), supMat);
      post.position.set(bbX + dx, bbH / 2, z);
      scene.add(post);
    }
    // Billboard panel
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.2, 0.2), bbMat);
    panel.position.set(bbX, bbH + 1.6, z);
    scene.add(panel);
    // White border strip
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 3.5, 0.15),
      new THREE.MeshLambertMaterial({ color: 0xf0ece4 }),
    );
    border.position.set(bbX, bbH + 1.6, z + 0.1);
    scene.add(border);
    // Colored face on top of border
    const face = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.2, 0.1), bbMat);
    face.position.set(bbX, bbH + 1.6, z + 0.2);
    scene.add(face);
  }
}

// ─── Sky with gradient and drifting cloud layers ──────────────────────────────
// Returns an array of { mesh, speed } for the main loop to drift laterally.
// Three cloud layers drift at different speeds for a parallax depth effect.
// All puffs per layer are merged into one geometry — 3 draw calls for all clouds.
function buildSky(scene) {
  // Gradient sky sphere — colours from SCENE_THEME for Phase 3 swappability
  const [hr, hg, hb] = SCENE_THEME.skyHorizon;
  const [zr, zg, zb] = SCENE_THEME.skyZenith;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(TRACK_LENGTH * 1.8, 18, 10),
    new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: new THREE.Vector3(hr, hg, hb) },
        uZenith:  { value: new THREE.Vector3(zr, zg, zb) },
      },
      vertexShader: /* glsl */`
        varying float vY;
        void main() {
          vY = (modelMatrix * vec4(position, 1.0)).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying float vY;
        void main() {
          float t = clamp(vY / 800.0, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.6)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  scene.add(sky);

  // Cloud layers — 3 groups merged separately, drifting at different speeds.
  // Using Math.random() (not seeded rng) so clouds vary each session cosmetically.
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xfafcff, transparent: true, opacity: 0.86,
  });

  // Each layer: array of cluster centres + drift speed
  const LAYERS = [
    { centres: [[-90,65,-120],[60,72,-400],[-30,60,-750]], speed: 0.022 },
    { centres: [[50,68,-200],[-70,74,-550],[110,62,-880],[-20,70,-1050]], speed: 0.038 },
    { centres: [[-110,58,-60],[80,66,-650],[-50,62,-970]], speed: 0.056 },
  ];

  const cloudMeshes = LAYERS.map(({ centres, speed }) => {
    const geos = [];
    for (const [cx, cy, cz] of centres) {
      const puffs = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const r = 8 + Math.random() * 10;
        const g = new THREE.SphereGeometry(r, 7, 5);
        g.scale(1, 0.38, 1);           // flatten into a disk shape
        g.translate(
          cx + (Math.random() - 0.5) * 24,
          cy + (Math.random() - 0.5) * 3,
          cz + (Math.random() - 0.5) * 14,
        );
        geos.push(g);
      }
    }
    const merged = mergeGeometries(geos);
    geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, cloudMat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, speed };
  });

  return cloudMeshes;
}

// ─── HUD canvas overlay ────────────────────────────────────────────────────────
// Creates a full-screen transparent plane in the ortho scene, backed by a
// canvas texture.  Caller updates the canvas each frame and sets tex.needsUpdate.
function makeHudPlane(W, H, hudScene) {
  const hudCanvas  = document.createElement('canvas');
  hudCanvas.width  = W;
  hudCanvas.height = H;
  const ctx = hudCanvas.getContext('2d');

  // flipY=true (default): canvas Y=0 (top) maps to plane top — matches ortho
  // camera where top=H, bottom=0 (Y increases upward).
  const tex  = new THREE.CanvasTexture(hudCanvas);
  const geo  = new THREE.PlaneGeometry(W, H);
  const mat  = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(W / 2, H / 2, 0);
  hudScene.add(mesh);

  return { canvas: hudCanvas, ctx, tex, mesh };
}

// ─── HUD drawing ──────────────────────────────────────────────────────────────
function drawHud(ctx, W, H, N, positions, playerNames, carMeshes, camera, cdFrame, celebFrame) {
  ctx.clearRect(0, 0, W, H);

  // ── Progress bar (top of screen) ──────────────────────────────────────────
  const barH = 5;
  const barY = 3;   // canvas Y=0 is screen-top (flipY + ortho cancel out)
  ctx.fillStyle = 'rgba(20,22,28,0.7)';
  ctx.fillRect(0, barY - 1, W, barH + 2);
  for (let i = 0; i < N; i++) {
    const pct = Math.min(1, positions[i] / TRACK_LENGTH);
    ctx.fillStyle = HUD_COLORS[i % HUD_COLORS.length];
    ctx.fillRect(0, barY + i * (barH / N), W * pct, barH / N);
  }

  // ── Player name labels (projected car positions) ──────────────────────────
  for (let i = 0; i < N; i++) {
    const name = playerNames[i];
    if (!name) continue;

    // Project a point just above the car roof (~1.0 world units above the group).
    // Keeping Y small avoids the label drifting up/ahead due to perspective
    // from the low camera (Y=2.5). The group Y is ~0, model offset adds 0.5,
    // scaled car height ~1.0 — so Y=1.0 puts the label just above the roof.
    const above = carMeshes[i].position.clone();
    above.y = 1.0;
    const ndc = above.project(camera);
    if (ndc.z >= 1.0) continue;   // behind camera

    const sx = (ndc.x + 1) / 2 * W;
    // NDC Y is already in [-1,1] with +1 at top; canvas Y=0 is also at top
    // because of the flipY + ortho setup, so the 3D projection maps directly:
    const sy = (1 - (ndc.y + 1) / 2) * H;

    if (sx < -100 || sx > W + 100 || sy < 0 || sy > H) continue;

    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#ffffff';

    let label = name;
    while (label.length > 1 && ctx.measureText(label).width > 110) label = label.slice(0, -1);
    if (label.length < name.length) label = label.slice(0, -1) + '…';
    ctx.fillText(label, sx, sy);
    ctx.restore();
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  if (cdFrame > 0) drawCountdownHud(ctx, W, H, cdFrame);

  // ── Victory flash ─────────────────────────────────────────────────────────
  if (celebFrame >= 0 && celebFrame < END_CELEBRATE && celebFrame % 10 < 5) {
    ctx.fillStyle = 'rgba(255,215,40,0.14)';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawCountdownHud(ctx, W, H, frame) {
  let label, stepFrame, stepTotal;
  if      (frame <= COUNTDOWN_STEP)     { label = '3';   stepFrame = frame;                      stepTotal = COUNTDOWN_STEP; }
  else if (frame <= COUNTDOWN_STEP * 2) { label = '2';   stepFrame = frame - COUNTDOWN_STEP;     stepTotal = COUNTDOWN_STEP; }
  else if (frame <= COUNTDOWN_STEP * 3) { label = '1';   stepFrame = frame - COUNTDOWN_STEP * 2; stepTotal = COUNTDOWN_STEP; }
  else                                  { label = 'GO!'; stepFrame = frame - COUNTDOWN_STEP * 3; stepTotal = COUNTDOWN_GO;   }

  const t      = stepFrame / stepTotal;
  const alpha  = t < 0.12 ? t / 0.12 : t > 0.78 ? (1 - t) / 0.22 : 1;
  const scale  = 1 + Math.max(0, 1 - stepFrame / 12) * 0.4;
  const isGo   = label === 'GO!';
  const fsize  = Math.round(Math.min(W, H) * (isGo ? 0.20 : 0.26));
  const glow   = isGo ? '#44ff88' : '#ffd700';
  const color  = isGo ? '#44ff88' : '#ffffff';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H * 0.52);
  ctx.scale(scale, scale);
  ctx.font = `bold ${fsize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = glow; ctx.shadowBlur = 40;
  ctx.fillStyle = color;
  ctx.fillText(label, 0, 0);
  ctx.shadowBlur = 20; ctx.fillText(label, 0, 0);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(2, fsize * 0.04);
  ctx.strokeText(label, 0, 0);
  ctx.restore();
}

// ─── Distant skyline ──────────────────────────────────────────────────────────
// Large dark boxes far from the road, merged into one draw call, give the
// impression of a sprawling Soviet suburban cityscape behind the panelki.
function buildSkyline(scene) {
  const geos = [];
  for (const side of [-1, 1]) {
    const X_BASE = side * 95;
    let z = 10;
    while (z < TRACK_LENGTH * 1.05) {
      const w  = 14 + Math.random() * 22;
      const h  = 28 + Math.random() * 52;
      const d  = 8  + Math.random() * 14;
      const xO = (Math.random() - 0.5) * 28;
      const g  = new THREE.BoxGeometry(w, h, d);
      g.translate(X_BASE + xO, h / 2, -(z + d / 2));
      geos.push(g);
      z += d + 6 + Math.random() * 28;
    }
  }
  const merged = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  // Slightly darker and cooler than the panelki — reads as depth / atmosphere
  scene.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: 0x8a8c98 })));
}

// ─── Window + seam texture factory ────────────────────────────────────────────
// Panel seam lines are painted as dark horizontal stripes so no separate seam
// geometry is needed. Shared across all buildings of the same variant.
function makeWinTex(bgHex, winHex) {
  const FLOORS = 10, BAYS = 8;
  const CW = 18, CH = 16;
  const c   = document.createElement('canvas');
  c.width   = BAYS  * CW;
  c.height  = FLOORS * CH;
  const ctx = c.getContext('2d');

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, c.width, c.height);

  for (let row = 0; row < FLOORS; row++) {
    // Panel seam — dark stripe at each floor boundary
    ctx.fillStyle = 'rgba(38,32,24,0.36)';
    ctx.fillRect(0, row * CH, c.width, 2);

    for (let col = 0; col < BAYS; col++) {
      ctx.fillStyle = Math.random() > 0.28 ? winHex : '#283040';
      ctx.fillRect(col * CW + 3, row * CH + 3, CW - 6, CH - 5);
      if (Math.random() > 0.62) {
        ctx.fillStyle = 'rgba(90,82,70,0.55)';
        ctx.fillRect(col * CW + 1, row * CH + CH - 4, CW - 2, 2);
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ─── Pothole decal texture ─────────────────────────────────────────────────────
// Dark cracked oval drawn on a transparent canvas; rendered at exact sim positions.
function makePotholeTexture() {
  const c   = document.createElement('canvas');
  c.width   = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  // Outer shadow halo
  ctx.fillStyle = 'rgba(10,8,5,0.45)';
  ctx.beginPath();
  ctx.ellipse(32, 32, 30, 26, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Pothole body
  ctx.fillStyle = 'rgba(18,14,8,0.88)';
  ctx.beginPath();
  ctx.ellipse(32, 32, 22, 18, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Radiating crack lines
  ctx.strokeStyle = 'rgba(4,3,2,0.60)';
  ctx.lineWidth = 1.3;
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(ang) * 7, 32 + Math.sin(ang) * 6);
    ctx.lineTo(32 + Math.cos(ang) * 28, 32 + Math.sin(ang) * 23);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

// ─── Confetti particle system ─────────────────────────────────────────────────
const CONF_HUES = [0, 0.08, 0.13, 0.33, 0.55, 0.65, 0.90];

function makeConfettiSystem(scene) {
  const COUNT = 180;
  const pos   = new Float32Array(COUNT * 3);
  const col   = new Float32Array(COUNT * 3);
  const vel   = [];

  for (let i = 0; i < COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = (Math.random() - 0.5) * Math.PI;
    const spd   = 2 + Math.random() * 5;
    vel.push({
      x: Math.cos(theta) * Math.cos(phi) * spd,
      y: 4 + Math.random() * 6,
      z: Math.sin(theta) * Math.cos(phi) * spd,
    });
    // Start hidden well below the scene
    pos[i * 3] = 0; pos[i * 3 + 1] = -200; pos[i * 3 + 2] = 0;
    const c = new THREE.Color().setHSL(CONF_HUES[i % CONF_HUES.length], 0.9, 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  const mat    = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return { points, pos, vel, spawned: false };
}

function animateConfetti(data, winnerPos, celebFrame) {
  // On first call (celebFrame 0 or not yet spawned) reset particle origins
  if (!data.spawned || celebFrame === 0) {
    const { pos, vel } = data;
    for (let i = 0; i < vel.length; i++) {
      pos[i * 3]     = winnerPos.x + (Math.random() - 0.5) * 1.5;
      pos[i * 3 + 1] = winnerPos.y + 1;
      pos[i * 3 + 2] = winnerPos.z + (Math.random() - 0.5) * 1.5;
      const spd = 2 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi   = (Math.random() - 0.5) * Math.PI;
      vel[i].x = Math.cos(theta) * Math.cos(phi) * spd;
      vel[i].y = 4 + Math.random() * 6;
      vel[i].z = Math.sin(theta) * Math.cos(phi) * spd;
    }
    data.spawned = true;
    if (celebFrame === 0) return;
  }

  const { pos, vel } = data;
  for (let i = 0; i < vel.length; i++) {
    vel[i].y -= 0.18;                 // gravity
    pos[i * 3]     += vel[i].x * 0.05;
    pos[i * 3 + 1] += vel[i].y * 0.05;
    pos[i * 3 + 2] += vel[i].z * 0.05;
  }
  data.points.geometry.attributes.position.needsUpdate = true;
}

// ─── Exhaust particle systems ──────────────────────────────────────────────────
// One Points object per car. Particles are emitted from the car rear each frame
// when the car is moving; they drift upward and rearward then expire.
function makeExhaustSystems(scene, carCount) {
  const systems = [];
  for (let c = 0; c < carCount; c++) {
    const pos  = new Float32Array(EXHAUST_PER_CAR * 3);
    const ages = new Uint8Array(EXHAUST_PER_CAR).fill(255);    // 255 = dead
    const vel  = Array.from({ length: EXHAUST_PER_CAR }, () => ({ x: 0, y: 0, z: 0 }));

    // Park all particles below the scene so dead ones are invisible
    for (let k = 0; k < EXHAUST_PER_CAR; k++) pos[k * 3 + 1] = -500;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.30,
      color: 0xb0a898,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    systems.push({ pts, pos, ages, vel, mat, next: 0 });
  }
  return systems;
}

function updateExhaust(sys, carPos, speed, frame) {
  // Emit one particle every 2 frames while the car is moving above idle speed
  const moving = speed > 0.4 && frame % 2 === 0;
  if (moving) {
    const idx = sys.next % EXHAUST_PER_CAR;
    sys.next++;
    // Rear of car is in +Z (car faces -Z / toward finish); emit just above axle height
    sys.pos[idx * 3]     = carPos.x + (Math.random() - 0.5) * 0.22;
    sys.pos[idx * 3 + 1] = carPos.y + 0.52;
    sys.pos[idx * 3 + 2] = carPos.z + 1.4;    // +Z = behind car / toward camera
    sys.ages[idx] = 0;
    sys.vel[idx]  = {
      x: (Math.random() - 0.5) * 0.018,
      y: 0.038 + Math.random() * 0.032,        // float upward
      z: 0.030 + Math.random() * 0.028,        // drift rearward
    };
  }

  // Advance all live particles; hide dead ones
  for (let k = 0; k < EXHAUST_PER_CAR; k++) {
    if (sys.ages[k] >= EXHAUST_LIFE) {
      sys.pos[k * 3 + 1] = -500;
      continue;
    }
    sys.ages[k]++;
    sys.pos[k * 3]     += sys.vel[k].x;
    sys.pos[k * 3 + 1] += sys.vel[k].y;
    sys.pos[k * 3 + 2] += sys.vel[k].z;
  }

  // Opacity scales with speed so slow-moving cars produce lighter wisps
  sys.mat.opacity = Math.min(0.55, (speed / 6) * 0.55);
  sys.pts.geometry.attributes.position.needsUpdate = true;
}

// ─── Dust burst pool ──────────────────────────────────────────────────────────
// A pre-allocated pool of particle slots shared across all burst events.
// Each pothole hit claims a slot (round-robin), resets its particles, and
// lets them expand and fade over DUST_LIFE frames.
function makeDustPool(scene) {
  const total = DUST_MAX_BURSTS * DUST_PER_BURST;
  const pos   = new Float32Array(total * 3);
  const vel   = Array.from({ length: total }, () => ({ x: 0, y: 0, z: 0 }));
  const ages  = new Uint8Array(total).fill(255);

  for (let k = 0; k < total; k++) pos[k * 3 + 1] = -500;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.52,
    color: 0xb8aa90,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, pos, vel, ages, nextBurst: 0 };
}

function triggerDustBurst(pool, carPos) {
  const slot = pool.nextBurst % DUST_MAX_BURSTS;
  pool.nextBurst++;
  const base = slot * DUST_PER_BURST;
  for (let k = 0; k < DUST_PER_BURST; k++) {
    const idx = base + k;
    pool.pos[idx * 3]     = carPos.x + (Math.random() - 0.5) * 0.9;
    pool.pos[idx * 3 + 1] = carPos.y + 0.15 + Math.random() * 0.2;
    pool.pos[idx * 3 + 2] = carPos.z + (Math.random() - 0.5) * 0.9;
    pool.ages[idx] = 0;
    const spd = 0.05 + Math.random() * 0.07;
    const ang = Math.random() * Math.PI * 2;
    pool.vel[idx] = {
      x: Math.cos(ang) * spd,
      y: 0.045 + Math.random() * 0.055,
      z: Math.sin(ang) * spd,
    };
  }
}

function animateDust(pool) {
  const total = DUST_MAX_BURSTS * DUST_PER_BURST;
  for (let k = 0; k < total; k++) {
    if (pool.ages[k] >= DUST_LIFE) {
      pool.pos[k * 3 + 1] = -500;
      continue;
    }
    pool.ages[k]++;
    pool.vel[k].y -= 0.002;                 // light gravity
    pool.pos[k * 3]     += pool.vel[k].x;
    pool.pos[k * 3 + 1] += pool.vel[k].y;
    pool.pos[k * 3 + 2] += pool.vel[k].z;
  }
  pool.pts.geometry.attributes.position.needsUpdate = true;
}
