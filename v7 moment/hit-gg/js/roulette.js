/* ============================================================
   ROULETTE — European single-zero wheel. Place chips on the
   table (straight numbers, red/black, odd/even, low/high,
   dozens), then spin. Canvas wheel with an orbiting ball that
   decays into the winning pocket; the outcome is decided up
   front and the animation lands there exactly.

   Payouts include stake:
     straight 36x · dozens 3x · even-money bets 2x

   // TODO: Backend — winning number must come from a certified
   // server RNG (or live wheel feed); bets settle server-side.
   ============================================================ */

/* Physical pocket order on a European wheel, clockwise from 0 */
const RL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RL_REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const RL_CHIP_DENOMS = [1, 5, 25, 100, 500];

let rlChip = 25;                 // selected chip value
let rlBets = {};                 // spotKey -> amount
let rlSpinning = false;
let rlAngle = 0;                 // current wheel rotation (radians)
let rlHistory = [];
let rlCanvas, rlCtx;
let rlAuto = null;       // AutoPlay controller
let rlRoundCtx = null;   // { auto, turbo } for the spin in flight

/* ---------- Bet spots ---------- */
function rlSpotWins(key, n){
  if(key.startsWith('n')) return parseInt(key.slice(1), 10) === n;
  if(n === 0) return false; // zero beats all outside bets
  switch(key){
    case 'red':   return RL_REDS.has(n);
    case 'black': return !RL_REDS.has(n);
    case 'odd':   return n % 2 === 1;
    case 'even':  return n % 2 === 0;
    case 'low':   return n <= 18;
    case 'high':  return n >= 19;
    case 'd1':    return n <= 12;
    case 'd2':    return n >= 13 && n <= 24;
    case 'd3':    return n >= 25;
  }
  return false;
}
function rlSpotMult(key){
  if(key.startsWith('n')) return 36;
  return key.startsWith('d') ? 3 : 2;
}

/* ---------- Setup ---------- */
function initRouletteAuto(){
  /* ---- Auto Bet engine ----
     Auto re-spins whatever is on the table. The hidden #rl-auto-bet
     field mirrors the total stake so the engine's progressions
     (Martingale etc.) work: when the engine rewrites it after a
     round, every chip on the table is scaled proportionally. */
  if(rlAuto || typeof AutoPlay === 'undefined') return;
  rlAuto = AutoPlay.create({
    id: 'roulette',
    mount: document.getElementById('rl-auto-mount'),
    betInputId: 'rl-auto-bet',
    delay: 200, turboDelay: 40,
    turbo: true, presets: true,
    playRound: (ctx) => rlAutoRound(ctx),
  });
  AutoPlay.attachMeta('view-roulette', { game: 'Roulette', rtp: '97.3%', edge: '2.7%' });

  const hidden = document.getElementById('rl-auto-bet');
  hidden?.addEventListener('input', () => {
    // Engine progression changed the target total — rescale the layout.
    const current = rlTotalBet();
    const wanted = parseFloat(hidden.value) || 0;
    if(current <= 0 || wanted <= 0 || Math.abs(wanted - current) < 0.01) return;
    const ratio = wanted / current;
    for(const k of Object.keys(rlBets)) rlBets[k] = Math.max(1, Math.round(rlBets[k] * ratio));
    rlUpdateTotals();
    rlRefreshBadges();
  });
}

function rlAutoRound(ctx){
  const total = rlTotalBet();
  if(total <= 0) return rlAuto.abort('Place chips on the table first');

  if(ctx.turbo){
    // Instant: same settlement path, no wheel choreography.
    if(!takeBet(total)) return rlAuto.abort('Balance too low');
    AutoPlay?.bumpNonce();
    rlRoundCtx = ctx;
    const winNum = RL_ORDER[Math.floor(Math.random() * RL_ORDER.length)];
    rlResolve(winNum, total);
    return;
  }
  rlSpin({ auto: true });
}

