/**
 * menuScene.js — ambient looping 3D background for the Home screen.
 *
 * ISOLATED from runReplay, physics.js, rng.js, and all payment paths.
 *
 * Scene: a Soviet boulevard with 4 Ladas cruising past in bright colours.
 * Sky slowly cycles from sunny day (blue sky, green grass, beige panelki)
 * to a brief golden dusk and back. The cycle is biased toward the bright
 * day end so the first impression is always welcoming and sunny.
 *
 * Performance guarantees:
 *   - 24fps cap (FRAME_MS gate in RAF callback)
 *   - RAF loop stops on pause(), document.hidden, and destroy()
 *   - Double-start guarded: startLoop() checks rafId before scheduling
 *   - Theme cycle: only lerps existing uniform/colour values — no scene rebuild
 *   - Cars: single GLB load, gltf.scene.clone() per extra car, tint via
 *     per-node material.clone() — geometry shared, no extra draw calls
 *   - Merged geometry (buildings, lamp hardware, glow discs)
 *   - InstancedMesh for trees (2 draw calls)
 *   - No postprocessing, no shadows
 *
 * Cycle math:
 *   cycleAngle advances each frame. rawT = (1−cos(angle))/2 runs 0→1→0.
 *   duskT = rawT³ (cubic) keeps the scene near day for ~80% of the cycle;
 *   dusk is a brief, pretty peak.
 *   cycleAngle starts at 0 → duskT=0 → pure bright day on first open.
 *
 * Flash-free init:
 *   Canvas starts at opacity 0 (CSS). After the first rendered frame,
 *   opacity becomes 1 and the CSS transition (0.4s ease) fades it in.
 *   The .app fallback background matches the day fog colour.
 *
 * Returns { pause(), resume(), destroy() }.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Day theme: bright Soviet boulevard ───────────────────────────────────────
const THEME_DAY = {
  ambientColor:      0xdde8f0,  ambientIntensity: 4.5,
  sunColor:          0xfff4e0,  sunIntensity:     6.0,
  fogColor:          0xc0ccd8,  fogNear: 65,  fogFar: 200,
  skyHorizon:       [0.82, 0.86, 0.90],   // light blue horizon
  skyZenith:        [0.45, 0.62, 0.80],   // deep sky blue
  groundColor:       0x5a7a35,            // fresh green grass
  roadColor:         0x525252,            // grey asphalt
  treeTrunkColor:    0xf0ece8,            // white birch bark
  treeLeafColor:     0x4a8828,            // summer green
  cloudColor:        0xffffff,  cloudOpacity: 0.78,
  buildingColors:   [0xd4c8b0, 0xc8bea8, 0xdad0ba],  // warm beige Soviet panels
};

// ── Dusk theme: golden hour on the boulevard ──────────────────────────────────
const THEME_DUSK = {
  ambientColor:      0xf0d0a0,  ambientIntensity: 3.5,
  sunColor:          0xff7820,  sunIntensity:     6.5,
  fogColor:          0xd07038,  fogNear: 60,  fogFar: 185,
  skyHorizon:       [0.98, 0.55, 0.18],   // deep amber-orange
  skyZenith:        [0.22, 0.18, 0.42],   // indigo-purple
  groundColor:       0x4a6022,            // dusk-shadowed grass
  roadColor:         0x3c3830,            // near-black wet asphalt
  treeTrunkColor:    0xd0b888,            // warm amber bark
  treeLeafColor:     0x1e3c08,            // dark silhouette foliage
  cloudColor:        0xff8844,  cloudOpacity: 0.60,
  buildingColors:   [0x9a9080, 0x8a847a, 0xa89c8e],  // muted evening panels
};

// ── Cycle parameters ──────────────────────────────────────────────────────────
// Full period 80 s. rawT = (1−cos(angle))/2 ∈ [0,1]. duskT = rawT³ keeps
// ~80% of the cycle time near day (rawT < 0.7 → duskT < 0.34).
const CYCLE_PERIOD_MS = 80_000;
const CYCLE_STEP      = (2 * Math.PI) / CYCLE_PERIOD_MS;

// ── Road / scene geometry constants ──────────────────────────────────────────
const ROAD_W    = 14;
const ROAD_HALF = ROAD_W / 2;
const CAR_SCALE = 1.5;

// Loop extents — both ends invisible:
//   LOOP_START (36) is behind the camera (camera z=28, outside frustum).
//   LOOP_END (-275) is past fog far (camera z=28, fog far ≈185–200 → invisible at z<−157).
const LOOP_START =  36;
const LOOP_END   = -275;
const LOOP_LEN   = LOOP_START - LOOP_END;  // ≈ 311 world units

// ── Car fleet ─────────────────────────────────────────────────────────────────
// 4 cars: 1 hero + 3 companions. Shared GLB load; per-car tint via material clone.
// startFrac: initial position along loop (0=behind camera, 1=past fog end).
// lane: X position on road (ROAD_HALF = 7, so stay within ±6).
const CAR_CONFIGS = [
  { lane: -1.2, speed: 0.20, startFrac: 0.00, tint: 0xd42a10 },  // hero — Soviet red
  { lane:  1.2, speed: 0.13, startFrac: 0.27, tint: 0x1448c0 },  // cobalt blue
  { lane: -2.6, speed: 0.25, startFrac: 0.54, tint: 0xe0b400 },  // mustard yellow, fast
  { lane:  2.6, speed: 0.10, startFrac: 0.74, tint: 0x257a22 },  // Soviet green, slow
];

// ── Camera ────────────────────────────────────────────────────────────────────
const CAM_POS    = new THREE.Vector3(7.5, 4.2, 28);
const CAM_LOOKAT = new THREE.Vector3(0, 1.5, -35);

// ── Framerate cap ─────────────────────────────────────────────────────────────
const TARGET_FPS = 24;
const FRAME_MS   = 1000 / TARGET_FPS;  // ≈ 41.67 ms

// ── Theme update throttle ─────────────────────────────────────────────────────
// Sky, fog, light, and material colours update at most 5× per second.
// The 80-second day/dusk cycle changes imperceptibly in 200 ms, so this
// is visually identical while cutting per-frame GPU state-change work by ~80%.
const THEME_TICK_MS = 200;

// ── Car speed normalisation ───────────────────────────────────────────────────
// Speeds in CAR_CONFIGS are expressed in "world units per frame at 30fps".
// Multiplying by (delta / SPEED_FRAME_MS) gives the correct delta-time
// displacement regardless of actual framerate, so dropping to 24fps does
// not visibly slow the cars.
const SPEED_FRAME_MS = 1000 / 30;

const GLB_URL = 'https://cdn.jsdelivr.net/gh/castlejnr2-droid/lada-car-racing@main/frontend/public/car.glb';

// ── Lamp post constants (mirrors race scene proportions) ─────────────────────
const POLE_H       = 7;
const LAMP_SIDE_X  = ROAD_HALF + 1.8;
const LAMP_COUNT   = 9;
const Z_FRONT      = 30;
const Z_BACK       = -290;
const LAMP_SPACING = (Z_FRONT - Z_BACK) / (LAMP_COUNT - 1);

// ── Zero-allocation lerp helpers (module-level temp objects) ──────────────────
const _ca = new THREE.Color();
const _cb = new THREE.Color();

/** Lerp hexA toward hexB by t, copy result into target (a THREE.Color). No allocation. */
function setLerpC(target, hexA, hexB, t) {
  _ca.setHex(hexA);
  _cb.setHex(hexB);
  _ca.lerp(_cb, t);
  target.copy(_ca);
}

