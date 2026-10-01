(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const read = (storage, name, fallback) => {
    try { return JSON.parse(storage.getItem(name)) || fallback; } catch { return fallback; }
  };
  // Remove the name saved by the old local-only account preview.
  try { localStorage.removeItem('hyl_account_preview_v1'); } catch {}
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return { ok: false, error: 'We couldn’t reach Hello You. Check your connection and try again.' };
    }
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, ...data } : { ok: false, status: response.status, error: data.error || 'Sign-in is unavailable right now. Please try again later.' };
  }
  if ($('loginForm')) {
    let mode = 'login';
    const setMode = (next) => {
      mode = next;
      const signup = mode === 'signup';
      document.querySelectorAll('[data-auth-mode]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.authMode === mode)));
      document.querySelectorAll('.signup-only').forEach((el) => { el.hidden = !signup; });
      $('signupName').required = signup;
      $('loginPassword').autocomplete = signup ? 'new-password' : 'current-password';
      $('loginIntro').textContent = signup ? 'Create your Hello You account.' : 'Sign in to your Hello You account.';
      $('loginSubmit').querySelector('.submit-label').textContent = signup ? 'Create account' : 'Sign in';
      $('loginError').textContent = '';
    };
    document.querySelectorAll('[data-auth-mode]').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.authMode)));
    if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup');
    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('signupName').value.trim();
      const email = $('loginEmail').value.trim();
      const password = $('loginPassword').value;
      const error = (message) => { $('loginError').textContent = message; };
      if (mode === 'signup' && !name) return error('Please enter your first name.');
      if (!$('loginEmail').checkValidity() || !email) return error('Please enter a valid email address.');
      if (!password) return error('Please enter your password.');
      if (mode === 'signup' && password.length < 8) return error('Use at least 8 characters for your password.');
      error('');
      $('loginSubmit').disabled = true;
      const result = await api(mode === 'signup' ? '/api/signup' : '/api/login', 'POST', mode === 'signup' ? { name, email, password } : { email, password });
      $('loginSubmit').disabled = false;
      if (result.ok) location.href = 'account.html';
      else { error(result.error); $('loginPassword').value = ''; }
    });
  }
  if ($('accountName')) {
    const showUser = (user) => {
      $('accountName').textContent = user.name;
      $('profileEmail').value = user.email;
      $('profileName').value = user.name;
      $('profileOrganization').value = user.organization;
      // Pre-fills the cart's invoice email field.
      try { localStorage.setItem('hyl_invoice_email', user.email); } catch {}
    };
    const requireUser = async () => {
      const result = await api('/api/me');
      if (!result.ok || !result.user) { location.replace('login.html'); return; }
      showUser(result.user);
      document.body.removeAttribute('data-auth');
    };
    requireUser();
    $('signOut').addEventListener('click', async () => {
      await api('/api/logout', 'POST');
      location.replace('login.html');
    });
    $('profileForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('profileName').value.trim();
      if (!name) { $('profileStatus').textContent = 'Please enter your name.'; return; }
      const result = await api('/api/me', 'PUT', { name, organization: $('profileOrganization').value.trim() });
      if (result.ok) { showUser(result.user); $('profileStatus').textContent = 'Saved.'; }
      else if (result.status === 401) location.replace('login.html');
      else $('profileStatus').textContent = result.error;
    });
    function renderBag() {
      const saved = read(localStorage, 'hyl_cart_v2', {});
      const variants = new Map();
      PRODUCTS.forEach((product) => product.variants.forEach((v) => {
        const id = `${product.id}-${String(v.mgLabel || v.mg).replace(/\s/g, '').replace(/\+/g, 'x')}-${v.ml}ml`;
        variants.set(id, { product, variant: v });
      }));
      const entries = new Map();
      (Array.isArray(saved.items) ? saved.items : []).forEach((item) => {
        if (item && variants.has(item.variantId) && Number.isSafeInteger(item.qty) && item.qty > 0)
          entries.set(item.variantId, Math.min(99, (entries.get(item.variantId) || 0) + item.qty));
      });
      $('accountCartCount').textContent = [...entries.values()].reduce((a, b) => a + b, 0);
      $('accountCart').replaceChildren();
      if (!entries.size) $('accountCart').textContent = 'Your bag is ready for your next discovery.';
      entries.forEach((qty, id) => {
        const { product, variant } = variants.get(id);
        const row = document.createElement('div'); row.className = 'saved-row';
        const label = document.createElement('span'); label.textContent = `${product.name} · ${variant.label || `${variant.mg} mg · ${variant.ml} mL`}`;
        const count = document.createElement('strong'); count.textContent = `× ${qty}`;
        row.append(label, count); $('accountCart').append(row);
      });
    }
    renderBag();
    window.addEventListener('storage', renderBag);
    // Re-check after back/forward navigation in case the visitor signed out in another tab.
    window.addEventListener('pageshow', (event) => { if (event.persisted) requireUser(); });
  }
  if ($('coaProducts')) PRODUCTS.forEach((product) => {
    const row = document.createElement('div'); row.className = 'saved-row';
    const title = document.createElement('span'); title.textContent = product.name;
    const link = document.createElement('a'); link.className = 'text-link'; link.textContent = 'Request COA ↗';
    link.href = `https://wa.me/17867803626?text=${encodeURIComponent(`Hi Hello You Labs, please share the current lot's certificate of analysis for ${product.name}.`)}`;
    link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-label', `Request COA for ${product.name}`);
    row.append(title, link); $('coaProducts').append(row);
  });
})();
