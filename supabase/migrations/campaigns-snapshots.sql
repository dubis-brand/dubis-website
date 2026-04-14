-- DUBIS — Migration: ad_campaigns + daily_snapshots
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/ntzwvqtpdmvvavbhuyeb/sql/new
-- Created: 2026-03-28

-- ══════════════════════════════════════════════════════════
-- TABLE: ad_campaigns
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  platform         text        NOT NULL,          -- 'instagram', 'facebook', 'instagram+facebook', 'google'
  goal             text        NOT NULL,          -- 'website_visits', 'reach', 'engagement', 'sales'
  budget           numeric     NOT NULL,
  budget_currency  text        NOT NULL DEFAULT 'ILS',
  duration_days    int         NOT NULL,
  audience         text,                          -- targeting description
  status           text        NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'paused'
  start_date       date        NOT NULL,
  end_date         date,                          -- auto-computed or manual
  spend_to_date    numeric     DEFAULT 0,
  clicks           int         DEFAULT 0,
  impressions      int         DEFAULT 0,
  payment_method   text,                          -- e.g. 'MasterCard 9830'
  notes            text,
  created_at       timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════════════
-- TABLE: daily_snapshots
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date          date        NOT NULL UNIQUE,
  revenue_usd            numeric     DEFAULT 0,
  orders_count           int         DEFAULT 0,   -- total all time
  orders_today           int         DEFAULT 0,   -- orders in last 24h
  active_campaigns       int         DEFAULT 0,
  campaigns_spend_total  numeric     DEFAULT 0,   -- ILS
  agent_runs_yesterday   int         DEFAULT 0,
  agent_runs_errors      int         DEFAULT 0,
  page_views_today       int         DEFAULT 0,
  subscribers_total      int         DEFAULT 0,
  active_orders          int         DEFAULT 0,   -- pending + in_production
  shipped_orders         int         DEFAULT 0,
  raw_data               jsonb,                   -- full snapshot JSON for debugging
  created_at             timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════
ALTER TABLE ad_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_snapshots ENABLE ROW LEVEL SECURITY;

-- service_role can do everything (used by API)
CREATE POLICY "service_all_campaigns"    ON ad_campaigns    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_snapshots"    ON daily_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated admins can read
CREATE POLICY "auth_read_campaigns"      ON ad_campaigns    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_snapshots"      ON daily_snapshots FOR SELECT TO authenticated USING (true);

-- authenticated admins can insert/update (admin.html calls with user token)
CREATE POLICY "auth_write_campaigns"     ON ad_campaigns    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_campaigns"    ON ad_campaigns    FOR UPDATE TO authenticated USING (true);

-- ══════════════════════════════════════════════════════════
-- SEED: Current active campaign (March 2026)
-- ══════════════════════════════════════════════════════════
INSERT INTO ad_campaigns (platform, goal, budget, budget_currency, duration_days, audience, status, start_date, end_date, spend_to_date, payment_method, notes)
VALUES (
  'instagram+facebook',
  'website_visits',
  78,
  'ILS',
  6,
  'People similar to followers',
  'active',
  '2026-03-28',
  '2026-04-03',
  0,
  'MasterCard 9830',
  'קמפיין ראשון — Website visits ל-dubis.net. Instagram + Facebook.'
)
ON CONFLICT DO NOTHING;
