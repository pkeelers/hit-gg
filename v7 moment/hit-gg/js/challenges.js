/* ============================================================
   CHALLENGES, STREAK MILESTONES & ACHIEVEMENTS
   All rewards here are earned by playing and, once won, are
   never taken away or subject to a countdown. Missing a daily
   challenge just means it quietly rolls over to a new one
   tomorrow — no penalty, no guilt copy, no "you lost your streak"
   framing beyond the plain fact of the streak count.

   Persistence: localStorage (demo only).
   // TODO: Backend integration — move challenge generation, progress
   // tracking, and reward grants server-side so a client can't
   // fabricate progress or claim rewards twice.
   ============================================================ */

const CHALLENGES_KEY = 'hitgg_challenges_v1';

/* ---------- Challenge pool (4 of these rotate in per day) ---------- */
const CHALLENGE_POOL = [
  { id:'wager_gc',      desc:'Wager 5,000 GC',                   metric:'wager_GC',    target:5000, reward:{gc:800} },
  { id:'wager_sc',      desc:'Wager 10 SC',                       metric:'wager_SC',    target:10,   reward:{sc:1} },
  { id:'crash_3x',      desc:'Cash out at 3x+ on Crash, twice',   metric:'crash_3x',    target:2,    reward:{gc:600} },
  { id:'crash_wins',    desc:'Cash out successfully on Crash 4 times', metric:'crash_win', target:4, reward:{gc:650} },
  { id:'mines_wins',    desc:'Cash out 3 winning Mines rounds',   metric:'mines_win',   target:3,    reward:{gc:700} },
  { id:'bj_hands',      desc:'Play 10 hands of Blackjack',        metric:'bj_hand',     target:10,   reward:{gc:500} },
  { id:'keno_wins',     desc:'Win 2 rounds of Keno',               metric:'keno_win',    target:2,    reward:{gc:500} },
  { id:'big_win',       desc:'Hit a 5x+ multiplier in any game',  metric:'big_win_5x',  target:1,    reward:{gc:1000, sc:0.5} },
  { id:'plinko_25',     desc:'Drop 25 Plinko balls',              metric:'plinko_drop', target:25,   reward:{gc:600} },
  { id:'plinko_10x',    desc:'Land a 10x+ Plinko bin',            metric:'plinko_10x',  target:1,    reward:{gc:900} },
  { id:'dice_rolls',    desc:'Roll the dice 20 times',            metric:'dice_roll',   target:20,   reward:{gc:550} },
  { id:'dice_10x',      desc:'Win a 10x+ Dice roll',              metric:'dice_10x',    target:1,    reward:{gc:900} },
  { id:'tower_wins',    desc:'Cash out 3 Tower climbs',           metric:'tower_win',   target:3,    reward:{gc:700} },
  { id:'roulette_10',   desc:'Spin the Roulette wheel 10 times',  metric:'roulette_spin', target:10, reward:{gc:550} },
  { id:'roulette_hit',  desc:'Hit a straight number on Roulette', metric:'roulette_straight', target:1, reward:{gc:1000} },
];
const WEEKLY_CHALLENGE_TEMPLATE = { id:'weekly_wager', desc:'Wager 50,000 GC this week', metric:'wager_GC_week', target:50000, reward:{gc:5000, sc:3} };

