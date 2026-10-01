(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const read = (storage, name, fallback) => {
    try { return JSON.parse(storage.getItem(name)) || fallback; } catch { return fallback; }
  };
  // Remove the name saved by the old local-only account preview.
  try { localStorage.removeItem('hyl_account_preview_v1'); } catch {}
  // The storefront greets members by name and pre-fills the invoice email from these.
  const rememberUser = (user) => {
    try {
      localStorage.setItem('hyl_account_name', user.name);
      localStorage.setItem('hyl_invoice_email', user.email);
    } catch {}
  };
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
    const params = new URLSearchParams(location.search);
    const requested = params.get('next') || '';
    // Same-site paths only, matching the Worker's check.
    const next = /^\/(?![\/\\])/.test(requested) ? requested : '/';
    const copy = {
      email: ['Members only', 'Sign in to explore the research collection.', 'Continue'],
      password: ['Welcome back', 'Enter your password to continue.', 'Sign in'],
      signup: ['New account', 'Create your Hello You account.', 'Create account'],
    };
    let step = 'email';
    let wantsSignup = false;
    const error = (message) => { $('loginError').textContent = message; };
    const setStep = (nextStep, { focus = true } = {}) => {
      step = nextStep;
      const [kicker, title, label] = nextStep === 'email' && wantsSignup ? ['New account', 'Create your Hello You account.', 'Continue'] : copy[nextStep];
      $('gateKicker').textContent = kicker;
      $('loginTitle').textContent = title;
      $('loginSubmit').querySelector('.submit-label').textContent = label;
      $('loginEmail').readOnly = nextStep !== 'email';
      $('changeEmail').hidden = nextStep === 'email';
      document.querySelectorAll('.step-password').forEach((el) => { el.hidden = nextStep === 'email'; });
      document.querySelectorAll('.step-signup').forEach((el) => { el.hidden = nextStep !== 'signup'; });
      document.querySelectorAll('.step-password-only').forEach((el) => { el.hidden = nextStep !== 'password'; });
      $('loginPassword').autocomplete = nextStep === 'signup' ? 'new-password' : 'current-password';
      $('loginPassword').value = '';
      error('');
      const stepper = $('loginStepper');
      stepper.dataset.step = nextStep;
      stepper.classList.remove('swap'); void stepper.offsetWidth; stepper.classList.add('swap');
      if (focus) ({ email: $('loginEmail'), password: $('loginPassword'), signup: $('signupName') })[nextStep].focus();
    };
    $('changeEmail').addEventListener('click', () => setStep('email'));
    $('startSignup').addEventListener('click', () => {
      wantsSignup = true;
      if (step === 'signup') { $('signupName').focus(); return; }
      if ($('loginEmail').value.trim() && $('loginEmail').checkValidity()) setStep('signup');
      else setStep('email');
      $('loginForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('revealPassword').addEventListener('click', (event) => {
      const show = $('loginPassword').type === 'password';
      $('loginPassword').type = show ? 'text' : 'password';
      event.currentTarget.textContent = show ? 'Hide' : 'Show';
      event.currentTarget.setAttribute('aria-pressed', String(show));
      event.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = $('loginEmail').value.trim();
      const password = $('loginPassword').value;
      const name = $('signupName').value.trim();
      if (!email || !$('loginEmail').checkValidity()) return error('Please enter a valid email address.');
      if (step === 'password' && !password) return error('Please enter your password.');
      if (step === 'signup' && !name) return error('Please enter your first name.');
      if (step === 'signup' && password.length < 8) return error('Use at least 8 characters for your password.');
      error('');
      $('loginSubmit').disabled = true;
      const result = step === 'email'
        ? await api('/api/lookup', 'POST', { email })
        : await api(step === 'signup' ? '/api/signup' : '/api/login', 'POST', step === 'signup' ? { name, email, password } : { email, password });
      $('loginSubmit').disabled = false;
      if (!result.ok) {
        error(result.error);
        $('loginPassword').value = '';
        return;
      }
      if (step !== 'email') {
        rememberUser(result.user);
        location.replace(next);
        return;
      }
      setStep(result.exists ? 'password' : 'signup');
      if (result.exists && wantsSignup) error('You already have an account with this email. Sign in below.');
    });
    const bubble = $('helpBubble');
    try { if (sessionStorage.getItem('hyl_help_dismissed')) bubble.classList.add('collapsed'); } catch {}
    $('helpClose').addEventListener('click', () => {
      bubble.classList.add('collapsed');
      try { sessionStorage.setItem('hyl_help_dismissed', '1'); } catch {}
    });
    if (params.get('mode') === 'signup') { wantsSignup = true; setStep('email', { focus: false }); }
  }
  if ($('accountName')) {
    const showUser = (user) => {
      $('accountName').textContent = user.name;
      $('profileEmail').value = user.email;
      $('profileName').value = user.name;
      $('profileOrganization').value = user.organization;
      rememberUser(user);
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
      try { localStorage.removeItem('hyl_account_name'); } catch {}
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
    const STATUS = { new: 'Awaiting invoice', invoiced: 'Invoice sent', paid: 'Paid', shipped: 'Shipped', cancelled: 'Cancelled' };
    api('/api/orders').then((result) => {
      if (!result.ok) return;
      $('accountOrderCount').textContent = result.orders.length;
      if (!result.orders.length) return;
      $('accountOrders').replaceChildren(...result.orders.map((order) => {
        const row = document.createElement('div'); row.className = 'order-row';
        const head = document.createElement('div');
        const ref = document.createElement('strong'); ref.textContent = order.reference;
        const date = document.createElement('span'); date.textContent = new Date(order.createdAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        head.append(ref, date);
        const items = document.createElement('p'); items.textContent = order.items.map((item) => `${item.name} · ${item.label} × ${item.qty}`).join(', ');
        const total = document.createElement('span'); total.className = 'order-total'; total.textContent = `$${order.subtotal.toLocaleString()}`;
        const status = document.createElement('span'); status.className = `status-pill status-${order.status}`; status.textContent = STATUS[order.status] || order.status;
        row.append(head, items, total, status);
        return row;
      }));
    });
    // The admin gets a shortcut to the CRM from their account page.
    api('/api/me').then((result) => {
      if (!result.ok || !result.user) return;
      const nav = document.querySelector('.portal-nav nav');
      if (result.user.admin || result.user.canClaimAdmin) {
        const link = document.createElement('a'); link.href = 'admin.html'; link.textContent = 'Admin';
        nav?.prepend(link);
      }
    });
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
