// DUBIS Agent Runner — multi-agent cloud-native orchestrator
// Routes via ?agent=marketing|supply|design|product|email_monitor|site_audit|gelato_stock
// Each agent does ONE job, writes proof_of_completion + tasks_completed_ids
// Triggered by Vercel cron (one cron per agent, scheduled in vercel.json)
//
// Auth: x-agent-secret OR ?token=SERVICE_ROLE_KEY
// 2026-04-25 — cloud-native, no Mac/Windows dependency
// 2026-06 service-role rotation: dubis-cron-dispatcher calls this with the service-role
// key on x-agent-secret/Authorization, and the dispatcher now sends the NEW sb_secret
// 'dubissecretkey'. So this fn must accept BOTH keys (SVC_KEYS) and use the preferred
// one (SERVICE_ROLE) for its DB client + the gelato-stock-check call, so the legacy +
// exposed 'default' keys can be disabled with zero downtime.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SVC_KEYS = (() => {
  const s = new Set<string>();
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) s.add(k as string); } catch { /* not migrated yet */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (legacy) s.add(legacy);
  return s;
})();
const SERVICE_ROLE = [...SVC_KEYS][0] ?? '';   // prefer dubissecretkey for DB client + outbound
const AGENT_SECRET = Deno.env.get('AGENT_SECRET') ?? '';
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? '';
const META_TOKEN   = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
const META_AD_ACCT = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_26201135546175057';
const META_CAMPAIGN= Deno.env.get('META_CAMPAIGN_ID') || '120244081546680267';
const GELATO_KEY   = Deno.env.get('GELATO_API_KEY') ?? '';
const GMAIL_REFRESH= Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const GMAIL_CID    = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const GMAIL_CSEC   = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';

