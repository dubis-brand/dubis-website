---
paths:
  - "api/create-gelato-order.js"
  - "api/admin/gelato-sync.js"
  - "api/webhooks/gelato.js"
  - "js/products.js"
  - "designs/**"
---

# Gelato Operations — DUBIS

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
