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
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? '';

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
// 2026-06-20 REWRITE (oren ask). The old monitor triaged the inbox for vendor
// noise (receipts/invoices/gelato/paypal) and saved metadata-only tasks that
// got auto-rejected — every row since 2026-05-17 was junk. Oren's real need:
// he forwards/sends emails about ideas he sees in WhatsApp/Facebook groups and
// expects the agent to READ them deeply and RECOMMEND what to do in DUBIS's
// context. So this now:
//   1. Prioritizes mail FROM oren/hila + mail addressed TO the brand inbox.
//   2. Denylists vendor/transactional noise (Meta/GoDaddy/Vercel/Supabase/
//      Gelato-automated/PayPal-receipts/newsletters/self-ingested DUBIS reports).
//   3. Reads the FULL body, extracts URLs.
//   4. Gemini-analyzes each signal email into a 4-part Hebrew recommendation:
//      מה הרעיון → איך זה מתחבר ל-DUBIS → ההמלצה שלי → צעד מוצע.
//   5. Writes agent_tasks (category='gmail_insight') in the shape the Boss
//      daily-report fetchEmailDigest reads (title="📧 {subject}",
//      description="From: …\n…"), PLUS the structured analysis in content_data
//      so the digest can surface the recommendation verbatim.
// Still writes the agent_runs row (in Deno.serve) so the Boss staleness check
// stays green.

// Signal senders — these are the people whose mail is the whole point.
const EMAIL_SIGNAL_SENDERS = [
  'teharlev1976@gmail.com',
  'hilateharlev@gmail.com',
  'steharlev@gmail.com',
];
// Vendor / transactional / self-ingest denylist. Matched against "From + Subject".
const EMAIL_DENY_RX = /(noreply|no-reply|donotreply|do-not-reply|notifications?@|automated|mailer-daemon|postmaster)/i;
const EMAIL_DENY_DOMAIN_RX = /@(facebookmail\.com|facebook\.com|meta\.com|business\.facebook|godaddy\.com|secureserver\.net|vercel\.com|supabase\.io|supabase\.com|gelato(apis)?\.com|paypal\.com|intuit\.com|mailchimp|sendgrid|substack\.com|resend\.(dev|com)|google\.com|accounts\.google)/i;
const EMAIL_DENY_SUBJECT_RX = /(receipt|invoice|payment (received|sent|confirmation)|your order|renewal|auto-?renew|expire|billing|statement|unsubscribe|newsletter|webinar|grow your business|run your business|growth tips|% off|black friday|cyber monday|holiday sale|verify your|security alert|sign-?in|password|deploy(ed|ment)|build (failed|succeeded)|usage|quota)/i;
// Self-ingest: our own daily/weekly reports bouncing back into the inbox.
const EMAIL_SELF_RX = /(DUBIS\s*דוח|DUBIS\s*פגישה|דוח יומי|פגישה שבועית|daily report|weekly report|boss agent|orders@dubis\.net)/i;

function isSignalEmail(from: string, subject: string): boolean {
  const f = from.toLowerCase();
  const s = `${from} ${subject}`;
  // Self-ingested reports are always noise.
  if (EMAIL_SELF_RX.test(s)) return false;
  // Mail FROM oren/hila is always signal (overrides denylists — he forwards a
  // vendor email on purpose to ask "what do we do with this").
  if (EMAIL_SIGNAL_SENDERS.some(addr => f.includes(addr))) return true;
  // Otherwise apply the vendor/transactional denylists.
  if (EMAIL_DENY_RX.test(f)) return false;
  if (EMAIL_DENY_DOMAIN_RX.test(f)) return false;
  if (EMAIL_DENY_SUBJECT_RX.test(subject)) return false;
  // Anything else addressed to the brand inbox by a human → treat as signal.
  return true;
}

