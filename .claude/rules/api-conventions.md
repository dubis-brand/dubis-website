---
paths:
  - "api/**"
---

# API Conventions — DUBIS

## Routing Pattern
All API files use query param routing internally:
```
/api/cron/morning-report?type=content              → content pipeline
/api/cron/morning-report?type=agents               → run agents
/api/cron/morning-report?type=auto-run             → auto-execute all non-budget tasks
/api/cron/morning-report?type=security             → security scan
/api/cron/morning-report?type=weekly-marketing-plan→ Sunday weekly plan generator
/api/cron/morning-report?type=geo                  → PUBLIC. Echoes Vercel x-vercel-ip-country / region / city headers. No auth.
/api/cron/morning-report?type=refund-by-id&capture_id=XXX → POST. CRON_SECRET auth. Direct PayPal capture refund (post-2026-05-21 _no_refund recovery).
/api/cron/morning-report?type=reconcile-orders     → Background sweep. Finds orders with refund_id IS NULL but Gelato dashboard shows no order; fires emergency refund.
/api/cron/morning-report?type=feedback-notify      → pg_net trigger from feedback_responses INSERT.
/api/cron/morning-report?type=feedback-apology     → 6 personal HE reminder drafts to non-responders.

/api/create-gelato-order                           → POST. PayPal capture → Gelato order(s).
/api/create-gelato-order?action=stock-probe        → POST. Pre-flight quote-API probe. Returns mode ∈ {quote_ok, quote_split_required, quote_partial_oos, all_blocked_pre_gelato}.
/api/create-gelato-order?action=create-draft       → POST. Admin-only. Creates FREE Gelato draft order for QA (no real charge).
```

## Authentication
- **Admin endpoints:** Supabase JWT token in `Authorization: Bearer <token>` header
- **Agent endpoints:** `x-agent-secret` header matching `AGENT_SECRET` env var
- **Cron endpoints:** `Authorization: Bearer <CRON_SECRET>` or Vercel cron header

## Response Format
All endpoints return JSON:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "error_code", "message": "Human readable" }
```

## Cron Schedule (vercel.json)
| UTC | Israel | Endpoint | Task |
|-----|--------|----------|------|
| 00:00 | 02:00 | /api/admin/gelato-sync | Gelato order sync |
| 04:00 | 06:00 | /api/cron/morning-report?type=agents | Agent runs |
| 05:00 | 07:00 | /api/cron/morning-report | Morning report + boss agent |
| 06:00 | 08:00 | /api/cron/morning-report?type=auto-run | **Auto-execute tasks** |
| 08:00 | 10:00 | /api/cron/review-requests | Review request emails |
| 10:00 | 12:00 | /api/cron/morning-report?type=content | Content — HE post |
| 12:00 | 14:00 | /api/cron/morning-report?type=auto-run | **Auto-execute tasks** |
| 16:00 | 18:00 | /api/cron/morning-report?type=content | Content — EN post |
| 03:00 Mon | 05:00 Mon | /api/cron/morning-report?typ