/* ---------- Achievement catalog (38 total) ---------- */
const ACHIEVEMENTS = [
  { id:'first_win',        name:'First Win',            tier:'bronze', desc:'Win a round on any game',            metric:'wins_total', target:1 },
  { id:'wins_10',          name:'Getting Started',      tier:'bronze', desc:'Win 10 rounds total',                metric:'wins_total', target:10 },
  { id:'wins_100',         name:'On a Roll',            tier:'silver', desc:'Win 100 rounds total',               metric:'wins_total', target:100 },
  { id:'wins_500',         name:'Seasoned Player',      tier:'gold',   desc:'Win 500 rounds total',               metric:'wins_total', target:500 },

  { id:'wager_gc_10k',     name:'Warming Up',           tier:'bronze', desc:'Wager 10,000 GC lifetime',           metric:'wager_GC_life', target:10000 },
  { id:'wager_gc_100k',    name:'High Roller',          tier:'silver', desc:'Wager 100,000 GC lifetime',          metric:'wager_GC_life', target:100000 },
  { id:'wager_gc_1m',      name:'Whale Watching',       tier:'gold',   desc:'Wager 1,000,000 GC lifetime',        metric:'wager_GC_life', target:1000000 },

  { id:'wager_sc_50',      name:'SC Starter',           tier:'bronze', desc:'Wager 50 SC lifetime',               metric:'wager_SC_life', target:50 },
  { id:'wager_sc_500',     name:'SC Regular',           tier:'silver', desc:'Wager 500 SC lifetime',              metric:'wager_SC_life', target:500 },
  { id:'wager_sc_5000',    name:'SC Heavyweight',       tier:'gold',   desc:'Wager 5,000 SC lifetime',            metric:'wager_SC_life', target:5000 },

  { id:'crash_2x',         name:'Lift Off',             tier:'bronze', desc:'Cash out at 2x or higher on Crash',  metric:'crash_max_mult', target:2 },
  { id:'crash_10x',        name:'Orbital',              tier:'silver', desc:'Cash out at 10x or higher on Crash', metric:'crash_max_mult', target:10 },
  { id:'crash_50x',        name:'Escape Velocity',      tier:'gold',   desc:'Cash out at 50x or higher on Crash', metric:'crash_max_mult', target:50 },
  { id:'crash_25',         name:'Rocket Regular',       tier:'silver', desc:'Cash out successfully on Crash 25 times', metric:'crash_win_count', target:25 },

  { id:'mines_win1',       name:'Careful Steps',        tier:'bronze', desc:'Cash out a winning Mines round',     metric:'mines_win_count', target:1 },
  { id:'mines_clear',      name:'Board Cleared',        tier:'gold',   desc:'Clear an entire Mines board',        metric:'mines_cleared_count', target:1 },
  { id:'mines_25',         name:'Minesweeper',          tier:'silver', desc:'Win 25 Mines rounds',                metric:'mines_win_count', target:25 },

  { id:'keno_win1',        name:'Lucky Numbers',        tier:'bronze', desc:'Win a Keno round',                   metric:'keno_win_count', target:1 },
  { id:'keno_perfect',     name:'Perfect Draw',         tier:'gold',   desc:'Hit every number you picked in Keno', metric:'keno_perfect_count', target:1 },
  { id:'keno_25',          name:'Keno Regular',         tier:'silver', desc:'Win 25 Keno rounds',                 metric:'keno_win_count', target:25 },

  { id:'bj_natural',       name:'Natural Blackjack',    tier:'bronze', desc:'Draw a natural blackjack',           metric:'bj_blackjack_count', target:1 },
  { id:'bj_streak5',       name:'Hot Hand',             tier:'silver', desc:'Win 5 blackjack hands in a row',     metric:'bj_max_streak', target:5 },
  { id:'bj_200',           name:'Card Counter',         tier:'gold',   desc:'Play 200 hands of Blackjack',        metric:'bj_hand_count', target:200 },

  { id:'level_10',         name:'Level 10',             tier:'bronze', desc:'Reach account level 10',             metric:'level', target:10 },
  { id:'level_25',         name:'Level 25',             tier:'silver', desc:'Reach account level 25',             metric:'level', target:25 },
  { id:'level_50',         name:'Level 50',             tier:'silver', desc:'Reach account level 50',             metric:'level', target:50 },
  { id:'level_75',         name:'Level 75',             tier:'gold',   desc:'Reach account level 75',             metric:'level', target:75 },
  { id:'level_100',        name:'Max Level',            tier:'gold',   desc:'Reach account level 100',            metric:'level', target:100 },

  { id:'streak_3',         name:'Three in a Row',       tier:'bronze', desc:'Reach a 3-day login streak',         metric:'daily_streak', target:3 },
  { id:'streak_7',         name:'Full Week',            tier:'silver', desc:'Reach a 7-day login streak',         metric:'daily_streak', target:7 },
  { id:'streak_30',        name:'Dedicated',            tier:'gold',   desc:'Reach a 30-day login streak',        metric:'daily_streak', target:30 },

  { id:'vip_silver',       name:'Silver VIP',           tier:'silver', desc:'Reach Silver VIP status',            metric:'vip_rank', target:1 },
  { id:'vip_gold',         name:'Gold VIP',             tier:'silver', desc:'Reach Gold VIP status',              metric:'vip_rank', target:2 },
  { id:'vip_diamond',      name:'Diamond VIP',          tier:'gold',   desc:'Reach Diamond VIP status',           metric:'vip_rank', target:4 },

  { id:'rakeback_first',   name:'Cutting In',           tier:'bronze', desc:'Claim rakeback for the first time',  metric:'rakeback_claims', target:1 },
  { id:'cashback_first',   name:'Cashback Collector',   tier:'bronze', desc:'Claim weekly cashback for the first time', metric:'cashback_claims', target:1 },
  { id:'challenge_first',  name:'Mission Ready',        tier:'bronze', desc:'Complete your first challenge',      metric:'challenges_completed', target:1 },
  { id:'challenge_25',     name:'Challenge Veteran',    tier:'gold',   desc:'Complete 25 challenges total',       metric:'challenges_completed', target:25 },

  { id:'referral_first',   name:'Bring a Friend',       tier:'bronze', desc:'Refer your first friend',            metric:'referrals_total', target:1 },
  { id:'referral_5',       name:'Squad Builder',        tier:'silver', desc:'Refer 5 friends',                    metric:'referrals_total', target:5 },
  { id:'referral_20',      name:'Community Pillar',     tier:'gold',   desc:'Refer 20 friends',                   metric:'referrals_total', target:20 },

  { id:'plinko_first',     name:'Gravity Check',        tier:'bronze', desc:'Drop your first Plinko ball',        metric:'plinko_drops', target:1 },
  { id:'plinko_500',       name:'Rainmaker',            tier:'silver', desc:'Drop 500 Plinko balls',              metric:'plinko_drops', target:500 },
  { id:'plinko_100x',      name:'Edge of the Board',    tier:'gold',   desc:'Land a 100x+ Plinko bin',            metric:'plinko_max_mult', target:100 },

  { id:'dice_first',       name:'First Roll',           tier:'bronze', desc:'Win a Dice roll',                    metric:'dice_win_count', target:1 },
  { id:'dice_20x',         name:'Against the Odds',     tier:'silver', desc:'Win a Dice roll at 20x or higher',   metric:'dice_max_mult', target:20 },
  { id:'dice_49x',         name:'Needle Threader',      tier:'gold',   desc:'Win a Dice roll at 49x or higher',   metric:'dice_max_mult', target:49 },

  { id:'tower_first',      name:'First Ascent',         tier:'bronze', desc:'Cash out a Tower climb',             metric:'tower_win_count', target:1 },
  { id:'tower_floor6',     name:'Head for Heights',     tier:'silver', desc:'Cash out from floor 6 or higher',    metric:'tower_best_floor', target:6 },
  { id:'tower_top',        name:'Summit',               tier:'gold',   desc:'Top the tower — clear all 8 floors', metric:'tower_topped_count', target:1 },

  { id:'roulette_first',   name:'Table Service',        tier:'bronze', desc:'Win a Roulette spin',                metric:'roulette_win_count', target:1 },
  { id:'roulette_straight',name:'Called It',            tier:'silver', desc:'Hit a straight number bet',          metric:'roulette_straight_count', target:1 },
  { id:'roulette_100',     name:'Wheel Regular',        tier:'gold',   desc:'Spin the wheel 100 times',           metric:'roulette_spins', target:100 },

  { id:'streak_60',        name:'Two-Month Habit',      tier:'gold',   desc:'Reach a 60-day login streak',        metric:'daily_streak', target:60 },
  { id:'streak_100',       name:'Century Streak',       tier:'gold',   desc:'Reach a 100-day login streak',       metric:'daily_streak', target:100 },
];

