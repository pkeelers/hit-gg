/* ============================================================
   RANK AVATARS, TITLES & PROFILE
   Visual progression: avatars, animated rank borders, and titles
   unlock at VIP tiers, level milestones, and notable feats — all
   evaluated live from wallet/challenge state, so nothing here can
   fall out of sync. The equipped selection is the only thing
   persisted.

   // TODO: Backend — equipped cosmetics + display name belong on
   // the account record so they follow the player across devices
   // and can be shown to other players (leaderboards, chat, ticker).
   ============================================================ */

const PROFILE_KEY = 'hitgg_profile_v1';
let profileState = { name: 'Guest', avatar: 'av_rookie', title: 't_rookie' };

/* ---------- Avatar catalog ----------
   unlock: { level:N } | { vip:'silver' } | { stat:'metric', target:N } | { start:true } */
const AVATAR_CATALOG = [
  { id:'av_rookie',    emoji:'🎲', name:'Rookie Die',      rarity:'common',    unlock:{ start:true } },
  { id:'av_clover',    emoji:'🍀', name:'Lucky Clover',    rarity:'common',    unlock:{ level:5 } },
  { id:'av_cards',     emoji:'🃏', name:'Card Shark',      rarity:'common',    unlock:{ level:10 } },
  { id:'av_slots',     emoji:'🎰', name:'Reel Spinner',    rarity:'rare',      unlock:{ level:15 } },
  { id:'av_wolf',      emoji:'🐺', name:'Table Wolf',      rarity:'rare',      unlock:{ level:20 } },
  { id:'av_shark',     emoji:'🦈', name:'Pit Shark',       rarity:'rare',      unlock:{ level:30 } },
  { id:'av_dragon',    emoji:'🐉', name:'Vault Dragon',    rarity:'epic',      unlock:{ level:40 } },
  { id:'av_crown',     emoji:'👑', name:'Crowned',         rarity:'epic',      unlock:{ level:50 } },
  { id:'av_bolt',      emoji:'⚡', name:'High Voltage',    rarity:'epic',      unlock:{ level:60 } },
  { id:'av_trident',   emoji:'🔱', name:'Trident',         rarity:'legendary', unlock:{ level:75 } },
  { id:'av_cosmic',    emoji:'🌌', name:'Cosmic',          rarity:'legendary', unlock:{ level:90 } },
  { id:'av_eternal',   emoji:'💠', name:'Eternal',         rarity:'mythic',    unlock:{ level:100 } },

  { id:'av_moon',      emoji:'🌙', name:'Moonlit',         rarity:'rare',      unlock:{ vip:'silver' } },
  { id:'av_sun',       emoji:'☀️', name:'Gilded',          rarity:'epic',      unlock:{ vip:'gold' } },
  { id:'av_oracle',    emoji:'🔮', name:'Platinum Oracle', rarity:'legendary', unlock:{ vip:'platinum' } },
  { id:'av_diamond',   emoji:'💎', name:'Diamond Elite',   rarity:'mythic',    unlock:{ vip:'diamond' } },

  { id:'av_rocket',    emoji:'🚀', name:'Orbital Pilot',   rarity:'rare',      unlock:{ stat:'crash_max_mult', target:10, hint:'Cash out 10x+ on Crash' } },
  { id:'av_dynamite',  emoji:'🧨', name:'Demolitionist',   rarity:'epic',      unlock:{ stat:'mines_cleared_count', target:1, hint:'Clear a full Mines board' } },
  { id:'av_target',    emoji:'🎯', name:'Perfect Eye',     rarity:'epic',      unlock:{ stat:'keno_perfect_count', target:1, hint:'Hit a perfect Keno draw' } },
  { id:'av_fire',      emoji:'🔥', name:'Hot Hand',        rarity:'rare',      unlock:{ stat:'bj_max_streak', target:5, hint:'Win 5 blackjack hands in a row' } },
  { id:'av_medal',     emoji:'🏅', name:'Centurion',       rarity:'epic',      unlock:{ stat:'wins_total', target:100, hint:'Win 100 rounds' } },
];

