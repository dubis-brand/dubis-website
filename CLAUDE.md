# DUBIS Website — Agent Instructions

## Critical Constraints

### Vercel Hobby Plan — 12 Serverless Function Limit
**⚠️ NEVER create new .js files in `/api/`!**
Vercel Hobby plan allows MAX 12 Serverless Functions per deployment.
We are currently AT the limit (12/12).

**Current API files:**
1. `/api/agents.js` — Agent system (tasks, runs, publishing) — maxDuration: 90s
2. `/api/track.js` — Page view tracking
3. `/api/checkout.js` — PayPal order creation
4. `/api/gelato-hook.js` — Gelato webhook
5. `/api/gelato-products.js` — Gelato product sync
6. `/api/admin/analytics.js` — Admin analytics dashboard
7. `/api/admin/coupons.js` — Coupon management
8. `/api/admin/gelato-sync.js` — Gelato sync admin
9. `/api/admin/orders.js` — Order management
10. `/api/admin/users.js` — User management
11. `/api/_rateLimit.js` — Rate limiting helper (shared)
12. `/api/_printful.js` — Printful helper (shared)

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

### Product Slogans (must match website exactly)
These are the actual slogans printed on DUBIS products. Use them AS-IS, never paraphrase:
- "Not a Model, Never Wanted to Be"
- "More of me to love"
- "Napping is my Cardio"
- "I Run on Coffee and Sarcasm"
- "I'm not fat, I'm a Limited Edition"
- "Low Maintenance, High Value"
- "Serial Napper"
- "Certified Overthinker"
- "I Survived, That's Enough"
- "She Believed She Could, So She Didn't"
- "DUBIS for the Rest of Us"
- "Zero Motivation Club"
- "Emotionally Attached to my Couch"

### Logo & Branding
- Small "DUBIS™" text on front chest (left side)
- Large slogan text on BACK of garment
- Logo font: bold, clean, sans-serif
- Brand colors: dark navy, gold/tan, black, white
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

## User Preferences (oren)
- **Plans & proposals**: ALWAYS deliver as HTML file with RTL Hebrew alignment (direction:rtl, text-align:right). Never as inline text in chat.
- **Language**: Respond in Hebrew when input is Hebrew.
- **Style**: Be direct, professional, opinionated. Say the hard truth.
