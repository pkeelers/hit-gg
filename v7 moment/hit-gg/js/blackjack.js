/* ============ BLACKJACK ============ */
let bjDeck = [];
let bjPlayer = [];
let bjDealer = [];
let bjBet = 0;
let bjActive = false;
let bjAuto = null;        // AutoPlay controller
let bjRoundCtx = null;    // { auto } for the engine's hand
let bjTurbo = false;      // zero-delay dealing for turbo auto
let bjHintOn = false;     // basic-strategy hint toggle
const bjMs = (n) => bjTurbo ? 0 : n;  // all table pacing routes through this

const SUITS = ['&#9824;','&#9829;','&#9830;','&#9827;'];
const RED_SUITS = ['&#9829;','&#9830;'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function freshDeck(){
  const deck = [];
  for(const s of SUITS) for(const r of RANKS) deck.push({r, s});
  for(let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]] = [deck[j],deck[i]];
  }
  return deck;
}
function cardValue(card){ return card.r==='A' ? 11 : (['J','Q','K'].includes(card.r) ? 10 : parseInt(card.r)); }
function handTotal(hand){
  let total = hand.reduce((s,c)=>s+cardValue(c),0);
  let aces = hand.filter(c=>c.r==='A').length;
  while(total > 21 && aces > 0){ total -= 10; aces--; }
  return total;
}
function cardFaceHTML(card){
  const isRed = RED_SUITS.includes(card.s);
  return `<div class="card${isRed?' red':''}" style="position:absolute; inset:0;">
    <div class="corner">${card.r}<br>${card.s}</div>
    <div class="corner bottom">${card.r}<br>${card.s}</div>
  </div>`;
}

/* Chip stack visual for a bet amount */
function chipStackHTML(amount){
  const denoms = [500,100,25,5,1];
  let remaining = Math.round(amount);
  let chips = [];
  for(const d of denoms){
    while(remaining >= d && chips.length < 7){
      chips.push(d);
      remaining -= d;
    }
  }
  if(chips.length === 0) chips = [1];
  return chips.map(d => `<div class="chip c${d}">${d}</div>`).join('');
}

/* ============ INIT / AUTO / STRATEGY ============ */
function initBlackjack(){
  /* ---- Auto Bet engine ----
     Auto plays every hand by the book (see bjBasicAction).
     Turbo deals with zero animation delay. */
  if(!bjAuto && typeof AutoPlay !== 'undefined'){
    bjAuto = AutoPlay.create({
      id: 'bj',
      mount: document.getElementById('bj-auto-mount'),
      betInputId: 'bj-bet',
      delay: 260, turboDelay: 40,
      turbo: true, presets: true,
      onStop: () => { bjTurbo = false; },
      playRound: (ctx) => {
        bjTurbo = !!ctx.turbo;
        bjRoundCtx = { auto: true };
        bjDeal({ auto: true });
      },
    });
    AutoPlay.attachMeta('view-blackjack', { game: 'Blackjack', rtp: '~99.5%', edge: '~0.5%' });
  }
}

/* Simplified basic strategy for this ruleset (dealer stands all 17s,
   double any two, no splits offered): returns 'hit'|'stand'|'double'. */
function bjBasicAction(player, dealerUp, canDouble){
  const total = handTotal(player);
  const up = cardValue(dealerUp) === 11 ? 11 : cardValue(dealerUp); // A = 11
  // soft = an ace is currently counted as 11
  const hardMin = player.reduce((a, c) => a + (c.r === 'A' ? 1 : cardValue(c)), 0);
  const soft = player.some(c => c.r === 'A') && hardMin + 10 === total;

  if(soft){
    if(canDouble && total >= 15 && total <= 18 && up >= 4 && up <= 6) return 'double';
    if(total <= 17) return 'hit';
    if(total === 18) return (up >= 9 || up === 11) ? 'hit' : 'stand';
    return 'stand';
  }
  if(canDouble){
    if(total === 11) return 'double';
    if(total === 10 && up <= 9) return 'double';
    if(total === 9 && up >= 3 && up <= 6) return 'double';
  }
  if(total <= 8) return 'hit';
  if(total === 9 || total === 10 || total === 11) return 'hit';
  if(total === 12) return (up >= 4 && up <= 6) ? 'stand' : 'hit';
  if(total <= 16) return (up >= 2 && up <= 6) ? 'stand' : 'hit';
  return 'stand';
}

