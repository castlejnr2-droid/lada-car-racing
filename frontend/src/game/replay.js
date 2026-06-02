/**
 * Side-scrolling Soviet street race — visual replay driver.
 *
 * Side view:  camera beside the track, road scrolls right→left.
 * Front view: camera AT the finish line looking back at approaching cars.
 *             Cars start tiny at the vanishing point and grow as they near.
 *             When a car crosses the finish banner it zooms off the bottom.
 *
 * Ending sequence (side view):
 *   1. Finish-line banner slides in during last 18%.
 *   2. Winner drives to finish (55 frames).
 *   3. Celebration burst + flash (50 frames).
 *   4. Hold (20 frames), then onComplete().
 *
 * Ending sequence (front view):
 *   1. Cars grow from vanishing point as they approach.
 *   2. Each car crosses the checkered banner (at ~80% track) and zooms off bottom.
 *   3. 1.5 s after winner zooms off, onComplete().
 */
import { createRng, seedFromHex } from './rng.js';
import { buildTrack, simulate, TRACK_LENGTH } from './physics.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const PHYS_PER_FRAME  = 2;
const SCROLL_SCALE    = 2.0;
const LEAD_X_FRAC     = 0.30;
const SPREAD_SCALE    = 1.1;
const FINISH_X_FRAC   = 0.72;

const END_DRIVE     = 55;
const END_CELEBRATE = 50;
const END_HOLD      = 20;
const END_TOTAL     = END_DRIVE + END_CELEBRATE + END_HOLD;

// Perspective strength for front view (higher = more aggressive vanishing)
const PERSP_K = 5;

// Front-view finish line
const FINISH_POS_FRAC  = 0.80;   // normalised track position where car hits banner
const ZOOM_FRAMES      = 24;     // frames to zoom off the bottom
const FRONT_HOLD       = 90;     // frames (~1.5 s) to wait after winner zooms off

const CAR_COLORS = [
  '#e8e0d0', // off-white
  '#c8472b', // Soviet red
  '#1a1a1a', // black
  '#2d5a2d', // dark green
  '#1a2855', // navy
];

