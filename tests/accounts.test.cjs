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

test("create an account, sign out, sign back in, and edit the profile", async (t) => {
  const page = await newPage(t);
  await page.goto(`${baseURL}/account.html`);
  await page.waitForURL(/\/login/);

  await page.locator('[data-auth-mode="signup"]').click();
  await page.locator("#signupName").fill("Alex");
  await page.locator("#loginEmail").fill("Alex@Example.com");
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

  await page.locator("#signOut").click();
  await page.waitForURL(/\/login/);
  await page.goto(`${baseURL}/account.html`);
  await page.waitForURL(/\/login/);

  await page.locator("#loginEmail").fill("alex@example.com");
  await page.locator("#loginPassword").fill("wrong password");
  await page.locator("#loginSubmit").click();
  await page.locator("#loginError", { hasText: "don’t match" }).waitFor();
  assert.equal(await page.locator("#loginPassword").inputValue(), "", "Password is cleared after a failed attempt");
  await page.locator("#loginPassword").fill("correct horse battery");
  await page.locator("#loginSubmit").click();
  await page.waitForURL(/\/account/);
  await page.locator("#accountName", { hasText: "Alex" }).waitFor();
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
  const page = await newPage(t, { width: 320, height: 900 });
  await page.goto(`${baseURL}/login.html`);
  for (const mode of ["login", "signup"]) {
    await page.locator(`[data-auth-mode="${mode}"]`).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${mode} fits 320px`);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })), [], mode);
  }
});
