/**
 * 3D behind-the-car race replay — Three.js renderer.
 *
 * Camera follows the player's car (index 0) from behind and above, looking
 * down the road toward the finish line.
 * Cars are GLB 3D models (car.glb), cloned per player and tinted.
 * Road, finish line, and Soviet-brutalist buildings are 3D geometry.
 * A 2D canvas overlay (orthographic second pass) renders progress bar,
 * player name labels, and the countdown sequence.
 *
 * Drop-in replacement for the original 2D replay — same public signature:
 *   runReplay(canvas, hexSeed, { onComplete, onTick, playerNames })
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME = 2;   // physics ticks per render frame

const ROAD_W    = 14;   // total road width, world units
const LANE_SPREAD = 2.4; // total lateral spread across all lanes (±0.6 for 2 cars)
const CAR_SCALE = 1.5;  // GLB model uniform scale
const CAR_H     = 2.0;  // approximate car height for HUD label offset

const CAM_BACK   = 6;   // world units behind player (closer)
const CAM_HEIGHT = 2.5; // camera height (lower, more dramatic)
const CAM_AHEAD  = 18;  // look-ahead from player's position
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
  // Light daytime fog — slight blue haze in distance
  scene.fog = new THREE.Fog(0xc8e8f4, TRACK_LENGTH * 0.5, TRACK_LENGTH * 1.2);

  // Lighting — bright daytime
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(50, 100, 50);
  scene.add(sun);

  // ── Dusk sky — large sphere with vertical gradient shader ─────────────────
  buildSky(scene);

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
  buildRoad(scene, N, laneX);
  const finishMesh = buildFinishLine(scene);
  buildBuildings(scene, rng);
  buildLampPosts(scene);
  buildSovietExtras(scene);

  // ── Car model containers ─────────────────────────────────────────────────
  // Start at z=-10 so cars are in front of the camera immediately
  const carMeshes = Array.from({ length: N }, (_, i) => {
    const group = new THREE.Group();
    group.position.set(laneX[i], 0, -10);
    scene.add(group);
    return group;
  });

  // ── Confetti particle system ──────────────────────────────────────────────
  const confetti = makeConfettiSystem(scene);

  // ── Animation state ───────────────────────────────────────────────────────
  let physTick   = 0;
  let frameCount = 0;
  let endFrame   = -1;
  let cancelled  = false;
  let rafId      = null;

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
            model.rotation.y = Math.PI;
            model.position.y = 0.5;
            model.frustumCulled = false;
            const tint = CAR_TINTS[i % CAR_TINTS.length];
            let clonedMeshes = 0;
            model.traverse((child) => {
              if (child.isMesh) {
                clonedMeshes++;
                child.frustumCulled = false;
                // MeshLambertMaterial: supports textures and responds to
                // lights, but avoids heavy PBR which breaks in Telegram WebView.
                const src = child.material;
                const baseColor = src?.color ? src.color.clone() : new THREE.Color(0xcccccc);
                if (tint) baseColor.multiply(tint);
                child.material = new THREE.MeshLambertMaterial({
                  color: baseColor,
                  map:          src?.map          ?? null,
                  emissiveMap:  src?.emissiveMap  ?? null,
                  emissive:     src?.emissive      ? src.emissive.clone() : new THREE.Color(0x000000),
                });
                child.castShadow    = false;
                child.receiveShadow = false;
              }
            });
            group.add(model);
            console.log('[replay] car', i, 'placed at x=', group.position.x.toFixed(3),
              '| material: MeshLambertMaterial',
              '| group xyz:', group.position.x.toFixed(3), group.position.y.toFixed(3), group.position.z.toFixed(3),
              '| model y:', model.position.y.toFixed(2),
              '| scale:', model.scale.x.toFixed(2),
              '| cloned meshes:', clonedMeshes,
            );
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
            const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 });
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

    // Advance physics
    if (!cdActive) {
      if (endFrame < 0) {
        if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
          physTick++;
          onTick?.(physTick, sim);
        }
        if (physTick >= sim.history.length - 1) endFrame = 0;
      } else {
        endFrame++;
      }
    }

    const state = sim.history[physTick];

    // Update car world positions — X is fixed per lane, Z is race progress
    for (let i = 0; i < N; i++) {
      const bounce = endFrame < 0
        ? Math.sin(physTick * 0.32 + i * 1.85) * Math.max(0, state.speeds[i] - 1.2) * 0.04
        : 0;
      const progress = state.positions[i];   // scalar 0 → TRACK_LENGTH
      carMeshes[i].position.x = laneX[i];   // FIXED lane offset, never changes
      carMeshes[i].position.y = bounce;      // small vertical bounce on rough road
      carMeshes[i].position.z = -progress;  // race moves in -Z direction
    }



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
      state.positions, playerNames,
      carMeshes, camera,
      cdActive ? frameCount : -1,
      celebFrame,
    );
    hud.tex.needsUpdate = true;

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
function buildRoad(scene, N, laneX) {
  // Road runs in -Z direction: from Z_START (behind start line) to Z_END (past finish)
  const Z_START =  25;
  const Z_END   = -(TRACK_LENGTH * 1.35);
  const LEN     = Z_START - Z_END;

  // Asphalt surface — PlaneGeometry(W, H) rotated -90° around X:
  // width→X, height→Z.  Center at midpoint of [Z_START, Z_END].
  const roadMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_W, LEN),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, metalness: 0 }),
  );
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.position.set(0, 0, (Z_START + Z_END) / 2);
  scene.add(roadMesh);

  // Pavement / ground on both sides — dark grey Soviet concrete
  const paveMat = new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.98, metalness: 0 });
  const PAVE_W = 120;
  for (const sx of [-1, 1]) {
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(PAVE_W, LEN), paveMat);
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(sx * (ROAD_W / 2 + PAVE_W / 2), -0.01, (Z_START + Z_END) / 2);
    scene.add(pave);
  }

  // Road edges — solid white lines
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  for (const ex of [-ROAD_W / 2, ROAD_W / 2]) {
    const pts = [new THREE.Vector3(ex, 0.03, Z_START), new THREE.Vector3(ex, 0.03, Z_END)];
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  // Dashed lane dividers between each pair of adjacent lanes
  const dashMat = new THREE.LineDashedMaterial({ color: 0xc09030, dashSize: 8, gapSize: 6 });
  for (let i = 0; i < N - 1; i++) {
    const x   = (laneX[i] + laneX[i + 1]) / 2;
    const pts = [new THREE.Vector3(x, 0.03, Z_START), new THREE.Vector3(x, 0.03, Z_END)];
    const geo  = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, dashMat);
    line.computeLineDistances();
    scene.add(line);
  }
}

// ─── Finish line ───────────────────────────────────────────────────────────────
function buildFinishLine(scene) {
  // Generate a checkered canvas texture
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
  const mat  = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(0xffd700),
    emissiveIntensity: 0.4,
    roughness: 0.7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.015, -TRACK_LENGTH);
  scene.add(mesh);

  // Vertical finish posts on each side
  const postMat = new THREE.MeshStandardMaterial({ color: 0xddcc88, emissive: 0xffd700, emissiveIntensity: 0.3 });
  for (const sx of [-ROAD_W / 2, ROAD_W / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), postMat);
    post.position.set(sx, 3, -TRACK_LENGTH);
    scene.add(post);
  }
  // Crossbar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 0.25, 0.25, 0.25), postMat);
  bar.position.set(0, 6, -TRACK_LENGTH);
  scene.add(bar);

  return mesh;
}

// ─── Soviet cityscape buildings ───────────────────────────────────────────────
function buildBuildings(scene, rng) {
  const CLEARANCE = ROAD_W / 2 + 35;  // pushed 35 units from road centre

  for (const side of [-1, 1]) {
    let z = 5;
    while (z < TRACK_LENGTH * 1.25) {
      const w     = 2  + rng() * 22;   // wider variation 2–24
      const h     = 10 + rng() * 30;   // height 10–40
      const depth = 3  + rng() * 9;
      const gap   = 0.5 + rng() * 4;
      const xOff  = rng() * 8;

      const bx = side * (CLEARANCE + w / 2 + xOff);
      const bz = -(z + depth / 2);

      const windowIntens = 0.08 + rng() * 0.22;

      // Main block — Khrushchyovka pale yellow
      const geo = new THREE.BoxGeometry(w, h, depth);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xE8DDB5),
        emissive: new THREE.Color(0xffb030),
        emissiveIntensity: windowIntens * 0.3,
        roughness: 0.88,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(bx, h / 2, bz);
      scene.add(mesh);

      // Horizontal prefab panel seams every 3 units height — dark concrete joint
      const seamMat = new THREE.MeshStandardMaterial({ color: 0x8a8060, roughness: 1 });
      for (let sy = 3; sy < h - 1; sy += 3) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.12, depth + 0.05), seamMat);
        seam.position.set(bx, sy, bz);
        scene.add(seam);
      }

      // Rooftop silhouettes: antenna or water tower stub
      if (rng() > 0.55) {
        const aW   = 0.25 + rng() * 0.35;
        const aH   = 3    + rng() * 8;
        const aMat = new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 1 });
        const aMsh = new THREE.Mesh(new THREE.BoxGeometry(aW, aH, aW), aMat);
        aMsh.position.set(
          bx + (rng() - 0.5) * w  * 0.5,
          h  + aH / 2,
          bz + (rng() - 0.5) * depth * 0.4,
        );
        scene.add(aMsh);
      }

      z += depth + gap;
    }
  }
}

// ─── Soviet extras: red star billboard + bare boulevard trees ─────────────────
function buildSovietExtras(scene) {
  // ── Red Soviet star on a pole, visible at start ──────────────────────────
  const POLE_Z  = -8;   // just past the start line
  const POLE_H  = 10;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555560, roughness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, POLE_H, 8), poleMat);
  pole.position.set(ROAD_W / 2 + 3, POLE_H / 2, POLE_Z);
  scene.add(pole);

  // Star billboard: canvas texture of ★ on red background
  const sc = document.createElement('canvas');
  sc.width  = 128;
  sc.height = 128;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#cc1111';
  sctx.fillRect(0, 0, 128, 128);
  sctx.fillStyle = '#ffdd00';
  sctx.font = 'bold 96px serif';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('★', 64, 68);
  const starTex = new THREE.CanvasTexture(sc);
  const starMat = new THREE.MeshStandardMaterial({
    map: starTex,
    emissive: new THREE.Color(0xff2200),
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), starMat);
  sign.position.set(ROAD_W / 2 + 3, POLE_H + 1.1, POLE_Z);
  scene.add(sign);
  // Back face so it's visible from both sides
  const signBack = sign.clone();
  signBack.rotation.y = Math.PI;
  scene.add(signBack);

  // ── Bare boulevard trees between lamp posts ───────────────────────────────
  const TREE_SIDE_X = ROAD_W / 2 + 2.8;
  const TREE_COUNT  = 9;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 1 });

  for (const sx of [-TREE_SIDE_X, TREE_SIDE_X]) {
    for (let i = 0; i < TREE_COUNT; i++) {
      // Offset slightly from lamp posts (posts at i/9 * TRACK_LENGTH, trees at midpoints)
      const wz = -((i + 0.5) / TREE_COUNT) * TRACK_LENGTH;
      const trunkH = 4.5 + Math.random() * 1.5;

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, trunkH, 7),
        trunkMat,
      );
      trunk.position.set(sx, trunkH / 2, wz);
      scene.add(trunk);

      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(0.9 + Math.random() * 0.5, 7, 6),
        crownMat,
      );
      crown.position.set(sx, trunkH + 0.6, wz);
      scene.add(crown);
    }
  }
}

// ─── Daytime sky sphere ───────────────────────────────────────────────────────
// Large sphere rendered on the inside with a ShaderMaterial that blends from
// sky blue at the top to warm white at the horizon.
function buildSky(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(TRACK_LENGTH * 1.8, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldPos;
        void main() {
          // t = 0 at horizon (y=0), 1 at zenith
          float t = clamp(vWorldPos.y / 800.0, 0.0, 1.0);
          // horizon: warm white #FFF5E0  →  zenith: sky blue #87CEEB
          vec3 horizon = vec3(1.000, 0.961, 0.878);
          vec3 zenith  = vec3(0.529, 0.808, 0.922);
          gl_FragColor = vec4(mix(horizon, zenith, pow(t, 0.55)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  scene.add(sky);
}

// ─── Roadside lamp posts ───────────────────────────────────────────────────────
// 10 decorative posts per side, evenly spaced — geometry only, no per-post lights.
// 5 shared PointLights are spread along the road instead for ambient road glow.
function buildLampPosts(scene) {
  const POLE_H  = 6;
  const SIDE_X  = ROAD_W / 2 + 1.2;
  const COUNT   = 10;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555560, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffe8a0,
    emissive: new THREE.Color(0xffd060),
    emissiveIntensity: 1.8,
  });

  for (const sx of [-SIDE_X, SIDE_X]) {
    const armDir = sx < 0 ? 1 : -1;
    for (let i = 0; i < COUNT; i++) {
      const wz = -(i / (COUNT - 1)) * TRACK_LENGTH;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, POLE_H, 6), poleMat);
      pole.position.set(sx, POLE_H / 2, wz);
      scene.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), poleMat);
      arm.position.set(sx + armDir * 0.6, POLE_H, wz);
      scene.add(arm);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.45), headMat);
      head.position.set(sx + armDir * 1.1, POLE_H - 0.15, wz);
      scene.add(head);
    }
  }

  // 5 shared PointLights spread evenly along the road centre — replaces per-post lights
  for (let i = 0; i < 5; i++) {
    const wz = -(i / 4) * TRACK_LENGTH;
    const pt = new THREE.PointLight(0xffcc44, 1.2, 80);
    pt.position.set(0, POLE_H - 1, wz);
    scene.add(pt);
  }
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

    const above = carMeshes[i].position.clone();
    above.y += CAR_H * 1.3;
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