function bjToggleHint(){
  bjHintOn = !bjHintOn;
  document.getElementById('bj-hint-btn')?.classList.toggle('hint-on', bjHintOn);
  playSound?.('click');
  bjPaintHint();
}
function bjPaintHint(){
  ['bj-hit','bj-stand','bj-double'].forEach(id => document.getElementById(id)?.classList.remove('suggest'));
  if(!bjHintOn || !bjActive) return;
  const canDouble = !document.getElementById('bj-double')?.disabled;
  const act = bjBasicAction(bjPlayer, bjDealer[0], canDouble);
  const map = { hit: 'bj-hit', stand: 'bj-stand', double: 'bj-double' };
  document.getElementById(map[act])?.classList.add('suggest');
}

/* One strategy step per call; chains itself until the hand stands. */
function bjAutoAct(){
  if(!bjActive || !bjRoundCtx?.auto) return;
  const canDouble = !document.getElementById('bj-double')?.disabled;
  const act = bjBasicAction(bjPlayer, bjDealer[0], canDouble && balances[currency] >= bjBet);
  setTimeout(() => {
    if(!bjActive || !bjRoundCtx?.auto) return;
    if(act === 'double') bjDouble(true);
    else if(act === 'hit'){ bjHit(true); if(bjActive) bjAutoAct(); }
    else bjStand(true);
  }, bjMs(180));
}

let bjFreshDeal = false; // true only for the initial two-card deal, to stagger the animation

function renderCardSlot(container, card, {faceDown=false, flip=false, delay=0} = {}){
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  if(flip){
    slot.innerHTML = `<div class="flipper flipped"><div class="face back card"></div><div class="face front">${cardFaceHTML(card)}</div></div>`;
  } else if(faceDown){
    slot.innerHTML = `<div class="card back"></div>`;
  } else {
    slot.innerHTML = cardFaceHTML(card).replace('position:absolute; inset:0;','');
  }
  const cardEl = slot.querySelector('.card, .flipper');
  if(cardEl && delay) cardEl.style.animationDelay = delay + 'ms';
  container.appendChild(slot);
  return slot;
}

function renderBJ(hideHole=false){
  const pc = document.getElementById('bj-player-cards');
  const dc = document.getElementById('bj-dealer-cards');
  pc.innerHTML = ''; dc.innerHTML = '';

  // Classic dealing order — player, dealer, player, dealer — each card lands a beat after the last.
  bjPlayer.forEach((c,idx) => renderCardSlot(pc, c, {delay: bjFreshDeal ? idx*190 : 0}));
  bjDealer.forEach((c,idx) => renderCardSlot(dc, c, {faceDown: hideHole && idx===1, delay: bjFreshDeal ? (idx*190 + 95) : 0}));
  bjFreshDeal = false;

  bumpTotal('bj-player-total', handTotal(bjPlayer));
  bumpTotal('bj-dealer-total', hideHole ? '?' : handTotal(bjDealer));
  document.getElementById('bj-shoe').textContent = bjDeck.length + ' cards';
  tossChipStack(bjBet || parseFloat(document.getElementById('bj-bet').value || 0));

  document.getElementById('row-player').classList.remove('bust','win');
  document.getElementById('row-dealer').classList.remove('bust','win');
}
function tossChipStack(amount){
  const stack = document.getElementById('bj-chip-stack');
  stack.innerHTML = chipStackHTML(amount);
  stack.querySelectorAll('.chip').forEach((chip, i) => {
    chip.style.animationDelay = (i * 45) + 'ms';
    chip.classList.add('chip-toss');
  });
}
function bumpTotal(id, value){
  const el = document.getElementById(id);
  el.textContent = value;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');

  // Color the total badge by state: 21 glows gold, bust flags red,
  // a made hand (17–20) reads teal. '?' (hidden hole card) is neutral.
  const badge = el.closest('.bj-total-badge');
  if(badge){
    badge.classList.remove('prime','bust','good');
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    if(!isNaN(n)){
      if(n === 21) badge.classList.add('prime');
      else if(n > 21) badge.classList.add('bust');
      else if(n >= 17) badge.classList.add('good');
    }
  }
}
function flipHoleCard(){
  const dc = document.getElementById('bj-dealer-cards');
  const secondSlot = dc.children[1];
  if(!secondSlot) return;
  secondSlot.innerHTML = `<div class="flipper"><div class="face back card"></div><div class="face front">${cardFaceHTML(bjDealer[1]).replace('position:absolute; inset:0;','position:absolute; inset:0;')}</div></div>`;
  const flipper = secondSlot.querySelector('.flipper');
  requestAnimationFrame(() => requestAnimationFrame(() => flipper.classList.add('flipped')));
}

