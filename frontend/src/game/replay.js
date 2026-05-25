/**
 * Side-scrolling Soviet street race — visual replay driver.
 *
 * Scene (top → bottom):
 *   Top 36%  — overcast grey sky + parallax brutalist building silhouettes
 *   Next 8%  — ground strip with birch trees (closer parallax)
 *   Bottom 56% — dark asphalt road split into N horizontal lanes (one per car)
 *
 * Road scrolls RIGHT → LEFT; camera follows leader.
 * Ending sequence:
 *   1. Finish-line banner slides in from right during final 18% of physics.
 *   2. Once physics ends, winner drives to the finish line (55 frames).
 *   3. Winner crosses: particle burst + gold flash (50 frames).
 *   4. Brief hold (20 frames), then onComplete().
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME = 3;    // physics steps per render frame (~10 s race @ 60 fps)
const SCROLL_SCALE   = 1.25; // road-px per physics speed unit (2.5x faster feel)
const LEAD_X_FRAC    = 0.30; // leader fixed screen-x (fraction of W) during race
const SPREAD_SCALE   = 1.1;  // how far back a fully-lapped car appears (fraction of W)
const FINISH_X_FRAC  = 0.72; // where the finish line sits on screen

// ending-sequence timing (frames @ ~60 fps → ~2.1 s total)
const END_DRIVE     = 55;   // winner drives to finish line
const END_CELEBRATE = 50;   // particle burst + gold flash
const END_HOLD      = 20;   // pause before calling onComplete
const END_TOTAL     = END_DRIVE + END_CELEBRATE + END_HOLD;

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
  const N     = sim.history[0].positions.length;

  const SKY_H  = H * 0.36;
  const TREE_H = H * 0.08;
  const ROAD_Y = SKY_H + TREE_H;
  const LANE_H = (H - ROAD_Y) / N;
  const CAR_W  = Math.min(LANE_H * 2.4, 144);
  const CAR_H  = CAR_W * 0.42;  // total bounding box height (wheel center at 78% from top)

  const FINISH_X = W * FINISH_X_FRAC;

  const scenery = buildScenery(rng, W);

  // Celebration particles — not seeded (purely visual, outcome already decided)
  const CONFETTI_N = 30;
  const confetti = Array.from({ length: CONFETTI_N }, (_, i) => ({
    angle:  (i / CONFETTI_N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4,
    speed:  2.0 + Math.random() * 3.8,
    color:  ['#ffd700','#ff8800','#ff4455','#44ff88','#66bbff','#ffffff',
             '#ffee00','#ff66cc'][Math.floor(Math.random() * 8)],
    size:   2 + Math.random() * 3,
    spin:   (Math.random() - 0.5) * 0.35,
    rect:   Math.random() < 0.55,   // rect vs spark line
  }));

  let physTick   = 0;
  let frameCount = 0;
  let scrollX    = 0;
  let endFrame   = -1;   // -1 = physics still running
  let cancelled  = false;
  let rafId      = null;

  // Snapshot of car positions (screen-x) the moment physics ends
  const endStartX = new Array(N).fill(0);

  function loop() {
    if (cancelled) return;
    frameCount++;

    // ── physics advancement ───────────────────────────────────────────────
    if (endFrame < 0) {
      if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
        physTick++;
        onTick?.(physTick, sim);
      }
      if (physTick >= sim.history.length - 1) {
        // physics done — snapshot positions for ending interpolation
        const leadPos = Math.max(...sim.history[physTick].positions);
        for (let i = 0; i < N; i++) {
          endStartX[i] = W * LEAD_X_FRAC
            - (leadPos - sim.history[physTick].positions[i]) / TRACK_LENGTH * W * SPREAD_SCALE;
        }
        endFrame = 0;
      }
    } else {
      endFrame++;
    }

    const state      = sim.history[physTick];
    const lastState  = sim.history[sim.history.length - 1];
    const winnerSpd  = Math.max(...lastState.speeds, 1);

    // ── road scroll ───────────────────────────────────────────────────────
    if (endFrame < 0) {
      scrollX += Math.max(...state.speeds, 1) * SCROLL_SCALE;
    } else if (endFrame < END_DRIVE) {
      // road keeps moving while winner drives to line
      scrollX += winnerSpd * SCROLL_SCALE * (1 - easeOutCubic(endFrame / END_DRIVE) * 0.6);
    }
    // road stops scrolling once winner has crossed

    // ── car screen-x positions ────────────────────────────────────────────
    const carX = new Array(N);
    if (endFrame < 0) {
      // normal race: leader fixed at LEAD_X_FRAC, others trail left
      const leadPos = Math.max(...state.positions);
      for (let i = 0; i < N; i++) {
        carX[i] = W * LEAD_X_FRAC
          - (leadPos - state.positions[i]) / TRACK_LENGTH * W * SPREAD_SCALE;
      }
    } else {
      const driveT = Math.min(1, endFrame / END_DRIVE);
      const eased  = easeOutCubic(driveT);
      for (let i = 0; i < N; i++) {
        if (i === sim.winner) {
          // winner drives to finish line + one car-width past it
          carX[i] = endStartX[i] + eased * (FINISH_X + CAR_W * 0.55 - endStartX[i]);
        } else {
          // losers coast to a stop (drift slightly left then freeze)
          const loserT = Math.min(1, endFrame / (END_DRIVE * 0.7));
          carX[i] = endStartX[i] - easeOutCubic(loserT) * W * 0.08;
        }
      }
    }

    // ── finish-line x position ────────────────────────────────────────────
    // slides in from right during last 18% of physics; fixed once ending starts
    let finishLineX;
    const physPct = physTick / sim.history.length;
    if (endFrame >= 0) {
      finishLineX = FINISH_X;
    } else if (physPct >= 0.82) {
      const slideT = (physPct - 0.82) / 0.18;
      finishLineX = W + 60 - easeOutCubic(slideT) * (W + 60 - FINISH_X);
    } else {
      finishLineX = W + 60; // off screen
    }

    // ── celebration state ─────────────────────────────────────────────────
    const celebFrame = (endFrame >= END_DRIVE) ? (endFrame - END_DRIVE) : -1;
    const flashOn    = celebFrame >= 0 && celebFrame < END_CELEBRATE && celebFrame % 10 < 5;

    // ── draw ─────────────────────────────────────────────────────────────
    drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
              sim, state, scenery, scrollX, physTick, endFrame,
              carX, finishLineX, sim.winner, flashOn, celebFrame, confetti);

    // ── completion ────────────────────────────────────────────────────────
    if (endFrame >= END_TOTAL) {
      onComplete?.();
      return;
    }
    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);
  return () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId); };
}

// ─── easing ──────────────────────────────────────────────────────────────────
function easeOutCubic(t) { return 1 - Math.pow(1 - Math.min(1, t), 3); }

// ─── scenery generation ───────────────────────────────────────────────────────
function buildScenery(rng, W) {
  const buildings = [];
  let bx = 0;
  const bTile = W * 2;
  while (bx < bTile) {
    const bw = 28 + rng() * 58;
    buildings.push({ x: bx, w: bw, hFrac: 0.38 + rng() * 0.54, cols: 1 + Math.floor(rng() * 5) });
    bx += bw + 2 + rng() * 10;
  }

  const trees = [];
  let tx = 15;
  const tTile = W * 2;
  while (tx < tTile) {
    trees.push({ x: tx, sc: 0.55 + rng() * 0.75 });
    tx += 35 + rng() * 65;
  }

  const cracks = [], potholes = [];
  const rTile = W * 3;
  for (let i = 0; i < 35; i++) {
    cracks.push({ x: rng() * rTile, yFrac: 0.1 + rng() * 0.8, lane: Math.floor(rng() * 2), len: 10 + rng() * 28, angle: rng() * Math.PI });
  }
  for (let i = 0; i < 18; i++) {
    potholes.push({ x: rng() * rTile, yFrac: 0.15 + rng() * 0.7, lane: Math.floor(rng() * 2), rx: 7 + rng() * 11, ry: 4 + rng() * 6 });
  }

  return { buildings, trees, cracks, potholes };
}

// ─── frame ───────────────────────────────────────────────────────────────────
function drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                   sim, state, scenery, scrollX, physTick, endFrame,
                   carX, finishLineX, winnerIdx, flashOn, celebFrame, confetti) {
  ctx.clearRect(0, 0, W, H);

  drawSky(ctx, W, SKY_H, scrollX, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, scrollX, scenery.trees);
  drawRoad(ctx, W, H, N, ROAD_Y, LANE_H, scrollX, scenery.cracks, scenery.potholes);
  drawProgressHud(ctx, W, ROAD_Y, state.positions, N);
  drawFinishLine(ctx, H, ROAD_Y, finishLineX, celebFrame >= 0);

  // draw cars back-to-front (higher index = behind)
  for (let i = N - 1; i >= 0; i--) {
    const baseY  = ROAD_Y + (i + 0.54) * LANE_H;
    // bumpy Russian road: vertical bounce scales with speed, stops during ending sequence
    const bounce = endFrame < 0
      ? Math.sin(physTick * 0.32 + i * 1.85) * Math.max(0, state.speeds[i] - 1.2) * 0.65
      : 0;
    const carY   = baseY + bounce;
    const stopped = celebFrame >= 0 && i !== winnerIdx;
    drawLada(ctx, carX[i], carY, CAR_W, CAR_H,
             CAR_COLORS[i % CAR_COLORS.length],
             stopped ? 0 : state.speeds[i],
             state.hits[i],
             i === winnerIdx && flashOn);
  }

  // celebration burst on top of winner's car
  if (celebFrame >= 0 && celebFrame < 50) {
    const winY = ROAD_Y + (winnerIdx + 0.54) * LANE_H;
    drawCelebration(ctx, carX[winnerIdx], winY, CAR_W, CAR_H, celebFrame, confetti);
  }
}

// ─── sky ─────────────────────────────────────────────────────────────────────
function drawSky(ctx, W, skyH, scrollX, buildings) {
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, '#2e333c');
  grad.addColorStop(1, '#545e6e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, skyH);

  ctx.strokeStyle = 'rgba(180,185,195,0.07)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const cy = skyH * (0.2 + i * 0.18);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
  }

  const tile  = W * 2;
  const shift = (scrollX * 0.15) % tile;
  for (const b of buildings) {
    const bx = ((b.x - shift) % tile + tile) % tile - 10;
    if (bx > W + b.w || bx < -b.w) continue;
    const bh = b.hFrac * skyH;
    ctx.fillStyle = '#1e2228';
    ctx.fillRect(bx, skyH - bh, b.w, bh);
    const cols = b.cols;
    const rows = Math.max(2, Math.floor(bh / 11));
    const cw   = Math.max(2, (b.w - 6) / cols - 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c + Math.floor(b.x / 8)) % 3 === 0) continue;
        ctx.fillStyle = `rgba(210,160,55,${0.25 + (r % 2) * 0.15})`;
        ctx.fillRect(bx + 3 + c * ((b.w - 6) / cols), skyH - bh + 7 + r * 11, cw, 4);
      }
    }
    if (b.cols <= 2) {
      ctx.strokeStyle = '#1e2228'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + b.w * 0.5, skyH - bh); ctx.lineTo(bx + b.w * 0.5, skyH - bh - 10);
      ctx.stroke();
    }
  }

  const haze = ctx.createLinearGradient(0, skyH - 10, 0, skyH);
  haze.addColorStop(0, 'rgba(84,94,110,0)');
  haze.addColorStop(1, 'rgba(84,94,110,0.7)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, skyH - 10, W, 10);
}

// ─── tree strip ──────────────────────────────────────────────────────────────
function drawTrees(ctx, W, skyH, treeH, scrollX, trees) {
  const y0 = skyH;
  const g  = ctx.createLinearGradient(0, y0, 0, y0 + treeH);
  g.addColorStop(0, '#252820'); g.addColorStop(1, '#1a1c16');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, treeH);

  const tile  = W * 2;
  const shift = (scrollX * 0.42) % tile;
  for (const t of trees) {
    const tx = ((t.x - shift) % tile + tile) % tile - 20;
    if (tx > W + 30 || tx < -30) continue;
    drawBirch(ctx, tx, y0 + treeH * 0.92, t.sc * treeH);
  }
}

function drawBirch(ctx, x, groundY, size) {
  const trunkH = size * 0.68, trunkW = Math.max(2, size * 0.07), fR = size * 0.30;
  ctx.fillStyle = '#cdc7b5';
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);
  ctx.fillStyle = '#111';
  for (let i = 0; i < 3; i++) ctx.fillRect(x - trunkW / 2, groundY - trunkH * (0.3 + i * 0.25), trunkW, 1);
  ctx.fillStyle = '#283322';
  ctx.beginPath();
  ctx.ellipse(x, groundY - trunkH - fR * 0.6, fR * 0.65, fR, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─── road ────────────────────────────────────────────────────────────────────
function drawRoad(ctx, W, H, N, roadY, laneH, scrollX, cracks, potholes) {
  ctx.fillStyle = '#1c1e22';
  ctx.fillRect(0, roadY, W, H - roadY);

  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, roadY + (H - roadY) * (i / 6), W, (H - roadY) / 12);

  ctx.strokeStyle = '#8a8070'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, roadY); ctx.lineTo(W, roadY); ctx.stroke();

  for (let i = 1; i < N; i++) {
    const lineY = roadY + i * laneH;
    ctx.strokeStyle = '#c09030'; ctx.lineWidth = 2;
    ctx.setLineDash([22, 18]); ctx.lineDashOffset = -(scrollX % 40);
    ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(W, lineY); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }

  const tileW = W * 3;
  ctx.strokeStyle = '#0e0f12'; ctx.lineWidth = 1;
  for (const c of cracks) {
    const cx = ((c.x - scrollX) % tileW + tileW) % tileW;
    if (cx > W + 40 || cx < -40) continue;
    const cy = roadY + c.lane * laneH + c.yFrac * laneH;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(c.angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(c.len, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.len * 0.45, 0); ctx.lineTo(c.len * 0.45 + 7, -5); ctx.stroke();
    ctx.restore();
  }

  for (const p of potholes) {
    const px = ((p.x - scrollX) % tileW + tileW) % tileW;
    if (px > W + 30 || px < -30) continue;
    const py = roadY + p.lane * laneH + p.yFrac * laneH;
    ctx.fillStyle = '#0a0b0e';
    ctx.beginPath(); ctx.ellipse(px, py, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1e2028'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(60,80,120,0.18)';
    ctx.beginPath(); ctx.ellipse(px - p.rx * 0.2, py - p.ry * 0.2, p.rx * 0.5, p.ry * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ─── finish line ─────────────────────────────────────────────────────────────
function drawFinishLine(ctx, H, roadY, x, glowing) {
  if (x > H * 2) return; // off screen — H used as rough sentinel
  const sq = 14;
  const cols = 2;
  ctx.save();
  if (glowing) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 20;
  }
  for (let row = 0; roadY + row * sq < H; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f4f0e8' : '#111';
      ctx.fillRect(x + col * sq, roadY + row * sq, sq, sq);
    }
  }
  // pole
  ctx.fillStyle = glowing ? '#ffd700' : '#888';
  ctx.shadowBlur = glowing ? 10 : 0;
  ctx.fillRect(x - 3, roadY, 3, H - roadY);
  ctx.restore();
}

// ─── progress HUD ────────────────────────────────────────────────────────────
function drawProgressHud(ctx, W, roadY, positions, N) {
  const barH = 5, barY = roadY - barH - 2;
  ctx.fillStyle = 'rgba(20,22,28,0.7)';
  ctx.fillRect(0, barY - 1, W, barH + 2);
  for (let i = 0; i < N; i++) {
    const pct = Math.min(1, positions[i] / TRACK_LENGTH);
    ctx.fillStyle = CAR_COLORS[i % CAR_COLORS.length];
    ctx.fillRect(0, barY + i * (barH / N), W * pct, barH / N);
  }
}

// ─── celebration burst ────────────────────────────────────────────────────────
function drawCelebration(ctx, cx, cy, CW, CH, celebFrame, particles) {
  ctx.save();
  // gold flash behind car — cy is wheel center, car top is cy - CH*0.78
  const carTopY = cy - CH * 0.78;
  const flashAlpha = celebFrame % 10 < 5 ? 0.28 : 0;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,215,40,${flashAlpha})`;
    ctx.fillRect(cx - CW / 2 - 8, carTopY - 6, CW + 16, CH + 12);
  }

  // particle burst
  for (const p of particles) {
    const t     = Math.min(1, celebFrame / 45);
    const dist  = p.speed * celebFrame * 2.2;
    const grav  = 0.18 * celebFrame * celebFrame;
    const px    = cx + Math.cos(p.angle) * dist;
    const py    = (carTopY + CH * 0.4) + Math.sin(p.angle) * dist + grav;
    const alpha = Math.max(0, 1 - t * 1.1);
    if (alpha <= 0) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = p.color;
    ctx.strokeStyle = p.color;
    ctx.translate(px, py);
    ctx.rotate(celebFrame * p.spin);
    if (p.rect) {
      ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
    } else {
      ctx.lineWidth = p.size * 0.5;
      ctx.beginPath(); ctx.moveTo(-p.size * 2, 0); ctx.lineTo(p.size * 2, 0); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ─── Lada 2107 silhouette ─────────────────────────────────────────────────────
// Single continuous polygon tracing the exact car profile.
// Normalized coords: (0,0) = top-left of bounding box, (1,1) = bottom-right.
// cx = horizontal centre, cy = wheel-centre y (= TOP + 0.78 * CH).
// x=0 is REAR, x=1 is FRONT (car faces right).
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L   = cx - CW / 2;         // left (rear) edge of bounding box
  const TOP = cy - CH * 0.78;      // top of bounding box

  // helpers: normalised → canvas
  const px = (nx) => L   + nx * CW;
  const py = (ny) => TOP + ny * CH;

  // wheel geometry
  const WR  = CH * 0.22;
  const rWX = px(0.18);   // rear wheel centre x
  const fWX = px(0.78);   // front wheel centre x
  const WY  = cy;         // wheel centre y

  ctx.save();

  // ── exhaust smoke (rear, near y=0.65) ────────────────────────────────────
  if (speed > 0.8) {
    const n        = hit ? 5 : Math.min(5, Math.ceil(speed / 1.6));
    const sizeMult = hit ? 1.6 : (1 + speed * 0.08);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hit
        ? `rgba(80,65,45,${0.58 - i * 0.10})`
        : `rgba(125,118,110,${0.35 - i * 0.06})`;
      ctx.beginPath();
      ctx.arc(px(0) - i * 16 - 12, py(0.65) - i * 3, (4 + i * 4.5) * sizeMult, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── speed lines (trailing off rear) ──────────────────────────────────────
  if (speed > 2.5 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const len = 18 + (4 - i) * 9 + speed * 2;
      const lny = py(0.34 + i * 0.07);
      ctx.beginPath();
      ctx.moveTo(px(0) - len - 8, lny);
      ctx.lineTo(px(0) - 8,       lny);
      ctx.stroke();
    }
  }

  // ── body polygon — single path tracing the Lada 2107 silhouette ──────────
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px(1.00), py(0.72)); // front bumper bottom
  ctx.lineTo(px(1.00), py(0.58)); // front bumper top
  ctx.lineTo(px(0.95), py(0.52)); // hood front
  ctx.lineTo(px(0.62), py(0.50)); // hood flat
  ctx.lineTo(px(0.60), py(0.50)); // windshield base (A-pillar foot)
  ctx.lineTo(px(0.52), py(0.22)); // windshield top / A-pillar top
  ctx.lineTo(px(0.25), py(0.20)); // roof
  ctx.lineTo(px(0.18), py(0.25)); // C-pillar top
  ctx.lineTo(px(0.12), py(0.50)); // rear window bottom / trunk rear
  ctx.lineTo(px(0.05), py(0.52)); // trunk top
  ctx.lineTo(px(0.00), py(0.58)); // rear bumper top
  ctx.lineTo(px(0.00), py(0.72)); // rear bumper bottom
  ctx.closePath();                 // bottom line → front bumper bottom
  ctx.fill();

  // thin dark outline to read against any road colour
  ctx.strokeStyle = shade(color, -0.38);
  ctx.lineWidth   = 1;
  ctx.stroke();

  // ── windows ──────────────────────────────────────────────────────────────
  const glassColor = 'rgba(18,35,65,0.90)';

  // windshield — strip between A-pillar foot (0.60,0.50) and top (0.52,0.22)
  ctx.fillStyle = glassColor;
  ctx.beginPath();
  ctx.moveTo(px(0.600), py(0.500));
  ctx.lineTo(px(0.525), py(0.225));
  ctx.lineTo(px(0.548), py(0.225));
  ctx.lineTo(px(0.620), py(0.500));
  ctx.closePath();
  ctx.fill();

  // rear window — between C-pillar (0.18,0.25)→(0.12,0.50) with thin pillars
  ctx.fillStyle = glassColor;
  ctx.beginPath();
  ctx.moveTo(px(0.188), py(0.258));
  ctx.lineTo(px(0.242), py(0.208));
  ctx.lineTo(px(0.272), py(0.208));
  ctx.lineTo(px(0.222), py(0.258));
  ctx.lineTo(px(0.130), py(0.492));
  ctx.lineTo(px(0.118), py(0.492));
  ctx.closePath();
  ctx.fill();

  // side windows — two door panes between C and A pillars
  // roof line interpolated between (0.25,0.20) and (0.52,0.22)
  const roofAtX = (nx) => 0.20 + (0.22 - 0.20) * Math.max(0, (nx - 0.25) / (0.52 - 0.25));
  const beltY   = 0.455;
  const winRear = 0.278; // just past C-pillar
  const winFrnt = 0.553; // just before A-pillar
  const bpX     = winRear + (winFrnt - winRear) * 0.50; // B-pillar

  ctx.fillStyle = glassColor;
  // rear door
  ctx.fillRect(
    px(winRear + 0.008), py(roofAtX(winRear) + 0.015),
    px(bpX - 0.010) - px(winRear + 0.008),
    py(beltY) - py(roofAtX(winRear) + 0.015)
  );
  // front door
  ctx.fillRect(
    px(bpX + 0.010), py(roofAtX(bpX) + 0.008),
    px(winFrnt - 0.008) - px(bpX + 0.010),
    py(beltY) - py(roofAtX(bpX) + 0.008)
  );

  // B-pillar
  ctx.fillStyle = shade(color, -0.30);
  ctx.fillRect(
    px(bpX - 0.012), py(roofAtX(bpX) + 0.008),
    px(bpX + 0.012) - px(bpX - 0.012),
    py(beltY) - py(roofAtX(bpX) + 0.008)
  );

  // window glint
  ctx.strokeStyle = 'rgba(215,235,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(winRear + 0.015), py(roofAtX(winRear) + 0.035));
  ctx.lineTo(px(bpX - 0.018),    py(roofAtX(bpX - 0.018) + 0.035));
  ctx.stroke();

  // chrome beltline strip
  ctx.strokeStyle = 'rgba(195,188,168,0.50)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(0.06), py(beltY));
  ctx.lineTo(px(0.62), py(beltY));
  ctx.stroke();

  // ── taillights (rear, x≈0–0.05, y≈0.55–0.70) ────────────────────────────
  ctx.fillStyle = hit ? '#ff4422' : '#cc1100';
  ctx.fillRect(px(0.010), py(0.55), px(0.050) - px(0.010), py(0.70) - py(0.55));
  ctx.fillStyle = hit ? '#ff9977' : '#ff2200';
  ctx.fillRect(px(0.014), py(0.56), px(0.042) - px(0.014), py(0.62) - py(0.56));
  // amber
  ctx.fillStyle = '#aa5500';
  ctx.fillRect(px(0.010), py(0.70), px(0.050) - px(0.010), py(0.73) - py(0.70));

  // ── grille (front face, x≈0.965–1.0, y≈0.55–0.70) ───────────────────────
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(px(0.965), py(0.55), px(1.00) - px(0.965), py(0.70) - py(0.55));
  ctx.strokeStyle = '#353d4a'; ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const gy = py(0.55) + (py(0.70) - py(0.55)) * (i / 4);
    ctx.beginPath(); ctx.moveTo(px(0.965), gy); ctx.lineTo(px(1.00), gy); ctx.stroke();
  }

  // ── TON diamond headlight (front, near y=0.52) ────────────────────────────
  const hlCX = px(0.975);
  const hlCY = py(0.525);
  const dlW  = CW * 0.036;
  const dlH  = CH * 0.062;
  ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 18;
  ctx.fillStyle   = '#70d8ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,       hlCY - dlH);
  ctx.lineTo(hlCX + dlW, hlCY);
  ctx.lineTo(hlCX,       hlCY + dlH);
  ctx.lineTo(hlCX - dlW, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 6; ctx.fillStyle = '#d8f4ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,             hlCY - dlH * 0.5);
  ctx.lineTo(hlCX + dlW * 0.5, hlCY);
  ctx.lineTo(hlCX,             hlCY + dlH * 0.5);
  ctx.lineTo(hlCX - dlW * 0.5, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // ── wheel arches — dark semicircle punched into body ─────────────────────
  ctx.fillStyle = shade(color, -0.28);
  ctx.beginPath(); ctx.arc(rWX, WY, WR + 3, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(fWX, WY, WR + 3, Math.PI, 0); ctx.fill();

  // ── wheels ────────────────────────────────────────────────────────────────
  drawWheel(ctx, rWX, WY, WR);
  drawWheel(ctx, fWX, WY, WR);

  // ── pothole splash ────────────────────────────────────────────────────────
  if (hit) {
    ctx.fillStyle = 'rgba(55,45,35,0.72)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - 0.2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * WR * 1.8, WY - WR + Math.sin(ang) * WR * 1.2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── winner flash ──────────────────────────────────────────────────────────
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.28)';
    ctx.fillRect(L - 6, TOP - 6, CW + 12, CH * 0.90 + 12);
  }

  ctx.restore();
}

function drawWheel(ctx, cx, cy, r) {
  ctx.fillStyle = '#111116';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#555550'; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#888882';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6a6a65'; ctx.lineWidth = 1;
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
