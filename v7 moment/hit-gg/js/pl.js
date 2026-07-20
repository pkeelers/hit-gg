/* ============================================================
   LIVE P/L GRAPH — session + lifetime profit/loss analytics.
   A docked bottom-right widget: minimized it's a glassy pill
   with a sparkline; expanded it's a full analytics card with a
   canvas chart (Session / 24h / 7d), live stats and a reset.

   Feed: every game's settle path calls
       PLGraph.roundSettled(bet, payout)
   exactly once per settled round (AutoPlay turbo included).
   Currency-aware: everything tracks GC and SC separately and
   the widget follows the global `currency` toggle.

   // TODO: Backend — session + lifetime P/L should come from the
   // server's ledger once wallets are real; this module would then
   // just render `/api/me/pnl?window=session|24h|7d`.
   ============================================================ */

const PLGraph = (() => {

  const KEY = 'hitgg_pl_v1';
  const HOUR = 3600000;
  const MAX_POINTS = 1400;          // session series cap before decimation
  const SAVE_EVERY = 1500;          // ms — throttled persistence for turbo

  /* ---------- state ---------- */
  const freshCur = () => ({
    points: [],                     // [ [ts, cumulative net] ... ]
    cum: 0, wagered: 0, rounds: 0, wins: 0, losses: 0,
    bestWin: 0, worstLoss: 0, streak: 0,
  });
  let state = {
    lifetime: { GC: 0, SC: 0 },
    hours: { GC: {}, SC: {} },      // hourIndex -> net, pruned to ~7 days
    session: { startedAt: Date.now(), GC: freshCur(), SC: freshCur() },
  };
  let tab = 'session';              // session | 24h | 7d
  let open = false;
  let dirty = false;                // repaint queued
  let saveTimer = null;

  function load(){
    try {
      const raw = localStorage.getItem(KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      if(s && s.lifetime && s.session){
        state = s;
        ['GC','SC'].forEach(c => { state.session[c] = { ...freshCur(), ...state.session[c] }; });
      }
    } catch(e){ /* corrupt storage — start clean */ }
  }
  function save(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){}
    }, SAVE_EVERY);
  }
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){}
  });

  function pruneHours(cur){
    const min = Math.floor(Date.now() / HOUR) - 169;
    for(const k in state.hours[cur]) if(+k < min) delete state.hours[cur][k];
  }

  /* ---------- the one entry point games call ---------- */
  function roundSettled(bet, payout){
    if(!(bet > 0)) return;
    const cur = (typeof currency !== 'undefined') ? currency : 'GC';
    const net = +(payout - bet).toFixed(2);
    const s = state.session[cur];
    const now = Date.now();

    s.cum = +(s.cum + net).toFixed(2);
    s.points.push([now, s.cum]);
    if(s.points.length > MAX_POINTS){
      // Decimate: keep every other point but always the newest.
      const last = s.points[s.points.length - 1];
      s.points = s.points.filter((_, i) => i % 2 === 0);
      if(s.points[s.points.length - 1] !== last) s.points.push(last);
    }

    s.rounds++; s.wagered = +(s.wagered + bet).toFixed(2);
    if(payout > bet){
      s.wins++;
      s.streak = s.streak > 0 ? s.streak + 1 : 1;
      if(net > s.bestWin) s.bestWin = net;
    } else if(payout < bet){
      s.losses++;
      s.streak = s.streak < 0 ? s.streak - 1 : -1;
      if(net < s.worstLoss) s.worstLoss = net;
    } // push (payout === bet): streak & W/L untouched

    state.lifetime[cur] = +(state.lifetime[cur] + net).toFixed(2);
    const h = Math.floor(now / HOUR);
    state.hours[cur][h] = +((state.hours[cur][h] || 0) + net).toFixed(2);
    if(s.rounds % 50 === 0) pruneHours(cur);

    save();
    requestPaint();
  }

  function resetSession(){
    state.session = { startedAt: Date.now(), GC: freshCur(), SC: freshCur() };
    save();
    requestPaint();
    playSound?.('click');
  }

  /* ---------- series builders ---------- */
  function seriesFor(cur){
    if(tab === 'session') return state.session[cur].points;
    const span = tab === '24h' ? 24 : 168;
    const nowH = Math.floor(Date.now() / HOUR);
    const pts = [];
    let cum = 0;
    for(let h = nowH - span; h <= nowH; h++){
      cum = +(cum + (state.hours[cur][h] || 0)).toFixed(2);
      pts.push([h * HOUR, cum]);
    }
    return pts;
  }

  /* ---------- DOM ---------- */
  let root, cardCanvas, pillCanvas;
  const fmt = (n, sign = true) =>
    (sign && n > 0 ? '+' : (n < 0 ? '−' : '')) +
    Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function build(){
    if(root) return;
    root = document.createElement('div');
    root.className = 'plx';
    root.innerHTML = `
      <button class="plx-pill" type="button" aria-label="Open live P/L panel">
        <span class="plx-pill-dot"></span>
        <canvas class="plx-spark" width="72" height="22"></canvas>
        <b class="plx-pill-val mono">0.00</b>
      </button>
      <div class="plx-card" role="dialog" aria-label="Live profit and loss">
        <div class="plx-head">
          <span class="plx-live"></span>
          <b class="plx-title">Live P/L</b>
          <span class="plx-cur mono" id="plx-cur">GC</span>
          <button class="plx-ic" id="plx-reset" data-tip="Reset session" aria-label="Reset session">&#8634;</button>
          <button class="plx-ic" id="plx-min" aria-label="Minimize">&#8722;</button>
        </div>
        <div class="plx-tabs">
          <button class="plx-tab active" data-tab="session">Session</button>
          <button class="plx-tab" data-tab="24h">24h</button>
          <button class="plx-tab" data-tab="7d">7d</button>
        </div>
        <div class="plx-chart-wrap"><canvas class="plx-chart"></canvas><div class="plx-empty">Place a bet — your curve starts here</div></div>
        <div class="plx-stats">
          <div class="plx-stat plx-wide"><small>Session P/L</small><b class="mono" id="plx-sess">0.00</b></div>
          <div class="plx-stat plx-wide"><small>Lifetime P/L</small><b class="mono" id="plx-life">0.00</b></div>
          <div class="plx-stat"><small>Win rate</small><b class="mono" id="plx-wr">—</b></div>
          <div class="plx-stat"><small>Streak</small><b class="mono" id="plx-streak">—</b></div>
          <div class="plx-stat"><small>Biggest win</small><b class="mono" id="plx-bw">—</b></div>
          <div class="plx-stat"><small>Biggest loss</small><b class="mono" id="plx-bl">—</b></div>
          <div class="plx-stat plx-wide2"><small>Wagered this session</small><b class="mono" id="plx-wag">0.00</b></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    cardCanvas = root.querySelector('.plx-chart');
    pillCanvas = root.querySelector('.plx-spark');

    root.querySelector('.plx-pill').onclick = () => setOpen(true);
    root.querySelector('#plx-min').onclick = () => setOpen(false);
    root.querySelector('#plx-reset').onclick = resetSession;
    root.querySelectorAll('.plx-tab').forEach(b => b.onclick = () => {
      tab = b.dataset.tab;
      root.querySelectorAll('.plx-tab').forEach(x => x.classList.toggle('active', x === b));
      requestPaint();
      playSound?.('click');
    });
    window.addEventListener('resize', requestPaint);
  }

  function setOpen(v){
    open = v;
    root.classList.toggle('open', open);
    playSound?.('click');
    if(open) requestPaint();
  }

  /* ---------- painting (rAF-coalesced — turbo-safe) ---------- */
  function requestPaint(){
    if(dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; paint(); });
  }

  function drawLine(canvas, pts, { pad = 8, glow = true, baseline = true } = {}){
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if(!w || !hgt) return;
    if(canvas.width !== w * dpr){ canvas.width = w * dpr; canvas.height = hgt * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    if(pts.length < 2) return;

    let min = 0, max = 0;
    for(const [, v] of pts){ if(v < min) min = v; if(v > max) max = v; }
    if(max - min < 1){ max += 0.5; min -= 0.5; }
    const range = max - min;
    const X = i => pad + (i / (pts.length - 1)) * (w - pad * 2);
    const Y = v => pad + (1 - (v - min) / range) * (hgt - pad * 2);

    const last = pts[pts.length - 1][1];
    const up = last >= 0;
    const col = up ? '#3ddbb4' : '#ff5470';

    if(baseline && min < 0 && max > 0){
      ctx.strokeStyle = 'rgba(147,160,189,0.22)';
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // area fill
    const grad = ctx.createLinearGradient(0, 0, 0, hgt);
    grad.addColorStop(0, up ? 'rgba(61,219,180,0.28)' : 'rgba(255,84,112,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    pts.forEach(([, v], i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.lineTo(X(pts.length - 1), hgt); ctx.lineTo(X(0), hgt); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line + soft glow
    ctx.beginPath();
    pts.forEach(([, v], i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if(glow){ ctx.shadowColor = col; ctx.shadowBlur = 10; }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // live dot on the newest point
    ctx.beginPath();
    ctx.arc(X(pts.length - 1), Y(last), 3, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.beginPath();
    ctx.arc(X(pts.length - 1), Y(last), 6, 0, Math.PI * 2);
    ctx.fillStyle = up ? 'rgba(61,219,180,0.18)' : 'rgba(255,84,112,0.18)'; ctx.fill();
  }

  function paint(){
    if(!root) return;
    const cur = (typeof currency !== 'undefined') ? currency : 'GC';
    const s = state.session[cur];
    const up = s.cum >= 0;

    /* pill */
    const pillVal = root.querySelector('.plx-pill-val');
    pillVal.textContent = fmt(s.cum);
    pillVal.classList.toggle('up', up && s.cum !== 0);
    pillVal.classList.toggle('down', !up);
    root.querySelector('.plx-pill-dot').classList.toggle('down', !up);
    drawLine(pillCanvas, s.points.slice(-60), { pad: 2, glow: false, baseline: false });

    if(!open) return;

    /* card */
    root.querySelector('#plx-cur').textContent = cur;
    const series = seriesFor(cur);
    drawLine(cardCanvas, series);
    root.querySelector('.plx-empty').style.display =
      (tab === 'session' && s.points.length < 2) ? '' : 'none';

    const set = (id, txt, cls) => {
      const el = root.querySelector('#' + id);
      el.textContent = txt;
      el.className = 'mono' + (cls ? ' ' + cls : '');
    };
    set('plx-sess', fmt(s.cum) + ' ' + cur, up ? 'up' : 'down');
    const life = state.lifetime[cur];
    set('plx-life', fmt(life) + ' ' + cur, life >= 0 ? 'up' : 'down');
    set('plx-wr', s.rounds ? Math.round((s.wins / s.rounds) * 100) + '%' : '—');
    set('plx-streak', s.streak ? (s.streak > 0 ? s.streak + 'W' : Math.abs(s.streak) + 'L') : '—',
        s.streak > 0 ? 'up' : (s.streak < 0 ? 'down' : ''));
    set('plx-bw', s.bestWin ? '+' + fmt(s.bestWin, false) : '—', s.bestWin ? 'up' : '');
    set('plx-bl', s.worstLoss ? '−' + fmt(Math.abs(s.worstLoss), false) : '—', s.worstLoss ? 'down' : '');
    set('plx-wag', fmt(s.wagered, false) + ' ' + cur);
  }

  /* ---------- boot ---------- */
  load();
  const boot = () => { build(); requestPaint(); };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { roundSettled, refresh: () => requestPaint(), resetSession };
})();