function initRoulette(){
  rlCanvas = document.getElementById('rl-wheel');
  if(!rlCanvas) return;
  rlCtx = rlCanvas.getContext('2d');
  buildRouletteTable();
  renderRlChips();
  drawWheel(rlAngle);
  rlUpdateTotals();
  initRouletteAuto();
}

function buildRouletteTable(){
  const grid = document.getElementById('rl-numbers');
  if(!grid) return;
  // Zero, then 1–36 laid out in the classic 3-row column layout
  let html = `<button class="rl-num zero" data-spot="n0" onclick="rlPlace('n0')">0<span class="rl-chip-badge" data-badge="n0"></span></button>`;
  html += '<div class="rl-num-grid">';
  for(let row = 3; row >= 1; row--){
    for(let col = 0; col < 12; col++){
      const n = col * 3 + row;
      const color = RL_REDS.has(n) ? 'red' : 'black';
      html += `<button class="rl-num ${color}" data-spot="n${n}" onclick="rlPlace('n${n}')">${n}<span class="rl-chip-badge" data-badge="n${n}"></span></button>`;
    }
  }
  html += '</div>';
  grid.innerHTML = html;

  const outside = document.getElementById('rl-outside');
  const spots = [
    ['d1','1st 12'], ['d2','2nd 12'], ['d3','3rd 12'],
    ['low','1–18'], ['even','Even'], ['red','Red'], ['black','Black'], ['odd','Odd'], ['high','19–36'],
  ];
  outside.innerHTML = spots.map(([key, label]) =>
    `<button class="rl-outside-btn ${key}" data-spot="${key}" onclick="rlPlace('${key}')">${label}<span class="rl-chip-badge" data-badge="${key}"></span></button>`
  ).join('');
}

function renderRlChips(){
  const wrap = document.getElementById('rl-chip-picker');
  if(!wrap) return;
  wrap.innerHTML = RL_CHIP_DENOMS.map(d =>
    `<button class="chip c${d} rl-pick ${d === rlChip ? 'active' : ''}" onclick="rlSetChip(${d})">${d}</button>`
  ).join('');
}
function rlSetChip(d){
  rlChip = d;
  playSound?.('click');
  renderRlChips();
}

/* ---------- Placing bets ---------- */
function rlPlace(key){
  if(rlSpinning) return;
  rlBets[key] = (rlBets[key] || 0) + rlChip;
  playSound?.('bet');
  const badge = document.querySelector(`.rl-chip-badge[data-badge="${key}"]`);
  if(badge){
    badge.textContent = rlBets[key] >= 1000 ? (rlBets[key]/1000).toFixed(1).replace('.0','') + 'k' : rlBets[key];
    badge.classList.add('on');
    popEl?.(badge);
  }
  rlUpdateTotals();
}
function rlClearBets(){
  if(rlSpinning) return;
  rlBets = {};
  playSound?.('click');
  document.querySelectorAll('.rl-chip-badge').forEach(b => { b.textContent = ''; b.classList.remove('on'); });
  rlUpdateTotals();
}
function rlTotalBet(){
  return Object.values(rlBets).reduce((s, v) => s + v, 0);
}
function rlUpdateTotals(){
  const total = rlTotalBet();
  document.getElementById('rl-total').textContent = total.toFixed(0);
  document.getElementById('rl-spin-btn').disabled = rlSpinning || total <= 0;
  // Mirror the stake for the Auto engine (its bet source + progression base)
  const hidden = document.getElementById('rl-auto-bet');
  if(hidden && document.activeElement !== hidden) hidden.value = total;
}

function rlRefreshBadges(){
  document.querySelectorAll('.rl-chip-badge').forEach(b => {
    const amt = rlBets[b.dataset.badge] || 0;
    b.textContent = amt ? (amt >= 1000 ? (amt/1000).toFixed(1).replace('.0','') + 'k' : amt) : '';
    b.classList.toggle('on', amt > 0);
  });
}

