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

## PostgREST `db-max-rows` ceiling — use RPC for aggregation (2026-05-24)

**Rule.** Any Supabase JS query that may return >1000 rows for client-side aggregation (sum, count-by-key, group-by-day, top-N from raw rows) MUST be replaced with a Postgres RPC that aggregates server-side.

**Why.** Supabase's hosted PostgREST has a server-side `db-max-rows` ≈ **1000**. `.limit(10000)` in the JS client is sent as `?limit=10000` and PostgREST takes `min(client_limit, server_max)` — so `.limit(10000)` actually returns ≤1000 rows. **Silent truncation, no error.**

On 2026-05-24 this hid 79% of admin chart traffic (5,055 actual rows → 2,091 admin display, "7 ימים אחרונים" showed 0 instead of 2,805). The bug had been latent since 2026-04-09; only the post-Hila-II traffic spike (~500/day) pushed the most-recent chunk past 1000 rows and made it visible. Three "fix" commits all wrote `.limit(10000)` thinking it worked.

**The pattern (canonical):**
```sql
CREATE OR REPLACE FUNCTION admin_<thing>_summary(days_back int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'per_day', (SELECT jsonb_agg(jsonb_build_object('day', day, 'views', views) ORDER BY day)
                FROM (SELECT date_trunc('day', created_at)::date AS day, count(*) AS views
                      FROM <table> WHERE created_at >= now() - (days_back||' days')::interval
                      GROUP BY 1) t),
    'top_N',   (SELECT jsonb_agg(jsonb_build_object('key', k, 'cnt', c))
                FROM (SELECT <col> AS k, count(*) AS c FROM <table> WHERE ... GROUP BY 1
                      ORDER BY c DESC LIMIT 10) t),
    'totals',  (SELECT count(*) FROM <table> WHERE ...)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION admin_<thing>_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_<thing>_summary(int) TO service_role, authenticated;
```

Then in the route:
```js
const { data } = await supabase.rpc('admin_<thing>_summary', { days_back: 30 });
// data.per_day, data.top_N, data.totals — already aggregated
```

**Smell tests.**
- You wrote `rows.forEach(r => acc[r.key] = (acc[r.key]||0)+1)` after a Supabase fetch → move the GROUP BY into Postgres.
- You wrote `.limit(N)` where N > 1000 → it's a lie. Either you only want top-N (then ORDER BY first, limit ≤ 1000) or you need an RPC.
- Admin/analytics number is suspiciously smaller than `SELECT count(*) FROM <table> WHERE ...` → check for hidden truncation.

**Existing RPCs:**
- `admin_page_views_summary(days_back int)` → chart per_day, top_pages, top_referrers, views_7d/views_7d_prev, total_rows. Used by `api/admin/analytics.js`.

**Allowed `.limit(N)` cases:**
- Recent-N feeds where you genuinely only want N rows: `.order('created_at', {ascending:false}).limit(50)` for "last 50 orders" UI — fine.
- Single-row joins: `.eq('id', X).limit(1)` — fine.

**Anti-pattern (NEVER):**
```js
// ❌ Will silently truncate at ~1000
.from('page_views').select('*').gte('created_at', X).limit(10000)
```

## Admin endpoint cache rules (2026-05-24)

**Rule.** Every route under `/api/admin/*` must set `Cache-Control: no-store, max-age=0, must-revalidate` + `Pragma: no-cache` on the response, before the `res.json(...)` call.

**Why.** Admin data is per-user and live-tracking. Chrome's HTTP cache happily served the pre-fix `/api/admin/analytics` JSON to oren for 32 hours after a fix went live on 2026-05-23 because no `Cache-Control` was set. Even after the fix was correct, the user kept seeing stale numbers.

**Implementation.**
```js
res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
res.setHeader('Pragma', 'no-cache');
return res.status(200).json({...});
```

Vercel may overwrite to `public, max-age=0, must-revalidate` on its edge — that's still acceptable because `max-age=0, must-revalidate` forces revalidation on every fetch. The original `no-store` is preferred.

**NOT for:** customer-facing routes that benefit from CDN caching (`/api/cron/morning-report?type=geo`, public reads). Those keep their existing cache headers.