/* ---------- State ---------- */
let activeChallenges = [];   // [{id, progress, claimed}]
let challengeDay = 0;
let weeklyChallenge = null;  // {progress, claimed, weekStart}
let lifetimeStats = {
  wins_total:0, wager_GC_life:0, wager_SC_life:0,
  crash_max_mult:0, crash_win_count:0,
  mines_win_count:0, mines_cleared_count:0,
  keno_win_count:0, keno_perfect_count:0,
  bj_blackjack_count:0, bj_hand_count:0, bj_streak_current:0, bj_max_streak:0,
  rakeback_claims:0, cashback_claims:0, challenges_completed:0, referrals_total:0
};
let unlockedAchievements = []; // [id]

/* ---------- Persistence ---------- */
function loadChallengeState(){
  try {
    const raw = localStorage.getItem(CHALLENGES_KEY);
    if(!raw) return;
    const s = JSON.parse(raw);
    activeChallenges = s.activeChallenges || [];
    challengeDay = s.challengeDay ?? 0;
    weeklyChallenge = s.weeklyChallenge || null;
    lifetimeStats = { ...lifetimeStats, ...(s.lifetimeStats || {}) };
    unlockedAchievements = s.unlockedAchievements || [];
  } catch(e){ console.warn('HIT.GG: could not load challenge state', e); }
}
function saveChallengeState(){
  try {
    localStorage.setItem(CHALLENGES_KEY, JSON.stringify({
      activeChallenges, challengeDay, weeklyChallenge, lifetimeStats, unlockedAchievements
    }));
  } catch(e){ /* storage unavailable — demo still works in-memory */ }
}

