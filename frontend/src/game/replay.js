/**
 * Side-scrolling Soviet street race — visual replay driver.
 *
 * Scene (top → bottom):
 *   Top 36%  — overcast grey sky + parallax brutalist building silhouettes
 *   Next 8%  — ground strip with birch trees (closer parallax)
 *   Bottom 56% — dark asphalt road split into N horizontal lanes (one per car)
 *
 * Road scrolls RIGHT → LEFT giving the illusion of forward motion.
 * The camera follows the leader; trailing cars drift left on screen.
 * Each car is drawn as a Lada 2107 side profile with TON-diamond headlights.
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME  = 3;    // physics steps per render frame  (~10 s race at 60 fps)
const SCROLL_SCALE    = 0.5;  // road-px per physics speed unit
const LEAD_X_FRAC     = 0.30; // leader's fixed screen-x as fraction of canvas width
const SPREAD_SCALE    = 1.1;  // max px separation (as fraction of w) when fully lapped
const END_FLASH_TICKS = 50;   // flash frames after winner crosses finish

const CAR_COLORS = [
  '#e8e0d0', // off-white
  '#c8472b', // Soviet red
  '#1a1a1a', // black
  '#2d5a2d', // dark green
  '#1a2855', // navy
];

// ─── entry point ─────────────────────────────────────────────────────────────
export function runReplay(canvas, hexSeed, { onComplete, onTick } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // robust dimension fallback (Telegram WebView can report 0 clientWidth)
  const rect = canvas.getBoundingClientRect();
  const cssW = canvas.clientWidth  || rect.width  || window.innerWidth  || 360;
  const cssH = canvas.clientHeight || rect.height || window.innerHeight || 640;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);
  const W = cssW, H = cssH;

  const rng   = createRng(seedFromHex(hexSeed));
  const track = buildTrack(rng, 2);
  const sim   = simulate(track, rng);
  const N     = sim.history[0].positions.length; // always 2 for current races

  // layout zones
  const SKY_H  = H * 0.36;
  const TREE_H = H * 0.08;
  const ROAD_Y = SKY_H + TREE_H;
  const LANE_H = (H - ROAD_Y) / N;
  const CAR_W  = Math.min(LANE_H * 2.0, 120);
  const CAR_H  = CAR_W * 0.44;

  const scenery = buildScenery(rng, W);

  let physTick     = 0;
  let frameCount   = 0;
  let scrollX      = 0;
  let endCountdown = -1; // set to END_FLASH_TICKS when race finishes
  let cancelled    = false;
  let rafId        = null;

  function loop() {
    if (cancelled) return;
    frameCount++;

    // advance physics
    if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
      physTick++;
      onTick?.(physTick, sim);
    }

    const atEnd = physTick >= sim.history.length - 1;
    if (atEnd && endCountdown < 0) endCountdown = END_FLASH_TICKS;
    if (endCountdown > 0) endCountdown--;

    const state   = sim.history[physTick];
    const maxSpd  = Math.max(...state.speeds, 1);
    scrollX      += maxSpd * SCROLL_SCALE;

    // flash-on when countdown is in the bright half of each 10-frame blink
    const flashOn = endCountdown > 0 && endCountdown % 10 < 5;

    drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
              sim, state, scenery, scrollX, physTick, sim.winner, flashOn);

    if (atEnd && endCountdown === 0) {
      onComplete?.();
      return;
    }
    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);
  return () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId); };
}

// ─── scenery generation (seeded, so it's reproducible) ───────────────────────
function buildScenery(rng, W) {
  // Buildings tile across W*2 virtual pixels (parallax halved)
  const buildings = [];
  let bx = 0;
  const bTile = W * 2;
  while (bx < bTile) {
    const bw = 28 + rng() * 58;
    buildings.push({
      x: bx, w: bw,
      hFrac: 0.38 + rng() * 0.54,
      cols: 1 + Math.floor(rng() * 5),
    });
    bx += bw + 2 + rng() * 10;
  }

  // Trees tile across W*2 (medium parallax)
  const trees = [];
  let tx = 15;
  const tTile = W * 2;
  while (tx < tTile) {
    trees.push({ x: tx, sc: 0.55 + rng() * 0.75 });
    tx += 35 + rng() * 65;
  }

  // Road cracks (tile across W*3)
  const cracks = [];
  const rTile = W * 3;
  for (let i = 0; i < 35; i++) {
    cracks.push({
      x: rng() * rTile, yFrac: 0.1 + rng() * 0.8,
      lane: Math.floor(rng() * 2),
      len: 10 + rng() * 28, angle: rng() * Math.PI,
    });
  }

  // Potholes
  const potholes = [];
  for (let i = 0; i < 18; i++) {
    potholes.push({
      x: rng() * rTile, yFrac: 0.15 + rng() * 0.7,
      lane: Math.floor(rng() * 2),
      rx: 7 + rng() * 11, ry: 4 + rng() * 6,
    });
  }

  return { buildings, trees, cracks, potholes };
}

// ─── frame ───────────────────────────────────────────────────────────────────
function drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                   sim, state, scenery, scrollX, physTick, winnerIdx, flashOn) {
  ctx.clearRect(0, 0, W, H);

  drawSky(ctx, W, SKY_H, scrollX, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, scrollX, scenery.trees);
  drawRoad(ctx, W, H, N, ROAD_Y, LANE_H, scrollX, scenery.cracks, scenery.potholes);

  // progress bar HUD (top of road)
  drawProgressHud(ctx, W, ROAD_Y, state.positions, sim.history.length, N);

  // cars — draw from back to front (higher index = behind)
  const leadPos = Math.max(...state.positions);
  for (let i = N - 1; i >= 0; i--) {
    const carX = W * LEAD_X_FRAC
      - (leadPos - state.positions[i]) / TRACK_LENGTH * W * SPREAD_SCALE;
    const carY = ROAD_Y + (i + 0.54) * LANE_H; // wheel-bottom y
    drawLada(ctx, carX, carY, CAR_W, CAR_H,
             CAR_COLORS[i % CAR_COLORS.length],
             state.speeds[i], state.hits[i],
             i === winnerIdx && flashOn);
  }

  // finish line banner (slides in from right in final 15% of race)
  const pct = physTick / sim.history.length;
  if (pct > 0.85) {
    drawFinish(ctx, W, H, ROAD_Y, (pct - 0.85) / 0.15);
  }
}

// ─── sky ─────────────────────────────────────────────────────────────────────
function drawSky(ctx, W, skyH, scrollX, buildings) {
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, '#2e333c');
  grad.addColorStop(1, '#545e6e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, skyH);

  // faint horizontal cloud streaks
  ctx.strokeStyle = 'rgba(180,185,195,0.07)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const cy = skyH * (0.2 + i * 0.18);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
  }

  // buildings — parallax at 15% of scroll speed
  const tile  = W * 2;
  const shift = (scrollX * 0.15) % tile;
  for (const b of buildings) {
    const bx = ((b.x - shift) % tile + tile) % tile - 10;
    if (bx > W + b.w || bx < -b.w) continue;
    const bh = b.hFrac * skyH;
    ctx.fillStyle = '#1e2228';
    ctx.fillRect(bx, skyH - bh, b.w, bh);

    // windows
    const cols = b.cols;
    const rows = Math.max(2, Math.floor(bh / 11));
    const cw   = Math.max(2, (b.w - 6) / cols - 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c + Math.floor(b.x / 8)) % 3 === 0) continue;
        ctx.fillStyle = `rgba(210,160,55,${0.25 + (r % 2) * 0.15})`;
        ctx.fillRect(
          bx + 3 + c * ((b.w - 6) / cols),
          skyH - bh + 7 + r * 11,
          cw, 4,
        );
      }
    }

    // antenna on some buildings
    if (b.cols <= 2) {
      ctx.strokeStyle = '#1e2228';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + b.w * 0.5, skyH - bh);
      ctx.lineTo(bx + b.w * 0.5, skyH - bh - 10);
      ctx.stroke();
    }
  }

  // horizon haze
  const haze = ctx.createLinearGradient(0, skyH - 10, 0, skyH);
  haze.addColorStop(0, 'rgba(84,94,110,0)');
  haze.addColorStop(1, 'rgba(84,94,110,0.7)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, skyH - 10, W, 10);
}

// ─── tree strip ──────────────────────────────────────────────────────────────
function drawTrees(ctx, W, skyH, treeH, scrollX, trees) {
  // ground strip
  const y0 = skyH;
  const g  = ctx.createLinearGradient(0, y0, 0, y0 + treeH);
  g.addColorStop(0, '#252820');
  g.addColorStop(1, '#1a1c16');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, treeH);

  // grass texture dots
  ctx.fillStyle = 'rgba(40,50,30,0.4)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(i * (W / 8), y0 + treeH * 0.7, W / 8, treeH * 0.3);
  }

  const tile  = W * 2;
  const shift = (scrollX * 0.42) % tile;
  for (const t of trees) {
    const tx = ((t.x - shift) % tile + tile) % tile - 20;
    if (tx > W + 30 || tx < -30) continue;
    drawBirch(ctx, tx, y0 + treeH * 0.92, t.sc * treeH);
  }
}

function drawBirch(ctx, x, groundY, size) {
  const trunkH = size * 0.68;
  const trunkW = Math.max(2, size * 0.07);
  const fR     = size * 0.30;

  ctx.fillStyle = '#cdc7b5';
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);

  ctx.fillStyle = '#111';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x - trunkW / 2, groundY - trunkH * (0.3 + i * 0.25), trunkW, 1);
  }

  ctx.fillStyle = '#283322';
  ctx.beginPath();
  ctx.ellipse(x, groundY - trunkH - fR * 0.6, fR * 0.65, fR, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─── road ────────────────────────────────────────────────────────────────────
function drawRoad(ctx, W, H, N, roadY, laneH, scrollX, cracks, potholes) {
  // asphalt base
  ctx.fillStyle = '#1c1e22';
  ctx.fillRect(0, roadY, W, H - roadY);

  // subtle asphalt texture bands
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(0, roadY + (H - roadY) * (i / 6), W, (H - roadY) / 12);
  }

  // road edge lines
  ctx.strokeStyle = '#8a8070';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, roadY); ctx.lineTo(W, roadY);
  ctx.stroke();

  // lane dividers (dashed yellow)
  for (let i = 1; i < N; i++) {
    const lineY = roadY + i * laneH;
    ctx.strokeStyle = '#c09030';
    ctx.lineWidth = 2;
    ctx.setLineDash([22, 18]);
    ctx.lineDashOffset = -(scrollX % 40);
    ctx.beginPath();
    ctx.moveTo(0, lineY); ctx.lineTo(W, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // cracks
  const tileW = W * 3;
  ctx.strokeStyle = '#0e0f12';
  ctx.lineWidth = 1;
  for (const c of cracks) {
    const cx = ((c.x - scrollX) % tileW + tileW) % tileW;
    if (cx > W + 40 || cx < -40) continue;
    const cy = roadY + c.lane * laneH + c.yFrac * laneH;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(c.angle);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(c.len, 0);
    ctx.stroke();
    // branch
    ctx.beginPath();
    ctx.moveTo(c.len * 0.45, 0);
    ctx.lineTo(c.len * 0.45 + 7, -5);
    ctx.stroke();
    ctx.restore();
  }

  // potholes
  for (const p of potholes) {
    const px = ((p.x - scrollX) % tileW + tileW) % tileW;
    if (px > W + 30 || px < -30) continue;
    const py = roadY + p.lane * laneH + p.yFrac * laneH;
    ctx.fillStyle = '#0a0b0e';
    ctx.beginPath();
    ctx.ellipse(px, py, p.rx, p.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e2028';
    ctx.lineWidth = 1;
    ctx.stroke();
    // water sheen
    ctx.fillStyle = 'rgba(60,80,120,0.18)';
    ctx.beginPath();
    ctx.ellipse(px - p.rx * 0.2, py - p.ry * 0.2, p.rx * 0.5, p.ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── progress HUD ────────────────────────────────────────────────────────────
function drawProgressHud(ctx, W, roadY, positions, totalTicks, N) {
  const barH = 5;
  const barY = roadY - barH - 2;
  ctx.fillStyle = 'rgba(20,22,28,0.7)';
  ctx.fillRect(0, barY - 1, W, barH + 2);
  for (let i = 0; i < N; i++) {
    const pct = Math.min(1, positions[i] / TRACK_LENGTH);
    ctx.fillStyle = CAR_COLORS[i % CAR_COLORS.length];
    ctx.fillRect(0, barY + i * (barH / N), W * pct, barH / N);
  }
}

// ─── finish line ─────────────────────────────────────────────────────────────
function drawFinish(ctx, W, H, roadY, alpha) {
  const sq = 14;
  const bx = W - sq * 2 - 2;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  for (let row = 0; (roadY + row * sq) < H; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f4f0e8' : '#111';
      ctx.fillRect(bx + col * sq, roadY + row * sq, sq, sq);
    }
  }
  ctx.fillStyle = '#888';
  ctx.fillRect(bx - 3, roadY, 3, H - roadY);
  ctx.restore();
}

// ─── Lada 2107 side profile ───────────────────────────────────────────────────
//  cx = horizontal centre of car, cy = wheel-bottom (ground) y
//  CW / CH = design width / height  (CH measured from ground to roof)
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L  = cx - CW / 2;  // left edge (rear of car)
  const WR = CH * 0.235;   // wheel radius
  const WY = cy;           // wheel centre y = ground level

  ctx.save();

  // ── exhaust smoke ─────────────────────────────────────────────────────────
  if (speed > 1.5) {
    const numPuffs = hit ? 4 : Math.min(3, Math.ceil(speed / 2.5));
    for (let i = 0; i < numPuffs; i++) {
      const r = (3 + i * 3) * (hit ? 1.4 : 1);
      const ox = -(i * 14 + 8);
      const oy = -CH * 0.18 - i * 3;
      ctx.fillStyle = hit
        ? `rgba(80,65,45,${0.55 - i * 0.12})`
        : `rgba(130,125,118,${0.30 - i * 0.07})`;
      ctx.beginPath();
      ctx.arc(L + ox, cy + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── speed lines ──────────────────────────────────────────────────────────
  if (speed > 4 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const ly  = cy - CH * (0.28 + i * 0.16);
      const len = 14 + (3 - i) * 7;
      ctx.beginPath();
      ctx.moveTo(L - len - 4, ly); ctx.lineTo(L - 4, ly);
      ctx.stroke();
    }
  }

  // ── lower body ───────────────────────────────────────────────────────────
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L + 6,        WY - WR * 0.3);          // rear bumper base
  ctx.lineTo(L + 6,        cy - CH * 0.46);          // rear trunk side
  ctx.lineTo(L + CW * 0.15, cy - CH * 0.52);         // trunk shoulder
  ctx.lineTo(L + CW * 0.74, cy - CH * 0.50);         // hood start
  ctx.lineTo(L + CW * 0.86, cy - CH * 0.42);         // nose slope
  ctx.lineTo(L + CW - 6,   WY - WR * 0.3);           // front bumper base
  ctx.closePath();
  ctx.fill();

  // ── cabin ────────────────────────────────────────────────────────────────
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.15, cy - CH * 0.52);  // C-pillar base rear
  ctx.lineTo(L + CW * 0.20, cy - CH);          // C-pillar top (rear roof)
  ctx.lineTo(L + CW * 0.72, cy - CH);          // A-pillar top (front roof)
  ctx.lineTo(L + CW * 0.78, cy - CH * 0.52);  // A-pillar base
  ctx.lineTo(L + CW * 0.74, cy - CH * 0.50);  // rejoin body
  ctx.lineTo(L + CW * 0.15, cy - CH * 0.52);
  ctx.closePath();
  ctx.fill();

  // roof shading
  ctx.fillStyle = shade(color, -0.18);
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.21, cy - CH);
  ctx.lineTo(L + CW * 0.22, cy - CH + 4);
  ctx.lineTo(L + CW * 0.70, cy - CH + 4);
  ctx.lineTo(L + CW * 0.71, cy - CH);
  ctx.closePath();
  ctx.fill();

  // ── windows ──────────────────────────────────────────────────────────────
  const winColor = 'rgba(25,45,75,0.90)';
  ctx.fillStyle = winColor;

  // rear window
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.16,  cy - CH * 0.51);
  ctx.lineTo(L + CW * 0.21,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.34,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.34,  cy - CH * 0.52);
  ctx.closePath();
  ctx.fill();

  // main side window
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.36,  cy - CH * 0.51);
  ctx.lineTo(L + CW * 0.36,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.70,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.73,  cy - CH * 0.51);
  ctx.closePath();
  ctx.fill();

  // windshield (angled forward)
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.75,  cy - CH * 0.51);
  ctx.lineTo(L + CW * 0.72,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.77,  cy - CH + 5);
  ctx.lineTo(L + CW * 0.79,  cy - CH * 0.51);
  ctx.closePath();
  ctx.fill();

  // window highlight glint
  ctx.strokeStyle = 'rgba(200,220,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.37, cy - CH + 6);
  ctx.lineTo(L + CW * 0.50, cy - CH + 6);
  ctx.stroke();

  // ── chrome trim line ──────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(195,185,165,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.14, cy - CH * 0.60);
  ctx.lineTo(L + CW * 0.75, cy - CH * 0.58);
  ctx.stroke();

  // ── wheel arches (darker body colour) ────────────────────────────────────
  const rWX = L + CW * 0.22;
  const fWX = L + CW * 0.75;
  ctx.fillStyle = shade(color, -0.28);
  for (const wx of [rWX, fWX]) {
    ctx.beginPath();
    ctx.arc(wx, WY, WR + 3, Math.PI, 0);
    ctx.fill();
  }

  // ── bumpers ───────────────────────────────────────────────────────────────
  ctx.fillStyle = shade(color, -0.32);
  ctx.fillRect(L,           cy - CH * 0.22, 6,  CH * 0.18);  // rear
  ctx.fillRect(L + CW - 6,  cy - CH * 0.22, 6,  CH * 0.18);  // front

  // ── taillights ───────────────────────────────────────────────────────────
  ctx.fillStyle = hit ? '#ff3300' : '#aa2200';
  ctx.fillRect(L + 6, cy - CH * 0.38, 5, CH * 0.13);

  // ── TON-diamond headlight (neon blue, front of car) ───────────────────────
  const hlCX = L + CW - 3;
  const hlCY = cy - CH * 0.32;
  const dlW  = CH * 0.17;
  const dlH  = CH * 0.13;
  ctx.shadowColor = '#00aaff';
  ctx.shadowBlur  = 16;
  ctx.fillStyle   = '#70d8ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,        hlCY - dlH);   // top
  ctx.lineTo(hlCX + dlW,  hlCY);         // right
  ctx.lineTo(hlCX,        hlCY + dlH);   // bottom
  ctx.lineTo(hlCX - dlW,  hlCY);         // left
  ctx.closePath();
  ctx.fill();
  // inner bright core
  ctx.shadowBlur = 6;
  ctx.fillStyle  = '#d8f4ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,           hlCY - dlH * 0.5);
  ctx.lineTo(hlCX + dlW * 0.5, hlCY);
  ctx.lineTo(hlCX,           hlCY + dlH * 0.5);
  ctx.lineTo(hlCX - dlW * 0.5, hlCY);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // ── wheels ───────────────────────────────────────────────────────────────
  drawWheel(ctx, rWX, WY, WR);
  drawWheel(ctx, fWX, WY, WR);

  // ── pothole splash ────────────────────────────────────────────────────────
  if (hit) {
    ctx.fillStyle = 'rgba(55,45,35,0.72)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - 0.2;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(ang) * WR * 1.8,
        WY  - WR + Math.sin(ang) * WR * 1.2,
        3, 0, Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // ── winner flash overlay ──────────────────────────────────────────────────
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.30)';
    ctx.fillRect(L - 6, cy - CH - 6, CW + 12, CH + 12);
  }

  ctx.restore();
}

function drawWheel(ctx, cx, cy, r) {
  // tyre
  ctx.fillStyle = '#111116';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // rim ring
  ctx.strokeStyle = '#555550';
  ctx.lineWidth   = r * 0.18;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  // centre cap
  ctx.fillStyle = '#888882';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.fill();
  // spokes
  ctx.strokeStyle = '#6a6a65';
  ctx.lineWidth   = 1;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22);
    ctx.lineTo(cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58);
    ctx.stroke();
  }
}

// ─── util ────────────────────────────────────────────────────────────────────
function shade(hex, amt) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return '#' + [m[1], m[2], m[3]].map((c) => {
    const v = Math.max(0, Math.min(255, Math.round(parseInt(c, 16) * (1 + amt))));
    return v.toString(16).padStart(2, '0');
  }).join('');
}
