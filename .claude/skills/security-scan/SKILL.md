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
