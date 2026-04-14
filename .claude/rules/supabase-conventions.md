---
paths:
  - "supabase/**"
  - "js/supabase-config.js"
  - "js/auth.js"
---

# Supabase Conventions — DUBIS

## Project
- ID: `ntzwvqtpdmvvavbhuyeb`
- Dashboard: https://supabase.com/dashboard
- RLS enabled on ALL tables — never disable

## Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| orders | Customer orders | ✅ |
| profiles | User profiles (role: admin/customer) | ✅ |
| coupons | Discount coupons | ✅ |
| page_views | Analytics tracking | ✅ |
| product_prices | Price overrides + Gelato images | ✅ |
| agent_tasks | AI agent tasks | ✅ |
| agent_runs | Agent execution logs | ✅ |
| newsletter_subscribers | Newsletter signups | ✅ |
| product_reviews | Customer reviews | ✅ |
| app_config | General configuration | ✅ |
| webhook_events | Dedup webhooks (idempotency) | ✅ |
| daily_snapshots | Daily analytics snapshot | — |

## Edge Functions
- Single function: `agents` with 22 routes via `?type=` query param
- URL: `https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents`
- Deploy: `npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb`
- Auth: admin JWT OR `x-agent-secret` header OR `Bearer CRON_SECRET`

## Admin User
- Email: dubis.brand@gmail.com
- Role: `admin` in profiles table
