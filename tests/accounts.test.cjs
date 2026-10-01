// Customer accounts run on the Worker, so these tests use wrangler's local
// runtime with a throwaway D1 database instead of the static preview server.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const crypto = require("node:crypto");
const { unstable_startWorker } = require("wrangler");

// The real admin setup code is never in the repo; tests swap in their own.
const ADMIN_EMAIL = "yanelysfundora2@yahoo.com";
const TEST_ADMIN_CODE = "TEST01-TEST02-TEST03-TEST04";

let worker, browser, baseURL, persistDir;
before(async () => {
  persistDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyl-accounts-"));
  worker = await unstable_startWorker({
    config: path.resolve(__dirname, "../wrangler.jsonc"),
    bindings: {
      ADMIN_CLAIM_SHA256: { type: "plain_text", value: crypto.createHash("sha256").update(TEST_ADMIN_CODE).digest("hex") },
    },
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

test("checkout records orders the customer and the admin can see; admin needs the setup code", async (t) => {
  const session = async (name, email) => {
    const response = await post("/api/signup", { name, email, password: `${name} password` });
    return response.headers.get("set-cookie").split(";")[0];
  };
  const as = (cookie) => (route, method = "GET", body) =>
    fetch(`${baseURL}${route}`, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body && JSON.stringify(body) });

  // A customer checks out in the browser; the order is recorded with catalog prices.
  const page = await newPage(t);
  await page.goto(`${baseURL}/login`);
  await page.locator("#loginEmail").fill("orders@example.com");
  await page.locator("#loginSubmit").click();
  await page.locator("#signupName").fill("Olive");
  await page.locator("#loginPassword").fill("olive password");
  await page.locator("#loginSubmit").click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.evaluate(() => { window.open = (url) => { window.testCheckout = url; }; });
  await page.locator('[data-add="sema"]').click();
  await page.locator("[data-cart-open]").click();
  assert.equal(await page.locator("#invoiceEmail").inputValue(), "orders@example.com", "Invoice email is pre-filled");
  await page.locator("#researchConfirm").check();
  const recorded = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
  await page.locator("#cartCheckout").click();
  assert.equal((await recorded).status(), 201);
  const reference = await page.locator("#orderConfirmationReference").textContent();
  assert.match(reference, /^HY-[A-Z0-9]{6}$/);
  assert.ok(decodeURIComponent(await page.evaluate(() => window.testCheckout)).includes(reference), "WhatsApp message carries the reference");
  await page.goto(`${baseURL}/account.html`);
  await page.locator(".order-row", { hasText: reference }).waitFor();
  assert.equal(await page.locator("#accountOrderCount").textContent(), "1");

  // Tampered prices or unknown items are rejected by the server.
  const customer = as(await session("Mallory", "mallory@example.com"));
  assert.equal((await customer("/api/orders", "POST", { reference: "HY-AAAAAA", invoiceEmail: "m@example.com", items: [{ variantId: "nope", qty: 1 }] })).status, 400);
  assert.equal((await customer("/api/admin/customers")).status, 403, "Customers can’t read the CRM");
  assert.equal((await customer("/api/admin/claim", "POST", { code: TEST_ADMIN_CODE })).status, 403, "Only the admin email may claim");
  assert.equal((await fetch(`${baseURL}/admin`, { redirect: "manual", headers: { Cookie: (await session("Eve", "eve2@example.com")) } })).status, 302);

  // The admin email alone is not enough; the setup code unlocks the CRM once.
  const admin = as(await session("Clinic", ADMIN_EMAIL));
  assert.deepEqual(await (await admin("/api/admin/status")).json(), { admin: false, canClaim: true });
  assert.equal((await admin("/api/admin/customers")).status, 403);
  assert.equal((await admin("/api/admin/claim", "POST", { code: "WRONG" })).status, 403);
  assert.equal((await admin("/api/admin/claim", "POST", { code: TEST_ADMIN_CODE.toLowerCase() })).status, 200);

  const { customers } = await (await admin("/api/admin/customers")).json();
  const olive = customers.find((c) => c.email === "orders@example.com");
  assert.equal(olive.orderCount, 1);
  assert.equal(olive.orderTotal, 77);
  const { orders } = await (await admin("/api/admin/orders?status=new")).json();
  const order = orders.find((o) => o.reference === reference);
  assert.equal(order.customer.name, "Olive");
  assert.equal((await admin(`/api/admin/orders/${order.id}`, "PUT", { status: "invoiced" })).status, 200);
  assert.equal((await (await admin("/api/admin/summary")).json()).orders.invoicedUnpaid, 77);
  assert.equal((await admin(`/api/admin/customers/${olive.id}`, "PUT", { notes: "Prefers 10 mg vials." })).status, 200);

  // Temporary password: works, and signs the customer out everywhere.
  const { password } = await (await admin(`/api/admin/customers/${olive.id}/password`, "POST")).json();
  assert.equal((await post("/api/login", { email: "orders@example.com", password })).status, 200);

  // The admin page renders the CRM for the admin.
  const adminPage = await newPage(t);
  await adminPage.context().addCookies([{ name: "hyl_session", value: (await (await post("/api/login", { email: ADMIN_EMAIL, password: "Clinic password" })).headers.get("set-cookie")).split(";")[0].split("=")[1], url: baseURL }]);
  await adminPage.goto(`${baseURL}/admin#customers`);
  await adminPage.locator("#customerRows tr", { hasText: "Olive" }).waitFor();
  await adminPage.locator("#customerRows button", { hasText: "Olive" }).click();
  await adminPage.locator("#customerDrawer[open]").waitFor();
  assert.equal(await adminPage.locator("#drawerNotes").inputValue(), "Prefers 10 mg vials.");
  const axe = await new AxeBuilder({ page: adminPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(axe.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })), []);
});
