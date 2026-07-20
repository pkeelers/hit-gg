/* ============================================================
   AUTOPLAY ENGINE — shared automation core for every original.
   Shuffle/Rainbet-style: rounds (10/25/50/100/∞), stop on
   profit / loss / single-win multiplier, on-win / on-loss bet
   progression (Flat, Martingale, Paroli or custom %), turbo
   simulation, live P/L bar, and an end-of-session summary card.

   HOW A GAME PLUGS IN
   -------------------
   const ctrl = AutoPlay.create({
     id: 'dice',                     // unique key, used for element ids
     mount: containerEl,             // the auto panel is appended here
     betInputId: 'dice-bet',         // the game's bet <input>
     delay: 140,                     // ms between animated rounds
     turboDelay: 40,                 // ms between turbo rounds
     turbo: true,                    // offer the Turbo toggle at all
     presets: true,                  // offer Flat / Martingale / Paroli
     playRound(ctx){ ... }           // start ONE round. ctx.turbo tells you
                                     // to skip animation. When the round is
                                     // settled call ctrl.roundResolved(...)
   });

   The game then calls, exactly once per round:
     ctrl.roundResolved({ bet, payout, mult })
   and may call at any time:
     ctrl.abort('Balance too low')   // hard-stop with a reason
     ctrl.isRunning()                // e.g. to suppress manual buttons

   // TODO: Backend — none of this touches RNG. Rounds still come
   // from each game's (to-be) provably-fair endpoint; the engine
   // only sequences bets client-side like Shuffle's auto mode.
   ============================================================ */

