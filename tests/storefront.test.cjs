const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { createPreviewServer } = require("../scripts/serve.cjs");

let server, browser, baseURL;
before(async () => {
  server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function visit(t, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    // The static preview server has no accounts API; the Worker tests cover it.
    if (
      response.url().startsWith(baseURL) &&
      !response.url().startsWith(`${baseURL}/api/`) &&
      response.status() >= 400
    )
      errors.push(response.url());
  });
  t.after(() =>
    assert.deepEqual(
      errors,
      [],
      "No JavaScript errors or missing local assets",
    ),
  );
  await page.goto(baseURL, { waitUntil: "networkidle" });
  return page;
}

test("original catalog, filters, variant pricing, and horizontal navigation", async (t) => {
  const page = await visit(t);
  assert.equal(await page.locator(".product-card").count(), 13);
  await page.locator("#productsNext").click();
  await page.waitForFunction(
    () => document.querySelector("#productGrid").scrollLeft > 0,
  );
  for (const [filter, count] of [
    ["GLP-1", 3],
    ["Single", 7],
    ["Blends", 3],
    ["All", 13],
  ]) {
    await page.locator(`[data-filter="${filter}"]`).click();
    assert.equal(await page.locator(".product-card").count(), count);
  }
  await page.locator('[data-product-select="sema"]').selectOption({ index: 1 });
  assert.equal(
    await page.locator('[data-product="sema"] [data-card-price]').textContent(),
    "$96",
  );
});

test("cart arithmetic, persistence, research acknowledgment, and WhatsApp payload", async (t) => {
  const page = await visit(t);
  await page.locator('[data-filter="GLP-1"]').click();
  await page.locator('[data-product-select="sema"]').selectOption({ index: 1 });
  await page.locator('[data-add="sema"]').click();
  await page.locator("[data-cart-open]").click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$96.00");
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true);
  await page.locator('[data-cart-action="plus"]').click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$192.00");
  await page.locator("#researchConfirm").check();
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true, "Invoice email is required");
  await page.locator("#invoiceEmail").fill("not-an-email");
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true);
  await page.locator("#invoiceEmail").fill("buyer@example.com");
  assert.equal(await page.locator("#cartCheckout").isEnabled(), true);
  await page.evaluate(() => {
    window.open = (url) => {
      window.testCheckout = url;
    };
  });
  await page.locator("#cartCheckout").click();
  const message = await page.evaluate(() =>
    decodeURIComponent(window.testCheckout),
  );
  for (const expected of [
    "https://wa.me/17867803626",
    "Semaglutide",
    "10 mg",
    "192",
    "laboratory research only",
    "Please email my invoice to: buyer@example.com",
  ])
    assert.ok(message.includes(expected));
  assert.equal(await page.locator("#orderConfirmation").isVisible(), true);
  assert.match(
    await page.locator("#orderConfirmation").textContent(),
    /You’ll receive an email shortly at\s+buyer@example\.com\s+with your invoice/,
  );
  assert.equal(await page.locator("#cartCount").textContent(), "0");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#cartDialog").evaluate((dialog) => dialog.open),
    false,
  );
  assert.equal(
    (await page.locator(".filter.active").textContent()).trim(),
    "GLP-1 research",
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#cartCount").textContent(), "0");
  await page.locator('[data-add="sema"]').click();
  await page.locator('[data-add="sema"]').click();
  await page.locator("[data-cart-open]").click();
  assert.equal(await page.locator("#orderConfirmation").isVisible(), false);
  assert.equal(await page.locator("#invoiceEmail").inputValue(), "buyer@example.com");
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true);
  await page.locator('[data-cart-action="minus"]').click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$77.00");
  await page.locator('[data-cart-action="remove"]').click();
  assert.equal(await page.locator("#cartCount").textContent(), "0");
  assert.equal(await page.locator(".cart-empty").isVisible(), true);
});

test("product details and accessible tab and FAQ interactions", async (t) => {
  const page = await visit(t);
  await page
    .locator('.details-button[data-details="bpc"]')
    .scrollIntoViewIfNeeded();
  await page.locator('.details-button[data-details="bpc"]').click();
  assert.equal(
    await page.locator("#productDialogTitle").textContent(),
    "BPC-157",
  );
  await page.locator("#detailVariant").selectOption({ index: 1 });
  assert.equal(await page.locator("#detailPrice").textContent(), "$59");
  const coaURL = await page.locator("#productDetails a").getAttribute("href");
  assert.ok(decodeURIComponent(coaURL).includes("BPC-157"));
  await page.locator("[data-from-details]").click();
  assert.equal(
    await page.locator("#cartDialog").evaluate((dialog) => dialog.open),
    true,
  );
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$59.00");
  await page.keyboard.press("Escape");
  await page.locator("#tab-support").click();
  assert.equal(await page.locator("#panel-support").isVisible(), true);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#panel-quality").isVisible(), true);
  await page.locator(".faq-list summary").first().click();
  assert.equal(
    await page
      .locator(".faq-list details")
      .first()
      .evaluate((details) => details.open),
    true,
  );
});

test("responsive layouts, mobile navigation, and image loading", async (t) => {
  const page = await visit(t);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No page overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menuToggle").click();
  assert.equal(await page.locator("#mobileNav").isVisible(), true);
  await page.locator('#mobileNav a[href="#catalog"]').click();
  assert.equal(await page.locator("#mobileNav").isVisible(), false);
  assert.deepEqual(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter((image) => image.complete && !image.naturalWidth)
          .map((image) => image.src),
      ),
    [],
  );
});