function lerpN(a, b, t) { return a + (b - a) * t; }

// ── Public entry point ────────────────────────────────────────────────────────
export function startMenuScene(canvas) {
  let rafId        = null;
  let paused       = false;
  let destroyed    = false;
  let lastFrameMs  = 0;
  let lastThemeMs  = 0;   // throttle: last time theme colours were pushed to GPU
  let firstFrame   = true;
  let cycleAngle   = 0;   // 0 → duskT=0 → pure day on first open

  // Per-car state — each car advances independently
  const cars = CAR_CONFIGS.map((cfg, i) => ({
    group:     new THREE.Group(),
    zPos:      LOOP_START - cfg.startFrac * LOOP_LEN,
    swayFrame: i * 23,   // stagger the gentle body-sway phase per car
    cfg,
  }));

  // Canvas starts invisible; first render fades it in (flash-free init)
  canvas.style.opacity = '0';

  // ── Renderer ──────────────────────────────────────────────────────────────
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W   = canvas.offsetWidth  || window.innerWidth  || 360;
  const H   = canvas.offsetHeight || window.innerHeight || 640;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  } catch (e) {
    console.warn('[menuScene] WebGL unavailable — static background shown:', e);
    canvas.style.opacity = '1';   // show CSS fallback colour
    return stub();
  }
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // Dark clear colour so any frame rendered before scene.background is fully
  // set (e.g. the implicit clear on context creation) is dark, not white.
  renderer.setClearColor(0x1a1a1a);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME_DAY.fogColor);
  scene.fog        = new THREE.Fog(THEME_DAY.fogColor, THEME_DAY.fogNear, THEME_DAY.fogFar);

  // Build scene; each builder returns the mutable refs needed for the theme cycle.
  const { skyMat }              = buildMenuSky(scene);
  const { cloudMesh, cloudMat } = buildMenuClouds(scene);
  const { ambientLight, sunLight } = buildMenuLighting(scene);
  const { roadMat, grassMat }   = buildMenuRoad(scene);
  const { buildingMats }        = buildMenuBuildings(scene);
  const { leafMat, trunkMat }   = buildMenuTrees(scene);
  buildMenuLampPosts(scene);

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(62, W / H, 0.5, 300);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOKAT);

  // ── Car groups ────────────────────────────────────────────────────────────
  for (const car of cars) {
    car.group.position.set(car.cfg.lane, 0, car.zPos);
    scene.add(car.group);
  }

  // Load GLB once; clone scene for each extra car and apply individual tint.
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.load(GLB_URL, (gltf) => {
    if (destroyed) return;
    for (let i = 0; i < cars.length; i++) {
      // First car gets the original scene; others get a deep clone.
      const model = i === 0 ? gltf.scene : gltf.scene.clone();
      applyCarTint(model, CAR_CONFIGS[i].tint);
      model.scale.setScalar(CAR_SCALE);
      model.rotation.y = 0;    // faces −Z (forward), same convention as race scene
      model.position.y = 0.5;
      model.frustumCulled = false;
      cars[i].group.add(model);
    }
  }, undefined, (e) => console.warn('[menuScene] car.glb failed:', e));

  // ── Render loop ───────────────────────────────────────────────────────────
  // Contract:
  //   • Only one RAF chain runs at a time — rafId guard in startLoop
  //   • rafId cleared at tick entry before re-arm (prevents double-start race)
  //   • Loop exits immediately when paused or destroyed
  //   • visibilitychange listener stops/starts loop with app focus
  //   • No allocations inside tick — all temp objects are module-level
  //
  // Work split to reduce GPU/CPU heat:
  //   EVERY rendered frame (24fps): car positions, car sway, cloud drift, draw
  //   THROTTLED (≤5× per second):   sky uniforms, fog, lights, 10 material colours
  function tick(now) {
    rafId = null;                        // clear before re-arm
    if (destroyed || paused) return;
    rafId = requestAnimationFrame(tick);

    // 24fps cap
    const delta = now - lastFrameMs;
    if (delta < FRAME_MS) return;
    lastFrameMs = now - (delta % FRAME_MS);

    // Cycle angle always advances accurately with real elapsed time
    cycleAngle += CYCLE_STEP * delta;
    if (cycleAngle > 2 * Math.PI) cycleAngle -= 2 * Math.PI;

    // ── Throttled theme update (≤5× per second) ────────────────────────────
    // Sky, fog, lights, and material colours change slowly over an 80-second
    // cycle. Updating them every 200 ms is visually identical to every frame
    // but cuts GPU state-change calls by ~80%.
    if (now - lastThemeMs >= THEME_TICK_MS) {
      lastThemeMs = now;

      const rawT = (1 - Math.cos(cycleAngle)) / 2;  // 0 → 1 → 0 per cycle
      const t    = rawT * rawT * rawT;               // cubic bias: ~80% time near day

      // Sky gradient shader uniforms (Vector3.set — in-place, no alloc)
      const DH = THEME_DAY.skyHorizon, KH = THEME_DUSK.skyHorizon;
      const DZ = THEME_DAY.skyZenith,  KZ = THEME_DUSK.skyZenith;
      skyMat.uniforms.uHorizon.value.set(
        lerpN(DH[0], KH[0], t), lerpN(DH[1], KH[1], t), lerpN(DH[2], KH[2], t),
      );
      skyMat.uniforms.uZenith.value.set(
        lerpN(DZ[0], KZ[0], t), lerpN(DZ[1], KZ[1], t), lerpN(DZ[2], KZ[2], t),
      );

      // Fog + background
      setLerpC(scene.fog.color, THEME_DAY.fogColor, THEME_DUSK.fogColor, t);
      scene.background.copy(scene.fog.color);
      scene.fog.near = lerpN(THEME_DAY.fogNear, THEME_DUSK.fogNear, t);
      scene.fog.far  = lerpN(THEME_DAY.fogFar,  THEME_DUSK.fogFar,  t);

      // Lighting
      setLerpC(ambientLight.color, THEME_DAY.ambientColor, THEME_DUSK.ambientColor, t);
      ambientLight.intensity = lerpN(THEME_DAY.ambientIntensity, THEME_DUSK.ambientIntensity, t);
      setLerpC(sunLight.color, THEME_DAY.sunColor, THEME_DUSK.sunColor, t);
      sunLight.intensity = lerpN(THEME_DAY.sunIntensity, THEME_DUSK.sunIntensity, t);

      // Ground and vegetation
      setLerpC(grassMat.color, THEME_DAY.groundColor,    THEME_DUSK.groundColor,    t);
      setLerpC(roadMat.color,  THEME_DAY.roadColor,      THEME_DUSK.roadColor,      t);
      setLerpC(leafMat.color,  THEME_DAY.treeLeafColor,  THEME_DUSK.treeLeafColor,  t);
      setLerpC(trunkMat.color, THEME_DAY.treeTrunkColor, THEME_DUSK.treeTrunkColor, t);

      // Buildings (3 colour variants)
      for (let i = 0; i < 3; i++) {
        setLerpC(buildingMats[i].color, THEME_DAY.buildingColors[i], THEME_DUSK.buildingColors[i], t);
      }

      // Cloud colour and opacity
      setLerpC(cloudMat.color, THEME_DAY.cloudColor, THEME_DUSK.cloudColor, t);
      cloudMat.opacity = lerpN(THEME_DAY.cloudOpacity, THEME_DUSK.cloudOpacity, t);
    }

    // ── Per-frame: cloud drift ─────────────────────────────────────────────
    // Delta-normalised so drift speed is unchanged regardless of framerate.
    if (cloudMesh) cloudMesh.position.x += 0.54 * (delta / 1000);  // 0.54 u/s

    // ── Per-frame: car positions and sway ──────────────────────────────────
    // Delta-normalised movement keeps apparent car speed identical at 24fps.
    // (CAR_CONFIGS speeds are in u/frame-at-30fps; * delta/SPEED_FRAME_MS
    //  converts to the correct displacement for the actual elapsed delta.)
    const moveScale = delta / SPEED_FRAME_MS;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.zPos -= car.cfg.speed * moveScale;
      if (car.zPos < LOOP_END) car.zPos = LOOP_START;
      car.group.position.z = car.zPos;
      car.swayFrame += moveScale;  // float accumulator — keeps sway rate at 30fps equiv
      car.group.rotation.z = Math.sin(car.swayFrame * 0.042 + i * 1.3) * 0.011;
    }

    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      canvas.style.opacity = '1';   // CSS transition handles the ease
    }
  }

  function startLoop() {
    if (!rafId && !destroyed && !paused && !document.hidden) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function onVisibilityChange() {
    if (document.hidden) stopLoop();
    else if (!paused) startLoop();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  startLoop();

  return {
    pause()  { paused = true;  stopLoop(); },
    resume() { paused = false; startLoop(); },
    destroy() {
      destroyed = true;
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.dispose();
    },
  };
}

function stub() {
  return { pause() {}, resume() {}, destroy() {} };
}

// ── Apply bright tint to a (possibly cloned) car model ───────────────────────
// Clones each mesh's material so cars don't share material state.
function applyCarTint(model, tintHex) {
  const tint = new THREE.Color(tintHex);
  model.traverse((node) => {
    if (!node.isMesh) return;
    const mat = node.material.clone();   // clone so tints don't bleed between cars
    mat.color.lerp(tint, 0.55);
    mat.emissive.copy(tint).multiplyScalar(0.08);
    node.material = mat;
  });
}

// ── Sky gradient sphere — GLSL shader ────────────────────────────────────────
// Returns { skyMat } so uniforms can be updated in the render loop.
function buildMenuSky(scene) {
  const [hr, hg, hb] = THEME_DAY.skyHorizon;
  const [zr, zg, zb] = THEME_DAY.skyZenith;
  const skyMat = new THREE.ShaderMaterial({
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
      precision mediump float;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying float vY;
      void main() {
        float t = clamp(vY / 160.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.55)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(280, 16, 8), skyMat));
  return { skyMat };
}

// ── Clouds — merged puffs that drift slowly west ──────────────────────────────
// Returns { cloudMesh, cloudMat } for per-frame colour and drift updates.
function buildMenuClouds(scene) {
  const cloudMat = new THREE.MeshLambertMaterial({
    color: THEME_DAY.cloudColor,
    transparent: true, opacity: THEME_DAY.cloudOpacity,
    fog: false,
  });
  const CENTRES = [
    [-60, 50, -70], [50, 58, -140], [-25, 54, -210], [85, 48, -55], [-95, 62, -280],
  ];
  const geos = [];
  for (const [cx, cy, cz] of CENTRES) {
    const puffs = 3 + Math.floor(Math.abs(Math.sin(cx * 0.07)) * 3);
    for (let p = 0; p < puffs; p++) {
      const r = 6 + Math.abs(Math.sin(p * 1.7 + cx * 0.05)) * 9;
      const g = new THREE.SphereGeometry(r, 6, 4);
      g.scale(1, 0.34, 1);
      g.translate(
        cx + Math.sin(p * 2.094) * 16,
        cy + Math.cos(p) * 2,
        cz + Math.cos(p * 2.094) * 8,
      );
      geos.push(g);
    }
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  const cloudMesh = new THREE.Mesh(merged, cloudMat);
  cloudMesh.frustumCulled = false;
  scene.add(cloudMesh);
  return { cloudMesh, cloudMat };
}

// ── Lighting — sun + ambient + static lamp-post point lights ─────────────────
// Returns { ambientLight, sunLight } for per-frame intensity/colour updates.
function buildMenuLighting(scene) {
  const ambientLight = new THREE.AmbientLight(THEME_DAY.ambientColor, THEME_DAY.ambientIntensity);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(THEME_DAY.sunColor, THEME_DAY.sunIntensity);
  sunLight.position.set(-60, 40, 80);   // elevated and slightly behind camera
  scene.add(sunLight);

  // Warm amber point lights at lamp-post positions (static — don't need per-frame update)
  for (let i = 0; i < 3; i++) {
    const pt = new THREE.PointLight(0xffaa33, 1.0, 70);
    pt.position.set(0, POLE_H - 0.5, Z_FRONT - i * (LAMP_SPACING * 3));
    scene.add(pt);
  }

  return { ambientLight, sunLight };
}

// ── Road — asphalt, grass, edge lines, centre stripe ─────────────────────────
// Returns { roadMat, grassMat } for per-frame colour updates.
function buildMenuRoad(scene) {
  const LEN = Z_FRONT - Z_BACK;
  const MID = (Z_FRONT + Z_BACK) / 2;

  const roadMat  = new THREE.MeshLambertMaterial({ color: THEME_DAY.roadColor });
  const grassMat = new THREE.MeshLambertMaterial({ color: THEME_DAY.groundColor });
  const lineMat  = new THREE.MeshLambertMaterial({ color: 0x808070 });

  const aspGeo = new THREE.PlaneGeometry(ROAD_W, LEN);
  aspGeo.rotateX(-Math.PI / 2);
  aspGeo.translate(0, 0, MID);
  scene.add(new THREE.Mesh(aspGeo, roadMat));

  for (const sx of [-1, 1]) {
    const g = new THREE.PlaneGeometry(34, LEN);
    g.rotateX(-Math.PI / 2);
    g.translate(sx * (ROAD_HALF + 17), 0, MID);
    scene.add(new THREE.Mesh(g, grassMat));
  }

  for (const sx of [-1, 1]) {
    const l = new THREE.PlaneGeometry(0.18, LEN);
    l.rotateX(-Math.PI / 2);
    l.translate(sx * (ROAD_HALF - 0.4), 0.01, MID);
    scene.add(new THREE.Mesh(l, lineMat));
  }

  const cl = new THREE.PlaneGeometry(0.14, LEN);
  cl.rotateX(-Math.PI / 2);
  cl.translate(0, 0.01, MID);
  scene.add(new THREE.Mesh(cl, new THREE.MeshLambertMaterial({ color: 0x7a7060 })));

  return { roadMat, grassMat };
}

// ── Soviet panelki — merged per colour variant ────────────────────────────────
// Returns { buildingMats } (array of 3) for per-frame colour updates.
function buildMenuBuildings(scene) {
  const CLEARANCE = ROAD_HALF + 17;
  const buildingMats = THEME_DAY.buildingColors.map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  );

  for (const side of [-1, 1]) {
    const buckets = [[], [], []];
    let z = 0, bi = 0;
    while (z < 295) {
      const h   = 18 + Math.abs(Math.sin(bi * 1.73)) * 16;
      const w   = 22 + Math.abs(Math.cos(bi * 2.31)) * 12;
      const d   =  9 + Math.abs(Math.sin(bi * 0.91)) *  7;
      const gap =  7 + Math.abs(Math.cos(bi * 1.29)) *  9;
      const xOff = Math.abs(Math.sin(bi * 3.07)) * 4;
      const vi  = bi % 3;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(side * (CLEARANCE + w / 2 + xOff), h / 2, -(z + d / 2));
      buckets[vi].push(geo);
      z += d + gap;
      bi++;
    }
    for (let vi = 0; vi < 3; vi++) {
      if (!buckets[vi].length) continue;
      const merged = mergeGeometries(buckets[vi]);
      buckets[vi].forEach((g) => g.dispose());
      scene.add(new THREE.Mesh(merged, buildingMats[vi]));
    }
  }
  return { buildingMats };
}

// ── Birch trees — InstancedMesh ───────────────────────────────────────────────
// Returns { leafMat, trunkMat } for per-frame colour updates.
function buildMenuTrees(scene) {
  const TREE_X    = ROAD_HALF + 4.2;
  const COUNT     = 20;
  const MAX_PUFFS = COUNT * 5;

  const trunkMat = new THREE.MeshLambertMaterial({ color: THEME_DAY.treeTrunkColor });
  const leafMat  = new THREE.MeshLambertMaterial({ color: THEME_DAY.treeLeafColor });

  const trunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.20, 0.28, 1, 6), trunkMat, COUNT * 2,
  );
  const leafInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 5, 4), leafMat, MAX_PUFFS * 2,
  );
  trunkInst.frustumCulled = false;
  leafInst.frustumCulled  = false;
  scene.add(trunkInst);
  scene.add(leafInst);

  const dummy = new THREE.Object3D();
  let tIdx = 0, pIdx = 0;

  for (const sx of [-TREE_X, TREE_X]) {
    for (let i = 0; i < COUNT; i++) {
      const wz     = -(i / COUNT) * 275 + 18;
      const jitter = Math.sin(i * 2.71828 + sx) * 1.2;
      const trunkH = 7.5 + Math.abs(Math.cos(i * 1.4142)) * 4;

      dummy.position.set(sx + jitter, trunkH / 2, wz);
      dummy.scale.set(1, trunkH, 1);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(tIdx++, dummy.matrix);

      const puffs = 3 + (i % 3);
      for (let p = 0; p < puffs && pIdx < MAX_PUFFS * 2; p++) {
        const r  = 1.1 + Math.abs(Math.sin(i * 3 + p)) * 0.9;
        const cx = Math.cos(p * 2.094 + i) * 1.3;
        const cy = trunkH + 1.2 + p * 0.65;
        const cz = Math.sin(p * 2.094 + i) * 1.3;
        dummy.position.set(sx + jitter + cx, cy, wz + cz);
        dummy.scale.setScalar(r);
        dummy.updateMatrix();
        leafInst.setMatrixAt(pIdx++, dummy.matrix);
      }
    }
  }

  // Park unused instances far below ground
  dummy.position.set(0, -2000, 0);
  dummy.scale.setScalar(0.001);
  dummy.updateMatrix();
  for (let i = tIdx; i < COUNT * 2;     i++) trunkInst.setMatrixAt(i, dummy.matrix);
  for (let i = pIdx; i < MAX_PUFFS * 2; i++) leafInst.setMatrixAt(i, dummy.matrix);
  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate  = true;

  return { trunkMat, leafMat };
}