// Recursively pull text/plain (preferred) or text/html out of a Gmail payload.
function extractBodyFromPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const decode = (data: string): string => {
    try {
      const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch { return ''; }
  };
  const stripHtml = (html: string): string =>
    html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();

  let plain = '';
  let html = '';
  const walk = (p: Record<string, unknown> | undefined) => {
    if (!p) return;
    const mime = String(p.mimeType || '');
    const body = p.body as Record<string, unknown> | undefined;
    const data = body?.data as string | undefined;
    if (mime === 'text/plain' && data) plain += decode(data) + '\n';
    else if (mime === 'text/html' && data) html += decode(data) + '\n';
    const parts = p.parts as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(parts)) for (const child of parts) walk(child);
  };
  walk(payload);
  const text = (plain.trim() || stripHtml(html)).trim();
  return text;
}

function extractUrls(text: string): string[] {
  const rx = /https?:\/\/[^\s"'<>)\]]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(rx)) {
    let u = m[0].replace(/[.,;)]+$/, '');
    // Drop tracking / unsubscribe / vendor pixel links — they're not the idea.
    if (/(unsubscribe|utm_|\/track|\/open|pixel|googleusercontent|fbcdn|mailchimp|list-manage|safelinks)/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 5) break;
  }
  return out;
}

// Best-effort fetch of a URL → page title + first meaningful paragraph.
async function fetchUrlContext(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (DUBIS-EmailMonitor)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain/i.test(ct)) return '';
    const html = (await r.text()).slice(0, 200000);
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogM = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    const desc = ogM ? ogM[1].replace(/\s+/g, ' ').trim().slice(0, 280) : '';
    const combined = [title, desc].filter(Boolean).join(' — ');
    return combined.slice(0, 360);
  } catch { return ''; }
}

