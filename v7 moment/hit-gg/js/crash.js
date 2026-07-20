/* ============ CRASH ============ */
const CRASH_HOUSE_EDGE = 0.01; // industry-standard 1% edge → 99% RTP
let crashPhase = 'waiting'; // waiting | running | crashed
let crashPoint = 1;
let crashStart = 0;
let crashMultiplier = 1;
let crashPlayerBet = 0;
let crashPlayerCashed = false;
let crashPendingBet = 0;
let crashRAF = null;
let crashCountdownTimer = null;
let crashPath = [];
let crashHistory = [];
let crashAuto = null;         // AutoPlay controller
let crashAutoPending = false; // engine asked for a round mid-flight; join next round
let crashAutoRound = null;    // { bet } — the engine's stake riding the live round
let crashLastPayout = 0;      // payout recorded at cash-out for engine reporting

function generateCrashPoint(){
  if(Math.random() < CRASH_HOUSE_EDGE) return 1.00;
  const r = Math.random();
  const point = (1 - CRASH_HOUSE_EDGE) / (1 - r);
  return Math.min(point, 500); // sane cap for the demo
}

function initCrash(){
  const canvas = document.getElementById('crash-canvas');
  if(!canvas) return;
  resizeCrashCanvas();
  window.addEventListener('resize', resizeCrashCanvas);

  /* ---- Auto Bet engine ----
     Normal auto joins the live shared rounds: the engine's bet is
     placed each waiting phase and cashed by the Auto @ target.
     Turbo doesn't wait for the rocket — it settles rounds against
     freshly generated crash points instantly (pure simulation). */
  if(!crashAuto && typeof AutoPlay !== 'undefined'){
    crashAuto = AutoPlay.create({
      id: 'crash',
      mount: document.getElementById('crash-auto-mount'),
      betInputId: 'crash-bet',
      delay: 60, turboDelay: 30,
      turbo: true, presets: true,
      onStart: () => {
        // Hands-free needs a cash-out target; default to the classic 2.00x
        const auto = document.getElementById('crash-auto');
        if(!parseFloat(auto.value)){ auto.value = '2.00'; }
      },
      onStop: () => { crashAutoPending = false; },
      playRound: (ctx) => crashAutoRoundStart(ctx),
    });
    AutoPlay.attachMeta('view-crash', { game: 'Crash', rtp: '99%', edge: '1%' });
  }

  startWaitingPhase();
}

