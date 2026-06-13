/**
 * menuScene.js — ambient looping 3D background for the Home screen.
 *
 * ISOLATED from runReplay, physics.js, rng.js, and all payment paths.
 * Scene: a Lada cruises a Soviet boulevard at dusk — amber sky, silhouetted
 * panelki, cobra-head lamp posts, sagging power lines, birch trees.
 *
 * Performance guarantees:
 *   - 30fps cap (FRAME_MS gate in RAF callback)
 *   - RAF loop stops on pause(), on document.hidden, and on destroy()
 *   - Double-start guarded: startLoop() checks rafId before scheduling
 *   - Merged geometry (buildings, lamp hardware, glow discs)
 *   - InstancedMesh for trees (2 draw calls total)
 *   - No postprocessing, no shadows
 *
 * Flash-free init:
 *   Canvas starts at opacity 0 (CSS). After the very first rendered frame,
 *   opacity is set to 1 and the CSS transition (0.4s ease) fades it in over
 *   the static background. The background colour matches the dusk fog so the
 *   transition is imperceptible.
 *
 * Returns { pause(), resume(), destroy() }.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Dusk theme — Soviet boulevard at golden hour ──────────────────────────────
// Colours adapted from THEME_DUSK in replay.js for the menu's shorter scene.
const THEME = {
  ambientColor:    0xf0d0a0,  ambientIntensity: 3.8,
  sunColor:        0xff7820,  sunIntensity:     7.0,
  fogColor:        0xd07038,  fogNear: 62, fogFar: 190,  // shorter than race track
  skyHorizon:     [0.98, 0.55, 0.18],  // deep amber-orange
  skyZenith:      [0.22, 0.18, 0.42],  // indigo-purple
  groundColor:     0x4a6022,   // dusk grass
  roadColor:       0x3c3830,   // near-black wet asphalt
  lineColor:       0x5a5448,   // dim edge lines
  treeTrunkColor:  0xd0b888,   // warm amber bark
  treeLeafColor:   0x1e3c08,   // dark silhouette foliage
  cloudColor:      0xff8844,   cloudOpacity: 0.60,
  buildingColors: [0x9a9080, 0x8a847a, 0xa89c8e],  // muted evening panelki
  lampGlowColor:   0xffaa33,   // amber street-lamp glow
  lampEmissive:    0xffd060,
  wireColor:       0x1a1212,   // dark power-line wire
};

const ROAD_W    = 14;
const ROAD_HALF = ROAD_W / 2;
const CAR_SCALE = 1.5;
const CAR_LANE  = -1.2;
const CAR_SPEED = 0.14;       // world-units/frame at 30fps ≈ 4.2 u/s

// Car moves from behind the camera (outside frustum) forward into the fog.
// Both endpoints are invisible — the loop reset is imperceptible.
const LOOP_START =  36;
const LOOP_END   = -270;

// Fixed camera looking down the boulevard
const CAM_POS    = new THREE.Vector3(7.5, 4.2, 28);
const CAM_LOOKAT = new THREE.Vector3(0, 1.5, -35);

const TARGET_FPS = 30;
const FRAME_MS   = 1000 / TARGET_FPS;

const GLB_URL = 'https://cdn.jsdelivr.net/gh/castlejnr2-droid/lada-car-racing@main/frontend/public/car.glb';

// Lamp post layout — mirrors buildLampPosts() proportions from replay.js
const POLE_H  = 7;
const LAMP_SIDE_X = ROAD_HALF + 1.8;   // same offset as race scene
const LAMP_COUNT  = 9;                  // per side, covers the visible corridor
const Z_FRONT     = 30;
const Z_BACK      = -290;
const LAMP_SPACING = (Z_FRONT - Z_BACK) / (LAMP_COUNT - 1);

// ── Public entry ──────────────────────────────────────────────────────────────
export function startMenuScene(canvas) {
  let rafId        = null;
  let paused       = false;
  let destroyed    = false;
  let lastFrameMs  = 0;
  let carZ         = LOOP_START;
  let swayFrame    = 0;
  let firstFrame   = true;

  // Ensure canvas is invisible until the first rendered frame (flash-free init)
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
    canvas.style.opacity = '1';  // restore so CSS fallback shows
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

  buildMenuSky(scene);
  const cloudMesh = buildMenuClouds(scene);
  buildMenuLighting(scene);
  buildMenuRoad(scene);
  buildMenuBuildings(scene);
  buildMenuTrees(scene);
  buildMenuLampPosts(scene);  // lamp posts + cobra heads + glow discs + power wires

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(62, W / H, 0.5, 300);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOKAT);

  // ── Car ───────────────────────────────────────────────────────────────────
  const carGroup = new THREE.Group();
  carGroup.position.set(CAR_LANE, 0, LOOP_START);
  scene.add(carGroup);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.load(GLB_URL, (gltf) => {
    if (destroyed) return;
    const model = gltf.scene;
    model.scale.setScalar(CAR_SCALE);
    model.rotation.y = 0;     // faces -Z (forward), same convention as race scene
    model.position.y = 0.5;
    model.frustumCulled = false;  // group handles culling
    carGroup.add(model);
  }, undefined, (e) => console.warn('[menuScene] car.glb load failed:', e));

  // ── Render loop ───────────────────────────────────────────────────────────
  // Performance contract:
  //   - Only one RAF chain runs at a time (rafId guard in startLoop)
  //   - Loop stops when paused=true or destroyed=true (checked at tick entry)
  //   - visibilitychange stops loop when app is backgrounded
  function tick(now) {
    // Clear rafId first so startLoop can re-arm if resume() races with this callback
    rafId = null;
    if (destroyed || paused) return;
    rafId = requestAnimationFrame(tick);

    // 30fps cap
    const delta = now - lastFrameMs;
    if (delta < FRAME_MS) return;
    lastFrameMs = now - (delta % FRAME_MS);

    // Advance car; both endpoints invisible so loop reset is imperceptible
    carZ -= CAR_SPEED;
    if (carZ < LOOP_END) carZ = LOOP_START;
    carGroup.position.z = carZ;

    // Gentle body sway
    swayFrame++;
    carGroup.rotation.z = Math.sin(swayFrame * 0.045) * 0.012;

    // Drift cloud slowly across sky
    if (cloudMesh) cloudMesh.position.x += 0.018;

    renderer.render(scene, camera);

    // First frame rendered — fade the canvas in smoothly over the static bg
    if (firstFrame) {
      firstFrame = false;
      canvas.style.opacity = '1';  // CSS transition handles the ease (set in global.css)
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

// ── Sky gradient sphere — same GLSL shader as race scene ─────────────────────
function buildMenuSky(scene) {
  const [hr, hg, hb] = THEME.skyHorizon;
  const [zr, zg, zb] = THEME.skyZenith;
  scene.add(new THREE.Mesh(
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
          float t = clamp(vY / 160.0, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.55)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  ));
}

// ── Dusk cloud layer — amber-lit, drifts slowly ───────────────────────────────
function buildMenuClouds(scene) {
  const mat = new THREE.MeshLambertMaterial({
    color: THEME.cloudColor, transparent: true, opacity: THEME.cloudOpacity, fog: false,
  });
  const CENTRES = [
    [-60, 50, -70],  [50, 58, -140], [-25, 54, -210],
    [85, 48, -55],   [-95, 62, -280],
  ];
  const geos = [];
  for (const [cx, cy, cz] of CENTRES) {
    const puffs = 3 + Math.floor(Math.abs(Math.sin(cx * 0.07)) * 3);
    for (let p = 0; p < puffs; p++) {
      const r = 6 + Math.abs(Math.sin(p * 1.7 + cx * 0.05)) * 9;
      const g = new THREE.SphereGeometry(r, 6, 4);
      g.scale(1, 0.34, 1);
      g.translate(cx + Math.sin(p * 2.094) * 16, cy + Math.cos(p) * 2, cz + Math.cos(p * 2.094) * 8);
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

// ── Lighting — warm dusk sun + ambient fill + lamp-post point lights ──────────
function buildMenuLighting(scene) {
  scene.add(new THREE.AmbientLight(THEME.ambientColor, THEME.ambientIntensity));

  const sun = new THREE.DirectionalLight(THEME.sunColor, THEME.sunIntensity);
  sun.position.set(-60, 40, 80);  // low-angle dusk sun from behind camera
  scene.add(sun);

  // Warm amber point lights along road centre — simulates lamp-post illumination
  const ptCol = THEME.lampGlowColor;
  for (let i = 0; i < 3; i++) {
    const pt = new THREE.PointLight(ptCol, 1.2, 70);
    pt.position.set(0, POLE_H - 0.5, Z_FRONT - i * (LAMP_SPACING * 3));
    scene.add(pt);
  }
}

// ── Road — asphalt, grass shoulders, edge lines, centre stripe ────────────────
function buildMenuRoad(scene) {
  const LEN  = Z_FRONT - Z_BACK;
  const MID  = (Z_FRONT + Z_BACK) / 2;

  // Asphalt
  const asp = new THREE.PlaneGeometry(ROAD_W, LEN);
  asp.rotateX(-Math.PI / 2);
  asp.translate(0, 0, MID);
  scene.add(new THREE.Mesh(asp, new THREE.MeshLambertMaterial({ color: THEME.roadColor })));

  // Grass shoulders
  const grassMat = new THREE.MeshLambertMaterial({ color: THEME.groundColor });
  for (const sx of [-1, 1]) {
    const g = new THREE.PlaneGeometry(34, LEN);
    g.rotateX(-Math.PI / 2);
    g.translate(sx * (ROAD_HALF + 17), 0, MID);
    scene.add(new THREE.Mesh(g, grassMat));
  }

  // Edge lines
  const lineMat = new THREE.MeshLambertMaterial({ color: THEME.lineColor });
  for (const sx of [-1, 1]) {
    const l = new THREE.PlaneGeometry(0.18, LEN);
    l.rotateX(-Math.PI / 2);
    l.translate(sx * (ROAD_HALF - 0.4), 0.01, MID);
    scene.add(new THREE.Mesh(l, lineMat));
  }

  // Centre divider stripe (single solid line)
  const cl = new THREE.PlaneGeometry(0.14, LEN);
  cl.rotateX(-Math.PI / 2);
  cl.translate(0, 0.01, MID);
  scene.add(new THREE.Mesh(cl, new THREE.MeshLambertMaterial({ color: 0x6a6054 })));
}

// ── Soviet panelki apartment blocks — merged per colour variant ───────────────
// Same mergeGeometries approach as race scene's buildPanelki.
function buildMenuBuildings(scene) {
  const CLEARANCE = ROAD_HALF + 17;
  const mats = THEME.buildingColors.map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  );

  for (const side of [-1, 1]) {
    const buckets = [[], [], []];
    let z = 0, bi = 0;

    while (z < 295) {
      const h    = 18 + Math.abs(Math.sin(bi * 1.73)) * 16;   // 8–34 m  (taller=more Soviet)
      const w    = 22 + Math.abs(Math.cos(bi * 2.31)) * 12;   // 10–34 m
      const d    =  9 + Math.abs(Math.sin(bi * 0.91)) *  7;
      const gap  =  7 + Math.abs(Math.cos(bi * 1.29)) *  9;
      const xOff =     Math.abs(Math.sin(bi * 3.07)) *  4;
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

// ── Birch trees — InstancedMesh, dark dusk silhouette foliage ─────────────────
function buildMenuTrees(scene) {
  const TREE_X     = ROAD_HALF + 4.2;
  const COUNT      = 20;
  const MAX_PUFFS  = COUNT * 5;

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

  dummy.position.set(0, -2000, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
  for (let i = tIdx; i < COUNT * 2;     i++) trunkInst.setMatrixAt(i, dummy.matrix);
  for (let i = pIdx; i < MAX_PUFFS * 2; i++) leafInst.setMatrixAt(i, dummy.matrix);
  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate  = true;
}

// ── Cobra-head lamp posts + power wires — mirrors race scene's buildLampPosts ─
// Poles, arms, visors merged into 2 draw calls (poleMat).
// Lamp housings merged into 1 draw call (emissive headMat).
// Glow discs merged into 1 draw call (additive glowMat).
// Power wires: one THREE.Line per inter-post gap (catenary sag, same as race).
function buildMenuLampPosts(scene) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x606068 });
  const headMat = new THREE.MeshLambertMaterial({
    color: THEME.lampGlowColor,
    emissive: new THREE.Color(THEME.lampEmissive),
    emissiveIntensity: 1.4,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: THEME.lampGlowColor,
    transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const wireMat = new THREE.LineBasicMaterial({ color: THEME.wireColor });

  const poleGeos = [], armGeos = [], headGeos = [], glowGeos = [];

  for (const sx of [-LAMP_SIDE_X, LAMP_SIDE_X]) {
    const armDir = sx < 0 ? 1 : -1;  // arm points toward road centre
    const poleZArr = [];

    for (let i = 0; i < LAMP_COUNT; i++) {
      const wz = Z_FRONT - i * LAMP_SPACING;
      poleZArr.push(wz);

      // Pole
      const pg = new THREE.CylinderGeometry(0.06, 0.11, POLE_H, 6);
      pg.translate(sx, POLE_H / 2, wz);
      poleGeos.push(pg);

      // Arm
      const ag = new THREE.BoxGeometry(1.5, 0.09, 0.09);
      ag.translate(sx + armDir * 0.75, POLE_H, wz);
      armGeos.push(ag);

      // Visor
      const vg = new THREE.BoxGeometry(0.85, 0.07, 0.58);
      vg.translate(sx + armDir * 1.5, POLE_H + 0.06, wz);
      armGeos.push(vg);

      // Lamp housing (emissive)
      const hg = new THREE.BoxGeometry(0.75, 0.18, 0.50);
      hg.translate(sx + armDir * 1.5, POLE_H - 0.09, wz);
      headGeos.push(hg);

      // Additive glow disc beneath lamp head
      const gg = new THREE.CircleGeometry(0.85, 8);
      gg.rotateX(Math.PI / 2);
      gg.translate(sx + armDir * 1.5, POLE_H - 0.22, wz);
      glowGeos.push(gg);
    }

    // Power wires with catenary sag — one THREE.Line per inter-post segment
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

  // 4 merged draw calls for all lamp hardware
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(armGeos),  poleMat));
  scene.add(new THREE.Mesh(mergeGeometries(headGeos), headMat));
  scene.add(new THREE.Mesh(mergeGeometries(glowGeos), glowMat));
  [...poleGeos, ...armGeos, ...headGeos, ...glowGeos].forEach((g) => g.dispose());
}
