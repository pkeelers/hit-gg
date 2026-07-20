/* ============================================================
   WALLET / ECONOMY CORE
   Balances, currency switching, XP & leveling, rakeback accrual,
   daily login bonuses, and the entry points for real-money rails
   (Stripe checkout + crypto deposits) — those two are stubbed
   with clearly marked TODOs for you to wire to a backend.
   ============================================================ */

const STORAGE_KEY = 'hitgg_state_v1';

let currency = 'GC';
let balances = { GC: 10000, SC: 25 };

/* ---------- Leveling ---------- */
const XP_PER_LEVEL_BASE = 500;     // xp required to clear level 1
const XP_LEVEL_GROWTH   = 1.16;    // each level needs ~16% more xp than the last
const MAX_LEVEL          = 100;
let xp = 0;
let level = 1;

/* ---------- Rakeback ---------- */
let rakebackBalance = { GC: 0, SC: 0 };
let rakebackLifetime = { GC: 0, SC: 0 };

/* ---------- Daily bonus ---------- */
let dailyStreak = 0;
let lastDailyClaim = 0; // ms epoch, 0 = never claimed

/* ---------- Referrals ---------- */
// TODO: Backend — referral codes, invite tracking, and fraud checks (self-referral,
// duplicate device/IP) must all be verified server-side before any bonus is paid out.
let referral = { code: '', invited: 0, earningsGC: 0, earningsSC: 0 };