/* ---------- Titles ---------- */
const TITLE_CATALOG = [
  { id:'t_rookie',    text:'Rookie',          unlock:{ start:true } },
  { id:'t_regular',   text:'Regular',         unlock:{ level:10 } },
  { id:'t_grinder',   text:'The Grinder',     unlock:{ level:25 } },
  { id:'t_highroll',  text:'High Roller',     unlock:{ level:40 } },
  { id:'t_legend',    text:'Legend',          unlock:{ level:75 } },
  { id:'t_immortal',  text:'Immortal',        unlock:{ level:100 } },
  { id:'t_silver',    text:'Silver VIP',      unlock:{ vip:'silver' } },
  { id:'t_gold',      text:'Gold VIP',        unlock:{ vip:'gold' } },
  { id:'t_platinum',  text:'Platinum VIP',    unlock:{ vip:'platinum' } },
  { id:'t_diamond',   text:'Diamond VIP',     unlock:{ vip:'diamond' } },
  { id:'t_whale',     text:'Whale',           unlock:{ stat:'wager_GC_life', target:1000000, hint:'Wager 1,000,000 GC lifetime' } },
  { id:'t_untouch',   text:'Untouchable',     unlock:{ stat:'bj_max_streak', target:5, hint:'Win 5 blackjack hands in a row' } },
];

/* ---------- Unlock evaluation ---------- */
const VIP_ORDER = ['bronze','silver','gold','platinum','diamond'];
function unlockMet(unlock){
  if(unlock.start) return true;
  if(unlock.level) return (typeof level !== 'undefined' ? level : 1) >= unlock.level;
  if(unlock.vip){
    const cur = typeof vipTierForLevel === 'function' ? vipTierForLevel(level).id : 'bronze';
    return VIP_ORDER.indexOf(cur) >= VIP_ORDER.indexOf(unlock.vip);
  }
  if(unlock.stat) return (typeof lifetimeStats !== 'undefined' ? (lifetimeStats[unlock.stat] ?? 0) : 0) >= unlock.target;
  return false;
}
function unlockLabel(unlock){
  if(unlock.start) return 'Starter';
  if(unlock.level) return `Level ${unlock.level}`;
  if(unlock.vip) return unlock.vip.charAt(0).toUpperCase() + unlock.vip.slice(1) + ' VIP';
  if(unlock.stat) return unlock.hint || 'Milestone';
  return '';
}
function avatarById(id){ return AVATAR_CATALOG.find(a => a.id === id) || AVATAR_CATALOG[0]; }
function titleById(id){ return TITLE_CATALOG.find(t => t.id === id) || TITLE_CATALOG[0]; }
function vipBorderClass(){
  const tier = typeof vipTierForLevel === 'function' ? vipTierForLevel(level).id : 'bronze';
  return 'border-' + tier;
}

/* ---------- Persistence ---------- */
function loadProfileState(){
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if(raw) profileState = { ...profileState, ...JSON.parse(raw) };
  } catch(e){ /* fresh profile */ }
  const uname = new URLSearchParams(window.location.search).get('u');
  if(uname) profileState.name = uname;
  // Never leave an avatar equipped that's no longer legit (e.g. cleared storage edge cases)
  if(!unlockMet(avatarById(profileState.avatar).unlock)) profileState.avatar = 'av_rookie';
  if(!unlockMet(titleById(profileState.title).unlock)) profileState.title = 't_rookie';
  saveProfileState();
}
function saveProfileState(){
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profileState)); } catch(e){}
}

/* ---------- Equipping ---------- */
function equipAvatar(id){
  const a = avatarById(id);
  if(!unlockMet(a.unlock)) return;
  profileState.avatar = id;
  saveProfileState();
  renderTopbarAvatar();
  renderProfileModal();
  playSound?.('gem');
  const chip = document.querySelector('.profile-chip .av-frame');
  if(chip) popEl?.(chip);
}
function equipTitle(id){
  const t = titleById(id);
  if(!unlockMet(t.unlock)) return;
  profileState.title = id;
  saveProfileState();
  renderTopbarAvatar();
  renderProfileModal();
  playSound?.('click');
}