function crashAutoRoundStart(ctx){
  const bet = parseFloat(document.getElementById('crash-bet').value);
  if(!bet || bet <= 0) return crashAuto.abort('Invalid bet');
  const target = Math.max(1.01, parseFloat(document.getElementById('crash-auto').value) || 2);

  if(ctx.turbo){
    // Instant simulation — same RNG, no rocket.
    if(!takeBet(bet)) return crashAuto.abort('Balance too low');
    AutoPlay?.bumpNonce();
    const point = generateCrashPoint();
    const win = point >= target;           // auto cash-out fires the tick the target is reached
    const payout = win ? +(bet * target).toFixed(2) : 0;
    if(payout > 0) adjustBalance(payout);
    PLGraph?.roundSettled(bet, payout);
    if(win && target >= 10) celebrateWin?.({ mult: target, payout, anchorEl: document.getElementById('crash-mult') });
    crashAuto.roundResolved({ bet, payout, mult: win ? target : 0 });
    return;
  }

  // Live mode — bet into the current waiting phase, or queue for the next.
  if(crashPhase === 'waiting' && crashPlayerBet === 0){
    crashPlaceBet({ auto: true });
  } else {
    crashAutoPending = true;
  }
}
function resizeCrashCanvas(){
  const canvas = document.getElementById('crash-canvas');
  if(!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function startWaitingPhase(){
  crashPhase = 'waiting';
  crashPoint = generateCrashPoint();
  crashPlayerBet = 0;
  crashPlayerCashed = false;
  crashPath = [];
  document.getElementById('crash-mult').textContent = '1.00x';
  document.getElementById('crash-mult').classList.remove('crashed');
  document.getElementById('crash-cashout').disabled = true;
  document.getElementById('crash-bet-btn').disabled = false;
  drawCrash();

  // Engine waiting to ride this round? Place its bet now.
  if(crashAutoPending && crashAuto?.isRunning()){
    crashAutoPending = false;
    crashPlaceBet({ auto: true });
  }

  let secondsLeft = 5;
  document.getElementById('crash-status').textContent = `Next round in ${secondsLeft}s — place your bet`;
  clearInterval(crashCountdownTimer);
  crashCountdownTimer = setInterval(() => {
    secondsLeft--;
    if(secondsLeft <= 0){
      clearInterval(crashCountdownTimer);
      startRunningPhase();
    } else {
      document.getElementById('crash-status').textContent = `Next round in ${secondsLeft}s — place your bet`;
    }
  }, 1000);
}

function crashPlaceBet(opts = {}){
  if(crashAuto?.isRunning() && !opts.auto) return; // engine owns betting while running
  if(crashPhase !== 'waiting'){ if(!opts.auto) alert('Wait for the next round to place a bet.'); return; }
  const bet = parseFloat(document.getElementById('crash-bet').value);
  if(!bet || bet <= 0){
    if(opts.auto) return crashAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(crashPlayerBet > 0){ if(!opts.auto) alert('Bet already placed for this round.'); return; }
  if(!takeBet(bet)){
    if(opts.auto) crashAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  if(opts.auto) crashAutoRound = { bet };
  crashLastPayout = 0;
  crashPlayerBet = bet;
  playSound?.('bet');
  document.getElementById('crash-bet-btn').disabled = true;
  document.getElementById('crash-status').textContent += ' — bet placed ✓';
}

function startRunningPhase(){
  crashPhase = 'running';
  crashStart = performance.now();
  document.getElementById('crash-status').textContent = 'Flying…';
  document.getElementById('crash-bet-btn').disabled = true;
  document.getElementById('crash-cashout').disabled = crashPlayerBet <= 0;
  tickCrash();
}

function tickCrash(){
  const elapsed = performance.now() - crashStart;
  crashMultiplier = Math.exp(0.00012 * elapsed);

  const auto = parseFloat(document.getElementById('crash-auto').value);
  if(crashPlayerBet > 0 && !crashPlayerCashed && auto && crashMultiplier >= auto){
    crashCashOut(true);
  }

  if(crashMultiplier >= crashPoint){
    crashMultiplier = crashPoint;
    document.getElementById('crash-mult').textContent = crashMultiplier.toFixed(2) + 'x';
    drawCrash();
    return crashOut();
  }

  const multEl = document.getElementById('crash-mult');
  multEl.textContent = crashMultiplier.toFixed(2) + 'x';
  multEl.classList.toggle('hot', crashMultiplier >= 2);
  multEl.classList.toggle('blazing', crashMultiplier >= 5);
  crashPath.push(crashMultiplier);
  drawCrash();
  crashRAF = requestAnimationFrame(tickCrash);
}

function crashCashOut(isAuto=false){
  if(crashPhase !== 'running' || crashPlayerBet <= 0 || crashPlayerCashed) return;
  crashPlayerCashed = true;
  const payout = +(crashPlayerBet * crashMultiplier).toFixed(2);
  crashLastPayout = payout;
  adjustBalance(payout);
  document.getElementById('crash-cashout').disabled = true;
  document.getElementById('crash-status').textContent = `${isAuto ? 'Auto cashed' : 'Cashed out'} @ ${crashMultiplier.toFixed(2)}x — +${payout.toFixed(2)} ${currency}`;
  playSound?.('cashout');
  const multEl = document.getElementById('crash-mult');
  popEl?.(multEl); glowEl?.(multEl);
  celebrateWin?.({ mult: crashMultiplier, payout, anchorEl: document.getElementById('crash-rocket') });
  if(typeof trackChallenge === 'function') trackChallenge('crash_cashout', { multiplier: crashMultiplier, payout });
}

function crashOut(){
  cancelAnimationFrame(crashRAF);
  crashPhase = 'crashed';
  const multEl0 = document.getElementById('crash-mult');
  multEl0.classList.add('crashed');
  multEl0.classList.remove('hot','blazing');
  particleBurstAtEl?.(document.getElementById('crash-rocket'), { count: 22, colors:['#ff4d6d','#f2b90c','#ffb199'], spread: 110 });
  document.getElementById('crash-cashout').disabled = true;
  document.getElementById('crash-bet-btn').disabled = true;

  if(crashPlayerBet > 0 && !crashPlayerCashed){
    document.getElementById('crash-status').textContent = `Crashed @ ${crashPoint.toFixed(2)}x — you lost ${crashPlayerBet.toFixed(2)} ${currency}`;
    playSound?.('bomb');
    screenShake?.('med');
  } else if(!crashPlayerCashed){
    playSound?.('lose');
    document.getElementById('crash-status').textContent = `Crashed @ ${crashPoint.toFixed(2)}x`;
  }

  if(crashPlayerBet > 0)
    PLGraph?.roundSettled(crashPlayerBet, crashPlayerCashed ? crashLastPayout : 0);

  // Settle the engine's ride on this round (win = cashed before pop)
  if(crashAutoRound){
    const { bet } = crashAutoRound;
    crashAutoRound = null;
    crashAuto?.roundResolved({
      bet,
      payout: crashPlayerCashed ? crashLastPayout : 0,
      mult: crashPlayerCashed ? crashLastPayout / bet : 0,
    });
  }

  pushCrashHistory(crashPoint);
  setTimeout(startWaitingPhase, crashAuto?.isRunning() ? 1200 : 2600);
}

function pushCrashHistory(point){
  crashHistory.unshift(point);
  crashHistory = crashHistory.slice(0, 12);
  const el = document.getElementById('crash-history');
  el.innerHTML = crashHistory.map(p => `<span class="${p >= 2 ? 'hi' : (p < 1.2 ? 'lo' : '')}">${p.toFixed(2)}x</span>`).join('');
}

function drawCrash(){
  const canvas = document.getElementById('crash-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for(let i=1;i<6;i++){
    const y = h - (h/6)*i;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  if(crashPath.length < 2){
    positionRocket(20, h-20);
    return;
  }

  const maxMult = Math.max(2.2, crashMultiplier * 1.15);
  const xScale = w / Math.max(60, crashPath.length);
  const yScale = h / maxMult;

  ctx.beginPath();
  ctx.moveTo(0, h);
  crashPath.forEach((m, i) => {
    const x = i * xScale;
    const y = h - (m - 1) * yScale;
    ctx.lineTo(x, y);
  });
  const lastX = (crashPath.length-1) * xScale;
  const lastY = h - (crashPath[crashPath.length-1]-1) * yScale;
  ctx.lineTo(lastX, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, 'rgba(242,185,12,0.35)');
  grad.addColorStop(1, 'rgba(242,185,12,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  crashPath.forEach((m, i) => {
    const x = i * xScale;
    const y = h - (m - 1) * yScale;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.strokeStyle = crashPhase === 'crashed' ? '#ff4d6d' : '#f2b90c';
  ctx.lineWidth = 3;
  ctx.stroke();

  positionRocket(lastX, lastY);
}
function positionRocket(x, y){
  const rocket = document.getElementById('crash-rocket');
  if(!rocket) return;
  rocket.style.left = Math.min(x, (rocket.parentElement.clientWidth - 20)) + 'px';
  rocket.style.bottom = (rocket.parentElement.clientHeight - y) + 'px';
  rocket.textContent = crashPhase === 'crashed' ? '💥' : '🚀';
}