/* ---------- Boosted rakeback weekends ---------- */
// TODO: Backend — the boost schedule/multiplier should be config the server controls
// (so it can be promo'd, extended, or paused) rather than a fixed client-side rule.
const RAKEBACK_BOOST_MULT = 2;
function boostWeekendWindow(ts){
  // Boost runs Fri 00:00 UTC through Sun 23:59:59 UTC, every week.
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // 0=Mon .. 6=Sun
  const startOfWeek = new Date(ts); startOfWeek.setUTCHours(0,0,0,0); startOfWeek.setUTCDate(startOfWeek.getUTCDate() - day);
  const start = new Date(startOfWeek); start.setUTCDate(start.getUTCDate() + 4); // Friday
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 3); // Monday 00:00 (exclusive)
  return { start: start.getTime(), end: end.getTime() };
}
function boostWeekendStatus(ts = Date.now()){
  const { start, end } = boostWeekendWindow(ts);
  if(ts >= start && ts < end) return { active:true, endsAt:end };
  const next = ts < start ? start : boostWeekendWindow(end + 1).start;
  return { active:false, startsAt:next };
}
function renderBoostBanner(){
  const el = document.getElementById('boost-banner');
  if(!el) return;
  const s = boostWeekendStatus();
  if(!s.active){ el.classList.remove('active'); return; }
  el.classList.add('active');
  const msLeft = s.endsAt - Date.now();
  const h = Math.floor(msLeft/3600000), m = Math.floor((msLeft%3600000)/60000), sec = Math.floor((msLeft%60000)/1000);
  el.innerHTML = `&#9889; <b>${RAKEBACK_BOOST_MULT}x Rakeback Weekend</b> — ends in ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
setInterval(renderBoostBanner, 1000);

/* ---------- Cosmetics (unlocked at milestone levels) ---------- */
// TODO: Backend — cosmetics should live server-side once accounts are real,
// so a client can't grant itself unlocks by editing localStorage.
let unlockedCosmetics = ['avatar_default','cardback_default','rocket_default'];
let equippedCosmetics = { avatar: 'avatar_default', cardback: 'cardback_default', rocket: 'rocket_default' };

/* ---------- Lifetime / weekly wager tracking (VIP + cashback) ---------- */
let totalWageredLifetime = { GC: 0, SC: 0 };
let weeklyWagered = { GC: 0, SC: 0 };
let weekStartTs = Date.now();
let cashbackBalance = { GC: 0, SC: 0 };

/* ---------- Persistence ---------- */
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){ if(!referral.code) referral.code = generateReferralCode(); return; }
    const s = JSON.parse(raw);
    balances = s.balances || balances;
    xp = s.xp ?? 0;
    level = s.level ?? 1;
    rakebackBalance = s.rakebackBalance || rakebackBalance;
    rakebackLifetime = s.rakebackLifetime || rakebackLifetime;
    dailyStreak = s.dailyStreak ?? 0;
    lastDailyClaim = s.lastDailyClaim ?? 0;
    currency = s.currency || 'GC';
    unlockedCosmetics = s.unlockedCosmetics || unlockedCosmetics;
    equippedCosmetics = s.equippedCosmetics || equippedCosmetics;
    totalWageredLifetime = s.totalWageredLifetime || totalWageredLifetime;
    weeklyWagered = s.weeklyWagered || weeklyWagered;
    weekStartTs = s.weekStartTs || weekStartTs;
    cashbackBalance = s.cashbackBalance || cashbackBalance;
    referral = s.referral || referral;
  } catch(e){ console.warn('HIT.GG: could not load saved state', e); }
  if(!referral.code) referral.code = generateReferralCode();
}
function saveState(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      balances, xp, level, rakebackBalance, rakebackLifetime, dailyStreak, lastDailyClaim, currency,
      unlockedCosmetics, equippedCosmetics, totalWageredLifetime, weeklyWagered, weekStartTs, cashbackBalance, referral
    }));
  } catch(e){ /* storage full or unavailable — demo still works in-memory */ }
}

/* ---------- XP curve ---------- */
function xpForLevel(lvl){
  // total xp needed to go from `lvl` to `lvl+1`
  return Math.round(XP_PER_LEVEL_BASE * Math.pow(XP_LEVEL_GROWTH, lvl - 1));
}
function xpIntoCurrentLevel(){
  let remaining = xp;
  let lvl = 1;
  while(lvl < level){ remaining -= xpForLevel(lvl); lvl++; }
  return Math.max(0, remaining);
}
/* Rakeback = a percentage OF THE HOUSE EDGE on every wager, credited
   instantly — the Shuffle/Rainbet model. All originals run ~1% edge,
   so Bronze's 5% works out to 0.05% of turnover. The headline rate
   scales with VIP tier (5% → 12%) plus small permanent level perks. */
const RAKEBACK_HOUSE_EDGE = 0.01; // all originals target ~99% RTP
function rakebackRateForLevel(lvl){
  const base = vipTierForLevel(lvl).rakebackRate;
  const perkBonus = LEVEL_PERKS.filter(p => p.type === 'rakeback_boost' && lvl >= p.level)
    .reduce((sum, p) => sum + p.value, 0);
  return Math.min(0.15, base + perkBonus);
}

/* ---------- Level perks & cosmetic unlocks ----------
   Purely reward-based milestones — nothing here is time-limited or
   framed as "use it or lose it". Perks and cosmetics are earned by
   playing and stay earned. */
const LEVEL_PERKS = [
  { level:10, type:'rakeback_boost', value:0.005, label:'+0.5% permanent rakeback' },
  { level:25, type:'cashback_boost', value:0.01,  label:'+1% weekly cashback rate' },
  { level:50, type:'rakeback_boost', value:0.01,  label:'+1% permanent rakeback' },
  { level:75, type:'cashback_boost', value:0.015, label:'+1.5% weekly cashback rate' },
];
function cashbackPerkBonus(lvl){
  return LEVEL_PERKS.filter(p => p.type === 'cashback_boost' && lvl >= p.level)
    .reduce((sum, p) => sum + p.value, 0);
}

const COSMETIC_CATALOG = [
  { level:5,   id:'avatar_bronze_ring',    type:'avatar',  name:'Bronze Ring' },
  { level:10,  id:'rocket_comet',          type:'rocket',  name:'Comet Trail' },
  { level:15,  id:'cardback_emerald',      type:'cardback',name:'Emerald Weave' },
  { level:20,  id:'avatar_silver_ring',    type:'avatar',  name:'Silver Ring' },
  { level:25,  id:'rocket_aurora',         type:'rocket',  name:'Aurora Trail' },
  { level:30,  id:'cardback_royal',        type:'cardback',name:'Royal Purple' },
  { level:40,  id:'avatar_gold_ring',      type:'avatar',  name:'Gold Ring' },
  { level:50,  id:'rocket_phoenix',        type:'rocket',  name:'Phoenix Trail' },
  { level:60,  id:'cardback_starlit',      type:'cardback',name:'Starlit' },
  { level:75,  id:'avatar_platinum_ring',  type:'avatar',  name:'Platinum Ring' },
  { level:90,  id:'rocket_nova',           type:'rocket',  name:'Nova Trail' },
  { level:100, id:'avatar_diamond_crown',  type:'avatar',  name:'Diamond Crown' },
  { level:100, id:'cardback_eternal_gold', type:'cardback',name:'Eternal Gold' },
];
function equipCosmetic(type, id){
  if(!unlockedCosmetics.includes(id)) return false;
  equippedCosmetics[type] = id;
  saveState();
  renderProfileCosmetics?.();
  return true;
}

function addXP(wagerAmount){
  if(currency !== 'GC' && currency !== 'SC') return;
  // XP earned is currency-agnostic: 1 XP per unit wagered (SC wagers are worth far
  // more per-unit than GC in a real build — tune this multiplier to your economy)
  const gained = currency === 'SC' ? wagerAmount * 20 : wagerAmount;
  xp += gained;
  let leveledUp = false;
  while(level < MAX_LEVEL && xpIntoCurrentLevel() >= xpForLevel(level)){
    level++;
    leveledUp = true;
    grantLevelUpReward(level);
  }
  renderLevelBar();
  if(leveledUp){
    announceLevelUp(level);
    playSound?.('levelup');
    renderTopbarAvatar?.();   // border / avatar unlocks may have changed
    if(typeof fireConfetti === 'function') fireConfetti(60);
  }
}

function grantLevelUpReward(newLevel){
  // Every level: a small GC drip. Every 5th level: a bigger GC award + a pinch of SC.
  const gcReward = 250 + newLevel * 40;
  balances.GC += gcReward;
  let scReward = 0;
  if(newLevel % 5 === 0){
    scReward = +(newLevel * 0.15).toFixed(2);
    balances.SC += scReward;
  }

  const newCosmetics = COSMETIC_CATALOG.filter(c => c.level === newLevel);
  newCosmetics.forEach(c => { if(!unlockedCosmetics.includes(c.id)) unlockedCosmetics.push(c.id); });

  const newPerks = LEVEL_PERKS.filter(p => p.level === newLevel);

  pushLevelReward(newLevel, gcReward, scReward, newCosmetics, newPerks);
  if(typeof trackChallenge === 'function') trackChallenge('level_up', { level: newLevel });
}

/* ---------- Currency / balance display ---------- */
function setCurrency(c){
  currency = c;
  document.getElementById('btn-gc').classList.toggle('active', c==='GC');
  document.getElementById('btn-sc').classList.toggle('active', c==='SC');
  updateBalanceDisplay();
  saveState();
  if(typeof PLGraph !== 'undefined') PLGraph.refresh();
}
function updateBalanceDisplay(pulse=false){
  const el = document.getElementById('balance-display');
  if(!el) return;
  el.textContent = balances[currency].toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  if(pulse){
    const pill = document.getElementById('balance-pill');
    pill.classList.remove('pulse'); void pill.offsetWidth; pill.classList.add('pulse');
  }
}

function takeBet(amount){
  if(amount > balances[currency]){
    // Bets can only spend unlocked funds — vaulted coins never count.
    const vaulted = (typeof Vault !== 'undefined') && Vault.balance(currency) > 0;
    alert(vaulted
      ? `Not enough unlocked ${currency}. Unlock your Vault or top up from "Get Coins".`
      : `Not enough ${currency}. Top up from "Get Coins" to keep playing.`);
    return false;
  }
  balances[currency] -= amount;
  accrueRakeback(amount);
  addXP(amount);
  totalWageredLifetime[currency] += amount;
  checkWeekRollover();
  weeklyWagered[currency] += amount;
  updateBalanceDisplay(true);
  saveState();
  if(typeof trackChallenge === 'function') trackChallenge('wager', { amount, currency });
  return true;
}
function adjustBalance(amount){
  balances[currency] += amount;
  updateBalanceDisplay(true);
  saveState();
}

/* ---------- Rakeback ---------- */
function accrueRakeback(wagerAmount){
  let rate = rakebackRateForLevel(level);
  if(boostWeekendStatus().active) rate *= RAKEBACK_BOOST_MULT;
  // rate is a share of the house's take, not of the wager itself
  const cut = +(wagerAmount * RAKEBACK_HOUSE_EDGE * rate).toFixed(6);
  rakebackBalance[currency] += cut;
  rakebackLifetime[currency] += cut;
  renderRakebackPanel();
}
function claimRakeback(){
  const claimable = rakebackBalance[currency];
  if(claimable <= 0){ alert('No rakeback to claim yet — it accrues as you play.'); return; }
  balances[currency] += claimable;
  rakebackBalance[currency] = 0;
  updateBalanceDisplay(true);
  renderRakebackPanel();
  saveState();
  if(typeof fireConfetti === 'function') fireConfetti(30);
  if(typeof trackChallenge === 'function') trackChallenge('rakeback_claim', {});
}
function renderRakebackPanel(){
  const rateEl = document.getElementById('rb-rate');
  const balEl = document.getElementById('rb-balance');
  const lifeEl = document.getElementById('rb-lifetime');
  if(!rateEl) return;
  const boosted = boostWeekendStatus().active;
  const rate = rakebackRateForLevel(level) * (boosted ? RAKEBACK_BOOST_MULT : 1);
  rateEl.textContent = (rate * 100).toFixed(1) + '%' + (boosted ? ' (2x boost live)' : '');
  rateEl.title = 'Of the house edge on every bet, credited instantly';
  balEl.textContent = rakebackBalance[currency].toFixed(2) + ' ' + currency;
  lifeEl.textContent = rakebackLifetime[currency].toFixed(2) + ' ' + currency;
  const btn = document.getElementById('rb-claim-btn');
  if(btn) btn.disabled = rakebackBalance[currency] <= 0;
}

/* ============================================================
   VIP / LOYALTY TIERS
   Five tiers based on level (a proxy for total play). Each tier
   is earned by playing and, once reached, never expires or resets.
   ============================================================ */
const VIP_TIERS = [
  { id:'bronze',   name:'Bronze',   minLevel:1,  rakebackRate:0.05,  cashbackRate:0.02, perk:'5% instant rakeback · weekly cashback' },
  { id:'silver',   name:'Silver',   minLevel:15, rakebackRate:0.065, cashbackRate:0.03, perk:'6.5% rakeback · priority support' },
  { id:'gold',     name:'Gold',     minLevel:30, rakebackRate:0.08,  cashbackRate:0.04, perk:'8% rakeback · monthly bonus drop' },
  { id:'platinum', name:'Platinum', minLevel:50, rakebackRate:0.10,  cashbackRate:0.05, perk:'10% rakeback · dedicated host' },
  { id:'diamond',  name:'Diamond',  minLevel:75, rakebackRate:0.12,  cashbackRate:0.06, perk:'12% rakeback · custom bonus drops' },
];
function vipTierForLevel(lvl){
  let tier = VIP_TIERS[0];
  for(const t of VIP_TIERS){ if(lvl >= t.minLevel) tier = t; }
  return tier;
}
function nextVipTier(lvl){
  return VIP_TIERS.find(t => t.minLevel > lvl) || null;
}
function renderVipPanel(){
  const wrap = document.getElementById('vip-panel');
  if(!wrap) return;
  const tier = vipTierForLevel(level);
  const next = nextVipTier(level);
  wrap.innerHTML = `
    <div class="vip-current vip-${tier.id}">
      <span class="vip-badge">${tier.name}</span>
      <p>${tier.perk}</p>
    </div>
    ${next ? `
      <div class="vip-progress">
        <div class="bar"><div class="fill" style="width:${Math.min(100, (level/next.minLevel)*100)}%"></div></div>
        <small>Level ${level} / ${next.minLevel} to reach ${next.name}</small>
      </div>` : `<small>You've reached the top loyalty tier.</small>`}
    <div class="vip-tier-list">
      ${VIP_TIERS.map(t => `
        <div class="vip-tier-row${t.id===tier.id?' active':''}${level>=t.minLevel?' unlocked':''}">
          <b>${t.name}</b><span>Lv.${t.minLevel}+</span><small>${t.perk}</small>
        </div>`).join('')}
    </div>`;
}

/* ============================================================
   WEEKLY CASHBACK
   A flat, always-claimable percentage of what you wagered the
   previous week, based on VIP tier. Rolls over automatically —
   intentionally no countdown timer or "expires soon" pressure.
   ============================================================ */
function currentWeekStart(ts){
  // Rolls over every Monday 00:00 UTC.
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() - day);
  return d.getTime();
}
function checkWeekRollover(){
  const thisWeek = currentWeekStart(Date.now());
  if(thisWeek > weekStartTs){
    const tier = vipTierForLevel(level);
    const rate = tier.cashbackRate + cashbackPerkBonus(level);
    ['GC','SC'].forEach(cur => {
      if(weeklyWagered[cur] > 0){
        cashbackBalance[cur] += +(weeklyWagered[cur] * rate).toFixed(4);
      }
      weeklyWagered[cur] = 0;
    });
    weekStartTs = thisWeek;
    saveState();
  }
}
function claimCashback(){
  const claimable = cashbackBalance[currency];
  if(claimable <= 0){ alert('No cashback ready yet — it\'s calculated from last week\'s play and lands here each Monday.'); return; }
  balances[currency] += claimable;
  cashbackBalance[currency] = 0;
  updateBalanceDisplay(true);
  renderCashbackPanel();
  saveState();
  if(typeof fireConfetti === 'function') fireConfetti(30);
  if(typeof trackChallenge === 'function') trackChallenge('cashback_claim', {});
}
function renderCashbackPanel(){
  checkWeekRollover();
  const rateEl = document.getElementById('cb-rate');
  const wageredEl = document.getElementById('cb-wagered');
  const balEl = document.getElementById('cb-balance');
  const btn = document.getElementById('cb-claim-btn');
  if(!rateEl) return;
  const tier = vipTierForLevel(level);
  const rate = tier.cashbackRate + cashbackPerkBonus(level);
  rateEl.textContent = (rate * 100).toFixed(1) + '%';
  wageredEl.textContent = weeklyWagered[currency].toLocaleString(undefined,{maximumFractionDigits:2}) + ' ' + currency + ' wagered so far this week';
  balEl.textContent = cashbackBalance[currency].toFixed(2) + ' ' + currency;
  if(btn) btn.disabled = cashbackBalance[currency] <= 0;
}

/* ---------- Daily bonus ---------- */
function dayIndex(ts){ return Math.floor(ts / 86400000); }
function dailyBonusAvailable(){
  if(!lastDailyClaim) return true;
  return dayIndex(Date.now()) > dayIndex(lastDailyClaim);
}
function dailyBonusForDay(streakDay){
  // 7-day escalating cycle, then repeats
  const cycle = ((streakDay - 1) % 7) + 1;
  const gc = 100 * cycle * cycle;
  const sc = cycle === 7 ? 2 : 0;
  return { gc, sc, day: cycle };
}
/* Streak milestones: bonus on top of the daily cycle reward the longer a streak runs.
   Each milestone only pays out once per time it's reached (tracked in lifetimeStats via
   the 'streak_milestone_<n>' pattern isn't needed since streak only grows forward while
   unbroken — hitting 30 always means 3/7/14 were already paid this run). */
const STREAK_MILESTONES = [
  { days:3,   gc:500,   sc:0,   label:'3-Day Streak' },
  { days:7,   gc:1500,  sc:2,   label:'7-Day Streak' },
  { days:14,  gc:3500,  sc:4,   label:'14-Day Streak' },
  { days:30,  gc:9000,  sc:10,  label:'30-Day Streak' },
  { days:60,  gc:20000, sc:20,  label:'60-Day Streak' },
  { days:100, gc:40000, sc:40,  label:'100-Day Legend' },
];
// A lapsed player's streak still resets to 1 (predictable, no special-casing that
// feels like punishment) but coming back after a longer break gets a flat "welcome
// back" top-up so the reset doesn't feel like a total loss.
function comebackBonusFor(daysAway){
  if(daysAway >= 14) return { gc:3000, sc:2 };
  if(daysAway >= 7)  return { gc:1200, sc:0.5 };
  if(daysAway >= 3)  return { gc:400,  sc:0 };
  return null;
}
function claimDailyBonus(){
  if(!dailyBonusAvailable()){ return; }
  const daysAway = lastDailyClaim ? dayIndex(Date.now()) - dayIndex(lastDailyClaim) : 0;
  const missedAStreakDay = lastDailyClaim && daysAway > 1;
  const comeback = missedAStreakDay ? comebackBonusFor(daysAway) : null;
  dailyStreak = missedAStreakDay ? 1 : dailyStreak + 1;
  lastDailyClaim = Date.now();
  const reward = dailyBonusForDay(dailyStreak);
  balances.GC += reward.gc;
  if(reward.sc) balances.SC += reward.sc;
  if(comeback){ balances.GC += comeback.gc; if(comeback.sc) balances.SC += comeback.sc; }

  const milestone = STREAK_MILESTONES.find(m => m.days === dailyStreak);
  if(milestone){
    balances.GC += milestone.gc;
    if(milestone.sc) balances.SC += milestone.sc;
  }

  updateBalanceDisplay(true);
  saveState();
  renderDailyBonusUI();
  if(milestone){
    if(typeof fireConfetti === 'function') fireConfetti(140);
    toastStreakMilestone(milestone);
  } else if(comeback){
    if(typeof fireConfetti === 'function') fireConfetti(70);
    toastComeback(comeback);
  } else if(typeof fireConfetti === 'function') fireConfetti(reward.sc ? 90 : 45);
  if(typeof trackChallenge === 'function') trackChallenge('daily_claim', { streak: dailyStreak });
  return { ...reward, milestone, comeback };
}
function toastComeback(c){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = 'toast toast-reward toast-comeback';
  t.innerHTML = `<b>&#128075; Welcome back!</b><span>+${c.gc.toLocaleString()} GC${c.sc ? ` +${c.sc} SC` : ''} to get you going again</span>`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 4000);
}
function toastStreakMilestone(m){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = 'toast toast-reward toast-milestone';
  t.innerHTML = `<b>&#128293; ${m.label}!</b><span>Bonus +${m.gc.toLocaleString()} GC${m.sc ? ` +${m.sc} SC` : ''}</span>`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 4200);
}

