// Customer accounts API (/api/*) and the sign-in gate in front of every page.
// Requests reach this Worker before static assets (run_worker_first in
// wrangler.jsonc); public files are passed straight through.
//
// Storage: the D1 database bound as DB. Tables are created on first use, so a
// fresh (auto-provisioned) database needs no manual migration.

import catalog from "../assets/catalog.js";

const SESSION_COOKIE = "hyl_session";
const SESSION_TTL = 30 * 24 * 60 * 60; // seconds
const PBKDF2_ITERATIONS = 100000; // Workers' maximum for PBKDF2
const FAILURE_WINDOW = 15 * 60; // seconds
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 30;
const MAX_SIGNUPS_PER_IP = 10;
const MAX_LOOKUPS_PER_IP = 40;
const MAX_ORDERS_PER_USER = 20; // per FAILURE_WINDOW
const MAX_CLAIM_ATTEMPTS = 5; // per FAILURE_WINDOW
const ORDER_STATUSES = ["new", "invoiced", "paid", "shipped", "cancelled"];

// Priced variants keyed the same way the storefront keys its cart items.
const VARIANTS = new Map(
  catalog.PRODUCTS.flatMap((product) =>
    product.variants.map((variant) => [
      `${product.id}-${String(variant.mgLabel || variant.mg).replace(/\s/g, "").replace(/\+/g, "x")}-${variant.ml}ml`,
      { name: product.name, label: variant.label || `${variant.mg} mg · ${variant.ml} mL`, price: variant.price },
    ]),
  ),
);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_events (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_events_key ON auth_events(key, at)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    invoice_email TEXT NOT NULL,
    items TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at)`,
];
// Columns added after launch. SQLite has no ADD COLUMN IF NOT EXISTS, so a
// "duplicate column" error means the column is already there.
const ADDED_COLUMNS = [
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'`,
  `ALTER TABLE users ADD COLUMN notes TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN last_login_at INTEGER`,
];

let schemaReady;
function ensureSchema(db) {
  schemaReady ??= (async () => {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    for (const sql of ADDED_COLUMNS) {
      try {
        await db.prepare(sql).run();
      } catch (error) {
        if (!/duplicate column/i.test(String(error?.message))) throw error;
      }
    }
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
  );
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2-sha256") return false;
  const derived = await pbkdf2(password, fromBase64(salt), Number(iterations));
  return constantTimeEqual(derived, fromBase64(hash));
}

// Compared against when an email has no account, so a missing account takes
// as long to reject as a wrong password.
let dummyHash;

async function sha256(text) {
  return toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
const fail = (status, error) => json({ error }, status);

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return null;
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const text = (value) => (typeof value === "string" ? value.trim() : "");
const publicUser = (user) => ({ name: user.name, email: user.email, organization: user.organization });

function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8) return "Use at least 8 characters for your password.";
  if (value.length > 200) return "Use 200 characters or fewer for your password.";
  return null;
}

async function recentEvents(db, key) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM auth_events WHERE key = ? AND at > ?")
    .bind(key, now() - FAILURE_WINDOW)
    .first();
  return row.n;
}

async function recordEvents(db, keys) {
  const at = now();
  await db.batch([
    db.prepare("DELETE FROM auth_events WHERE at <= ?").bind(at - 60 * 60),
    ...keys.map((key) => db.prepare("INSERT INTO auth_events (key, at) VALUES (?, ?)").bind(key, at)),
  ]);
}

async function startSession(request, db, userId) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, now()),
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), userId),
    db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), userId, now() + SESSION_TTL),
  ]);
  return sessionCookie(request, token, SESSION_TTL);
}

async function currentUser(request, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.organization, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(token), now())
    .first();
}

async function signup(request, db, ip) {
  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request.");
  const name = text(body.name);
  const email = normalizeEmail(body.email);
  const passwordError = validatePassword(body.password);
  if (!name || name.length > 50) return fail(400, "Please enter your name (50 characters or fewer).");
  if (!email) return fail(400, "Please enter a valid email address.");
  if (passwordError) return fail(400, passwordError);
  if ((await recentEvents(db, `signup:${ip}`)) >= MAX_SIGNUPS_PER_IP)
    return fail(429, "Too many new accounts from this network. Please try again later.");

  const passwordHash = await hashPassword(body.password);
  const created = await db
    .prepare(
      `INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING RETURNING id, email, name, organization`,
    )
    .bind(email, name, passwordHash, now())
    .first();
  if (!created) return fail(409, "An account with this email already exists. Try signing in.");
  await recordEvents(db, [`signup:${ip}`]);
  return json({ user: publicUser(created) }, 201, { "Set-Cookie": await startSession(request, db, created.id) });
}

