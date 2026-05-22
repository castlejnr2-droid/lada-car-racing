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
// Boxy Soviet sedan side profile. Front = RIGHT, rear = LEFT.
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  const L  = cx - CW / 2;   // rear (left) edge
  const WR = CH * 0.235;    // wheel radius
  const WY = cy;             // wheel centre Y

  // ── vertical levels ──────────────────────────────────────────────────────
  const bodyBotY   = WY - WR * 0.22;        // bottom of side panels / sill
  const deckY      = WY - CH * 0.47;        // hood and trunk deck height
  const roofY      = WY - CH * 0.98;        // roof top
  const bumperBotY = bodyBotY + CH * 0.075; // bottom of bumpers

  // ── horizontal landmarks ─────────────────────────────────────────────────
  const xR0  = L;                  // rear bumper outer face
  const xR1  = L + CW * 0.036;    // rear bumper inner / body rear face
  const xCP  = L + CW * 0.255;    // C-pillar base  (trunk/cabin junction at deck)
  const xCPt = L + CW * 0.272;    // C-pillar top   (trunk/cabin junction at roof)
  const xAP  = L + CW * 0.738;    // A-pillar base  (cabin/hood junction at deck)
  const xAPt = L + CW * 0.712;    // A-pillar top   (cabin/hood junction at roof)
  const xF0  = L + CW * 0.964;    // front face / grille start
  const xF1  = L + CW;            // front bumper tip

  // wheel centres
  const rWX = L + CW * 0.215;
  const fWX = L + CW * 0.792;

  ctx.save();

  // ── exhaust smoke (rear) ─────────────────────────────────────────────────
  if (speed > 1.5) {
    const n = hit ? 4 : Math.min(3, Math.ceil(speed / 2.5));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hit
        ? `rgba(80,65,45,${0.55 - i * 0.12})`
        : `rgba(130,125,118,${0.30 - i * 0.07})`;
      ctx.beginPath();
      ctx.arc(xR0 - i * 14 - 10, bodyBotY - i * 3, (3 + i * 3) * (hit ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── speed lines ──────────────────────────────────────────────────────────
  if (speed > 4 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const len = 14 + (3 - i) * 6;
      ctx.beginPath();
      ctx.moveTo(xR0 - len - 6, bodyBotY - i * CH * 0.09 - CH * 0.06);
      ctx.lineTo(xR0 - 6,       bodyBotY - i * CH * 0.09 - CH * 0.06);
      ctx.stroke();
    }
  }

  // ── main body silhouette (one boxy path) ─────────────────────────────────
  // Rear face and trunk top are vertical/flat; C-pillar nearly vertical;
  // roof flat; A-pillar slight lean; hood flat; front face vertical.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(xR1,  bodyBotY);   // rear bottom
  ctx.lineTo(xR1,  deckY);      // rear face — vertical
  ctx.lineTo(xCP,  deckY);      // trunk deck — flat
  ctx.lineTo(xCPt, roofY);      // C-pillar  — near-vertical
  ctx.lineTo(xAPt, roofY);      // roof      — flat
  ctx.lineTo(xAP,  deckY);      // A-pillar  — slight lean
  ctx.lineTo(xF0,  deckY);      // hood top  — flat
  ctx.lineTo(xF0,  bodyBotY);   // front face — vertical
  ctx.closePath();
  ctx.fill();

  // sill / rocker panel strip (thin darker band at bottom of doors)
  ctx.fillStyle = shade(color, -0.20);
  ctx.fillRect(xR1, bodyBotY - CH * 0.055, xF0 - xR1, CH * 0.055);

  // roof top shade
  ctx.fillStyle = shade(color, -0.22);
  ctx.fillRect(xCPt, roofY, xAPt - xCPt, 4);

  // belt-line crease
  const beltY = deckY + (bodyBotY - deckY) * 0.38;
  ctx.strokeStyle = 'rgba(195,188,168,0.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(xR1, beltY); ctx.lineTo(xF0, beltY); ctx.stroke();

  // ── windows ──────────────────────────────────────────────────────────────
  const winTop      = roofY + 5;
  const winBot      = deckY + 4;
  const glassColor  = 'rgba(18,35,65,0.92)';
  const windshieldW = CW * 0.058;   // horizontal depth of windshield glass

  // rear quarter window (small trapezoid near C-pillar)
  const rqEndX = xCP + (xAP - xCP) * 0.20;
  ctx.fillStyle = glassColor;
  ctx.beginPath();
  ctx.moveTo(xCP + 3,  winBot);
  ctx.lineTo(xCPt + 3, winTop);
  ctx.lineTo(rqEndX,   winTop);
  ctx.lineTo(rqEndX,   winBot);
  ctx.closePath(); ctx.fill();

  // two main door windows separated by B-pillar
  const wStart  = rqEndX + 3;
  const wEnd    = xAP - windshieldW - 3;
  const bPillar = wStart + (wEnd - wStart) * 0.50;
  ctx.fillStyle = glassColor;
  ctx.fillRect(wStart,     winTop, bPillar - wStart - 2, winBot - winTop);
  ctx.fillRect(bPillar + 2, winTop, wEnd - bPillar - 2,   winBot - winTop);

  // B-pillar strip
  ctx.fillStyle = shade(color, -0.26);
  ctx.fillRect(bPillar - 2, winTop - 1, 4, winBot - winTop + 1);

  // windshield — slanted trapezoid (Lada 2107 upright lean)
  ctx.fillStyle = glassColor;
  ctx.beginPath();
  ctx.moveTo(xAP - windshieldW, winBot);
  ctx.lineTo(xAPt - windshieldW, winTop);
  ctx.lineTo(xAPt, winTop);
  ctx.lineTo(xAP,  winBot);
  ctx.closePath(); ctx.fill();

  // window glint
  ctx.strokeStyle = 'rgba(215,235,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(wStart + 2, winTop + 3);
  ctx.lineTo(bPillar - 5, winTop + 3);
  ctx.stroke();

  // ── wheel arches ──────────────────────────────────────────────────────────
  ctx.fillStyle = shade(color, -0.30);
  ctx.beginPath(); ctx.arc(rWX, WY, WR + 4, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(fWX, WY, WR + 4, Math.PI, 0); ctx.fill();

  // ── rear bumper ───────────────────────────────────────────────────────────
  const bumpH = bumperBotY - bodyBotY;
  ctx.fillStyle = shade(color, -0.38);
  ctx.fillRect(xR0, bodyBotY, xR1 - xR0, bumpH);
  ctx.fillStyle = 'rgba(200,192,178,0.65)';  // chrome overrider strip
  ctx.fillRect(xR0, bodyBotY + bumpH * 0.35, xR1 - xR0, bumpH * 0.20);

  // ── taillights (red rectangles, rear face) ────────────────────────────────
  const tlTop = deckY + 4;
  const tlH   = (bodyBotY - deckY) * 0.50;
  ctx.fillStyle = hit ? '#ff4422' : '#cc1100';
  ctx.fillRect(xR1, tlTop, 7, tlH);
  ctx.fillStyle = hit ? '#ff9977' : '#ff2200';   // bright inner
  ctx.fillRect(xR1 + 1, tlTop + 2, 4, tlH * 0.36);
  ctx.fillStyle = '#aa5500';                       // amber indicator
  ctx.fillRect(xR1, tlTop + tlH + 2, 7, tlH * 0.28);

  // ── front bumper + spoiler lip ────────────────────────────────────────────
  ctx.fillStyle = shade(color, -0.38);
  ctx.fillRect(xF0, bodyBotY, xF1 - xF0, bumpH);
  ctx.fillStyle = 'rgba(200,192,178,0.65)';
  ctx.fillRect(xF0, bodyBotY + bumpH * 0.35, xF1 - xF0, bumpH * 0.20);
  ctx.fillStyle = '#181818';   // rubber spoiler lip
  ctx.fillRect(xF0 - CW * 0.010, bumperBotY - 2, CW * 0.048, 4);

  // ── grille (dark rectangle with horizontal slats) ─────────────────────────
  const gTop = deckY + (bodyBotY - deckY) * 0.07;
  const gH   = (bodyBotY - deckY) * 0.57;
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(xF0, gTop, xF1 - xF0, gH);
  ctx.strokeStyle = '#20242e'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gy = gTop + gH * (i / 5);
    ctx.beginPath(); ctx.moveTo(xF0, gy); ctx.lineTo(xF1, gy); ctx.stroke();
  }

  // ── TON diamond headlight (neon blue, centred on grille) ──────────────────
  const hlCX = xF0 + (xF1 - xF0) * 0.50;
  const hlCY = gTop + gH * 0.40;
  const dlW  = CH * 0.130;
  const dlH  = CH * 0.095;
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
  ctx.moveTo(hlCX,            hlCY - dlH * 0.5);
  ctx.lineTo(hlCX + dlW * 0.5, hlCY);
  ctx.lineTo(hlCX,            hlCY + dlH * 0.5);
  ctx.lineTo(hlCX - dlW * 0.5, hlCY);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // ── wheels ─────────────────────────────────────────────────────────────────
  drawWheel(ctx, rWX, WY, WR);
  drawWheel(ctx, fWX, WY, WR);

  // ── pothole splash ──────────────────────────────────────────────────────────
  if (hit) {
    ctx.fillStyle = 'rgba(55,45,35,0.72)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - 0.2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * WR * 1.8, WY - WR + Math.sin(ang) * WR * 1.2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── winner flash ────────────────────────────────────────────────────────────
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.28)';
    ctx.fillRect(L - 6, roofY - 6, CW + 12, bumperBotY - roofY + 12);
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