// ── Cobra-head lamp posts + catenary power wires ──────────────────────────────
// Poles, arms/visors, housings, glow discs merged into 4 draw calls.
// Lamp colours are kept constant (amber looks good at both day and dusk).
function buildMenuLampPosts(scene) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x606068 });
  const headMat = new THREE.MeshLambertMaterial({
    color: 0xffaa33,
    emissive: new THREE.Color(0xffd060),
    emissiveIntensity: 1.4,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffaa33,
    transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1212 });

  const poleGeos = [], armGeos = [], headGeos = [], glowGeos = [];

  for (const sx of [-LAMP_SIDE_X, LAMP_SIDE_X]) {
    const armDir  = sx < 0 ? 1 : -1;   // arm points toward road centre
    const poleZArr = [];

    for (let i = 0; i < LAMP_COUNT; i++) {
      const wz = Z_FRONT - i * LAMP_SPACING;
      poleZArr.push(wz);

      const pg = new THREE.CylinderGeometry(0.06, 0.11, POLE_H, 6);
      pg.translate(sx, POLE_H / 2, wz);
      poleGeos.push(pg);

      const ag = new THREE.BoxGeometry(1.5, 0.09, 0.09);
      ag.translate(sx + armDir * 0.75, POLE_H, wz);
      armGeos.push(ag);

      const vg = new THREE.BoxGeometry(0.85, 0.07, 0.58);
      vg.translate(sx + armDir * 1.5, POLE_H + 0.06, wz);
      armGeos.push(vg);

      const hg = new THREE.BoxGeometry(0.75, 0.18, 0.50);
      hg.translate(sx + armDir * 1.5, POLE_H - 0.09, wz);
      headGeos.push(hg);

      const gg = new THREE.CircleGeometry(0.85, 8);
      gg.rotateX(Math.PI / 2);
      gg.translate(sx + armDir * 1.5, POLE_H - 0.22, wz);
      glowGeos.push(gg);
    }

    // Catenary power wires — one Line per inter-post segment
    const wireY = POLE_H - 0.3;
    for (let i = 0; i < poleZArr.length - 1; i++) {
      const z0 = poleZArr[i], z1 = poleZArr[i + 1];
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(sx, wireY,        z0),
          new THREE.Vector3(sx, wireY - 0.55, (z0 + z1) / 2),
          new THREE.Vector3(sx, wireY,        z1),
        ]),
        wireMat,
      ));
    }
  }

  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(armGeos),  poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(headGeos), headMat));
  scene.add(new THREE.Mesh(mergeGeometries(glowGeos), glowMat));
  [...poleGeos, ...armGeos, ...headGeos, ...glowGeos].forEach((g) => g.dispose());
}
