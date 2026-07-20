/* ============ MINES ============ */
const MINES_TOTAL_TILES = 25;
const MINES_HOUSE_EDGE = 0.99; // industry-standard ~1% edge → ~99% RTP
let minesBet = 0;
let minesCount = 5;
let minesBoard = []; // true = mine
let minesRevealed = [];
let minesActive = false;
let minesSafeClicks = 0;
let minesCurrentMultiplier = 1;
let minesAuto = null;        // AutoPlay controller
let minesRoundCtx = null;    // { auto } while an engine round is on the board
let minesAutoTimer = null;   // reveal cadence for animated auto rounds

function initMines(){
  const grid = document.getElementById('mines-grid');
  if(!grid) return;
  buildMinesBoard();
  const select = document.getElementById('mines-count');
  select.innerHTML = '';
  for(let i=1;i<=24;i++){
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i + (i===1?' mine':' mines');
    if(i===5) opt.selected = true;
    select.appendChild(opt);
  }
  select.onchange = () => { minesCount = parseInt(select.value); };

  // Auto reveal-count select (clamped to the safe-tile count at run time)
  const autoSel = document.getElementById('mines-auto-tiles');
  if(autoSel && !autoSel.dataset.built){
    autoSel.dataset.built = '1';
    autoSel.innerHTML = Array.from({length: 24}, (_, i) =>
      `<option value="${i+1}" ${i+1 === 3 ? 'selected' : ''}>${i+1} tile${i ? 's' : ''}</option>`).join('');
  }

  /* ---- Auto Bet engine ----
     Each auto round: start a fresh board, reveal N random tiles,
     cash out if still alive. Turbo does the same math headlessly. */
  if(!minesAuto && typeof AutoPlay !== 'undefined'){
    minesAuto = AutoPlay.create({
      id: 'mines',
      mount: document.getElementById('mines-auto-mount'),
      betInputId: 'mines-bet',
      delay: 220, turboDelay: 30,
      turbo: true, presets: true,
      onStop: () => clearTimeout(minesAutoTimer),
      playRound: (ctx) => minesAutoRound(ctx),
    });
    AutoPlay.attachMeta('view-mines', { game: 'Mines', rtp: '~99%', edge: '~1%' });
  }
}

function minesAutoRevealTarget(){
  const want = parseInt(document.getElementById('mines-auto-tiles')?.value) || 3;
  return Math.min(want, MINES_TOTAL_TILES - minesCount); // never ask for more than exists
}

function minesAutoRound(ctx){
  const bet = parseFloat(document.getElementById('mines-bet').value);
  if(!bet || bet <= 0) return minesAuto.abort('Invalid bet');
  minesCount = parseInt(document.getElementById('mines-count').value);
  const target = minesAutoRevealTarget();

  if(ctx.turbo){
    // Headless: shuffle the field, peek at the first `target` tiles.
    if(!takeBet(bet)) return minesAuto.abort('Balance too low');
    AutoPlay?.bumpNonce();
    const field = Array.from({length: MINES_TOTAL_TILES}, (_, i) => i < minesCount); // true = mine
    for(let i = field.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [field[i], field[j]] = [field[j], field[i]];
    }
    const hitMine = field.slice(0, target).some(Boolean);
    let payout = 0, mult = 0;
    if(!hitMine){
      let cum = 1, tiles = MINES_TOTAL_TILES, safe = MINES_TOTAL_TILES - minesCount;
      for(let k = 0; k < target; k++){ cum *= tiles / safe; tiles--; safe--; }
      mult = cum * MINES_HOUSE_EDGE;
      payout = +(bet * mult).toFixed(2);
      adjustBalance(payout);
      if(mult >= 10) celebrateWin?.({ mult, payout, anchorEl: document.getElementById('mines-current-mult') });
    }
    PLGraph?.roundSettled(bet, payout);
    minesAuto.roundResolved({ bet, payout, mult });
    return;
  }

  // Animated: play the real board with a quick reveal cadence.
  minesRoundCtx = { auto: true, target };
  minesStart({ auto: true });
  if(!minesActive){ minesRoundCtx = null; return; } // start failed → already aborted
  minesAutoStep();
}

