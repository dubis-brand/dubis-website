---
name: add-product
description: Add a new product to DUBIS catalog through the two-stage GHA pipeline (slogan approval → Gelato real-mockup pipeline → visual approval → auto-sync). Replaces the legacy B+ composite-mockup procedure that was retired 2026-05-16 because Gemini blanks never matched what Gelato actually prints. Last updated 2026-05-19 after the visual-approve auto-sync wiring landed.
---

# Add New Product — End-to-End (Two-Stage GHA Pipeline)

CRITICAL: This is the ONLY supported flow as of 2026-05-19. The legacy `generate-blanks` + `composite-mockups` + `verify-parity` scripts are deprecated — they produced node-canvas mockups that diverged from real Gelato prints (caught on the Hila test order). All catalog mockups now come from real Gelato draft-order preview images downloaded by the pipeline.

Read `memory/checkout-guardrails.md` §1 (site mockup MUST equal what Gelato prints — non-negotiable) before starting.

## 2026-06-06 — two things that changed
- **Brand font is Anton (not Impact).** `scripts/generate-designs.js` loads `scripts/fonts/Anton-Regular.ttf` (bundled, OFL) via `registerFont(..., {family:'Anton'})` — cross-platform so the GHA Ubuntu runner renders the same condensed-bold type as locally. Impact was Windows-only and silently fell back to a wrong sans in GHA (see `troubleshooting.md` §"Wrong font on GHA-built products"). NEVER reintroduce the `C:\Windows\Fonts\impact.ttf` path; never bundle Impact (proprietary, repo is public).
- **Autonomous weekly products exist.** `?type=weekly-slogan-product` (Vercel cron Tue 09:00 UTC) creates ONE product/week with `dubis_products.auto_publish=true`. For those, `gha-pipeline-callback` skips the human visual gate — it sets `active=true` directly (proof is complete), dispatches the products.js sync, emails oren a "went live" notice with a 1-click `?type=auto-product-remove` link, and `gelato-stock-check` finalizes `selling_price=CEIL(MIN gelato_cost)` (one-shot via `price_finalized`). Manual products (admin "Add product") still go through the magic-link `product-visual-approve` gate as before — `auto_publish` defaults false. To regen an EXISTING active product's mockups to a new font without taking it offline: set `auto_publish=true` + `price_finalized=true`, then dispatch `boss-approved-product` — the callback re-activates it.

## Architecture overview — what runs where

```
Slogan in slogan_candidates / agent_tasks (pending_approval)
    │
    │  oren clicks ✅ Approve in admin "🎨 הצעות לאישור"
    ▼
?type=approve-product (agents/index.ts)
    • Allocates next product_id_numeric (max+1)
    • Updates dubis_products: active=false, publishing_status='pending_pipeline'
    • INSERTs product_pipeline_queue: status='pending_dispatch'
    • POSTs https://api.github.com/repos/dubis-brand/dubis-website/dispatches
      event_type='boss-approved-product', client_payload={product_id, product_id_numeric, queue_id}
    │
    ▼
.github/workflows/dubis-product-pipeline.yml  (~10 min)
    1. generate-designs.js --product-numeric=N           → designs/back_design_N_{white,dark}.png
    2. Commit + push designs/                            → Vercel deploys → Gelato can fetch
    3. Sleep 60s                                         (wait for Vercel)
    4. create-gelato-drafts.js --product=N
         --save-as-site-images --json                    → images/product-N-{Color}-{front,back}.jpg
                                                          (real Gelato preview JPGs, gray bg, mozjpeg q90)
    5. sync-products-to-js.js --write                    → js/products.js (STILL filters out N — active=false)
    6. Commit + push images/ + js/products.js
    7. POST ?type=gha-pipeline-callback
         status='live', gelato_draft_id, gelato_preview_urls
    │
    ▼
?type=gha-pipeline-callback (agents/index.ts)
    • Updates dubis_products: pending_visual_approval=true, visual_approval_token=<rand>
    • Writes proof_of_completion {gelato_draft_id, workflow_run_id, gelato_preview_urls}
    • Sends oren "🛠 מוצר חדש לאישור ויזואלי" email with embedded mockup previews
      + magic-link approve URL: dubis.net/dub-console#visual-approve={uuid}:{token}
    │
    │  oren reviews real Gelato mockups in email or admin
    │  Clicks ✅ Approve (admin UI button OR email magic link)
    ▼
?type=product-visual-approve (agents/index.ts)
    • Updates dubis_products: active=true, publishing_status='live', launched_at=now()
    • Burns visual_approval_token
    • Updates product_pipeline_queue: status='live'
    • POSTs GitHub /dispatches event_type='oren-approved-visual'  → dubis-sync-products.yml
    • UPSERTs product_prices with dubis_products.price_usd as baseline (so admin renders
      immediately; daily cron + manual sync refine to CEIL(MIN(gelato_cost_usd)))
    • Fires dubis-cron-dispatcher?job=gelato-stock (fire-and-forget, upstream ~55s) →
      seeds product_variant_stock with in_stock + gelato_cost_us_usd + gelato_cost_usd
    • Sends "✅ מוצר #N עלה לאוויר" confirmation email
    │
    ├──→ .github/workflows/dubis-sync-products.yml (~30s)
    │      1. sync-products-to-js.js --write          → js/products.js NOW includes N
    │      2. Commit + push                            → Vercel deploys → product live
    │
    └──→ gelato-stock-check Edge Function (~55s, parallel)
           • Iterates (product × color × size) → Gelato API → upsert product_variant_stock
           • Sets in_stock + gelato_cost_us_usd + gelato_cost_usd + gelato_ship_*
           • Admin Product Catalog card refreshes to show Margin US/IL
```

