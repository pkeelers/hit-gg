/* ============================================================
   TOWER — climb 8 floors, one safe pick per floor. Higher risk
   means fewer safe tiles per floor and a steeper multiplier
   ladder. Cash out any time after your first climb; reaching the
   top pays the full ladder.

   Per-floor multiplier = 0.99 / P(safe)  →  ~99% RTP.
     low:     4 tiles, 1 bomb → 1.32x / floor  →  ~9.3x  top
     medium:  3 tiles, 1 bomb → 1.49x / floor  →  ~24x   top
     high:    2 tiles, 1 bomb → 1.98x / floor  →  ~236x  top
     extreme: 3 tiles, 2 bombs → 2.97x / floor →  ~5,900x top

   // TODO: Backend — bomb layout must be generated server-side
   // (provably fair: commit hash of layout before the run starts),
   // with each pick validated by the server.
   ============================================================ */

const TOWER_ROWS = 8;
const TOWER_RISKS = {
  low:     { label:'Low',     cols:4, bombs:1 },
  medium:  { label:'Medium',  cols:3, bombs:1 },
  high:    { label:'High',    cols:2, bombs:1 },
  extreme: { label:'Extreme', cols:3, bombs:2 },
};

let towerRisk = 'medium';
let towerActive = false;
let towerRow = 0;          // current climbable row (0 = bottom)
let towerBet = 0;
let towerLayout = [];      // [row][col] = true if bomb
let towerBusy = false;     // brief lock during reveal animation
let towerAuto = null;      // AutoPlay controller
let towerRoundCtx = null;  // { auto, target } while an engine run is climbing
let towerAutoTimer = null; // climb cadence for animated auto runs

function towerStepMult(risk){
  const r = TOWER_RISKS[risk];
  const pSafe = (r.cols - r.bombs) / r.cols;
  return 0.99 / pSafe;
}
function towerMultAt(risk, rowsCleared){
  return +Math.pow(towerStepMult(risk), rowsCleared).toFixed(2);
}

function initTower(){
  renderTowerRiskButtons();
  buildTowerBoard();

  // Auto climb-target select
  const sel = document.getElementById('twr-auto-floors');
  if(sel && !sel.dataset.built){
    sel.dataset.built = '1';
    sel.innerHTML = Array.from({length: TOWER_ROWS}, (_, i) =>
      `<option value="${i+1}" ${i+1 === 3 ? 'selected' : ''}>floor ${i+1}${i+1 === TOWER_ROWS ? ' (top)' : ''}</option>`).join('');
  }

  /* ---- Auto Bet engine ----
     Each auto run: random tile per floor up to the target floor,
     then cash out. Turbo rolls the whole climb in one go. */
  if(!towerAuto && typeof AutoPlay !== 'undefined'){
    towerAuto = AutoPlay.create({
      id: 'tower',
      mount: document.getElementById('twr-auto-mount'),
      betInputId: 'twr-bet',
      delay: 260, turboDelay: 30,
      turbo: true, presets: true,
      onStop: () => clearTimeout(towerAutoTimer),
      playRound: (ctx) => towerAutoRound(ctx),
    });
    AutoPlay.attachMeta('view-tower', { game: 'Tower', rtp: '99%', edge: '1%' });
  }
}

function towerAutoRound(ctx){
  const bet = parseFloat(document.getElementById('twr-bet').value);
  if(!bet || bet <= 0) return towerAuto.abort('Invalid bet');
  const target = Math.min(TOWER_ROWS, parseInt(document.getElementById('twr-auto-floors')?.value) || 3);

  if(ctx.turbo){
    // Headless: one Bernoulli trial per floor.
    if(!takeBet(bet)) return towerAuto.abort('Balance too low');
    AutoPlay?.bumpNonce();
    const { cols, bombs } = TOWER_RISKS[towerRisk];
    const pSafe = (cols - bombs) / cols;
    let survived = true;
    for(let f = 0; f < target; f++) if(Math.random() >= pSafe){ survived = false; break; }
    const mult = survived ? towerMultAt(towerRisk, target) : 0;
    const payout = survived ? +(bet * mult).toFixed(2) : 0;
    if(payout > 0) adjustBalance(payout);
    if(mult >= 10) celebrateWin?.({ mult, payout, anchorEl: document.getElementById('twr-mult') });
    PLGraph?.roundSettled(bet, payout);
    towerAuto.roundResolved({ bet, payout, mult });
    return;
  }

  // Animated: real board, quick random climbs.
  towerRoundCtx = { auto: true, target };
  towerStart({ auto: true });
  if(!towerActive){ towerRoundCtx = null; return; }
  towerAutoStep();
}