async function login(request, db, ip) {
  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request.");
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return fail(400, "Please enter your email and password.");

  const emailKey = `login:${email}`;
  const ipKey = `login-ip:${ip}`;
  if (
    (await recentEvents(db, emailKey)) >= MAX_FAILURES_PER_EMAIL ||
    (await recentEvents(db, ipKey)) >= MAX_FAILURES_PER_IP
  )
    return fail(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");

  const user = await db
    .prepare("SELECT id, email, name, organization, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first();
  dummyHash ??= await hashPassword(crypto.randomUUID());
  const valid = await verifyPassword(password, user ? user.password_hash : dummyHash);
  if (!user || !valid) {
    await recordEvents(db, [emailKey, ipKey]);
    return fail(401, "That email and password don’t match an account.");
  }
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": await startSession(request, db, user.id) });
}

// Email-first sign-in: tells the page whether to ask for a password or offer
// account creation. Sign-up already reveals whether an email is registered,
// so this exposes nothing new; it is rate limited per network all the same.
async function lookup(request, db, ip) {
  const body = await readJson(request);
  const email = body && normalizeEmail(body.email);
  if (!email) return fail(400, "Please enter a valid email address.");
  if ((await recentEvents(db, `lookup:${ip}`)) >= MAX_LOOKUPS_PER_IP)
    return fail(429, "Too many attempts. Please wait 15 minutes and try again.");
  await recordEvents(db, [`lookup:${ip}`]);
  const user = await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  return json({ exists: Boolean(user) });
}

async function logout(request, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}

async function updateProfile(request, db, user) {
  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request.");
  const name = text(body.name);
  const organization = text(body.organization);
  if (!name || name.length > 50) return fail(400, "Please enter your name (50 characters or fewer).");
  if (organization.length > 100) return fail(400, "Use 100 characters or fewer for your organization.");
  const updated = await db
    .prepare("UPDATE users SET name = ?, organization = ? WHERE id = ? RETURNING email, name, organization")
    .bind(name, organization, user.id)
    .first();
  return json({ user: publicUser(updated) });
}

// ─── Orders ───
// Checkout records the order here (prices recomputed from the catalog) and
// hands the same reference to WhatsApp, so the team can match the two.
const parseOrder = (row) => ({
  id: row.id,
  reference: row.reference,
  invoiceEmail: row.invoice_email,
  items: JSON.parse(row.items),
  subtotal: row.subtotal,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.customer_name !== undefined && { customer: { id: row.user_id, name: row.customer_name, email: row.customer_email } }),
});

async function createOrder(request, db, user) {
  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request.");
  const reference = text(body.reference);
  const invoiceEmail = normalizeEmail(body.invoiceEmail);
  if (!/^HY-[A-Z0-9]{6}$/.test(reference)) return fail(400, "Invalid order reference.");
  if (!invoiceEmail) return fail(400, "Please enter a valid invoice email.");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) return fail(400, "Your cart is empty.");
  const items = [];
  for (const item of body.items) {
    const variant = VARIANTS.get(item?.variantId);
    if (!variant || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) return fail(400, "Your cart has an item we couldn’t price.");
    items.push({ variantId: item.variantId, name: variant.name, label: variant.label, qty: item.qty, unitPrice: variant.price });
  }
  const key = `order:${user.id}`;
  if ((await recentEvents(db, key)) >= MAX_ORDERS_PER_USER) return fail(429, "Too many orders in a short time. Please message our team.");
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const at = now();
  const row = await db
    .prepare(
      `INSERT INTO orders (reference, user_id, invoice_email, items, subtotal, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?, ?) ON CONFLICT(reference) DO NOTHING RETURNING *`,
    )
    .bind(reference, user.id, invoiceEmail, JSON.stringify(items), subtotal, at, at)
    .first();
  if (!row) return fail(409, "This order was already recorded.");
  await recordEvents(db, [key]);
  return json({ order: parseOrder(row) }, 201);
}

async function listOwnOrders(db, user) {
  const { results } = await db
    .prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(user.id)
    .all();
  return json({ orders: results.map(parseOrder) });
}

// ─── Admin (mini CRM) ───
// The admin is the account whose email is ADMIN_EMAIL, after it proves itself
// once with the setup code (only its SHA-256 is in config). Sign-up does not
// verify email ownership, so the email alone must never grant access.
const isAdminEmail = (env, user) => Boolean(env.ADMIN_EMAIL) && user.email === env.ADMIN_EMAIL.toLowerCase();
const isAdmin = (env, user) => user.role === "admin" && isAdminEmail(env, user);