/* ---------- Topbar avatar chip ---------- */
function renderTopbarAvatar(){
  const chip = document.querySelector('.profile-chip');
  if(!chip) return;
  const av = avatarById(profileState.avatar);
  const title = titleById(profileState.title);
  chip.innerHTML = `
    <div class="av-frame ${vipBorderClass()} rar-${av.rarity}"><span class="av-emoji">${av.emoji}</span></div>
    <div class="chip-id">
      <span id="profile-name">${escapeHTML(profileState.name)}</span>
      <small class="chip-title">${title.text}</small>
    </div>`;
  chip.onclick = openProfileModal;
}
function escapeHTML(s){ const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ============================================================
   PROFILE MODAL
   ============================================================ */
let profileTab = 'overview';
function openProfileModal(){
  profileTab = 'overview';
  renderProfileModal();
  openModal('modal-profile');
  playSound?.('click');
}
function setProfileTab(tab){
  profileTab = tab;
  renderProfileModal();
  playSound?.('click');
}

function renderProfileModal(){
  const body = document.getElementById('profile-body');
  if(!body) return;
  const av = avatarById(profileState.avatar);
  const title = titleById(profileState.title);
  const tier = vipTierForLevel(level);
  const next = nextVipTier(level);

  // Header showcase — always visible above the tabs
  document.getElementById('profile-showcase').innerHTML = `
    <div class="av-frame lg ${vipBorderClass()} rar-${av.rarity}"><span class="av-emoji">${av.emoji}</span></div>
    <div class="showcase-id">
      <h3>${escapeHTML(profileState.name)}</h3>
      <span class="title-pill">${title.text}</span>
      <div class="showcase-rank">
        <span class="vip-chip vip-${tier.id}">${tier.name}</span>
        <span class="mono lvl">Lv.${level}</span>
      </div>
    </div>
    <button class="btn btn-ghost logout-btn" onclick="if(confirm('Log out?')) window.location.href='login.html'">Log out</button>`;

  document.querySelectorAll('.profile-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === profileTab));

  if(profileTab === 'overview')      body.innerHTML = profileOverviewHTML(tier, next);
  else if(profileTab === 'rank')     body.innerHTML = profileRankHTML();
  else if(profileTab === 'cosmetics')body.innerHTML = profileCosmeticsHTML();
  else if(profileTab === 'referral'){ body.innerHTML = profileReferralHTML(); renderReferralPanel(); }
}

function profileOverviewHTML(tier, next){
  const s = typeof lifetimeStats !== 'undefined' ? lifetimeStats : {};
  const stat = (label, val) => `<div class="stat"><small>${label}</small><b class="mono">${val}</b></div>`;
  return `
    <div class="profile-stats-grid">
      ${stat('Total wins', (s.wins_total ?? 0).toLocaleString())}
      ${stat('GC wagered', Math.floor(totalWageredLifetime.GC).toLocaleString())}
      ${stat('SC wagered', totalWageredLifetime.SC.toFixed(2))}
      ${stat('Best Crash', (s.crash_max_mult ?? 0).toFixed(2) + 'x')}
      ${stat('Mines cleared', s.mines_cleared_count ?? 0)}
      ${stat('BJ best streak', s.bj_max_streak ?? 0)}
      ${stat('Login streak', dailyStreak + 'd')}
      ${stat('Achievements', (typeof unlockedAchievements !== 'undefined' ? unlockedAchievements.length : 0) + ' / ' + (typeof ACHIEVEMENTS !== 'undefined' ? ACHIEVEMENTS.length : 0))}
    </div>
    ${next ? `
      <div class="vip-progress" style="margin-top:16px;">
        <div class="bar"><div class="fill" style="width:${Math.min(100, (level / next.minLevel) * 100)}%"></div></div>
        <small>Level ${level} / ${next.minLevel} — next rank: <b>${next.name}</b> (new border + avatar unlocks)</small>
      </div>` : `<small style="color:var(--text-dim)">Top rank reached — every border and rank avatar is yours.</small>`}
    <div class="profile-links">
      <button class="chip-btn" onclick="closeModal('modal-profile'); openAchievementsModal()">🏆 Achievements</button>
      <button class="chip-btn" onclick="closeModal('modal-profile'); openVipModal()">💎 VIP &amp; Cashback</button>
      <button class="chip-btn" onclick="closeModal('modal-profile'); openChallengesModal()">🎯 Challenges</button>
    </div>`;
}

function profileRankHTML(){
  const avCards = AVATAR_CATALOG.map(a => {
    const unlocked = unlockMet(a.unlock);
    const equipped = profileState.avatar === a.id;
    return `
      <div class="av-card rar-${a.rarity} ${unlocked ? 'unlocked' : 'locked'} ${equipped ? 'equipped' : ''}"
           onclick="${unlocked ? `equipAvatar('${a.id}')` : ''}">
        <div class="av-frame ${unlocked ? vipBorderClass() : ''} rar-${a.rarity}"><span class="av-emoji">${unlocked ? a.emoji : '🔒'}</span></div>
        <b>${a.name}</b>
        <small>${unlocked ? (equipped ? 'Equipped' : 'Tap to equip') : unlockLabel(a.unlock)}</small>
      </div>`;
  }).join('');
  const titleRows = TITLE_CATALOG.map(t => {
    const unlocked = unlockMet(t.unlock);
    const equipped = profileState.title === t.id;
    return `
      <button class="title-row ${unlocked ? '' : 'locked'} ${equipped ? 'equipped' : ''}"
              ${unlocked ? `onclick="equipTitle('${t.id}')"` : 'disabled'}>
        <span>${unlocked ? t.text : '🔒 ' + t.text}</span>
        <small>${unlocked ? (equipped ? 'Equipped' : 'Equip') : unlockLabel(t.unlock)}</small>
      </button>`;
  }).join('');
  return `
    <p class="modal-sub" style="margin-top:0;">Your border is your VIP rank — it upgrades automatically as you climb tiers and shows on everything you equip. Avatars and titles unlock at levels, ranks, and feats.</p>
    <div class="av-grid">${avCards}</div>
    <div class="section-head" style="margin-top:18px;"><h2 style="font-size:15px;">Titles</h2></div>
    <div class="title-list">${titleRows}</div>`;
}

function profileCosmeticsHTML(){
  const groups = [
    { type:'cardback', label:'Card backs', defaultId:'cardback_default', defaultName:'Classic' },
    { type:'rocket',   label:'Crash rocket trails', defaultId:'rocket_default', defaultName:'Standard' },
  ];
  return groups.map(g => {
    const items = [
      { id:g.defaultId, name:g.defaultName, level:1 },
      ...COSMETIC_CATALOG.filter(c => c.type === g.type)
    ];
    return `
      <div class="section-head"><h2 style="font-size:15px;">${g.label}</h2></div>
      <div class="cos-grid">
        ${items.map(c => {
          const unlocked = unlockedCosmetics.includes(c.id) || c.id === g.defaultId;
          const equipped = equippedCosmetics[g.type] === c.id;
          return `
            <button class="cos-card ${unlocked ? '' : 'locked'} ${equipped ? 'equipped' : ''}"
                    ${unlocked ? `onclick="equipCosmetic('${g.type}','${c.id}'); renderProfileModal(); playSound?.('click')"` : 'disabled'}>
              <b>${unlocked ? c.name : '🔒 ' + c.name}</b>
              <small>${unlocked ? (equipped ? 'Equipped' : 'Equip') : 'Level ' + c.level}</small>
            </button>`;
        }).join('')}
      </div>`;
  }).join('');
}

function profileReferralHTML(){
  return `
    <p class="modal-sub" style="margin-top:0;">Share your link — your friend gets ${REFERRAL_INVITEE_REWARD.gc.toLocaleString()} GC + ${REFERRAL_INVITEE_REWARD.sc} SC on signup, and you get ${REFERRAL_INVITER_REWARD.gc.toLocaleString()} GC + ${REFERRAL_INVITER_REWARD.sc} SC once they play.</p>
    <div class="rb-stats">
      <div class="stat"><small>Your code</small><b id="ref-code" class="mono">—</b></div>
      <div class="stat"><small>Friends joined</small><b id="ref-invited" class="mono">0</b></div>
      <div class="stat"><small>Earned</small><b id="ref-earned" class="mono">—</b></div>
    </div>
    <div class="ref-link-box">
      <span id="ref-link" class="mono"></span>
      <button class="chip-btn" id="ref-copy-btn" onclick="copyReferralLink()">Copy</button>
      <button class="chip-btn" onclick="shareReferralLink()">Share</button>
    </div>
    <button class="btn btn-ghost" style="width:100%; margin-top:12px;" onclick="simulateReferralSignup()">[Demo] Simulate a friend joining</button>
    <p class="modal-footnote">// TODO: Backend — verify referrals server-side (unique device/IP, first real bet) before paying either side.</p>`;
}

/* Legacy hook wallet.js calls after equipping */
function renderProfileCosmetics(){ renderProfileModal(); }

function initProfileUI(){
  loadProfileState();
  renderTopbarAvatar();
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initProfileUI);
else initProfileUI();
