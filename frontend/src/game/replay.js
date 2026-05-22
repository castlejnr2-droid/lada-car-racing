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
const SCROLL_SCALE   = 0.5;  // road-px per physics speed unit
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
  const CAR_W  = Math.min(LANE_H * 2.0, 120);
  const CAR_H  = CAR_W * 0.44;

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
              sim, state, scenery, scrollX, physTick,
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
                   sim, state, scenery, scrollX, physTick,
                   carX, finishLineX, winnerIdx, flashOn, celebFrame, confetti) {
  ctx.clearRect(0, 0, W, H);

  drawSky(ctx, W, SKY_H, scrollX, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, scrollX, scenery.trees);
  drawRoad(ctx, W, H, N, ROAD_Y, LANE_H, scrollX, scenery.cracks, scenery.potholes);
  drawProgressHud(ctx, W, ROAD_Y, state.positions, N);
  drawFinishLine(ctx, H, ROAD_Y, finishLineX, celebFrame >= 0);

  // draw cars back-to-front (higher index = behind)
  for (let i = N - 1; i >= 0; i--) {
    const carY = ROAD_Y + (i + 0.54) * LANE_H;
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
  // gold flash behind car
  const flashAlpha = celebFrame % 10 < 5 ? 0.28 : 0;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,215,40,${flashAlpha})`;
    ctx.fillRect(cx - CW / 2 - 8, cy - CH - 8, CW + 16, CH + 16);
  }

  // particle burst
  for (const p of particles) {
    const t     = Math.min(1, celebFrame / 45);
    const dist  = p.speed * celebFrame * 2.2;
    const grav  = 0.18 * celebFrame * celebFrame;
    const px    = cx + Math.cos(p.angle) * dist;
    const py    = cy - CH * 0.5 + Math.sin(p.angle) * dist + grav;
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

// ─── Lada 2107 ───────────────────────────────────────────────────────────────
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L  = cx - CW / 2;
  const WR = CH * 0.235;
  const WY = cy;

  ctx.save();

  // exhaust
  if (speed > 1.5) {
    const numPuffs = hit ? 4 : Math.min(3, Math.ceil(speed / 2.5));
    for (let i = 0; i < numPuffs; i++) {
      const r  = (3 + i * 3) * (hit ? 1.4 : 1);
      const ox = -(i * 14 + 8);
      const oy = -CH * 0.18 - i * 3;
      ctx.fillStyle = hit ? `rgba(80,65,45,${0.55 - i * 0.12})` : `rgba(130,125,118,${0.30 - i * 0.07})`;
      ctx.beginPath(); ctx.arc(L + ox, cy + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // speed lines
  if (speed > 4 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const ly = cy - CH * (0.28 + i * 0.16);
      const len = 14 + (3 - i) * 7;
      ctx.beginPath(); ctx.moveTo(L - len - 4, ly); ctx.lineTo(L - 4, ly); ctx.stroke();
    }
  }

  // lower body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L + 6,         WY - WR * 0.3);
  ctx.lineTo(L + 6,         cy - CH * 0.46);
  ctx.lineTo(L + CW * 0.15, cy - CH * 0.52);
  ctx.lineTo(L + CW * 0.74, cy - CH * 0.50);
  ctx.lineTo(L + CW * 0.86, cy - CH * 0.42);
  ctx.lineTo(L + CW - 6,    WY - WR * 0.3);
  ctx.closePath(); ctx.fill();

  // cabin
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.15, cy - CH * 0.52);
  ctx.lineTo(L + CW * 0.20, cy - CH);
  ctx.lineTo(L + CW * 0.72, cy - CH);
  ctx.lineTo(L + CW * 0.78, cy - CH * 0.52);
  ctx.lineTo(L + CW * 0.74, cy - CH * 0.50);
  ctx.lineTo(L + CW * 0.15, cy - CH * 0.52);
  ctx.closePath(); ctx.fill();

  // roof shade
  ctx.fillStyle = shade(color, -0.18);
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.21, cy - CH);
  ctx.lineTo(L + CW * 0.22, cy - CH + 4);
  ctx.lineTo(L + CW * 0.70, cy - CH + 4);
  ctx.lineTo(L + CW * 0.71, cy - CH);
  ctx.closePath(); ctx.fill();

  // windows
  ctx.fillStyle = 'rgba(25,45,75,0.90)';
  // rear window
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.16, cy - CH * 0.51); ctx.lineTo(L + CW * 0.21, cy - CH + 5);
  ctx.lineTo(L + CW * 0.34, cy - CH + 5);    ctx.lineTo(L + CW * 0.34, cy - CH * 0.52);
  ctx.closePath(); ctx.fill();
  // main side window
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.36, cy - CH * 0.51); ctx.lineTo(L + CW * 0.36, cy - CH + 5);
  ctx.lineTo(L + CW * 0.70, cy - CH + 5);    ctx.lineTo(L + CW * 0.73, cy - CH * 0.51);
  ctx.closePath(); ctx.fill();
  // windshield
  ctx.beginPath();
  ctx.moveTo(L + CW * 0.75, cy - CH * 0.51); ctx.lineTo(L + CW * 0.72, cy - CH + 5);
  ctx.lineTo(L + CW * 0.77, cy - CH + 5);    ctx.lineTo(L + CW * 0.79, cy - CH * 0.51);
  ctx.closePath(); ctx.fill();
  // glint
  ctx.strokeStyle = 'rgba(200,220,255,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L + CW * 0.37, cy - CH + 6); ctx.lineTo(L + CW * 0.50, cy - CH + 6); ctx.stroke();

  // chrome trim
  ctx.strokeStyle = 'rgba(195,185,165,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L + CW * 0.14, cy - CH * 0.60); ctx.lineTo(L + CW * 0.75, cy - CH * 0.58); ctx.stroke();

  // wheel arches
  const rWX = L + CW * 0.22, fWX = L + CW * 0.75;
  ctx.fillStyle = shade(color, -0.28);
  for (const wx of [rWX, fWX]) { ctx.beginPath(); ctx.arc(wx, WY, WR + 3, Math.PI, 0); ctx.fill(); }

  // bumpers
  ctx.fillStyle = shade(color, -0.32);
  ctx.fillRect(L,          cy - CH * 0.22, 6, CH * 0.18);
  ctx.fillRect(L + CW - 6, cy - CH * 0.22, 6, CH * 0.18);

  // taillights
  ctx.fillStyle = hit ? '#ff3300' : '#aa2200';
  ctx.fillRect(L + 6, cy - CH * 0.38, 5, CH * 0.13);

  // TON-diamond headlight
  const hlCX = L + CW - 3, hlCY = cy - CH * 0.32;
  const dlW  = CH * 0.17,  dlH  = CH * 0.13;
  ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 16;
  ctx.fillStyle   = '#70d8ff';
  ctx.beginPath();
  ctx.moveTo(hlCX, hlCY - dlH); ctx.lineTo(hlCX + dlW, hlCY);
  ctx.lineTo(hlCX, hlCY + dlH); ctx.lineTo(hlCX - dlW, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 6; ctx.fillStyle = '#d8f4ff';
  ctx.beginPath();
  ctx.moveTo(hlCX, hlCY - dlH * 0.5); ctx.lineTo(hlCX + dlW * 0.5, hlCY);
  ctx.lineTo(hlCX, hlCY + dlH * 0.5); ctx.lineTo(hlCX - dlW * 0.5, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // wheels
  drawWheel(ctx, rWX, WY, WR);
  drawWheel(ctx, fWX, WY, WR);

  // pothole splash
  if (hit) {
    ctx.fillStyle = 'rgba(55,45,35,0.72)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - 0.2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * WR * 1.8, WY - WR + Math.sin(ang) * WR * 1.2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // winner flash
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.28)';
    ctx.fillRect(L - 6, cy - CH - 6, CW + 12, CH + 12);
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