// Gemini → 4-part Hebrew recommendation in DUBIS context.
async function analyzeIdeaEmail(
  subject: string, from: string, body: string, urlContexts: Array<{ url: string; ctx: string }>,
): Promise<{ idea: string; relevance: string; recommendation: string; next_step: string; agent: string } | null> {
  if (!GEMINI_KEY) return null;
  const urlBlock = urlContexts.length
    ? '\n\nקישורים שצורפו (כותרת + תקציר שנמשכו מהדף):\n' + urlContexts.map((u, i) => `${i + 1}. ${u.url}${u.ctx ? `\n   ${u.ctx}` : ' (לא נמשך תוכן)'}`).join('\n')
    : '';
  const prompt = `אתה היד הימנית של אורן — מפעיל יחיד של מותג אופנה D2C בשם DUBIS (חולצות/קפוצונים עם סלוגנים, קהל ישראלי + אמריקאי גילאי 35-55, גוף אמיתי; הומור יבש, זירו-התנצלות; ייצור Print-on-Demand דרך Gelato; אתר dubis.net; שיווק באינסטגרם/פייסבוק/טיקטוק + קמפיינים ב-Meta; צוות סוכני AI אוטונומיים: תוכן, שיווק, מוצר, עיצוב, וידאו, אספקה).

אורן שולח/מעביר לך מיילים עם רעיונות שהוא רואה בקבוצות וואטסאפ/פייסבוק ודברים שמעניינים אותו — הוא מצפה שתקרא לעומק ותמליץ מה לעשות עם זה בהקשר של DUBIS.

קרא את המייל הבא והחזר ניתוח קצר ומעשי בעברית. ענה אך ורק כ-JSON תקין:
{"idea":"מה הרעיון, 1-2 משפטים","relevance":"איך זה מתחבר ל-DUBIS — למה זה רלוונטי או למה לא, משפט-שניים","recommendation":"ההמלצה שלי — לעשות / לא לעשות / לבדוק, וברור למה","next_step":"צעד מוצע קונקרטי אחד","agent":"איזה סוכן/אדם הכי מתאים לבצע (content/marketing/product/design/video/supply/cto/oren)"}

נושא: ${subject}
מאת: ${from}
גוף ההודעה:
${body.slice(0, 6000)}${urlBlock}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as Record<string, string>;
    return {
      idea: String(o.idea || '').slice(0, 400),
      relevance: String(o.relevance || '').slice(0, 400),
      recommendation: String(o.recommendation || '').slice(0, 400),
      next_step: String(o.next_step || '').slice(0, 300),
      agent: String(o.agent || 'oren').toLowerCase().slice(0, 20),
    };
  } catch { return null; }
}

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

    // Signal-first query: mail FROM oren/hila OR addressed TO the brand inbox,
    // last 2 days, excluding vendor categories Gmail already classifies.
    const q = encodeURIComponent(
      'newer_than:2d (from:(teharlev1976@gmail.com OR hilateharlev@gmail.com OR steharlev@gmail.com) ' +
      'OR to:(dubis.brand@gmail.com)) ' +
      '-from:(orders@dubis.net) -category:promotions -category:social',
    );
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) return { ok: false, error: `Gmail list HTTP ${listRes.status}` };
    const list = await listRes.json();
    const ids = (list.messages || []).map((m: { id: string }) => m.id);

    let scanned = 0, saved = 0, filtered = 0, analyzed = 0;
    const insightDetails: unknown[] = [];

    for (const id of ids.slice(0, 12)) {
      // Full message so we can read the body + extract URLs.
      const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!mRes.ok) continue;
      const m = await mRes.json();
      scanned++;
      const headers = (m.payload?.headers || []) as Array<{ name: string; value: string }>;
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const from = headers.find(h => h.name === 'From')?.value || '';

      if (!isSignalEmail(from, subject)) { filtered++; continue; }

      const title = `📧 ${subject}`.slice(0, 200);
      // Dedup by title within 48h.
      const { data: dup } = await sb.from('agent_tasks').select('id').eq('title', title).gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString()).limit(1);
      if (dup && dup.length > 0) continue;

      const body = extractBodyFromPayload(m.payload) || (m.snippet || '');
      const urls = extractUrls(body);
      const urlContexts: Array<{ url: string; ctx: string }> = [];
      for (const u of urls.slice(0, 3)) {
        urlContexts.push({ url: u, ctx: await fetchUrlContext(u) });
      }

      const analysis = await analyzeIdeaEmail(subject, from, body, urlContexts);
      if (analysis) analyzed++;

      // Human-readable description in the shape Boss fetchEmailDigest parses:
      //   "From: {from}\n{rest}". We pack the 4-part recommendation into {rest}.
      const descParts = [`From: ${from}`];
      if (analysis) {
        descParts.push(
          `💡 מה הרעיון: ${analysis.idea}`,
          `🔗 איך זה מתחבר ל-DUBIS: ${analysis.relevance}`,
          `✅ ההמלצה שלי: ${analysis.recommendation}`,
          `➡️ צעד מוצע (${analysis.agent}): ${analysis.next_step}`,
        );
      } else {
        descParts.push(body.slice(0, 400));
      }
      if (urls.length) descParts.push(`קישורים: ${urls.join(' · ')}`);
      const description = descParts.join('\n').slice(0, 2000);

      // valid_status CHECK = backlog|in_progress|pending_approval|approved|publishing|done|rejected.
      // 'pending' is INVALID → every insert silently failed (supabase-js returns {error}, no throw),
      // yet saved++ ran anyway and falsely reported saved>0. Use 'backlog' + CHECK the error.
      const { error: insErr } = await sb.from('agent_tasks').insert({
        agent_id: 'email_monitor',
        title,
        description,
        category: 'gmail_insight',
        status: 'backlog',
        priority: analysis ? 'high' : 'medium',
        content_data: {
          source: 'email_monitor',
          subject,
          from,
          urls,
          url_contexts: urlContexts,
          body_excerpt: body.slice(0, 800),
          dubis_analysis: analysis,  // null when Gemini unavailable
        },
      });
      if (insErr) { insightDetails.push({ subject, from, insert_error: insErr.message }); continue; }
      saved++;
      insightDetails.push({ subject, from, has_analysis: !!analysis, urls: urls.length });
    }

    return { ok: true, scanned, saved, filtered, analyzed, details: insightDetails };
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
