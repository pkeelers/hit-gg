/* ============================================================
   DICE — roll a number 0.00–100.00, bet Over or Under a target.
   Win chance is fully player-controlled via the slider, and the
   multiplier is derived from it (99 / chance → 1% house edge).

   // TODO: Backend — replace Math.random() with provably-fair
   // server-seeded rolls (serverSeed + clientSeed + nonce → HMAC),
   // and settle bets server-side.
   ============================================================ */

const DICE_EDGE_RTP = 99; // multiplier numerator: 99 / winChance
let diceMode = 'over';    // 'over' | 'under'
let diceTarget = 50;      // slider value 2..98
let diceBusy = false;
let diceLastRolls = [];
let diceAuto = null;        // AutoPlay controller
let diceRoundCtx = null;    // { auto, turbo } for the round in flight

function initDice(){
  const slider = document.getElementById('dice-slider');
  if(!slider) return;
  slider.value = diceTarget;
  slider.oninput = () => {
    diceTarget = parseInt(slider.value, 10);
    playSound?.('tick');
    diceUpdateStats();
  };
  // Space = roll again while the Dice view is open (skips typing fields)
  if(!initDice._keysBound){
    initDice._keysBound = true;
    document.addEventListener('keydown', (e) => {
      if(e.code !== 'Space') return;
      if(!document.getElementById('view-dice')?.classList.contains('active')) return;
      if(/^(input|select|textarea)$/i.test(document.activeElement?.tagName || '')) return;
      e.preventDefault();
      diceRoll();
    });
  }
  diceUpdateStats();

  /* ---- Auto Bet engine (shared, see js/autoplay.js) ----
     Quick-strategy Martingale / Paroli buttons live inside the
     panel as bet-progression presets. */
  if(!diceAuto && typeof AutoPlay !== 'undefined'){
    diceAuto = AutoPlay.create({
      id: 'dice',
      mount: document.getElementById('dice-auto-mount'),
      betInputId: 'dice-bet',
      delay: 140, turboDelay: 25,
      turbo: true, presets: true,
      playRound: (ctx) => diceRoll({ auto: true, turbo: ctx.turbo }),
    });
    AutoPlay.attachMeta('view-dice', { game: 'Dice', rtp: '99%', edge: '1%' });
  }
}

function diceWinChance(){
  // Over X wins on results strictly above X; Under X strictly below.
  return diceMode === 'over' ? (100 - diceTarget) : diceTarget;
}
function diceMultiplier(){
  return +(DICE_EDGE_RTP / diceWinChance()).toFixed(4);
}

