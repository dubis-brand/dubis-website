-- DUBIS — Migration: Attribution tracking + campaign daily metrics
-- Created: 2026-05-06
-- Purpose: After Hila/blind-test feedback + IL campaign launch, we need to know
-- which campaign / channel / post brought each order. Without UTMs persisted to
-- the orders row, ROAS is a guessing game (see DUBIS_STATUS_SUMMARY_2026-05-06.html).
--
-- Run via Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ntzwvqtpdmvvavbhuyeb/sql/new
-- Idempotent — safe to re-run.

-- ══════════════════════════════════════════════════════════
-- 1. orders — attribution columns
-- ══════════════════════════════════════════════════════════
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_source        text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_medium        text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign      text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_content       text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_term          text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution_session_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS landing_path      text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS landing_referrer  text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution_first_touch_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_utm_campaign ON orders (utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_utm_source   ON orders (utm_source)   WHERE utm_source   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_attr_session ON orders (attribution_session_id) WHERE attribution_session_id IS NOT NULL;

COMMENT ON COLUMN orders.utm_source              IS 'First-touch utm_source captured on landing (fb / ig / google / oren_personal / direct)';
COMMENT ON COLUMN orders.utm_medium              IS 'First-touch utm_medium (paid / organic / social / email)';
COMMENT ON COLUMN orders.utm_campaign            IS 'First-touch utm_campaign (e.g. il_w1, us_w3, oren_launch_post)';
COMMENT ON COLUMN orders.utm_content              IS 'Creative variant identifier (e.g. ad_1_women, post_v2)';
COMMENT ON COLUMN orders.utm_term                IS 'Optional keyword / audience identifier';
COMMENT ON COLUMN orders.attribution_session_id  IS 'sessionStorage dubis-sid that captured the first-touch — enables linking to page_views';
COMMENT ON COLUMN orders.landing_path            IS 'First page path the buyer landed on (e.g. /#product-7)';
COMMENT ON COLUMN orders.landing_referrer        IS 'document.referrer at first touch';
COMMENT ON COLUMN orders.attribution_first_touch_at IS 'When the buyer first hit the site in this attribution window';

-- ══════════════════════════════════════════════════════════
-- 2. page_views — UTM columns (so analytics can group by campaign too)
-- ══════════════════════════════════════════════════════════
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_source   text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_medium   text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_campaign text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_content  text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_term     text;

CREATE INDEX IF NOT EXISTS idx_page_views_utm_campaign ON page_views (utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_views_session_created ON page_views (session_id, created_at);

-- ══════════════════════════════════════════════════════════
-- 3. campaign_daily_metrics — what Boss agent fills every morning from Meta API
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS campaign_daily_metrics (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_date       date        NOT NULL,
  platform          text        NOT NULL,                 -- 'meta', 'google', 'tiktok', 'organic'
  campaign_id       text        NOT NULL,                 -- Meta campaign id or slug like 'oren_personal_post_2026-05-06'
  campaign_name     text,
  spend_usd         numeric     DEFAULT 0,
  impressions       int         DEFAULT 0,
  reach             int         DEFAULT 0,
  clicks            int         DEFAULT 0,
  link_clicks       int         DEFAULT 0,
  ctr               numeric     DEFAULT 0,
  cpc_usd           numeric     DEFAULT 0,
  page_engagement   int         DEFAULT 0,
  reactions         int         DEFAULT 0,
  comments          int         DEFAULT 0,
  shares            int         DEFAULT 0,
  saves             int         DEFAULT 0,
  attributed_orders int         DEFAULT 0,                -- orders WHERE utm_campaign matches AND placed today
  attributed_revenue_usd numeric DEFAULT 0,
  roas              numeric     DEFAULT 0,                -- attributed_revenue / spend
  status            text,                                 -- 'active', 'paused', 'pending_review', 'rejected'
  raw_payload       jsonb,                                -- whole Meta API response for audit
  created_at        timestamptz DEFAULT now(),
  UNIQUE (metric_date, platform, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_daily_date     ON campaign_daily_metrics (metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_daily_campaign ON campaign_daily_metrics (campaign_id, metric_date DESC);

ALTER TABLE campaign_daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_daily_metrics_admin_read" ON campaign_daily_metrics;
CREATE POLICY "campaign_daily_metrics_admin_read"
  ON campaign_daily_metrics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Service role bypasses RLS — Boss agent writes via service key

-- ══════════════════════════════════════════════════════════
-- 4. View: campaign_attribution_summary — last-30-day rollup with attributed orders
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW campaign_attribution_summary AS
SELECT
  COALESCE(o.utm_campaign, '(direct)')                            AS campaign,
  COALESCE(o.utm_source,   '(direct)')                            AS source,
  COALESCE(o.utm_medium,   '(direct)')                            AS medium,
  COUNT(*)                                                        AS orders_count,
  SUM(o.total_amount)                                             AS revenue_usd,
  AVG(o.total_amount)                                             AS aov_usd,
  MIN(o.created_at)                                               AS first_order_at,
  MAX(o.created_at)                                               AS last_order_at
FROM orders o
WHERE o.created_at > now() - interval '30 days'
  AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY 1, 2, 3
ORDER BY revenue_usd DESC NULLS LAST;

COMMENT ON VIEW campaign_attribution_summary IS
  'Last 30 days of orders grouped by campaign — single source of truth for attribution. Use in admin dashboard + Boss daily report.';

-- ══════════════════════════════════════════════════════════
-- 5. Helper: link page_views events to first-touch UTMs by session_id
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW session_first_touch AS
SELECT DISTINCT ON (session_id)
  session_id,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  utm_term,
  path           AS landing_path,
  referrer       AS landing_referrer,
  country_code,
  created_at     AS first_touch_at
FROM page_views
WHERE session_id IS NOT NULL
  AND is_internal = false
ORDER BY session_id, created_at ASC;

COMMENT ON VIEW session_first_touch IS
  'First page_view per session_id, with attribution metadata. Used to backfill orders.attribution_* if frontend snapshot was missing.';

-- ══════════════════════════════════════════════════════════
-- DONE. Verification queries (run after migration):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='orders' AND column_name LIKE 'utm%' OR column_name LIKE 'attribution%';
--   SELECT * FROM campaign_attribution_summary LIMIT 10;
--   SELECT count(*) FROM campaign_daily_metrics;
-- ══════════════════════════════════════════════════════════
