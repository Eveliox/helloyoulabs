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
    if (response.url().startsWith(baseURL) && response.status() >= 400)
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
    "$189",
  );
});

test("cart arithmetic, persistence, research acknowledgment, and WhatsApp payload", async (t) => {
  const page = await visit(t);
  await page.locator('[data-filter="GLP-1"]').click();
  await page.locator('[data-product-select="sema"]').selectOption({ index: 1 });
  await page.locator('[data-add="sema"]').click();
  await page.locator("[data-cart-open]").click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$189.00");
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true);
  await page.locator('[data-cart-action="plus"]').click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$378.00");
  await page.locator("#researchConfirm").check();
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
    "378",
    "laboratory research only",
  ])
    assert.ok(message.includes(expected));
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
  assert.equal(await page.locator("#cartCount").textContent(), "2");
  await page.locator("[data-cart-open]").click();
  assert.equal(await page.locator("#cartCheckout").isDisabled(), true);
  await page.locator('[data-cart-action="minus"]').click();
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$189.00");
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
  assert.equal(await page.locator("#detailPrice").textContent(), "$115");
  const coaURL = await page.locator("#productDetails a").getAttribute("href");
  assert.ok(decodeURIComponent(coaURL).includes("BPC-157"));
  await page.locator("[data-from-details]").click();
  assert.equal(
    await page.locator("#cartDialog").evaluate((dialog) => dialog.open),
    true,
  );
  assert.equal(await page.locator("#cartSubtotal").textContent(), "$115.00");
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