After both branches complete (~90s), the admin shows the new product fully populated:
stock badges (לא במלאי / במלאי), Margin US, Margin IL, per-variant pricing modal. No
manual "הרץ sync" click needed. The selling_price stays at the baseline; refine to
the rule-#7 CEIL(MIN(gelato_cost_usd)) via the runbook entry "Re-base prices after
Gelato cost change" or wait for the next daily 5 UTC cron.

## When to use this skill

- A slogan candidate is approved by oren and you want to add it as a real product.
- You want to add a product manually (without going through Boss slogan review) — see "Manual entry" below.
- Something in the pipeline broke and you need to recover.

## Manual entry — bypass slogan_candidates

Use when oren hands you a slogan + type directly (skip Boss queue). You'll insert into `dubis_products` and then trigger the pipeline.

### Step 1 — Add product row to DB

```sql
INSERT INTO dubis_products
  (product_id_numeric, slogan, clothing_type, gender, colors, price_usd,
   typography_layout, typography_small, typography_big, typography_after,
   active, publishing_status, source,
   description_en, description_he)
VALUES
  (<next_id>, 'Your new slogan', 'tshirt', 'unisex',
   '["Black","White","Navy","Cream"]'::jsonb, 28.0,
   'top-bottom', 'lead-in text', 'PUNCHWORD', 'tail text',
   false, 'pending_pipeline', 'manual',
   'English copy in DUBIS voice', 'תיאור בעברית בקול המותג')
RETURNING id, product_id_numeric;
```

- DB column is `slogan`, NOT `phrase` (legacy ambiguity confirmed 2026-04-24).
- `colors` must each exist in `dubis-website/scripts/download-gelato-mockups.js` COLOR_MAP for the (type, gender) combo — `Honey Brown` famously does not exist in Gelato's catalog despite being marketable (2026-04-22 Hila bug).
- **NEW 2026-05-20 — verify EVERY (color, size) UID via Gelato `POST /v3/stock/region-availability` BEFORE activating.** A SKU that exists in catalog (`GET /v3/products/{uid}` returns 200) is NOT necessarily fulfillable — Gelato can silently discontinue stock for a SKU while leaving it in catalog. This bit us hard on 2026-05-20: product 7 (AS Colour 1114 cap) had been discontinued; 5 PayPal captures stuck. For ANY combo where every relevant region (EU/AS/UK/ROW/US-CA) returns `unavailable` → that combo is dead; don't include in the `colors` array. For combos that are `in-stock` in some but not all regions → keep in DB but flag manually if questionable. See `memory/troubleshooting.md` § "The Hila Checkout Catastrophe" for full incident + Gelato API truth table.
- Set `active=false, publishing_status='pending_pipeline'` so `trg_enforce_product_activation_proof` allows the row through.
- `next_id` = `SELECT MAX(product_id_numeric)+1 FROM dubis_products`.