async function claimAdmin(request, env, db, user) {
  if (!isAdminEmail(env, user) || !env.ADMIN_CLAIM_SHA256) return fail(403, "This account can’t be an administrator.");
  const key = `claim:${user.id}`;
  if ((await recentEvents(db, key)) >= MAX_CLAIM_ATTEMPTS) return fail(429, "Too many attempts. Please wait 15 minutes.");
  const body = await readJson(request);
  const code = text(body?.code).toUpperCase();
  const digest = encoder.encode(await sha256Hex(code));
  if (!code || !constantTimeEqual(digest, encoder.encode(env.ADMIN_CLAIM_SHA256.toLowerCase()))) {
    await recordEvents(db, [key]);
    return fail(403, "That setup code isn’t right.");
  }
  await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
  return json({ admin: true });
}

const customerRow = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  organization: row.organization,
  role: row.role,
  notes: row.notes,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
  orderCount: row.order_count ?? 0,
  orderTotal: row.order_total ?? 0,
  lastOrderAt: row.last_order_at ?? null,
});

const CUSTOMER_SELECT = `SELECT u.id, u.name, u.email, u.organization, u.role, u.notes, u.created_at, u.last_login_at,
  COUNT(o.id) AS order_count,
  COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.subtotal END), 0) AS order_total,
  MAX(o.created_at) AS last_order_at
  FROM users u LEFT JOIN orders o ON o.user_id = u.id`;

