/* ============ KENO ============
   Four difficulties. Each changes how many numbers are drawn and
   the paytable shape: Low pays small and often, Extreme pays
   almost nothing until the top hits — then pays huge.

   Paytables are generated at load time from exact hypergeometric
   hit probabilities, shaped per difficulty, and normalized to
   ~99% RTP. Demo math — entertainment only.

   // TODO: Backend — draws must come from a provably-fair server
   // RNG, and paytables should be served (and settled) server-side. */

const KENO_TOTAL_NUMBERS = 40;
const KENO_MAX_PICKS = 10;

const KENO_DIFFICULTIES = {
  low:     { label:'Low',     draws:10, minFrac:0.25, exp:1.5 },
  medium:  { label:'Medium',  draws:10, minFrac:0.42, exp:2.4 },
  high:    { label:'High',    draws:9,  minFrac:0.60, exp:3.4 },
  extreme: { label:'Extreme', draws:8,  minFrac:0.78, exp:4.6 },
};
let kenoDifficulty = 'medium';

/* ---------- Paytable generation ---------- */
function kenoComb(n, k){
  if(k < 0 || k > n) return 0;
  let r = 1;
  for(let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}
/* P(hit exactly h of `picks`) when `draws` numbers are drawn from 40 */
function kenoHitProb(picks, draws, h){
  return kenoComb(picks, h) * kenoComb(KENO_TOTAL_NUMBERS - picks, draws - h) / kenoComb(KENO_TOTAL_NUMBERS, draws);
}
function kenoNiceRound(m){
  if(m <= 0) return 0;
  if(m < 2)    return Math.max(0.1, Math.round(m * 20) / 20); // 0.05 steps
  if(m < 10)   return Math.round(m * 10) / 10;
  if(m < 100)  return Math.round(m);
  if(m < 1000) return Math.round(m / 5) * 5;
  return Math.round(m / 25) * 25;
}
const KENO_MULT_CAP = 10000; // max multiplier on any single line
function kenoBuildTable(picks, diffKey){
  const d = KENO_DIFFICULTIES[diffKey];
  let minHits = Math.max(1, Math.ceil(picks * d.minFrac));
  const probAtOrAbove = (m) => {
    let s = 0;
    for(let h = m; h <= picks; h++) s += kenoHitProb(picks, d.draws, h);
    return s;
  };
  // With the cap in place, the best possible EV is cap · P(hits ≥ minHits).
  // If the shaped threshold is so high that even paying the cap on every
  // winning line can't reach 99% RTP, walk the threshold down until it can.
  while(minHits > 1 && KENO_MULT_CAP * probAtOrAbove(minHits) < 1.1) minHits--;
  // Shape: weight grows steeply with hits above the paying threshold
  const weights = [];
  for(let h = 0; h <= picks; h++)
    weights.push(h >= minHits ? Math.pow(h - minHits + 1, d.exp) : 0);
  const probs = weights.map((_, h) => kenoHitProb(picks, d.draws, h));
  // Solve scale k (bisection) so Σ P(h)·min(cap, w·k) = 0.99.
  // The cap keeps steep tables from producing million-x lines whose
  // probability is effectively zero; capped mass flows to lower hits.
  const ev = (k) => probs.reduce((s, p, h) => s + p * Math.min(KENO_MULT_CAP, weights[h] * k), 0);
  let lo = 0, hi = 1;
  while(ev(hi) < 0.99 && hi < 1e12) hi *= 2;
  for(let i = 0; i < 60; i++){
    const mid = (lo + hi) / 2;
    if(ev(mid) < 0.99) lo = mid; else hi = mid;
  }
  const k = hi;
  return weights.map(w => kenoNiceRound(Math.min(KENO_MULT_CAP, w * k)));
}
/* Precompute all tables: KENO_PAYTABLES[difficulty][picks] = [mult by hits] */
const KENO_PAYTABLES = {};
for(const key of Object.keys(KENO_DIFFICULTIES)){
  KENO_PAYTABLES[key] = {};
  for(let p = 1; p <= KENO_MAX_PICKS; p++) KENO_PAYTABLES[key][p] = kenoBuildTable(p, key);
}

let kenoPicks = [];
let kenoDrawn = [];
let kenoBusy = false;

let kenoAuto = null;       // AutoPlay controller
let kenoRoundCtx = null;   // { auto, turbo } for the draw in flight

function initKeno(){
  const grid = document.getElementById('keno-grid');
  if(!grid) return;
  grid.innerHTML = '';
  for(let n=1; n<=KENO_TOTAL_NUMBERS; n++){
    const cell = document.createElement('div');
    cell.className = 'keno-cell';
    cell.dataset.n = n;
    cell.textContent = n;
    cell.onclick = () => kenoToggle(n);
    grid.appendChild(cell);
  }
  renderKenoDifficulty();
  kenoUpdateStats();

  /* ---- Auto Bet engine ----
     Auto redraws your current picks each round. Turbo skips the
     ball-by-ball reveal and settles the whole draw instantly. */
  if(!kenoAuto && typeof AutoPlay !== 'undefined'){
    kenoAuto = AutoPlay.create({
      id: 'keno',
      mount: document.getElementById('keno-auto-mount'),
      betInputId: 'k-bet',
      delay: 200, turboDelay: 30,
      turbo: true, presets: true,
      playRound: (ctx) => kenoPlay({ auto: true, turbo: ctx.turbo }),
    });
    AutoPlay.attachMeta('view-keno', { game: 'Keno', rtp: '~99%', edge: '~1%' });
  }
}

function kenoSetDifficulty(key){
  if(kenoBusy || !KENO_DIFFICULTIES[key]) return;
  kenoDifficulty = key;
  playSound?.('click');
  renderKenoDifficulty();
  kenoUpdateStats();
  renderKenoPaytable();
}
function renderKenoDifficulty(){
  document.querySelectorAll('.keno-diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === kenoDifficulty));
  const d = KENO_DIFFICULTIES[kenoDifficulty];
  document.getElementById('k-draws').textContent = d.draws;
}

/* Mini paytable strip under the board — shows what each hit count pays */
function renderKenoPaytable(){
  const el = document.getElementById('k-paytable');
  if(!el) return;
  if(kenoPicks.length === 0){ el.innerHTML = ''; return; }
  const table = KENO_PAYTABLES[kenoDifficulty][kenoPicks.length];
  el.innerHTML = table.map((m, h) => {
    if(h === 0) return '';
    const fmt = m >= 100 ? Math.round(m).toLocaleString() : (m >= 10 ? m.toFixed(0) : m.toFixed(2));
    return `<div class="k-pay ${m > 0 ? 'pays' : ''}"><small>${h} hit${h>1?'s':''}</small><b class="mono">${m > 0 ? fmt + 'x' : '—'}</b></div>`;
  }).join('');
}

function kenoToggle(n){
  if(kenoBusy) return;
  const idx = kenoPicks.indexOf(n);
  if(idx >= 0){
    kenoPicks.splice(idx, 1);
  } else {
    if(kenoPicks.length >= KENO_MAX_PICKS) return;
    kenoPicks.push(n);
  }
  document.querySelector(`.keno-cell[data-n="${n}"]`).classList.toggle('picked');
  playSound?.('click');
  kenoUpdateStats();
  renderKenoPaytable();
}

function kenoClear(){
  if(kenoBusy) return;
  kenoPicks = [];
  document.querySelectorAll('.keno-cell').forEach(c => c.classList.remove('picked','hit','drawn-miss','drawn'));
  document.getElementById('k-result').className = 'result-banner';
  kenoUpdateStats();
  renderKenoPaytable();
}

function kenoQuickPick(){
  if(kenoBusy) return;
  kenoClear();
  const count = 6;
  const pool = Array.from({length:KENO_TOTAL_NUMBERS}, (_,i)=>i+1);
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  kenoPicks = pool.slice(0, count);
  kenoPicks.forEach(n => document.querySelector(`.keno-cell[data-n="${n}"]`).classList.add('picked'));
  kenoUpdateStats();
  renderKenoPaytable();
}

function kenoAdjustBet(mult){
  const inp = document.getElementById('k-bet');
  inp.value = Math.max(1, Math.round(parseFloat(inp.value||1) * mult));
}

function kenoUpdateStats(){
  document.getElementById('k-picks').textContent = `${kenoPicks.length}/${KENO_MAX_PICKS}`;
  document.getElementById('k-hits').textContent = '—';
  document.getElementById('k-mult').textContent = '—';
  const top = kenoPicks.length ? Math.max(...KENO_PAYTABLES[kenoDifficulty][kenoPicks.length]) : 0;
  document.getElementById('k-top').textContent = top > 0
    ? (top >= 100 ? Math.round(top).toLocaleString() : top.toFixed(1)) + 'x' : '—';
}

function kenoPlay(opts = {}){
  if(kenoBusy) return;
  if(kenoAuto?.isRunning() && !opts.auto) return; // engine owns the draw while running
  kenoRoundCtx = opts;
  if(kenoPicks.length === 0){
    if(opts.auto) return kenoAuto.abort('Pick numbers first');
    alert('Pick at least 1 number.'); return;
  }
  const bet = parseFloat(document.getElementById('k-bet').value);
  if(!bet || bet <= 0){
    if(opts.auto) return kenoAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(!takeBet(bet)){
    if(opts.auto) kenoAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  if(!opts.turbo) playSound?.('bet');

  kenoBusy = true;
  document.getElementById('k-play-btn').disabled = true;
  document.getElementById('k-result').className = 'result-banner';
  document.querySelectorAll('.keno-cell').forEach(c => c.classList.remove('hit','drawn-miss','drawn'));

  const draws = KENO_DIFFICULTIES[kenoDifficulty].draws;
  // TODO: Backend — provably-fair server draw
  const pool = Array.from({length:KENO_TOTAL_NUMBERS}, (_,i)=>i+1);
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  kenoDrawn = pool.slice(0, draws);

  // TURBO — mark the board in one pass and settle.
  if(opts.turbo){
    let hits = 0;
    for(const n of kenoDrawn){
      const cell = document.querySelector(`.keno-cell[data-n="${n}"]`);
      const isPick = kenoPicks.includes(n);
      if(isPick){ hits++; cell?.classList.add('hit'); }
      else cell?.classList.add('drawn-miss');
      cell?.classList.add('drawn');
    }
    document.getElementById('k-hits').textContent = hits + '/' + kenoPicks.length;
    return kenoFinishDraw(bet, hits);
  }

  let hits = 0;
  let i = 0;
  const stepDelay = kenoAuto?.isRunning() ? 70 : 115; // auto draws run hotter
  const timer = setInterval(() => {
    if(i >= kenoDrawn.length){
      clearInterval(timer);
      return kenoFinishDraw(bet, hits);
    }
    const n = kenoDrawn[i];
    const cell = document.querySelector(`.keno-cell[data-n="${n}"]`);
    const isPick = kenoPicks.includes(n);
    if(isPick){
      hits++;
      cell.classList.add('hit');
      spawnKenoBurst(cell);
      playSound?.('gem');
      popEl?.(cell);
      particleBurstAtEl?.(cell, { count: 12, spread: 60, size: 6 });
    } else {
      cell.classList.add('drawn-miss');
      playSound?.('tick');
    }
    cell.classList.add('drawn');
    document.getElementById('k-hits').textContent = hits + '/' + kenoPicks.length;
    const runningMult = (KENO_PAYTABLES[kenoDifficulty][kenoPicks.length] || [])[hits] || 0;
    document.getElementById('k-mult').textContent = runningMult > 0 ? runningMult.toFixed(2)+'x' : '—';
    i++;
  }, stepDelay);
}

function spawnKenoBurst(cell){
  const rect = cell.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.className = 'keno-burst';
  burst.style.left = (rect.left + rect.width/2) + 'px';
  burst.style.top = (rect.top + rect.height/2) + 'px';
  document.body.appendChild(burst);
  setTimeout(()=>burst.remove(), 650);
}

function kenoFinishDraw(bet, hits){
  const table = KENO_PAYTABLES[kenoDifficulty][kenoPicks.length] || [];
  const mult = table[hits] || 0;
  const payout = +(bet * mult).toFixed(2);

  if(payout > 0) adjustBalance(payout);
  PLGraph?.roundSettled(bet, payout);
  if(typeof trackChallenge === 'function') trackChallenge('keno_draw', { hits, picks: kenoPicks.length, mult, payout, difficulty: kenoDifficulty });

  const banner = document.getElementById('k-result');
  const turbo = !!kenoRoundCtx?.turbo;
  if(payout > 0){
    banner.textContent = `${hits}/${kenoPicks.length} hits — won ${payout.toFixed(2)} ${currency} (${mult.toFixed(2)}x)`;
    banner.className = 'result-banner win';
    if(!turbo || mult >= 20) celebrateWin?.({ mult, payout, anchorEl: banner });
  } else {
    banner.textContent = `${hits}/${kenoPicks.length} hits — no win this round.`;
    banner.className = 'result-banner lose';
    if(!turbo) playSound?.('lose');
  }

  kenoBusy = false;
  document.getElementById('k-play-btn').disabled = false;

  // Settle the engine's round
  if(kenoRoundCtx?.auto) kenoAuto?.roundResolved({ bet, payout, mult });
  kenoRoundCtx = null;
}