function minesAutoStep(){
  if(!minesActive || !minesRoundCtx) return;
  if(minesSafeClicks >= minesRoundCtx.target) return minesCashOut();
  // pick a random unrevealed tile
  const hidden = [];
  for(let i = 0; i < MINES_TOTAL_TILES; i++) if(!minesRevealed[i]) hidden.push(i);
  const pick = hidden[Math.floor(Math.random() * hidden.length)];
  minesReveal(pick, true);
  if(minesActive) minesAutoTimer = setTimeout(minesAutoStep, 130);
}

function buildMinesBoard(render=true){
  const grid = document.getElementById('mines-grid');
  grid.innerHTML = '';
  for(let i=0;i<MINES_TOTAL_TILES;i++){
    const tile = document.createElement('div');
    tile.className = 'mine-tile';
    tile.dataset.i = i;
    tile.onclick = () => minesReveal(i);
    grid.appendChild(tile);
  }
}

function nextStepMultiplier(safeRemainingBefore, tilesRemainingBefore){
  return tilesRemainingBefore / safeRemainingBefore;
}

function renderMinesMultRow(){
  const row = document.getElementById('mines-mult-row');
  let tilesRemaining = MINES_TOTAL_TILES;
  let safeRemaining = MINES_TOTAL_TILES - minesCount;
  let cumulative = 1;
  const steps = [];
  const maxSafe = MINES_TOTAL_TILES - minesCount;
  for(let k=1;k<=Math.min(maxSafe, 10); k++){
    cumulative *= nextStepMultiplier(safeRemaining, tilesRemaining);
    tilesRemaining--; safeRemaining--;
    steps.push((cumulative * MINES_HOUSE_EDGE).toFixed(2));
  }
  row.innerHTML = steps.map((s,idx) => `<div class="step ${idx < minesSafeClicks ? 'done' : ''}">${s}x</div>`).join('');
}

