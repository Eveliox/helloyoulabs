# Hello You Labs

A static, responsive storefront. No framework, build step, or production Node server is required.

## Preview

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. The preview server uses only Node's built-in modules; installing dependencies is unnecessary for previewing. Set `PORT` to use another port.

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

The storefront does **not** process payments. It sends selected products, vial options, quantities, and subtotal to the existing WhatsApp number (`17867803626`). Availability, shipping, payment, and current-lot documentation are confirmed with the team. The cart is stored locally under the existing `hyl_cart_v2` key. Research-use acknowledgment is required before the WhatsApp handoff.

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

Deploy the static site files, including `assets/`, to the existing static host. No build command is needed. Keep the existing root image/video assets and secondary pages while those pages reference them. Do not deploy `node_modules/`, tests, or development scripts. These changes have not been deployed to the live domain.
