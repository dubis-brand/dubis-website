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
| `POST /v4/orders:quote` | Whether THIS specific (cart, address) will fulfill RIGHT NOW | **Pre-flight only.** Use in `/api/create-gelato-order?action=stock-probe` before PayPal capture. **NOT a contract** — see "Quote ≠ POST" below for the 2026-05-22 product 31 lesson. |
| `POST /v4/orders` + `GET /v4/orders/{id}` poll | Real order creation + async stock validator outcome | The actual order. Poll for up to **90 sec** after POST to catch async cancellations (extended from 4s to 90s on 2026-05-20 task #24). |

**Anti-patterns refuse on sight:**
- Calling `/v3/products/{uid}` and treating 200 as "in stock". It only means the SKU exists in catalog.
- Trusting `region-availability`'s `in-stock` for routing-sensitive decisions on IL orders.
- Treating Gelato POST 200 immediate body as final — financialStatus='open' can flip to canceled in 1-3 sec.
- Treating `/v4/orders:quote` `ok` as a contract. It's a hint. The real fulfillment graph used by POST is a different code path.

## 🚨 Quote ≠ POST — when Gelato lies in pre-flight, swap the routing (2026-05-22)

**The product 31 case study (Bella+Canvas 6004 women's t-shirt for IL).**

- `region-availability` said `in-stock` in EU+AS+ROW (Israel-relevant).
- `/v4/orders:quote` returned `ok` with shipment quotes for IL.
- Real `/v4/orders` POST refused with `"Delivery for submitted combination of products isn't possible to chosen destination"`.

Money already captured by PayPal. 3 separate stuck captures on this exact variant before we identified the pattern.

**Fix.** Re-route the slogan through a different template. For product 31 we did `UPDATE dubis_products SET gender='unisex'` — same slogan, now routed through Gildan 64000 (`tshirt-unisex`, brand `gildan`) instead of Bella+Canvas 6004 (`tshirt-women`, brand `bella-and-canvas`). Gildan ships from CZ which has the IL routing graph fully wired. Re-probed → clean `quote_ok`, single warehouse. Hila's 2026-05-22 14:29 UTC purchase shipped successfully.

**When this pattern surfaces again (any product / any country):**
1. Detect: customer reports "paid, no order"; Gelato dashboard has no order; logs show `not_possible_to_chosen_destination`.
2. Identify the offending `productUid` from logs. Split by `_brand_` suffix — that's the template.
3. Find an alternative template covering the same garment for the destination (run `scripts/probe-product-country-availability.js --product N`).
4. Swap in DB (`UPDATE dubis_products SET gender='unisex'` or `clothing_type` swap).
5. Re-run `scripts/sync-products-to-js.js` + commit + push.
6. If no alternative exists → exclude the country from `supportedCountries[]`. Product stays sellable elsewhere; the affected-country customers won't see it.

**Rule:** `memory/checkout-guardrails.md` §12 — full procedure + anti-patterns. Runbook §"Diagnose split-vs-single-warehouse routing for a cart".

## 🚚 Multi-warehouse splitting — Gelato silently splits across factories (2026-05-22)

A single Gelato `POST /v4/orders` can fulfill multiple items only if they all ship from the same warehouse. When a cart mixes items whose templates route to different factories (e.g. women's Bella+Canvas 6004 → CZ, unisex Gildan 64000 → IL), the system splits into **N parallel POSTs**, each with its own DHL shipment + shipping cost (~$36 each).

**Cost reality.** A 3-item cart that splits into 2 sub-orders pays 2× shipping. Hila II round 10: $82+$36 = $118 in Gelato cost vs $94 revenue → $24 net loss. The fix is NOT to refuse splits (oren reversed that over-correction), it's to make splits rare by fixing product routing at the source.

**The splitter contract.**
- `handleStockProbe` returns `mode: 'quote_ok' | 'quote_split_required' | 'quote_partial_oos' | 'all_blocked_pre_gelato'`.
- `quote_split_required` is GREEN-LIT for checkout (split is the fulfillment plan, not a problem). Cart UI shows neutral "ships in N packages" notice.
- `quote_partial_oos` HARD-BLOCKS checkout (`btn.disabled=true`, no PayPal popup).
- After successful PayPal capture, split carts route to `dispatchMultiOrderSplit` (`api/_orderSplit.js`) which fires N parallel Gelato POSTs, writes N sibling `orders` rows linked by `split_group_id` UUID.
- If any sub-order fails: attempt `cancelGelatoOrder` on siblings + refund proportional capture amount. Customer gets partial fulfillment + proportional refund if siblings are too far into production to cancel.

**Weekly discovery loop (Supply agent owns):** query `orders WHERE split_group_id IS NOT NULL AND created_at > now()-7d`, identify the item forcing each split, swap routing per the "Quote ≠ POST" procedure above.

**Rule:** `memory/checkout-guardrails.md` §8 + `memory/decisions.md` "Hybrid multi-warehouse splitter".

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

## Cross-garment design parity — front logo is shared, back uses one generator
**Verified 2026-06-02 (Phase K zip-hoodie migration).** The DUBIS™ front logo and the
back slogan render IDENTICALLY across every garment type (t-shirt, zip-hoodie, long-sleeve,
hoodie) — this is true *by construction*, not by per-product effort:
- **Front logo = ONE shared pair of files** (`front_logo_white.png` / `front_logo_dark.png`).
  Every product's front consumes the same file via `getDesignFiles()`. So a zip-hoodie's
  `DUBIS™` is byte-identical to a t-shirt's. The TM fix (composite `TM` in basic Impact glyphs,
  `generate-designs.js` ~L398-409, since Impact lacks U+2122) lives here once → all garments inherit it.
- **Back = ONE `generateBack()` function**, vertically centered (`topY=(BACK_H-totalH)/2`,
  no per-garment-type `BACK_Y_START` since the 2026-05-16 rewrite). Same Impact font, same
  small-top-line / big-punchword layout convention, same centering → zip-hoodie back === t-shirt back.
  The back carries NO ™ (only the front logo does).
- **Implication for parity checks:** if a t-shirt and a zip-hoodie of the same slogan ever LOOK
  different in the catalog mockups, it is a *mockup-freshness* problem, never a design-logic one.
  The `images/product-*.jpg` for the older garment is simply stale relative to the last
  `designs/` regen — fix via the "Catalog mockup refresh workflow" below, do NOT hand-edit one type.
- **2026-06-02 state:** zip-hoodies #3/#25 mockups are fresh (show the corrected crisp ™);
  t-shirt + pullover-hoodie mockups predate the TM fix (May 16 batch) and still show the old
  rough ™ / dark-on-black low-contrast front — a full non-zip refresh is the open follow-up.

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
