/* ============================================================
   APP SHELL — navigation, lobby content, ticker, and the
   deposit / daily bonus / rakeback modals.
   ============================================================ */

const SLOT_NAMES = ['Gold Rush Deluxe','Neon Fortune','Dragon\'s Hoard','Wild Cascade','Mega Vault','Fruit Fusion X','Starlight Spins','Bandit Bonanza'];
const LIVE_NAMES = ['Live Roulette','Lightning Baccarat','Live Blackjack VIP','Speed Roulette','Dream Catcher','Live Craps'];

function toggleSidenav(){
  document.querySelector('.sidenav').classList.toggle('open');
  document.getElementById('sidenav-backdrop').classList.toggle('open');
}
function closeSidenav(){
  document.querySelector('.sidenav').classList.remove('open');
  document.getElementById('sidenav-backdrop').classList.remove('open');
}

function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name)?.classList.add('active');
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  if(name === 'crash' && typeof initCrash === 'function' && !window.__crashInit){ initCrash(); window.__crashInit = true; }
  if(name === 'mines' && typeof initMines === 'function' && !window.__minesInit){ initMines(); window.__minesInit = true; }
  if(name === 'keno' && typeof initKeno === 'function' && !window.__kenoInit){ initKeno(); window.__kenoInit = true; }
  if(name === 'plinko' && typeof initPlinko === 'function'){
    if(!window.__plinkoInit){ initPlinko(); window.__plinkoInit = true; }
    else { resizePlinko(); }
  }
  if(name === 'dice' && typeof initDice === 'function' && !window.__diceInit){ initDice(); window.__diceInit = true; }
  if(name === 'tower' && typeof initTower === 'function' && !window.__towerInit){ initTower(); window.__towerInit = true; }
  if(name === 'roulette' && typeof initRoulette === 'function' && !window.__rlInit){ initRoulette(); window.__rlInit = true; }
  if(name === 'blackjack' && typeof initBlackjack === 'function' && !window.__bjInit){ initBlackjack(); window.__bjInit = true; }
  playSound?.('click');
  closeSidenav();
  window.scrollTo({top:0, behavior:'smooth'});
}

function buildTicker(){
  const el = document.getElementById('ticker');
  if(!el) return;
  const names = ['plumraider','vega_x','coldbrew77','nnoct','sadie.k','riverstone','hausof9','kilo_papa','misty_owl','tango_delta'];
  const games = ['Crash','Blackjack','Mines','Keno','Plinko','Dice','Tower','Roulette','Gold Rush Deluxe','Neon Fortune'];
  let items = [];
  for(let i=0;i<24;i++){
    const name = names[Math.floor(Math.random()*names.length)];
    const game = games[Math.floor(Math.random()*games.length)];
    const isBig = Math.random() < 0.25;
    const amt = isBig ? (Math.random()*40000+5000) : (Math.random()*900+20);
    items.push(`<span class="${isBig?'big':''}">${name} won <b>${amt.toFixed(2)} GC</b> on ${game}</span>`);
  }
  el.innerHTML = items.join('') + items.join(''); // doubled for seamless scroll loop
}

/* Your own wins jump the queue in the ticker — makes wins feel public and shiny.
   // TODO: Backend — replace the fake ticker entirely with a real-time feed
   // (websocket) of actual big wins across the platform. */
function pushLiveWin(amount, cur){
  const el = document.getElementById('ticker');
  if(!el || amount < 1) return;
  const you = (typeof profileState !== 'undefined' ? profileState.name : 'You');
  const span = document.createElement('span');
  span.className = amount >= 500 ? 'big you' : 'you';
  span.innerHTML = `${you} won <b>${amount.toFixed(2)} ${cur}</b> just now`;
  el.prepend(span);
}

