/**
 * 3D behind-the-car race replay — Three.js renderer.
 *
 * Camera follows the player's car (index 0) from behind and above, looking
 * down the road toward the finish line.
 * Cars are billboard sprites (PlaneGeometry + pixel-art Lada texture).
 * Road, finish line, and Soviet-brutalist buildings are 3D geometry.
 * A 2D canvas overlay (orthographic second pass) renders progress bar,
 * player name labels, and the countdown sequence.
 *
 * Drop-in replacement for the original 2D replay — same public signature:
 *   runReplay(canvas, hexSeed, { onComplete, onTick, playerNames })
 */

import * as THREE from 'three';
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME = 2;

const ROAD_W = 14;      // total road width, world units
const CAR_W  = 3.2;     // car billboard width, world units
const CAR_H  = CAR_W * 0.45;

const CAM_BACK   = 10;  // world units behind player
const CAM_HEIGHT = 4.5;
const CAM_AHEAD  = 22;  // look-ahead from player's position
const CAM_LERP   = 0.07;

const COUNTDOWN_STEP  = 36;
const COUNTDOWN_GO    = 24;
const COUNTDOWN_TOTAL = 3 * COUNTDOWN_STEP + COUNTDOWN_GO;

const END_DRIVE     = 55;
const END_CELEBRATE = 50;
const END_HOLD      = 20;
const END_TOTAL     = END_DRIVE + END_CELEBRATE + END_HOLD;

// Multiply-blend tints to tell cars apart (white = unchanged sprite)
const TINTS = [
  new THREE.Color(1.00, 1.00, 1.00),   // 0: original cream
  new THREE.Color(1.80, 0.35, 0.25),   // 1: Soviet red
  new THREE.Color(0.30, 1.60, 0.40),   // 2: green
  new THREE.Color(0.70, 0.30, 1.80),   // 3: purple
  new THREE.Color(1.80, 0.90, 0.15),   // 4: orange/gold
];

// Progress-bar colours matching the tint palette (CSS strings for 2D canvas)
const HUD_COLORS = ['#e8e0d0', '#c8472b', '#2d8a3a', '#5a22bb', '#d97a10'];

