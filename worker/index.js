// Customer accounts API (/api/*) and the sign-in gate in front of every page.
// Requests reach this Worker before static assets (run_worker_first in
// wrangler.jsonc); public files are passed straight through.
//
// Storage: the D1 database bound as DB. Tables are created on first use, so a
// fresh (auto-provisioned) database needs no manual migration.

const SESSION_COOKIE = "hyl_session";
const SESSION_TTL = 30 * 24 * 60 * 60; // seconds
const PBKDF2_ITERATIONS = 100000; // Workers' maximum for PBKDF2
const FAILURE_WINDOW = 15 * 60; // seconds
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 30;
const MAX_SIGNUPS_PER_IP = 10;
const MAX_LOOKUPS_PER_IP = 40;

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
];

let schemaReady;
function ensureSchema(db) {
  schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((error) => {
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
      `SELECT u.id, u.email, u.name, u.organization FROM sessions s
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
    if (request.method === "GET") return json({ user: user && publicUser(user) });
    if (!user) return fail(401, "Please sign in.");
    if (request.method === "PUT") return updateProfile(request, db, user);
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
