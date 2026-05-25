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
 *
 * View modes (toggled live via getViewMode callback):
 *   'side'  — classic side-scrolling view (default)
 *   'front' — head-on perspective view, Lada front face, road converging
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME = 3;    // physics steps per render frame
const SCROLL_SCALE   = 1.25; // road-px per physics speed unit
const LEAD_X_FRAC    = 0.30; // leader fixed screen-x (fraction of W)
const SPREAD_SCALE   = 1.1;  // how far back a trailing car appears
const FINISH_X_FRAC  = 0.72; // finish line position on screen

const END_DRIVE     = 55;
const END_CELEBRATE = 50;
const END_HOLD      = 20;
const END_TOTAL     = END_DRIVE + END_CELEBRATE + END_HOLD;

const CAR_COLORS = [
  '#e8e0d0', // off-white
  '#c8472b', // Soviet red
  '#1a1a1a', // black
  '#2d5a2d', // dark green
  '#1a2855', // navy
];

// ─── entry point ─────────────────────────────────────────────────────────────
export function runReplay(canvas, hexSeed, { onComplete, onTick, getViewMode = () => 'side' } = {}) {
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
  const CAR_H  = CAR_W * 0.42;  // bounding box height; wheel centre at 78% from top

  const FINISH_X = W * FINISH_X_FRAC;
  const scenery  = buildScenery(rng, W);

  const CONFETTI_N = 30;
  const confetti = Array.from({ length: CONFETTI_N }, (_, i) => ({
    angle: (i / CONFETTI_N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4,
    speed: 2.0 + Math.random() * 3.8,
    color: ['#ffd700','#ff8800','#ff4455','#44ff88','#66bbff','#ffffff',
            '#ffee00','#ff66cc'][Math.floor(Math.random() * 8)],
    size:  2 + Math.random() * 3,
    spin:  (Math.random() - 0.5) * 0.35,
    rect:  Math.random() < 0.55,
  }));

  let physTick   = 0;
  let frameCount = 0;
  let scrollX    = 0;
  let endFrame   = -1;
  let cancelled  = false;
  let rafId      = null;

  const endStartX = new Array(N).fill(0);

  function loop() {
    if (cancelled) return;
    frameCount++;

    // ── physics ───────────────────────────────────────────────────────────
    if (endFrame < 0) {
      if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
        physTick++;
        onTick?.(physTick, sim);
      }
      if (physTick >= sim.history.length - 1) {
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

    const state     = sim.history[physTick];
    const lastState = sim.history[sim.history.length - 1];
    const winnerSpd = Math.max(...lastState.speeds, 1);

    // ── road scroll ───────────────────────────────────────────────────────
    if (endFrame < 0) {
      scrollX += Math.max(...state.speeds, 1) * SCROLL_SCALE;
    } else if (endFrame < END_DRIVE) {
      scrollX += winnerSpd * SCROLL_SCALE * (1 - easeOutCubic(endFrame / END_DRIVE) * 0.6);
    }

    // ── car screen-x (side view) ──────────────────────────────────────────
    const carX = new Array(N);
    if (endFrame < 0) {
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
          carX[i] = endStartX[i] + eased * (FINISH_X + CAR_W * 0.55 - endStartX[i]);
        } else {
          const loserT = Math.min(1, endFrame / (END_DRIVE * 0.7));
          carX[i] = endStartX[i] - easeOutCubic(loserT) * W * 0.08;
        }
      }
    }

    // ── finish line x ─────────────────────────────────────────────────────
    let finishLineX;
    const physPct = physTick / sim.history.length;
    if (endFrame >= 0) {
      finishLineX = FINISH_X;
    } else if (physPct >= 0.82) {
      const slideT = (physPct - 0.82) / 0.18;
      finishLineX = W + 60 - easeOutCubic(slideT) * (W + 60 - FINISH_X);
    } else {
      finishLineX = W + 60;
    }

    // ── celebration ───────────────────────────────────────────────────────
    const celebFrame = (endFrame >= END_DRIVE) ? (endFrame - END_DRIVE) : -1;
    const flashOn    = celebFrame >= 0 && celebFrame < END_CELEBRATE && celebFrame % 10 < 5;

    // ── draw ─────────────────────────────────────────────────────────────
    const vMode = getViewMode();
    if (vMode === 'front') {
      drawFrameFront(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                     sim, state, scenery, scrollX, physTick, endFrame,
                     sim.winner, flashOn, celebFrame, confetti);
    } else {
      drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                sim, state, scenery, scrollX, physTick, endFrame,
                carX, finishLineX, sim.winner, flashOn, celebFrame, confetti);
    }

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

// ─── scenery ─────────────────────────────────────────────────────────────────
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

// ─── SIDE VIEW frame ─────────────────────────────────────────────────────────
function drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                   sim, state, scenery, scrollX, physTick, endFrame,
                   carX, finishLineX, winnerIdx, flashOn, celebFrame, confetti) {
  ctx.clearRect(0, 0, W, H);

  drawSky(ctx, W, SKY_H, scrollX, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, scrollX, scenery.trees);
  drawRoad(ctx, W, H, N, ROAD_Y, LANE_H, scrollX, scenery.cracks, scenery.potholes);
  drawProgressHud(ctx, W, ROAD_Y, state.positions, N);
  drawFinishLine(ctx, H, ROAD_Y, finishLineX, celebFrame >= 0);

  for (let i = N - 1; i >= 0; i--) {
    const baseY  = ROAD_Y + (i + 0.54) * LANE_H;
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

  if (celebFrame >= 0 && celebFrame < 50) {
    const winY = ROAD_Y + (winnerIdx + 0.54) * LANE_H;
    drawCelebration(ctx, carX[winnerIdx], winY, CAR_W, CAR_H, celebFrame, confetti);
  }
}

// ─── FRONT VIEW frame ────────────────────────────────────────────────────────
function drawFrameFront(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                        sim, state, scenery, scrollX, physTick, endFrame,
                        winnerIdx, flashOn, celebFrame, confetti) {
  ctx.clearRect(0, 0, W, H);

  // Sky + trees — slow parallax in front view
  drawSky(ctx, W, SKY_H, scrollX * 0.25, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, scrollX * 0.25, scenery.trees);

  // Perspective road
  drawRoadFront(ctx, W, H, N, ROAD_Y);

  // Progress HUD
  drawProgressHud(ctx, W, ROAD_Y, state.positions, N);

  // Cars — evenly spaced in lanes, front-on view
  const laneW  = W / N;
  const frontW = Math.min(laneW * 0.96, 210);
  const frontH = frontW * 0.40;
  const carBY  = H - H * 0.04;

  for (let i = N - 1; i >= 0; i--) {
    // slight horizontal wobble while racing
    const wobble = endFrame < 0
      ? Math.sin(physTick * 0.4 + i * 1.5) * Math.max(0, state.speeds[i] - 1.5) * 0.4
      : 0;
    const carCX  = laneW * (i + 0.5) + wobble;
    const stopped = celebFrame >= 0 && i !== winnerIdx;
    drawLadaFront(
      ctx, carCX, carBY, frontW, frontH,
      CAR_COLORS[i % CAR_COLORS.length],
      stopped ? 0 : state.speeds[i],
      state.hits[i],
      i === winnerIdx && flashOn,
    );
  }

  if (celebFrame >= 0 && celebFrame < 50) {
    const winCX = laneW * (winnerIdx + 0.5);
    drawCelebration(ctx, winCX, carBY, frontW, frontH, celebFrame, confetti);
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

// ─── side-view road ───────────────────────────────────────────────────────────
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

// ─── front-view perspective road ─────────────────────────────────────────────
function drawRoadFront(ctx, W, H, N, roadY) {
  const vpX = W / 2;
  const vpY = roadY + (H - roadY) * 0.06; // vanishing point

  // Road surface — perspective trapezoid with gradient
  const grad = ctx.createLinearGradient(0, vpY, 0, H);
  grad.addColorStop(0, '#28292e');
  grad.addColorStop(0.5, '#1f2126');
  grad.addColorStop(1, '#1c1e22');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(vpX, vpY);
  ctx.lineTo(W * 1.6, H);
  ctx.lineTo(-W * 0.6, H);
  ctx.closePath();
  ctx.fill();

  // Subtle road surface bands (perspective-scaled)
  for (let i = 0; i < 5; i++) {
    const t  = (i + 1) / 6;
    const bY = vpY + (H - vpY) * t;
    const bW = (W * 1.6 + W * 0.6) * t;
    ctx.fillStyle = `rgba(255,255,255,${0.008 + i * 0.003})`;
    ctx.fillRect(vpX - bW / 2, bY, bW, (H - vpY) / 12);
  }

  // Lane dividers converging to vanishing point
  for (let i = 0; i <= N; i++) {
    const xFrac = i / N;
    const bx    = W * xFrac;
    const isBorder = i === 0 || i === N;
    ctx.strokeStyle = isBorder ? '#8a8070' : '#c09030';
    ctx.lineWidth   = isBorder ? 2.5 : 1.5;
    ctx.setLineDash(isBorder ? [] : [18, 14]);
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(bx, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Horizon haze
  const haze = ctx.createLinearGradient(0, vpY - 4, 0, vpY + 14);
  haze.addColorStop(0, 'rgba(84,94,110,0)');
  haze.addColorStop(1, 'rgba(84,94,110,0.55)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, vpY - 4, W, 18);
}

// ─── finish line ─────────────────────────────────────────────────────────────
function drawFinishLine(ctx, H, roadY, x, glowing) {
  if (x > H * 2) return;
  const sq = 14, cols = 2;
  ctx.save();
  if (glowing) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20; }
  for (let row = 0; roadY + row * sq < H; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f4f0e8' : '#111';
      ctx.fillRect(x + col * sq, roadY + row * sq, sq, sq);
    }
  }
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
// cy = wheel centre (side view) OR car bottom (front view).
// carTopY is derived consistently from cy and CH in both cases.
function drawCelebration(ctx, cx, cy, CW, CH, celebFrame, particles) {
  ctx.save();
  const carTopY    = cy - CH * 0.78;
  const flashAlpha = celebFrame % 10 < 5 ? 0.28 : 0;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,215,40,${flashAlpha})`;
    ctx.fillRect(cx - CW / 2 - 8, carTopY - 6, CW + 16, CH + 12);
  }

  for (const p of particles) {
    const t     = Math.min(1, celebFrame / 45);
    const dist  = p.speed * celebFrame * 2.2;
    const grav  = 0.18 * celebFrame * celebFrame;
    const px    = cx + Math.cos(p.angle) * dist;
    const py    = (carTopY + CH * 0.38) + Math.sin(p.angle) * dist + grav;
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

// ─── SIDE VIEW — Lada 2107 silhouette ────────────────────────────────────────
// Single continuous polygon tracing the real profile.
// Normalized coords: (0,0) = top-left bounding box, (1,1) = bottom-right.
// cx = horizontal centre; cy = wheel-centre y = TOP + 0.78 * CH.
// x=0 is REAR, x=1 is FRONT (car faces right).
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L   = cx - CW / 2;
  const TOP = cy - CH * 0.78;

  const px = (nx) => L   + nx * CW;
  const py = (ny) => TOP + ny * CH;

  const WR  = CH * 0.22;
  const rWX = px(0.18);
  const fWX = px(0.78);
  const WY  = cy;

  ctx.save();

  // ── exhaust smoke ─────────────────────────────────────────────────────────
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

  // ── speed lines ──────────────────────────────────────────────────────────
  if (speed > 2.5 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const len = 18 + (4 - i) * 9 + speed * 2;
      const lny = py(0.34 + i * 0.07);
      ctx.beginPath();
      ctx.moveTo(px(0) - len - 8, lny);
      ctx.lineTo(px(0) - 8, lny);
      ctx.stroke();
    }
  }

  // ── body polygon — Lada 2107 profile ─────────────────────────────────────
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
  ctx.closePath();                 // bottom → front bumper bottom
  ctx.fill();

  // ── windows ──────────────────────────────────────────────────────────────
  const glassColor = 'rgba(18,35,65,0.90)';

  // windshield — angled strip at A-pillar
  ctx.fillStyle = glassColor;
  ctx.beginPath();
  ctx.moveTo(px(0.600), py(0.500));
  ctx.lineTo(px(0.525), py(0.225));
  ctx.lineTo(px(0.548), py(0.225));
  ctx.lineTo(px(0.620), py(0.500));
  ctx.closePath();
  ctx.fill();

  // rear window — C-pillar strip
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
  const roofAtX = (nx) => 0.20 + (0.22 - 0.20) * Math.max(0, (nx - 0.25) / (0.52 - 0.25));
  const beltY   = 0.455;
  const winRear = 0.278;
  const winFrnt = 0.553;
  const bpX     = winRear + (winFrnt - winRear) * 0.50;

  ctx.fillStyle = glassColor;
  ctx.fillRect(
    px(winRear + 0.008), py(roofAtX(winRear) + 0.015),
    px(bpX - 0.010) - px(winRear + 0.008),
    py(beltY) - py(roofAtX(winRear) + 0.015)
  );
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

  // glint
  ctx.strokeStyle = 'rgba(215,235,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(winRear + 0.015), py(roofAtX(winRear) + 0.035));
  ctx.lineTo(px(bpX - 0.018),    py(roofAtX(bpX - 0.018) + 0.035));
  ctx.stroke();

  // chrome beltline
  ctx.strokeStyle = 'rgba(195,188,168,0.50)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(0.06), py(beltY));
  ctx.lineTo(px(0.62), py(beltY));
  ctx.stroke();

  // ── taillights — brighter red with glow ──────────────────────────────────
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = hit ? 12 : 8;
  ctx.fillStyle = hit ? '#ff5533' : '#ff1800';
  ctx.fillRect(px(0.010), py(0.55), px(0.050) - px(0.010), py(0.70) - py(0.55));
  ctx.shadowBlur = hit ? 6 : 4;
  ctx.fillStyle = hit ? '#ffaa88' : '#ff4400';
  ctx.fillRect(px(0.014), py(0.56), px(0.042) - px(0.014), py(0.62) - py(0.56));
  ctx.shadowBlur = 0;
  // amber indicator
  ctx.fillStyle = '#aa5500';
  ctx.fillRect(px(0.010), py(0.70), px(0.050) - px(0.010), py(0.73) - py(0.70));

  // ── grille ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(px(0.965), py(0.55), px(1.00) - px(0.965), py(0.70) - py(0.55));
  ctx.strokeStyle = '#353d4a'; ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const gy = py(0.55) + (py(0.70) - py(0.55)) * (i / 4);
    ctx.beginPath(); ctx.moveTo(px(0.965), gy); ctx.lineTo(px(1.00), gy); ctx.stroke();
  }

  // ── TON diamond headlight — larger, brighter ──────────────────────────────
  const hlCX = px(0.975);
  const hlCY = py(0.525);
  const dlW  = CW * 0.055;   // wider than before
  const dlH  = CH * 0.092;   // taller than before
  ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 28;
  ctx.fillStyle   = '#70d8ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,       hlCY - dlH);
  ctx.lineTo(hlCX + dlW, hlCY);
  ctx.lineTo(hlCX,       hlCY + dlH);
  ctx.lineTo(hlCX - dlW, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 10;
  ctx.fillStyle  = '#d8f4ff';
  ctx.beginPath();
  ctx.moveTo(hlCX,             hlCY - dlH * 0.5);
  ctx.lineTo(hlCX + dlW * 0.5, hlCY);
  ctx.lineTo(hlCX,             hlCY + dlH * 0.5);
  ctx.lineTo(hlCX - dlW * 0.5, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // ── wheel arches ──────────────────────────────────────────────────────────
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

// ─── FRONT VIEW — Lada 2107 head-on ──────────────────────────────────────────
// cx = horizontal centre, cy = bottom of car (ground level).
// CW = car width, CH = car height in this projection.
function drawLadaFront(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L = cx - CW / 2;
  const T = cy - CH;

  const px = (nx) => L + nx * CW;
  const py = (ny) => T + ny * CH;

  ctx.save();

  // ── body proportions ──────────────────────────────────────────────────────
  const bumperT  = 0.86; // top of bumper zone (bottom 14% = bumper)
  const hoodT    = 0.36; // where cabin meets hood (top 36% = cabin)
  const cabInset = 0.08; // cabin narrower than body on each side

  // ── cabin (top section) ───────────────────────────────────────────────────
  ctx.fillStyle = color;
  ctx.fillRect(px(cabInset), py(0), CW * (1 - 2 * cabInset), py(hoodT) - py(0));

  // ── main body / hood area ─────────────────────────────────────────────────
  ctx.fillStyle = color;
  ctx.fillRect(px(0), py(hoodT), CW, py(bumperT) - py(hoodT));

  // slight body outline
  ctx.strokeStyle = shade(color, -0.35); ctx.lineWidth = 1;
  ctx.strokeRect(px(0), py(hoodT), CW, py(bumperT) - py(hoodT));
  ctx.strokeRect(px(cabInset), py(0), CW * (1 - 2 * cabInset), py(hoodT) - py(0));

  // ── bumper ────────────────────────────────────────────────────────────────
  ctx.fillStyle = shade(color, -0.32);
  ctx.fillRect(px(0), py(bumperT), CW, py(1.0) - py(bumperT));
  // chrome strip
  const bmpH = py(1.0) - py(bumperT);
  ctx.fillStyle = 'rgba(200,192,178,0.65)';
  ctx.fillRect(px(0), py(bumperT) + bmpH * 0.32, CW, bmpH * 0.22);
  // spoiler lip
  ctx.fillStyle = '#181818';
  ctx.fillRect(px(0.04), py(1.0) - 2, CW * 0.92, 3);

  // ── front wheels (partially visible at lower corners) ─────────────────────
  const wheelR = CH * 0.12;
  ctx.fillStyle = '#111116';
  ctx.beginPath(); ctx.arc(px(0.09), py(1.0), wheelR, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(px(0.91), py(1.0), wheelR, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#555550'; ctx.lineWidth = wheelR * 0.25;
  ctx.beginPath(); ctx.arc(px(0.09), py(1.0), wheelR * 0.62, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(px(0.91), py(1.0), wheelR * 0.62, Math.PI, 0); ctx.stroke();

  // ── headlight housings ────────────────────────────────────────────────────
  const hlYt = 0.40, hlYb = 0.82;
  const lHX0 = 0.03, lHX1 = 0.25;
  const rHX0 = 0.75, rHX1 = 0.97;
  const hlH  = py(hlYb) - py(hlYt);
  const lHW  = px(lHX1) - px(lHX0);
  const rHW  = px(rHX1) - px(rHX0);

  ctx.fillStyle = '#14141c';
  ctx.fillRect(px(lHX0), py(hlYt), lHW, hlH);
  ctx.fillRect(px(rHX0), py(hlYt), rHW, hlH);

  // ── grille ────────────────────────────────────────────────────────────────
  const gX0 = 0.27, gX1 = 0.73, gY0 = 0.42, gY1 = 0.84;
  const gH  = py(gY1) - py(gY0);
  const gW  = px(gX1) - px(gX0);
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(px(gX0), py(gY0), gW, gH);
  ctx.strokeStyle = '#353d4a'; ctx.lineWidth = 1.5;
  for (let i = 1; i < 5; i++) {
    const gy = py(gY0) + gH * (i / 5);
    ctx.beginPath(); ctx.moveTo(px(gX0), gy); ctx.lineTo(px(gX1), gy); ctx.stroke();
  }
  // vertical center divide
  ctx.beginPath(); ctx.moveTo(cx, py(gY0)); ctx.lineTo(cx, py(gY1)); ctx.stroke();

  // ── TON diamond headlights (one per housing) ──────────────────────────────
  const drawDiamond = (dcx, dcy, dW, dH) => {
    ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 26;
    ctx.fillStyle   = '#70d8ff';
    ctx.beginPath();
    ctx.moveTo(dcx,      dcy - dH);
    ctx.lineTo(dcx + dW, dcy);
    ctx.lineTo(dcx,      dcy + dH);
    ctx.lineTo(dcx - dW, dcy);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 9; ctx.fillStyle = '#d8f4ff';
    ctx.beginPath();
    ctx.moveTo(dcx,          dcy - dH * 0.5);
    ctx.lineTo(dcx + dW * 0.5, dcy);
    ctx.lineTo(dcx,          dcy + dH * 0.5);
    ctx.lineTo(dcx - dW * 0.5, dcy);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  };

  const dW = lHW * 0.50, dH = hlH * 0.44;
  drawDiamond(px(lHX0) + lHW / 2, py(hlYt) + hlH / 2, dW, dH);
  drawDiamond(px(rHX0) + rHW / 2, py(hlYt) + hlH / 2, dW, dH);

  // ── windshield ────────────────────────────────────────────────────────────
  const wsX0 = cabInset + 0.06;
  const wsX1 = 1 - cabInset - 0.06;
  ctx.fillStyle = 'rgba(18,35,65,0.90)';
  ctx.fillRect(px(wsX0), py(0.05), px(wsX1) - px(wsX0), py(hoodT - 0.05) - py(0.05));
  // glint
  ctx.strokeStyle = 'rgba(215,235,255,0.18)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(wsX0 + 0.04), py(0.09));
  ctx.lineTo(px(wsX1 - 0.04), py(0.09));
  ctx.stroke();

  // ── winner flash ──────────────────────────────────────────────────────────
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.28)';
    ctx.fillRect(L - 6, T - 6, CW + 12, CH + 12);
  }

  ctx.restore();
}

// ─── wheel ───────────────────────────────────────────────────────────────────
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