function towerAutoStep(){
  if(!towerActive || !towerRoundCtx) return;
  if(towerRow >= towerRoundCtx.target) return towerCashout();
  const { cols } = TOWER_RISKS[towerRisk];
  towerPick(towerRow, Math.floor(Math.random() * cols), true);
  if(towerActive) towerAutoTimer = setTimeout(towerAutoStep, 190);
}

function renderTowerRiskButtons(){
  document.querySelectorAll('.twr-risk-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.risk === towerRisk);
    b.disabled = towerActive;
  });
  const top = towerMultAt(towerRisk, TOWER_ROWS);
  document.getElementById('twr-top-mult').textContent =
    top >= 1000 ? Math.round(top).toLocaleString() + 'x' : top.toFixed(2) + 'x';
}

function towerSetRisk(risk){
  if(towerActive || !TOWER_RISKS[risk]) return;
  towerRisk = risk;
  playSound?.('click');
  renderTowerRiskButtons();
  buildTowerBoard();
}

/* Build the tower top-down in the DOM so the bottom row is the
   first thing you climb. Each row gets a side badge with the
   multiplier you'd hold after clearing it. */
function buildTowerBoard(){
  const board = document.getElementById('tower-board');
  if(!board) return;
  const { cols } = TOWER_RISKS[towerRisk];
  board.innerHTML = '';
  for(let row = TOWER_ROWS - 1; row >= 0; row--){
    const rowEl = document.createElement('div');
    rowEl.className = 'twr-row';
    rowEl.dataset.row = row;

    const badge = document.createElement('div');
    badge.className = 'twr-row-mult mono';
    const m = towerMultAt(towerRisk, row + 1);
    badge.textContent = (m >= 100 ? Math.round(m) : m.toFixed(2)) + 'x';
    rowEl.appendChild(badge);

    const tiles = document.createElement('div');
    tiles.className = 'twr-tiles';
    tiles.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for(let col = 0; col < cols; col++){
      const tile = document.createElement('button');
      tile.className = 'twr-tile';
      tile.dataset.row = row;
      tile.dataset.col = col;
      tile.onclick = () => towerPick(row, col);
      tiles.appendChild(tile);
    }
    rowEl.appendChild(tiles);
    board.appendChild(rowEl);
  }
  towerPaintActiveRow();
  towerUpdateStats();
}

function towerPaintActiveRow(){
  document.querySelectorAll('.twr-row').forEach(rowEl => {
    const r = parseInt(rowEl.dataset.row, 10);
    rowEl.classList.toggle('current', towerActive && r === towerRow);
    rowEl.classList.toggle('cleared', towerActive && r < towerRow);
  });
}

function towerUpdateStats(){
  const multEl = document.getElementById('twr-mult');
  const mult = towerRow > 0 ? towerMultAt(towerRisk, towerRow) : 1;
  multEl.textContent = mult.toFixed(2) + 'x';
  multEl.classList.toggle('hot', mult >= 2);
  multEl.classList.toggle('blazing', mult >= 5);
  document.getElementById('twr-floor').textContent = towerActive ? `${towerRow}/${TOWER_ROWS}` : '—';

  const cashBtn = document.getElementById('twr-cashout-btn');
  const payout = +(towerBet * mult).toFixed(2);
  cashBtn.disabled = !towerActive || towerRow === 0;
  cashBtn.textContent = towerActive && towerRow > 0
    ? `Cash out ${payout.toFixed(2)}` : 'Cash out';
  document.getElementById('twr-start-btn').disabled = towerActive;
}

