// Admin mini CRM: overview, customers (with private notes, temporary
// passwords, deletion) and the order pipeline. All data comes from /api/admin/*,
// which the Worker restricts to the administrator account.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STATUS = { new: 'Awaiting invoice', invoiced: 'Invoice sent', paid: 'Paid', shipped: 'Shipped', cancelled: 'Cancelled' };
  const state = { customers: [], orders: [], summary: null, filter: 'all', query: '', openId: null };

  async function api(path, method = 'GET', body) {
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      return response.ok ? { ok: true, ...data } : { ok: false, status: response.status, error: data.error || 'Something went wrong.' };
    } catch {
      return { ok: false, error: 'Couldn’t reach the server. Check your connection.' };
    }
  }

  // Tiny element builder; every value goes in as text, never HTML.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false) el.setAttribute(key, value === true ? '' : value);
    });
    children.flat().forEach((child) => child !== null && child !== undefined && el.append(child instanceof Node ? child : String(child)));
    return el;
  }
  const money = (n) => `$${Number(n || 0).toLocaleString()}`;
  const date = (s) => s ? new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function ago(s) {
    if (!s) return 'Never';
    const minutes = Math.round((s * 1000 - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    const days = Math.round(hours / 24);
    return Math.abs(days) < 30 ? rtf.format(days, 'day') : date(s);
  }
  const statusPill = (status) => h('span', { class: `status status-${status}` }, STATUS[status] || status);
  const itemsText = (order) => order.items.map((item) => `${item.name} ${item.label} × ${item.qty}`).join(', ');
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }

  // ─── Views ───
  function showView() {
    const view = ['overview', 'customers', 'orders'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderOverview() {
    const s = state.summary;
    if (!s) return;
    const tile = (label, value, context) => h('div', { class: 'stat' }, h('p', { class: 'label' }, label), h('p', { class: 'value' }, value), h('p', { class: 'context' }, context));
    $('stats').replaceChildren(
      tile('Customers', s.customers.total.toLocaleString(), `${s.customers.thisWeek} joined this week`),
      tile('Active this week', s.customers.activeThisWeek.toLocaleString(), 'Signed in in the last 7 days'),
      tile('Awaiting invoice', s.orders.awaitingInvoice.toLocaleString(), `${s.orders.total} orders in total`),
      tile('Invoiced, unpaid', money(s.orders.invoicedUnpaid), `${money(s.orders.paidTotal)} paid or shipped`),
    );
    const queue = state.orders.filter((o) => o.status === 'new').slice(0, 6);
    $('queue').replaceChildren(...(queue.length ? queue.map((order) => h('div', { class: 'list-row' },
      h('div', { class: 'who' }, h('strong', { class: 'mono' }, order.reference), h('small', {}, `${order.customer?.name || 'Deleted customer'} · ${order.invoiceEmail}`)),
      h('strong', {}, money(order.subtotal)),
    )) : [h('p', { class: 'empty' }, 'Every order has been invoiced.')]));
    const newest = state.customers.slice(0, 6);
    $('newest').replaceChildren(...(newest.length ? newest.map((c) => h('div', { class: 'list-row' },
      h('button', { type: 'button', onclick: () => openCustomer(c.id) }, h('strong', {}, c.name), h('small', {}, c.email)),
      h('small', {}, ago(c.createdAt)),
    )) : [h('p', { class: 'empty' }, 'No customers yet.')]));
  }

  function renderCustomers() {
    const q = state.query.trim().toLowerCase();
    const rows = state.customers.filter((c) => !q || `${c.name} ${c.email} ${c.organization}`.toLowerCase().includes(q));
    $('navCustomers').textContent = state.customers.length;
    $('customerRows').replaceChildren(...(rows.length ? rows.map((c) => h('tr', { 'data-id': c.id, onclick: (e) => { if (!e.target.closest('button')) openCustomer(c.id); } },
      h('td', {}, h('div', { class: 'who' }, h('button', { type: 'button', onclick: () => openCustomer(c.id) }, c.name, c.role === 'admin' ? h('span', { class: 'role' }, 'Admin') : null), h('small', {}, c.email))),
      h('td', {}, c.organization || '—'),
      h('td', {}, date(c.createdAt)),
      h('td', {}, ago(c.lastLoginAt)),
      h('td', { class: 'num' }, c.orderCount),
      h('td', { class: 'num' }, money(c.orderTotal)),
    )) : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, q ? 'No customers match that search.' : 'No customers yet.'))]));
  }

  function renderOrders() {
    $('navOrders').textContent = state.orders.filter((o) => o.status === 'new').length || '';
    const filters = ['all', ...Object.keys(STATUS)];
    $('statusChips').replaceChildren(...filters.map((f) => h('button', {
      type: 'button',
      'aria-pressed': String(state.filter === f),
      onclick: () => { state.filter = f; renderOrders(); },
    }, f === 'all' ? `All (${state.orders.length})` : `${STATUS[f]} (${state.orders.filter((o) => o.status === f).length})`)));
    const rows = state.orders.filter((o) => state.filter === 'all' || o.status === state.filter);
    $('orderRows').replaceChildren(...(rows.length ? rows.map((order) => h('tr', {},
      h('td', { class: 'mono' }, order.reference),
      h('td', {}, date(order.createdAt)),
      h('td', {}, order.customer?.id
        ? h('div', { class: 'who' }, h('button', { type: 'button', onclick: () => openCustomer(order.customer.id) }, order.customer.name), h('small', {}, `Invoice to ${order.invoiceEmail}`))
        : h('div', { class: 'who' }, h('span', {}, 'Deleted customer'), h('small', {}, `Invoice to ${order.invoiceEmail}`))),
      h('td', { class: 'items' }, itemsText(order)),
      h('td', { class: 'num' }, money(order.subtotal)),
      h('td', {}, statusSelect(order)),
    )) : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'No orders here yet.'))]));
  }

  function statusSelect(order) {
    const select = h('select', { class: 'status-select', 'aria-label': `Status for ${order.reference}` },
      ...Object.entries(STATUS).map(([value, label]) => h('option', { value, selected: order.status === value }, label)));
    select.addEventListener('change', async () => {
      const result = await api(`/api/admin/orders/${order.id}`, 'PUT', { status: select.value });
      if (!result.ok) { toast(result.error); select.value = order.status; return; }
      Object.assign(order, result.order);
      toast(`${order.reference}: ${STATUS[order.status]}`);
      refreshSummary();
      renderOrders();
    });
    return select;
  }

  // ─── Customer drawer ───
  async function openCustomer(id) {
    const result = await api(`/api/admin/customers/${id}`);
    if (!result.ok) { toast(result.error); return; }
    state.openId = id;
    const c = result.customer;
    $('drawerName').textContent = c.name;
    $('drawerEmail').textContent = c.email;
    $('drawerEmail').href = `mailto:${c.email}`;
    $('drawerFacts').replaceChildren(
      ...[['Joined', date(c.createdAt)], ['Last sign-in', ago(c.lastLoginAt)], ['Lifetime orders', `${c.orderCount} · ${money(c.orderTotal)}`]]
        .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
    );
    $('drawerNameInput').value = c.name;
    $('drawerOrg').value = c.organization;
    $('drawerNotes').value = c.notes;
    $('drawerStatus').textContent = '';
    $('tempPassword').textContent = '';
    $('deleteCustomer').hidden = c.role === 'admin';
    $('drawerOrders').replaceChildren(...(result.orders.length ? result.orders.map((o) => h('div', { class: 'order-mini' },
      h('strong', { class: 'mono' }, o.reference), h('span', {}, `${date(o.createdAt)} · ${money(o.subtotal)}`), statusPill(o.status),
      h('p', {}, itemsText(o)),
    )) : [h('p', { class: 'empty' }, 'No orders yet.')]));
    if (!$('customerDrawer').open) $('customerDrawer').showModal();
  }

  $('drawerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api(`/api/admin/customers/${state.openId}`, 'PUT', {
      name: $('drawerNameInput').value, organization: $('drawerOrg').value, notes: $('drawerNotes').value,
    });
    $('drawerStatus').textContent = result.ok ? 'Saved.' : result.error;
    if (result.ok) {
      Object.assign(state.customers.find((c) => c.id === state.openId) || {}, result.customer);
      $('drawerName').textContent = result.customer.name;
      renderCustomers(); renderOverview();
    }
  });
  $('resetPassword').addEventListener('click', async () => {
    if (!confirm('Create a temporary password? The customer will be signed out everywhere.')) return;
    const result = await api(`/api/admin/customers/${state.openId}/password`, 'POST');
    $('tempPassword').textContent = result.ok ? result.password : result.error;
    if (result.ok) toast('Temporary password created. Send it to the customer privately.');
  });
  $('deleteCustomer').addEventListener('click', async () => {
    const customer = state.customers.find((c) => c.id === state.openId);
    if (!confirm(`Delete ${customer?.name || 'this customer'}? This can’t be undone.`)) return;
    const result = await api(`/api/admin/customers/${state.openId}`, 'DELETE');
    if (!result.ok) { toast(result.error); return; }
    $('customerDrawer').close();
    toast('Customer deleted.');
    load();
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $('customerDrawer').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });

  // ─── Data ───
  async function refreshSummary() {
    const summary = await api('/api/admin/summary');
    if (summary.ok) { state.summary = summary; renderOverview(); }
  }
  async function load() {
    const [summary, customers, orders] = await Promise.all([api('/api/admin/summary'), api('/api/admin/customers'), api('/api/admin/orders')]);
    if (!summary.ok || !customers.ok || !orders.ok) { toast((summary.ok ? customers.ok ? orders : customers : summary).error); return; }
    state.summary = summary; state.customers = customers.customers; state.orders = orders.orders;
    renderOverview(); renderCustomers(); renderOrders();
  }

  $('customerSearch').addEventListener('input', (event) => { state.query = event.target.value; renderCustomers(); });
  document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => load().then(() => toast('Up to date.'))));
  document.querySelectorAll('[data-filter-link]').forEach((a) => a.addEventListener('click', () => { state.filter = a.dataset.filterLink; renderOrders(); }));
  $('exportCustomers').addEventListener('click', () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Name', 'Email', 'Organization', 'Joined', 'Last sign-in', 'Orders', 'Order total (USD)', 'Notes'];
    const rows = state.customers.map((c) => [c.name, c.email, c.organization, date(c.createdAt), c.lastLoginAt ? date(c.lastLoginAt) : '', c.orderCount, c.orderTotal, c.notes]);
    const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
    const link = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `hello-you-customers-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $('adminSignOut').addEventListener('click', async () => {
    await api('/api/logout', 'POST');
    try { localStorage.removeItem('hyl_account_name'); } catch {}
    location.replace('/login');
  });
  addEventListener('hashchange', showView);

  $('claimForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/admin/claim', 'POST', { code: $('claimCode').value });
    if (!result.ok) { $('claimError').textContent = result.error; return; }
    $('claimView').hidden = true;
    start();
  });

  async function start() {
    const [status, me] = await Promise.all([api('/api/admin/status'), api('/api/me')]);
    document.body.removeAttribute('data-state');
    if (status.status === 401) { location.replace('/login?next=%2Fadmin'); return; }
    if (!status.ok || !status.admin) {
      $(status.canClaim ? 'claimView' : 'deniedView').hidden = false;
      if (status.canClaim) $('claimCode').focus();
      return;
    }
    const hour = new Date().getHours();
    const name = me.user?.name || '';
    $('greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}.`;
    $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    showView();
    await load();
  }
  start();
})();
