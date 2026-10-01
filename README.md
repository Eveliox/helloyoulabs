# Hello You Labs

A static, responsive storefront. No framework, build step, or production Node server is required.

## Account interface and visual direction

The storefront now uses a warm ivory, charcoal and muted-bronze visual direction, with an editorial homepage and restrained animated details. Hello You branding, catalog pricing, retail WhatsApp handoff and existing wholesale submissions are retained.

- `assets/portal.css` — shared storefront theme and responsive account layouts.
- `assets/warm.css` — current warm palette, serif homepage and full-height product detail image.
- `assets/signature.css`, `assets/signature.js` — interactive 2× product-detail lens and procedural canvas artwork. The material study switches among three real catalog products; its curves are abstract artwork, not molecular structures. Canvas rendering is capped near 30 fps, pauses offscreen/in hidden tabs, and follows the shared motion preference. The lens supports mouse movement, a keyboard/touch range control, and Escape.
- `assets/hero.css`, `assets/sequence.js` — homepage hero: a dark stage (the header turns dark to match) with an interactive sequence strand. Each bead is one amino acid of a real catalog peptide (BPC-157 `GEPPPGKPADDAGLV`, Sermorelin GHRH 1–29, GHK with its copper ion), coloured by side-chain class; the strand grows residue by residue when a peptide is chosen. The sequence readout beside it is keyboard-accessible text naming each residue. It is labelled a stylised strand, not a structural model. Motion follows the site toggle and reduced-motion setting.
- `assets/modern.css`, `assets/motion.js` — product compositions, animated login artwork, scroll reveals, pointer depth, hover transitions and reading progress. A persistent motion toggle pauses decorative animation; device reduced-motion preferences take priority. CSS scenes pause offscreen and when the tab is hidden. No animation library is required.
- `assets/secondary.css` — dark companion theme for existing wholesale/application/guide pages.
- `login.html`, `assets/login.css`, `assets/silk.js` — the sign-in gate: email-first sign-in/sign-up beside a generative “silk study” canvas (iridescent ribbon, glass orb, film grain; follows the pointer, renders one still frame for reduced motion, pauses when hidden).
- `account.html` — signed-in dashboard: saved cart summary, profile (name, organization), support and wholesale links.
- `standards.html` — research and documentation information.
- `documentation.html` — product-specific COA requests via WhatsApp.
- `assets/account.js` — sign-in/sign-up forms, account dashboard and catalog-based COA links; talks to the accounts API.
- `worker/index.js` — the accounts API (Cloudflare Worker + D1).

## Customer accounts

**The whole site requires sign-in.** The Worker runs before static assets on every request: pages (and `assets/catalog.js`, which carries pricing) redirect to `/login?next=…` without a session, and signed-in pages are sent `Cache-Control: private, no-store`. Public: `/login`, `/wholesale-apply`, `/api/*`, and static media (styles, scripts, images). After signing in, visitors return to the page they asked for (same-site paths only).

Sign-in is email-first: the email is checked with `/api/lookup`, then the page asks for a password (existing account) or a first name and new password (new account).

- **Storage:** a D1 database bound as `DB` (`helloyoulabs-accounts`). `wrangler deploy` creates it on the first deploy (no `database_id` in `wrangler.jsonc`), and the Worker creates its tables on first request.
- **Passwords:** PBKDF2-SHA256, 100,000 iterations, per-user salt. Plain passwords are never stored or logged.
- **Sessions:** random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS), valid 30 days; only its SHA-256 hash is stored. Logout deletes the session.
- **Abuse limits:** 10 failed sign-ins per email or 30 per network in 15 minutes locks sign-in for that window; 10 new accounts per network per 15 minutes. Cross-origin writes are refused.
- **Endpoints:** `POST /api/lookup` (`{ exists }`; 40 per network per 15 minutes), `POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me` (`{ user: null }` when signed out), `PUT /api/me` (name, organization).

## Admin (mini CRM)

`/admin` is the CRM for **helloyouwellnessclinic@gmail.com** (`ADMIN_EMAIL` in `wrangler.jsonc`): an overview (customers, weekly activity, orders awaiting invoice, invoiced-unpaid and paid totals), a searchable customer list with CSV export, a customer drawer (edit name/organization, private notes, order history, create a temporary password, delete), and the order pipeline (New → Invoice sent → Paid → Shipped / Cancelled).

- **Becoming admin:** sign up or sign in with the admin email, open `/admin`, and enter the setup code once. Sign-up does not verify email ownership, so the email alone grants nothing; only the code's SHA-256 (`ADMIN_CLAIM_SHA256`) is in the repo. To rotate the code, put a new code's SHA-256 there (`printf %s 'NEW-CODE' | shasum -a 256`).
- **Orders:** checkout creates a reference (e.g. `HY-7K3Q9P`), puts it in the WhatsApp message, and records the order via `POST /api/orders`; the Worker re-prices every line from `assets/catalog.js`, so tampered prices are ignored. Customers see their orders and status on `/account`.
- **Temporary passwords** replace the old "delete the account" workaround for locked-out customers.
- **Endpoints:** `GET/POST /api/orders`; `/api/admin/status`, `/claim`, `/summary`, `/customers[/:id[/password]]`, `/orders[/:id]` — all admin routes except `status`/`claim` require the claimed admin role.

