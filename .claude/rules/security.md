---
paths:
  - "vercel.json"
  - "api/**"
  - "supabase/**"
---

# Security Rules — DUBIS

## CSP (Content Security Policy) — in vercel.json
- script-src: self + unsafe-inline + PayPal + jsdelivr CDN
- style-src: self + unsafe-inline + Google Fonts
- frame-src: PayPal only
- connect-src: self + PayPal + Supabase
- **TODO (P2):** Remove `unsafe-inline` from script-src (requires refactoring 30+ onclick handlers)

## Security Headers (vercel.json)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- HSTS: max-age=63072000; includeSubDomains; preload

## Environment Variables
### Vercel
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, PAYPAL_CLIENT_ID,
PAYPAL_SECRET, GELATO_API_KEY, GELATO_WEBHOOK_SECRET, RESEND_API_KEY,
AGENT_SECRET, CRON_SECRET, ADMIN_EMAILS, INSTAGRAM_ACCESS_TOKEN (⚠️ expired),
INSTAGRAM_ACCOUNT_ID

### Supabase Edge Function Secrets
GEMINI_API_KEY, HEYGEN_API_KEY, INSTAGRAM_ACCESS_TOKEN (⚠️ expired),
INSTAGRAM_ACCOUNT_ID, AGENT_SECRET, CRON_SECRET, ADMIN_EMAILS

## ⚠️ Known Security Issue
API keys were previously committed to git (commit 18d0c2d).
Keys should be rotated: Gemini, PayPal, Rave, Printful.