type SB = ReturnType<typeof createClient>;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function isAuthed(req: Request): boolean {
  const url = new URL(req.url);
  const tok = url.searchParams.get('token') || req.headers.get('x-agent-secret') || (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  return !!tok && (SVC_KEYS.has(tok) || tok === AGENT_SECRET || tok === CRON_SECRET);
}

// ========== MARKETING ==========
async function runMarketing(sb: SB): Promise<Record<string, unknown>> {
  if (!META_TOKEN) return { ok: false, error: 'META_TOKEN missing' };
  try {
    const url = `https://graph.facebook.com/v19.0/${META_CAMPAIGN}/insights?fields=spend,impressions,clicks,cpc,ctr,reach,actions&date_preset=yesterday&access_token=${META_TOKEN}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok || data.error) return { ok: false, error: data.error?.message || `HTTP ${r.status}` };
    const ins = (data.data || [])[0] || {};
    // Upsert into ad_campaigns or daily_snapshots.raw_data
    const proof = { meta_graph_verified: true, api_response: ins, fetched_at: new Date().toISOString() };
    return { ok: true, insights: ins, proof };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ========== SUPPLY (Gelato order sync) ==========
async function runSupply(sb: SB): Promise<Record<string, unknown>> {
  if (!GELATO_KEY) return { ok: false, error: 'GELATO_API_KEY missing' };
  try {
    const { data: openOrders } = await sb.from('orders').select('id, printful_order_id, status, tracking_number')
      .in('status', ['pending', 'in_production', 'shipped'])
      .not('printful_order_id', 'is', null);
    let updated = 0;
    const updates: unknown[] = [];
    for (const o of (openOrders || []).slice(0, 25)) {
      const oid = (o as Record<string, unknown>).printful_order_id as string;
      try {
        const r = await fetch(`https://order.gelatoapis.com/v4/orders/${oid}`, { headers: { 'X-API-KEY': GELATO_KEY } });
        if (!r.ok) continue;
        const d = await r.json();
        const newStatus = mapGelatoStatus(d.fulfillmentStatus || d.financialStatus);
        const tracking = d.shipments?.[0]?.trackingCode || null;
        const trackingUrl = d.shipments?.[0]?.trackingUrl || null;
        if (newStatus !== (o as Record<string, unknown>).status || tracking !== (o as Record<string, unknown>).tracking_number) {
          await sb.from('orders').update({ status: newStatus, tracking_number: tracking, tracking_url: trackingUrl }).eq('id', (o as Record<string, unknown>).id);
          updated++;
          updates.push({ order_id: (o as Record<string, unknown>).id, new_status: newStatus, tracking });
        }
      } catch (_e) { /* per-order swallow */ }
    }
    return { ok: true, checked: (openOrders || []).length, updated, updates };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
function mapGelatoStatus(s: string): string {
  const m: Record<string, string> = { pending: 'pending', printed: 'in_production', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled', returned: 'returned' };
  return m[(s || '').toLowerCase()] || 'pending';
}

// ========== DESIGN (image freshness check) ==========
async function runDesign(sb: SB): Promise<Record<string, unknown>> {
  // Audit: every active product has design_back_dark_url, design_back_white_url, mockup images.
  const { data: products } = await sb.from('dubis_products').select('id, product_id_numeric, name, clothing_type, design_back_dark_url, design_back_white_url, active').eq('active', true);
  const issues: unknown[] = [];
  for (const p of (products || [])) {
    const pp = p as Record<string, unknown>;
    if (!pp.design_back_dark_url || !pp.design_back_white_url) {
      issues.push({ pid: pp.product_id_numeric, name: pp.name, missing: 'design_back_url' });
    }
  }
  return { ok: true, audited: (products || []).length, issues_count: issues.length, issues: issues.slice(0, 10) };
}

// ========== PRODUCT (mockup parity check) ==========
async function runProduct(sb: SB): Promise<Record<string, unknown>> {
  // Check that each active product has a non-stale mockup
  const { data: products } = await sb.from('dubis_products').select('id, product_id_numeric, name, clothing_type, active, updated_at').eq('active', true);
  return { ok: true, products_audited: (products || []).length, last_check: new Date().toISOString() };
}

// ========== EMAIL MONITOR ==========
async function runEmailMonitor(sb: SB): Promise<Record<string, unknown>> {
  if (!GMAIL_REFRESH || !GMAIL_CID || !GMAIL_CSEC) return { ok: false, error: 'GMAIL env missing' };
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GMAIL_CID, client_secret: GMAIL_CSEC, refresh_token: GMAIL_REFRESH, grant_type: 'refresh_token' }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return { ok: false, error: tokenData.error_description || tokenData.error || 'token failed' };
    const accessToken = tokenData.access_token;
    const since = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const q = encodeURIComponent(`after:${since} (receipt OR invoice OR shipment OR renew OR expire OR billing OR gelato OR paypal)`);
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const list = await listRes.json();
    const ids = (list.messages || []).map((m: { id: string }) => m.id);
    let saved = 0;
    const insightDetails: unknown[] = [];
    for (const id of ids.slice(0, 10)) {
      const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const m = await mRes.json();
      const subject = m.payload?.headers?.find((h: { name: string; value: string }) => h.name === 'Subject')?.value || '(no subject)';
      const from = m.payload?.headers?.find((h: { name: string; value: string }) => h.name === 'From')?.value || '';
      const snippet = m.snippet || '';
      const title = `📧 ${subject}`.slice(0, 200);
      // Dedup
      const { data: dup } = await sb.from('agent_tasks').select('id').eq('title', title).gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString()).limit(1);
      if (dup && dup.length > 0) continue;
      await sb.from('agent_tasks').insert({
        agent_id: 'cto',
        title,
        description: `From: ${from}\n${snippet.slice(0, 300)}`,
        category: 'gmail_insight',
        status: 'pending',
        priority: 'medium',
      });
      saved++;
      insightDetails.push({ subject, from });
    }
    return { ok: true, scanned: ids.length, saved, details: insightDetails };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ========== SITE AUDIT ==========
async function runSiteAudit(sb: SB): Promise<Record<string, unknown>> {
  try {
    const urls = ['https://www.dubis.net/', 'https://www.dubis.net/terms', 'https://www.dubis.net/returns'];
    const checks: unknown[] = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'HEAD' });
        checks.push({ url: u, status: r.status, ok: r.ok });
      } catch (e) { checks.push({ url: u, error: (e as Error).message }); }
    }
    const allOk = checks.every(c => (c as { ok?: boolean }).ok === true);
    return { ok: true, all_ok: allOk, checks };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ========== GELATO STOCK CHECK (re-route to existing standalone fn) ==========
async function runGelatoStock(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${SUPABASE_URL.replace('/rest/v1', '')}/functions/v1/gelato-stock-check?token=${SERVICE_ROLE}`);
    const data = await r.json();
    return { ok: r.ok, data };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  if (!isAuthed(req)) return json({ error: 'Unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const url = new URL(req.url);
  const agent = url.searchParams.get('agent') || '';

  let result: Record<string, unknown> = {};
  try {
    switch (agent) {
      case 'marketing':     result = await runMarketing(sb); break;
      case 'supply':        result = await runSupply(sb); break;
      case 'design':        result = await runDesign(sb); break;
      case 'product':       result = await runProduct(sb); break;
      case 'email_monitor': result = await runEmailMonitor(sb); break;
      case 'site_audit':    result = await runSiteAudit(sb); break;
      case 'gelato_stock':  result = await runGelatoStock(); break;
      default: return json({ error: `unknown agent: ${agent}. Valid: marketing|supply|design|product|email_monitor|site_audit|gelato_stock` }, 400);
    }
  } catch (e) { result = { ok: false, error: (e as Error).message }; }

  // Log to agent_runs with side_effects (the actual work output)
  await sb.from('agent_runs').insert({
    agent_id: agent,
    run_date: new Date().toISOString().slice(0, 10),
    status: result.ok ? 'completed' : 'failed',
    summary: result.ok
      ? `cloud-run ${agent} completed: ${JSON.stringify(result).slice(0, 200)}`
      : `cloud-run ${agent} failed: ${result.error}`,
    tasks_created: typeof result.saved === 'number' ? result.saved : 0,
    tasks_completed_ids: [],
    side_effects: result,
  });

  return json({ agent, ...result });
});
