---
name: add-product
description: Add a new product to DUBIS catalog with full mockup + print parity (B+ pipeline). Last updated 2026-04-25 after the 9-iteration logo position calibration with oren.
---

# Add New Product - Full Checklist (B+ Pipeline)

CRITICAL: This procedure ensures site mockups EXACTLY match what Gelato prints. Skipping any step risks Hila-style bugs (customer sees A, gets B). Read memory/checkout-guardrails.md section 1 and memory/reference_dubis_mockup_pipeline_bplus.md before starting.

## Architecture overview

DUBIS has TWO image pipelines, both must stay in sync:

| Pipeline | Output | Used by |
|---|---|---|
| Print files (scripts/generate-designs.js) | designs/*.png (3600x4200) | Gelato fulfillment - what gets printed |
| Site mockups (scripts/generate-blanks.js + scripts/composite-mockups.js) | images/product-N-Color-{front|back}.jpg | Website - what customer sees |

Both use the SAME Impact font and matching positions (X=0.78 on print canvas vs X=0.60 on blank canvas - they map to the same physical chest spot).

## Locked-in design conventions (DO NOT change without oren approval)

| Property | Value | Why |
|---|---|---|
| Front logo X (print canvas) | 0.78 | Wearer's left chest. 0.22 was wearer's right (wrong) - Hila test |
| Front logo Y (print canvas) | 0.17 | Upper chest, just below collar |
| Front logo font size | 300px Impact | ~2.5cm printed - Polo/Lacoste scale |
| TM superscript ratio | 0.45 of main letter | Discreet, professional |
| Back BIG word size | 0.11 of canvas height | Calibrated for hoodies + tshirts (was 0.16 - too tall) |
| Back small text size | 0.033 of canvas height | |
| Back y_start | tshirt 0.26, hoodie/ziphoodie 0.30, longsleeve 0.22 | Per-type, calibrated 2026-04-24 |
| Cap front logo X / Y | 0.50 / 0.40 | Center of front panel (not chest position) |
| Cap front width ratio | 0.12 | Slightly larger than chest logos |
| Composite blank X | 0.60 (chest-pocket area) | 9 oren iterations - sweet spot |
| Composite blank Y | 0.33 (heart level) | |
| Composite logo width ratio | 0.09 of canvas width | ~9% width - fits within shirt body |

## Step 0: Decide product structure

- Type: tshirt | hoodie | ziphoodie | longsleeve | cap
- Slogan layout:
  - top-bottom: small text â†’ BIG WORD â†’ after text
  - big-top: BIG word at top, small text below
  - cap: special - only DUBIS embroidered on front
- Colors: subset of Black, White, Cream, Navy, Red, Charcoal, Forest Green. Verify each exists in api/create-gelato-order.js COLOR_MAP[type].

## Step 1: Add product to DB (dubis_products)

```sql
INSERT INTO dubis_products
(product_id_numeric, slogan, clothing_type, category, colors, price_usd,
 typography_layout, typography_small, typography_big, typography_after,
 active, source, design_back_dark_url, design_back_white_url,
 description_en, description_he)
VALUES
(19, 'New slogan', 'tshirt', 'men', '["Black","White","Navy"]', 14.0,
 'top-bottom', 'small text', 'BIGWORD', 'after text',
 false, 'manual',
 'https://www.dubis.net/designs/back_design_19_dark.png',
 'https://www.dubis.net/designs/back_design_19_white.png',
 'English description', 'Hebrew description');
```

Set active=false until all later steps verified. DB column is slogan (NOT phrase). Confirmed 2026-04-24.

## Step 2: Add product to scripts

### 2a. scripts/generate-designs.js PRODUCTS array
{ id: 19, phrase: "New slogan", layout: 'top-bottom', small: "small text", big: "BIGWORD", after: "after text" }

### 2b. scripts/generate-blanks.js PRODUCTS array
{ id: 19, type: 'tshirt', colors: ['Black','White','Navy'] }

### 2c. scripts/composite-mockups.js PRODUCTS array
{ id: 19, type: 'tshirt', colors: ['Black','White','Navy'], phrase: "New slogan", layout: 'top-bottom', small: "small text", big: "BIGWORD", after: "after text" }

### 2d. scripts/verify-mockup-parity.js PRODUCTS array
Same (id, type, colors) triple.

### 2e. scripts/fix-front-images.js and scripts/fix-back-images.js
LEGACY - DO NOT USE FOR NEW PRODUCTS. Deprecated 2026-04-24. Kept only for emergency rollback.

## Step 3: Generate print files

```bash
cd dubis-website
node scripts/generate-designs.js
```

Outputs designs/back_design_19_white.png and back_design_19_dark.png. Front logo + cap files are shared - only back is product-specific.
Verify: ls -la designs/back_design_19_*.png - both >200KB.

## Step 4: Generate Gemini blanks (only if new typeÃ—color combo)

If new combo:
```bash
node scripts/generate-blanks.js --missing-only
```
Costs ~$0.05 per blank. Skips existing blanks.

## Step 5: Composite mockups

```bash
node scripts/composite-mockups.js --product=19
```
Outputs images/product-19-{Color}-{front|back}.jpg. Fast (no API).

## Step 6: Verify parity

```bash
node scripts/verify-mockup-parity.js
```
Must pass. If mtime drift >48h - re-run step 5.

## Step 7: Bump DESIGN_VERSION

In api/create-gelato-order.js:
```js
const DESIGN_VERSION = process.env.DESIGN_VERSION || '2026MMDD01';
```
Forces Gelato to re-fetch from CDN.

## Step 8: Deploy

```bash
git add scripts/ designs/ images/ blanks/ api/ memory/
git commit -m "feat(product): add product 19 - New slogan"
git push origin main
```

Verify URLs return 200:
- https://www.dubis.net/designs/back_design_19_white.png?v=DESIGN_VERSION
- https://www.dubis.net/images/product-19-Black-front.jpg

## Step 9: QA via Gelato Draft (FREE)

1. Go to dubis.net/admin â†’ Gelato Tools tab
2. Select product 19, pick a color, ship to US
3. Click "Create DRAFT (free, mockup only)"
4. Review the Gelato draft preview - should match the site mockup
5. If mismatch - fix and redo from step 3

See .claude/skills/gelato-draft/SKILL.md for full draft procedure.

## Step 10: Activate

```sql
UPDATE dubis_products SET active = true WHERE product_id_numeric = 19;
```

## Common mistakes (from postmortems)

| Mistake | Postmortem | Fix |
|---|---|---|
| Forgot to bump DESIGN_VERSION â†’ Gelato uses cached old file | 2026-04-23 Hila bug | Always bump on print file changes |
| phrase vs slogan column name | 2026-04-24 admin tools | DB column is slogan |
| active=true before mockups exist â†’ broken images | Multiple early issues | Keep active=false until step 6 passes |
| Hardcoded color in COLOR_MAP that does not exist in Gelato | "Honey Brown" 2026-04-22 | Verify color via GET /v3/products/{uid} first |
| Mismatch between print x=0.22 and mockup x=0.60 â†’ wearer's right chest in print | 2026-04-24 mirror bug | Print MUST be x=0.78, mockup MUST be x=0.60 |
| Generated images without ?v= cache bust | various | Always use ?v=DESIGN_VERSION in Gelato calls |
| Cap front logo at chest x/y â†’ falls on cap brim (curved, distorted) | 2026-04-24 cap visual | Cap uses x=0.50 y=0.40 |
| Back text y_start same for all types â†’ too high on hoodies | 2026-04-24 hoodie feedback | Per-type: tshirt 0.26, hoodie 0.30, longsleeve 0.22 |

## References

- memory/reference_dubis_mockup_pipeline_bplus.md - full architecture
- memory/checkout-guardrails.md - guardrails (especially #1)
- memory/troubleshooting.md - known issues
- .claude/skills/gelato-draft/SKILL.md - QA via free draft orders
- docs/plans/DUBIS_GELATO_TOOLS_ADMIN_2026-04-24.html - feature design memo