**Available `clothing_type` values + their Gelato cost & color matrix (verified 2026-05-19):**

| clothing_type | Gender | Cost IL (M) | Cost US (M) | Base $ | Available colors | Notes |
|---|---|---|---|---|---|---|
| `t-shirt` | unisex | $20.20 | $15.39 | $21 | Black/White/Cream/Navy/Charcoal/Red/Gray/Forest Green | Gildan 64000 (Forest→Next Level 3600) |
| `t-shirt` | women  | $19.92 | varies | $21 | Black/White/Cream/Navy | Bella+Canvas 6004 |
| `hoodie` | unisex  | $35.47 | $27.89 | $36 | Black/White/Cream/Navy/Charcoal/Forest Green/Gray | Gildan 18500 |
| `hoodie` | women   | varies | varies | $36 | Black/White/Navy/Charcoal | ⚠️ Brand-less alias — Gelato silently fulfills via **Just Hoods AWDis JH001F** (UK-shrunken sizing — XL fits like S). **DO NOT USE.** See K-postmortem 2026-05-23. |
| `zip-hoodie` | unisex | **$52.66–54.90** | **~$45** | **$55** | **Black/White/Navy/Gray/Royal Blue** | ✅ **SOL'S 04237** (explicit brand, qa=organic, gpr=4-4) — adopted 2026-06-02. NOTE: Lane Seven LS14003 (tried 2026-05-23) was a Gelato **staging** product — State/ProductStatus undefined, no mockups, absent from search → unusable. SOL'S 04237 is published. |
| `long-sleeve` | unisex | $27.40 | $19.89 | $28 | Black/White/Cream/Navy/Forest Green/Gray | Gildan 2400, cost via brand-less fallback |
| `long-sleeve` | women  | varies | varies | $28 | Black/White/Navy | SOLS 02075 |
| `cap` | unisex | varies | varies | $16 | Black/White/Cream/Navy | AS Colour 1114 DTF |
| `cap-emb` | unisex | varies | varies | $32 | Black/White/Navy/Cream/Charcoal | Flexfit 6245cm embroidered (premium) |
| **`v-neck` (new 2026-05-19)** | unisex | **$29.44** | **$20.85** | **$30** | **Black/White/Navy/Red** | Premium-tier brand-less alias |
| **`v-neck` (new 2026-05-19)** | women  | **$25.03** | **$17.49** | **$26** | **Black/White/Navy** | Premium-tier brand-less alias |
| **`tank-top` (new 2026-05-19)** | unisex | **$27.11** | **$19.07** | **$28** | **Black/White/Navy/Red** | Premium-tier brand-less alias |
| **`tank-top` (new 2026-05-19)** | women  | **$31.11** | **$21.32** | **$32** | **Black only** | Premium-tier brand-less alias |

For all sizes 2XL adds ~$3-4, 3XL adds ~$6-10 to base cost — passed through via per-variant `sell_price_usd` overrides.

## 🚨 Brand-less aliases — the silent fulfillment risk (post 2026-05-23 Hila K catastrophe)

When a TEMPLATES row in `api/create-gelato-order.js` has `brand:null, sku:null` (a "brand-less alias"), Gelato fulfills with **whatever vendor it picks** under that category/cut/quality combo. The choice can change without notice and there is no warning to us OR the customer.

**Real damage 2026-05-23:** Hila ordered `hoodie:women` (brand-less). Gelato shipped **Just Hoods AWDis JH001F** — a UK-sourced shrunken-sizing brand where the XL tag fits like a US S. The garment was unwearable. Combined with a broken DUBIS™ TM glyph on every print (Impact font lacks the ™ codepoint, font substitution rendered garbage), the order was a **double catastrophe**.

**Hard rules from this incident:**

