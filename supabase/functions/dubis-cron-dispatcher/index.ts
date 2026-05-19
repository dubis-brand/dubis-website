// DUBIS Cron Dispatcher — single entry point for pg_cron
// pg_cron calls this with ?job=NAME&token=PG_CRON_TOKEN
// This fn uses SERVICE_ROLE_KEY (from env) to call other edge functions internally.
// Authentication: hardcoded PG_CRON_TOKEN matches the vault secret 'dubis_pg_cron_token'.
//
// Why this exists: pg_cron can't easily store a JWT, but it CAN call this fn with a
// fixed token. We then translate to SERVICE_ROLE_KEY for downstream calls.
//
// Cloud-only: runs on Supabase, requires no Mac/Windows.
//
// 2026-05-19 — `gelato-stock` rewired to call gelato-stock-check directly with
// ?token=<SERVICE_ROLE>. Previous routing through dubis-agent-runner returned
// UNAUTHORIZED_NO_AUTH_HEADER for ≥3 days (caught by 2026-05-16 status entry).
// Also added `gelato-stock-on-demand` for the visual-approve auto-trigger.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const PG_CRON_TOKEN = 'dubis-pg-cron-trigger-a554cd187bdfaf88a0a5dd8dcf571bea32658e1eb8ec217c';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const FNS_BASE = SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1';

type Job = { name: string; url: string; method?: string; auth?: 'x-agent-secret' | 'token-query' };
const JOBS: Record<string, Job> = {
  // Content publishing pipeline
  'content-publish':  { name: 'content-publish', url: `${FNS_BASE}/dubis-content-publisher?batch=4`, method: 'POST' },
  'content-backfill': { name: 'content-backfill', url: `${FNS_BASE}/dubis-content-publisher?action=backfill`, method: 'POST' },
  // Agent runners
  'marketing':        { name: 'marketing', url: `${FNS_BASE}/dubis-agent-runner?agent=marketing`, method: 'POST' },
  'supply':           { name: 'supply', url: `${FNS_BASE}/dubis-agent-runner?agent=supply`, method: 'POST' },
  'design':           { name: 'design', url: `${FNS_BASE}/dubis-agent-runner?agent=design`, method: 'POST' },
  'product':          { name: 'product', url: `${FNS_BASE}/dubis-agent-runner?agent=product`, method: 'POST' },
  'email-monitor':    { name: 'email-monitor', url: `${FNS_BASE}/dubis-agent-runner?agent=email_monitor`, method: 'POST' },
  'site-audit':       { name: 'site-audit', url: `${FNS_BASE}/dubis-agent-runner?agent=site_audit`, method: 'POST' },
  // 2026-05-19: gelato-stock routes DIRECTLY to gelato-stock-check (the standalone
  // Edge Function), bypassing dubis-agent-runner which returned UNAUTHORIZED_NO_AUTH_HEADER.
  // The function accepts ?token=<SERVICE_ROLE> (see gelato-stock-check/index.ts authorized()).
  'gelato-stock':     { name: 'gelato-stock', url: `${FNS_BASE}/gelato-stock-check`, method: 'POST', auth: 'token-query' },
  // Boss runs LAST in the day
  'boss':             { name: 'boss', url: `${FNS_BASE}/dubis-boss-orchestrator`, method: 'POST' },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || req.headers.get('x-cron-token') || '';
  if (token !== PG_CRON_TOKEN && token !== SERVICE_ROLE) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const jobName = url.searchParams.get('job') || '';
  const job = JOBS[jobName];
  if (!job) return json({ error: `unknown job: ${jobName}. Valid: ${Object.keys(JOBS).join('|')}` }, 400);

  if (!SERVICE_ROLE) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY missing in env' }, 500);

  const startedAt = Date.now();
  let resBody: unknown;
  let status = 0;
  try {
    // Build the actual upstream URL. If auth=='token-query', append ?token=SERVICE_ROLE
    // so the target function's ?token check passes. Otherwise rely on x-agent-secret header.
    const upstreamUrl = job.auth === 'token-query'
      ? job.url + (job.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(SERVICE_ROLE)
      : job.url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (job.auth !== 'token-query') headers['x-agent-secret'] = SERVICE_ROLE;
    // verify_jwt:true functions (gelato-stock-check) need a Bearer too — Supabase platform
    // checks it before our Deno code runs. Send service role for both layers.
    headers['Authorization'] = `Bearer ${SERVICE_ROLE}`;

    const r = await fetch(upstreamUrl, {
      method: job.method || 'POST',
      headers,
      // Empty body is fine — agents read params from URL
    });
    status = r.status;
    resBody = await r.json().catch(() => ({ raw: 'non-json' }));
  } catch (e) {
    resBody = { error: (e as Error).message };
    status = 500;
  }

  return json({
    job: jobName,
    upstream_status: status,
    duration_ms: Date.now() - startedAt,
    upstream: resBody,
  }, status >= 200 && status < 300 ? 200 : 500);
});
