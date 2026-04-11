---
paths:
  - "api/**"
---

# API Conventions — DUBIS

## Routing Pattern
All API files use query param routing internally:
```
/api/cron/morning-report?type=content  → content pipeline
/api/cron/morning-report?type=agents   → run agents
/api/cron/morning-report?type=auto-run → auto-execute all non-budget tasks
/api/cron/morning-report?type=security → security scan
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