1. **Every TEMPLATES row MUST have explicit `brand` + `sku`** before being offered as a product type. No `brand:null` allowed for ANY new product going forward. If you're forced to use a brand-less alias temporarily, mark the row `clothing_type` with suffix `-brandless` and DO NOT activate the product.
2. **Forbidden brands (UK-shrunken sizing — silently fulfilled by Gelato when brand-less):**
   - ❌ Just Hoods AWDis JH001F (hoodie pullover) — what shipped to Hila
   - ❌ Just Hoods AWDis JH050 (zip-hoodie) — same vendor, same sizing
3. **Verified premium replacements:**
   - ✅ `hoodie:unisex` → **Gildan 18500** (already in TEMPLATES, no change needed)
   - ✅ `zip-hoodie:unisex` → **SOL'S 04237** (qa=organic, gpr=4-4) — adopted 2026-06-02, 5 colors (Black/White/Navy/Gray/Royal Blue), $52.66–54.90 IL. (Lane Seven LS14003, tried 2026-05-23, turned out to be a Gelato **staging** product with no mockups and absent from search — abandoned.)
   - ❓ `hoodie:women` → not yet remapped. **DO NOT activate `hoodie:women` products until a non-Just-Hoods replacement is verified.** Workaround: route women's pullover-hoodie slogans to `zip-hoodie:unisex` (SOL'S 04237) OR `hoodie:unisex` (Gildan 18500).
4. **Migration anti-pattern that worked here:** When `clothing_type='hoodie'` products needed to escape Just Hoods, products #3 and #25 were **reclassified to `zip-hoodie`** (Option A from the K plan, per oren "החלף את הכל"). Their existing DUBIS™ front + slogan back artwork was reused; mockups regenerated against SOL'S 04237 blanks via the B+ composite pipeline.

**4 products retired by K-B (do not reactivate):** #9 (zip-hoodie unisex), #13 (hoodie women), #17 (zip-hoodie unisex), #24 (hoodie women). Their `publishing_status='visual_rejected'` + `proof_of_completion.retired_reason='Just Hoods JH001F sizing — see Hila order 2026-05-23'`.

**The TM glyph rule (paired lesson):** Never assume Impact font (or any Latin display font) covers full Unicode. The ™ codepoint U+2122 is NOT in standard Impact — Canvas renders garbage via fallback. **Always render ™ as composite `"TM"` (two basic Latin chars) at smaller size + raised Y** so the chosen display font owns both glyphs. See `scripts/generate-designs.js` lines 397-409 for the locked-in approach (`tmSize = LOGO_FONT_SIZE * 0.32`, `tmY = cy - LOGO_FONT_SIZE * 0.34`, `fillText('TM', ...)`). Visual result is indistinguishable from ™ but deterministic across all platforms.

## Default color palette per (type, gender) — CATALOG_COLORS constant

These are verified-in-Gelato palettes used by `?type=generate-slogan` when no `product_variant_stock` data exists for a fresh type. Defined in `agents/index.ts` at the top of the `generate-slogan` handler.

**Never add a color to this map that isn't in Gelato's catalog for that (type, gender) combo.** Trigger `gelato-stock-check` after adding a new color row to a product to confirm it's reachable.

| clothing_type:gender | Verified Gelato colors |
|---|---|
| `t-shirt:unisex` | Black, White, Cream, Navy, Charcoal, Red, Gray, Forest Green (8) |
| `t-shirt:women` | Black, White, Cream, Navy (4) |
| `hoodie:unisex` | Black, White, Cream, Navy, Charcoal, Forest Green, Gray (7) |
| `hoodie:women` | Black, White, Navy, Charcoal (4) |
| `zip-hoodie:unisex` | Black, White, Navy, Gray, Royal Blue (5) — **SOL'S 04237 since 2026-06-02** |
| `long-sleeve:unisex` | Black, White, Cream, Navy, Forest Green, Gray (6) |
| `long-sleeve:women` | Black, White, Navy (3) |
| `cap:unisex` | Black, White, Cream, Navy (4) |
| `cap-emb:unisex` | Black, White, Navy, Cream, Charcoal (5) |
| `v-neck:unisex` | Black, White, Navy, Red (4) |
| `v-neck:women` | Black, White, Navy (3) |
| `tank-top:unisex` | Black, White, Navy, Red (4) |
| `tank-top:women` | Black (1) |

