-- ============================================================
-- DUBIS Agent System — Database Migration
-- Version: 1.0 | Date: March 2026
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. agent_tasks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  agent_id      TEXT NOT NULL,
  -- values: 'boss' | 'cto' | 'marketing' | 'content' | 'design'
  --         'supply' | 'email_monitor' | 'site_audit' | 'manual'
  status        TEXT NOT NULL DEFAULT 'backlog',
  -- values: 'backlog' | 'in_progress' | 'pending_approval'
  --         'approved' | 'done' | 'rejected'
  priority      TEXT NOT NULL DEFAULT 'medium',
  -- values: 'critical' | 'high' | 'medium' | 'low'
  category      TEXT,
  -- values: 'site' | 'content' | 'email' | 'marketing' | 'technical' | 'supply'
  content_data  JSONB DEFAULT '{}'::jsonb,
  -- flexible: post content, image URLs, email details, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at   TIMESTAMPTZ,
  due_date      TIMESTAMPTZ,
  notes         TEXT,

  CONSTRAINT valid_status   CHECK (status   IN ('backlog','in_progress','pending_approval','approved','done','rejected')),
  CONSTRAINT valid_priority CHECK (priority IN ('critical','high','medium','low')),
  CONSTRAINT valid_agent    CHECK (agent_id IN ('boss','cto','marketing','content','design','supply','email_monitor','site_audit','manual'))
);

-- ── 2. agent_runs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       TEXT NOT NULL,
  run_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status         TEXT NOT NULL DEFAULT 'running',
  -- values: 'running' | 'completed' | 'failed'
  summary        TEXT,
  tasks_created  INT NOT NULL DEFAULT 0,
  duration_ms    INT,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_run_status CHECK (status IN ('running','completed','failed'))
);

-- ── 3. Auto-update updated_at ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status    ON agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_id  ON agent_tasks (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_priority  ON agent_tasks (priority);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created   ON agent_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_date       ON agent_runs  (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent      ON agent_runs  (agent_id);

-- ── 5. RLS ───────────────────────────────────────────────────
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs  ENABLE ROW LEVEL SECURITY;

-- Agents (service role) can do everything
CREATE POLICY "service_role_all_tasks" ON agent_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_runs" ON agent_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin users (authenticated, role=admin) can read+write
CREATE POLICY "admin_read_tasks" ON agent_tasks
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin_write_tasks" ON agent_tasks
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "admin_read_runs" ON agent_runs
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── 6. Seed: Initial Backlog from existing planning ──────────
INSERT INTO agent_tasks (title, description, agent_id, status, priority, category) VALUES
  ('חיבור Printful ל-API', 'להחליף את הsimulator הנוכחי בחיבור אמיתי ל-Printful print-on-demand', 'cto', 'backlog', 'critical', 'technical'),
  ('פתיחת חשבון Instagram עסקי', 'לשדרג את @dubis.brand ל-Business Account ולחבר ל-Meta Business Suite', 'marketing', 'backlog', 'high', 'marketing'),
  ('10 פוסטים ראשונים לאינסטגרם', 'פוסטים ראשונים מוכנים לאישור — עברית + אנגלית', 'content', 'backlog', 'high', 'content'),
  ('SEO — מחקר מילות מפתח', 'לבצע מחקר מילות מפתח לשוק הישראלי ולשוק האנגלי', 'marketing', 'backlog', 'medium', 'marketing'),
  ('Email marketing — רשימת תפוצה', 'להוסיף popup לאיסוף מיילים + לבחור כלי email marketing', 'cto', 'backlog', 'medium', 'marketing'),
  ('Google Shopping feed', 'לחבר products feed ל-Google Merchant Center', 'cto', 'backlog', 'medium', 'technical'),
  ('Reel ראשון לאינסטגרם', 'ליצור reel מוצרי עם אווטר אנושי', 'content', 'backlog', 'high', 'content'),
  ('ביקורות לקוחות — social proof', 'להוסיף סקשן ביקורות לקוחות לדף הבית', 'cto', 'backlog', 'medium', 'site'),
  ('קמפיין ממומן ראשון בפייסבוק', 'להגדיר קמפיין awareness ראשון עם $100 תקציב', 'marketing', 'backlog', 'high', 'marketing'),
  ('TikTok — פתיחה ותוכן ראשון', 'להפעיל את חשבון TikTok ולצור 3 סרטונים ראשונים', 'content', 'backlog', 'medium', 'content'),
  ('אינטגרציית Stripe כגיבוי', 'להוסיף Stripe כאפשרות תשלום נוספת מלבד PayPal', 'cto', 'backlog', 'low', 'technical')
ON CONFLICT DO NOTHING;

-- ── 7. Verify ────────────────────────────────────────────────
SELECT 'agent_tasks created: ' || COUNT(*)::TEXT FROM agent_tasks;