function minesStart(opts = {}){
  if(minesActive) return;
  if(minesAuto?.isRunning() && !opts.auto) return; // engine owns the board while running
  minesBet = parseFloat(document.getElementById('mines-bet').value);
  if(!minesBet || minesBet <= 0){
    if(opts.auto) return minesAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  minesCount = parseInt(document.getElementById('mines-count').value);
  if(!takeBet(minesBet)){
    if(opts.auto) minesAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  playSound?.('bet');

  minesActive = true;
  minesSafeClicks = 0;
  minesCurrentMultiplier = 1;
  minesRevealed = new Array(MINES_TOTAL_TILES).fill(false);

  const minePositions = new Set();
  while(minePositions.size < minesCount){
    minePositions.add(Math.floor(Math.random()*MINES_TOTAL_TILES));
  }
  minesBoard = Array.from({length:MINES_TOTAL_TILES}, (_,i) => minePositions.has(i));

  buildMinesBoard();
  renderMinesMultRow();
  document.getElementById('mines-result').className = 'result-banner';
  document.getElementById('mines-current-mult').textContent = '1.00x';
  document.getElementById('mines-cashout').disabled = true;
  document.getElementById('mines-start').disabled = true;
  document.getElementById('mines-count').disabled = true;
}

function minesReveal(i, fromEngine = false){
  if(!minesActive || minesRevealed[i]) return;
  if(minesRoundCtx?.auto && !fromEngine) return; // board is the engine's during auto rounds
  minesRevealed[i] = true;
  const tile = document.querySelector(`.mine-tile[data-i="${i}"]`);

  if(minesBoard[i]){
    tile.classList.add('revealed','bomb');
    tile.textContent = '💣';
    playSound?.('bomb');
    screenShake?.('med');
    particleBurstAtEl?.(tile, { count: 20, colors:['#ff4d6d','#ffb199','#f2b90c'], spread: 80 });
    endMinesRound(false);
    return;
  }

  tile.classList.add('revealed','gem');
  tile.textContent = '💎';
  playSound?.('gem');
  popEl?.(tile);
  particleBurstAtEl?.(tile, { count: 8, colors:['#2dd4bf','#8b5cf6','#f7d264'], spread: 45, size: 5 });
  minesSafeClicks++;

  const tilesRemainingBefore = MINES_TOTAL_TILES - (minesSafeClicks - 1) - countRevealedBombsBefore();
  const safeRemainingBefore = (MINES_TOTAL_TILES - minesCount) - (minesSafeClicks - 1);
  minesCurrentMultiplier *= nextStepMultiplier(safeRemainingBefore, tilesRemainingBefore) ;
  const displayMult = minesCurrentMultiplier * MINES_HOUSE_EDGE;
  const multEl = document.getElementById('mines-current-mult');
  multEl.textContent = displayMult.toFixed(2) + 'x';
  popEl?.(multEl);
  multEl.classList.toggle('blazing', displayMult >= 5);
  renderMinesMultRow();
  document.getElementById('mines-cashout').disabled = false;

  const maxSafe = MINES_TOTAL_TILES - minesCount;
  if(minesSafeClicks >= maxSafe){
    endMinesRound(true, true);
  }
}
function countRevealedBombsBefore(){ return 0; } // no bombs revealed if still active

function minesCashOut(){
  if(!minesActive || minesSafeClicks === 0) return;
  endMinesRound(true);
}

function endMinesRound(won, clearedAll=false){
  minesActive = false;
  document.getElementById('mines-cashout').disabled = true;
  document.getElementById('mines-start').disabled = false;
  document.getElementById('mines-count').disabled = false;

  // reveal remaining board
  minesBoard.forEach((isMine, i) => {
    const tile = document.querySelector(`.mine-tile[data-i="${i}"]`);
    if(!minesRevealed[i]){
      tile.classList.add('faded');
      if(isMine){ tile.classList.add('revealed','bomb'); tile.textContent = '💣'; }
      else { tile.classList.add('revealed','gem'); tile.textContent = '💎'; }
    }
  });

  const banner = document.getElementById('mines-result');
  if(won){
    const mult = minesCurrentMultiplier * MINES_HOUSE_EDGE;
    const payout = +(minesBet * mult).toFixed(2);
    adjustBalance(payout);
    banner.textContent = clearedAll
      ? `Board cleared! Cashed out @ ${mult.toFixed(2)}x — +${payout.toFixed(2)} ${currency}`
      : `Cashed out @ ${mult.toFixed(2)}x — +${payout.toFixed(2)} ${currency}`;
    banner.className = 'result-banner win';
    celebrateWin?.({ mult, payout, anchorEl: document.getElementById('mines-current-mult') });
    if(clearedAll && mult < 10) screenShake?.('med');
    if(typeof trackChallenge === 'function') trackChallenge('mines_cashout', { multiplier: mult, payout, clearedAll });
  } else {
    banner.textContent = `Hit a mine — lost ${minesBet.toFixed(2)} ${currency}.`;
    banner.className = 'result-banner lose';
    playSound?.('lose');
  }

  PLGraph?.roundSettled(minesBet, won ? +(minesBet * minesCurrentMultiplier * MINES_HOUSE_EDGE).toFixed(2) : 0);

  // Settle the engine's round
  if(minesRoundCtx?.auto){
    const mult = won ? minesCurrentMultiplier * MINES_HOUSE_EDGE : 0;
    const payout = won ? +(minesBet * mult).toFixed(2) : 0;
    minesRoundCtx = null;
    clearTimeout(minesAutoTimer);
    minesAuto?.roundResolved({ bet: minesBet, payout, mult });
  }
}
