---
name: content-pipeline
description: Create marketing content for DUBIS social media (Instagram + Facebook)
---

# Content Pipeline — DUBIS

Create social media content following DUBIS brand guidelines.

## Automatic Pipeline — TWO sources of work since 2026-05-17

**Primary (weekly plan, IL pivot):**
1. **`?type=weekly-marketing-plan`** route — Sunday 04:00 UTC. Marketing agent generates 17 slots/week with timestamps, language (12 HE / 5 EN), product, slogan. Inserts placeholder `agent_tasks` rows with `status='backlog'` + `content_data.needs_copy=true`.
2. **`?type=copy-qa`** (NOT YET BUILT, next batch) — runs after oren's approval of the weekly plan. Fills `caption_he` / `caption_en` per slot using Gemini API with `memory/copy-playbook.md` as `system_instruction`. Scores each caption against the 8 playbook rules.
3. **`?type=publish-ready`** — picks up tasks where their `scheduled_for` arrived, has caption + image + qa_score ≥ 75, publishes via Graph API.

**Fallback (legacy daily cron, still runs):**
1. `?type=auto-content` route → picks product, creates one task (default EN, accepts `?lang=he|en` override since 2026-05-17)
2. `?type=content-run` → generates caption + image
3. `?type=qa-content` → quality check
4. `?type=publish-ready` → publishes
   - 2 posts/day at 10:00 + 16:00 UTC (these will be deprecated as the weekly plan covers full 17 slots)

## Manual Content Creation
When asked to create content manually:

1. **Select product** — pick from active `dubis_products` (18 products as of 2026-05-17)
2. **Write caption** following **`memory/copy-playbook.md`** (8 rules — auto-loaded via CLAUDE.md):
   - **Language: HE OR EN, never mixed in the same caption.** Both must be original (not translated from the other) — see playbook §5 "anti-translation rule"
   - HE: rooted-local Israeli, with anchors (מרפסת ת"א, פינג'אן, פקקים, חמסין, ארוחת שישי)
   - EN: original English, its own copy
   - 3-beat formula: Cynical Hook → Agitation → DUBIS Drop (playbook §4)
   - Zero-apology — no self-deprecating humor of weakness (playbook §2)
   - Reference one of the 6 approved slogans verbatim (`memory/brand-identity.md`)
   - Avoid blacklist words (playbook §3) — HE: `מושלם`/`מהמם`/`לייף סטייל`; EN: `perfect`/`stunning`/`must-have`
   - Identity-based CTA, not "Buy now 20% off" (playbook §6)
3. **Generate image prompt** using brand typography rules:
   - POWER WORD must be 3-5x larger than surrounding text
   - White text on dark garments, dark on light
   - Bold condensed sans-serif font (Impact / Anton)
   - Front: small "DUBIS™" left chest only
   - Back: slogan ONLY, no logo
4. **QA check** before publishing:
   - Read caption aloud (playbook §8 "gold-standard test") — does it sound like a TV commercial? Delete. Does it sound like talking to a friend complaining about life? It's DUBIS.
   - Terminology correct? (קפוצון, not הודי — see `memory/glossary.md`)
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
- **PRIMARY: `memory/copy-playbook.md`** — the canonical 8-rule voice bible (auto-loaded via CLAUDE.md @imports). All copy generation must pass these rules.
- Check `.claude/rules/brand-terminology.md` for Hebrew terms (`קפוצון` not `הודי`)
- Check `.claude/rules/brand-typography.md` for slogan layouts
- Check `.claude/rules/brand-content.md` for tone and audience
- Check `.claude/rules/gelato-operations.md` for design-file specs + refresh flow
- See `docs/plans/campaigns/DUBIS_WEEKLY_SOCIAL_PLAN_2026-05-16.html` for the weekly cadence
- See `docs/plans/campaigns/DUBIS_PHASE0_PERSONAS_REGEN_2026-05-17.html` for the Reels blocker
