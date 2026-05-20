/**
 * Visual replay driver — renders the race on a canvas using the same RNG
 * seed the contract produced. Pure presentation: the on-chain outcome is
 * already decided.
 *
 * Scene composition (top → bottom of viewport):
 *   - overcast sky with brutalist apartment block silhouettes
 *   - distant horizon haze
 *   - asphalt road with painted lane stripes, scrolling
 *   - potholes scattered along each lane (positions from seed)
 *   - birch trees on both sides, scrolling
 *   - occasional babushka and road sign silhouettes
 *   - two Ladas (one red, one beige)
 *
 * The viewport scrolls vertically: cars stay roughly mid-screen and the
 * world scrolls past underneath them.
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

const LANE_COUNT  = 2;
const PHYS_PER_FRAME = 4;     // physics ticks per render frame (≈15fps physics @ 60fps render)

const CAR_W = 28;
const CAR_H = 48;

export function runReplay(canvas, hexSeed, { onComplete, onTick } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width  = canvas.clientWidth  * dpr;
  const H = canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  const rng = createRng(seedFromHex(hexSeed));
  const track = buildTrack(rng, LANE_COUNT);
  const sim   = simulate(track, rng);

  // Pre-generate scenery from the same RNG so it's reproducible too
  const scenery = generateScenery(rng);

  let physTick = 0;
  let frameCount = 0;
  let rafId = null;
  let cancelled = false;

  function loop() {
    if (cancelled) return;
    frameCount++;
    // Advance physics every PHYS_PER_FRAME render frames
    if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
      physTick++;
      onTick?.(physTick, sim);
    }
    drawFrame(ctx, w, h, sim, track, scenery, physTick);
    if (physTick >= sim.history.length - 1) {
      onComplete?.(sim.winner);
      return;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Scenery generation
// ─────────────────────────────────────────────────────────────────────

function generateScenery(rng) {
  // Trees on each side of the road (track-space positions)
  const trees = [];
  for (let y = -50; y < TRACK_LENGTH + 100; y += 20 + Math.floor(rng() * 30)) {
    trees.push({ y, side: rng() < 0.5 ? 'L' : 'R', tilt: (rng() - 0.5) * 0.2 });
    if (rng() < 0.4) trees.push({ y: y + 8, side: rng() < 0.5 ? 'L' : 'R', tilt: (rng() - 0.5) * 0.2 });
  }

  // Brutalist building skyline — fixed pattern at top
  const buildings = [];
  let x = 0;
  while (x < 100) {
    const wPct = 6 + rng() * 12;
    const hPct = 30 + rng() * 50;
    buildings.push({ x, w: wPct, h: hPct, windows: 2 + Math.floor(rng() * 4) });
    x += wPct + 1 + rng() * 2;
  }

  // Babushkas and road signs scattered along the road
  const props = [];
  for (let y = 100; y < TRACK_LENGTH; y += 80 + Math.floor(rng() * 100)) {
    props.push({
      y,
      side: rng() < 0.5 ? 'L' : 'R',
      kind: rng() < 0.5 ? 'babushka' : 'sign',
    });
  }

  return { trees, buildings, props };
}

// ─────────────────────────────────────────────────────────────────────
//  Drawing
// ─────────────────────────────────────────────────────────────────────

function drawFrame(ctx, w, h, sim, track, scenery, physTick) {
  const state = sim.history[physTick];
  const positions = state.positions;
  const lead = Math.max(...positions);

  // Camera follows the leader, keeping it near the upper-mid of the screen
  const cameraY = Math.max(0, lead - h * 0.55);
  const trackToScreen = (yTrack) => h - (yTrack - cameraY);     // higher track-y = nearer top

  // Layout: road takes the centre 60% of width, scenery on the sides
  const roadLeft  = w * 0.20;
  const roadRight = w * 0.80;
  const roadW = roadRight - roadLeft;
  const laneW = roadW / 2;

  // ─── Sky + brutalist horizon ───
  drawSky(ctx, w, h, scenery);

  // ─── Side ground (mud/grass) ───
  ctx.fillStyle = '#3a3a32';
  ctx.fillRect(0, h * 0.18, roadLeft, h);
  ctx.fillRect(roadRight, h * 0.18, w - roadRight, h);

  // ─── Asphalt ───
  ctx.fillStyle = '#222428';
  ctx.fillRect(roadLeft, h * 0.18, roadW, h);

  // Painted edge lines (Soviet style — single solid)
  ctx.strokeStyle = '#a8a195';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(roadLeft  + 4, h * 0.18); ctx.lineTo(roadLeft  + 4, h);
  ctx.moveTo(roadRight - 4, h * 0.18); ctx.lineTo(roadRight - 4, h);
  ctx.stroke();

  // Centre dashed line
  drawDashes(ctx, roadLeft + laneW, h * 0.18, h, cameraY);

  // ─── Trees / props (scenery) ───
  for (const tree of scenery.trees) {
    const sy = trackToScreen(tree.y);
    if (sy < -40 || sy > h + 40) continue;
    const sx = tree.side === 'L'
      ? roadLeft * 0.5 + Math.sin(tree.y * 0.3) * 6
      : roadRight + (w - roadRight) * 0.5 + Math.sin(tree.y * 0.3) * 6;
    drawBirch(ctx, sx, sy, tree.tilt);
  }
  for (const prop of scenery.props) {
    const sy = trackToScreen(prop.y);
    if (sy < -40 || sy > h + 40) continue;
    const sx = prop.side === 'L' ? roadLeft  - 18 : roadRight + 6;
    if (prop.kind === 'babushka') drawBabushka(ctx, sx, sy);
    else                          drawSign(ctx, sx, sy);
  }

  // ─── Potholes ───
  for (let i = 0; i < track.lanes.length; i++) {
    const lane = track.lanes[i];
    const laneCx = roadLeft + laneW * (i + 0.5);
    for (const py of lane.potholes) {
      const sy = trackToScreen(py);
      if (sy < -20 || sy > h + 20) continue;
      drawPothole(ctx, laneCx, sy);
    }
  }

  // ─── Cars ───
  for (let i = 0; i < positions.length; i++) {
    const laneCx = roadLeft + laneW * (i + 0.5);
    const sy = trackToScreen(positions[i]);
    drawLada(ctx, laneCx, sy, i, state.hits[i], state.speeds[i]);
  }

  // ─── Finish line ───
  const finishY = trackToScreen(track.length);
  if (finishY > -20 && finishY < h + 20) {
    drawFinishLine(ctx, roadLeft, roadRight, finishY);
  }

  // ─── HUD: progress bar ───
  drawProgressHud(ctx, w, h, positions, track.length);
}

function drawSky(ctx, w, h, scenery) {
  const skyH = h * 0.18;
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, '#3a4452');
  grad.addColorStop(1, '#6b7382');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, skyH);

  // Brutalist buildings — silhouettes along the horizon
  for (const b of scenery.buildings) {
    const x = (b.x / 100) * w;
    const bw = (b.w / 100) * w;
    const bh = (b.h / 100) * skyH;
    ctx.fillStyle = '#252a32';
    ctx.fillRect(x, skyH - bh, bw, bh);
    // window grid
    ctx.fillStyle = 'rgba(217, 160, 74, 0.4)';
    const wCols = b.windows;
    const wRows = Math.max(3, Math.floor(bh / 8));
    const pad = 2;
    const cellW = (bw - pad * (wCols + 1)) / wCols;
    const cellH = 3;
    for (let r = 0; r < wRows; r++) {
      for (let c = 0; c < wCols; c++) {
        if ((r + c + Math.floor(b.x)) % 3 === 0) continue; // some windows dark
        ctx.fillRect(x + pad + c * (cellW + pad), skyH - bh + 6 + r * (cellH + 3), cellW, cellH);
      }
    }
  }
  // Horizon haze
  ctx.fillStyle = 'rgba(108, 116, 130, 0.4)';
  ctx.fillRect(0, skyH - 4, w, 6);
}

function drawDashes(ctx, x, y0, y1, cameraY) {
  ctx.strokeStyle = '#d9a04a';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 14]);
  ctx.lineDashOffset = -(cameraY % 24);
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBirch(ctx, x, y, tilt) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  // trunk
  ctx.fillStyle = '#e8e2d0';
  ctx.fillRect(-2, -22, 4, 28);
  // black notches
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-2, -16, 4, 1);
  ctx.fillRect(-2, -8,  4, 1);
  ctx.fillRect(-2, 0,   4, 1);
  // foliage (small dark green dot, not full crown — keeps it stylised)
  ctx.fillStyle = '#3b4a32';
  ctx.beginPath();
  ctx.arc(0, -26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBabushka(ctx, x, y) {
  // Tiny silhouette: kerchief + coat
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(x - 3, y - 8, 6, 9);
  ctx.fillStyle = '#c8472b';
  ctx.beginPath();
  ctx.arc(x, y - 10, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawSign(ctx, x, y) {
  // Wooden pole + faded sign
  ctx.fillStyle = '#8a5a3b';
  ctx.fillRect(x - 1, y - 10, 2, 10);
  ctx.fillStyle = '#d9a04a';
  ctx.fillRect(x - 6, y - 18, 12, 8);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - 4, y - 15, 8, 1);
}

function drawPothole(ctx, x, y) {
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(x, y, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLada(ctx, x, y, idx, hit, speed) {
  const colors = ['#c8472b', '#ede4cf'];                    // red, beige
  const body = colors[idx % colors.length];
  const w = CAR_W, hh = CAR_H;
  const left = x - w / 2;
  const top  = y - hh / 2;

  // Speed lines behind
  if (speed > 4) {
    ctx.strokeStyle = 'rgba(237, 228, 207, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const lx = left + 4 + i * 8;
      ctx.beginPath();
      ctx.moveTo(lx, top + hh + 2);
      ctx.lineTo(lx, top + hh + 10);
      ctx.stroke();
    }
  }

  // Pothole splash
  if (hit) {
    ctx.fillStyle = 'rgba(74, 58, 42, 0.7)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * 14, y + Math.sin(ang) * 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(left + 2, top + hh - 4, w, 4);

  // Body
  ctx.fillStyle = body;
  ctx.fillRect(left, top, w, hh);

  // Roof
  ctx.fillStyle = shade(body, -0.2);
  ctx.fillRect(left + 3, top + 10, w - 6, hh - 26);

  // Windshield
  ctx.fillStyle = '#3a4452';
  ctx.fillRect(left + 4, top + 12, w - 8, 6);

  // Rear window
  ctx.fillRect(left + 4, top + hh - 14, w - 8, 5);

  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(left - 2, top + 6,         4, 8);
  ctx.fillRect(left + w - 2, top + 6,     4, 8);
  ctx.fillRect(left - 2, top + hh - 14,   4, 8);
  ctx.fillRect(left + w - 2, top + hh - 14, 4, 8);

  // Headlights (front = bottom of car since we're driving "up" the track)
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(left + 2, top + hh - 3, 6, 2);
  ctx.fillRect(left + w - 8, top + hh - 3, 6, 2);
}

function drawFinishLine(ctx, x0, x1, y) {
  const sq = 8;
  for (let x = x0; x < x1; x += sq) {
    ctx.fillStyle = ((x / sq) | 0) % 2 ? '#ede4cf' : '#1a1a1a';
    ctx.fillRect(x, y - sq, sq, sq);
  }
}

function drawProgressHud(ctx, w, h, positions, length) {
  const colors = ['#c8472b', '#ede4cf'];
  const padX = 16;
  const barW = w - padX * 2;
  const barY = 12;
  ctx.fillStyle = 'rgba(20,20,20,0.6)';
  ctx.fillRect(padX, barY, barW, 16);
  for (let i = 0; i < positions.length; i++) {
    const pct = Math.min(1, positions[i] / length);
    ctx.fillStyle = colors[i];
    ctx.fillRect(padX, barY + i * 8, barW * pct, 7);
  }
  ctx.strokeStyle = '#3a3530';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, barY, barW, 16);
}

function shade(hex, amount) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const ch = (c) => {
    const v = Math.max(0, Math.min(255, Math.round(parseInt(c, 16) * (1 + amount))));
    return v.toString(16).padStart(2, '0');
  };
  return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`;
}