Not built yet: password reset by email (needs an email provider — for now the page links to WhatsApp), order history, and invoices. To help someone who is locked out, create a temporary password from `/admin`. Or, from the command line, delete their account so they can sign up again:

```sh
npx wrangler d1 execute helloyoulabs-accounts --remote --command "DELETE FROM users WHERE email = 'customer@example.com'"
```

The cart is still stored in the browser (`hyl_cart_v2`), and checkout still hands off to WhatsApp. The older wholesale password gate is client-side and separate from customer accounts; it does not provide server-side access control.

## Preview

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. The preview server uses only Node's built-in modules; installing dependencies is unnecessary for previewing. Set `PORT` to use another port.

`npm run dev` serves static files only, so sign-in won't work there. To try accounts locally, run `npm run preview` (wrangler dev with a local D1 database) and open the URL it prints.

## Files

- `index.html` — redesigned homepage, research notices, ordering information, and dialogs.
- `assets/site.css` — responsive teal/ice-blue design system.
- `assets/site.js` — product filters, carousel, variant selection, product details, saved cart, WhatsApp handoff, mobile navigation, tabs, and video controls.
- `assets/catalog.js` — original 13-product catalog, prices, and vial options. Edit this file to maintain inventory information.
- `assets/images/` — logo derivatives and the brand-film poster.
- `assets/images/studio/` — approved homepage imagery (hero, brand story, product selection, quality macro, label detail) and the 13 catalog images. Regenerate with `python scripts/build_imagery.py` (needs Pillow, NumPy, OpenCV). `provenance.json` records how each image was made.
- `design-review/imagery-v1/` — the approval board (contact sheet, concepts, production brief) that these images were promoted from.
- `wholesale-apply.html`, `wholesale.html`, `guide.html` — existing secondary pages; their contents and integrations were preserved.

## Ordering and content

The storefront does **not** process payments. It sends selected products, vial options, quantities, and subtotal to the existing WhatsApp number (`17867803626`). Availability, shipping, payment, and current-lot documentation are confirmed with the team. The cart is stored locally under the existing `hyl_cart_v2` key. Research-use acknowledgment and an invoice email are required before the WhatsApp handoff. The email is included in the WhatsApp message (and pre-filled for signed-in customers); after the handoff the cart is cleared and the customer is told they'll receive an email shortly with their invoice. **The team sends that invoice email manually** — the site does not send email.

COA links request documentation; they do not display fabricated certificates. No prescription, medical-care, pharmacy, or treatment services were added. Product imagery is illustrative and may not show the selected vial option.

Before publishing, verify current catalog pricing, vial options, WhatsApp ownership, and business policies. The existing secondary pages should receive their own content/compliance review. No live orders or wholesale applications were submitted during testing.

## Images

All homepage imagery is now derived from the supplied Hello You vial artwork (`img/vials/*.png`, unchanged). No stock photography or generative-model images are used.

- Hero (desktop and a separately composed mobile crop), brand story, product selection, and quality macro: composites of the original vial artwork — background masked, rotated upright, placed over teal/ice gradients and simple illustrated surfaces with simulated contact shadows. Product lettering is never regenerated. These are composites, not photographs of a facility.
- Catalog: each of the 13 products at the same scale, angle, and pale blue-gray background; 800px and 400px WebP variants.
- Label detail ("Know your lot" step): a crop of the supplied BPC-157 artwork. No lot numbers or certificates are shown.
- Logo: teal and light versions derived from the existing Hello You logo.
- Brand film/poster: the existing Hello You MP4 and a frame extracted from it. Playback is user-initiated.
- Shipping: the original inline SVG illustration is retained. It should be replaced with photographs of the actual packaging (closed carton, open insert, packed order with personal details removed) — see `design-review/imagery-v1/production-brief.md`.
- Conversation graphic: illustrative HTML/CSS, not a customer testimonial.
- Known limitation: the source artwork's glass keeps reflections from its original dark setting. A real product shoot would give the most realistic hero and macro images.
- Fonts: DM Sans and Libre Caslon Text via Google Fonts, with local fallback stacks.

## Tests

```sh
npm ci
npx playwright install chromium
npm test
```

Alternatively, set `CHROME_PATH` to an installed Chrome executable. Tests start an isolated local server, use fresh browser contexts, and never submit live orders. The WhatsApp window is intercepted in the checkout test.

Coverage includes catalog filters, pricing, cart arithmetic and persistence, malformed/blocked storage, product dialogs, keyboard-operated tabs, FAQs, mobile menus, layouts from 320–1440px, and automated axe WCAG A/AA checks. Automated checks supplement, rather than replace, a full accessibility audit.

## Deployment

The site is served by a Cloudflare Worker using static assets — no build step. Configuration lives in `wrangler.jsonc`; the repo root is the assets directory, and `.assetsignore` keeps `node_modules/`, tests, scripts and other dev files out of the upload.

- **Cloudflare Workers Builds** (on push to `main`): build command *none*, deploy command `npx wrangler deploy`.
- **Manual deploy**: `npm run deploy` (requires `wrangler login` once).
- **Local preview**: `npm run preview`.

Keep the existing root image/video assets and secondary pages while those pages reference them.
