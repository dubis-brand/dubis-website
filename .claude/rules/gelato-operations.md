---
paths:
  - "api/create-gelato-order.js"
  - "api/admin/gelato-sync.js"
  - "api/webhooks/gelato.js"
  - "js/products.js"
  - "designs/**"
---

# Gelato Operations — DUBIS

## 🚨 Stock & fulfillment APIs — what to use when (2026-05-20 hard-learned)

Gelato has 5 endpoints that look like stock checks. **Only `/v4/orders:quote` is authoritative for "will this specific order ship?".** Mixing them up caused 5 stuck PayPal captures totalling $361 on 2026-05-20. Full incident in `memory/troubleshooting.md` § "The Hila Checkout Catastrophe".

| Endpoint | Truth it tells | Use it for |
|---|---|---|
| `GET /v3/products/{uid}` | UID exists in catalog (200) or retired (404) | Discovering discontinued SKUs only. **NEVER use as a stock check.** Pre-2026-05-20 `gelato-stock-check` cron used this — completely missed the cap (product 7) being discontinued and the women's 3XL not existing. |
| `GET /v3/products/{uid}/availabilities` | (does not exist — 404) | Don't try. |
| `POST /v3/stock/region-availability` | Per-region status: `in-stock` / `out-of-stock` / `unavailable` / `not-supported` | Daily catalog sweep — find globally-unfulfillable variants efficiently. **NOT authoritative for per-order routing decisions** — IL routing doesn't always match the regions this returns. |
| `POST /v4/orders:quote` | Whether THIS specific (cart, address) will fulfill RIGHT NOW | **Authoritative pre-flight.** Use in `/api/create-gelato-order?action=stock-probe` before PayPal capture. |
| `POST /v4/orders` + `GET /v4/orders/{id}` poll | Real order creation + async stock validator outcome | The actual order. Poll for up to 4 sec after POST to catch async cancellations (race window). |

**Anti-patterns refuse on sight:**
- Calling `/v3/products/{uid}` and treating 200 as "in stock". It only means the SKU exists in catalog.
- Trusting `region-availability`'s `in-stock` for routing-sensitive decisions on IL orders.
- Treating Gelato POST 200 immediate body as final — financialStatus='open' can flip to canceled in 1-3 sec.

## Design File Specifications
| Area | Min Size | DPI | Format | Background |
|------|----------|-----|--------|------------|
| Front | 3,600×4,200px | 300 | PNG | Transparent |
| Back | 3,000×3,600px | 300 | PNG | Transparent |
| Cap | 1,800×900px | 300 | PNG | Transparent |

**Iron Rule:** File under 200KB = problem. Gelato silently rejects.

## COLOR_MAP (in create-gelato-order.js)
Maps color names from products.js → Gelato color codes.
DARK_COLORS = Black, Navy, Charcoal, Forest Green → use `_white.png` designs

## Validation (Automatic)
`create-gelato-order.js` sends HEAD request to every design file before order:
- Checks HTTP 200 + Content-Length ≥ 200KB
- If fails → blocks order, returns explicit error
- Logs appear in Vercel Runtime Logs

## Key Files
- `designs/front_logo_white.png` / `front_logo_dark.png` — shared front logo
- `designs/back_design_{id}_{variant}.png` — unique back per product
- `designs/cap_design_{variant}.png` — cap designs
- Design files served at: `https://www.dubis.net/designs/`

## Order Reference Format
`DUBIS-{PaypalOrderId}` — used to find orders in Gelato Dashboard

## Catalog mockup refresh workflow (after any change to `designs/`)
Whenever the print files change (back text, front logo, anything in
`designs/`), the catalog images on dubis.net (`images/product-*.jpg`)
silently fall out of sync with the actual printed product. Run this:

1. `node scripts/generate-designs.js` — regenerate the print PNGs.
2. `git add designs/ && git commit && git push` — Vercel deploys to
   `https://www.dubis.net/designs/...`
3. Edit `scripts/download-gelato-mockups.js` and bump `DESIGN_VERSION`
   (e.g. `2026051601` → `2026051602`). Acts as the cache-buster Gelato
   uses to re-fetch instead of serving its cached copy.
4. `node scripts/download-gelato-mockups.js` — creates draft orders for
   every active (product, color), waits for Gelato to render, saves
   preview PNGs to `images/gelato-mockups/`. ~25-30 min for 68 combos.
5. Convert PNG → JPG with the canonical gray flatten + mozjpeg:
   ```js
   sharp(src)
     .flatten({ background: { r: 215, g: 215, b: 215 } })   // #D7D7D7
     .jpeg({ quality: 90, mozjpeg: true })
     .toFile(`images/product-${id}-${Color}-${face}.jpg`);
   ```
6. `git add images/ && git commit && git push` — site picks up the new
   mockups automatically.

The Gelato draft-order endpoint returns four preview types per item; the
ones to download are `preview_default` (front view) and `preview_back`
(back view). Never `preview_thumbnail` — that's an 18 KB stub, not a
usable image. `preview_back` is rendered ~30-60 s after `preview_default`,
so the script retries the order fetch a few times before giving up.

This is the **single source of truth** for product imagery: ads, social
posts, video reels, and admin UI all consume the same `images/product-*.jpg`
set. Skip the refresh and the catalog drifts from what Gelato actually
prints — exactly what happened (and was fixed) on 2026-05-16.