async function handleAdmin(request, env, db, user, url) {
  const parts = url.pathname.split("/").slice(3); // after /api/admin
  const method = request.method;
  if (parts[0] === "status" && method === "GET")
    return json({ admin: isAdmin(env, user), canClaim: isAdminEmail(env, user) && !isAdmin(env, user) });
  if (parts[0] === "claim" && method === "POST") return claimAdmin(request, env, db, user);
  if (!isAdmin(env, user)) return fail(403, "Administrators only.");

  if (parts[0] === "summary" && method === "GET") {
    const weekAgo = now() - 7 * 24 * 60 * 60;
    const [customers, orders] = await db.batch([
      db.prepare("SELECT COUNT(*) AS total, SUM(created_at > ?) AS this_week, SUM(last_login_at > ?) AS active_week FROM users").bind(weekAgo, weekAgo),
      db.prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'new') AS awaiting_invoice,
          COALESCE(SUM(CASE WHEN status = 'invoiced' THEN subtotal END), 0) AS invoiced_unpaid,
          COALESCE(SUM(CASE WHEN status IN ('paid', 'shipped') THEN subtotal END), 0) AS paid_total
         FROM orders`,
      ),
    ]);
    const c = customers.results[0], o = orders.results[0];
    return json({
      customers: { total: c.total, thisWeek: c.this_week ?? 0, activeThisWeek: c.active_week ?? 0 },
      orders: { total: o.total, awaitingInvoice: o.awaiting_invoice ?? 0, invoicedUnpaid: o.invoiced_unpaid, paidTotal: o.paid_total },
    });
  }

  if (parts[0] === "customers") {
    const id = Number(parts[1]);
    if (!parts[1] && method === "GET") {
      const { results } = await db.prepare(`${CUSTOMER_SELECT} GROUP BY u.id ORDER BY u.created_at DESC LIMIT 2000`).all();
      return json({ customers: results.map(customerRow) });
    }
    if (!Number.isSafeInteger(id)) return fail(404, "Not found.");
    const row = await db.prepare(`${CUSTOMER_SELECT} WHERE u.id = ? GROUP BY u.id`).bind(id).first();
    if (!row) return fail(404, "Customer not found.");
    if (!parts[2] && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").bind(id).all();
      return json({ customer: customerRow(row), orders: results.map(parseOrder) });
    }
    if (!parts[2] && method === "PUT") {
      const body = await readJson(request);
      if (!body) return fail(400, "Invalid request.");
      const notes = typeof body.notes === "string" ? body.notes.slice(0, 5000) : row.notes;
      const name = body.name === undefined ? row.name : text(body.name);
      const organization = body.organization === undefined ? row.organization : text(body.organization);
      if (!name || name.length > 50 || organization.length > 100) return fail(400, "Check the name and organization lengths.");
      await db.prepare("UPDATE users SET notes = ?, name = ?, organization = ? WHERE id = ?").bind(notes, name, organization, id).run();
      return json({ customer: customerRow({ ...row, notes, name, organization }) });
    }
    if (parts[2] === "password" && method === "POST") {
      // A readable one-time password the admin passes on; it signs the customer out everywhere.
      const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(14));
      const password = [...bytes].map((b) => alphabet[b % alphabet.length]).join("").replace(/(.{7})/, "$1-");
      await db.batch([
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      ]);
      return json({ password });
    }
    if (!parts[2] && method === "DELETE") {
      if (id === user.id) return fail(400, "You can’t delete your own account here.");
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
        db.prepare("UPDATE orders SET user_id = NULL WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if (parts[0] === "orders") {
    if (!parts[1] && method === "GET") {
      const status = url.searchParams.get("status");
      const filter = ORDER_STATUSES.includes(status) ? "WHERE o.status = ?" : "";
      const statement = db.prepare(
        `SELECT o.*, u.name AS customer_name, u.email AS customer_email FROM orders o
         LEFT JOIN users u ON u.id = o.user_id ${filter} ORDER BY o.created_at DESC LIMIT 1000`,
      );
      const { results } = await (filter ? statement.bind(status) : statement).all();
      return json({ orders: results.map(parseOrder) });
    }
    const id = Number(parts[1]);
    if (Number.isSafeInteger(id) && !parts[2] && method === "PUT") {
      const body = await readJson(request);
      if (!ORDER_STATUSES.includes(body?.status)) return fail(400, "Unknown status.");
      const row = await db
        .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? RETURNING *")
        .bind(body.status, now(), id)
        .first();
      if (!row) return fail(404, "Order not found.");
      return json({ order: parseOrder(row) });
    }
  }
  return fail(404, "Not found.");
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  // Cross-site form posts and fetches are refused; same-origin browsers always send Origin.
  if (request.method !== "GET" && origin && origin !== url.origin) return fail(403, "Cross-origin request refused.");

  const db = env.DB;
  await ensureSchema(db);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const route = `${request.method} ${url.pathname}`;

  if (route === "POST /api/signup") return signup(request, db, ip);
  if (route === "POST /api/login") return login(request, db, ip);
  if (route === "POST /api/logout") return logout(request, db);
  if (route === "POST /api/lookup") return lookup(request, db, ip);
  if (url.pathname === "/api/me") {
    const user = await currentUser(request, db);
    if (request.method === "GET") return json({ user: user && { ...publicUser(user), admin: isAdmin(env, user), canClaimAdmin: isAdminEmail(env, user) && !isAdmin(env, user) } });
    if (!user) return fail(401, "Please sign in.");
    if (request.method === "PUT") return updateProfile(request, db, user);
    return fail(405, "Method not allowed.");
  }
  if (url.pathname === "/api/orders" || url.pathname.startsWith("/api/admin/")) {
    const user = await currentUser(request, db);
    if (!user) return fail(401, "Please sign in.");
    if (url.pathname.startsWith("/api/admin/")) return handleAdmin(request, env, db, user, url);
    if (request.method === "POST") return createOrder(request, db, user);
    if (request.method === "GET") return listOwnOrders(db, user);
    return fail(405, "Method not allowed.");
  }
  return fail(404, "Not found.");
}

// The whole site sits behind sign-in. These stay public so visitors can sign
// in or apply; static media (images, styles, scripts) is public too, except
// the catalog data, which carries pricing.
const PUBLIC_PAGES = new Set(["/login", "/login.html", "/wholesale-apply", "/wholesale-apply.html"]);
const GATED_FILES = new Set(["/assets/catalog.js"]);

function isPage(pathname) {
  return !/\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith(".html");
}

// Only same-site paths are allowed as a post-sign-in destination.
function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

async function handlePage(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const gated = GATED_FILES.has(path) || (isPage(path) && !PUBLIC_PAGES.has(path));
  const isLogin = path === "/login" || path === "/login.html";
  if (!gated && !isLogin) return env.ASSETS.fetch(request);

  await ensureSchema(env.DB);
  const user = await currentUser(request, env.DB);
  if (isLogin) {
    if (user) return redirect(safeNext(url.searchParams.get("next")));
    return env.ASSETS.fetch(request);
  }
  if (user && (path === "/admin" || path === "/admin.html") && !isAdminEmail(env, user)) return redirect("/");
  if (!user) {
    if (!isPage(path)) return new Response("Please sign in.", { status: 401, headers: { "Cache-Control": "no-store" } });
    const next = path === "/" && !url.search ? "" : `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return redirect(`/login${next}`);
  }
  // Signed-in pages must not be served from a shared or back/forward cache after logout.
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await handleApi(request, env);
      return await handlePage(request, env);
    } catch (error) {
      console.error(error);
      return fail(500, "Something went wrong. Please try again.");
    }
  },
};
