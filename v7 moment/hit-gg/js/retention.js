/* ============================================================
   SOCIAL & RETENTION LAYER
   Recent big-wins feed + leaderboards. In this demo the feed is
   seeded with simulated players so the room never feels empty,
   and the local player's own big wins get mixed in live.

   // TODO: Backend — replace the simulated feed/leaderboard below with
   // a real-time feed (websocket/SSE) of actual wins across all players,
   // and server-computed leaderboard rankings refreshed on an interval.
   Persistence: localStorage (demo only, feed/leaderboard are illustrative).
   ============================================================ */

const RETENTION_KEY = 'hitgg_retention_v1';
const FEED_NAMES = ['Nova','Kestrel','Ruby','Jax','Wolfie','Marlo','Sable','Quinn','Bexley','Orion','Piper','Zane','Ember','Talon','Vega'];
const GAME_ICONS = { Crash:'🚀', Mines:'💣', Keno:'🎱', Blackjack:'🃏' };

let bigWinsFeed = [];      // [{name, game, amount, currency, mult, ts}]
let leaderboardSeed = null; // cached simulated leaderboard base, regenerated daily

function loadRetentionState(){
  try {
    const raw = localStorage.getItem(RETENTION_KEY);
    if(!raw) return;
    const s = JSON.parse(raw);
    bigWinsFeed = s.bigWinsFeed || [];
  } catch(e){ console.warn('HIT.GG: could not load retention state', e); }
}
function saveRetentionState(){
  try { localStorage.setItem(RETENTION_KEY, JSON.stringify({ bigWinsFeed })); } catch(e){}
}

/* ---------- Recent big wins feed ---------- */
function randomFakeWin(){
  const name = FEED_NAMES[Math.floor(Math.random()*FEED_NAMES.length)];
  const games = Object.keys(GAME_ICONS);
  const game = games[Math.floor(Math.random()*games.length)];
  const currency = Math.random() < 0.3 ? 'SC' : 'GC';
  const mult = +(2 + Math.random()*48).toFixed(2);
  const base = currency === 'SC' ? 5 + Math.random()*40 : 200 + Math.random()*4000;
  const amount = +(base * (mult/4)).toFixed(2);
  return { name, game, amount, currency, mult, ts: Date.now() };
}
function pushBigWin(entry){
  bigWinsFeed.unshift(entry);
  bigWinsFeed = bigWinsFeed.slice(0, 40);
  saveRetentionState();
  renderBigWinsFeed();
}
// Called from game files on a notably big cashout — wire this in alongside
// each game's existing trackChallenge('..._cashout', ...) calls.
function reportPlayerBigWin(game, amount, currency, mult){
  if(mult < 3 && amount < 500) return; // only feed-worthy wins
  const name = (document.getElementById('profile-name')?.textContent) || 'You';
  pushBigWin({ name, game, amount, currency, mult, ts: Date.now(), isYou: true });
}
function renderBigWinsFeed(){
  const wrap = document.getElementById('bigwins-feed');
  if(!wrap) return;
  wrap.innerHTML = bigWinsFeed.slice(0, 12).map(w => `
    <div class="win-row${w.isYou ? ' win-row-you' : ''}">
      <span class="win-icon">${GAME_ICONS[w.game] || '🎰'}</span>
      <span class="win-name">${w.isYou ? 'You' : w.name}</span>
      <span class="win-game">${w.game}</span>
      <span class="win-mult">${w.mult.toFixed(2)}x</span>
      <span class="win-amt">+${w.amount.toLocaleString(undefined,{maximumFractionDigits:2})} ${w.currency}</span>
    </div>`).join('') || '<p class="modal-footnote">No big wins yet — go get one.</p>';
}
function startSimulatedFeed(){
  // Seed a handful immediately so the feed isn't empty on first load.
  if(bigWinsFeed.length < 6){
    for(let i=0;i<6;i++) bigWinsFeed.push(randomFakeWin());
    bigWinsFeed.sort((a,b)=>b.ts-a.ts);
    saveRetentionState();
  }
  renderBigWinsFeed();
  setInterval(() => { pushBigWin(randomFakeWin()); }, 15000 + Math.random()*10000);
}