/* ---------- Daily rotation ---------- */
function seededShuffle(arr, seed){
  const a = [...arr];
  let s = seed;
  for(let i = a.length - 1; i > 0; i--){
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function ensureDailyChallenges(){
  const today = dayIndex(Date.now());
  if(challengeDay === today && activeChallenges.length) return;
  const picked = seededShuffle(CHALLENGE_POOL, today).slice(0, 4);
  activeChallenges = picked.map(t => ({ id:t.id, progress:0, claimed:false }));
  challengeDay = today;
  saveChallengeState();
}
function ensureWeeklyChallenge(){
  const weekStart = currentWeekStart(Date.now());
  if(weeklyChallenge && weeklyChallenge.weekStart === weekStart) return;
  weeklyChallenge = { progress:0, claimed:false, weekStart };
  saveChallengeState();
}

/* ---------- Progress helpers ---------- */
function challengeTemplate(id){ return CHALLENGE_POOL.find(c => c.id === id); }
function bumpChallengeMetric(metric, amount){
  activeChallenges.forEach(c => {
    const t = challengeTemplate(c.id);
    if(t && t.metric === metric && !c.claimed){
      c.progress = Math.min(t.target, c.progress + amount);
      if(c.progress >= t.target) toastChallengeReady(t);
    }
  });
  if(metric === WEEKLY_CHALLENGE_TEMPLATE.metric) {
    ensureWeeklyChallenge();
    if(!weeklyChallenge.claimed){
      weeklyChallenge.progress = Math.min(WEEKLY_CHALLENGE_TEMPLATE.target, weeklyChallenge.progress + amount);
    }
  }
  saveChallengeState();
  renderChallenges();
}

/* ---------- Main event tracker (called from wallet.js / game files) ---------- */
function trackChallenge(type, payload = {}){
  ensureDailyChallenges();
  ensureWeeklyChallenge();

  switch(type){
    case 'wager':
      if(payload.currency === 'GC'){
        bumpChallengeMetric('wager_GC', payload.amount);
        bumpChallengeMetric('wager_GC_week', payload.amount);
        lifetimeStats.wager_GC_life += payload.amount;
      } else if(payload.currency === 'SC'){
        bumpChallengeMetric('wager_SC', payload.amount);
        lifetimeStats.wager_SC_life += payload.amount;
      }
      break;

    case 'crash_cashout':
      lifetimeStats.wins_total++;
      lifetimeStats.crash_win_count++;
      lifetimeStats.crash_max_mult = Math.max(lifetimeStats.crash_max_mult, payload.multiplier || 0);
      bumpChallengeMetric('crash_win', 1);
      if(payload.multiplier >= 3) bumpChallengeMetric('crash_3x', 1);
      if(payload.multiplier >= 5) bumpChallengeMetric('big_win_5x', 1);
      break;

    case 'mines_cashout':
      lifetimeStats.wins_total++;
      lifetimeStats.mines_win_count++;
      if(payload.clearedAll) lifetimeStats.mines_cleared_count++;
      bumpChallengeMetric('mines_win', 1);
      if(payload.multiplier >= 5) bumpChallengeMetric('big_win_5x', 1);
      break;

    case 'keno_draw':
      if(payload.payout > 0){
        lifetimeStats.wins_total++;
        lifetimeStats.keno_win_count++;
        if(payload.hits === payload.picks) lifetimeStats.keno_perfect_count++;
        bumpChallengeMetric('keno_win', 1);
        if(payload.mult >= 5) bumpChallengeMetric('big_win_5x', 1);
      }
      break;

    case 'blackjack_hand':
      lifetimeStats.bj_hand_count++;
      bumpChallengeMetric('bj_hand', 1);
      if(payload.playerBJ) lifetimeStats.bj_blackjack_count++;
      if(payload.kind === 'win'){
        lifetimeStats.wins_total++;
        lifetimeStats.bj_streak_current++;
        lifetimeStats.bj_max_streak = Math.max(lifetimeStats.bj_max_streak, lifetimeStats.bj_streak_current);
        if(payload.mult >= 5) bumpChallengeMetric('big_win_5x', 1);
      } else if(payload.kind === 'lose'){
        lifetimeStats.bj_streak_current = 0;
      }
      break;

    case 'level_up':
      // level metric read live from wallet.js `level`, nothing to bump here
      break;

    case 'daily_claim':
      // streak metric read live from wallet.js `dailyStreak`
      break;

    case 'plinko_land':
      lifetimeStats.plinko_drops = (lifetimeStats.plinko_drops || 0) + 1;
      lifetimeStats.plinko_max_mult = Math.max(lifetimeStats.plinko_max_mult || 0, payload.mult || 0);
      bumpChallengeMetric('plinko_drop', 1);
      if(payload.mult >= 10) bumpChallengeMetric('plinko_10x', 1);
      if(payload.payout > payload.bet){
        lifetimeStats.wins_total++;
        if(payload.mult >= 5) bumpChallengeMetric('big_win_5x', 1);
      }
      break;

    case 'dice_roll':
      lifetimeStats.dice_rolls = (lifetimeStats.dice_rolls || 0) + 1;
      bumpChallengeMetric('dice_roll', 1);
      if(payload.win){
        lifetimeStats.wins_total++;
        lifetimeStats.dice_win_count = (lifetimeStats.dice_win_count || 0) + 1;
        lifetimeStats.dice_max_mult = Math.max(lifetimeStats.dice_max_mult || 0, payload.mult || 0);
        bumpChallengeMetric('dice_win', 1);
        if(payload.mult >= 5) bumpChallengeMetric('big_win_5x', 1);
        if(payload.mult >= 10) bumpChallengeMetric('dice_10x', 1);
      }
      break;

    case 'tower_result':
      lifetimeStats.tower_runs = (lifetimeStats.tower_runs || 0) + 1;
      if(payload.won){
        lifetimeStats.wins_total++;
        lifetimeStats.tower_win_count = (lifetimeStats.tower_win_count || 0) + 1;
        lifetimeStats.tower_best_floor = Math.max(lifetimeStats.tower_best_floor || 0, payload.rows || 0);
        if(payload.topped) lifetimeStats.tower_topped_count = (lifetimeStats.tower_topped_count || 0) + 1;
        bumpChallengeMetric('tower_win', 1);
        if(payload.mult >= 5) bumpChallengeMetric('big_win_5x', 1);
      }
      break;

    case 'roulette_spin':
      lifetimeStats.roulette_spins = (lifetimeStats.roulette_spins || 0) + 1;
      bumpChallengeMetric('roulette_spin', 1);
      if(payload.win){
        lifetimeStats.wins_total++;
        lifetimeStats.roulette_win_count = (lifetimeStats.roulette_win_count || 0) + 1;
        if(payload.straightHit){
          lifetimeStats.roulette_straight_count = (lifetimeStats.roulette_straight_count || 0) + 1;
          bumpChallengeMetric('roulette_straight', 1);
        }
        const mult = payload.bet > 0 ? payload.payout / payload.bet : 0;
        if(mult >= 5) bumpChallengeMetric('big_win_5x', 1);
      }
      break;

    case 'rakeback_claim':
      lifetimeStats.rakeback_claims++;
      break;

    case 'cashback_claim':
      lifetimeStats.cashback_claims++;
      break;

    case 'referral_signup':
      lifetimeStats.referrals_total = (lifetimeStats.referrals_total || 0) + 1;
      break;
  }

  saveChallengeState();
  checkAchievements();
  renderChallenges();
  renderAchievements();
}

/* ---------- Claiming challenge rewards ---------- */
function claimChallenge(id){
  const c = activeChallenges.find(c => c.id === id);
  const t = challengeTemplate(id);
  if(!c || !t || c.claimed || c.progress < t.target) return;
  c.claimed = true;
  grantReward('GC', t.reward.gc || 0);
  if(t.reward.sc) grantReward('SC', t.reward.sc);
  lifetimeStats.challenges_completed++;
  saveChallengeState();
  if(typeof fireConfetti === 'function') fireConfetti(50);
  checkAchievements();
  renderChallenges();
}
function claimWeeklyChallenge(){
  ensureWeeklyChallenge();
  const t = WEEKLY_CHALLENGE_TEMPLATE;
  if(!weeklyChallenge || weeklyChallenge.claimed || weeklyChallenge.progress < t.target) return;
  weeklyChallenge.claimed = true;
  grantReward('GC', t.reward.gc || 0);
  if(t.reward.sc) grantReward('SC', t.reward.sc);
  lifetimeStats.challenges_completed++;
  saveChallengeState();
  if(typeof fireConfetti === 'function') fireConfetti(70);
  checkAchievements();
  renderChallenges();
}
function grantReward(cur, amount){
  if(!amount) return;
  const prevCurrency = currency;
  currency = cur;
  adjustBalance(amount);
  currency = prevCurrency;
  updateBalanceDisplay(true);
}

/* ---------- Achievements ---------- */
function liveMetricValue(metric){
  switch(metric){
    case 'level': return typeof level !== 'undefined' ? level : 0;
    case 'daily_streak': return typeof dailyStreak !== 'undefined' ? dailyStreak : 0;
    case 'vip_rank': {
      if(typeof vipTierForLevel !== 'function' || typeof level === 'undefined') return 0;
      return VIP_TIERS.findIndex(t => t.id === vipTierForLevel(level).id);
    }
    default: return lifetimeStats[metric] ?? 0;
  }
}
function checkAchievements(){
  ACHIEVEMENTS.forEach(a => {
    if(unlockedAchievements.includes(a.id)) return;
    if(liveMetricValue(a.metric) >= a.target){
      unlockedAchievements.push(a.id);
      toastAchievementUnlocked(a);
    }
  });
  saveChallengeState();
}

/* ---------- Toasts ---------- */
function toastChallengeReady(template){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = 'toast toast-challenge';
  t.innerHTML = `<b>Challenge complete!</b><span>${template.desc} — claim your reward</span>`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3400);
}
function toastAchievementUnlocked(a){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = `toast toast-achievement tier-${a.tier}`;
  t.innerHTML = `<b>🏅 ${a.name}</b><span>${a.desc}</span>`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3800);
}