test("malformed saved carts fail safely and missing storage does not block shopping", async (t) => {
  const page = await visit(t);
  for (const value of [
    "{broken",
    "null",
    '{"items":[null,{"variantId":"unknown","qty":2},{"variantId":"sema-5-3ml","qty":-3}]}',
  ]) {
    await page.evaluate(
      (value) => localStorage.setItem("hyl_cart_v2", value),
      value,
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#cartCount").textContent(), "0");
  }
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-add="sema"]').click();
  assert.equal(await page.locator("#cartCount").textContent(), "1");
});

test("automated WCAG A/AA checks for the homepage, details, and cart", async (t) => {
  const page = await visit(t);
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
      [],
    );
  };
  await check();
  await page.locator(".details-button").first().click();
  await check();
  await page.keyboard.press("Escape");
  await page.locator('.product-card [data-add="sema"]').click();
  await page.locator("[data-cart-open]").click();
  await check();
});

test("documentation page requests a COA for every catalog product", async (t) => {
  const page = await visit(t);
  await page.goto(`${baseURL}/documentation.html`);
  assert.equal(await page.locator('#coaProducts a').count(), 13);
  assert.ok(decodeURIComponent(await page.locator('#coaProducts a').first().getAttribute('href')).includes('Semaglutide'));
});

test("new pages fit mobile screens and pass automated accessibility checks", async (t) => {
  const page = await visit(t);
  for (const route of ['standards.html', 'documentation.html']) {
    await page.goto(`${baseURL}/${route}`);
    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} fits mobile`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) })), [], route);
  }
});

const canvasIsStill = (page, selector) => page.evaluate(async (selector) => {
  const canvas = document.querySelector(selector);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const before = canvas.toDataURL();
  for (let i = 0; i < 6; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  return before === canvas.toDataURL();
}, selector);

test("decorative motion can be paused, persists, and respects reduced motion", async (t) => {
  const page = await visit(t);
  const toggle = page.locator('.motion-toggle');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await canvasIsStill(page, '#strandCanvas'), true, 'Pausing motion stops the sequence strand');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.motion-toggle').disabled);
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await canvasIsStill(page, '#strandCanvas'), true, 'Reduced motion keeps the strand still');
  await page.locator('[data-add="sema"]').click();
  await page.locator('[data-cart-open]').click();
  assert.equal(await page.locator('#cartSubtotal').textContent(), '$77.00');
});

test("sequence strand and material study support keyboard and real catalog data", async (t) => {
  const page = await visit(t);
  assert.equal(await page.locator('#strandSeq button').count(), 15);
  assert.equal(await page.locator('#strandSeq').textContent(), 'GEPPPGKPADDAGLV');
  await page.locator('#strandSeq button').nth(6).focus();
  assert.match(await page.locator('#strandFocus').textContent(), /07 \/ 15 · Lys · Lysine/);
  await page.keyboard.press('Tab');
  assert.match(await page.locator('#strandFocus').textContent(), /08 \/ 15 · Pro · Proline/);
  await page.locator('[data-seq="ser"]').click();
  assert.equal(await page.locator('[data-seq="ser"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#strandName').textContent(), 'Sermorelin');
  assert.equal(await page.locator('#strandSeq button').count(), 29);
  await page.locator('#strandDetails').click();
  assert.equal(await page.locator('#productDialogTitle').textContent(), 'Sermorelin');
  await page.keyboard.press('Escape');
  await page.locator('[data-seq="ghk"]').click();
  assert.equal(await page.locator('#strandSeq').textContent(), 'GHKCu');
  const heroAxe = await new AxeBuilder({ page }).include('.editorial-hero').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(heroAxe.violations.map(v => v.id), []);
  await page.locator('[data-study="ghk"]').click();
  assert.equal(await page.locator('#studyName').textContent(), 'GHK-Cu');
  assert.equal(await page.locator('#studyPrice').textContent(), 'From $41 / vial');
  await page.locator('#studyDetails').click();
  assert.equal(await page.locator('#productDialogTitle').textContent(), 'GHK-Cu');
  await page.keyboard.press('Escape');
  await page.locator('#materialCanvas').scrollIntoViewIfNeeded();
  await page.locator('.motion-toggle').click();
  assert.equal(await canvasIsStill(page, '#materialCanvas'), true, 'Pausing motion freezes the procedural artwork');
});

test("phone layout: 16px fields (no iOS zoom), finger-sized controls, floating help stays on screen", async (t) => {
  const page = await visit(t, { width: 390, height: 844 });
  const smallFields = () => page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea")]
      .filter((el) => el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.id || el.className));
  assert.deepEqual(await smallFields(), [], "Catalog fields are at least 16px");
  await page.locator("[data-cart-open]").click();
  assert.deepEqual(await smallFields(), [], "Cart fields are at least 16px");
  await page.keyboard.press("Escape");
  const letter = await page.locator("#strandSeq button").first().boundingBox();
  assert.ok(letter.width >= 30 && letter.height >= 34, "Sequence letters are finger-sized");
  const fab = await page.locator(".support-fab").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { position: getComputedStyle(el).position, left: r.left, right: r.right, bottom: r.bottom };
  });
  assert.equal(fab.position, "fixed");
  assert.ok(fab.left >= 0 && fab.right <= 390 && fab.bottom <= 844, "WhatsApp button floats inside the screen");
  const toggle = await page.locator(".motion-toggle").boundingBox();
  assert.ok(toggle.width >= 44 && toggle.height >= 44, "Motion toggle is a 44px target");
});