function towerStart(opts = {}){
  if(towerActive) return;
  if(towerAuto?.isRunning() && !opts.auto) return; // engine owns the tower while running
  const bet = parseFloat(document.getElementById('twr-bet').value);
  if(!bet || bet <= 0){
    if(opts.auto) return towerAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(!takeBet(bet)){
    if(opts.auto) towerAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  playSound?.('bet');

  towerBet = bet;
  towerRow = 0;
  towerActive = true;

  // Generate the full bomb layout up front.
  // TODO: Backend — server generates + hash-commits this layout.
  const { cols, bombs } = TOWER_RISKS[towerRisk];
  towerLayout = [];
  for(let r = 0; r < TOWER_ROWS; r++){
    const rowBombs = new Set();
    while(rowBombs.size < bombs) rowBombs.add(Math.floor(Math.random() * cols));
    towerLayout.push(Array.from({length: cols}, (_, c) => rowBombs.has(c)));
  }

  document.getElementById('twr-result').className = 'result-banner';
  buildTowerBoard();
  renderTowerRiskButtons();
}

function towerAdjustBet(mult){
  const inp = document.getElementById('twr-bet');
  inp.value = Math.max(1, Math.round(parseFloat(inp.value || 1) * mult));
}

function towerPick(row, col, fromEngine = false){
  if(!towerActive || towerBusy || row !== towerRow) return;
  if(towerRoundCtx?.auto && !fromEngine) return; // board is the engine's during auto runs
  towerBusy = true;

  const tile = document.querySelector(`.twr-tile[data-row="${row}"][data-col="${col}"]`);
  const isBomb = towerLayout[row][col];

  if(!isBomb){
    tile.classList.add('safe');
    tile.innerHTML = '&#128142;';
    playSound?.('gem');
    popEl?.(tile);
    particleBurstAtEl?.(tile, { count: 8, spread: 45, size: 5, colors:['#2dd4bf','#8b5cf6','#f2b90c'] });

    towerRow++;
    towerPaintActiveRow();
    towerUpdateStats();
    popEl?.(document.getElementById('twr-mult'));

    if(towerRow >= TOWER_ROWS){
      // Topped the tower — auto cash out at full ladder
      setTimeout(() => towerCashout(true), 350);
    }
    towerBusy = false;
  } else {
    // Bomb — reveal the whole board, run over
    tile.classList.add('bomb');
    tile.innerHTML = '&#128163;';
    playSound?.('bomb');
    screenShake?.('big');
    particleBurstAtEl?.(tile, { count: 18, spread: 80, colors:['#ff4d6d','#ff8c42','#f2b90c'] });
    towerRevealAll(row, col);
    towerFinish(false);
  }
}

function towerRevealAll(hitRow, hitCol){
  document.querySelectorAll('.twr-tile').forEach(tile => {
    const r = +tile.dataset.row, c = +tile.dataset.col;
    if(r === hitRow && c === hitCol) return;
    if(tile.classList.contains('safe')) return;
    tile.classList.add('revealed');
    if(towerLayout[r][c]){
      tile.classList.add('bomb-dim');
      tile.innerHTML = '&#128163;';
    } else {
      tile.innerHTML = '&#128142;';
    }
  });
}

function towerCashout(topped = false){
  if(!towerActive || towerRow === 0) return;
  towerFinish(true, topped);
}

function towerFinish(won, topped = false){
  const rows = towerRow;
  const mult = won ? towerMultAt(towerRisk, rows) : 0;
  const payout = won ? +(towerBet * mult).toFixed(2) : 0;
  towerActive = false;
  towerBusy = false;

  const banner = document.getElementById('twr-result');
  if(won){
    adjustBalance(payout);
    banner.textContent = topped
      ? `TOWER TOPPED! ${payout.toFixed(2)} ${currency} (${mult.toFixed(2)}x)`
      : `Cashed out at floor ${rows} — ${payout.toFixed(2)} ${currency} (${mult.toFixed(2)}x)`;
    banner.className = 'result-banner win';
    playSound?.('cashout');
    celebrateWin?.({ mult, payout, anchorEl: banner });
    if(topped){ screenShake?.('big'); fireConfetti?.(90); }
  } else {
    banner.textContent = `Boom on floor ${rows + 1} — run over.`;
    banner.className = 'result-banner lose';
  }

  PLGraph?.roundSettled(towerBet, payout);

  if(typeof trackChallenge === 'function')
    trackChallenge('tower_result', { won, rows, mult, payout, bet: towerBet, risk: towerRisk, topped });

  // Settle the engine's run
  if(towerRoundCtx?.auto){
    towerRoundCtx = null;
    clearTimeout(towerAutoTimer);
    towerAuto?.roundResolved({ bet: towerBet, payout, mult });
  }

  towerUpdateStats();
  renderTowerRiskButtons();
}
