/* ============================================================
   FX / "JUICE" LIBRARY
   Shared visual effects used by every game: screen shake,
   particle bursts, floating win text, glow pulses, animated
   number count-ups, and the full-screen BIG WIN takeover.
   Everything respects prefers-reduced-motion.
   ============================================================ */

const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------- Screen shake ---------- */
function screenShake(intensity = 'med'){
  if(REDUCED_MOTION) return;
  const el = document.querySelector('.main') || document.body;
  const cls = intensity === 'big' ? 'shake-big' : 'shake';
  el.classList.remove('shake','shake-big');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(()=>el.classList.remove(cls), 600);
}

/* ---------- Particle burst at a point (viewport coords) ---------- */
function particleBurst(x, y, { count = 14, colors = ['#f2b90c','#f7d264','#8b5cf6','#2dd4bf'], spread = 90, size = 7 } = {}){
  if(REDUCED_MOTION) return;
  let layer = document.getElementById('fx-layer');
  if(!layer){
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    document.body.appendChild(layer);
  }
  for(let i=0;i<count;i++){
    const p = document.createElement('div');
    p.className = 'fx-particle';
    const ang = Math.random() * Math.PI * 2;
    const dist = spread * (0.4 + Math.random()*0.6);
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.width = p.style.height = (size * (0.5 + Math.random()*0.8)) + 'px';
    p.style.background = colors[Math.floor(Math.random()*colors.length)];
    p.style.setProperty('--dx', Math.cos(ang)*dist + 'px');
    p.style.setProperty('--dy', (Math.sin(ang)*dist - 40) + 'px');
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    p.style.animationDuration = (0.5 + Math.random()*0.5) + 's';
    layer.appendChild(p);
    setTimeout(()=>p.remove(), 1100);
  }
}
function particleBurstAtEl(el, opts){
  if(!el) return;
  const r = el.getBoundingClientRect();
  particleBurst(r.left + r.width/2, r.top + r.height/2, opts);
}

/* ---------- Floating "+123.45 GC" text ---------- */
function floatWin(el, text, kind = 'win'){
  if(!el) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'fx-float ' + kind;
  f.textContent = text;
  f.style.left = (r.left + r.width/2) + 'px';
  f.style.top = (r.top) + 'px';
  document.body.appendChild(f);
  requestAnimationFrame(()=>f.classList.add('go'));
  setTimeout(()=>f.remove(), 1600);
}

/* ---------- Win glow / pop helpers ---------- */
function popEl(el){
  if(!el || REDUCED_MOTION) return;
  el.classList.remove('fx-pop');
  void el.offsetWidth;
  el.classList.add('fx-pop');
}
function glowEl(el, ms = 1200){
  if(!el) return;
  el.classList.add('fx-glow');
  setTimeout(()=>el.classList.remove('fx-glow'), ms);
}

/* ---------- Animated number count-up ---------- */
function countUp(el, to, { from = 0, dur = 900, decimals = 2, suffix = '' } = {}){
  if(!el) return;
  if(REDUCED_MOTION){ el.textContent = to.toFixed(decimals) + suffix; return; }
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (from + (to - from) * eased).toLocaleString(undefined, {minimumFractionDigits:decimals, maximumFractionDigits:decimals}) + suffix;
    if(t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------- BIG WIN full-screen takeover ---------- */
let bigWinTimer = null;
function bigWinOverlay(mult, amount, cur){
  let ov = document.getElementById('bigwin-overlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'bigwin-overlay';
    ov.innerHTML = `
      <div class="bigwin-card">
        <div class="bigwin-rays"></div>
        <div class="bigwin-label">BIG WIN</div>
        <div class="bigwin-mult mono" id="bigwin-mult">0.00x</div>
        <div class="bigwin-amount mono" id="bigwin-amount"></div>
      </div>`;
    ov.onclick = hideBigWin;
    document.body.appendChild(ov);
  }
  const label = ov.querySelector('.bigwin-label');
  label.textContent = mult >= 100 ? 'LEGENDARY WIN' : mult >= 25 ? 'MEGA WIN' : 'BIG WIN';
  ov.classList.add('show');
  countUp(document.getElementById('bigwin-mult'), mult, { dur: 1200, decimals: 2, suffix: 'x' });
  const amtEl = document.getElementById('bigwin-amount');
  amtEl.textContent = '';
  setTimeout(()=>{ countUp(amtEl, amount, { dur: 900, decimals: 2, suffix: ' ' + cur }); }, 350);
  playSound?.('bigwin');
  screenShake('big');
  fireConfetti?.(160);
  clearTimeout(bigWinTimer);
  bigWinTimer = setTimeout(hideBigWin, 3400);
}
function hideBigWin(){
  document.getElementById('bigwin-overlay')?.classList.remove('show');
}

/* ---------- One shared entry point games call on any win ---------- */
function celebrateWin({ mult = 0, payout = 0, cur = (typeof currency !== 'undefined' ? currency : 'GC'), anchorEl = null } = {}){
  if(mult >= 10){
    bigWinOverlay(mult, payout, cur);
    // Grounded burst under the overlay so the win origin still pops
    if(anchorEl){
      particleBurstAtEl(anchorEl, { count: 40, spread: 150, size: 9 });
      setTimeout(() => particleBurstAtEl(anchorEl, { count: 26, spread: 210, size: 7 }), 140);
    }
  } else {
    playSound?.('win');
    if(anchorEl){
      particleBurstAtEl(anchorEl, { count: Math.min(48, 16 + Math.round(mult*5)), spread: 110, size: 8 });
      // Second, wider ring on solid wins — reads as an "explosion" not a puff
      if(mult >= 3) setTimeout(() =>
        particleBurstAtEl(anchorEl, { count: 20, spread: 180, size: 6 }), 120);
      floatWin(anchorEl, `+${payout.toFixed(2)} ${cur}`);
    }
    if(mult >= 3) screenShake('med');
    fireConfetti?.(mult >= 5 ? 120 : mult >= 2 ? 60 : 35);
  }
  if(typeof pushLiveWin === 'function' && payout > 0) pushLiveWin(payout, cur);
}