function bjAdjustBet(mult){
  const inp = document.getElementById('bj-bet');
  inp.value = Math.max(1, Math.round(parseFloat(inp.value||1) * mult));
  document.getElementById('bj-chip-stack').innerHTML = chipStackHTML(parseFloat(inp.value));
}
function bjSetButtons({deal, hit, stand, double}){
  document.getElementById('bj-deal').disabled = !deal;
  document.getElementById('bj-hit').disabled = !hit;
  document.getElementById('bj-stand').disabled = !stand;
  document.getElementById('bj-double').disabled = !double;
}
function bjGlow(kind){
  const glow = document.getElementById('bj-felt-glow');
  glow.className = 'felt-glow show ' + kind;
  setTimeout(()=>glow.classList.remove('show'), 900);
}

function bjDeal(opts = {}){
  if(bjActive) return;
  if(bjAuto?.isRunning() && !opts.auto) return; // engine owns the table while running
  if(!opts.auto) bjRoundCtx = null;
  bjBet = parseFloat(document.getElementById('bj-bet').value);
  if(!bjBet || bjBet <= 0){
    if(opts.auto) return bjAuto.abort('Invalid bet');
    alert('Enter a valid bet.'); return;
  }
  if(!takeBet(bjBet)){
    if(opts.auto) bjAuto.abort('Balance too low');
    return;
  }
  AutoPlay?.bumpNonce();
  if(!bjTurbo){
    playSound?.('bet');
    setTimeout(()=>playSound?.('card'), 120);
    setTimeout(()=>playSound?.('card'), 360);
  }

  bjDeck = freshDeck();
  bjPlayer = [bjDeck.pop(), bjDeck.pop()];
  bjDealer = [bjDeck.pop(), bjDeck.pop()];
  bjActive = true;

  document.getElementById('bj-result').className = 'result-banner';
  bjFreshDeal = true;
  renderBJ(true);

  const playerBJ = handTotal(bjPlayer) === 21;
  bjSetButtons({deal:false, hit:!playerBJ, stand:!playerBJ, double:!playerBJ && balances[currency] >= bjBet});
  bjPaintHint();
  if(playerBJ) setTimeout(() => bjStand(true), bjMs(400));
  else if(bjRoundCtx?.auto) bjAutoAct();
}
function bjHit(fromEngine = false){
  if(!bjActive) return;
  if(bjRoundCtx?.auto && !fromEngine) return;
  if(!bjTurbo) playSound?.('card');
  bjPlayer.push(bjDeck.pop());
  renderBJ(true);
  if(handTotal(bjPlayer) > 21){
    document.getElementById('row-player').classList.add('bust');
  }
  if(handTotal(bjPlayer) >= 21){
    bjSetButtons({deal:false, hit:false, stand:false, double:false});
    setTimeout(() => bjStand(true), bjMs(420));
  } else {
    bjSetButtons({deal:false, hit:true, stand:true, double:false});
    bjPaintHint();
  }
}
function bjDouble(fromEngine = false){
  if(!bjActive) return;
  if(bjRoundCtx?.auto && !fromEngine) return;
  if(!takeBet(bjBet)){
    if(bjRoundCtx?.auto){ bjStand(true); } // can't afford the double — stand instead
    return;
  }
  bjBet *= 2;
  bjPlayer.push(bjDeck.pop());
  renderBJ(true);
  if(handTotal(bjPlayer) > 21) document.getElementById('row-player').classList.add('bust');
  bjSetButtons({deal:false, hit:false, stand:false, double:false});
  setTimeout(() => bjStand(true), bjMs(420));
}
function bjStand(fromEngine = false){
  if(!bjActive) return;
  if(bjRoundCtx?.auto && fromEngine !== true) return;
  bjActive = false;
  bjPaintHint();
  bjSetButtons({deal:false, hit:false, stand:false, double:false});

  const playerTotal = handTotal(bjPlayer);

  if(playerTotal > 21){
    renderBJ(false);
    finishRound(playerTotal, handTotal(bjDealer));
    return;
  }

  flipHoleCard();
  setTimeout(() => {
    bumpTotal('bj-dealer-total', handTotal(bjDealer));
    dealerStep();
  }, bjMs(500));
}
function dealerStep(){
  const dealerTotal = handTotal(bjDealer);
  const playerTotal = handTotal(bjPlayer);
  if(dealerTotal < 17){
    setTimeout(() => {
      bjDealer.push(bjDeck.pop());
      renderBJ(false);
      dealerStep();
    }, bjMs(460));
  } else {
    finishRound(playerTotal, dealerTotal);
  }
}
function finishRound(playerTotal, dealerTotal){
  renderBJ(false);
  let outcome, mult = 0, kind = 'lose';
  const playerBJ = playerTotal === 21 && bjPlayer.length === 2;
  const dealerBJ = dealerTotal === 21 && bjDealer.length === 2;

  if(playerTotal > 21){ outcome = 'Bust — dealer wins.'; mult = 0; document.getElementById('row-player').classList.add('bust'); }
  else if(playerBJ && !dealerBJ){ outcome = 'Blackjack! Pays 3:2.'; mult = 2.5; kind='win'; }
  else if(dealerBJ && !playerBJ){ outcome = 'Dealer blackjack.'; mult = 0; }
  else if(dealerTotal > 21){ outcome = 'Dealer busts — you win!'; mult = 2; kind='win'; document.getElementById('row-dealer').classList.add('bust'); }
  else if(playerTotal > dealerTotal){ outcome = 'You win!'; mult = 2; kind='win'; }
  else if(playerTotal < dealerTotal){ outcome = 'Dealer wins.'; mult = 0; }
  else { outcome = 'Push — bet returned.'; mult = 1; kind='push'; }

  const payout = +(bjBet * mult).toFixed(2);
  if(payout > 0) adjustBalance(payout);
  PLGraph?.roundSettled(bjBet, payout); // bjBet = total staked incl. double

  const banner = document.getElementById('bj-result');
  banner.textContent = outcome + (payout>0 ? ` (+${payout.toFixed(2)} ${currency})` : '');
  banner.className = 'result-banner ' + kind;

  if(kind==='win'){
    document.getElementById(mult>0 && dealerTotal>21 ? 'row-dealer' : 'row-player').classList.add('win');
    if(!bjTurbo){
      bjGlow('win');
      playSound?.(playerBJ && !dealerBJ ? 'bigwin' : 'win');
      particleBurstAtEl?.(banner, { count: playerBJ ? 26 : 14 });
      floatWin?.(banner, `+${payout.toFixed(2)} ${currency}`);
      if(mult >= 2.5) fireConfetti(70); else fireConfetti(35);
    }
    if(typeof pushLiveWin === 'function') pushLiveWin(payout, currency);
  } else if(kind==='lose'){
    if(!bjTurbo){ bjGlow('lose'); playSound?.('lose'); }
  } else if(kind==='push'){
    if(!bjTurbo) playSound?.('click');
  }

  bjSetButtons({deal:true, hit:false, stand:false, double:false});
  if(typeof trackChallenge === 'function') trackChallenge('blackjack_hand', { kind, mult, payout, playerBJ: playerBJ && !dealerBJ });

  // Settle the engine's hand (bet = total staked incl. any double)
  if(bjRoundCtx?.auto){
    bjRoundCtx = null;
    bjAuto?.roundResolved({ bet: bjBet, payout, mult });
  }
}