// ─── entry point ─────────────────────────────────────────────────────────────
export function runReplay(canvas, hexSeed, { onComplete, onTick, getViewMode = () => 'side', playerNames = [] } = {}) {
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
  const CAR_H  = CAR_W * 0.42;

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

  // Accumulated wheel rotation angle per car (radians). Each car's wheels spin at
  // a speed proportional to its own physics speed: angle += speed * SCROLL_SCALE / WR.
  // We update per-physics-tick (same cadence as scrollX) so the wheel rate matches
  // the road scroll exactly.
  const wheelAngles = new Array(N).fill(0);
  const WR_SCREEN   = CAR_H * 0.22;   // wheel radius in screen px (mirrors drawLada)

  const endStartX = new Array(N).fill(0);

  // ── front-view finish state ─────────────────────────────────────────────
  const frontZoomStart   = new Array(N).fill(-1);  // frame when car's zoom started
  let frontWinnerZoomDone = -1;
  let frontCompleteFired  = false;

  function loop() {
    if (cancelled) return;
    frameCount++;

    // ── physics ───────────────────────────────────────────────────────────
    if (endFrame < 0) {
      if (frameCount % PHYS_PER_FRAME === 0 && physTick < sim.history.length - 1) {
        physTick++;
        onTick?.(physTick, sim);
        // Advance each car's wheel angle by its own speed this tick
        const s = sim.history[physTick];
        for (let i = 0; i < N; i++) {
          wheelAngles[i] += s.speeds[i] * SCROLL_SCALE / WR_SCREEN;
        }
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

    // ── road scroll (side view) ───────────────────────────────────────────
    if (endFrame < 0) {
      scrollX += Math.max(...state.speeds, 1) * SCROLL_SCALE;
    } else if (endFrame < END_DRIVE) {
      const endScrollDelta = winnerSpd * SCROLL_SCALE * (1 - easeOutCubic(endFrame / END_DRIVE) * 0.6);
      scrollX += endScrollDelta;
      // Winner's wheels keep spinning while driving to finish; loser's slow to a stop
      wheelAngles[sim.winner] += endScrollDelta / WR_SCREEN;
    }

    // ── side-view car screen-x ────────────────────────────────────────────
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

    // ── finish line ───────────────────────────────────────────────────────
    let finishLineX;
    const physPct = physTick / sim.history.length;
    if (endFrame >= 0) {
      finishLineX = FINISH_X;
    } else if (physPct >= 0.82) {
      finishLineX = W + 60 - easeOutCubic((physPct - 0.82) / 0.18) * (W + 60 - FINISH_X);
    } else {
      finishLineX = W + 60;
    }

    // ── celebration ───────────────────────────────────────────────────────
    const celebFrame = (endFrame >= END_DRIVE) ? (endFrame - END_DRIVE) : -1;
    const flashOn    = celebFrame >= 0 && celebFrame < END_CELEBRATE && celebFrame % 10 < 5;

    // ── front-view: track finish line crossings + completion ─────────────
    if (getViewMode() === 'front') {
      for (let i = 0; i < N; i++) {
        if (frontZoomStart[i] < 0) {
          // Trigger zoom when car reaches FINISH_POS_FRAC of track
          if (state.positions[i] / TRACK_LENGTH >= FINISH_POS_FRAC) {
            frontZoomStart[i] = frameCount;
          }
          // Fallback: once winner has been zooming for ZOOM_FRAMES, trigger
          // remaining cars staggered so they follow the winner off screen
          else if (frontZoomStart[sim.winner] >= 0) {
            const lag = 10 + ((i + N - sim.winner) % N) * 8;
            if (frameCount >= frontZoomStart[sim.winner] + lag) {
              frontZoomStart[i] = frameCount;
            }
          }
        }
      }
      // Mark when winner zoom animation is complete
      if (frontWinnerZoomDone < 0 && frontZoomStart[sim.winner] >= 0 &&
          frameCount - frontZoomStart[sim.winner] >= ZOOM_FRAMES) {
        frontWinnerZoomDone = frameCount;
      }
      // Fire onComplete 1.5 s after winner zoomed off
      if (!frontCompleteFired && frontWinnerZoomDone >= 0 &&
          frameCount - frontWinnerZoomDone >= FRONT_HOLD) {
        frontCompleteFired = true;
        onComplete?.();
        return;
      }
    }

    // ── draw ─────────────────────────────────────────────────────────────
    if (getViewMode() === 'front') {
      drawFrameFront(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                     sim, state, scenery, physTick, endFrame,
                     sim.winner, flashOn, celebFrame, confetti,
                     frontZoomStart, frameCount);
    } else {
      drawFrame(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                sim, state, scenery, scrollX, physTick, endFrame,
                carX, finishLineX, sim.winner, flashOn, celebFrame, confetti, playerNames);
    }

    // Side-view completion (front view handles its own above)
    if (getViewMode() !== 'front' && endFrame >= END_TOTAL) { onComplete?.(); return; }
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
  while (tx < W * 2) {
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
                   carX, finishLineX, winnerIdx, flashOn, celebFrame, confetti, playerNames) {
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
    const stopped = celebFrame >= 0 && i !== winnerIdx;
    const carY = baseY + bounce;
    drawLada(ctx, carX[i], carY, CAR_W, CAR_H,
             CAR_COLORS[i % CAR_COLORS.length],
             stopped ? 0 : state.speeds[i], state.hits[i],
             i === winnerIdx && flashOn,
             wheelAngles[i]);

    // Player name above car
    const name = playerNames[i];
    if (name) {
      const label = name.length > 10 ? name.slice(0, 10) : name;
      const fontSize = Math.max(9, Math.round(CAR_H * 0.38));
      const nameY = carY - CAR_H * 0.85;
      ctx.save();
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(carX[i] - tw / 2 - 3, nameY - fontSize - 1, tw + 6, fontSize + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, carX[i], nameY);
      ctx.restore();
    }
  }
  if (celebFrame >= 0 && celebFrame < 50) {
    const winY = ROAD_Y + (winnerIdx + 0.54) * LANE_H;
    drawCelebration(ctx, carX[winnerIdx], winY, CAR_W, CAR_H, celebFrame, confetti);
  }
}

// ─── FRONT VIEW frame ────────────────────────────────────────────────────────
// Camera AT the finish line. Cars approach from vanishing point.
// Each car zooms off the bottom when it crosses the checkered banner.
function drawFrameFront(ctx, W, H, N, SKY_H, TREE_H, ROAD_Y, LANE_H, CAR_W, CAR_H,
                        sim, state, scenery, physTick, endFrame,
                        winnerIdx, flashOn, celebFrame, confetti,
                        frontZoomStart, frameCount) {
  ctx.clearRect(0, 0, W, H);

  // Static Soviet sky + tree strip
  drawSky(ctx, W, SKY_H, 0, scenery.buildings);
  drawTrees(ctx, W, SKY_H, TREE_H, 0, scenery.trees);

  // Perspective road geometry
  const VP_Y    = ROAD_Y + (H - ROAD_Y) * 0.04;
  const ROAD_HW = W * 0.30;

  // Banner y: where cars are when position = FINISH_POS_FRAC of track
  const bannerT  = FINISH_POS_FRAC;
  const bannerPF = bannerT / (bannerT + (1 - bannerT) * PERSP_K);
  const bannerY  = VP_Y + (H - VP_Y) * bannerPF;
  const bannerH  = Math.max(14, H * 0.038);

  // Road + cityscape + banner (drawn before cars)
  drawRoadFront(ctx, W, H, N, ROAD_Y, VP_Y, ROAD_HW, bannerY, bannerH);

  // Progress HUD
  drawProgressHud(ctx, W, ROAD_Y, state.positions, N);

  // ── perspF: position → 0..1 scale factor ─────────────────────────────────
  const perspF = (pos) => {
    const t = Math.min(0.998, Math.max(0, pos / TRACK_LENGTH));
    return t / (t + (1 - t) * PERSP_K);
  };

  const MAX_CAR_W = Math.min(W * 0.58, 240);

  // Sort back-to-front — cars that started zooming go last (closest/biggest)
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
    const pfA = frontZoomStart[a] >= 0 ? 1 + (frameCount - frontZoomStart[a]) / ZOOM_FRAMES
                                        : perspF(state.positions[a]);
    const pfB = frontZoomStart[b] >= 0 ? 1 + (frameCount - frontZoomStart[b]) / ZOOM_FRAMES
                                        : perspF(state.positions[b]);
    return pfA - pfB;
  });

  for (const i of order) {
    let pf    = perspF(state.positions[i]);
    let carW  = MAX_CAR_W * pf;
    let carH  = carW * 0.40;

    const laneCenter = (i + 0.5) / N;
    let carCX = W / 2 + (laneCenter - 0.5) * ROAD_HW * 2 * pf;
    let carBY = VP_Y + (H - VP_Y) * pf;

    if (frontZoomStart[i] >= 0) {
      // ── Zoom-off animation ───────────────────────────────────────────────
      const zoomT  = Math.min(1, (frameCount - frontZoomStart[i]) / ZOOM_FRAMES);
      const scale  = 1 + easeOutCubic(zoomT) * 5.5;  // 1x → 6.5x

      // Base size at banner
      const baseW = MAX_CAR_W * bannerPF;
      const baseH = baseW * 0.40;
      const baseCX = W / 2 + (laneCenter - 0.5) * ROAD_HW * 2 * bannerPF;

      carW  = baseW  * scale;
      carH  = baseH  * scale;
      carCX = baseCX;  // stay centred in lane
      // Shoot off bottom: top of car moves from bannerY to off-screen
      carBY = bannerY + easeOutCubic(zoomT) * (H + carH - bannerY);

      // Skip once fully off screen
      if (carBY - carH > H + 10) continue;
    } else {
      if (pf < 0.015) continue;  // too tiny to bother

      // Speed wobble while racing
      const wobble = endFrame < 0
        ? Math.sin(physTick * 0.38 + i * 1.7) * Math.max(0, state.speeds[i] - 1.5) * 0.35 * pf
        : 0;
      carCX += wobble;
    }

    drawLadaFront(
      ctx, carCX, carBY, carW, carH,
      CAR_COLORS[i % CAR_COLORS.length],
      frontZoomStart[i] >= 0 ? 0 : state.speeds[i],
      state.hits[i],
      i === winnerIdx && flashOn,
    );
  }

  // Re-draw banner ON TOP of cars (so it stays visible as cars zoom under it)
  drawFinishBanner(ctx, W, bannerY, bannerH, /* glowing */ frontZoomStart[winnerIdx] >= 0);
}

// ─── sky ─────────────────────────────────────────────────────────────────────
function drawSky(ctx, W, skyH, scrollX, buildings) {
  const grad = ctx.createLinearGradient(0, 0, 0, skyH);
  grad.addColorStop(0, '#2e333c');
  grad.addColorStop(1, '#545e6e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, skyH);

  ctx.strokeStyle = 'rgba(180,185,195,0.07)'; ctx.lineWidth = 2;
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
    const rows = Math.max(2, Math.floor(bh / 11));
    const cw   = Math.max(2, (b.w - 6) / b.cols - 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        if ((r + c + Math.floor(b.x / 8)) % 3 === 0) continue;
        ctx.fillStyle = `rgba(210,160,55,${0.25 + (r % 2) * 0.15})`;
        ctx.fillRect(bx + 3 + c * ((b.w - 6) / b.cols), skyH - bh + 7 + r * 11, cw, 4);
      }
    }
    if (b.cols <= 2) {
      ctx.strokeStyle = '#1e2228'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx + b.w * 0.5, skyH - bh); ctx.lineTo(bx + b.w * 0.5, skyH - bh - 10); ctx.stroke();
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

// ─── Soviet building colour palettes (dark grey / blue-grey variants) ────────
// Each entry is [r, g, b] for the base concrete tone.
const BPAL = [
  [30, 32, 38],  // blue-charcoal  — classic панельный дом
  [28, 29, 31],  // neutral dark grey
  [32, 31, 30],  // warm grey      — older weathered concrete
  [26, 30, 36],  // deep navy grey
  [34, 33, 31],  // brownish grey  — стained concrete
  [29, 33, 35],  // cool blue-grey — кирпич / newer panel
];

// ─── fast deterministic hash, returns 0..1 ───────────────────────────────────
function fhash(n) {
  let x = (Math.imul(n | 0, 2654435761) >>> 0);
  x = (Math.imul((x ^ (x >>> 16)), 0x45d9f3b) >>> 0);
  x = (Math.imul((x ^ (x >>> 16)), 0x45d9f3b) >>> 0);
  return (x >>> 0) / 0x100000000;
}

// ─── per-building window grid ─────────────────────────────────────────────────
function drawBuildingWindows(ctx, seed, bX, bTopY, bW, bH, sy, t) {
  // Window and spacing sizes scale with depth
  const wW  = Math.max(1.5, Math.min(bW * 0.13, t * 7));
  const wH  = Math.max(1.0, Math.min(bH * 0.09, t * 5));
  const gX  = Math.max(wW * 0.7, t * 3.5);   // column gap
  const gY  = Math.max(wH * 1.0, t * 5.5);   // row gap (floor height)
  const padX = Math.max(2, bW * 0.07);
  const padY = Math.max(2, bH * 0.06);

  let row = 0;
  for (let wy = bTopY + padY; wy + wH < sy - 2; wy += wH + gY, row++) {
    let col = 0;
    for (let wx = bX + padX; wx + wW < bX + bW - padX; wx += wW + gX, col++) {
      const ws = (seed * 7919 + row * 1009 + col * 307) | 0;
      const r  = fhash(ws);

      if (r < 0.20) continue;           // light off

      if (r > 0.93) {
        // Rare: blue-white TV/monitor glow
        ctx.fillStyle = `rgba(155,180,215,${0.35 + fhash(ws + 1) * 0.30})`;
      } else if (r > 0.72) {
        // Bright warm light
        ctx.fillStyle = `rgba(255,198,75,${0.60 + fhash(ws + 2) * 0.30})`;
      } else {
        // Dim warm light
        ctx.fillStyle = `rgba(195,148,55,${0.28 + fhash(ws + 3) * 0.35})`;
      }
      ctx.fillRect(wx, wy, wW, wH);
    }
  }
}

// ─── per-building rooftop details ─────────────────────────────────────────────
function drawRooftopFeatures(ctx, seed, bX, bTopY, bW, baseCol) {
  const dark = shade(baseCol, -0.28);

  // Stairwell / elevator penthouse box
  if (fhash(seed * 13) > 0.52) {
    const phW = Math.max(4, bW * 0.18);
    const phH = Math.max(3, bW * 0.11);
    const phX = bX + bW * (0.04 + fhash(seed * 17) * 0.50);
    ctx.fillStyle = shade(baseCol, -0.18);
    ctx.fillRect(phX, bTopY - phH, phW, phH);
  }

  // Water tower (rectangle body + triangle roof + two legs)
  if (fhash(seed * 19) > 0.60) {
    const twW = Math.max(3, bW * 0.14);
    const twH = Math.max(4, bW * 0.24);
    const twX = bX + bW * (0.20 + fhash(seed * 23) * 0.55);
    ctx.fillStyle = dark;
    ctx.fillRect(twX - twW / 2, bTopY - twH, twW, twH * 0.70);
    // Conical cap
    ctx.beginPath();
    ctx.moveTo(twX - twW / 2 - 1, bTopY - twH * 0.70);
    ctx.lineTo(twX, bTopY - twH * 1.00);
    ctx.lineTo(twX + twW / 2 + 1, bTopY - twH * 0.70);
    ctx.closePath();
    ctx.fill();
    // Support legs
    ctx.fillStyle = shade(dark, -0.12);
    ctx.fillRect(twX - twW / 2 + 1, bTopY - twH * 0.38, 1, twH * 0.38);
    ctx.fillRect(twX + twW / 2 - 2, bTopY - twH * 0.38, 1, twH * 0.38);
  }

  // TV antenna / mast
  if (fhash(seed * 29) > 0.45) {
    const anH  = Math.max(5, bW * 0.32);
    const anX  = bX + bW * (0.55 + fhash(seed * 31) * 0.35);
    ctx.strokeStyle = shade(dark, -0.15);
    ctx.lineWidth = Math.max(0.5, bW * 0.018);
    ctx.beginPath(); ctx.moveTo(anX, bTopY); ctx.lineTo(anX, bTopY - anH); ctx.stroke();
    // Cross-bar
    const cbY = bTopY - anH * 0.55;
    const cbL = anH * 0.28;
    ctx.beginPath(); ctx.moveTo(anX - cbL, cbY); ctx.lineTo(anX + cbL, cbY); ctx.stroke();
  }
}

// ─── front-view perspective road + Soviet cityscape ──────────────────────────
function drawRoadFront(ctx, W, H, N, roadY, VP_Y, ROAD_HW, bannerY, bannerH) {
  const vpX   = W / 2;
  const roadH = H - VP_Y;

  // ── Soviet brutalist buildings — back to front ──────────────────────────
  // Each depth slab is divided into 1-3 individual buildings per side,
  // each with its own shade, window grid, and rooftop features.
  const SLABS = 12;
  for (let si = 0; si < SLABS; si++) {
    const t     = (si + 1) / SLABS;
    const sy    = VP_Y + roadH * t;
    const roadL = vpX - ROAD_HW * t;
    const roadR = vpX + ROAD_HW * t;
    const leftW  = Math.max(0, roadL);
    const rightW = Math.max(0, W - roadR);

    // Number of distinct buildings to show in each strip at this depth
    const nB = leftW > W * 0.20 ? 3 : leftW > W * 0.09 ? 2 : 1;

    for (let side = 0; side < 2; side++) {
      const stripX = side === 0 ? 0 : roadR;
      const stripW = side === 0 ? leftW : rightW;
      if (stripW < 2) continue;

      const bldgW0 = stripW / nB;

      for (let b = 0; b < nB; b++) {
        const bSeed = si * 211 + side * 97 + b * 43;

        // Slightly irregular building widths (±10%)
        const wMod  = 0.90 + fhash(bSeed * 3) * 0.20;
        const bW    = Math.max(2, (bldgW0 * wMod) - 1);   // -1 = thin gap
        const bX    = stripX + b * bldgW0 + (bldgW0 - bW) * 0.5;

        // Height: each building varies independently within slab range
        const hFrac = 0.50 + fhash(bSeed * 7) * 0.65;
        const hVar  = 0.82 + fhash(bSeed * 11) * 0.38;    // ±19% per building
        const bH    = Math.max(4, t * roadH * hFrac * 1.2 * hVar);
        const bTopY = sy - bH;

        // Colour: pick palette + per-building luminance nudge
        const palIdx = Math.floor(fhash(bSeed * 13) * BPAL.length);
        const [r0, g0, b0] = BPAL[palIdx];
        const lum   = (fhash(bSeed * 17) * 14) - 7;       // -7..+7
        const clp   = (v) => Math.max(0, Math.min(255, Math.round(v + lum)));
        const col   = `rgb(${clp(r0)},${clp(g0)},${clp(b0)})`;

        // Building body
        ctx.fillStyle = col;
        ctx.fillRect(bX, bTopY, bW, bH);

        // Window grid — skip tiny buildings
        if (t > 0.14 && bH > 7 && bW > 5) {
          drawBuildingWindows(ctx, bSeed, bX, bTopY, bW, bH, sy, t);
        }

        // Rooftop features — only on close enough / large enough buildings
        if (t > 0.42 && bW > 12 && bH > 10) {
          drawRooftopFeatures(ctx, bSeed, bX, bTopY, bW, col);
        }
      }
    }
  }

  // ── Near-horizon city fog: veils the most distant buildings ──────────────
  const fogDepth = roadH * 0.38;
  const fog = ctx.createLinearGradient(0, VP_Y, 0, VP_Y + fogDepth);
  fog.addColorStop(0,   'rgba(38,48,65,0.82)');
  fog.addColorStop(0.5, 'rgba(38,48,65,0.38)');
  fog.addColorStop(1,   'rgba(38,48,65,0)');
  ctx.fillStyle = fog;
  // Apply only to building strips, not over the centre road
  const fogRoadL = vpX - ROAD_HW * 0.05;
  const fogRoadR = vpX + ROAD_HW * 0.05;
  ctx.fillRect(0,          VP_Y, fogRoadL,     fogDepth);
  ctx.fillRect(fogRoadR,   VP_Y, W - fogRoadR, fogDepth);

  // ── road surface ──────────────────────────────────────────────────────────
  const roadGrad = ctx.createLinearGradient(0, VP_Y, 0, H);
  roadGrad.addColorStop(0, '#2a2c32');
  roadGrad.addColorStop(0.45, '#1f2126');
  roadGrad.addColorStop(1, '#1c1e22');
  ctx.fillStyle = roadGrad;
  ctx.beginPath();
  ctx.moveTo(vpX, VP_Y);
  ctx.lineTo(vpX + ROAD_HW, H);
  ctx.lineTo(vpX - ROAD_HW, H);
  ctx.closePath();
  ctx.fill();

  // Road depth bands
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const bandY = VP_Y + roadH * t;
    const bw    = ROAD_HW * 2 * t;
    ctx.fillStyle = `rgba(255,255,255,${0.005 + t * 0.009})`;
    ctx.fillRect(vpX - bw / 2, bandY - 1, bw, 2);
  }

  // Lane dividers converging to VP
  for (let i = 0; i <= N; i++) {
    const bx = vpX + (i / N - 0.5) * ROAD_HW * 2;
    const isBorder = i === 0 || i === N;
    ctx.strokeStyle = isBorder ? '#8a8070' : '#c09030';
    ctx.lineWidth   = isBorder ? 2.5 : 1.5;
    ctx.setLineDash(isBorder ? [] : [18, 14]);
    ctx.beginPath(); ctx.moveTo(vpX, VP_Y); ctx.lineTo(bx, H); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Horizon haze
  const haze = ctx.createLinearGradient(0, VP_Y - 4, 0, VP_Y + 16);
  haze.addColorStop(0, 'rgba(84,94,110,0)');
  haze.addColorStop(1, 'rgba(84,94,110,0.60)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, VP_Y - 4, W, 20);

  // ── Checkered finish banner (drawn on road before cars) ───────────────────
  // Re-drawn again AFTER cars to keep it visible — see drawFrameFront.
  drawFinishBanner(ctx, W, bannerY, bannerH, false);
}

// ─── checkered finish banner (horizontal, full-width) ────────────────────────
function drawFinishBanner(ctx, W, bannerY, bannerH, glowing) {
  ctx.save();

  // Dark backing strip
  ctx.fillStyle = 'rgba(10,10,14,0.72)';
  ctx.fillRect(0, bannerY - bannerH * 0.4, W, bannerH * 1.6);

  // Checkered squares
  const sqW = Math.max(4, bannerH * 0.85);
  const cols = Math.ceil(W / sqW) + 1;
  for (let c = 0; c < cols; c++) {
    for (let row = 0; row < 2; row++) {
      ctx.fillStyle = (c + row) % 2 === 0 ? '#f0ece0' : '#111116';
      ctx.fillRect(c * sqW, bannerY - sqW * 0.5 + row * sqW * 0.5, sqW + 0.5, sqW * 0.5 + 0.5);
    }
  }

  // Gold border lines
  if (glowing) {
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 18;
  }
  ctx.strokeStyle = glowing ? '#ffd700' : '#888870';
  ctx.lineWidth = glowing ? 2.5 : 1.5;
  ctx.beginPath(); ctx.moveTo(0, bannerY - sqW * 0.5); ctx.lineTo(W, bannerY - sqW * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, bannerY + sqW * 0.5); ctx.lineTo(W, bannerY + sqW * 0.5); ctx.stroke();
  ctx.shadowBlur = 0;

  // "FINISH" label at centre
  const fontSize = Math.max(9, bannerH * 1.0);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (glowing) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 12; }
  ctx.fillStyle = glowing ? '#ffd700' : '#d0c890';
  ctx.fillText('FINISH', W / 2, bannerY);
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ─── side-view finish line ────────────────────────────────────────────────────
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
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    ctx.translate(px, py); ctx.rotate(celebFrame * p.spin);
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
// cx = centre x, cy = wheel-centre y, x=0 REAR x=1 FRONT (faces right)
function drawLada(ctx, cx, cy, CW, CH, color, speed, hit, flashOn, wheelAngle = 0) {
  const L   = cx - CW / 2;
  const TOP = cy - CH * 0.78;
  const px = (nx) => L   + nx * CW;
  const py = (ny) => TOP + ny * CH;
  const WR  = CH * 0.22;
  const rWX = px(0.18), fWX = px(0.78), WY = cy;

  ctx.save();

  // exhaust
  if (speed > 0.8) {
    const n = hit ? 5 : Math.min(5, Math.ceil(speed / 1.6));
    const sm = hit ? 1.6 : (1 + speed * 0.08);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hit ? `rgba(80,65,45,${0.58 - i * 0.10})` : `rgba(125,118,110,${0.35 - i * 0.06})`;
      ctx.beginPath(); ctx.arc(px(0) - i * 16 - 12, py(0.65) - i * 3, (4 + i * 4.5) * sm, 0, Math.PI * 2); ctx.fill();
    }
  }
  // speed lines
  if (speed > 2.5 && !hit) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const len = 18 + (4 - i) * 9 + speed * 2;
      const lny = py(0.34 + i * 0.07);
      ctx.beginPath(); ctx.moveTo(px(0) - len - 8, lny); ctx.lineTo(px(0) - 8, lny); ctx.stroke();
    }
  }

  // body polygon — Lada 2107: short hood (~28%), long boxy cabin (~54%), notchback trunk (~18%)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px(1.00), py(0.72));
  ctx.lineTo(px(1.00), py(0.58));
  ctx.lineTo(px(0.93), py(0.52));
  ctx.lineTo(px(0.72), py(0.50));   // A-pillar base — moved fwd from 0.62 → shorter hood
  ctx.lineTo(px(0.67), py(0.22));   // A-pillar top — nearly vertical windshield
  ctx.lineTo(px(0.25), py(0.20));
  ctx.lineTo(px(0.18), py(0.25));
  ctx.lineTo(px(0.12), py(0.50));
  ctx.lineTo(px(0.05), py(0.52));
  ctx.lineTo(px(0.00), py(0.58));
  ctx.lineTo(px(0.00), py(0.72));
  ctx.closePath(); ctx.fill();

  // windows
  const glass = 'rgba(18,35,65,0.90)';
  ctx.fillStyle = glass;
  ctx.beginPath(); ctx.moveTo(px(0.720),py(0.500)); ctx.lineTo(px(0.672),py(0.225)); ctx.lineTo(px(0.692),py(0.225)); ctx.lineTo(px(0.738),py(0.500)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = glass;
  ctx.beginPath(); ctx.moveTo(px(0.188),py(0.258)); ctx.lineTo(px(0.242),py(0.208)); ctx.lineTo(px(0.272),py(0.208)); ctx.lineTo(px(0.222),py(0.258)); ctx.lineTo(px(0.130),py(0.492)); ctx.lineTo(px(0.118),py(0.492)); ctx.closePath(); ctx.fill();

  const roofAtX = (nx) => 0.20 + (0.22 - 0.20) * Math.max(0, (nx - 0.25) / (0.67 - 0.25));
  const beltY = 0.455, winRear = 0.278, winFrnt = 0.660, bpX = winRear + (winFrnt - winRear) * 0.50;
  ctx.fillStyle = glass;
  ctx.fillRect(px(winRear+0.008), py(roofAtX(winRear)+0.015), px(bpX-0.010)-px(winRear+0.008), py(beltY)-py(roofAtX(winRear)+0.015));
  ctx.fillRect(px(bpX+0.010), py(roofAtX(bpX)+0.008), px(winFrnt-0.008)-px(bpX+0.010), py(beltY)-py(roofAtX(bpX)+0.008));
  ctx.fillStyle = shade(color, -0.30);
  ctx.fillRect(px(bpX-0.012), py(roofAtX(bpX)+0.008), px(bpX+0.012)-px(bpX-0.012), py(beltY)-py(roofAtX(bpX)+0.008));

  ctx.strokeStyle = 'rgba(195,188,168,0.50)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px(0.06),py(beltY)); ctx.lineTo(px(0.72),py(beltY)); ctx.stroke();

  // LADA badge — centred on door panel between wheels
  const badgeCX = (rWX + fWX) / 2;
  const badgeY  = py(0.62);
  const badgeFontSize = Math.max(6, Math.round(CW * 0.072));
  ctx.save();
  ctx.font = `bold ${badgeFontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText('LADA', badgeCX, badgeY);
  ctx.restore();

  // taillights
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = hit ? 12 : 8;
  ctx.fillStyle = hit ? '#ff5533' : '#ff1800';
  ctx.fillRect(px(0.010), py(0.55), px(0.050)-px(0.010), py(0.70)-py(0.55));
  ctx.shadowBlur = hit ? 6 : 4;
  ctx.fillStyle = hit ? '#ffaa88' : '#ff4400';
  ctx.fillRect(px(0.014), py(0.56), px(0.042)-px(0.014), py(0.62)-py(0.56));
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#aa5500';
  ctx.fillRect(px(0.010), py(0.70), px(0.050)-px(0.010), py(0.73)-py(0.70));

  // grille + headlight
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(px(0.965), py(0.55), px(1.00)-px(0.965), py(0.70)-py(0.55));
  ctx.strokeStyle = '#353d4a'; ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const gy = py(0.55) + (py(0.70)-py(0.55)) * (i/4);
    ctx.beginPath(); ctx.moveTo(px(0.965),gy); ctx.lineTo(px(1.00),gy); ctx.stroke();
  }

  const hlCX = px(0.975), hlCY = py(0.525), dlW = CW*0.055, dlH = CH*0.092;
  ctx.shadowColor = '#00aaff'; ctx.shadowBlur = 28;
  ctx.fillStyle = '#70d8ff';
  ctx.beginPath(); ctx.moveTo(hlCX,hlCY-dlH); ctx.lineTo(hlCX+dlW,hlCY); ctx.lineTo(hlCX,hlCY+dlH); ctx.lineTo(hlCX-dlW,hlCY); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 10; ctx.fillStyle = '#d8f4ff';
  ctx.beginPath(); ctx.moveTo(hlCX,hlCY-dlH*0.5); ctx.lineTo(hlCX+dlW*0.5,hlCY); ctx.lineTo(hlCX,hlCY+dlH*0.5); ctx.lineTo(hlCX-dlW*0.5,hlCY); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // wheel arches + wheels
  ctx.fillStyle = shade(color, -0.28);
  ctx.beginPath(); ctx.arc(rWX, WY, WR+3, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(fWX, WY, WR+3, Math.PI, 0); ctx.fill();
  drawWheel(ctx, rWX, WY, WR, wheelAngle);
  drawWheel(ctx, fWX, WY, WR, wheelAngle);

  if (hit) {
    ctx.fillStyle = 'rgba(55,45,35,0.72)';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - 0.2;
      ctx.beginPath(); ctx.arc(cx+Math.cos(ang)*WR*1.8, WY-WR+Math.sin(ang)*WR*1.2, 3, 0, Math.PI*2); ctx.fill();
    }
  }
  if (flashOn) {
    ctx.fillStyle = 'rgba(255,215,40,0.28)';
    ctx.fillRect(L-6, TOP-6, CW+12, CH*0.90+12);
  }
  ctx.restore();
}

// ─── FRONT VIEW — Lada 2107 head-on ──────────────────────────────────────────
// cx = horizontal centre, cy = car bottom (ground). Scales by CW × CH.
function drawLadaFront(ctx, cx, cy, CW, CH, color, speed, hit, flashOn) {
  if (CW < 3) return;
  const L = cx - CW / 2;
  const T = cy - CH;
  const px = (nx) => L + nx * CW;
  const py = (ny) => T + ny * CH;

  ctx.save();

  const bumperT  = 0.86;
  const hoodT    = 0.36;
  const cabInset = 0.08;

  ctx.fillStyle = color;
  ctx.fillRect(px(cabInset), py(0), CW*(1-2*cabInset), py(hoodT)-py(0));
  ctx.fillStyle = color;
  ctx.fillRect(px(0), py(hoodT), CW, py(bumperT)-py(hoodT));
  ctx.strokeStyle = shade(color, -0.35); ctx.lineWidth = Math.max(0.5, CW*0.007);
  ctx.strokeRect(px(0), py(hoodT), CW, py(bumperT)-py(hoodT));
  ctx.strokeRect(px(cabInset), py(0), CW*(1-2*cabInset), py(hoodT)-py(0));

  ctx.fillStyle = shade(color, -0.32);
  ctx.fillRect(px(0), py(bumperT), CW, py(1.0)-py(bumperT));
  const bmpH = py(1.0)-py(bumperT);
  ctx.fillStyle = 'rgba(200,192,178,0.65)';
  ctx.fillRect(px(0), py(bumperT)+bmpH*0.32, CW, bmpH*0.22);
  ctx.fillStyle = '#181818';
  ctx.fillRect(px(0.04), py(1.0)-Math.max(1,CW*0.02), CW*0.92, Math.max(1,CW*0.02));

  const wR = CH*0.12;
  ctx.fillStyle = '#111116';
  ctx.beginPath(); ctx.arc(px(0.09), py(1.0), wR, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(px(0.91), py(1.0), wR, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#555550'; ctx.lineWidth = wR*0.22;
  ctx.beginPath(); ctx.arc(px(0.09), py(1.0), wR*0.62, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(px(0.91), py(1.0), wR*0.62, Math.PI, 0); ctx.stroke();

  const hlYt=0.40, hlYb=0.82, lHX0=0.03, lHX1=0.25, rHX0=0.75, rHX1=0.97;
  const hlH = py(hlYb)-py(hlYt);
  const lHW = px(lHX1)-px(lHX0);
  const rHW = px(rHX1)-px(rHX0);
  ctx.fillStyle = '#14141c';
  ctx.fillRect(px(lHX0), py(hlYt), lHW, hlH);
  ctx.fillRect(px(rHX0), py(hlYt), rHW, hlH);

  const gX0=0.27, gX1=0.73, gY0=0.42, gY1=0.84;
  const gH=py(gY1)-py(gY0), gW=px(gX1)-px(gX0);
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(px(gX0), py(gY0), gW, gH);
  ctx.strokeStyle = '#353d4a'; ctx.lineWidth = Math.max(0.5, CW*0.004);
  for (let i=1; i<5; i++) {
    const gy = py(gY0)+gH*(i/5);
    ctx.beginPath(); ctx.moveTo(px(gX0),gy); ctx.lineTo(px(gX1),gy); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx,py(gY0)); ctx.lineTo(cx,py(gY1)); ctx.stroke();

  if (CW > 14) {
    const drawDiamond = (dcx, dcy, dW, dH) => {
      ctx.shadowColor='#00aaff'; ctx.shadowBlur=Math.min(26, CW*0.18);
      ctx.fillStyle='#70d8ff';
      ctx.beginPath(); ctx.moveTo(dcx,dcy-dH); ctx.lineTo(dcx+dW,dcy); ctx.lineTo(dcx,dcy+dH); ctx.lineTo(dcx-dW,dcy); ctx.closePath(); ctx.fill();
      ctx.shadowBlur=Math.min(9, CW*0.06); ctx.fillStyle='#d8f4ff';
      ctx.beginPath(); ctx.moveTo(dcx,dcy-dH*0.5); ctx.lineTo(dcx+dW*0.5,dcy); ctx.lineTo(dcx,dcy+dH*0.5); ctx.lineTo(dcx-dW*0.5,dcy); ctx.closePath(); ctx.fill();
      ctx.shadowBlur=0;
    };
    const dW=lHW*0.50, dH=hlH*0.44;
    drawDiamond(px(lHX0)+lHW/2, py(hlYt)+hlH/2, dW, dH);
    drawDiamond(px(rHX0)+rHW/2, py(hlYt)+hlH/2, dW, dH);
  }

  if (CW > 8) {
    const wsX0=cabInset+0.06, wsX1=1-cabInset-0.06;
    ctx.fillStyle='rgba(18,35,65,0.90)';
    ctx.fillRect(px(wsX0), py(0.05), px(wsX1)-px(wsX0), py(hoodT-0.05)-py(0.05));
    if (CW > 20) {
      ctx.strokeStyle='rgba(215,235,255,0.18)'; ctx.lineWidth=Math.max(0.5, CW*0.004);
      ctx.beginPath(); ctx.moveTo(px(wsX0+0.04),py(0.09)); ctx.lineTo(px(wsX1-0.04),py(0.09)); ctx.stroke();
    }
  }

  if (flashOn) {
    ctx.fillStyle='rgba(255,215,40,0.28)';
    ctx.fillRect(L-6, T-6, CW+12, CH+12);
  }
  ctx.restore();
}

// ─── wheel ───────────────────────────────────────────────────────────────────
function drawWheel(ctx, cx, cy, r, angle = 0) {
  // Tyre
  ctx.fillStyle = '#111116';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  // Rim ring
  ctx.strokeStyle = '#555550'; ctx.lineWidth = r*0.18;
  ctx.beginPath(); ctx.arc(cx, cy, r*0.62, 0, Math.PI*2); ctx.stroke();
  // Hub cap
  ctx.fillStyle = '#888882';
  ctx.beginPath(); ctx.arc(cx, cy, r*0.22, 0, Math.PI*2); ctx.fill();
  // Spokes — rotated by wheel angle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = '#6a6a65'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22);
    ctx.lineTo(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58);
    ctx.stroke();
  }
  ctx.restore();
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
