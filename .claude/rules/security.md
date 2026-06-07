---
paths:
  - "vercel.json"
  - "api/**"
  - "supabase/**"
---

# Security Rules — DUBIS

## CSP (Content Security Policy) — in vercel.json
- script-src: self + unsafe-inline + PayPal + jsdelivr CDN + connect.facebook.net + googletagmanager + **`*.clarity.ms`**
- style-src: self + unsafe-inline + Google Fonts
- frame-src: PayPal only
- img-src: self + data: + https:
- connect-src: self + PayPal + Supabase + facebook + google-analytics + **`*.clarity.ms`**
- **TODO (P2):** Remove `unsafe-inline` from script-src (requires refactoring 30+ onclick handlers)

### 🚨 RULE: every new third-party script MUST be whitelisted in CSP — in the SAME change as the snippet
A correctly-installed analytics/pixel/widget tag with **zero data** ≈ a CSP block. Adding the `<script>` snippet is NOT enough — the browser silently refuses to load/run any external host not in `script-src`, and refuses its data beacons if not in `connect-src`.
- Add the host to `script-src` (loads the JS) **and** `connect-src` (lets it phone home). Add to `img-src`/`frame-src` too if it loads pixels/iframes.
- Quick check after deploy: `curl -sD- https://www.dubis.net/ | grep -i content-security` — confirm the new host is present.
- **Real incident (2026-06-07):** Microsoft Clarity (`wysjio6jpk`) recorded **0 sessions for 30 days** despite the tag being live with the right project id — `clarity.ms` wasn't in the CSP, so the browser blocked `scripts.clarity.ms` + the `c.clarity.ms` beacon. Fix `6a8728a` added `https://*.clarity.ms` to script-src + connect-src. Full postmortem: `memory/troubleshooting.md`.

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
