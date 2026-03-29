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

## User Preferences (oren)
- **Plans & proposals**: ALWAYS deliver as HTML file with RTL Hebrew alignment (direction:rtl, text-align:right). Never as inline text in chat.
- **Language**: Respond in Hebrew when input is Hebrew.
- **Style**: Be direct, professional, opinionated. Say the hard truth.
