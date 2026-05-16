---
name: content-pipeline
description: Create marketing content for DUBIS social media (Instagram + Facebook)
---

# Content Pipeline — DUBIS

Create social media content following DUBIS brand guidelines.

## Automatic Pipeline (runs daily via cron)
1. `auto-content` route → picks product, creates HE+EN task pair
2. `content-run` route → generates captions + image prompts via Gemini
3. `qa-content` route → quality check against brand rules
4. `publish` route → posts to Instagram + Facebook

## Manual Content Creation
When asked to create content manually:

1. **Select product** — pick from the 14 active slogans
2. **Write caption** following brand rules:
   - Hebrew for HE audience, English for EN audience — NEVER mix
   - Self-aware humor, body-positive, relatable tone
   - Reference the specific slogan and POWER WORD
   - Include relevant hashtags
3. **Generate image prompt** using brand typography rules:
   - POWER WORD must be 3-5x larger than surrounding text
   - White text on dark garments, dark on light
   - Bold condensed sans-serif font
   - Front: small "DUBIS™" left chest only
   - Back: slogan ONLY, no logo
4. **QA check** before publishing:
   - Terminology correct? (קפוצון, not הודי)
   - Typography hierarchy correct?
   - Caption matches product?
   - Image shows correct product type?

## Image source of truth (2026-05-16 update)

The catalog hero images on dubis.net are NOT AI-generated — they are real
Gelato draft-order previews of the exact garment Gelato prints. Every
(product, color) variant lives at the same predictable path:

```
https://www.dubis.net/images/product-{id}-{Color}-{face}.jpg
local: dubis-website/images/product-{id}-{Color}-{face}.jpg
```

Where:
- `{id}` = `dubis_products.product_id_numeric` (1-18)
- `{Color}` = exact color name from the catalog (`Black`, `White`, `Cream`,
  `Navy`, `Red`, `Charcoal`, `Forest-Green` — spaces replaced with hyphens)
- `{face}` = `front` (chest DUBIS™ logo) or `back` (slogan)

These are the same images customers see. Always prefer them for "clean
product shot" social posts to keep ads, posts, videos and the site in
visual lockstep. Use the lifestyle `dubis_images` table only when the post
explicitly needs a person wearing the product.

**When the print designs change** (anything in `dubis-website/designs/`),
the refresh workflow is:
1. `node dubis-website/scripts/generate-designs.js` — rebuild the print PNGs
2. Commit and push → Vercel deploys to `dubis.net/designs/...`
3. Bump `DESIGN_VERSION` in `scripts/download-gelato-mockups.js` so Gelato
   re-fetches the new files (cache-buster)
4. `node dubis-website/scripts/download-gelato-mockups.js` — re-render all
   product × color mockups via Gelato draft orders (~25-30 min)
5. Convert PNG → JPG on a `#D7D7D7` flat background (sharp.flatten),
   quality 90 mozjpeg, write to `images/product-{id}-{Color}-{face}.jpg`
6. Commit and push → site instantly reflects the new mockups

Skip any step and the catalog will silently fall behind the actual printed
product — exactly the situation we fixed on 2026-05-16.

## Key Rules
- Check `.claude/rules/brand-terminology.md` for Hebrew terms
- Check `.claude/rules/brand-typography.md` for slogan layouts
- Check `.claude/rules/brand-content.md` for tone and audience
- Check `.claude/rules/gelato-operations.md` for design-file specs + refresh flow
