---
paths:
  - "supabase/functions/agents/**"
  - "api/cron/**"
---

# Agents System — DUBIS (Phase 2 Autonomy)

## 🇺🇸 US PIVOT (2026-04-18)
All customer-facing content (Instagram/Facebook captions, ads, landing copy) is **ENGLISH ONLY**. The Content agent generates `caption_en` only — `caption_he` is fully retired.

## Phase 2 Rules
- ALL tasks auto-execute without approval (auto-run cron 08:00+14:00 Israel)
- EXCEPTION: `requires_budget=true` tasks stay in pending_approval for manual OK
- Results saved to `notes`, tasks auto-complete to `done`
- Morning report includes 24h agent activity summary

## Agent Summary
| Agent | Auto? | Schedule | What it does |
|-------|-------|----------|-------------|
| Boss | ✅ AUTO | cron 05:00 UTC | Daily report + agent activity summary |
| Content | ✅ AUTO | cron 10:00+16:00 UTC | **2 posts/day — ENGLISH ONLY** IG+FB (US pivot 2026-04-18) |
| CTO | ✅ AUTO | auto-run 06:00+12:00 UTC | Tech plans → auto-done |
| Marketing | ✅ AUTO | auto-run 06:00+12:00 UTC | Analysis → auto-done |
| Email Monitor | ✅ AUTO | Cowork 06:45 | Scan Gmail for invoices/alerts |
| Product | ✅ AUTO | auto-run 06:00+12:00 UTC | Slogans + products → auto-done |
| Security | ✅ AUTO | Weekly Mon 03:00 | Security scan |
| Supply | ✅ AUTO | cron 00:00 UTC | Gelato sync → auto-done |
| Site Audit | ✅ AUTO | Cowork 06:50 | SEO/UX scan |

## Key Routes (?type= on Edge Function)
- `tasks` — CRUD agent_tasks (GET/POST/PATCH/DELETE)
- `runs` — CRUD agent_runs
- `run` — Execute all pending+approved tasks (Phase 2: skips requires_budget)
- `auto-content` — Auto-rotate products, create 2 daily content tasks (EN-only post US pivot 2026-04-18)
- `content-run` — Generate captions + images for pending tasks
- `qa-content` — QA check on generated content
- `publish` / `publish-ready` — Publish approved content to Instagram + Facebook
- `generate-image` — Generate images via Gemini/Pollinations
- `generate-slogan` — Product Creator: generate 3 slogan suggestions via Gemini
- `approve-product` — Approve/reject/edit product suggestions (admin only)
- `security-scan` — Security audit: headers, RLS, exposed keys, PayPal mode

## Cowork Agents (External, not in vercel.json)
- Email Monitor: 06:45 UTC via Cowork Scheduler
- Site Audit: 06:50 UTC via Cowork Scheduler
- These run through the