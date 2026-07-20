/* ============================================================
   PLINKO
   Canvas board with bouncing balls, peg glow, animated bins,
   risk / row configs, and auto-drop. Physics are "guided": each
   ball's left/right path is decided up front with fair 50/50
   rolls (so payouts follow a true binomial distribution), then
   animated with gravity, bounce, and squash so it *feels* like
   free physics without balls ever getting stuck.

   // TODO: Backend — path RNG must come from a provably-fair
   // server seed (hash chain) once real currency is at stake,
   // and payouts credited server-side, never from the client.
   ============================================================ */

const PLINKO_ROWS_OPTIONS = [8, 12, 16];

/* Demo paytables (multiplier of bet per bin), entertainment only.
   Stored as the left half + center; right side mirrors. */
const PLINKO_TABLES = {
  8:  { low:  [5.6, 2.1, 1.1, 1.0, 0.5],
        med:  [13, 3, 1.3, 0.7, 0.4],
        high: [29, 4, 1.5, 0.3, 0.2] },
  12: { low:  [10, 3, 1.6, 1.4, 1.1, 1.0, 0.5],
        med:  [33, 11, 4, 2, 1.1, 0.6, 0.3],
        high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2] },
  16: { low:  [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5],
        med:  [110, 41, 10, 5, 3, 1.5, 1.0, 0.5, 0.3],
        high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2] },
};
function plinkoTable(rows, risk){
  const half = PLINKO_TABLES[rows][risk];
  return [...half, ...half.slice(0, -1).reverse()];
}

let plkRows = 12;
let plkRisk = 'med';
let plkBalls = [];        // active balls in flight
let plkRAF = null;
let plkCanvas, plkCtx, plkDPR = 1;
let plkGeom = null;       // computed peg positions, spacing, bins
let plkPegGlow = {};      // "r,c" -> glow ttl
let plkBinBounce = [];    // per-bin bounce ttl
let plkHistory = [];
let plkAuto = null;   // AutoPlay controller

function initPlinko(){
  plkCanvas = document.getElementById('plinko-canvas');
  if(!plkCanvas) return;
  plkCtx = plkCanvas.getContext('2d');
  resizePlinko();
  window.addEventListener('resize', resizePlinko);
  buildPlinkoControls();
  renderPlinkoBins();
  drawPlinko();

  /* ---- Auto Bet engine ----
     Normal auto resolves each round the moment the path is rolled
     (outcome is decided up front), so balls rain down concurrently
     Rainbet-style while the engine sequences bets every `delay` ms.
     Turbo skips the canvas entirely. */
  if(!plkAuto && typeof AutoPlay !== 'undefined'){
    plkAuto = AutoPlay.create({
      id: 'plinko',
      mount: document.getElementById('plk-auto-mount'),
      betInputId: 'plk-bet',
      delay: 300, turboDelay: 30,
      turbo: true, presets: true,
      playRound: (ctx) => plinkoDrop({ auto: true, turbo: ctx.turbo }),
    });
    AutoPlay.attachMeta('view-plinko', { game: 'Plinko', rtp: '~99%', edge: '~1%' });
  }
}

function resizePlinko(){
  if(!plkCanvas) return;
  const rect = plkCanvas.parentElement.getBoundingClientRect();
  plkDPR = window.devicePixelRatio || 1;
  plkCanvas.width = rect.width * plkDPR;
  plkCanvas.height = rect.height * plkDPR;
  plkCanvas.style.width = rect.width + 'px';
  plkCanvas.style.height = rect.height + 'px';
  computePlinkoGeometry();
  drawPlinko();
}