/* ---------- Favorites ---------- */
const FAV_KEY = 'hitgg_favs_v1';
let favorites = [];
try { favorites = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e){}
const GAME_META = {
  crash:     { title:'Crash',     art:'&#128200;', sub:'Cash out before it pops' },
  plinko:    { title:'Plinko',    art:'&#128992;', sub:'Drop, bounce, multiply' },
  mines:     { title:'Mines',     art:'&#128163;', sub:'Clear the field' },
  keno:      { title:'Keno',      art:'&#9679;&#9679;&#9679;', sub:'Pick, draw, cash out' },
  blackjack: { title:'Blackjack', art:'&#9824;&#9829;', sub:'Beat the dealer to 21' },
  dice:      { title:'Dice',      art:'&#127922;', sub:'Pick your odds, roll' },
  tower:     { title:'Tower',     art:'&#127959;', sub:'Climb floor by floor' },
  roulette:  { title:'Roulette',  art:'&#9711;',  sub:'Red, black, or brave' },
};
function toggleFavorite(game){
  const i = favorites.indexOf(game);
  if(i >= 0) favorites.splice(i, 1); else favorites.push(game);
  localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  renderFavorites();
  playSound?.('click');
}
function renderFavorites(){
  // star states on the main grid
  document.querySelectorAll('.tile[data-game]').forEach(tile => {
    const star = tile.querySelector('.fav-star');
    if(!star) return;
    const fav = favorites.includes(tile.dataset.game);
    star.innerHTML = fav ? '&#9733;' : '&#9734;';
    star.classList.toggle('on', fav);
  });
  // favorites section
  const section = document.getElementById('fav-section');
  const grid = document.getElementById('fav-grid');
  if(!section || !grid) return;
  section.style.display = favorites.length ? '' : 'none';
  grid.innerHTML = favorites.map(g => {
    const m = GAME_META[g];
    if(!m) return '';
    return `
      <div class="tile" data-game="${g}" onclick="showView('${g}')">
        <button class="fav-star on" onclick="event.stopPropagation(); toggleFavorite('${g}')">&#9733;</button>
        <div class="art">${m.art}</div>
        <div class="info"><h3>${m.title}</h3><small>${m.sub}</small></div>
      </div>`;
  }).join('');
}

/* ---------- "Hot right now" strip ----------
   // TODO: Backend — rank by real play counts / RTP-independent popularity. */
function renderHotStrip(){
  const strip = document.getElementById('hot-strip');
  if(!strip) return;
  const hot = [
    { game:'plinko', label:'Plinko', stat:'2,140 dropping now' },
    { game:'roulette', label:'Roulette', stat:'1,988 at the wheel' },
    { game:'crash',  label:'Crash',  stat:'1,873 riding' },
    { game:'tower',  label:'Tower',  stat:'1,102 climbing' },
    { game:'mines',  label:'Mines',  stat:'964 digging' },
  ];
  strip.innerHTML = hot.map((h,i) => `
    <div class="hot-card" onclick="showView('${h.game}')">
      <span class="hot-rank mono">#${i+1}</span>
      <div class="hot-art">${GAME_META[h.game].art}</div>
      <div><b>${h.label}</b><small>${h.stat}</small></div>
    </div>`).join('');
}

function populateSlotsGrid(){
  const grid = document.getElementById('slots-grid');
  if(!grid) return;
  grid.innerHTML = SLOT_NAMES.map(name => `
    <div class="tile locked">
      <div class="art">&#127920;</div>
      <div class="info"><h3>${name}</h3><small>Slot provider</small></div>
    </div>`).join('');
}
function populateLiveGrid(){
  const grid = document.getElementById('live-grid');
  if(!grid) return;
  grid.innerHTML = LIVE_NAMES.map(name => `
    <div class="tile locked">
      <div class="art">&#127922;</div>
      <div class="info"><h3>${name}</h3><small>Live dealer</small></div>
    </div>`).join('');
}

/* ---------- Generic modal helpers ---------- */
function openModal(id){
  document.getElementById(id)?.classList.add('open');
  document.body.classList.add('modal-lock');
}
function closeModal(id){
  document.getElementById(id)?.classList.remove('open');
  document.body.classList.remove('modal-lock');
}