/* ============================================================
   REFERRAL SYSTEM
   Both sides win: the invitee gets a signup bonus for using a code,
   the inviter gets a bonus once that friend plays. Demo simulates
   a friend accepting the invite client-side — replace with a real
   invite-accepted webhook/event from your backend.
   ============================================================ */
const REFERRAL_INVITER_REWARD = { gc: 2500, sc: 3 };
const REFERRAL_INVITEE_REWARD = { gc: 1000, sc: 1 };
function generateReferralCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HIT-';
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}
function getReferralLink(){
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}login.html?ref=${referral.code}`;
}
function copyReferralLink(){
  const link = getReferralLink();
  navigator.clipboard?.writeText(link).catch(()=>{});
  const btn = document.getElementById('ref-copy-btn');
  if(btn){ const orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(()=>btn.textContent = orig, 1200); }
}
function shareReferralLink(){
  const link = getReferralLink();
  const text = `Join me on HIT.GG — free-play social casino. Use my link and we both get a bonus: ${link}`;
  if(navigator.share){ navigator.share({ title:'HIT.GG', text, url: link }).catch(()=>{}); }
  else copyReferralLink();
}
// TODO: Backend — call this from a real "friend signed up with your code and placed
// a first bet" event, not a client button. Left here as a demo trigger only.
function simulateReferralSignup(){
  referral.invited += 1;
  referral.earningsGC += REFERRAL_INVITER_REWARD.gc;
  referral.earningsSC += REFERRAL_INVITER_REWARD.sc;
  balances.GC += REFERRAL_INVITER_REWARD.gc;
  balances.SC += REFERRAL_INVITER_REWARD.sc;
  updateBalanceDisplay(true);
  saveState();
  renderReferralPanel();
  if(typeof fireConfetti === 'function') fireConfetti(80);
  pushLevelReward('Referral', REFERRAL_INVITER_REWARD.gc, REFERRAL_INVITER_REWARD.sc, [], [{label:`A friend joined with your link — thanks for spreading the word!`}]);
  if(typeof trackChallenge === 'function') trackChallenge('referral_signup', {});
}
function renderReferralPanel(){
  const codeEl = document.getElementById('ref-code');
  const linkEl = document.getElementById('ref-link');
  const invitedEl = document.getElementById('ref-invited');
  const earnedEl = document.getElementById('ref-earned');
  if(!codeEl) return;
  codeEl.textContent = referral.code;
  linkEl.textContent = getReferralLink();
  invitedEl.textContent = referral.invited;
  earnedEl.textContent = `${referral.earningsGC.toLocaleString()} GC + ${referral.earningsSC.toFixed(2)} SC`;
}

/* ---------- Toasts ---------- */
function ensureToastLayer(){
  let l = document.getElementById('toast-layer');
  if(!l){
    l = document.createElement('div');
    l.id = 'toast-layer';
    l.className = 'toast-layer';
    document.body.appendChild(l);
  }
  return l;
}
function announceLevelUp(newLevel){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = 'toast toast-level';
  t.innerHTML = `<b>Level ${newLevel}</b><span>Rewards added to your balance</span>`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3200);
}
function pushLevelReward(newLevel, gc, sc, cosmetics=[], perks=[]){
  const layer = ensureToastLayer();
  const t = document.createElement('div');
  t.className = 'toast toast-reward';
  const extras = [
    ...cosmetics.map(c => `<span class="unlock-line">🎨 Unlocked: ${c.name}</span>`),
    ...perks.map(p => `<span class="unlock-line">⭐ ${p.label}</span>`)
  ].join('');
  t.innerHTML = `<b>+${gc.toLocaleString()} GC</b>${sc ? ` <b class="sc">+${sc.toFixed(2)} SC</b>` : ''}<span>Level ${newLevel} reward</span>${extras}`;
  layer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3800);
}

/* ---------- Level bar UI ---------- */
function renderLevelBar(){
  const badge = document.getElementById('level-badge');
  const fill = document.getElementById('level-fill');
  const label = document.getElementById('level-xp-label');
  if(!badge) return;
  badge.textContent = 'Lv.' + level;
  const into = xpIntoCurrentLevel();
  const need = xpForLevel(level);
  fill.style.width = level >= MAX_LEVEL ? '100%' : Math.min(100, (into/need)*100) + '%';
  label.textContent = level >= MAX_LEVEL ? 'Max level' : `${Math.floor(into).toLocaleString()} / ${need.toLocaleString()} XP`;
}

/* ---------- Confetti ---------- */
function fireConfetti(count=50){
  let layer = document.querySelector('.confetti-layer');
  if(!layer){
    layer = document.createElement('div');
    layer.className = 'confetti-layer';
    document.body.appendChild(layer);
  }
  const colors = ['#f2b90c','#f7d264','#8b5cf6','#2dd4bf','#ff4d6d'];
  for(let i=0;i<count;i++){
    const c = document.createElement('div');
    c.className = 'confetto';
    c.style.left = Math.random()*100 + 'vw';
    c.style.background = colors[Math.floor(Math.random()*colors.length)];
    c.style.animationDuration = (1.2 + Math.random()*1.2) + 's';
    c.style.animationDelay = (Math.random()*0.3) + 's';
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    layer.appendChild(c);
    setTimeout(()=>c.remove(), 2800);
  }
}

/* ============================================================
   PAYMENTS — Stripe (GC/SC packages) + Crypto deposit (SC)
   Both are intentionally stubbed. Nothing here moves real money.
   Replace the TODO sections with real calls to your backend.
   ============================================================ */

const GC_PACKAGES = [
  { id:'gc_starter',  gc:5000,   sc:0,    price:4.99  },
  { id:'gc_popular',  gc:25000,  sc:5,    price:19.99, tag:'Popular' },
  { id:'gc_value',    gc:60000,  sc:15,   price:39.99  },
  { id:'gc_whale',    gc:150000, sc:45,   price:99.99, tag:'Best value' },
];
const CRYPTO_COINS = ['BTC','ETH','USDC','LTC'];

async function startStripeCheckout(packageId){
  const pkg = GC_PACKAGES.find(p => p.id === packageId);
  if(!pkg) return;
  const btn = document.getElementById('checkout-btn-' + packageId);
  if(btn){ btn.disabled = true; btn.textContent = 'Redirecting…'; }

  // ---- TODO: wire to your backend ----
  // Create a Checkout Session server-side (never expose secret keys client-side):
  //
  //   const res = await fetch('/api/checkout/stripe', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ packageId: pkg.id })
  //   });
  //   const { url } = await res.json();
  //   window.location.href = url; // Stripe-hosted Checkout page
  //
  // On success, your webhook handler (/api/webhooks/stripe, verifying the
  // stripe-signature header) should credit `pkg.gc` GC and `pkg.sc` SC to the
  // user's server-side balance — never trust a client-side credit for real money.

  await new Promise(r => setTimeout(r, 700)); // simulated network round-trip
  if(btn){ btn.disabled = false; btn.textContent = `$${pkg.price}`; }
  alert(
    `[Demo] This would redirect to Stripe Checkout for ${pkg.gc.toLocaleString()} GC` +
    (pkg.sc ? ` + ${pkg.sc} SC bonus` : '') +
    ` ($${pkg.price}).\n\nWire startStripeCheckout() in js/wallet.js to your backend's ` +
    `/api/checkout/stripe endpoint to go live.`
  );
}