/* ---------- Share a win ---------- */
function shareWin(game, amount, currency, mult){
  const text = `Just hit ${mult.toFixed(2)}x on ${game} for +${amount.toLocaleString()} ${currency} on HIT.GG! 🎉`;
  const link = typeof getReferralLink === 'function' ? getReferralLink() : location.href;
  if(navigator.share){ navigator.share({ title:'HIT.GG win', text: `${text} ${link}` }).catch(()=>{}); }
  else {
    navigator.clipboard?.writeText(`${text} ${link}`).catch(()=>{});
    if(typeof ensureToastLayer === 'function'){
      const layer = ensureToastLayer();
      const t = document.createElement('div');
      t.className = 'toast toast-reward';
      t.innerHTML = `<b>Copied!</b><span>Win summary copied — paste it anywhere to brag</span>`;
      layer.appendChild(t);
      requestAnimationFrame(()=>t.classList.add('show'));
      setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 2600);
    }
  }
}

/* ============================================================
   LEADERBOARDS
   Three simulated boards (biggest win, most active, best multiplier),
   seeded deterministically per day so it feels alive but stable while
   you're looking at it, with the local player inserted by their real stats.
   ============================================================ */
function seededRandom(seed){ let s = seed % 2147483647; if(s<=0) s+=2147483646; return () => (s = s*16807 % 2147483647) / 2147483647; }
function buildLeaderboardSeed(){
  const today = dayIndex(Date.now());
  const rand = seededRandom(today * 9973 + 17);
  return FEED_NAMES.map((name, i) => ({
    name,
    biggestWin: Math.round(500 + rand()*250000),
    active: Math.round(20 + rand()*400),
    bestMult: +(2 + rand()*180).toFixed(2),
  }));
}
function currentPlayerName(){ return (document.getElementById('profile-name')?.textContent) || 'You'; }
function buildLeaderboard(kind){
  if(!leaderboardSeed || leaderboardSeed.day !== dayIndex(Date.now())){
    leaderboardSeed = { day: dayIndex(Date.now()), rows: buildLeaderboardSeed() };
  }
  const rows = leaderboardSeed.rows.map(r => ({ ...r }));
  const me = { name: currentPlayerName(), isYou: true,
    biggestWin: (typeof totalWageredLifetime !== 'undefined' ? Math.max(totalWageredLifetime.GC*0.02, totalWageredLifetime.SC*4) : 0),
    active: typeof lifetimeStats !== 'undefined' ? (lifetimeStats.wins_total||0) : 0,
    bestMult: typeof lifetimeStats !== 'undefined' ? (lifetimeStats.crash_max_mult||0) : 0 };
  rows.push(me);
  const key = kind === 'active' ? 'active' : kind === 'mult' ? 'bestMult' : 'biggestWin';
  rows.sort((a,b) => b[key]-a[key]);
  return { rows, key };
}
function renderLeaderboard(kind = 'wins'){
  const wrap = document.getElementById('leaderboard-list');
  if(!wrap) return;
  const { rows, key } = buildLeaderboard(kind);
  wrap.innerHTML = rows.slice(0, 15).map((r, i) => `
    <div class="lb-row${r.isYou ? ' lb-row-you' : ''}${i<3 ? ' lb-top' : ''}">
      <span class="lb-rank">${i+1}</span>
      <span class="lb-name">${r.isYou ? 'You' : r.name}</span>
      <span class="lb-val">${key === 'bestMult' ? r[key].toFixed(2)+'x' : Math.round(r[key]).toLocaleString()}</span>
    </div>`).join('');
  document.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
}

/* ---------- Init ---------- */
loadRetentionState();
document.addEventListener('DOMContentLoaded', () => {
  startSimulatedFeed();
  renderLeaderboard('wins');
});
