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

## Key Rules
- Check `.claude/rules/brand-terminology.md` for Hebrew terms
- Check `.claude/rules/brand-typography.md` for slogan layouts
- Check `.claude/rules/brand-content.md` for tone and audience