async function startCryptoDeposit(coin){
  const addrBox = document.getElementById('crypto-address-box');
  const label = document.getElementById('crypto-selected-coin');
  if(label) label.textContent = coin;
  if(addrBox) addrBox.classList.add('loading');

  // ---- TODO: wire to your backend / custody provider ----
  //
  //   const res = await fetch('/api/deposits/crypto', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ coin })
  //   });
  //   const { address, memo, qrCodeUrl, expiresAt } = await res.json();
  //
  // Generate a fresh per-user deposit address (or shared address + memo) via
  // your custody/payment processor (Coinbase Commerce, BitPay, Fireblocks, etc).
  // Credit SC only after your backend confirms N on-chain confirmations —
  // never credit on the client from an unconfirmed transaction.

  await new Promise(r => setTimeout(r, 500)); // simulated network round-trip
  const fakeAddress = '0xDEMO...WIRE-ME-TO-A-REAL-PROCESSOR';
  if(addrBox){
    addrBox.classList.remove('loading');
    addrBox.querySelector('.addr-text').textContent = fakeAddress;
  }
}
function copyCryptoAddress(){
  const text = document.querySelector('#crypto-address-box .addr-text')?.textContent;
  if(!text) return;
  navigator.clipboard?.writeText(text).catch(()=>{});
  const btn = document.getElementById('crypto-copy-btn');
  if(btn){ const orig = btn.textContent; btn.textContent = 'Copied'; setTimeout(()=>btn.textContent = orig, 1200); }
}

loadState();
checkWeekRollover();
renderBoostBanner();