Per oren 2026-05-19: new products should get the **full palette up to 8 colors** (was capped at 4). The `MAX_COLORS=8` constant in `generate-slogan` controls this. Reducing the cap is a deliberate UX decision — every color slot adds 1 Gelato draft + 8 mockup files (front+back × N colors) + bigger admin scroll. 8 is the practical ceiling.

## Product-type variety — slot allocation (TYPE_POOL)

`?type=generate-slogan` picks **3 distinct (type, gender) slots per batch** before calling Gemini, then forces those into the prompt as a HARD REQUIREMENT and also overrides the saved row's `clothing_type` + `gender` to match. This was added 2026-05-19 after Gemini repeatedly returned 3× t-shirt/hoodie/longsleeve and ignored the "bonus for v-neck/tank-top" hint in the prompt.

Weights in the pool (higher = picked more often):

| product_type | gender | base weight | reason |
|---|---|---|---|
| `vneck` | unisex | 4 | NEW (Phase F), needs catalog presence |
| `vneck` | women  | 3 | NEW (Phase F) |
| `tanktop` | unisex | 4 | NEW (Phase F) |
| `tanktop` | women | 2 | NEW (Phase F), Black-only is limiting |
| `tshirt` | unisex | 3 | bread-and-butter, but already 8+ products |
| `tshirt` | women | 2 | |
| `hoodie` | unisex / women | 2 | |
| `ziphoodie` | unisex | 2 | |
| `longsleeve` | unisex / women | 2 | |
| `cap` / `capemb` | unisex | 1 | only ONE word fits on the dad-hat front panel |

**Saturation discount:** `finalWeight = baseWeight / (1 + existingCount × 0.5)` — so a type that already has 10 products gets 1/6 of its base weight on the next pick. Pool drains naturally toward variety.

**Hard requirement:** the picked slots are injected verbatim into the Gemini prompt under `🎯 HARD REQUIREMENT — USE THESE 3 EXACT (product_type, gender) ASSIGNMENTS`. If Gemini ignores them anyway (it sometimes does), the SAVE-step does `s.product_type = picked[sIdx].type` to force the assignment.

Until v-neck + tank-top catch up to ~3 products each, expect EVERY "+ סלוגן חדש" batch to include at least one of them.

## Default selling price = cost (rule #7)

Every new product gets `selling_price = CEIL(MIN(gelato_cost_usd))` automatically — the cheapest IL variant cost rounded up to the next dollar. This is the **rule-#7 floor** from `memory/checkout-guardrails.md`. Per oren 2026-05-20: it's the default. Oren can manually edit Base $ later if he wants higher margin.

The admin `Base $` input enforces this floor as a soft warning, not a hard block:
- Type a value `< CEIL(min cost_il)` → `confirm()` dialog shows: "מחיר נמוך מעלות IL — כל הזמנה IL = הפסד של $X. להמשיך?"
- OK → saves with `price_set_by='admin-override-below-cost-YYYY-MM-DD'` (audit trail) + orange toast
- Cancel → input bumps back to the floor + gray toast

When Base $ is changed, ALL per-variant `sell_price_usd` are mass-updated to the new base (premium per-variant overrides go through the `💵 מחירים פר variant` modal). Margin US/IL grid recalculates live.

## Gelato button — see what we're charged for

Each catalog card has an amber **🎨 {brand} {sku} →** button (e.g. "🎨 Gildan 18500 →") that opens the EXACT Gelato product page. URL pattern:
- `gelato.com/custom/brands/{brand}/{slug}-{brand}-{sku}?region=AS`

Brand-less aliases (hoodie women, ziphoodie, vneck, tanktop) — Gelato API returns `ApparelManufacturer:'none'`, no brand-specific page exists. Those show "🎨 Gelato premium →" + link to the category page.

Double-click → copies the full `productUid` to clipboard (useful for Gelato support tickets).

## Admin pending counters

