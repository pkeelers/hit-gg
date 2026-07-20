/* ============================================================
   VAULT — lock away part of your GC / SC behind a password.
   Vaulted funds leave the spendable wallet entirely: the topbar
   balance, takeBet() and AutoPlay only ever see unlocked funds,
   so over-betting into vaulted coins fails the normal way.

   Demo security model (clearly a demo):
   - Password is hashed client-side (SHA-256 via Web Crypto,
     salted) and kept in localStorage. Deposits are allowed while
     locked; withdrawals require the password.
   // TODO: Backend — a real vault lives server-side: hashed+peppered
   // password (argon2/bcrypt), 2FA on withdraw, rate-limited unlock
   // attempts, and an audited ledger of vault movements. Nothing
   // client-side should ever be the source of truth for balances.
   ============================================================ */

const Vault = (() => {

  const KEY = 'hitgg_vault_v1';
  let vault = { GC: 0, SC: 0, hash: null, salt: null };
  let unlocked = false;            // in-memory only — relocks on reload

  function load(){
    try { const raw = localStorage.getItem(KEY); if(raw) vault = { ...vault, ...JSON.parse(raw) }; }
    catch(e){}
  }
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(vault)); } catch(e){}
  }

  /* ---------- hashing ---------- */
  async function sha256(text){
    if(window.crypto?.subtle){
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for non-secure contexts (file://) — NOT cryptographic.
    // TODO: Backend — never rely on this; it exists so the demo works anywhere.
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for(let i = 0; i < text.length; i++){
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }
  const hashPw = (pw) => sha256(`${vault.salt}:${pw}`);

  const hasFunds = () => vault.GC > 0 || vault.SC > 0;
  const hasPassword = () => !!vault.hash;
  const balance = (cur) => vault[cur] || 0;

  const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ---------- topbar indicator ---------- */
  function renderIndicator(){
    const btn = document.getElementById('vault-btn');
    if(!btn) return;
    btn.querySelector('span').innerHTML = unlocked ? '&#128275;' : '&#128274;';
    const dot = document.getElementById('vault-dot');
    if(dot) dot.style.display = hasFunds() ? 'block' : 'none';
    btn.classList.toggle('vault-has-funds', hasFunds());
  }

  /* ---------- modal ---------- */
  function ensureModal(){
    if(document.getElementById('modal-vault')) return;
    const t = document.createElement('template');
    t.innerHTML = `
      <div class="modal-overlay" id="modal-vault">
        <div class="modal-card vault-card">
          <div class="modal-head">
            <h3><span class="vault-lock-ic" id="vault-head-ic">&#128274;</span> Vault</h3>
            <span class="modal-close" onclick="closeModal('modal-vault')">&times;</span>
          </div>
          <p class="modal-sub" id="vault-sub"></p>

          <div class="vault-balances" id="vault-balances">
            <div class="vault-bal"><small>GC vaulted</small><b class="mono" id="vault-gc">••••</b></div>
            <div class="vault-bal"><small>SC vaulted</small><b class="mono" id="vault-sc">••••</b></div>
          </div>

          <!-- first-time setup -->
          <div class="vault-section" id="vault-setup" style="display:none;">
            <label class="vault-field"><span>Create password</span><input type="password" id="vault-pw-new" maxlength="64" autocomplete="new-password"></label>
            <label class="vault-field"><span>Confirm</span><input type="password" id="vault-pw-confirm" maxlength="64" autocomplete="new-password"></label>
            <button class="btn btn-gold vault-wide" id="vault-create-btn">Create vault</button>
            <p class="modal-footnote">There is no recovery in this demo — if you forget the password, the vault stays sealed.</p>
          </div>

          <!-- unlock -->
          <div class="vault-section" id="vault-locked" style="display:none;">
            <label class="vault-field"><span>Password</span><input type="password" id="vault-pw" maxlength="64" autocomplete="current-password"></label>
            <button class="btn btn-gold vault-wide" id="vault-unlock-btn">Unlock vault</button>
            <p class="vault-err" id="vault-err"></p>
          </div>

          <!-- deposit (always available) -->
          <div class="vault-section" id="vault-deposit">
            <div class="section-head"><h2 class="vault-h">Move into Vault</h2></div>
            <div class="vault-move">
              <label class="vault-field grow"><span id="vault-dep-cur">GC</span><input type="number" id="vault-dep-amt" min="0" step="1" placeholder="0.00"></label>
              <button class="chip-btn" id="vault-dep-max">Max</button>
              <button class="btn btn-gold" id="vault-dep-btn">Lock away</button>
            </div>
            <small class="vault-note">Uses the currency selected up top. Vaulted coins can't be bet.</small>
          </div>

          <!-- withdraw (unlocked only) -->
          <div class="vault-section" id="vault-withdraw" style="display:none;">
            <div class="section-head"><h2 class="vault-h">Withdraw to wallet</h2></div>
            <div class="vault-move">
              <label class="vault-field grow"><span id="vault-wd-cur">GC</span><input type="number" id="vault-wd-amt" min="0" step="1" placeholder="0.00"></label>
              <button class="chip-btn" id="vault-wd-max">Max</button>
              <button class="btn btn-gold" id="vault-wd-btn">Withdraw</button>
            </div>
            <button class="btn btn-ghost vault-wide" id="vault-lock-btn" style="margin-top:12px;">&#128274; Lock vault</button>
          </div>
        </div>
      </div>`;
    const modal = t.content.firstElementChild;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if(e.target === modal) closeModal('modal-vault'); };

    modal.querySelector('#vault-create-btn').onclick = createPassword;
    modal.querySelector('#vault-unlock-btn').onclick = unlock;
    modal.querySelector('#vault-pw').onkeydown = (e) => { if(e.key === 'Enter') unlock(); };
    modal.querySelector('#vault-lock-btn').onclick = () => { unlocked = false; render(); renderIndicator(); playSound?.('click'); };
    modal.querySelector('#vault-dep-max').onclick = () => { modal.querySelector('#vault-dep-amt').value = Math.floor(balances[currency] * 100) / 100; };
    modal.querySelector('#vault-wd-max').onclick  = () => { modal.querySelector('#vault-wd-amt').value = vault[currency]; };
    modal.querySelector('#vault-dep-btn').onclick = deposit;
    modal.querySelector('#vault-wd-btn').onclick = withdraw;
  }

  function render(){
    ensureModal();
    const $ = (id) => document.getElementById(id);
    const show = (id, v) => { $(id).style.display = v ? '' : 'none'; };

    $('vault-head-ic').innerHTML = unlocked ? '&#128275;' : '&#128274;';
    document.querySelector('.vault-card').classList.toggle('unlocked', unlocked);

    if(!hasPassword()){
      $('vault-sub').textContent = 'Set a password to seal off part of your balance. Vaulted coins disappear from your spendable wallet until you unlock them.';
      show('vault-setup', true); show('vault-locked', false); show('vault-withdraw', false);
    } else if(!unlocked){
      $('vault-sub').textContent = 'The vault is sealed. Deposits are always open — withdrawing needs your password.';
      show('vault-setup', false); show('vault-locked', true); show('vault-withdraw', false);
    } else {
      $('vault-sub').textContent = 'Vault unlocked for this session. Lock it again when you\u2019re done.';
      show('vault-setup', false); show('vault-locked', false); show('vault-withdraw', true);
    }

    $('vault-gc').textContent = unlocked ? fmt(vault.GC) : (vault.GC > 0 ? '••••' : '0.00');
    $('vault-sc').textContent = unlocked ? fmt(vault.SC) : (vault.SC > 0 ? '••••' : '0.00');
    $('vault-dep-cur').textContent = currency;
    $('vault-wd-cur').textContent = currency;
    $('vault-err').textContent = '';
  }

  /* ---------- actions ---------- */
  async function createPassword(){
    const pw = document.getElementById('vault-pw-new').value;
    const pw2 = document.getElementById('vault-pw-confirm').value;
    if(pw.length < 4){ alert('Password needs at least 4 characters.'); return; }
    if(pw !== pw2){ alert('Passwords don\u2019t match.'); return; }
    vault.salt = Math.random().toString(36).slice(2, 12);
    vault.hash = await hashPw(pw);
    unlocked = true;
    save(); render(); renderIndicator();
    playSound?.('cashout');
  }

  async function unlock(){
    const pw = document.getElementById('vault-pw').value;
    const err = document.getElementById('vault-err');
    if(await hashPw(pw) === vault.hash){
      unlocked = true;
      document.getElementById('vault-pw').value = '';
      render(); renderIndicator();
      playSound?.('cashout');
    } else {
      err.textContent = 'Wrong password.';
      const card = document.querySelector('.vault-card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      playSound?.('lose');
    }
  }

  function deposit(){
    const inp = document.getElementById('vault-dep-amt');
    const amt = Math.floor((parseFloat(inp.value) || 0) * 100) / 100;
    if(amt <= 0){ alert('Enter an amount to vault.'); return; }
    if(amt > balances[currency]){ alert(`Not enough unlocked ${currency}.`); return; }
    balances[currency] = +(balances[currency] - amt).toFixed(2);
    vault[currency] = +(vault[currency] + amt).toFixed(2);
    inp.value = '';
    save(); saveState(); updateBalanceDisplay(true);
    render(); renderIndicator();
    playSound?.('bet');
  }

  function withdraw(){
    if(!unlocked) return;
    const inp = document.getElementById('vault-wd-amt');
    const amt = Math.floor((parseFloat(inp.value) || 0) * 100) / 100;
    if(amt <= 0){ alert('Enter an amount to withdraw.'); return; }
    if(amt > vault[currency]){ alert(`Only ${fmt(vault[currency])} ${currency} is vaulted.`); return; }
    vault[currency] = +(vault[currency] - amt).toFixed(2);
    balances[currency] = +(balances[currency] + amt).toFixed(2);
    inp.value = '';
    save(); saveState(); updateBalanceDisplay(true);
    render(); renderIndicator();
    playSound?.('cashout');
  }

  function openVault(){
    render();
    openModal('modal-vault');
    playSound?.('click');
  }

  /* ---------- boot ---------- */
  load();
  const boot = () => renderIndicator();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { open: openVault, balance, hasFunds };
})();