// Soviet concrete palette (hex) for building faces
const BPAL = [0x1e2226, 0x1c1d1f, 0x20201e, 0x1a1e24, 0x22211f, 0x1d2123];

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

  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, true);    // true: Three.js sets canvas.style.width/height explicitly
  renderer.autoClear = false;

  // ── Physics simulation ────────────────────────────────────────────────────
  const rng   = createRng(seedFromHex(hexSeed));
  const track = buildTrack(rng, 2);
  const sim   = simulate(track, rng);
  const N     = sim.history[0].positions.length;

  // Lane X positions: evenly spread across ROAD_W
  const laneX = Array.from({ length: N }, (_, i) =>
    ((i + 0.5) / N - 0.5) * ROAD_W * 0.75,
  );

  // ── Main 3D scene ─────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e2633);
  scene.fog = new THREE.Fog(0x1e2633, TRACK_LENGTH * 0.45, TRACK_LENGTH * 1.05);

  // Lighting — ambient + warm directional "streetlight" sun
  scene.add(new THREE.AmbientLight(0xbbd4ff, 1.8));
  const sun = new THREE.DirectionalLight(0xffd080, 0.7);
  sun.position.set(6, 14, 10);
  scene.add(sun);
  // Soft hemisphere: sky blue from above, warm asphalt from below
  scene.add(new THREE.HemisphereLight(0x546e9a, 0x2a2416, 0.7));

  // ── Main camera ───────────────────────────────────────────────────────────
  const camera  = new THREE.PerspectiveCamera(65, W / H, 0.1, TRACK_LENGTH * 2);
  const camPos  = new THREE.Vector3(laneX[0] * 0.15, CAM_HEIGHT, -CAM_BACK);
  const lookTgt = new THREE.Vector3(laneX[0] * 0.1, 0.8, CAM_AHEAD);
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

  // ── Car billboard meshes ──────────────────────────────────────────────────
  const carMeshes = Array.from({ length: N }, (_, i) => {
    const geo = new THREE.PlaneGeometry(CAR_W, CAR_H);
    const mat = new THREE.MeshBasicMaterial({
      color: TINTS[i % TINTS.length],
      transparent: true,
      alphaTest: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(laneX[i], CAR_H / 2, 0);
    scene.add(mesh);
    return mesh;
  });

  // ── Confetti particle system ──────────────────────────────────────────────
  const confetti = makeConfettiSystem(scene);

  // ── Animation state ───────────────────────────────────────────────────────
  let physTick   = 0;
  let frameCount = 0;
  let endFrame   = -1;
  let cancelled  = false;
  let rafId      = null;

  // ── Sprite loader ─────────────────────────────────────────────────────────
  // Colour-key the checkerboard background, then assign as a shared texture
  // to all car meshes.  The loop starts only after the sprite is ready so the
  // fallback tinted-colour cars never appear on screen.
  function loadAndApplySprite() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) { resolve(); return; }
        const oc = document.createElement('canvas');
        oc.width = img.width; oc.height = img.height;
        const octx = oc.getContext('2d');
        octx.drawImage(img, 0, 0);
        applyCheckerKey(oc, octx);
        const tex = new THREE.CanvasTexture(oc);
        // flipY defaults to true — correct for canvas-sourced textures
        for (const m of carMeshes) {
          m.material.map = tex;
          m.material.needsUpdate = true;
        }
        resolve();
      };
      img.onerror = () => resolve();   // continue without sprite
      img.src = '/lada-pixel.jpg';
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

    // Update car positions + billboard orientation
    for (let i = 0; i < N; i++) {
      const bounce = endFrame < 0
        ? Math.sin(physTick * 0.32 + i * 1.85) * Math.max(0, state.speeds[i] - 1.2) * 0.06
        : 0;
      carMeshes[i].position.set(laneX[i], CAR_H / 2 + bounce, state.positions[i]);
      // Billboard: local +Z faces the camera so the texture is always visible
      carMeshes[i].lookAt(camera.position);
    }

    // Smoothly follow car 0 from behind
    const pz = carMeshes[0].position.z;
    camPos.x += (laneX[0] * 0.15 - camPos.x) * CAM_LERP;
    camPos.y += (CAM_HEIGHT        - camPos.y) * CAM_LERP;
    camPos.z += (pz - CAM_BACK     - camPos.z) * CAM_LERP;
    camera.position.copy(camPos);
    lookTgt.set(laneX[0] * 0.1, 0.8, pz + CAM_AHEAD);
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

    if (endFrame >= END_TOTAL) { onComplete?.(); return; }
    rafId = requestAnimationFrame(loop);
  }

  // Start loop once sprite is ready (mirrors original — no fallback flash)
  loadAndApplySprite().then(() => {
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
  const Z0  = -25;
  const LEN = TRACK_LENGTH * 1.35;

  // Asphalt surface
  const roadMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_W, LEN),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.95, metalness: 0 }),
  );
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.position.set(0, 0, Z0 + LEN / 2);
  scene.add(roadMesh);

  // Road edges (solid kerb lines)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a8070 });
  for (const ex of [-ROAD_W / 2, ROAD_W / 2]) {
    const pts = [new THREE.Vector3(ex, 0.03, Z0), new THREE.Vector3(ex, 0.03, Z0 + LEN)];
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  // Dashed lane dividers between each pair of adjacent lanes
  const dashMat = new THREE.LineDashedMaterial({ color: 0xc09030, dashSize: 8, gapSize: 6 });
  for (let i = 0; i < N - 1; i++) {
    const x   = (laneX[i] + laneX[i + 1]) / 2;
    const pts = [new THREE.Vector3(x, 0.03, Z0), new THREE.Vector3(x, 0.03, Z0 + LEN)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.computeLineDistances();
    scene.add(new THREE.Line(geo, dashMat));
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
  mesh.position.set(0, 0.015, TRACK_LENGTH);
  scene.add(mesh);

  // Vertical finish posts on each side
  const postMat = new THREE.MeshStandardMaterial({ color: 0xddcc88, emissive: 0xffd700, emissiveIntensity: 0.3 });
  for (const sx of [-ROAD_W / 2, ROAD_W / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), postMat);
    post.position.set(sx, 3, TRACK_LENGTH);
    scene.add(post);
  }
  // Crossbar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 0.25, 0.25, 0.25), postMat);
  bar.position.set(0, 6, TRACK_LENGTH);
  scene.add(bar);

  return mesh;
}

// ─── Soviet cityscape buildings ───────────────────────────────────────────────
function buildBuildings(scene, rng) {
  const CLEARANCE = ROAD_W / 2 + 1.5;

  for (const side of [-1, 1]) {
    let z = 5;
    while (z < TRACK_LENGTH * 1.25) {
      const w     = 4  + rng() * 14;
      const h     = 8  + rng() * 32;
      const depth = 3  + rng() * 9;
      const gap   = 0.5 + rng() * 5;
      const xOff  = rng() * 5;

      const bx = side * (CLEARANCE + w / 2 + xOff);
      const bz = z + depth / 2;

      const base            = BPAL[Math.floor(rng() * BPAL.length)];
      const emissiveIntens  = 0.06 + rng() * 0.26;

      const geo  = new THREE.BoxGeometry(w, h, depth);
      const mat  = new THREE.MeshStandardMaterial({
        color: base,
        emissive: new THREE.Color(0xb06818),
        emissiveIntensity: emissiveIntens,
        roughness: 0.92,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(bx, h / 2, bz);
      scene.add(mesh);

      // Rooftop silhouettes: antenna or water tower stub
      if (rng() > 0.55) {
        const aW   = 0.25 + rng() * 0.35;
        const aH   = 3    + rng() * 8;
        const aMat = new THREE.MeshStandardMaterial({ color: 0x131415, roughness: 1 });
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

// ─── Checkerboard colour-key ───────────────────────────────────────────────────
// Same algorithm as the original 2D version: samples all four edges to detect
// both tile colours, then zeros the alpha of matching pixels + hard border strip.
function applyCheckerKey(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  const sp = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i+1], d[i+2]]; };
  const bgMap = new Map();
  const add   = (r, g, b) => {
    const k = `${Math.round(r/20)},${Math.round(g/20)},${Math.round(b/20)}`;
    if (!bgMap.has(k)) bgMap.set(k, [r, g, b]);
  };
  const S = 20;
  for (let i = 0; i < S; i++) {
    add(...sp(i, 0));  add(...sp(W-1-i, 0));
    add(...sp(0, H-1-i));  add(...sp(W-1-i, H-1-i));
  }
  const bgs = [...bgMap.values()];
  const BORDER = 3, TOL = 30;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x < BORDER || x >= W-BORDER || y < BORDER || y >= H-BORDER) { d[i+3] = 0; continue; }
      for (const [br, bg, bb] of bgs) {
        if (Math.abs(d[i]-br) <= TOL && Math.abs(d[i+1]-bg) <= TOL && Math.abs(d[i+2]-bb) <= TOL) {
          d[i+3] = 0; break;
        }
      }
    }
  }
  ctx.putImageData(id, 0, 0);
}