const AutoPlay = (() => {

  const ROUND_CHOICES = [10, 25, 50, 100, Infinity];

  /* ---------- tiny DOM helpers ---------- */
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const fmt = (n) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ============================================================
     ENGINE FACTORY
     ============================================================ */
  function create(cfg){
    const S = {
      running: false,
      stopping: false,        // finish current round, then stop
      roundsTotal: 10,
      roundsDone: 0,
      baseBet: 0,             // bet at session start (progressions reset to this)
      wagered: 0,
      profit: 0,
      wins: 0,
      losses: 0,
      bestMult: 0,
      turbo: false,
      awaiting: false,        // a round is in flight
      timer: null,
      // progression: what happens to the bet after a win / a loss
      onWin:  { mode: 'keep', pct: 100 },   // keep | reset | inc
      onLoss: { mode: 'keep', pct: 100 },
    };

    /* ---------- build the panel ---------- */
    const id = cfg.id;
    const panel = h(`
      <div class="auto-panel collapsed" id="${id}-auto-panel">
        <div class="auto-head">
          <span class="auto-live-dot"></span>
          <span class="auto-title">Auto Bet</span>
          <span class="auto-caret">▼</span>
        </div>
        <div class="auto-body">
          <div class="auto-row">
            <span class="auto-label">Rounds</span>
            ${ROUND_CHOICES.map(n => `
              <button class="auto-pill${n === 10 ? ' active' : ''}" data-rounds="${n}">${n === Infinity ? '∞' : n}</button>`).join('')}
          </div>
          <div class="auto-row">
            <span class="auto-label">Stop conditions <span style="text-transform:none; letter-spacing:0;">(0 = off)</span></span>
            <label class="auto-field"><span>Profit ≥</span><input type="number" id="${id}-auto-sp" value="0" min="0" step="1"></label>
            <label class="auto-field"><span>Loss ≥</span><input type="number" id="${id}-auto-sl" value="0" min="0" step="1"></label>
            <label class="auto-field"><span>Win ≥</span><input type="number" id="${id}-auto-sm" value="0" min="0" step="0.5"><span>x</span></label>
          </div>
          <div class="auto-row">
            <span class="auto-label">Bet progression</span>
            <label class="auto-field"><span>On win</span>
              <select id="${id}-auto-ow">
                <option value="keep">Keep bet</option>
                <option value="reset">Reset to base</option>
                <option value="inc">Increase by</option>
              </select>
              <input type="number" id="${id}-auto-owp" value="100" min="1" step="1" style="width:52px; display:none;"><span id="${id}-auto-owpct" style="display:none;">%</span>
            </label>
            <label class="auto-field"><span>On loss</span>
              <select id="${id}-auto-ol">
                <option value="keep">Keep bet</option>
                <option value="reset">Reset to base</option>
                <option value="inc">Increase by</option>
              </select>
              <input type="number" id="${id}-auto-olp" value="100" min="1" step="1" style="width:52px; display:none;"><span id="${id}-auto-olpct" style="display:none;">%</span>
            </label>
          </div>
          ${cfg.presets ? `
          <div class="auto-row">
            <span class="auto-label">Quick strategy</span>
            <button class="auto-preset" data-preset="flat">Flat</button>
            <button class="auto-preset" data-preset="martingale" data-tip="Double after a loss, reset on a win">Martingale</button>
            <button class="auto-preset" data-preset="paroli" data-tip="Double after a win, reset on a loss">Paroli</button>
          </div>` : ''}
          <div class="auto-row" style="justify-content:space-between;">
            ${cfg.turbo ? `
            <label class="auto-turbo"><input type="checkbox" id="${id}-auto-turbo"><span class="tgl"></span> Turbo — instant results</label>
            ` : `<span style="font-size:11.5px;color:var(--text-dim);">Runs live rounds back-to-back.</span>`}
          </div>
          <button class="btn btn-gold auto-start" id="${id}-auto-start">Start Auto</button>
          <div class="auto-progress">
            <div class="bar"><div class="fill" id="${id}-auto-fill"></div></div>
            <div class="nums">
              <span id="${id}-auto-count">0 / 10</span>
              <span>P/L <b id="${id}-auto-pl">0.00</b></span>
              <span>Best <b id="${id}-auto-best" style="color:var(--gold-soft);">—</b></span>
            </div>
          </div>
        </div>
      </div>`);
    cfg.mount.appendChild(panel);

    const $ = (suffix) => document.getElementById(`${id}-auto-${suffix}`);
    const betInput = () => document.getElementById(cfg.betInputId);

    /* collapse / expand */
    panel.querySelector('.auto-head').onclick = () => panel.classList.toggle('collapsed');

    /* rounds pills */
    panel.querySelectorAll('.auto-pill').forEach(p => p.onclick = () => {
      panel.querySelectorAll('.auto-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      S.roundsTotal = p.dataset.rounds === 'Infinity' ? Infinity : parseInt(p.dataset.rounds, 10);
      playSound?.('click');
    });

    /* progression selects reveal their % field only for "increase" */
    [['ow','owp','owpct'], ['ol','olp','olpct']].forEach(([sel, num, pct]) => {
      $(sel).onchange = () => {
        const inc = $(sel).value === 'inc';
        $(num).style.display = inc ? '' : 'none';
        $(pct).style.display = inc ? '' : 'none';
        panel.querySelectorAll('.auto-preset').forEach(b => b.classList.remove('active'));
      };
    });

    /* strategy presets — pure sugar over the progression controls */
    panel.querySelectorAll('.auto-preset').forEach(b => b.onclick = () => {
      panel.querySelectorAll('.auto-preset').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const set = (sel, mode, pct) => {
        $(sel).value = mode;
        $(sel).dispatchEvent(new Event('change'));
        b.classList.add('active'); // dispatch clears it; restore
        if(mode === 'inc'){ $(sel === 'ow' ? 'owp' : 'olp').value = pct; }
      };
      if(b.dataset.preset === 'flat'){       set('ow','keep');            set('ol','keep'); }
      if(b.dataset.preset === 'martingale'){ set('ow','reset');           set('ol','inc', 100); }
      if(b.dataset.preset === 'paroli'){     set('ow','inc', 100);        set('ol','reset'); }
      playSound?.('click');
    });

    /* start / stop */
    $('start').onclick = () => S.running ? requestStop('Stopped') : start();

    /* ---------- session control ---------- */
    function start(){
      const bet = parseFloat(betInput()?.value || 0);
      if(!bet || bet <= 0){ alert('Enter a valid bet first.'); return; }
      S.running = true; S.stopping = false;
      S.roundsDone = 0; S.wagered = 0; S.profit = 0; S.wins = 0; S.losses = 0; S.bestMult = 0;
      S.baseBet = bet;
      S.turbo = cfg.turbo ? !!$('turbo')?.checked : false;
      S.onWin  = { mode: $('ow').value, pct: parseFloat($('owp').value) || 100 };
      S.onLoss = { mode: $('ol').value, pct: parseFloat($('olp').value) || 100 };
      panel.classList.add('auto-live');
      panel.classList.remove('collapsed');
      const btn = $('start');
      btn.textContent = 'Stop Auto'; btn.classList.add('stopping');
      playSound?.('bet');
      cfg.onStart?.();
      paint();
      next();
    }

    function requestStop(reason){
      // If a round is mid-flight we let it settle; otherwise stop now.
      S.stopping = true;
      if(!S.awaiting) finish(reason);
    }

    function abort(reason){
      // Hard stop from the game (e.g. takeBet failed on empty balance).
      S.awaiting = false;
      finish(reason);
    }

    function finish(reason){
      if(!S.running) return;
      clearTimeout(S.timer);
      S.running = false; S.stopping = false;
      panel.classList.remove('auto-live');
      const btn = $('start');
      btn.textContent = 'Start Auto'; btn.classList.remove('stopping');
      cfg.onStop?.();
      showSummary(reason);
    }

    function next(){
      if(!S.running) return;
      if(S.stopping || S.roundsDone >= S.roundsTotal) return finish(S.stopping ? 'Stopped' : 'All rounds played');
      S.awaiting = true;
      cfg.playRound({ turbo: S.turbo });
    }

    /* ---------- the game reports each settled round here ---------- */
    function roundResolved({ bet, payout, mult = 0 }){
      if(!S.running || !S.awaiting) return;
      S.awaiting = false;
      S.roundsDone++;
      S.wagered += bet;
      S.profit  += (payout - bet);
      const won = payout > bet;
      won ? S.wins++ : S.losses++;
      if(won && mult > S.bestMult) S.bestMult = mult;

      /* bet progression */
      const rule = won ? S.onWin : S.onLoss;
      const inp = betInput();
      if(inp){
        let b = parseFloat(inp.value) || S.baseBet;
        if(rule.mode === 'reset') b = S.baseBet;
        if(rule.mode === 'inc')   b = b * (1 + rule.pct / 100);
        inp.value = Math.max(1, Math.round(b * 100) / 100);
        inp.dispatchEvent(new Event('input'));
      }

      paint();

      /* stop conditions */
      const sp = parseFloat($('sp').value) || 0;
      const sl = parseFloat($('sl').value) || 0;
      const sm = parseFloat($('sm').value) || 0;
      if(sp && S.profit >=  sp) return finish(`Profit target hit (+${fmt(S.profit)})`);
      if(sl && S.profit <= -sl) return finish(`Loss limit hit (${fmt(S.profit)})`);
      if(sm && won && mult >= sm) return finish(`Big win ${mult.toFixed(2)}x — stopping`);

      S.timer = setTimeout(next, S.turbo ? (cfg.turboDelay ?? 40) : (cfg.delay ?? 150));
    }

    /* ---------- live progress ---------- */
    function paint(){
      const total = S.roundsTotal === Infinity ? '∞' : S.roundsTotal;
      $('count').textContent = `${S.roundsDone} / ${total}`;
      $('fill').style.width = S.roundsTotal === Infinity
        ? '100%'
        : Math.min(100, (S.roundsDone / S.roundsTotal) * 100) + '%';
      const pl = $('pl');
      pl.textContent = (S.profit >= 0 ? '+' : '') + fmt(S.profit);
      pl.className = S.profit >= 0 ? 'up' : 'down';
      $('best').textContent = S.bestMult ? S.bestMult.toFixed(2) + 'x' : '—';
    }

    /* ---------- end-of-session summary card ---------- */
    function showSummary(reason){
      if(S.roundsDone === 0) return; // nothing to report
      document.querySelector('.auto-summary')?.remove();
      const up = S.profit >= 0;
      const card = h(`
        <div class="auto-summary">
          <h4>⛏️ Auto session — ${reason || 'done'}</h4>
          <div class="rows">
            <div class="cell"><small>Rounds</small><b>${S.roundsDone}</b></div>
            <div class="cell"><small>Wagered</small><b>${fmt(S.wagered)}</b></div>
            <div class="cell"><small>Net P/L</small><b class="${up ? 'up' : 'down'}">${up ? '+' : ''}${fmt(S.profit)}</b></div>
            <div class="cell"><small>Best win</small><b>${S.bestMult ? S.bestMult.toFixed(2) + 'x' : '—'}</b></div>
          </div>
          <div class="hint">${S.wins}W · ${S.losses}L — tap to dismiss</div>
        </div>`);
      document.body.appendChild(card);
      requestAnimationFrame(() => card.classList.add('show'));
      const kill = () => { card.classList.remove('show'); setTimeout(() => card.remove(), 300); };
      card.onclick = kill;
      setTimeout(kill, 8000);
      if(up && S.profit > 0) playSound?.('cashout'); else playSound?.('lose');
    }

    return {
      isRunning: () => S.running,
      isTurbo: () => S.running && S.turbo,
      roundResolved,
      requestStop,
      abort,
    };
  }

  /* ============================================================
     GAME META — RTP / house-edge chips + Provably Fair button,
     injected into a view's .game-head (Shuffle-style visibility).
     ============================================================ */
  function attachMeta(viewId, { game, rtp, edge }){
    const head = document.querySelector(`#${viewId} .game-head`);
    if(!head || head.querySelector('.meta-badges')) return;
    const wrap = h(`
      <div class="meta-badges">
        <span class="meta-chip rtp" data-tip="Theoretical return to player">RTP <b>${rtp}</b></span>
        <span class="meta-chip" data-tip="House edge">Edge <b>${edge}</b></span>
        <button class="btn-fair" type="button"><span class="shield">🛡️</span> Provably Fair</button>
      </div>`);
    wrap.querySelector('.btn-fair').onclick = () => openFairModal(game);
    head.appendChild(wrap);
  }

  /* ============================================================
     PROVABLY FAIR MODAL — visible hooks now, backend later.
     Shows the committed server-seed hash, an editable client
     seed, and the running nonce. All placeholder until wired.
     ============================================================ */
  let fairNonce = 0;
  const bumpNonce = () => { fairNonce++; const el = document.getElementById('pf-nonce'); if(el) el.textContent = fairNonce; };

  function fakeHash(){
    // Placeholder commitment string (NOT a real hash).
    // TODO: Backend — serve sha256(serverSeed) here before any bet,
    // reveal serverSeed on rotation, verify HMAC(serverSeed, clientSeed:nonce).
    const hex = '0123456789abcdef';
    return Array.from({ length: 64 }, () => hex[Math.floor(Math.random() * 16)]).join('');
  }

  function ensureFairModal(){
    if(document.getElementById('modal-fair')) return;
    const seed = localStorage.getItem('hitgg_client_seed') ||
      Math.random().toString(36).slice(2, 12);
    localStorage.setItem('hitgg_client_seed', seed);
    const modal = h(`
      <div class="modal-overlay" id="modal-fair">
        <div class="modal-card">
          <div class="modal-head"><h3>🛡️ Provably Fair</h3><span class="modal-close">&times;</span></div>
          <p class="modal-sub" id="pf-game-line">Every result is derived from a server seed (committed before you bet), your client seed, and a nonce that counts your bets.</p>
          <div class="pf-row"><small>Server seed (hashed commitment)</small>
            <div class="pf-val"><span id="pf-server">${fakeHash()}</span><span class="pf-copy" data-copy="pf-server">⧉</span></div>
          </div>
          <div class="pf-row"><small>Client seed — yours to change</small>
            <div class="pf-val"><input id="pf-client" value="${seed}" maxlength="32"><span class="pf-copy" data-copy="pf-client">⧉</span></div>
          </div>
          <div class="pf-row"><small>Nonce (bets this session)</small>
            <div class="pf-val"><span id="pf-nonce">0</span></div>
          </div>
          <div class="pf-note">Demo build: results currently use local RNG. When the backend is wired, this panel will let you verify every round — result = HMAC-SHA256(serverSeed, clientSeed:nonce). Rotating your client seed reveals the previous server seed for auditing.</div>
        </div>
      </div>`);
    document.body.appendChild(modal);
    modal.onclick = (e) => { if(e.target === modal) modal.classList.remove('open'); };
    modal.querySelector('.modal-close').onclick = () => modal.classList.remove('open');
    modal.querySelectorAll('.pf-copy').forEach(c => c.onclick = () => {
      const el = document.getElementById(c.dataset.copy);
      navigator.clipboard?.writeText(el.value || el.textContent);
      c.textContent = '✓'; setTimeout(() => c.textContent = '⧉', 900);
    });
    modal.querySelector('#pf-client').onchange = (e) =>
      localStorage.setItem('hitgg_client_seed', e.target.value.trim() || seed);
  }

  function openFairModal(game){
    ensureFairModal();
    document.getElementById('pf-game-line').textContent =
      `${game} results are derived from a server seed (committed before you bet), your client seed, and a nonce that counts your bets.`;
    document.getElementById('modal-fair').classList.add('open');
    playSound?.('click');
  }

  return { create, attachMeta, openFairModal, bumpNonce };
})();