/* ---------- Rendering ---------- */
function renderChallenges(){
  const wrap = document.getElementById('challenges-list');
  if(!wrap) return;
  ensureDailyChallenges();
  wrap.innerHTML = activeChallenges.map(c => {
    const t = challengeTemplate(c.id);
    if(!t) return '';
    const pct = Math.min(100, (c.progress / t.target) * 100);
    const done = c.progress >= t.target;
    return `
      <div class="challenge-card${done ? ' done' : ''}${c.claimed ? ' claimed' : ''}">
        <div class="ch-desc">${t.desc}</div>
        <div class="ch-bar"><div class="ch-fill" style="width:${pct}%"></div></div>
        <div class="ch-row">
          <small>${Math.floor(c.progress).toLocaleString()} / ${t.target.toLocaleString()}</small>
          <span class="ch-reward">${t.reward.gc ? `+${t.reward.gc.toLocaleString()} GC` : ''}${t.reward.sc ? ` +${t.reward.sc} SC` : ''}</span>
        </div>
        ${c.claimed
          ? `<button class="btn btn-ghost" disabled>Claimed</button>`
          : `<button class="btn btn-gold" ${done ? '' : 'disabled'} onclick="claimChallenge('${c.id}')">${done ? 'Claim' : 'In progress'}</button>`}
      </div>`;
  }).join('');

  const wWrap = document.getElementById('weekly-challenge');
  if(wWrap){
    ensureWeeklyChallenge();
    const t = WEEKLY_CHALLENGE_TEMPLATE;
    const pct = Math.min(100, (weeklyChallenge.progress / t.target) * 100);
    const done = weeklyChallenge.progress >= t.target;
    wWrap.innerHTML = `
      <div class="challenge-card weekly${done ? ' done' : ''}${weeklyChallenge.claimed ? ' claimed' : ''}">
        <span class="ch-tag">Weekly</span>
        <div class="ch-desc">${t.desc}</div>
        <div class="ch-bar"><div class="ch-fill" style="width:${pct}%"></div></div>
        <div class="ch-row">
          <small>${Math.floor(weeklyChallenge.progress).toLocaleString()} / ${t.target.toLocaleString()}</small>
          <span class="ch-reward">+${t.reward.gc.toLocaleString()} GC +${t.reward.sc} SC</span>
        </div>
        ${weeklyChallenge.claimed
          ? `<button class="btn btn-ghost" disabled>Claimed</button>`
          : `<button class="btn btn-gold" ${done ? '' : 'disabled'} onclick="claimWeeklyChallenge()">${done ? 'Claim' : 'In progress'}</button>`}
      </div>`;
  }
  if(typeof refreshChallengesDot === 'function') refreshChallengesDot();
}
function renderAchievements(){
  const wrap = document.getElementById('achievements-grid');
  if(!wrap) return;
  wrap.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = unlockedAchievements.includes(a.id);
    const val = liveMetricValue(a.metric);
    const pct = Math.min(100, (val / a.target) * 100);
    return `
      <div class="ach-card tier-${a.tier}${unlocked ? ' unlocked' : ''}" title="${a.desc}">
        <div class="ach-icon">${unlocked ? '🏅' : '🔒'}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
        ${!unlocked ? `<div class="ach-bar"><div class="ach-fill" style="width:${pct}%"></div></div>` : ''}
      </div>`;
  }).join('');
  const countEl = document.getElementById('ach-count');
  if(countEl) countEl.textContent = `${unlockedAchievements.length} / ${ACHIEVEMENTS.length}`;
}

/* ---------- Init ---------- */
loadChallengeState();
document.addEventListener('DOMContentLoaded', () => {
  ensureDailyChallenges();
  ensureWeeklyChallenge();
  checkAchievements();
  renderChallenges();
  renderAchievements();
});