/* ---------- Wheel drawing ---------- */
function drawWheel(angle, ball = null){
  const ctx = rlCtx;
  const W = rlCanvas.width, H = rlCanvas.height;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 6;
  const seg = (Math.PI * 2) / RL_ORDER.length;

  ctx.clearRect(0, 0, W, H);

  // Outer rim
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2c14';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f2b90c';
  ctx.stroke();

  // Pockets — angle 0 points straight up (pointer position)
  for(let i = 0; i < RL_ORDER.length; i++){
    const n = RL_ORDER[i];
    const a0 = angle + i * seg - seg / 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = n === 0 ? '#0f8a5f' : (RL_REDS.has(n) ? '#c22b3f' : '#1b1428');
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,185,12,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Number label
    const mid = a0 + seg / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * (R - Math.max(16, R * 0.095)), cy + Math.sin(mid) * (R - Math.max(16, R * 0.095)));
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillStyle = '#f5edd8';
    ctx.font = `bold ${Math.max(11, Math.round(R * 0.072))}px "Manrope", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n, 0, 0);
    ctx.restore();
  }

  // Hub
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#221936';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8b5cf6';
  ctx.stroke();
  ctx.fillStyle = '#f2b90c';
  ctx.font = `800 ${Math.max(15, Math.round(R * 0.095))}px "Manrope", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HIT.GG', cx, cy);

  // Ball
  if(ball){
    const bx = cx + Math.cos(ball.angle - Math.PI / 2) * ball.radius;
    const by = cy + Math.sin(ball.angle - Math.PI / 2) * ball.radius;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(6, R * 0.036), 0, Math.PI * 2);
    ctx.fillStyle = '#f7f3e8';
    ctx.shadowColor = '#f2b90c';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Pointer at top
  ctx.beginPath();
  ctx.moveTo(cx - 9, 2);
  ctx.lineTo(cx + 9, 2);
  ctx.lineTo(cx, 20);
  ctx.closePath();
  ctx.fillStyle = '#f2b90c';
  ctx.fill();
}

