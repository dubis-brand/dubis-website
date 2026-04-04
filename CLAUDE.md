# DUBIS Website — Agent Instructions

## Critical Constraints

### Vercel Hobby Plan — 12 Serverless Function Limit
**⚠️ NEVER create new .js files in `/api/`!**
Vercel Hobby plan allows MAX 12 Serverless Functions per deployment.
We are currently AT the limit (12/12).

**Current API files (12/12) — NO MORE SLOTS:**
1. `/api/analytics/track.js` — Page view tracking
2. `/api/create-gelato-order.js` — Gelato order creation
3. `/api/cron/morning-report.js` — Morning cron report + content pipeline (?type=content)
4. `/api/cron/review-requests.js` — Review request emails (7 days post-delivery)
5. `/api/email/confirm-order.js` — Order confirmation email
6. `/api/orders/save.js` — Save order to Supabase
7. `/api/webhooks/gelato.js` — Gelato webhook
8. `/api/admin/analytics.js` — Admin analytics dashboard
9. `/api/admin/coupons.js` — Coupon management
10. `/api/admin/gelato-sync.js` — Gelato sync admin
11. `/api/admin/orders.js` — Order management
12. `/api/admin/users.js` — User management

**Migrated to Supabase Edge Functions:**
- `agents` — All 21 agent routes at `https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents`

**To add new functionality:** Add routes inside existing API files using query params (e.g., `?type=newroute` in agents.js).

### Deployment
- Push to `main` branch on GitHub auto-deploys to Vercel
- Production URL: https://www.dubis.net
- vercel.json configures maxDuration and rewrites

### Database (Supabase)
- Project: `ntzwvqtpdmvvavbhuyeb`
- Tables: orders, profiles, coupons, page_views, product_prices, agent_tasks, agent_runs, newsletter_subscribers, product_reviews
- RLS enabled on all tables

### Environment Variables (Vercel only)
- INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID — Instagram Graph API
- AGENT_SECRET — Agent authentication
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
- ADMIN_EMAILS — Comma-separated admin emails
- GELATO_API_KEY — Print-on-demand
- RESEND_API_KEY — Email sending
- PAYPAL_CLIENT_ID, PAYPAL_SECRET — Payments

## Brand Rules — DUBIS

### Hebrew Terminology (CRITICAL — enforce everywhere)
- **קפוצון** = hoodie. NEVER use "הודי" or "הודיז" in Hebrew. Always "קפוצון" / "קפוצונים".
- **קפוצון זיפ** = zip hoodie. NEVER "זיפ הודי".
- **חולצה** = t-shirt.
- **ארוכת שרוול** = long sleeve.
- **כובע** = hat/cap.

### Product Slogans — Typography Map (CRITICAL)
Each slogan uses **mixed-size typography**: a KEY POWER WORD in huge bold uppercase, with setup/connecting words in smaller text. This is the exact layout as printed on garments. **NEVER write slogans in uniform font size.**

Format: `small text` → **HUGE TEXT** → `small text` | Product type

1. `I am not fat, I am a` → **LIMITED** → `edition.` | T-Shirt
2. `more of me` → **LOVE** | T-Shirt
3. `NAPPING IS MY` → **CARDIO** | Hoodie
4. `I survived.` (large) / `That's enough.` (medium below) | T-Shirt
5. `low maintenance` → **VALUE** → `high` (below) | T-Shirt
6. `Not a model.` → **NEVER.** → `wanted to be.` | Hoodie
7. **NAP** (huge top) → `Born to nap, forced to work` (small below) | T-Shirt
8. `certified` → **OVER** → `thinker.` | Zip Hoodie
9. `serial` → **NAPPER** | Long-Sleeve
10. `She believed she could, so she took a` → **NAP.** | T-Shirt (Women)
11. **COFFEE** (huge top) → `I run on coffee and sarcasm.` (small below) | T-Shirt (Women)
12. `Zero Motivation` → **CLUB** | Hoodie (Women)
13. `emotionally attached to my` → **COUCH** | Long-Sleeve (Women)
14. `Success` (large italic) `has` (small) `no` (large bold) → **SIZE** → `limit.` + ⭕XL graphic | Brand slogan

**Rules for image generation / content creation:**
- The POWER WORD must be 3-5x larger than the surrounding text
- All text is white on dark garments, dark on light garments
- Bold sans-serif font (condensed/impact style)
- Small "DUBIS" text at bottom of back print
- Front: small "DUBIS™" on left chest only
- NEVER write the full slogan in same-size letters — always use the hierarchy above

