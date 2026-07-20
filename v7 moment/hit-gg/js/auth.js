/* ============ AUTH (front-end demo only) ============
   No accounts are created and no passwords are checked or stored.
   Wire real authentication (backend + session, or an identity
   provider like Auth0/Clerk/Firebase Auth) before this goes near real users.
   ==================================================== */

let authMode = 'login';

function setAuthMode(mode){
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode==='login');
  document.getElementById('tab-signup').classList.toggle('active', mode==='signup');
  document.getElementById('field-username').style.display = mode==='signup' ? 'block' : 'none';
  document.getElementById('auth-submit-label').textContent = mode==='login' ? 'Log in' : 'Sign up';
}

function submitAuth(evt){
  evt.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const usernameField = document.getElementById('auth-username');
  const username = (authMode === 'signup' && usernameField.value.trim())
    ? usernameField.value.trim()
    : email.split('@')[0] || 'Player';

  const btn = document.getElementById('auth-submit-btn');
  const label = document.getElementById('auth-submit-label');
  const original = label.textContent;
  btn.disabled = true;
  label.innerHTML = `<span class="spinner"></span>${authMode==='login' ? 'Logging in…' : 'Creating account…'}`;

  // ---- TODO: replace with a real call to your auth backend / identity provider ----
  // const res = await fetch('/api/auth/' + authMode, { method:'POST', body: JSON.stringify({email, password}) });
  // On success, set a real session (httpOnly cookie or token) before redirecting.

  setTimeout(() => {
    window.location.href = 'index.html?u=' + encodeURIComponent(username);
  }, 550);
}

function continueAsGuest(){
  const guestName = 'Guest' + Math.floor(1000 + Math.random()*9000);
  window.location.href = 'index.html?u=' + encodeURIComponent(guestName);
}
