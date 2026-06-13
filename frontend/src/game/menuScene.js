/**
 * menuScene.js — ambient looping 3D background for the Home screen.
 *
 * Completely isolated from runReplay, physics.js, rng.js, and all payment paths.
 * A Lada cruises a Soviet boulevard in the day theme: bright, warm, alive.
 *
 * Public API:
 *   const scene = startMenuScene(canvas)
 *   scene.pause()    — stop render loop (called when switching tabs)
 *   scene.resume()   — restart render loop
 *   scene.destroy()  — full cleanup
 *
 * Pauses automatically on document.hidden (visibilitychange).
 * Falls back to a no-op stub if WebGL is unavailable.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Day theme — bright Soviet summer ─────────────────────────────────────────
const THEME = {
  ambientColor:   0xdde8f0,  ambientIntensity: 4.2,
  sunColor:       0xfff4e0,  sunIntensity:     5.5,
  fogColor:       0xc5d6e8,  fogNear: 85,  fogFar: 210,
  skyHorizon:     [0.82, 0.87, 0.93],
  skyZenith:      [0.40, 0.60, 0.84],
  groundColor:    0x5a7a35,   // summer grass
  roadColor:      0x525252,   // asphalt
  lineColor:      0xd4c88c,   // road edge markings
  treeTrunkColor: 0xf0ece8,   // birch bark white
  treeLeafColor:  0x4a8828,   // deep summer green
  cloudColor:     0xfafcff,   cloudOpacity: 0.84,
  buildingColors: [0xc8bfa8, 0xb4b0a0, 0xd0c8b4],  // panelki palette
};

const ROAD_W    = 14;
const ROAD_HALF = ROAD_W / 2;
const CAR_SCALE = 1.5;
const CAR_LANE  = -1.2;  // slightly off-centre, matching a race lane
const CAR_SPEED = 0.14;  // world units per frame at 30fps ≈ 4.2 u/s (slow cruise)

// Car travels from LOOP_START (just behind camera) to LOOP_END (deep in fog),
// then teleports back. Both endpoints are invisible to the camera.
const LOOP_START =  36;   // behind camera frustum
const LOOP_END   = -280;  // past fog far plane

// Camera: fixed, looking forward down the boulevard
const CAM_POS_X  =  7.5;
const CAM_POS_Y  =  4.2;
const CAM_POS_Z  =  28;
const CAM_LOOK_X =  0;
const CAM_LOOK_Y =  1.5;
const CAM_LOOK_Z = -35;

const TARGET_FPS = 30;
const FRAME_MS   = 1000 / TARGET_FPS;

const GLB_URL = 'https://cdn.jsdelivr.net/gh/castlejnr2-droid/lada-car-racing@main/frontend/public/car.glb';

// ── Public entry ──────────────────────────────────────────────────────────────
export function startMenuScene(canvas) {
  let rafId      = null;
  let paused     = false;
  let destroyed  = false;
  let lastFrameMs = 0;
  let carZ       = LOOP_START;

  // ── Renderer ──────────────────────────────────────────────────────────────
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W   = canvas.offsetWidth  || window.innerWidth  || 360;
  const H   = canvas.offsetHeight || window.innerHeight || 640;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  } catch (e) {
    console.warn('[menuScene] WebGL unavailable, background will be static:', e);
    return stub();
  }
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(THEME.fogColor);

  // ── Scene ──────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.fogColor);
  scene.fog        = new THREE.Fog(THEME.fogColor, THEME.fogNear, THEME.fogFar);

  // Sky gradient sphere (same shader as race scene)
  buildMenuSky(scene);

  // Clouds (1 merged layer, drifts slowly)
  const cloudMesh = buildMenuClouds(scene);

  // Lighting
  scene.add(new THREE.AmbientLight(THEME.ambientColor, THEME.ambientIntensity));
  const sun = new THREE.DirectionalLight(THEME.sunColor, THEME.sunIntensity);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  // Road, buildings, trees
  buildMenuRoad(scene);
  buildMenuBuildings(scene);
  buildMenuTrees(scene);

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(62, W / H, 0.5, 300);
  camera.position.set(CAM_POS_X, CAM_POS_Y, CAM_POS_Z);
  camera.lookAt(CAM_LOOK_X, CAM_LOOK_Y, CAM_LOOK_Z);

  // ── Car ───────────────────────────────────────────────────────────────────
  const carGroup = new THREE.Group();
  carGroup.position.set(CAR_LANE, 0, LOOP_START);
  // frustumCulled=true (default) — car is not rendered when behind the camera
  scene.add(carGroup);

  // Body-sway state (gentle oscillation, same feel as the race scene)
  let swayFrame = 0;

  // Load GLB asynchronously — scene looks fine without it while loading
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.load(GLB_URL, (gltf) => {
    if (destroyed) return;
    const model = gltf.scene;
    model.scale.setScalar(CAR_SCALE);
    model.rotation.y = 0;   // faces -Z (forward), same as race scene
    model.position.y = 0.5;
    model.frustumCulled = false;  // let the group do frustum culling
    carGroup.add(model);
  }, undefined, (e) => {
    console.warn('[menuScene] car.glb load failed:', e);
  });

  // ── Render loop ───────────────────────────────────────────────────────────
  function tick(now) {
    if (destroyed || paused) return;
    rafId = requestAnimationFrame(tick);

    // 30fps cap
    const delta = now - lastFrameMs;
    if (delta < FRAME_MS) return;
    lastFrameMs = now - (delta % FRAME_MS);

    // Advance car in -Z direction; teleport when past fog
    carZ -= CAR_SPEED;
    if (carZ < LOOP_END) carZ = LOOP_START;
    carGroup.position.z = carZ;

    // Gentle body sway (cosmetic only)
    swayFrame++;
    carGroup.rotation.z = Math.sin(swayFrame * 0.045) * 0.012;

    // Drift cloud layer slowly across the sky
    if (cloudMesh) cloudMesh.position.x += 0.025;

    renderer.render(scene, camera);
  }

  function startLoop() {
    if (!rafId && !destroyed && !paused && !document.hidden) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ── Visibility change — pause when app is backgrounded ───────────────────
  function onVisibilityChange() {
    if (document.hidden) stopLoop();
    else if (!paused) startLoop();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  startLoop();

  // ── Public API ────────────────────────────────────────────────────────────
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

// ── Fallback stub — returned when WebGL is unavailable ───────────────────────
function stub() {
  return { pause() {}, resume() {}, destroy() {} };
}

// ── Sky gradient sphere (same GLSL as race scene) ────────────────────────────
function buildMenuSky(scene) {
  const [hr, hg, hb] = THEME.skyHorizon;
  const [zr, zg, zb] = THEME.skyZenith;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(280, 16, 8),
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
        precision mediump float;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying float vY;
        void main() {
          float t = clamp(vY / 180.0, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.55)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  scene.add(sky);
}

// ── Cloud layer — merged, drifts slowly across the sky ───────────────────────
function buildMenuClouds(scene) {
  const mat = new THREE.MeshLambertMaterial({
    color: THEME.cloudColor, transparent: true, opacity: THEME.cloudOpacity, fog: false,
  });

  const CENTRES = [
    [-70, 55, -80], [40, 62, -160], [-20, 58, -240],
    [90, 52, -60],  [-100, 65, -300],
  ];

  const geos = [];
  for (const [cx, cy, cz] of CENTRES) {
    const puffs = 3 + Math.floor(Math.abs(Math.sin(cx)) * 3);
    for (let p = 0; p < puffs; p++) {
      const r = 7 + Math.abs(Math.sin(p * 1.7 + cx)) * 9;
      const g = new THREE.SphereGeometry(r, 6, 4);
      g.scale(1, 0.36, 1);
      g.translate(
        cx + Math.sin(p * 2.094) * 18,
        cy + Math.cos(p * 1.4) * 2,
        cz + Math.cos(p * 2.094) * 10,
      );
      geos.push(g);
    }
  }

  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

// ── Road surface — asphalt, grass shoulders, edge lines ──────────────────────
function buildMenuRoad(scene) {
  const Z_FRONT  =  32;
  const Z_BACK   = -310;
  const LEN      = Z_FRONT - Z_BACK;
  const MID_Z    = (Z_FRONT + Z_BACK) / 2;

  // Asphalt
  const asphalt = new THREE.PlaneGeometry(ROAD_W, LEN);
  asphalt.rotateX(-Math.PI / 2);
  asphalt.translate(0, 0, MID_Z);
  scene.add(new THREE.Mesh(asphalt, new THREE.MeshLambertMaterial({ color: THEME.roadColor })));

  // Grass (wide strips either side)
  const grassMat = new THREE.MeshLambertMaterial({ color: THEME.groundColor });
  for (const sx of [-1, 1]) {
    const g = new THREE.PlaneGeometry(36, LEN);
    g.rotateX(-Math.PI / 2);
    g.translate(sx * (ROAD_HALF + 18), 0, MID_Z);
    scene.add(new THREE.Mesh(g, grassMat));
  }

  // Edge lines
  const lineMat = new THREE.MeshLambertMaterial({ color: THEME.lineColor });
  for (const sx of [-1, 1]) {
    const l = new THREE.PlaneGeometry(0.20, LEN);
    l.rotateX(-Math.PI / 2);
    l.translate(sx * (ROAD_HALF - 0.5), 0.01, MID_Z);
    scene.add(new THREE.Mesh(l, lineMat));
  }
}

// ── Soviet panel apartment buildings — merged per colour variant ──────────────
function buildMenuBuildings(scene) {
  const CLEARANCE = ROAD_HALF + 18;  // inner edge X offset from road centre
  const mats = THEME.buildingColors.map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  );

  for (const side of [-1, 1]) {
    const buckets = [[], [], []];
    let z = 5;
    let bi = 0;  // building index for deterministic variation

    while (z < 290) {
      // All values deterministic (sin/cos of index) — no external rng needed
      const h    = 18 + Math.abs(Math.sin(bi * 1.73)) * 14;  // 8–32 m
      const w    = 20 + Math.abs(Math.cos(bi * 2.31)) * 10;  // 10–30 m
      const d    =  9 + Math.abs(Math.sin(bi * 0.91)) *  7;  // 9–16 m deep
      const gap  =  8 + Math.abs(Math.cos(bi * 1.29)) * 10;  // 8–18 m gap
      const xOff =     Math.abs(Math.sin(bi * 3.07)) *  5;   // 0–5 m setback
      const vi   = bi % 3;

      const bx = side * (CLEARANCE + w / 2 + xOff);
      const bz = -(z + d / 2);

      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(bx, h / 2, bz);
      buckets[vi].push(geo);

      z += d + gap;
      bi++;
    }

    for (let vi = 0; vi < 3; vi++) {
      if (!buckets[vi].length) continue;
      const merged = mergeGeometries(buckets[vi]);
      buckets[vi].forEach((g) => g.dispose());
      scene.add(new THREE.Mesh(merged, mats[vi]));
    }
  }
}

// ── Birch trees — InstancedMesh: trunks + leaf puffs ─────────────────────────
function buildMenuTrees(scene) {
  const TREE_X = ROAD_HALF + 4.0;
  const COUNT  = 20;   // per side
  const MAX_PUFFS = COUNT * 5;  // upper bound on leaf puffs

  const trunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.20, 0.28, 1, 6),
    new THREE.MeshLambertMaterial({ color: THEME.treeTrunkColor }),
    COUNT * 2,
  );
  const leafInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 5, 4),
    new THREE.MeshLambertMaterial({ color: THEME.treeLeafColor }),
    MAX_PUFFS * 2,
  );
  trunkInst.frustumCulled = false;
  leafInst.frustumCulled  = false;
  scene.add(trunkInst);
  scene.add(leafInst);

  const dummy  = new THREE.Object3D();
  let tIdx = 0, pIdx = 0;

  for (const sx of [-TREE_X, TREE_X]) {
    for (let i = 0; i < COUNT; i++) {
      const wz     = -(i / COUNT) * 280 + 20;
      const jitter = Math.sin(i * 2.71828 + sx) * 1.2;
      const trunkH = 7.0 + Math.abs(Math.cos(i * 1.4142)) * 3.5;

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

  // Park unused slots far below scene
  dummy.position.set(0, -2000, 0);
  dummy.scale.setScalar(0.001);
  dummy.updateMatrix();
  for (let i = tIdx; i < COUNT * 2;    i++) trunkInst.setMatrixAt(i, dummy.matrix);
  for (let i = pIdx; i < MAX_PUFFS * 2; i++) leafInst.setMatrixAt(i, dummy.matrix);

  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate  = true;
}