/* ---------- Spin ---------- */
function rlSpin(opts = {}){
  if(rlSpinning) return;
  if(rlAuto?.isRunning() && !opts.auto) return; // engine owns the wheel while running
  rlRoundCtx = opts;
  const total = rlTotalBet();
  if(total <= 0){
    if(opts.auto) rlAuto.abort('No chips on the table');
    return;
  }
  if(!takeBet(total)){
    if(opts.auto) rlAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  rlSpinning = true;
  playSound?.('bet');
  document.getElementById('rl-spin-btn').disabled = true;
  document.getElementById('rl-result').className = 'result-banner';
  document.querySelectorAll('.rl-num.winner').forEach(el => el.classList.remove('winner'));

  // Outcome decided up front.
  // TODO: Backend — winning number from server RNG.
  const winIdx = Math.floor(Math.random() * RL_ORDER.length);
  const winNum = RL_ORDER[winIdx];

  // The wheel must stop with pocket winIdx at the top pointer:
  // pocket i sits at pointer when angle ≡ -i·seg (mod 2π).
  const seg = (Math.PI * 2) / RL_ORDER.length;
  const targetAngle = -winIdx * seg;
  const current = rlAngle % (Math.PI * 2);
  const spins = 5; // full revolutions for drama
  let delta = targetAngle - current;
  while(delta <= 0) delta += Math.PI * 2;
  const finalAngle = rlAngle + delta + spins * Math.PI * 2;

  const DURATION = rlRoundCtx?.auto ? 1600 : 3900; // auto keeps the drama short
  const start = performance.now();
  const startAngle = rlAngle;
  const R = Math.min(rlCanvas.width, rlCanvas.height) / 2 - 6;
  let lastTickPocket = -1;

  function frame(now){
    const t = Math.min(1, (now - start) / DURATION);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
    rlAngle = startAngle + (finalAngle - startAngle) * ease;

    // Ball: orbits against the wheel early, decays inward, and
    // glides onto the winning pocket for the final stretch.
    let ball;
    if(t < 0.72){
      const ballEase = 1 - Math.pow(1 - t / 0.72, 2);
      ball = {
        angle: -ballEase * Math.PI * 10 - rlAngle * 0.15,
        radius: R - 14 - (R * 0.18) * ballEase,
      };
    } else {
      // Locked to the winning pocket as the wheel settles
      const settle = (t - 0.72) / 0.28;
      ball = {
        angle: rlAngle + winIdx * seg,
        radius: (R - 14 - R * 0.18) - (R * 0.10) * settle,
      };
    }
    drawWheel(rlAngle, ball);

    // Tick as pockets pass the pointer, slowing with the wheel
    const pocketAtPointer = Math.floor(((-rlAngle % (Math.PI*2)) + Math.PI*2) / seg) % RL_ORDER.length;
    if(pocketAtPointer !== lastTickPocket){
      lastTickPocket = pocketAtPointer;
      if(t < 0.95) playSound?.('tick');
    }

    if(t < 1) requestAnimationFrame(frame);
    else rlResolve(winNum, total);
  }
  requestAnimationFrame(frame);
}

function rlResolve(winNum, totalBet){
  playSound?.('land');

  let payout = 0;
  const winningSpots = [];
  for(const [key, amt] of Object.entries(rlBets)){
    if(rlSpotWins(key, winNum)){
      payout += amt * rlSpotMult(key);
      winningSpots.push(key);
    }
  }
  payout = +payout.toFixed(2);

  // History pill strip
  rlHistory.unshift(winNum);
  rlHistory = rlHistory.slice(0, 14);
  const hist = document.getElementById('rl-history');
  if(hist) hist.innerHTML = rlHistory.map(n =>
    `<span class="rl-hist mono ${n === 0 ? 'green' : (RL_REDS.has(n) ? 'red' : 'black')}">${n}</span>`
  ).join('');

  // Light up the winning number on the table
  const winEl = document.querySelector(`.rl-num[data-spot="n${winNum}"]`);
  if(winEl){
    winEl.classList.add('winner');
    popEl?.(winEl);
    particleBurstAtEl?.(winEl, { count: 12, spread: 55 });
  }

  const banner = document.getElementById('rl-result');
  const colorWord = winNum === 0 ? 'green' : (RL_REDS.has(winNum) ? 'red' : 'black');
  const turbo = !!rlRoundCtx?.turbo;
  if(payout > 0){
    adjustBalance(payout);
    const mult = payout / totalBet;
    banner.textContent = `${winNum} ${colorWord} — won ${payout.toFixed(2)} ${currency} (${mult.toFixed(2)}x)`;
    banner.className = 'result-banner win';
    winningSpots.forEach(key => {
      const el = document.querySelector(`[data-spot="${key}"]`);
      if(el) glowEl?.(el);
    });
    if(!turbo || mult >= 10) celebrateWin?.({ mult, payout, anchorEl: banner });
  } else {
    banner.textContent = `${winNum} ${colorWord} — no winning bets.`;
    banner.className = 'result-banner lose';
    if(!turbo) playSound?.('lose');
  }

  PLGraph?.roundSettled(totalBet, payout);

  if(typeof trackChallenge === 'function')
    trackChallenge('roulette_spin', {
      win: payout > 0, payout, bet: totalBet, number: winNum,
      straightHit: winningSpots.some(k => k.startsWith('n')),
    });

  // Bets stay on the table for an easy re-spin (badges persist)
  rlSpinning = false;
  rlUpdateTotals();

  // Settle the engine's spin
  if(rlRoundCtx?.auto || rlRoundCtx?.turbo){
    const mult = payout > 0 ? payout / totalBet : 0;
    rlAuto?.roundResolved({ bet: totalBet, payout, mult });
  }
  rlRoundCtx = null;
}