function computePlinkoGeometry(){
  const w = plkCanvas.width / plkDPR;
  const h = plkCanvas.height / plkDPR;
  const padTop = 46, padBottom = 22, padX = 24;
  // widest row has plkRows + 2 pegs
  const spacing = Math.min((w - padX*2) / (plkRows + 1), (h - padTop - padBottom) / plkRows);
  const rowGap = (h - padTop - padBottom) / plkRows;
  const cx = w / 2;
  const pegs = [];
  for(let r = 0; r < plkRows; r++){
    const count = r + 3;
    const y = padTop + rowGap * (r + 0.5);
    const row = [];
    for(let c = 0; c < count; c++){
      row.push({ x: cx + (c - (count - 1) / 2) * spacing, y });
    }
    pegs.push(row);
  }
  plkGeom = { w, h, cx, spacing, rowGap, padTop, pegs, pegR: Math.max(3, spacing * 0.11), ballR: Math.max(5, spacing * 0.18) };
}

function buildPlinkoControls(){
  const rowsSel = document.getElementById('plk-rows');
  if(rowsSel && !rowsSel.dataset.built){
    rowsSel.innerHTML = PLINKO_ROWS_OPTIONS.map(r => `<option value="${r}" ${r===plkRows?'selected':''}>${r} rows</option>`).join('');
    rowsSel.dataset.built = '1';
    rowsSel.onchange = () => {
      if(plkBalls.length){ rowsSel.value = plkRows; return; } // don't reshape mid-flight
      plkRows = parseInt(rowsSel.value);
      computePlinkoGeometry(); renderPlinkoBins(); drawPlinko();
    };
  }
  document.querySelectorAll('.plk-risk-btn').forEach(btn => {
    btn.onclick = () => {
      if(plkBalls.length) return;
      plkRisk = btn.dataset.risk;
      document.querySelectorAll('.plk-risk-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderPlinkoBins();
      playSound?.('click');
    };
  });
}

function renderPlinkoBins(){
  const wrap = document.getElementById('plinko-bins');
  if(!wrap || !plkGeom) return;
  const table = plinkoTable(plkRows, plkRisk);
  plkBinBounce = new Array(table.length).fill(0);
  const totalW = (plkRows + 1) * plkGeom.spacing;
  wrap.style.width = totalW + 'px';
  wrap.innerHTML = table.map((m, i) => {
    const heat = m >= 10 ? 'hot' : m >= 2 ? 'warm' : m < 1 ? 'cold' : 'base';
    return `<div class="plk-bin ${heat}" id="plk-bin-${i}" style="width:${plkGeom.spacing - 3}px">${m >= 100 ? m : m.toFixed(m >= 10 ? 0 : 1)}x</div>`;
  }).join('');
}

/* ---------- Dropping balls ---------- */
function plinkoDrop(opts = {}){
  if(plkAuto?.isRunning() && !opts.auto) return; // engine owns dropping while running
  const bet = parseFloat(document.getElementById('plk-bet').value);
  if(!bet || bet <= 0){
    if(opts.auto) return plkAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(!takeBet(bet)){
    if(opts.auto) plkAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  if(!opts.turbo) playSound?.('bet');

  // Fair path: one 50/50 per row. Bin index = number of "rights".
  const path = Array.from({ length: plkRows }, () => Math.random() < 0.5 ? 0 : 1);

  // The outcome is fully determined by the path — settle the auto
  // engine now so the next ball can launch without waiting for the
  // animation to land.
  if(opts.auto){
    const rights = path.reduce((a, b) => a + b, 0);
    const table = plinkoTable(plkRows, plkRisk);
    const mult = table[Math.max(0, Math.min(table.length - 1, rights))];
    const payout = +(bet * mult).toFixed(2);
    // Defer one microtask so roundResolved runs after playRound returns.
    Promise.resolve().then(() => plkAuto.roundResolved({ bet, payout, mult }));
    if(opts.turbo){
      // No canvas ball at all — credit + history instantly.
      if(payout > 0) adjustBalance(payout);
      PLGraph?.roundSettled(bet, payout);
      plinkoPushHistory(mult);
      if(mult >= 10) celebrateWin?.({ mult, payout, anchorEl: document.getElementById('plk-bin-' + rights) });
      if(typeof trackChallenge === 'function') trackChallenge('plinko_land', { mult, payout, bet });
      return;
    }
    // Normal auto: the visual ball still falls and credits on landing,
    // but mark it so plinkoLand doesn't double-report to the engine.
  }
  const g = plkGeom;
  plkBalls.push({
    bet,
    path,
    silent: !!opts.turbo,
    row: -1,                       // last row bounced off
    x: g.cx, y: 6,
    vx: 0, vy: 0,
    rights: 0,
    hue: 40 + Math.random() * 20,  // gold-ish, slight variety
    squash: 0,
    trail: [],                     // recent positions for the motion streak
    done: false,
  });
  if(!plkRAF) plkRAF = requestAnimationFrame(plinkoTick);
}

function plinkoAdjustBet(mult){
  const inp = document.getElementById('plk-bet');
  inp.value = Math.max(1, Math.round(parseFloat(inp.value || 1) * mult));
  playSound?.('click');
}

/* ---------- Simulation ---------- */
const PLK_GRAVITY = 1350;   // px/s^2
let plkLastT = 0;
let plkPegSoundAt = 0;

function plinkoTick(now){
  if(!plkLastT) plkLastT = now;
  const dt = Math.min(0.032, (now - plkLastT) / 1000);
  plkLastT = now;
  const g = plkGeom;

  for(const b of plkBalls){
    if(b.done) continue;
    b.vy += PLK_GRAVITY * dt;
    b.y += b.vy * dt;
    b.x += b.vx * dt;
    b.vx *= (1 - 2.2 * dt); // horizontal drag
    if(b.squash > 0) b.squash = Math.max(0, b.squash - dt * 5);
    b.trail.push({ x: b.x, y: b.y });
    if(b.trail.length > 7) b.trail.shift();

    const nextRow = b.row + 1;
    if(nextRow < plkRows){
      const rowY = g.pegs[nextRow][0].y;
      if(b.y >= rowY - g.ballR){
        // bounce off the peg this ball is guided to
        b.row = nextRow;
        const dir = b.path[nextRow];             // 0 left, 1 right
        b.rights += dir;
        // peg the ball notionally hits: between previous slots
        const count = nextRow + 3;
        const pegIdx = Math.max(0, Math.min(count - 1, b.rights + 1));
        const key = nextRow + ',' + pegIdx;
        plkPegGlow[key] = 1;
        b.y = rowY - g.ballR;
        b.vy = -PLK_GRAVITY * 0.055 * (0.7 + Math.random() * 0.5); // little hop
        b.vx = (dir === 1 ? 1 : -1) * (g.spacing / 2) / 0.18 * (0.9 + Math.random() * 0.2);
        b.squash = 1;
        if(now - plkPegSoundAt > 40){ playSound?.('ball'); plkPegSoundAt = now; }
      }
    } else {
      // past the last peg row — settle into the bin
      const binY = g.h - 8;
      const binX = g.cx + (b.rights - plkRows / 2) * g.spacing;
      b.x += (binX - b.x) * Math.min(1, 8 * dt);
      if(b.y >= binY - g.ballR){
        b.done = true;
        plinkoLand(b);
      }
    }
    // guide x toward the ideal offset for its progress (keeps it physical but on-rails)
    if(b.row >= 0 && b.row < plkRows - 1){
      const idealX = g.cx + (b.rights - (b.row + 1) / 2) * g.spacing;
      b.x += (idealX - b.x) * Math.min(1, 5 * dt);
    }
  }

  // decay peg glow
  for(const k in plkPegGlow){
    plkPegGlow[k] -= dt * 3;
    if(plkPegGlow[k] <= 0) delete plkPegGlow[k];
  }

  plkBalls = plkBalls.filter(b => !b.done);
  drawPlinko();

  if(plkBalls.length || Object.keys(plkPegGlow).length){
    plkRAF = requestAnimationFrame(plinkoTick);
  } else {
    plkRAF = null;
    plkLastT = 0;
  }
}

function plinkoLand(ball){
  const table = plinkoTable(plkRows, plkRisk);
  const bin = Math.max(0, Math.min(table.length - 1, ball.rights));
  const mult = table[bin];
  const payout = +(ball.bet * mult).toFixed(2);
  if(payout > 0) adjustBalance(payout);
  PLGraph?.roundSettled(ball.bet, payout);

  const binEl = document.getElementById('plk-bin-' + bin);
  if(binEl){
    binEl.classList.remove('hit'); void binEl.offsetWidth; binEl.classList.add('hit');
    if(mult >= 2) particleBurstAtEl?.(binEl, { count: mult >= 10 ? 38 : 18, spread: mult >= 10 ? 140 : 90 });
    if(payout > ball.bet) floatWin?.(binEl, `+${payout.toFixed(2)}`, 'win');
  }
  playSound?.('land');
  if(mult >= 10){
    celebrateWin?.({ mult, payout, anchorEl: binEl });
  } else if(payout > ball.bet){
    playSound?.('gem');
  }

  plinkoPushHistory(mult);

  if(typeof trackChallenge === 'function') trackChallenge('plinko_land', { mult, payout, bet: ball.bet });
}

function plinkoPushHistory(mult){
  plkHistory.unshift(mult);
  plkHistory = plkHistory.slice(0, 14);
  const h = document.getElementById('plk-history');
  if(h) h.innerHTML = plkHistory.map(m =>
    `<span class="${m >= 10 ? 'hi' : m >= 2 ? 'mid' : m < 1 ? 'lo' : ''}">${m}x</span>`).join('');
}

/* ---------- Drawing ---------- */
function drawPlinko(){
  if(!plkCtx || !plkGeom) return;
  const ctx = plkCtx, g = plkGeom;
  ctx.setTransform(plkDPR, 0, 0, plkDPR, 0, 0);
  ctx.clearRect(0, 0, g.w, g.h);

  // pegs — layered halo when hot, soft steel dot at rest
  for(let r = 0; r < g.pegs.length; r++){
    for(let c = 0; c < g.pegs[r].length; c++){
      const p = g.pegs[r][c];
      const glow = plkPegGlow[r + ',' + c] || 0;
      if(glow > 0){
        // wide soft halo
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, g.pegR + 14 * glow);
        halo.addColorStop(0, `rgba(255,225,140,${0.55 * glow})`);
        halo.addColorStop(0.5, `rgba(242,185,12,${0.28 * glow})`);
        halo.addColorStop(1, 'rgba(242,185,12,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, g.pegR + 14 * glow, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, g.pegR, 0, Math.PI * 2);
      ctx.fillStyle = glow > 0 ? '#ffe9a3' : 'rgba(210,200,235,0.45)';
      ctx.fill();
      // tiny top-light highlight for depth
      ctx.beginPath();
      ctx.arc(p.x - g.pegR*0.28, p.y - g.pegR*0.28, g.pegR*0.38, 0, Math.PI * 2);
      ctx.fillStyle = glow > 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  }

  // balls — motion trail, drop shadow, glossy sphere
  for(const b of plkBalls){
    // trail streak
    for(let i = 0; i < b.trail.length; i++){
      const tpos = b.trail[i];
      const a = (i + 1) / b.trail.length;
      ctx.beginPath();
      ctx.arc(tpos.x, tpos.y, g.ballR * (0.35 + 0.5 * a), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${b.hue}, 92%, 60%, ${0.10 * a})`;
      ctx.fill();
    }
    // soft shadow beneath for depth
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + g.ballR * 1.15, g.ballR * 0.9, g.ballR * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    const squashY = 1 - b.squash * 0.3;
    const squashX = 1 + b.squash * 0.3;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(squashX, squashY);
    const grad = ctx.createRadialGradient(-g.ballR*0.32, -g.ballR*0.32, 1, 0, 0, g.ballR);
    grad.addColorStop(0, '#fff8dc');
    grad.addColorStop(0.45, `hsl(${b.hue}, 94%, 56%)`);
    grad.addColorStop(1, `hsl(${b.hue - 12}, 90%, 34%)`);
    ctx.beginPath();
    ctx.arc(0, 0, g.ballR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(242,185,12,0.65)';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    // specular dot
    ctx.beginPath();
    ctx.arc(-g.ballR*0.32, -g.ballR*0.36, g.ballR*0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
  }
}