/* ---------- Deposit modal (Stripe + crypto) ---------- */
function openDepositModal(){
  const wrap = document.getElementById('gc-packages');
  if(wrap && !wrap.dataset.built){
    wrap.innerHTML = GC_PACKAGES.map(p => `
      <div class="pkg-card${p.tag ? ' featured' : ''}">
        ${p.tag ? `<span class="pkg-tag">${p.tag}</span>` : ''}
        <div class="pkg-gc">${p.gc.toLocaleString()} <small>GC</small></div>
        ${p.sc ? `<div class="pkg-sc">+ ${p.sc} SC bonus</div>` : '<div class="pkg-sc">&nbsp;</div>'}
        <button class="btn btn-gold pkg-buy" id="checkout-btn-${p.id}" onclick="startStripeCheckout('${p.id}')">$${p.price}</button>
      </div>`).join('');
    wrap.dataset.built = '1';
  }
  const coinWrap = document.getElementById('crypto-coin-picker');
  if(coinWrap && !coinWrap.dataset.built){
    coinWrap.innerHTML = CRYPTO_COINS.map((c,i) => `<button class="chip-btn crypto-coin${i===0?' active':''}" onclick="selectCryptoCoin('${c}', this)">${c}</button>`).join('');
    coinWrap.dataset.built = '1';
    startCryptoDeposit(CRYPTO_COINS[0]);
  }
  setDepositTab('stripe');
  openModal('modal-deposit');
}
function selectCryptoCoin(coin, btn){
  document.querySelectorAll('.crypto-coin').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  startCryptoDeposit(coin);
}
function setDepositTab(tab){
  document.getElementById('tab-stripe-btn').classList.toggle('active', tab==='stripe');
  document.getElementById('tab-crypto-btn').classList.toggle('active', tab==='crypto');
  document.getElementById('tab-stripe-panel').classList.toggle('active', tab==='stripe');
  document.getElementById('tab-crypto-panel').classList.toggle('active', tab==='crypto');
}

/* ---------- Daily bonus modal ---------- */
function renderDailyBonusUI(){
  const dot = document.getElementById('daily-dot');
  const strip = document.getElementById('daily-strip');
  const claimBtn = document.getElementById('daily-claim-btn');
  const statusEl = document.getElementById('daily-status');
  if(!strip) return;

  const available = dailyBonusAvailable();
  if(dot) dot.style.display = available ? 'block' : 'none';

  const previewStreak = available ? (dailyStreak && (dayIndex(Date.now()) - dayIndex(lastDailyClaim) <= 1) ? dailyStreak + 1 : 1) : dailyStreak;
  strip.innerHTML = '';
  for(let d=1; d<=7; d++){
    const reward = dailyBonusForDay(d);
    const cycleDay = ((previewStreak - 1) % 7) + 1;
    const done = d < cycleDay || (!available && d <= cycleDay);
    const isToday = available && d === cycleDay;
    strip.innerHTML += `
      <div class="daily-day${done?' done':''}${isToday?' today':''}">
        <small>Day ${d}</small>
        <b>${reward.gc.toLocaleString()}</b>
        ${reward.sc ? `<span class="sc-tag">+${reward.sc} SC</span>` : ''}
      </div>`;
  }

  if(claimBtn){
    claimBtn.disabled = !available;
    claimBtn.textContent = available ? 'Claim today\'s bonus' : 'Already claimed today';
  }
  if(statusEl){
    statusEl.textContent = dailyStreak > 0
      ? `Current streak: ${dailyStreak} day${dailyStreak===1?'':'s'}${available ? '' : ' — come back tomorrow to keep it going'}`
      : 'Claim today to start your streak';
  }
}
function openDailyModal(){
  renderDailyBonusUI();
  openModal('modal-daily');
}
function handleDailyClaimClick(){
  const reward = claimDailyBonus();
  if(!reward) return;
  renderDailyBonusUI();
}

/* ---------- Rakeback modal ---------- */
function openRakebackModal(){
  renderRakebackPanel();
  openModal('modal-rakeback');
}

/* ---------- Challenges / Achievements / VIP modals ---------- */
function openChallengesModal(){
  renderChallenges();
  openModal('modal-challenges');
}
function openAchievementsModal(){
  renderAchievements();
  openModal('modal-achievements');
}
function openVipModal(){
  renderVipPanel();
  renderCashbackPanel();
  openModal('modal-vip');
}
function refreshChallengesDot(){
  const dot = document.getElementById('challenges-dot');
  if(!dot) return;
  const anyReady = (typeof activeChallenges !== 'undefined') && activeChallenges.some(c => {
    const t = challengeTemplate(c.id);
    return t && !c.claimed && c.progress >= t.target;
  });
  dot.style.display = anyReady ? 'block' : 'none';
}

/* ---------- Init ---------- */
function initAppShell(){
  buildTicker();
  populateSlotsGrid();
  populateLiveGrid();
  renderFavorites();
  renderHotStrip();
  setCurrency(currency);
  renderLevelBar();
  renderRakebackPanel();
  renderVipPanel();
  renderCashbackPanel();
  refreshChallengesDot();

  const dot = document.getElementById('daily-dot');
  if(dot) dot.style.display = dailyBonusAvailable() ? 'block' : 'none';

  showView('lobby');
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAppShell);
else initAppShell();
