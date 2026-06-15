-- ────────────────────────────────────────────────────────────────────────
-- security_scans — results sink for the CODE+SITE security scan GitHub Action
-- (.github/workflows/dubis-security-scan.yml). Created 2026-06-15.
--
-- WHY: the `security` Edge-Function agent only checks LIVE infra (headers / RLS /
-- keys) and CANNOT read repo source code (an edge function has no git checkout).
-- The repo `dubis-brand/dubis-website` is PUBLIC, so secret-leak + dependency +
-- static-analysis scanning matters on every change. The GHA scans the code +
-- site and writes the outcome here so the Boss report can render REAL numbers
-- instead of the "0 ממצאים" live-infra boilerplate.
--
-- NOTE: the GHA report script (scripts/security-scan-report.js) ALSO writes an
-- `agent_runs` row (agent_id='security') so the existing Boss `opinionSecurity`
-- reader picks it up with zero orchestrator changes. This table is the clean,
-- queryable home for the detail. Both writes are idempotent-safe.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_scans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  git_sha            TEXT,
  git_ref            TEXT,
  trigger            TEXT,                       -- push | pull_request | schedule | workflow_dispatch
  gha_run_url        TEXT,

  -- 1. secret scan (gitleaks over full history)
  secrets_found      INT  NOT NULL DEFAULT 0,
  secrets_tool       TEXT,                       -- e.g. "gitleaks v8.x"

  -- 2. dependency audit (npm audit)
  npm_critical       INT  NOT NULL DEFAULT 0,
  npm_high           INT  NOT NULL DEFAULT 0,
  npm_moderate       INT  NOT NULL DEFAULT 0,
  npm_low            INT  NOT NULL DEFAULT 0,

  -- 3. static analysis (semgrep p/javascript + p/secrets)
  sast_findings      INT  NOT NULL DEFAULT 0,
  sast_tool          TEXT,                       -- e.g. "semgrep 1.x"

  -- 4. live site header check (mirrors the live agent)
  headers_ok         BOOLEAN,
  headers_missing    TEXT[],                     -- names of any missing security headers

  -- rollup
  issues_count       INT  NOT NULL DEFAULT 0,    -- total real findings across 1-4
  passed             BOOLEAN NOT NULL DEFAULT TRUE,
  details            JSONB,                       -- per-tool raw counts + first N finding samples
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_scans_scanned_at ON public.security_scans (scanned_at DESC);

ALTER TABLE public.security_scans ENABLE ROW LEVEL SECURITY;

-- service_role (the GHA writer + any cron reader) gets everything.
DROP POLICY IF EXISTS service_role_all_security_scans ON public.security_scans;
CREATE POLICY service_role_all_security_scans ON public.security_scans
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- admins can read in the dashboard.
DROP POLICY IF EXISTS admin_read_security_scans ON public.security_scans;
CREATE POLICY admin_read_security_scans ON public.security_scans
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- anon gets NOTHING (no grant). Per the 2026-05-13 data-API hardening template.
REVOKE ALL ON public.security_scans FROM anon;
GRANT ALL ON public.security_scans TO service_role;
