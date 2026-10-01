// Customer accounts run on the Worker, so these tests use wrangler's local
// runtime with a throwaway D1 database instead of the static preview server.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { unstable_startWorker } = require("wrangler");

let worker, browser, baseURL, persistDir;
before(async () => {
  persistDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyl-accounts-"));
  worker = await unstable_startWorker({
    config: path.resolve(__dirname, "../wrangler.jsonc"),
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: persistDir,
      logLevel: "warn",
    },
  });
  baseURL = (await worker.url).origin;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  await worker?.dispose();
  if (persistDir) fs.rmSync(persistDir, { recursive: true, force: true });
});

const post = (route, body, headers = {}) =>
  fetch(`${baseURL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function newPage(t, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "No JavaScript errors"));
  return page;
}

test("every page requires sign-in; the login and wholesale application pages stay public", async () => {
  const get = (route, headers = {}) => fetch(`${baseURL}${route}`, { redirect: "manual", headers });
  let response = await get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login");
  response = await get("/account.html?tab=1");
  assert.equal(response.headers.get("location"), `/login?next=${encodeURIComponent("/account.html?tab=1")}`);
  for (const route of ["/standards", "/wholesale.html", "/documentation.html"])
    assert.equal((await get(route)).status, 302, route);
  assert.equal((await get("/assets/catalog.js")).status, 401, "Pricing data needs a session");
  for (const route of ["/login", "/wholesale-apply", "/assets/login.css", "/assets/images/logo-light.webp"])
    assert.equal((await get(route)).status, 200, route);

  const signup = await post("/api/signup", { name: "Gate", email: "gate@example.com", password: "gate password" });
  const session = signup.headers.get("set-cookie").split(";")[0];
  response = await get("/", { Cookie: session });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await get("/assets/catalog.js", { Cookie: session })).status, 200);
  assert.equal((await get("/login?next=%2Fstandards", { Cookie: session })).headers.get("location"), "/standards");
  assert.equal((await get("/login?next=%2F%2Fevil.example", { Cookie: session })).headers.get("location"), "/", "No open redirect");
});

test("email-first sign-up, sign out, sign back in, and edit the profile", async (t) => {
  const page = await newPage(t);
  await page.goto(`${baseURL}/account.html`);
  await page.waitForURL(/\/login\?next=/);

  await page.locator("#loginEmail").fill("Alex@Example.com");
  await page.locator("#loginSubmit").click();
  await page.locator("#signupName").waitFor();
  assert.equal(await page.locator("#loginTitle").textContent(), "Create your Hello You account.");
  await page.locator("#signupName").fill("Alex");
  await page.locator("#loginPassword").fill("short");
  await page.locator("#loginSubmit").click();
  assert.match(await page.locator("#loginError").textContent(), /at least 8/);
  await page.locator("#loginPassword").fill("correct horse battery");
  await page.locator("#loginSubmit").click();
  await page.waitForURL(/\/account/);
  await page.locator("#accountName", { hasText: "Alex" }).waitFor();
  assert.equal(await page.locator("#profileEmail").inputValue(), "alex@example.com");

  await page.locator("#profileOrganization").fill("Example Lab");
  await page.locator("#profileForm button").click();
  await page.locator("#profileStatus", { hasText: "Saved." }).waitFor();
  await page.reload();
  await page.locator("#accountName", { hasText: "Alex" }).waitFor();
  assert.equal(await page.locator("#profileOrganization").inputValue(), "Example Lab");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Account fits ${width}px`);
  }
  await page.goto(baseURL);
  assert.equal(await page.locator("#heroEyebrow").textContent(), "WELCOME BACK, ALEX / RESEARCH COLLECTION");

  await page.goto(`${baseURL}/account.html`);
  await page.locator("#signOut").click();
  await page.waitForURL(/\/login/);
  await page.goto(baseURL);
  await page.waitForURL(/\/login$/);

  await page.locator("#loginEmail").fill("alex@example.com");
  await page.locator("#loginSubmit").click();
  await page.locator("#loginPassword").waitFor();
  assert.equal(await page.locator("#signupName").isVisible(), false);
  await page.locator("#loginPassword").fill("wrong password");
  await page.locator("#loginSubmit").click();
  await page.locator("#loginError", { hasText: "don’t match" }).waitFor();
  assert.equal(await page.locator("#loginPassword").inputValue(), "", "Password is cleared after a failed attempt");
  await page.locator("#loginPassword").fill("correct horse battery");
  await page.locator("#loginSubmit").click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator(".product-card").first().waitFor();
});

test("the API rejects duplicate emails, cross-site writes, and repeated bad passwords", async () => {
  const account = { name: "Sam", email: "sam@example.com", password: "a long password" };
  assert.equal((await post("/api/signup", account)).status, 201);
  assert.equal((await post("/api/signup", { ...account, email: "SAM@example.com" })).status, 409);

  const login = await post("/api/login", { email: account.email, password: account.password });
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const session = cookie.split(";")[0];
  const crossSite = await fetch(`${baseURL}/api/me`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://example.net", Cookie: session },
    body: JSON.stringify({ name: "Mallory" }),
  });
  assert.equal(crossSite.status, 403);
  const me = await (await fetch(`${baseURL}/api/me`, { headers: { Cookie: session } })).json();
  assert.equal(me.user.name, "Sam");
  assert.equal((await (await fetch(`${baseURL}/api/me`)).json()).user, null);

  for (let i = 0; i < 10; i++)
    assert.equal((await post("/api/login", { email: account.email, password: "wrong guess" })).status, 401);
  // Locked out even with the right password until the window passes.
  assert.equal((await post("/api/login", { email: account.email, password: account.password })).status, 429);
});

test("the sign-in page fits small screens and passes automated accessibility checks", async (t) => {
  for (const viewport of [{ width: 320, height: 800 }, { width: 1440, height: 900 }]) {
    const page = await newPage(t, viewport);
    // Measure settled colours, not the entrance fade.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${baseURL}/login`);
    const check = async (label) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} fits ${viewport.width}px`);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })), [], label);
    };
    await check("email step");
    await page.locator("#startSignup").click();
    await page.locator("#loginEmail").fill(`axe-${viewport.width}@example.com`);
    await page.locator("#loginSubmit").click();
    await page.locator("#signupName").waitFor();
    await check("sign-up step");
  }
});