Two header buttons in "🎨 Product Catalog" tab show live counts:
- **💡 הצעות ממתינות N** — `agent_tasks WHERE agent_id='product' AND status='pending_approval'` (slogan candidates waiting for oren's approve/edit/reject)
- **👀 ממתינים לאישור ויזואלי N** — `dubis_products WHERE pending_visual_approval=true` (products that finished the GHA pipeline, mockups ready for visual approval before going live)

Both counters refresh automatically when the Products tab is opened (J1 fix 2026-05-20 — previously the suggestions counter only fired when the Tasks tab loaded, so the badge in Products tab stayed empty).

### Step 2 — Trigger the GHA pipeline

```bash
gh workflow run dubis-product-pipeline.yml \
  --repo dubis-brand/dubis-website \
  -f product_id=<uuid_from_step_1> \
  -f product_id_numeric=<numeric_id_from_step_1>
```

Or via Edge Function (if oren already has an `agent_tasks` row for the slogan in `pending_approval`):
```bash
curl -X POST "https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=approve-product" \
  -H "Authorization: Bearer <oren-admin-JWT>" \
  -H "Content-Type: application/json" \
  -d '{"product_id":"<uuid>","action":"approve"}'
```

### Step 3 — Watch the pipeline

```bash
gh run watch <run_id> --repo dubis-brand/dubis-website --exit-status
```

~10 minutes. On success, commits land for `designs/` + `images/` + `js/products.js`, callback fires, oren gets an email.

### Step 4 — oren visually approves

Wait for oren to click the magic-link email or the admin button. Don't bypass — `proof_of_completion` validation requires the visual approval step.

### Step 5 — Auto-sync fires + verify

The visual approval automatically dispatches `dubis-sync-products.yml`. Within ~60s it commits `sync(products): post visual-approve refresh for #N`. Verify:

```bash
# Live products.js has the new product?
curl -s "https://www.dubis.net/js/products.js?cb=$(date +%s)" | grep -c "id: <N>"  # → 1

# Mockups all serving?
for c in <colors>; do for f in front back; do
  curl -s -o /dev/null -w "$c-$f: %{http_code}\n" \
    "https://www.dubis.net/images/product-<N>-$c-$f.jpg"
done; done

# Modal opens?
curl -sI "https://www.dubis.net/#product-<N>" | head -1
```

If the auto-sync didn't fire (e.g. `GH_DISPATCH_TOKEN` rate limited), trigger it manually:
```bash
gh workflow run dubis-sync-products.yml --repo dubis-brand/dubis-website -f product_id_numeric=<N>
```

## Locked-in design conventions (NEVER change without oren approval)

These are baked into `scripts/generate-designs.js`. The numbers come from oren-led calibration sessions; deviating breaks the wearer-left-chest illusion or pushes text into Gelato's safe zone.

| Property | Value | Why |
|---|---|---|
| Front logo X (print canvas) | 0.78 | Wearer's left chest (= viewer's right when worn). `0.22` is wearer's right — the 2026-04-24 Hila mirror bug. |
| Front logo Y (print canvas) | 0.17 | Upper chest, just below collar |
| Front logo font size | 300 px Impact | ~2.5 cm printed — Polo/Lacoste scale |
| TM superscript ratio | 0.45 of main letter | Discreet, professional |
| Back BIG word height | 0.11 of canvas | Calibrated for hoodies + tshirts (0.16 was too tall) |
| Back small text height | 0.033 of canvas | |
| Back y_start | tshirt 0.26, hoodie/ziphoodie 0.30, longsleeve 0.22 | Per-type, 2026-04-24 |
| Cap front X / Y | 0.50 / 0.40 | Center of front panel (NOT chest position — caps don't have one) |
| Cap front width ratio | 0.12 | Slightly larger than chest logos |

If you change any of these:
1. Bump `DESIGN_VERSION` in `api/create-gelato-order.js` AND `scripts/download-gelato-mockups.js` (Gelato CDN cache-buster).
2. Re-run the pipeline for EVERY active product (not just the one you tested) — `gh workflow run dubis-product-pipeline.yml` per product.
3. Add a `memory/decisions.md` entry explaining the change.

## What scripts NOT to touch

The legacy `generate-blanks.js`, `composite-mockups.js`, `verify-mockup-parity.js`, `fix-front-images.js`, `fix-back-images.js` are deprecated. They produce node-canvas mockups that diverge from real Gelato prints (font kerning, color saturation, fabric texture all differ). If you find yourself reaching for these, STOP and use the GHA pipeline instead.

The current source of truth for catalog mockups is `dubis-website/images/product-{N}-{Color}-{front|back}.jpg` — produced by step 4 of `dubis-product-pipeline.yml` from Gelato's `preview_default` + `preview_back` URLs, flattened to `#D7D7D7` gray + mozjpeg q90.

## Recovery scenarios

### Pipeline failed at step 4 (Gelato draft creation)
Common: a color in `colors[]` isn't in `COLOR_MAP` for that (type, gender). Fix: either remove the bad color from `dubis_products.colors` and re-trigger, OR add the color to `COLOR_MAP` in BOTH `api/create-gelato-order.js` AND `scripts/download-gelato-mockups.js`.

### Pipeline succeeded but oren says mockups look wrong
Use the QA flow: dubis.net/admin → "🧪 Gelato Tools" → create a free draft order for the suspect product/color → review in Gelato dashboard. If genuinely wrong, fix the design + bump `DESIGN_VERSION` + re-trigger pipeline.

See `.claude/skills/gelato-draft/SKILL.md` for the full draft procedure.

### Visual approval fired but product not on site
Means the auto-dispatch to `dubis-sync-products.yml` didn't fire (env var missing, rate limited, or Edge Function not deployed with the 2026-05-19 change). Manual recovery:
```bash
gh workflow run dubis-sync-products.yml --repo dubis-brand/dubis-website -f product_id_numeric=<N>
```
Then check `memory/runbook.md` § "A visually-approved product doesn't appear on the site" for the long-term fix.

### Edge Function changed locally but autonomous dispatch not firing
Run `dubis-website/deploy-edge-only.bat` (clean deploy, no stale auto-commit). Verify with `mcp__supabase__get_edge_function function_slug=agents` and grep for the new code marker.

## Common mistakes (from postmortems)

| Mistake | Postmortem | Fix |
|---|---|---|
| Visually approved but product invisible on site | 2026-05-19 product #31 | Edge Function had no auto-dispatch — fixed by NEW `dubis-sync-products.yml` workflow + dispatch in `?type=product-visual-approve` |
| Forgot to bump DESIGN_VERSION → Gelato cached old print | 2026-04-23 Hila | Always bump on print file changes |
| `phrase` vs `slogan` column name | 2026-04-24 admin tools | DB column is `slogan` |
| `active=true` set before mockups exist → broken images | Multiple early issues | Trust the pipeline — never flip `active=true` manually |
| Color in DB that doesn't exist in Gelato | "Honey Brown" 2026-04-22 | Verify each color exists in COLOR_MAP for the product's (type, gender) before INSERT |
| Print x=0.22 + mockup x=0.60 → wearer's-right chest | 2026-04-24 mirror | Print 0.78, mockup 0.60 — the geometry maps to the same physical spot |
| Cap front logo at chest x/y → falls on brim | 2026-04-24 cap visual | Caps use x=0.50 y=0.40 |
| Back text y_start uniform across types → too high on hoodies | 2026-04-24 | Per-type: tshirt 0.26, hoodie 0.30, longsleeve 0.22 |
| Used legacy `generate-blanks.js` + `composite-mockups.js` | 2026-05-16 retirement | Use the GHA pipeline — node-canvas drift from Gelato reality |

## References

- `.github/workflows/dubis-product-pipeline.yml` — Stage 1 pipeline source
- `.github/workflows/dubis-sync-products.yml` — Stage 2 sync workflow (added 2026-05-19)
- `dubis-website/scripts/generate-designs.js` — print PNG generator
- `dubis-website/scripts/create-gelato-drafts.js` — Stage 1 draft creator (real mockups)
- `dubis-website/scripts/sync-products-to-js.js` — DB → static products.js
- `dubis-website/.claude/skills/gelato-draft/SKILL.md` — QA via free drafts
- `memory/checkout-guardrails.md` — §1 site=Gelato parity rule
- `memory/troubleshooting.md` — §"Visually-approved product silently absent from site (2026-05-19)"
- `memory/runbook.md` — § "A visually-approved product doesn't appear on the site"