### Logo & Branding
- Small "DUBIS™" text on front chest (left side)
- Large slogan text on BACK of garment with mixed-size typography (see Typography Map above)
- Logo font: bold, clean, condensed sans-serif (Impact/Helvetica Condensed style)
- Brand colors: dark navy, gold/tan, black, white, charcoal
- DUBIS bear logo appears on some items

### Content Guidelines
- Captions: Hebrew ONLY for Hebrew audience. English for English.
- Tone: Self-aware humor, body-positive, relatable, comfortable-in-your-own-skin
- Target audience: Plus-size / body-positive, comfort-first fashion, 25-45 age
- NEVER use generic stock descriptions — always tie to specific DUBIS product & slogan
- Product images should show the ACTUAL slogan clearly

### Reel / Talking Photo Requirements
- Photo must have ONE person, face visible, facing camera
- Person should be wearing the RELEVANT product (hoodie for hoodie content, t-shirt for t-shirt content)
- No sunglasses covering face
- Good lighting, clear face

## Agents System — Status & Architecture (Updated 2026-04-02)

### Supabase Edge Function: `agents`
- URL: `https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents`
- All agent routes via `?type=` query param
- Deploy: `npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb`
- Auth: admin JWT OR `x-agent-secret` header OR `Bearer CRON_SECRET`

### Agent Summary (8 agents)

| Agent | Auto? | Schedule | What it does | Works? |
|-------|-------|----------|-------------|--------|
| Boss | ✅ AUTO | cron 05:00 UTC | Daily report + snapshot | ✅ Yes |
| Content | ✅ AUTO | cron 10:00+16:00 UTC | 2 posts/day (HE+EN) IG+FB | ✅ Yes |
| CTO | ❌ Manual | "הרץ" button | Technical implementation plans | ✅ When triggered |
| Email Monitor | ✅ AUTO | Cowork 06:45 | Scan Gmail for invoices/alerts | ✅ Yes |
| Product | ❌ Manual | Admin button | Generate slogans + new products | ✅ New |
| Security | ✅ AUTO | Weekly Mon 03:00 | Security scan headers/RLS/keys | ✅ New |
| Supply | ✅ AUTO | cron 00:00 UTC | Gelato order sync | ✅ Yes |
| Site Audit | ✅ AUTO | Cowork 06:50 | SEO/UX scan of dubis.net | ✅ Yes |

### Cron Schedule (vercel.json)

| UTC | Israel | Endpoint | Task |
|-----|--------|----------|------|
| 00:00 | 02:00 | /api/admin/gelato-sync | Gelato order sync |
| 04:00 | 06:00 | /api/cron/morning-report?type=agents | Agent runs |
| 05:00 | 07:00 | /api/cron/morning-report | Morning report + boss agent |
| 08:00 | 10:00 | /api/cron/review-requests | Review request emails (7d post-delivery) |
| 10:00 | 12:00 | /api/cron/morning-report?type=content | Content — HE post |
| 16:00 | 18:00 | /api/cron/morning-report?type=content | Content — EN post |

### Cowork Agents (external, not in vercel.json)
- Email Monitor: 06:45 UTC via Cowork Scheduler
- Site Audit: 06:50 UTC via Cowork Scheduler
- These run through the Supabase Edge Function, not Vercel

### Key Routes (?type= on Edge Function)
- `tasks` — CRUD agent_tasks (GET/POST/PATCH/DELETE)
- `runs` — CRUD agent_runs
- `run` — Execute all approved tasks by agent type
- `auto-content` — Auto-rotate products, create 2 daily content tasks (HE+EN)
- `content-run` — Generate captions + images for pending tasks
- `qa-content` — QA check on generated content
- `publish` / `publish-ready` — Publish approved content to Instagram + Facebook
- `generate-image` — Generate images via Gemini/Pollinations
- `generate-slogan` — Product Creator: generate 3 slogan suggestions via Gemini
- `approve-product` — Approve/reject/edit product suggestions (admin only)
- `security-scan` — Security audit: headers, RLS, exposed keys, PayPal mode

## User Preferences (oren)
- **Plans & proposals**: ALWAYS deliver as HTML file with RTL Hebrew alignment (direction:rtl, text-align:right). Never as inline text in chat.
- **Language**: Respond in Hebrew when input is Hebrew.
- **Style**: Be direct, professional, opinionated. Say the hard truth.