function diceSetMode(mode){
  if(diceBusy) return;
  diceMode = mode;
  playSound?.('click');
  document.querySelectorAll('.dice-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  diceUpdateStats();
}

function diceAdjustBet(mult){
  const inp = document.getElementById('dice-bet');
  inp.value = Math.max(1, Math.round(parseFloat(inp.value || 1) * mult));
  diceUpdateStats();
}

function diceUpdateStats(){
  const chance = diceWinChance();
  const mult = diceMultiplier();
  const bet = parseFloat(document.getElementById('dice-bet')?.value || 0) || 0;

  document.getElementById('dice-chance').textContent = chance.toFixed(0) + '%';
  const multEl = document.getElementById('dice-mult');
  multEl.textContent = mult.toFixed(mult >= 10 ? 1 : 2) + 'x';
  multEl.classList.toggle('hot', mult >= 5);
  multEl.classList.toggle('blazing', mult >= 20);
  document.getElementById('dice-payout').textContent = (bet * mult).toFixed(2);
  document.getElementById('dice-target-label').textContent =
    (diceMode === 'over' ? 'Roll over ' : 'Roll under ') + diceTarget;

  // Paint the win zone on the track
  const zone = document.getElementById('dice-zone');
  if(diceMode === 'over'){
    zone.style.left = diceTarget + '%';
    zone.style.width = (100 - diceTarget) + '%';
  } else {
    zone.style.left = '0%';
    zone.style.width = diceTarget + '%';
  }
}

function diceRoll(opts = {}){
  if(diceBusy) return;
  if(diceAuto?.isRunning() && !opts.auto) return; // engine owns the button while running
  diceRoundCtx = opts;
  const bet = parseFloat(document.getElementById('dice-bet').value);
  if(!bet || bet <= 0){
    if(opts.auto) return diceAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(!takeBet(bet)){
    if(opts.auto) diceAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();

  diceBusy = true;
  if(!opts.turbo) playSound?.('bet');
  document.getElementById('dice-roll-btn').disabled = true;
  const banner = document.getElementById('dice-result-banner');
  banner.className = 'result-banner';

  // The outcome is decided up front; the animation just performs it.
  // TODO: Backend — this roll comes from the provably-fair endpoint.
  const result = +(Math.random() * 100).toFixed(2);
  const win = diceMode === 'over' ? result > diceTarget : result < diceTarget;
  const mult = diceMultiplier();
  const payout = win ? +(bet * mult).toFixed(2) : 0;

  // TURBO — no scramble, no snap choreography: paint + settle now.
  if(opts.turbo){
    const readout = document.getElementById('dice-readout');
    const marker = document.getElementById('dice-marker');
    readout.className = 'dice-readout';
    readout.textContent = result.toFixed(2);
    marker.classList.remove('scrambling','jump','won','lost');
    marker.style.left = result + '%';
    diceSettle({ bet, result, win, mult, payout });
    return;
  }

  // Instant roll: ~190ms of pure scramble, then a hard SNAP to the
  // final number — readout flick-scales in, marker leaps to the spot.
  // No long counting animation; the drama is in the snap itself.
  const readout = document.getElementById('dice-readout');
  const marker = document.getElementById('dice-marker');
  readout.className = 'dice-readout rolling';
  marker.classList.add('scrambling');
  marker.classList.remove('jump','won','lost');
  const DURATION = 190;
  const start = performance.now();
  let frameCount = 0;

  function frame(now){
    const t = (now - start) / DURATION;
    if(t < 1){
      const fake = Math.random() * 100;
      readout.textContent = fake.toFixed(2);
      marker.style.left = fake + '%';
      if((frameCount++ & 1) === 0) playSound?.('tick');
      requestAnimationFrame(frame);
    } else {
      // THE SNAP — land the real number with a flick
      readout.textContent = result.toFixed(2);
      readout.classList.remove('rolling');
      readout.classList.add('snap');
      marker.classList.remove('scrambling');
      marker.style.left = result + '%';
      marker.classList.add('jump');
      playSound?.('snap');
      diceSettle({ bet, result, win, mult, payout });
    }
  }
  requestAnimationFrame(frame);
}

function diceSettle({ bet, result, win, mult, payout }){
  const readout = document.getElementById('dice-readout');
  const marker = document.getElementById('dice-marker');
  const banner = document.getElementById('dice-result-banner');

  // Keep the snap flick running; layer the win/lose color on top
  readout.classList.add(win ? 'won' : 'lost');
  marker.classList.toggle('won', win);
  marker.classList.toggle('lost', !win);
  if(!diceRoundCtx?.turbo) playSound?.('land');

  const turbo = !!diceRoundCtx?.turbo;
  if(win){
    adjustBalance(payout);
    banner.textContent = `Rolled ${result.toFixed(2)} — won ${payout.toFixed(2)} ${currency} (${mult.toFixed(2)}x)`;
    banner.className = 'result-banner win';
    if(!turbo){
      particleBurstAtEl?.(readout, { count: mult >= 10 ? 42 : 24, spread: 130 });
      celebrateWin?.({ mult, payout, anchorEl: readout });
    } else if(mult >= 20){
      // even in turbo, a monster hit deserves the overlay
      celebrateWin?.({ mult, payout, anchorEl: readout });
    }
  } else {
    banner.textContent = `Rolled ${result.toFixed(2)} — no win.`;
    banner.className = 'result-banner lose';
    if(!turbo){
      // Near-miss sting: a small shake when you lose by under 2.00
      const missBy = diceMode === 'over' ? (diceTarget - result) : (result - diceTarget);
      if(missBy >= 0 && missBy < 2) screenShake?.('med');
      playSound?.('lose');
    }
  }

  PLGraph?.roundSettled(bet, payout);

  diceLastRolls.unshift({ result, win, mult });
  diceLastRolls = diceLastRolls.slice(0, 12);
  renderDiceHistory();

  if(typeof trackChallenge === 'function')
    trackChallenge('dice_roll', { win, mult: win ? mult : 0, payout, bet, result });

  // Instant re-bet: unlock immediately, no cooldown
  diceBusy = false;

  // Hand the settled round back to the Auto engine (it sequences the next one)
  if(diceRoundCtx?.auto) diceAuto?.roundResolved({ bet, payout, mult: win ? mult : 0 });
  diceRoundCtx = null;
  const btn = document.getElementById('dice-roll-btn');
  btn.disabled = false;
  btn.textContent = 'Roll Again';

  // Clear the one-shot animation classes so the next snap replays
  setTimeout(() => { readout.classList.remove('snap'); marker.classList.remove('jump'); }, 380);
}

function renderDiceHistory(){
  const el = document.getElementById('dice-history');
  if(!el) return;
  el.innerHTML = diceLastRolls.map(r =>
    `<span class="dice-hist ${r.win ? 'w' : 'l'} mono">${r.result.toFixed(2)}</span>`
  ).join('');
}
