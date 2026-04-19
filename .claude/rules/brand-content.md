---
paths:
  - "supabase/functions/agents/**"
---

# Brand Content Guidelines — DUBIS

## 🇺🇸 US PIVOT — 2026-04-18 (LOCKED)
**All customer-facing content is ENGLISH ONLY.** No Hebrew captions, no Hebrew ads, no Hebrew landing copy. Hebrew is allowed ONLY in reports oren reads (per user preferences), NEVER in anything a customer sees.

## 🔗 PRODUCT-LINK RULE — 2026-04-18 (LOCKED)
**Every social post must feature a REAL product from `dubis_products` (active=true) AND show the direct product URL visibly in the caption.**
- URL pattern: `https://www.dubis.net/#product-{product_id_numeric}` (hash routing in `js/main.js`)
- Set by `auto-content` into `content_data.product_url` — already mandatory
- `content-run` MUST refuse to advance a task to `pending_approval` without a valid `product_url` that matches an active product
- `publish` MUST include the URL as plain text on IG (not clickable but readable — "link in bio" alone fails the spec) AND as clickable link on FB
- `qa-content` MUST fail any post whose caption doesn't reference the product slogan or the URL
- Caption MUST include the product's USD price OR the shop line MUST include it — the viewer must never need to click-to-find price
- No generic captions, no fictional items, no "visit our shop" — every post is one product, one slogan, one URL, one price

## Brand Identity
- **Tone:** Self-aware dry humor, body-positive, conversational, anti-hype, "for the rest of us"
- **Target audience:** US 35-55, all genders. Real bodies, real lives. Exhausted by gym-culture and influencer-speak.
- **Tagline:** "For the rest of us" / "Built for the body you actually live in"
- **Brand colors:** Charcoal (#2C2C2C), Honey (#C17E3A), Cream (#F5F0E8)
- **Fonts:** Anton (logo), Fraunces (display), Inter (body)
- **Logo:** Small "DUBIS™" text front chest (left side), DUBIS bear on some items

## Content Rules (EN-ONLY)
- **Captions are English only.** No `caption_he` field should be populated going forward.
- **Banned words:** perfect, stunning, must-have, insane, sale, discount, luxurious, premium, exclusive
- NEVER use generic stock descriptions — always tie to a specific DUBIS product + slogan
- Product images must show the ACTUAL slogan clearly (see brand-typography.md)
- First-person plural ("we", "us") — tribe voice, not sales voice
- Short punchy sentences. No fluff. Conversational, not literary.
- No urgency-language. No countdown. No "limited time."

## Reel / Talking Photo Requirements
- ONE person, face visible, facing camera
- Person wearing the RELEVANT product (hoodie for hoodie content, t-shirt for t-shirt)
- No sunglasses covering face
- Good lighting, clear face
- English audio/captions only

## Hashtag Strategy (US)
- Core: `#DUBIS #ForTheRestOfUs #BodyPositive #PlusSizeFashion #ComfortFirst`
- Angle-specific examples: `#NappingIsCardio #OverThinker #ZeroMotivationClub`
- 5-10 hashtags per post, all English, US-relevant

## Cron Schedule (EN × 2/day)
- 10:00 UTC (06:00 ET) — morning feed
- 16:00 UTC (12:00 ET) — noon feed
- Both posts are EN. The legacy HE/EN split was retired on 2026-04-18.
