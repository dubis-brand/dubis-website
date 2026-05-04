---
name: security-scan
description: Run a security audit on DUBIS website
---

# Security Scan — DUBIS

Run the automated security agent to audit the website.

## Trigger Automated Scan
The Security Agent runs automatically every Monday at 03:00 UTC.
To trigger manually:

```bash
curl -X POST "https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=security-scan" \
  -H "x-agent-secret: <AGENT_SECRET>"
```

## What It Checks
- HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)
- Supabase RLS policies on all tables
- Exposed API keys in frontend code
- PayPal mode (sandbox vs live)
- SSL/TLS configuration
- **(NEW 2026-05-04) public.dub_admins allowlist sanity** — only oren’s emails should be in there. Any unknown email = P0 alert.
- **(NEW 2026-05-04) Recent auth.users signups** — flag any user NOT in dub_admins who logged in via OAuth in last 24h.
- **(NEW 2026-05-04) Static files publicly served from /docs, /memory, /.claude, /supabase** — must be in .vercelignore. Hit dubis.net/docs/plans/*.html in browser; 404 expected, 200 = leak.
- **(NEW 2026-05-04) Frontend false-positive list** — do NOT alert on PayPal client_id (public OAuth field), supabase anon JWT (public, RLS-protected). DO alert on PAYPAL_SECRET, service_role JWTs, ghp_*, sk_*, real bearer tokens.
- **(NEW 2026-05-04) Admin gate proof** — open dubis.net/dub-console in incognito with a non-allowlisted Google account; MUST see "Access denied". If dashboard renders, the dub_admins gate is broken.

## P0 Incident Reference: zelbiger@gmail.com breach 2026-05-04
Root cause: admin.html only checked if (session?.user). Any signed-in Google user got the entire admin DOM. Fix: public.dub_admins allowlist + gateOrSignOut() in admin.html. URL renamed /admin → /dub-console.

## Interpreting Results
Results are saved in `agent_runs` table with type `security`.

## Manual Checks (Beyond Automated)
1. **Git secrets:** `git log --all --oneline -- "*.key.txt"` — should show only removal commits
2. **CSP violations:** Check browser console on dubis.net for CSP reports
3. **Env vars:** Verify all required env vars are set in Vercel and Supabase
4. **Dependencies:** `npm audit` for known vulnerabilities

## Known Issues
- `unsafe-inline` in script-src CSP (P2 — requires refactoring 30+ onclick handlers)
- API keys were in git history (keys should be rotated)

## References
→ .claude/rules/security.md for security configuration details
