// DUBIS Run All — invokes all 12 cloud-native agents in parallel
// Bookmarklet target: replaces the broken "הרץ סוכנים" button on /admin
// Auth: SERVICE_ROLE_KEY OR PG_CRON_TOKEN
//
// 2026-06 service-role rotation: this fn is called by api/cron/morning-report.js
// (?type=auto-run, L766) with the service-role key on the Authorization header — an
// EXTERNAL caller. So unlike the in-repo 6 functions (which only see the key from
// internal edge→edge callers deployed together), this one must ACCEPT BOTH the new
// sb_secret 'dubissecretkey' AND the legacy service_role JWT during the transition, so
// the twice-daily auto-run never 401s in the window between deploy and the Vercel env
// update. SERVICE_ROLE (preferred = dubissecretkey) is used for the DB client + outbound.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SECRET_KEYS = (() => {
  const s = new Set<string>();
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) s.add(k as string); } catch { /* not migrated yet */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (legacy) s.add(legacy);
  return s;
})();
const SERVICE_ROLE = [...SECRET_KEYS][0] ?? '';   // prefer dubissecretkey for DB client + outbound calls
const PG_CRON_TOKEN = 'dubis-pg-cron-trigger-a554cd187bdfaf88a0a5dd8dcf571bea32658e1eb8ec217c';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-cron-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const tok = url.searchParams.get('token') || req.headers.get('x-cron-token') || (req.headers.get('authorization') || '').replace('Bearer ', '').trim();

  // Allow either the PG_CRON_TOKEN (open shared), any active service-role key
  // (legacy JWT OR new sb_secret 'dubissecretkey'), or a valid Supabase user JWT (admin)
  let isAuthed = tok === PG_CRON_TOKEN || SECRET_KEYS.has(tok);
  if (!isAuthed && tok) {
    // Try as Supabase JWT — verify it's a valid logged-in user
    try {
      const sbCheck = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: { user } } = await sbCheck.auth.getUser(tok);
      if (user && user.email) {
        const adminEmails = (Deno.env.get('ADMIN_EMAILS') || 'dubis.brand@gmail.com,teharlev1976@gmail.com').split(',').map(s => s.trim().toLowerCase());
        if (adminEmails.includes(user.email.toLowerCase())) isAuthed = true;
      }
    } catch (_) {}
  }
  if (!isAuthed) return new Response(JSON.stringify({ error: 'Unauthorized', hint: 'pass ?token=PG_CRON_TOKEN or admin JWT' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const FNS = SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1';
  const cloudJobs = ['email-monitor', 'site-audit', 'product', 'marketing', 'supply', 'design', 'gelato-stock'];
  const results: Record<string, unknown>[] = [];

  // Run all 7 cloud agents in parallel via cron-dispatcher
  const promises = cloudJobs.map(async (job) => {
    try {
      const r = await fetch(`${FNS}/dubis-cron-dispatcher?job=${job}&token=${PG_CRON_TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await r.json();
      return { job, ok: r.ok, ...data };
    } catch (e) { return { job, ok: false, error: (e as Error).message }; }
  });

  // Plus content publish (atomic-claim)
  const publishPromise = fetch(`${FNS}/dubis-content-publisher?batch=4`, {
    method: 'POST', headers: { 'x-agent-secret': SERVICE_ROLE, 'Content-Type': 'application/json' }
  }).then(r => r.json()).then(d => ({ job: 'content-publish', ok: true, ...d })).catch(e => ({ job: 'content-publish', ok: false, error: (e as Error).message }));

  const all = await Promise.all([...promises, publishPromise]);
  results.push(...all);

  const ok = all.filter(r => r.ok !== false).length;
  const queued = all.reduce((s, r) => {
    const u = (r as Record<string, unknown>).upstream as Record<string, unknown> | undefined;
    return s + Number(u?.tasks_created || u?.published || u?.checked || u?.saved || (r as Record<string, unknown>).published || 0);
  }, 0);

  // Log to agent_runs as 'admin_run'
  try {
    await sb.from('agent_runs').insert({
      agent_id: 'admin_run', run_date: new Date().toISOString().slice(0, 10), status: 'completed',
      summary: `הרץ סוכנים: ${ok}/${all.length} הצליחו, ${queued} משימות עובדו`,
      tasks_created: queued, side_effects: { results: all, source: 'admin_button_or_bookmarklet' },
    });
  } catch (_) {}

  return new Response(JSON.stringify({
    ok: true, queued, agents_run: all.length, agents_success: ok,
    summary: `✅ ${ok}/${all.length} סוכנים רצו בהצלחה. ${queued} משימות עובדו.`,
    results: all,
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
});
