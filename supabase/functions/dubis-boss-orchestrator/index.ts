// DUBIS Boss v10 — v9 + Phase A (rendering) + Phase B (self-healing) + Phase D (Meta context)
// 2026-05-20: oren's directive — stop reporting, start fixing.
// Adds:
//   • Rich captions (caption_he/en/body/text/script/slogan fallback chain) + post links + missing-permalink hint
//   • Wide agent-status table: icon | name | when | what it did | error
//   • Inline SVG sparkline (14 days, orders + revenue)
//   • Recurring-issues section (3+ days same recommendation → 🔁 section, suppressed from main)
//   • Self-healing:
//       B.7 tryAutoHealGelatoStock — re-invoke dispatcher when auth-header failure detected
//       B.8 handleEmailMonitorTokenFailure — single OAuth-playground notice per 7d (anti-spam)
//       B.9 autoTicketStuckOrders — Resend mail to support@gelato.com for orders > 14d pending
//   • Meta API error context — captures HTTP status + error in opinionMarketing
//   • Reads site_settings.boss_auto_heal_disabled — oren can flip per-action knobs from admin
//   • Writes every auto-fix attempt to boss_auto_fixes
// Migration: boss_auto_fixes_and_gelato_ticket_2026_05_20

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
// Service-role key — rotation 2026-06: prefer the sb_secret 'dubissecretkey' key (Supabase
// injects it in SUPABASE_SECRET_KEYS as JSON), fall back to the legacy service_role JWT
// during the transition, so the legacy + exposed 'default' keys can be disabled with zero downtime.
const SERVICE_ROLE  = (() => {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) return k as string; } catch { /* not migrated yet */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
})();
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY') ?? '';
const IG_TOKEN      = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
const IG_ACCOUNT    = Deno.env.get('INSTAGRAM_ACCOUNT_ID') ?? '';
const META_CAMPAIGN = Deno.env.get('META_CAMPAIGN_ID') || '120244081546680267';
const PG_CRON_TOKEN = 'dubis-pg-cron-trigger-a554cd187bdfaf88a0a5dd8dcf571bea32658e1eb8ec217c';
const FNS_BASE      = `${SUPABASE_URL}/functions/v1`;

type SB = ReturnType<typeof createClient>;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const num = (v: unknown) => Number(v) || 0;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string));

function isAuthed(req: Request): boolean {
  const url = new URL(req.url);
  const tok = url.searchParams.get('token') || req.headers.get('x-agent-secret') || (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  return !!tok && (tok === SERVICE_ROLE || tok === PG_CRON_TOKEN);
}

interface Opinion { agent: string; agent_he: string; observation: string; recommendation: string; priority: 'P0'|'P1'|'P2'; theme: string; }
interface AutoFix { action: string; succeeded: boolean; target?: string; error?: string; note?: string; }

// =============================================================
async function latestRun(sb: SB, agent_id: string, days = 7): Promise<Record<string, unknown> | null> {
  const since = new Date(Date.now() - days*86400000).toISOString();
  const { data } = await sb.from('agent_runs').select('status, summary, side_effects, created_at').eq('agent_id', agent_id).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
  return (data && data[0]) ? data[0] as Record<string, unknown> : null;
}
function hoursSince(iso: string | null | undefined): number { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / 3600000; }
function extractError(se: unknown): string {
  if (!se || typeof se !== 'object') return '';
  const s = se as Record<string, unknown>;
  if (s.error) return String(s.error);
  if (s.data && typeof s.data === 'object') {
    const d = s.data as Record<string, unknown>;
    if (d.message) return String(d.message);
    if (d.code) return String(d.code);
  }
  if (Array.isArray(s.fetch_errors) && s.fetch_errors.length) return s.fetch_errors.join('; ');
  return '';
}

// =============================================================
// Self-healing knob — read site_settings to honor oren's overrides
// =============================================================
async function isAutoHealEnabled(sb: SB, action: 'gelato_stock_retry' | 'email_monitor_anti_spam' | 'gelato_auto_ticket'): Promise<boolean> {
  try {
    const { data } = await sb.from('site_settings').select('value').eq('key', 'boss_auto_heal_disabled').maybeSingle();
    if (!data) return true;
    const v = data.value as Record<string, boolean>;
    return v[action] !== true; // knob default false → enabled
  } catch (_) { return true; }
}

async function recordAutoFix(sb: SB, fix: { action: string; target?: string; succeeded: boolean; error?: string; side_effects?: Record<string, unknown> }) {
  try {
    await sb.from('boss_auto_fixes').insert({
      action_type: fix.action, target_ref: fix.target || null, succeeded: fix.succeeded,
      error: fix.error || null, side_effects: fix.side_effects || {},
    });
  } catch (e) { console.error('[boss] failed to record auto_fix:', e); }
}

async function hasRecentAutoFix(sb: SB, action: string, target: string | null, hours: number): Promise<{ count: number; lastAt: string | null }> {
  const since = new Date(Date.now() - hours*3600000).toISOString();
  let q = sb.from('boss_auto_fixes').select('attempted_at', { count: 'exact' }).eq('action_type', action).gte('attempted_at', since);
  if (target) q = q.eq('target_ref', target);
  q = q.order('attempted_at', { ascending: false }).limit(1);
  const { data, count } = await q;
  return { count: count || 0, lastAt: data?.[0]?.attempted_at || null };
}

// =============================================================
// B.7 — Auto-heal gelato-stock when last run failed with "authorization"
// Returns {healed:bool, attempted:bool, error?:string}
// =============================================================
async function tryAutoHealGelatoStock(sb: SB): Promise<{ healed: boolean; attempted: boolean; error?: string; summary?: string }> {
  if (!await isAutoHealEnabled(sb, 'gelato_stock_retry')) return { healed: false, attempted: false, error: 'disabled-by-knob' };
  const lr = await latestRun(sb, 'gelato_stock', 3);
  if (!lr || lr.status !== 'failed') return { healed: false, attempted: false };
  const errStr = (extractError(lr.side_effects) || String(lr.summary || '')).toLowerCase();
  const isAuthErr = errStr.includes('authorization') || errStr.includes('unauthorized') || errStr.includes('missing auth');
  if (!isAuthErr) return { healed: false, attempted: false };
  // Rate limit: max 2 attempts in 24h
  const recent = await hasRecentAutoFix(sb, 'gelato_stock_retry', null, 24);
  if (recent.count >= 2) return { healed: false, attempted: false, error: `rate-limited (${recent.count} attempts in last 24h)` };
  // Attempt invoke via cron dispatcher
  // NOTE: dispatcher checks ?token= OR x-cron-token header (NOT Authorization).
  // See dubis-cron-dispatcher/index.ts line 49-52.
  try {
    const dispatcherUrl = `${FNS_BASE}/dubis-cron-dispatcher?job=gelato-stock&token=${encodeURIComponent(SERVICE_ROLE)}`;
    const r = await fetch(dispatcherUrl, {
      method: 'POST',
      headers: { 'x-cron-token': SERVICE_ROLE },
    });
    const data = await r.json().catch(() => ({}));
    // dispatcher returns { job, upstream_status, upstream: { ok, ... } }
    // success = HTTP 200 AND upstream returned a 2xx AND upstream body says ok:true
    const upStatus = Number(data.upstream_status || 0);
    const upBody = (data.upstream as Record<string, unknown>) || {};
    const succeeded = r.ok && upStatus >= 200 && upStatus < 300 && (upBody.ok === true || typeof upBody.checked === 'number');
    const summary = succeeded
      ? `gelato-stock ok (upstream ${upStatus}, ${upBody.checked || '?'} variants)`
      : `dispatch ok but upstream ${upStatus}: ${JSON.stringify(upBody).slice(0,160)}`;
    await recordAutoFix(sb, { action: 'gelato_stock_retry', succeeded, error: succeeded ? undefined : summary, side_effects: { dispatcher_response: data, http_status: r.status } });
    return { healed: succeeded, attempted: true, error: succeeded ? undefined : summary, summary };
  } catch (e) {
    const msg = (e as Error).message;
    await recordAutoFix(sb, { action: 'gelato_stock_retry', succeeded: false, error: msg });
    return { healed: false, attempted: true, error: msg };
  }
}

// =============================================================
// B.8 — Email-monitor token expired: send ONE OAuth notice per 7d
// Returns {suppressed:bool} — when true, opinionEmailMonitor should hide the issue
// =============================================================
async function handleEmailMonitorTokenFailure(sb: SB, consecutiveFails: number, latestError: string): Promise<{ suppressed: boolean; sentNotice: boolean }> {
  if (consecutiveFails < 3) return { suppressed: false, sentNotice: false };
  if (!await isAutoHealEnabled(sb, 'email_monitor_anti_spam')) return { suppressed: false, sentNotice: false };
  const recent = await hasRecentAutoFix(sb, 'email_monitor_anti_spam', 'email_monitor', 7*24);
  if (recent.count > 0) return { suppressed: true, sentNotice: false }; // already notified within 7d
  if (!RESEND_KEY) return { suppressed: false, sentNotice: false };
  // Send a single oren-facing email with OAuth playground instructions
  const useEmails = (Deno.env.get('OWNER_EMAILS') || 'dubis.brand@gmail.com').split(',').map(s => s.trim()).filter(Boolean);
  const html = `
    <!DOCTYPE html><html dir="rtl"><body style="font-family:Arial,sans-serif;color:#2c2c2c;line-height:1.7">
    <div style="max-width:640px;margin:24px auto;padding:24px;background:#f5f0e8;border-radius:12px">
      <h2 style="color:#c8a96e">🔑 GMAIL_REFRESH_TOKEN פג — נדרשת התערבות חד-פעמית</h2>
      <p>Boss Agent — Email Monitor נכשל <b>${consecutiveFails} ימים רצופים</b> בקריאה ל-Gmail. השגיאה האחרונה:</p>
      <pre style="background:#fff;padding:12px;border-radius:6px;direction:ltr;text-align:left;font-size:12px">${esc(latestError)}</pre>
      <p>זה לא דבר שאני יכול לתקן אוטומטית — צריך טוקן חדש ידנית דרך Google OAuth Playground.</p>
      <h3 style="color:#c8a96e">איך לחדש (3 דקות)</h3>
      <ol style="font-size:14px">
        <li>פותחים את <a href="https://developers.google.com/oauthplayground/" style="color:#c8a96e">OAuth Playground</a></li>
        <li>לוחצים על הגלגל ⚙️ למעלה משמאל → ב-OAuth flow: <code>Server-side</code></li>
        <li>מסמנים "Use your own OAuth credentials" ומדביקים <code>GMAIL_CLIENT_ID</code> + <code>GMAIL_CLIENT_SECRET</code> מ-Vercel envs</li>
        <li>בצד שמאל: בוחרים <code>Gmail API v1</code> → <code>https://www.googleapis.com/auth/gmail.modify</code></li>
        <li>"Authorize APIs" → להתחבר עם <b>dubis.brand@gmail.com</b></li>
        <li>"Exchange authorization code for tokens" → להעתיק את <code>refresh_token</code></li>
        <li>ב-Vercel: עדכון <code>GMAIL_REFRESH_TOKEN</code> + redeploy</li>
      </ol>
      <p style="color:#888;font-size:12px">📨 הודעה זו לא תחזור על עצמה בדוח היומי — Boss ינסה שוב בעוד 7 ימים אם הבעיה תימשך.</p>
      <p style="color:#888;font-size:11px">DUBIS Boss Agent · ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</p>
    </div></body></html>`;
  let succeeded = false; let errMsg = '';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'DUBIS המנהל <orders@dubis.net>', to: useEmails, subject: '🔑 חידוש GMAIL_REFRESH_TOKEN נדרש (לא יחזור 7 ימים)', html }),
    });
    const data = await r.json();
    if (r.ok) { succeeded = true; }
    else { errMsg = data.message || `HTTP ${r.status}`; }
  } catch (e) { errMsg = (e as Error).message; }
  await recordAutoFix(sb, { action: 'email_monitor_anti_spam', target: 'email_monitor', succeeded, error: succeeded ? undefined : errMsg, side_effects: { consecutiveFails, latestError } });
  return { suppressed: succeeded, sentNotice: succeeded };
}

// =============================================================
// B.9 — Auto-ticket Gelato support for orders pending > 14 days
// =============================================================
async function autoTicketStuckOrders(sb: SB): Promise<{ ticketsOpened: number; ticketIds: string[]; errors: string[] }> {
  const out = { ticketsOpened: 0, ticketIds: [] as string[], errors: [] as string[] };
  if (!await isAutoHealEnabled(sb, 'gelato_auto_ticket')) return out;
  if (!RESEND_KEY) { out.errors.push('RESEND_KEY missing'); return out; }
  const cutoff = new Date(Date.now() - 14*86400000).toISOString();
  // NOTE: legacy column names — `printful_order_id` actually holds the Gelato order reference,
  // `buyer_email` is the customer email, `items` (jsonb) is the cart snapshot. Phase B.9 bug fixed 2026-05-20.
  const { data: stuck } = await sb.from('orders')
    .select('id, printful_order_id, paypal_order_id, created_at, total_amount, buyer_email, status, items')
    .eq('status', 'pending')
    .is('gelato_ticket_opened_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(5); // cap per run to avoid floods
  for (const o of (stuck || [])) {
    const days = Math.floor((Date.now() - new Date(o.created_at as string).getTime()) / 86400000);
    const subject = `[DUBIS auto-ticket] Order #${String(o.id).slice(0,8)} stuck pending for ${days} days`;
    const itemsSummary = (() => { try { return JSON.stringify(o.items, null, 2).slice(0, 800); } catch { return '(items parse error)'; } })();
    const body = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6">
      <p>Hi Gelato Support,</p>
      <p>An order placed via DUBIS (Print API customer, account orders@dubis.net) has been in <b>pending</b> state for ${days} days
      without a Gelato status webhook update. Standard SLA is 5-7 business days. Please investigate.</p>
      <table cellpadding="6" style="font-size:13px;border-collapse:collapse">
        <tr><td><b>DUBIS reference</b></td><td><code>${esc(o.id)}</code></td></tr>
        <tr><td><b>Gelato order reference</b></td><td><code>${esc(String(o.printful_order_id || 'NOT_CREATED_OR_LOST'))}</code></td></tr>
        <tr><td><b>PayPal capture ID</b></td><td><code>${esc(String(o.paypal_order_id || 'n/a'))}</code></td></tr>
        <tr><td><b>Created</b></td><td>${esc(o.created_at)}</td></tr>
        <tr><td><b>Total paid</b></td><td>$${num(o.total_amount).toFixed(2)} USD</td></tr>
        <tr><td><b>Customer email</b></td><td>${esc(o.buyer_email)}</td></tr>
      </table>
      <p>Items:</p>
      <pre style="background:#f5f5f5;padding:10px;border-radius:4px;font-size:11px">${esc(itemsSummary)}</pre>
      <p>Please reply to this email (Reply-To is monitored by DUBIS owner). We need either (a) confirmation
      the order is in production, (b) a status update, or (c) a cancellation so we can refund the customer.</p>
      <p>Thanks,<br>DUBIS Boss Agent (auto-generated · do not reply to orders@)</p>
    </body></html>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'DUBIS Boss <orders@dubis.net>', to: ['support@gelato.com'], reply_to: 'dubis.brand@gmail.com', subject, html: body }),
      });
      const data = await r.json();
      if (r.ok && data.id) {
        await sb.from('orders').update({ gelato_ticket_opened_at: new Date().toISOString(), gelato_ticket_id: data.id }).eq('id', o.id);
        await recordAutoFix(sb, { action: 'gelato_auto_ticket', target: String(o.id), succeeded: true, side_effects: { resend_id: data.id, days_pending: days } });
        out.ticketsOpened++;
        out.ticketIds.push(data.id as string);
      } else {
        const err = data.message || `HTTP ${r.status}`;
        out.errors.push(`order ${String(o.id).slice(0,8)}: ${err}`);
        await recordAutoFix(sb, { action: 'gelato_auto_ticket', target: String(o.id), succeeded: false, error: err });
      }
    } catch (e) {
      const msg = (e as Error).message;
      out.errors.push(`order ${String(o.id).slice(0,8)}: ${msg}`);
      await recordAutoFix(sb, { action: 'gelato_auto_ticket', target: String(o.id), succeeded: false, error: msg });
    }
  }
  return out;
}

// =============================================================
// B.11 — Auto-hide products whose every (color × size) variant is OOS.
// Threshold: ≥6 OOS variants for a single product_id_numeric. Sets
// dubis_products.active=false and records in boss_auto_fixes so we don't
// hide the same product twice. Per oren 2026-05-23: stop "reporting" OOS,
// just hide and report what was hidden.
// =============================================================
async function tryAutoHideFullyOosProducts(sb: SB): Promise<{
  hidden: Array<{ id: string; numeric: number | null; slogan: string }>;
  attempted: boolean;
  skipped_already_hidden: number;
}> {
  if (!await isAutoHealEnabled(sb, 'auto_hide_oos' as 'gelato_stock_retry')) return { hidden: [], attempted: false, skipped_already_hidden: 0 };
  const { data: oosVariants } = await sb.from('product_variant_stock').select('product_id_numeric, in_stock').eq('in_stock', false);
  const oosByProd: Record<string, number> = {};
  for (const v of (oosVariants || [])) {
    const pid = String((v as Record<string, unknown>).product_id_numeric || '?');
    oosByProd[pid] = (oosByProd[pid] || 0) + 1;
  }
  const fullyOOSNumeric = Object.entries(oosByProd)
    .filter(([, cnt]) => cnt >= 6)
    .map(([pid]) => parseInt(pid, 10))
    .filter(n => Number.isFinite(n));
  if (fullyOOSNumeric.length === 0) return { hidden: [], attempted: false, skipped_already_hidden: 0 };

  // Only target products currently active=true (don't re-hide what's already hidden).
  const { data: actives } = await sb.from('dubis_products')
    .select('id, slogan, product_id_numeric')
    .eq('active', true)
    .in('product_id_numeric', fullyOOSNumeric);
  const candidates = (actives || []) as Array<Record<string, unknown>>;
  if (candidates.length === 0) return { hidden: [], attempted: true, skipped_already_hidden: 0 };

  const hidden: Array<{ id: string; numeric: number | null; slogan: string }> = [];
  let skipped = 0;
  for (const p of candidates) {
    const pid = String(p.id);
    // De-dupe — don't hide the same product twice within 7 days even if it bounces back to active.
    const recent = await hasRecentAutoFix(sb, 'auto_hide_oos', pid, 7 * 24);
    if (recent.count > 0) { skipped++; continue; }
    const { error } = await sb.from('dubis_products')
      .update({ active: false })
      .eq('id', pid);
    if (!error) {
      hidden.push({
        id: pid,
        numeric: (p.product_id_numeric as number) || null,
        slogan: String(p.slogan || `#${p.product_id_numeric || '?'}`),
      });
      await recordAutoFix(sb, {
        action: 'auto_hide_oos',
        target: pid,
        succeeded: true,
        side_effects: { product_id_numeric: p.product_id_numeric, slogan: p.slogan, oos_variants: oosByProd[String(p.product_id_numeric)] },
      });
    } else {
      await recordAutoFix(sb, { action: 'auto_hide_oos', target: pid, succeeded: false, error: error.message });
    }
  }
  return { hidden, attempted: true, skipped_already_hidden: skipped };
}

// =============================================================
// B.14 — Auto-close stale slogan-approval product tasks (2026-06-15, oren ask).
// Per the DUBIS open-list policy there is NO slogan-approval gate — every active
// DB slogan is approved. Old `agent_id='product', status='pending_approval'`
// tasks titled "סלוגן חדש: …" are dead manual gates that keep surfacing (e.g.
// "Just trying to MAINTAIN." stuck 44 days). Anything older than 30 days is
// closed (status='done' + audit note) so it stops nagging. Recent ones (a real
// fresh visual-approval gate) are left alone. Each close is logged as an autofix.
// =============================================================
async function tryCloseStaleSloganTasks(sb: SB): Promise<{ closed: Array<{ id: string; title: string; days: number }>; attempted: boolean }> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: stale } = await sb.from('agent_tasks')
    .select('id, title, created_at')
    .eq('agent_id', 'product')
    .eq('status', 'pending_approval')
    .ilike('title', '%סלוגן חדש%')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(20);
  const rows = (stale || []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { closed: [], attempted: false };
  const closed: Array<{ id: string; title: string; days: number }> = [];
  for (const r of rows) {
    const id = r.id as string;
    const days = Math.floor(hoursSince(r.created_at as string) / 24);
    // Use 'rejected' (a valid_status), NOT 'done' — the proof-guard trigger
    // blocks status='done' on product tasks without proof_of_completion. Closing
    // a stale slogan gate is a rejection, not a completion, so 'rejected' fits.
    const { error } = await sb.from('agent_tasks')
      .update({ status: 'rejected', updated_at: new Date().toISOString(), notes: `נסגר אוטומטית ${new Date().toISOString().slice(0,10)} — אין שער-אישור סלוגן (מדיניות open-list). היה תקוע ${days} ימים.` })
      .eq('id', id);
    if (!error) {
      closed.push({ id, title: String(r.title || ''), days });
      await recordAutoFix(sb, { action: 'close_stale_slogan_task', target: id, succeeded: true, side_effects: { title: r.title, days } });
    } else {
      await recordAutoFix(sb, { action: 'close_stale_slogan_task', target: id, succeeded: false, error: error.message });
    }
  }
  return { closed, attempted: true };
}

// =============================================================
// B.12 — Auto-retry failed product pipeline rows (oren 2026-05-23).
// Re-dispatches `boss-approved-product` via GitHub Actions for queue rows
// in `failed` state that have NOT been retried yet. Capped at 5 per run.
// Manual-attention list (in fetchPendingApprovals) only shows rows where
// a retry has already been attempted, so brand-new failures auto-recover
// before bothering oren.
// =============================================================
async function tryAutoRetryFailedPipeline(sb: SB): Promise<{
  retried: Array<{ queue_id: string; numeric: number | null; dispatched: boolean; error?: string }>;
  attempted: boolean;
}> {
  if (!await isAutoHealEnabled(sb, 'pipeline_auto_retry' as 'gelato_stock_retry')) return { retried: [], attempted: false };
  const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
  if (!ghToken) return { retried: [], attempted: false };
  const ghRepo = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
  // Only consider failures in the last 7 days — older ones probably already got attention.
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: failed } = await sb.from('product_pipeline_queue')
    .select('id, product_id, product_id_numeric, last_error, created_at')
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  const candidates = (failed || []) as Array<Record<string, unknown>>;
  if (candidates.length === 0) return { retried: [], attempted: false };

  const retried: Array<{ queue_id: string; numeric: number | null; dispatched: boolean; error?: string }> = [];
  let dispatchedCount = 0;
  for (const row of candidates) {
    if (dispatchedCount >= 5) break; // cap
    const queueId = row.id as string;
    // One auto-retry per queue row, ever — after that, oren handles it manually.
    const prior = await hasRecentAutoFix(sb, 'pipeline_auto_retry', queueId, 30 * 24);
    if (prior.count > 0) continue;

    try {
      const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'dubis-boss-retry/1.0',
        },
        body: JSON.stringify({
          event_type: 'boss-approved-product',
          client_payload: {
            product_id: row.product_id as string,
            product_id_numeric: row.product_id_numeric as number,
            queue_id: queueId,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const ok = dispatchRes.status === 204;
      if (ok) {
        dispatchedCount++;
        await sb.from('product_pipeline_queue').update({
          status: 'dispatched',
          dispatched_at: new Date().toISOString(),
          last_error: null,
        }).eq('id', queueId);
      }
      await recordAutoFix(sb, {
        action: 'pipeline_auto_retry',
        target: queueId,
        succeeded: ok,
        error: ok ? undefined : `dispatch returned ${dispatchRes.status}`,
        side_effects: {
          product_id_numeric: row.product_id_numeric,
          original_error: (row.last_error as string) || null,
        },
      });
      retried.push({
        queue_id: queueId,
        numeric: (row.product_id_numeric as number) || null,
        dispatched: ok,
        error: ok ? undefined : `HTTP ${dispatchRes.status}`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      await recordAutoFix(sb, { action: 'pipeline_auto_retry', target: queueId, succeeded: false, error: msg });
      retried.push({ queue_id: queueId, numeric: (row.product_id_numeric as number) || null, dispatched: false, error: msg });
    }
  }
  return { retried, attempted: true };
}

// =============================================================
// Opinions (v9 — minor refinements for self-healing handoff)
// =============================================================
async function opinionContent(sb: SB, igPosts7d: number): Promise<Opinion | null> {
  const since = new Date(Date.now() - 7*86400000).toISOString();
  const { data: posts } = await sb.from('agent_tasks').select('content_data, status').eq('agent_id','content').gte('created_at', since);
  const published = (posts || []).filter(t => (t.content_data as Record<string,unknown>)?.instagram_post_id).length;
  const lr = await latestRun(sb, 'content', 3);
  if (lr?.status === 'failed') return { agent:'content', agent_he:'יוצר התוכן', observation:`הרצה אחרונה נכשלה: ${extractError(lr.side_effects) || lr.summary || 'unknown'}`, recommendation:'לבדוק לוגי content-run', priority:'P0', theme:'content-broken' };
  if (igPosts7d < 5) return { agent:'content', agent_he:'יוצר התוכן', observation:`רק ${igPosts7d} פוסטים IG ב-7 ימים. ${published} מתויגים ב-DB.`, recommendation:'לבדוק אם ה-cron רץ ואם שלבי publish מצליחים', priority:'P1', theme:'content-cadence' };
  return null;
}
async function opinionMarketing(meta: Record<string, unknown>, realOrders: unknown[], campaignActive: boolean): Promise<Opinion | null> {
  // No active campaign → 7d Meta reads are post-mortem, not a daily finding
  // (2026-07-12: the ended summer campaign kept generating "check conversion
  // event" every day). The weekly retro covers the closed-campaign lesson.
  if (!campaignActive) return null;
  if (!meta.ok) {
    const err = String(meta.fetch_error || 'unknown');
    return { agent:'marketing', agent_he:'מנהל השיווק', observation:`לא הצליח למשוך נתוני Meta: ${err.slice(0,140)}`, recommendation:'לוודא ש-INSTAGRAM_ACCESS_TOKEN פעיל ו-Marketing API tier=Full Access', priority:'P1', theme:'meta-token' };
  }
  const cw7 = (meta.last_7d as Record<string, unknown>) || {};
  const cur = (meta.currency as string) || 'ILS'; const sym = cur === 'ILS' ? '₪' : '$';
  const spend = num(cw7.spend), clicks = num(cw7.clicks), cpc = num(cw7.cpc), ctr = num(cw7.ctr);
  if (spend === 0 && clicks === 0) return null;
  if (realOrders.length === 0 && clicks > 50) return { agent:'marketing', agent_he:'מנהל השיווק', observation:`7ימ: ${sym}${spend.toFixed(0)} הוצאה, ${clicks} קליקים, 0 ממירות מ-Meta.`, recommendation:'לבדוק אם הקמפיין Sales ו-Conversion Event=Purchase', priority:'P0', theme:'campaign-conversion' };
  if (ctr < 1) return { agent:'marketing', agent_he:'מנהל השיווק', observation:`CTR ${ctr.toFixed(2)}% — מתחת ל-benchmark.`, recommendation:'להחליף יצירתיות', priority:'P1', theme:'campaign-creative' };
  if (ctr > 2 && cpc > 2.5) return { agent:'marketing', agent_he:'מנהל השיווק', observation:`CTR ${ctr.toFixed(2)}% טוב אבל CPC ${sym}${cpc.toFixed(2)} גבוה.`, recommendation:'לצמצם טארגטינג', priority:'P2', theme:'campaign-targeting' };
  return null;
}
async function opinionProduct(sb: SB): Promise<Opinion | null> {
  const { data: products } = await sb.from('dubis_products').select('id, active').eq('active', true);
  const total = (products || []).length;
  const since = new Date(Date.now() - 7*86400000).toISOString();
  const { data: postsThisWeek } = await sb.from('agent_tasks').select('content_data').eq('agent_id','content').gte('created_at', since);
  const productIdsPosted = new Set((postsThisWeek || []).map(t => String((t.content_data as Record<string,unknown>)?.product_id || '')).filter(Boolean));
  const notPosted = Math.max(0, total - productIdsPosted.size);
  // 3-4 uncovered products out of ~20 is normal weekly rotation, not a finding
  // (2026-07-12 — this nagged oren daily). Flag only a real coverage hole, and
  // point at the actual mechanism (the weekly plan; auto-content is retired).
  if (notPosted <= 8) return null;
  return { agent:'product', agent_he:'מנהל המוצרים', observation:`${total} מוצרים פעילים, ${productIdsPosted.size} קיבלו פוסט השבוע, ${notPosted} לא.`, recommendation:'לשבץ את המוצרים החסרים בתוכנית השבועית הבאה', priority:'P1', theme:'catalog-coverage' };
}
async function opinionSupply(sb: SB, ticketsOpened: number): Promise<Opinion | null> {
  // Only REAL customer orders — Hila/oren/test orders must never trigger a "stuck pending" flag.
  const { data: openOrders } = await sb.from('orders').select('id, status, created_at, gelato_ticket_opened_at, buyer_email').in('status', ['pending', 'in_production', 'shipped']);
  const oldestPending = (openOrders || []).filter(o => o.status === 'pending' && !o.gelato_ticket_opened_at && !isInternalBuyer(o.buyer_email as string)).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const days = oldestPending ? Math.floor((Date.now() - new Date(oldestPending.created_at).getTime()) / 86400000) : 0;
  if (days <= 3) return null;
  if (days > 14 && ticketsOpened > 0) {
    // Already auto-ticketed in this run — surface as autofix, not opinion
    return null;
  }
  const note = days > 14 ? ' (auto-ticket לא נשלח — דורש בדיקה ידנית)' : '';
  return { agent:'supply', agent_he:'מנהל ההזמנות', observation:`הזמנה תקועה ב-pending כבר ${days} ימים${note}.`, recommendation: days > 14 ? 'לפתוח ticket ידני ל-Gelato support' : 'להמתין לעדכון Gelato webhook', priority: days > 14 ? 'P0' : 'P1', theme:'logistics-stuck' };
}
async function opinionDesign(sb: SB, dupes: number): Promise<Opinion | null> {
  const lr = await latestRun(sb, 'design', 7);
  if (!lr) return { agent:'design', agent_he:'מעצב הוויזואל', observation:'design לא רץ ב-7 ימים.', recommendation:'לוודא שה-pg_cron פעיל', priority:'P1', theme:'design-stale' };
  if (lr.status === 'failed') return { agent:'design', agent_he:'מעצב הוויזואל', observation:`הרצה אחרונה נכשלה: ${extractError(lr.side_effects) || lr.summary || ''}`, recommendation:'לבדוק לוגי', priority:'P1', theme:'design-broken' };
  if (dupes > 0) return { agent:'design', agent_he:'מעצב הוויזואל', observation:`זיהיתי ${dupes} כפילויות ב-7 פוסטים.`, recommendation:'למחוק מ-IG + לעדכן לוגיקת מניעה (Phase C dedup)', priority:'P1', theme:'visual-duplicates' };
  return null;
}
async function opinionSiteAudit(sb: SB): Promise<Opinion | null> {
  const lr = await latestRun(sb, 'site_audit', 7);
  if (!lr) return { agent:'site_audit', agent_he:'בודק האתר', observation:'site_audit לא רץ ב-7 ימים.', recommendation:'לוודא שה-cron פעיל', priority:'P1', theme:'audit-stale' };
  if (lr.status === 'failed') return { agent:'site_audit', agent_he:'בודק האתר', observation:`הרצה אחרונה נכשלה: ${extractError(lr.side_effects) || ''}`, recommendation:'לבדוק לוגי', priority:'P0', theme:'audit-broken' };
  const ic = num((lr.side_effects as Record<string, unknown>)?.issues_count);
  if (ic > 0) return { agent:'site_audit', agent_he:'בודק האתר', observation:`${ic} הצעות תיקון.`, recommendation:'לפתוח agent_tasks WHERE agent_id=site_audit', priority:'P2', theme:'audit-findings' };
  return null;
}
async function opinionEmailMonitor(sb: SB): Promise<Opinion | null> {
  const lr = await latestRun(sb, 'email_monitor', 7);
  if (!lr) return { agent:'email_monitor', agent_he:'סורק המייל', observation:'email_monitor לא רץ ב-7 ימים.', recommendation:'לוודא שה-pg_cron פעיל', priority:'P1', theme:'email-monitor-stale' };
  if (lr.status === 'failed') {
    const { data: recent } = await sb.from('agent_runs').select('status').eq('agent_id', 'email_monitor').order('created_at', { ascending: false }).limit(5);
    let cf = 0; for (const r of (recent || [])) { if ((r as Record<string, unknown>).status === 'failed') cf++; else break; }
    const latestErr = extractError(lr.side_effects) || String(lr.summary || '');
    // B.8 — try anti-spam handoff. If we sent a notice in last 7d (or just now), suppress from main report.
    const antiSpam = await handleEmailMonitorTokenFailure(sb, cf, latestErr);
    if (antiSpam.suppressed) return null;
    return { agent:'email_monitor', agent_he:'סורק המייל', observation:`נכשל ${cf} ימים רצופים: "${latestErr.slice(0,100)}".`, recommendation: cf >= 3 ? 'ליצור GMAIL_REFRESH_TOKEN חדש דרך OAuth Playground' : 'לבדוק לוגי', priority:'P0', theme:'email-monitor-broken' };
  }
  return null;
}
async function opinionStock(sb: SB, autoHealResult: { healed: boolean; attempted: boolean }): Promise<Opinion | null> {
  const { data: oosVariants } = await sb.from('product_variant_stock').select('product_id_numeric, in_stock').eq('in_stock', false);
  const oosByProd: Record<string, number> = {};
  for (const v of (oosVariants || [])) { const pid = String((v as Record<string, unknown>).product_id_numeric || '?'); oosByProd[pid] = (oosByProd[pid] || 0) + 1; }
  const fullyOOSNumeric = Object.entries(oosByProd)
    .filter(([, cnt]) => cnt >= 6)
    .map(([pid]) => parseInt(pid, 10))
    .filter(n => Number.isFinite(n));
  const lr = await latestRun(sb, 'gelato_stock', 3);
  if (lr?.status === 'failed' && !autoHealResult.healed) {
    // B.7 — failed and self-heal didn't fix it → keep as P0
    return { agent:'gelato_stock', agent_he:'בודק המלאי', observation:`הרצה אחרונה נכשלה: ${extractError(lr.side_effects) || ''}. ${autoHealResult.attempted ? 'auto-heal ניסה ונכשל גם כן.' : 'auto-heal לא הופעל (לא שגיאת auth).'}`, recommendation:'לבדוק Authorization header של gelato-stock-check', priority:'P0', theme:'stock-check-broken' };
  }
  if (fullyOOSNumeric.length === 0) return null;
  // B.11 handoff — only nag about fully-OOS products that are STILL active.
  // The auto-hider has already hidden the ones it could; what's left is
  // either already-inactive (no action needed) or hide-failed (oren handles).
  const { data: stillActive } = await sb.from('dubis_products')
    .select('product_id_numeric, slogan')
    .eq('active', true)
    .in('product_id_numeric', fullyOOSNumeric);
  const remaining = (stillActive || []) as Array<Record<string, unknown>>;
  if (remaining.length === 0) return null;
  const names = remaining.map(p => `#${p.product_id_numeric}`).join(', ');
  return { agent:'gelato_stock', agent_he:'בודק המלאי', observation:`${remaining.length} מוצרים אזלו לחלוטין ולא הוסתרו אוטומטית: ${names}.`, recommendation:'להסתיר ידנית או לבקש restock', priority:'P1', theme:'inventory-fully-oos' };
}
// 2026-05-23 — Canary for the save.js silent-rejection class of bugs.
// Calls Gelato API to count real (non-draft, non-mockup) orders in the
// last 24h, compares against the `orders` table count for the same window.
// Any positive diff = ghost order(s) — Gelato fulfilled but our DB has no row.
// This is the exact gap that hid the 2026-05-01→2026-05-22 save.js bug for
// 3 weeks. If this had been in place, we'd have caught it day 1.
async function opinionCheckoutCanary(sb: SB): Promise<Opinion | null> {
  const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY') || Deno.env.get('GELATO') || Deno.env.get('Gelato');
  if (!GELATO_API_KEY) return null; // can't probe without key — skip silently

  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endDate   = new Date().toISOString();

  let gelatoOrders: Array<Record<string, unknown>> = [];
  try {
    const url = `https://order.gelatoapis.com/v4/orders?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&limit=100&offset=0`;
    const res = await fetch(url, {
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return { agent: 'cto', agent_he: 'מבדק ה-checkout', observation: `Canary: Gelato API ${res.status} — לא יכול לוודא שהזמנות נשמרות.`, recommendation: 'לבדוק GELATO_API_KEY בסביבת Edge Function', priority: 'P2', theme: 'checkout-canary-noprobe' };
    }
    const json = await res.json() as { orders?: unknown[]; data?: unknown[] };
    gelatoOrders = (json.orders || json.data || []) as Array<Record<string, unknown>>;
  } catch (e) {
    return { agent: 'cto', agent_he: 'מבדק ה-checkout', observation: `Canary: Gelato fetch threw — ${String((e as Error).message).slice(0, 120)}`, recommendation: 'לבדוק connectivity / API key', priority: 'P2', theme: 'checkout-canary-error' };
  }

  // Filter to REAL customer orders (drop drafts + admin mockups + smoke tests).
  const real = gelatoOrders.filter(g => {
    const fin = String(g.financialStatus || '');
    const ful = String(g.fulfillmentStatus || '');
    const ref = String(g.orderReferenceId || g.customerReferenceId || '');
    if (fin === 'draft' || ful === 'draft') return false;
    if (/^DUBIS-(MOCKUP|TIMING|SMOKE|TEST|REPRINT|REGEN)/i.test(ref)) return false;
    return true;
  });

  // Count rows in `orders` table from the same window.
  const { data: dbRows } = await sb.from('orders').select('paypal_order_id, printful_order_id').gte('created_at', startDate);
  const dbPaypalIds = new Set((dbRows || []).map(r => (r as Record<string, unknown>).paypal_order_id as string).filter(Boolean));
  const dbGelatoIds = new Set((dbRows || []).map(r => (r as Record<string, unknown>).printful_order_id as string).filter(Boolean));

  // Identify Gelato orders missing from DB.
  const ghosts = real.filter(g => {
    const ref = String(g.orderReferenceId || g.customerReferenceId || '');
    const m = ref.match(/^DUBIS-([A-Z0-9]+?)(?:-\d+of\d+)?$/i);
    const paypalGuess = m ? m[1] : null;
    const gelatoId = String(g.id || '');
    if (paypalGuess && dbPaypalIds.has(paypalGuess)) return false;
    if (gelatoId && dbGelatoIds.has(gelatoId)) return false;
    return true;
  });

  if (ghosts.length === 0) return null; // healthy

  const refsList = ghosts.slice(0, 5).map(g => g.orderReferenceId || g.customerReferenceId).join(', ');
  return {
    agent: 'cto',
    agent_he: 'מבדק ה-checkout',
    observation: `🚨 ${ghosts.length} Gelato orders ב-24h בלי שורת DB תואמת. דוגמאות: ${refsList}`,
    recommendation: `הרץ: \`cd dubis-website && node scripts/audit-ghost-orders.js --since ${startDate.slice(0,10)} --recover\``,
    priority: 'P0',
    theme: 'checkout-ghost-orders',
  };
}

async function opinionCto(sb: SB): Promise<Opinion | null> {
  const { data: openTasks } = await sb.from('agent_tasks').select('id, priority').eq('agent_id','cto').in('status', ['pending','approved','backlog']);
  const critical = (openTasks || []).filter(t => (t as Record<string, unknown>).priority === 'critical').length;
  const total = (openTasks || []).length;
  if (total === 0) return null;
  if (critical > 0) return { agent:'cto', agent_he:'איש הטכנולוגיה', observation:`${critical} משימות critical פתוחות (מתוך ${total}).`, recommendation:'לעבור ב-/admin', priority:'P0', theme:'cto-critical' };
  if (total > 10) return { agent:'cto', agent_he:'איש הטכנולוגיה', observation:`${total} משימות פתוחות.`, recommendation:'לסקור backlog', priority:'P2', theme:'cto-backlog' };
  return null;
}
async function opinionSecurity(sb: SB): Promise<Opinion | null> {
  const lr = await latestRun(sb, 'security', 14);
  if (!lr) return { agent:'security', agent_he:'בודק האבטחה', observation:'security לא רץ ב-14 ימים.', recommendation:'לוודא שה-cron רץ', priority:'P1', theme:'security-stale' };
  if (lr.status === 'failed') return { agent:'security', agent_he:'בודק האבטחה', observation:`הרצה אחרונה נכשלה: ${extractError(lr.side_effects) || ''}`, recommendation:'לבדוק לוגי', priority:'P0', theme:'security-broken' };
  const ic = num((lr.side_effects as Record<string, unknown>)?.issues_count);
  if (ic > 0) return { agent:'security', agent_he:'בודק האבטחה', observation:`${ic} ממצאי אבטחה פתוחים.`, recommendation:'הממצאים נכנסו לשולחן ההנהלה ויוכרעו שם (אומץ/נדחה/עולה אליך)', priority:'P1', theme:'security-findings' };
  return null;
}
async function opinionVideo(sb: SB): Promise<Opinion | null> {
  const since60 = new Date(Date.now() - 60*86400000).toISOString();
  const { data: anyEver } = await sb.from('agent_runs').select('id').eq('agent_id', 'video').gte('created_at', since60).limit(1);
  if (!anyEver?.length) return null;
  const since30 = new Date(Date.now() - 30*86400000).toISOString();
  const { data: videoRuns } = await sb.from('agent_runs').select('id').eq('agent_id', 'video').gte('created_at', since30);
  if ((videoRuns || []).length > 0) return null;
  return { agent:'video', agent_he:'מפיק ה-Reels', observation:'צינור ה-Reels לא רץ ב-30 ימים.', recommendation:'להשאיר מושעה או להעיר', priority:'P2', theme:'video-paused' };
}
async function opinionPlanner(sb: SB): Promise<Opinion | null> {
  const lws = new Date(Date.now() - 14*86400000).toISOString().slice(0,10);
  const lwe = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  const { data: lastItems } = await sb.from('weekly_action_items').select('id, status').gte('meeting_date', lws).lt('meeting_date', lwe);
  const total = (lastItems || []).length;
  if (total === 0) return null;
  const done = (lastItems || []).filter(i => i.status === 'done').length;
  const completion = Math.round((done / total) * 100);
  if (completion >= 60) return null;
  return { agent:'planner', agent_he:'מתכנן האסטרטגיה', observation:`שבוע שעבר: ${done}/${total} (${completion}%).`, recommendation:'לסקור P0/P1 הפתוחים', priority:'P1', theme:'planner-execution' };
}

// 2026-06-20 — "🎯 3 החלטות להיום": the Boss-decides block oren asked for.
// 2026-07-08 MANAGER-CONTRACT UPGRADE (oren-approved 2026-07-08, specced 2026-07-03):
// decisions are COMPUTED from the live business state, not just agent opinions.
// Sources in priority order:
//   1. Paid-campaign KILL-SWITCH gates — ₪300/0-carts = desire · ₪600/0-purchases =
//      checkout/trust · purchases → CAC — read from ad_campaigns (spend synced daily)
//      + EXTERNAL page_views funnel events since campaign start.
//   2. Open board escalations awaiting oren (management_decisions escalate w/o outcome).
//   3. Oren-blockers older than 30 days (execute-or-delete — blockers must not age silently).
//   4. Live P0/P1 agent opinions (the original source).
// Every decision carries its cost-of-inaction. Max 3. Honest empty state.
// The card opens with the TWO-ENGINES strip: one morning question — what did we
// learn yesterday (paid funnel vs gates + organic learning) and what changes today.

type KillSwitchRead = {
  active: boolean; spend: number; sym: string; budgetTotal: number | null;
  remaining: number | null; clicks: number; carts: number; checkouts: number;
  purchases: number; gate: 'desire' | 'checkout' | 'cac' | 'none'; gateLine: string;
  endDate: string | null; dailyBudget: number;
};

async function fetchKillSwitch(sb: SB): Promise<KillSwitchRead | null> {
  try {
    const { data: rows } = await sb.from('ad_campaigns')
      .select('status, budget, budget_currency, spend_to_date, clicks, start_date, end_date, duration_days, notes, created_at')
      .order('created_at', { ascending: false }).limit(10);
    const camp = (rows || []).find(r => /campaign_id:\s*\d+/i.test(String((r as Record<string, unknown>).notes || '')));
    if (!camp) return null;
    const c = camp as Record<string, unknown>;
    const active = String(c.status || '').toLowerCase() === 'active';
    const spend = Number(c.spend_to_date || 0);
    const dailyBudget = Number(c.budget || 0);
    const start = c.start_date ? String(c.start_date) : null;
    const endDate = c.end_date ? String(c.end_date) : null;
    let days = Number(c.duration_days || 0);
    if (!days && start && endDate) days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(start)) / 86400000));
    const budgetTotal = dailyBudget && days ? dailyBudget * days : null;
    const remaining = budgetTotal !== null ? Math.max(0, budgetTotal - spend) : null;
    const sym = String(c.budget_currency || 'ILS') === 'ILS' ? '₪' : '$';
    // Funnel events since campaign start — EXTERNAL visitors only (is_internal
    // false OR null; the 2026-07-08 team review caught internal tests polluting
    // the funnel, so never count is_internal=true).
    let carts = 0, checkouts = 0, purchases = 0;
    if (start) {
      const { data: ev } = await sb.from('page_views').select('event')
        .gte('created_at', `${start}T00:00:00Z`)
        .or('is_internal.is.null,is_internal.eq.false')
        .in('event', ['add_to_cart', 'checkout_start', 'purchase'])
        .limit(1000);
      for (const e of (ev || [])) {
        const n = String((e as Record<string, unknown>).event);
        if (n === 'add_to_cart') carts++;
        else if (n === 'checkout_start') checkouts++;
        else if (n === 'purchase') purchases++;
      }
    }
    let gate: KillSwitchRead['gate'] = 'none'; let gateLine = '';
    // 2026-07-12 (oren: "כבר כמה ימים שהקמפיין לא עובד — למה לרשום את זה"):
    // an ENDED/paused campaign never produces a gate scream. One calm closing
    // line; the lesson lives on the board, not as a daily repeated "decision".
    if (!active) {
      gateLine = `הקמפיין הסתיים${endDate ? ` ב-${endDate}` : ''} — סה"כ ${sym}${spend.toFixed(0)} · ${Number(c.clicks || 0)} קליקים · ${purchases} רכישות. אין הוצאה פעילה.`;
    } else if (purchases > 0) {
      gate = 'cac';
      gateLine = `יש רכישות — CAC נוכחי ${sym}${(spend / purchases).toFixed(0)}`;
    } else if (spend >= 300 && carts === 0) {
      gate = 'desire';
      gateLine = `שער ${sym}300/אפס-סלים נחצה (${sym}${spend.toFixed(0)} · 0 הוספות-לסל) — בעיית רצון: קריאייטיב/קהל`;
    } else if (spend >= 600) {
      gate = 'checkout';
      gateLine = `שער ${sym}600/אפס-רכישות נחצה (${sym}${spend.toFixed(0)} · ${carts} סלים · ${checkouts} קופות · 0 רכישות) — בעיית קופה/אמון`;
    } else {
      gateLine = active ? `בתוך השערים: ${sym}${spend.toFixed(0)}${budgetTotal ? ` מתוך ${sym}${budgetTotal.toFixed(0)}` : ''} · ${carts} סלים · ${purchases} רכישות` : 'הקמפיין לא פעיל';
    }
    return { active, spend, sym, budgetTotal, remaining, clicks: Number(c.clicks || 0), carts, checkouts, purchases, gate, gateLine, endDate, dailyBudget };
  } catch (_) { return null; }
}

type DecisionItem = { pr: 'P0' | 'P1' | 'P2'; title: string; why: string; cost: string; owner: string };

function deriveDecisions(
  allOpinions: Opinion[],
  ks: KillSwitchRead | null,
  board: Awaited<ReturnType<typeof fetchManagementBoard>>,
  blocked: Array<{ title: string; days_late: number }>,
): DecisionItem[] {
  const items: DecisionItem[] = [];
  if (ks && ks.active && ks.gate === 'checkout') {
    items.push({
      pr: 'P0',
      title: 'לעצור את יתרת תקציב-הקמפיין — ולתקן קופה/אמון לפני שקל-תנועה נוסף',
      why: `${ks.gateLine} · ${ks.clicks} קליקים הגיעו ולא קנו`,
      cost: `כל יום נוסף שורף ~${ks.sym}${ks.dailyBudget.toFixed(0)}${ks.remaining !== null ? `; נותרו ~${ks.sym}${ks.remaining.toFixed(0)}${ks.endDate ? ` עד ${ks.endDate}` : ''}` : ''} על תנועה שנוחתת על הצעה שוברת`,
      owner: 'אורן (המתג) · Marketing (אבחון המשפך)',
    });
  } else if (ks && ks.active && ks.gate === 'desire') {
    items.push({
      pr: 'P0',
      title: 'להשהות את הקמפיין ולהחליף זווית/קריאייטיב — הקהל לא מוסיף לסל',
      why: ks.gateLine,
      cost: `כל יום נוסף שורף ~${ks.sym}${ks.dailyBudget.toFixed(0)} על מסר שלא עובד`,
      owner: 'אורן (המתג) · Dana (זווית חדשה)',
    });
  } else if (ks && ks.gate === 'cac') {
    items.push({
      pr: 'P1',
      title: 'לקרוא את ה-CAC ולהחליט: להגדיל, להשאיר או לעצור',
      why: ks.gateLine,
      cost: 'בלי קריאת-CAC ההוצאה ממשיכה עיוורת',
      owner: 'אורן + Analyst',
    });
  }
  const openEsc = (board?.recent || []).filter(r => r.decision === 'escalate' && !r.outcome).slice(0, 2);
  for (const r of openEsc) {
    items.push({
      pr: 'P1',
      title: `להכריע: ${r.recommendation.slice(0, 90)}`,
      why: 'הסלמה פתוחה על שולחן-ההנהלה',
      cost: 'הכרעה שלא מתקבלת = המבצע שלה תקוע',
      owner: 'אורן',
    });
  }
  for (const b of blocked.filter(x => x.days_late > 30).slice(0, 1)) {
    items.push({
      pr: 'P1',
      title: `בצע-או-מחק: ${b.title.slice(0, 80)}`,
      why: `חסם עליך כבר ${b.days_late} ימים`,
      cost: 'חסם שלא מזדקן הוא ערוץ שנשאר סגור בחינם',
      owner: 'אורן',
    });
  }
  const urgent = allOpinions
    .filter(o => o.priority === 'P0' || o.priority === 'P1')
    .sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority]));
  for (const o of urgent) {
    items.push({
      pr: o.priority as 'P0' | 'P1',
      title: cleanRecommendationText(o.recommendation),
      why: o.observation,
      cost: '',
      owner: o.agent_he,
    });
  }
  return items.sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.pr] - { P0: 0, P1: 1, P2: 2 }[b.pr])).slice(0, 3);
}

function buildTopDecisionsHtml(
  decisions: DecisionItem[],
  ks: KillSwitchRead | null,
  contentPerf: Awaited<ReturnType<typeof fetchContentPerf>>,
): string {
  const paidLine = ks
    ? (ks.active
        ? `🔥 <b>מנוע בתשלום:</b> ${ks.sym}${ks.spend.toFixed(0)}${ks.budgetTotal ? `/${ks.sym}${ks.budgetTotal.toFixed(0)}` : ''} · ${ks.clicks} קליקים · ${ks.carts} סלים · ${ks.purchases} רכישות → ${esc(ks.gateLine)}`
        : `🔥 <b>מנוע בתשלום:</b> אין קמפיין פעיל. ${esc(ks.gateLine)}`)
    : '🔥 <b>מנוע בתשלום:</b> אין קמפיין רשום';
  const learnBit = contentPerf?.learning ? esc(contentPerf.learning.summary.slice(0, 130)) : 'אין למידה טרייה';
  const organicLine = contentPerf
    ? `🌱 <b>מנוע אורגני:</b> ${contentPerf.totalEng} מעורבות (7י) · ${contentPerf.siteClicks.total} כניסות-אתר (30י) → ${learnBit}`
    : '🌱 <b>מנוע אורגני:</b> אין נתוני איסוף';
  const engines = `<div dir="rtl" style="background:#faf7f0;border-radius:6px;padding:8px 12px;margin:0 0 10px;font-size:11.5px;color:#444;line-height:1.8;text-align:right">${paidLine}<br>${organicLine}</div>`;
  if (decisions.length === 0) {
    return engines + '<p dir="rtl" style="color:#27ae60;font-size:13px;margin:0">✅ אין כרגע החלטה דחופה — המערכת בתוך השערים.</p>';
  }
  const PRIO: Record<string, { label: string; color: string }> = {
    'P0': { label: '🔴 דחוף', color: '#c0392b' },
    'P1': { label: '🟠 חשוב', color: '#e67e22' },
    'P2': { label: '🟡 כדאי', color: '#888' },
  };
  return engines + decisions.map((d, i) => {
    const p = PRIO[d.pr] || { label: d.pr, color: '#888' };
    return `<div dir="rtl" style="padding:10px 14px;background:#fafafa;border-right:4px solid ${p.color};margin:6px 0;border-radius:6px;text-align:right">
      <div style="font-size:13.5px;color:#2c2c2c"><b style="color:${p.color}">${i + 1}. ${p.label}</b> · ${esc(d.title)}</div>
      <div style="font-size:11.5px;color:#666;margin-top:4px">↳ ${esc(d.why)} <span style="color:#999">· אחראי: ${esc(d.owner)}</span></div>
      ${d.cost ? `<div style="font-size:11px;color:#a15c00;margin-top:3px">⏳ עלות אי-ההחלטה: ${esc(d.cost)}</div>` : ''}
    </div>`;
  }).join('');
}

function synthesize(opinions: Opinion[]) {
  const sorted = [...opinions].sort((a, b) => ({ P0: 0, P1: 1, P2: 2 }[a.priority] - { P0: 0, P1: 1, P2: 2 }[b.priority]));
  const topActions = sorted.slice(0, 5);
  const p0 = opinions.filter(o => o.priority === 'P0').length;
  let view = '';
  if (opinions.length === 0) view = 'כל הסוכנים מדווחים תקין. הממוקדים: הגדלת תנועה וconversion.';
  else if (p0 >= 3) view = `${p0} משימות P0 בו-זמנית. לתקן את ה-blockers תחילה.`;
  else if (p0 >= 1) view = `יש ${p0} משימה P0 להיום.`;
  else view = `אין P0. ${opinions.length} תצפיות P1/P2.`;
  return { topActions, managerView: view };
}

async function checkLastWeek(sb: SB) {
  const lws = new Date(Date.now() - 14*86400000).toISOString().slice(0,10);
  const lwe = new Date(Date.now() - 6*86400000).toISOString().slice(0,10);
  const { data: items } = await sb.from('weekly_action_items').select('id, agent_he, status, recommendation').gte('meeting_date', lws).lt('meeting_date', lwe);
  const list = items || [];
  return { total: list.length, done: list.filter(i => i.status === 'done').length, open: list.filter(i => i.status === 'open').length, details: list.map(i => ({ rec: i.recommendation as string, agent: i.agent_he as string, status: i.status as string })) };
}

// =============================================================
// humanizeAgentSummary — turn raw "cloud-run X completed: {json}" into one
// plain-Hebrew sentence per agent. Oren's directive 2026-05-23: never show
// raw JSON in the daily report. Each agent gets a templated translation
// based on the keys it tends to emit. Unknown agents fall back to a stripped
// summary line with all JSON removed.
// =============================================================
function translateErrorPhrase(err: string): string {
  const e = err.toLowerCase();
  if (/unauthor|missing auth|authorization|401|403/i.test(e)) return 'בעיית הרשאות';
  if (/timeout|timed out/i.test(e)) return 'פג זמן';
  if (/refresh.*token|gmail_refresh/i.test(e)) return 'טוקן Gmail פג';
  if (/network|enotfound|econnreset|fetch failed/i.test(e)) return 'בעיית רשת';
  if (/rate.?limit|429/i.test(e)) return 'רייט-לימיט';
  if (/500|502|503|504/.test(e)) return 'שרת לא זמין';
  return err.slice(0, 80);
}
// 2026-05-26 — strip developer jargon (P0/P1/Phase/dedup/backfill) from any
// recommendation text before it lands in the email. Applied uniformly to
// new findings, top actions, and recurring items so stale rows from DB
// history get cleaned the same way fresh opinions do.
// Specific patterns (e.g. "לסקור P0/P1 הפתוחים") come BEFORE the per-priority
// replacements so they match before P0/P1 are individually rewritten.
function cleanRecommendationText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\(Phase [A-Z] dedup\)/gi, '')
    .replace(/Phase [A-Z] dedup/gi, 'כפילויות')
    .replace(/לסקור P[0-9]\/P[0-9] הפתוחים/g, 'לסקור בעיות פתוחות')
    .replace(/\bP0\b/g, '🔴 דחוף')
    .replace(/\bP1\b/g, '🟠 חשוב')
    .replace(/\bP2\b/g, '🟡 כדאי לטפל')
    .replace(/dedup/gi, 'כפילויות')
    .replace(/backfill/gi, 'השלמת נתונים')
    .replace(/\s+/g, ' ')
    .trim();
}
function humanizeAgentSummary(
  agentId: string,
  raw: string | null,
  sideEffects: Record<string, unknown> | null,
  hoursAgo: number,
  isFailed: boolean,
  errText: string | null,
  autoHealNote?: string | null,
): string {
  // ⚪ never ran — short phrase per oren spec.
  if (raw === null && !sideEffects) return 'לא הופעל היום';
  // Strip "cloud-run X status:" prefix and any embedded {...} JSON.
  let cleaned = String(raw || '').replace(/cloud-run\s+[\w-]+\s+\w+:\s*/i, '').trim();
  let jsonData: Record<string, unknown> = sideEffects ? { ...sideEffects } : {};
  const jsonMatch = cleaned.match(/\{[\s\S]+\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      jsonData = { ...jsonData, ...parsed };
    } catch { /* keep cleaned text fallback */ }
    cleaned = cleaned.replace(jsonMatch[0], '').trim();
  }
  // Failed run gets a different shape: "לא עבד Nד — סיבה: X (status)"
  if (isFailed) {
    const days = hoursAgo >= 24 ? Math.round(hoursAgo / 24) : null;
    const ago = days ? `${days} ימים` : `${Math.round(hoursAgo)} שעות`;
    const reason = translateErrorPhrase(errText || cleaned || 'unknown');
    const suffix = autoHealNote ? ` (${autoHealNote})` : '';
    return `לא עבד מ-${ago} — סיבה: ${reason}${suffix}`;
  }
  // Successful run — per-agent template.
  const n = (k: string) => num(jsonData[k]);
  switch (agentId) {
    case 'boss': {
      const newIssues = n('opinion_count');
      const pending = n('pending_count');
      const fixed = n('auto_fix_count');
      const parts = ['סרק הכל'];
      parts.push(newIssues === 0 ? 'לא מצא בעיות חדשות' : `מצא ${newIssues} בע${newIssues === 1 ? 'יה' : 'יות'} חדש${newIssues === 1 ? 'ה' : 'ות'}`);
      if (pending > 0) parts.push(`${pending} מחכים לאישורך`);
      if (fixed > 0) parts.push(`${fixed} תוקנו אוטומטית`);
      return parts.join(' · ');
    }
    case 'content': {
      const published = n('published') || n('publishedCount');
      const queued = n('queued');
      const backfilled = n('backfilled') || n('updated');
      if (published > 0) return `פרסם ${published} פוסט${published === 1 ? '' : 'ים'} (IG+FB)`;
      if (queued > 0) return `יצר ${queued} משימות תוכן חדשות`;
      if (backfilled > 0) return `עדכן קישורים ל-${backfilled} פוסטים מה-72 שעות האחרונות`;
      return cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'רץ — אין שינוי';
    }
    case 'tiktok': {
      const caption = String(jsonData.caption || jsonData.script || '').replace(/\s+/g, ' ').slice(0, 60);
      const slug = String(jsonData.product_slug || jsonData.product_uid || '');
      const tag = [slug, caption].filter(Boolean).join(', ');
      return tag ? `פרסם סרטון לטיק טוק (${tag})` : 'פרסם סרטון לטיק טוק';
    }
    case 'gelato_stock': {
      const checked = n('checked');
      const tr = jsonData.transitions as Record<string, unknown> | undefined;
      const toOos = tr ? num(tr.to_oos) : 0;
      const back = tr ? num(tr.back_in_stock) : 0;
      if (checked > 0) {
        const parts = [`בדק ${checked} variants`];
        if (toOos > 0) parts.push(`${toOos} עברו ל-OOS`);
        if (back > 0) parts.push(`${back} חזרו למלאי`);
        return parts.join(' · ');
      }
      return cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'בדק מלאי — אין שינוי';
    }
    case 'site_audit': {
      const checks = jsonData.checks as Array<{ ok?: boolean }> | undefined;
      if (Array.isArray(checks)) {
        const broken = checks.filter(c => c && c.ok === false).length;
        return broken > 0
          ? `בדק ${checks.length} URLs · 🔴 ${broken} שבורים`
          : `בדק ${checks.length} URLs · הכל תקין ✅`;
      }
      return cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'בדק את האתר';
    }
    case 'email_monitor': {
      // The cloud runner's summary JSON is {scanned, saved, filtered, analyzed} —
      // the old keys (processed/found/messages) never existed, so this line
      // falsely read "didn't scan" every day (oren caught it 2026-07-06).
      const scanned = n('scanned') || n('processed') || n('found') || n('messages');
      const savedN = n('saved');
      const filteredN = n('filtered');
      if (scanned > 0) {
        const parts = [`סרק ${scanned} מיילים`];
        if (filteredN > 0) parts.push(`${filteredN} סוננו (ספקים/דיווחים-עצמיים)`);
        parts.push(savedN > 0 ? `${savedN} רעיונות נותחו ונשמרו` : 'אפס רעיונות חדשים');
        return parts.join(' · ');
      }
      return 'רץ — 0 מיילים בתיבה בחלון הסריקה';
    }
    case 'security': {
      // 2026-07-06: surface WHAT was actually checked (from side_effects.checks_performed,
      // written by the honesty-fixed security-scan) — never a bare "everything's fine".
      const issues = n('issues_count') || n('issues');
      const perf = Array.isArray(jsonData.checks_performed) ? (jsonData.checks_performed as unknown[]).length : 0;
      const skip = Array.isArray(jsonData.checks_skipped) ? (jsonData.checks_skipped as unknown[]).length : 0;
      // 2026-07-12: the daily line stays SHORT — what ran and what was found.
      // The "N checks unavailable" list moved to the WEEKLY retro (a capability
      // gap is a once-a-week management item, not a daily nag — oren's ask).
      const detail = perf > 0 ? ` · בוצעו ${perf} בדיקות` : '';
      return issues > 0 ? `סקירת אבטחה — ${issues} ממצאים (נכנסו לשולחן ההנהלה)${detail}` : `סקירת אבטחה — 0 ממצאים${detail}`;
    }
    case 'product': {
      const created = n('created') || n('queued');
      const slogans = n('slogans');
      if (created > 0) return `יצר ${created} משימות מוצר חדשות`;
      if (slogans > 0) return `${slogans} סלוגנים חדשים מומלצים`;
      return cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'רץ — אין מוצרים חדשים';
    }
    case 'marketing': {
      const spend = n('spend');
      const clicks = n('clicks');
      if (spend > 0) return `סקירת קמפיין — הוצאה $${spend.toFixed(0)} · ${clicks} קליקים`;
      return cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'בדק את הקמפיין';
    }
    case 'supply': {
      const synced = n('synced') || n('updated');
      return synced > 0 ? `סינכרון Gelato — ${synced} הזמנות עודכנו` : 'סינכרון Gelato — אין שינויים';
    }
    case 'design': {
      const created = n('created') || n('queued');
      return created > 0 ? `יצר ${created} ויזואלים חדשים` : (cleaned.split(/\n|\.\s/)[0]?.slice(0, 120) || 'רץ — אין שינוי');
    }
    case 'cto':
    case 'planner':
    case 'video':
    default: {
      const first = cleaned.split(/\n|\.\s/)[0]?.trim() || '';
      return first.slice(0, 120) || 'רץ ללא שינוי';
    }
  }
}

const AGENT_HE_TO_ID: Record<string, string> = {
  'יוצר התוכן':'content', 'מנהל השיווק':'marketing', 'מנהל המוצרים':'product', 'מנהל ההזמנות':'supply',
  'מעצב הוויזואל':'design', 'בודק האתר':'site_audit', 'סורק המייל':'email_monitor', 'בודק המלאי':'gelato_stock',
  'איש הטכנולוגיה':'cto', 'בודק האבטחה':'security', 'מפיק ה-Reels':'video', 'מתכנן האסטרטגיה':'planner',
};
const AGENT_ID_TO_HE: Record<string, string> = Object.fromEntries(Object.entries(AGENT_HE_TO_ID).map(([k, v]) => [v, k]));
AGENT_ID_TO_HE['boss']   = 'הבוס';
AGENT_ID_TO_HE['tiktok'] = 'TikTok';

// =============================================================
async function fetchAgentHealth(sb: SB) {
  const since = new Date(Date.now() - 30*86400000).toISOString();
  const { data } = await sb.from('agent_runs').select('agent_id, status, created_at, summary, side_effects').gte('created_at', since).order('created_at', { ascending: false }).limit(800);
  const map: Record<string, { last_run: string | null; status: string | null; summary: string | null; side_effects: Record<string, unknown> | null; error: string | null; runs_24h: number; done_24h: number }> = {};
  const cutoff24h = Date.now() - 24*3600000;
  for (const r of (data || [])) {
    const row = r as Record<string, unknown>;
    const a = row.agent_id as string;
    if (!map[a]) {
      map[a] = {
        last_run: row.created_at as string,
        status: row.status as string,
        summary: (row.summary as string) || null,
        side_effects: (row.side_effects as Record<string, unknown>) || null,
        error: row.status === 'failed' ? (extractError(row.side_effects) || (row.summary as string) || null) : null,
        runs_24h: 0, done_24h: 0,
      };
    }
    const t = new Date(row.created_at as string).getTime();
    if (t >= cutoff24h) {
      map[a].runs_24h++;
      if (row.status === 'completed' || row.status === 'ok') map[a].done_24h++;
    }
  }
  return map;
}

async function fetchDailySnapshots(sb: SB) {
  const { data } = await sb.from('daily_snapshots').select('snapshot_date, revenue_usd, orders_today').order('snapshot_date', { ascending: false }).limit(14);
  return ((data || []).map(s => ({ snapshot_date: (s as Record<string, unknown>).snapshot_date as string, revenue_usd: num((s as Record<string, unknown>).revenue_usd), orders_today: num((s as Record<string, unknown>).orders_today) }))).reverse();
}

// =============================================================
// Real business metrics — truth-driven (2026-06-15 fix).
// Four lies the old report told oren:
//  1. "Net Profit" = revenue - ad-spend (IGNORED Gelato COGS) → faked a green profit.
//  2. Revenue counted Hila's internal checkout-validation orders (still 'pending').
//  3. External pageviews = page_views_today * 7 (~40× wrong vs real 7d count).
// This helper computes the honest figures once and feeds both the hero strip
// and the $1k plan KPI sync. DUBIS is deliberately in a loss-leader phase
// (negative IL margin on purpose — see decisions.md 2026-06-13), so a
// negative/low margin is EXPECTED and must NEVER be dressed up as profit.
// =============================================================

// Internal/test buyers whose orders must NOT count as business revenue.
// Sourced from the HIGHLIGHTED_ORDERS spotlight list (defined later) + any
// obvious test markers. Kept lowercase for case-insensitive comparison.
const INTERNAL_BUYER_EMAILS = ['hilateharlev@gmail.com', 'teharlev1976@gmail.com', 'dubis.brand@gmail.com'];
function isInternalBuyer(email: string | null | undefined): boolean {
  const e = (email || '').toLowerCase().trim();
  if (!e) return false;
  if (INTERNAL_BUYER_EMAILS.includes(e)) return true;
  return /(\+test|test@|@example\.|dubis-test)/i.test(e);
}

interface RealMetrics {
  realRevenue: number;       // external paid customer revenue in window
  realOrderCount: number;
  testRevenue: number;       // internal/test revenue (Hila etc.) — labelled, never headline
  testOrderCount: number;
  cogs: number | null;       // Gelato COGS for real orders, null if unknown
  netProfit: number | null;  // realRevenue - cogs - adSpend, null if cogs unknown
  cogsCoverage: number;      // 0..1 fraction of real-order items with a cost lookup
  pageViews7d: number | null;// real external pageviews last 7d (RPC), null on failure
}

async function fetchRealMetrics(sb: SB, windowDays: number, adSpend: number): Promise<RealMetrics> {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  // Orders in window — pull buyer_email + items so we can split internal vs real
  // AND price the COGS per variant.
  const { data: orders } = await sb.from('orders')
    .select('id, total_amount, status, buyer_email, items, is_test, created_at')
    .eq('is_test', false)
    .neq('status', 'cancelled')
    .gte('created_at', since);

  // Variant cost map: "id|color|size" → gelato_cost_usd (IL fulfillment cost).
  const variantCost: Record<string, number> = {};
  try {
    const { data: pvs } = await sb.from('product_variant_stock')
      .select('product_id_numeric, color, size, gelato_cost_usd')
      .not('gelato_cost_usd', 'is', null);
    for (const r of (pvs || [])) {
      const row = r as Record<string, unknown>;
      const c = Number(row.gelato_cost_usd);
      if (c > 0) variantCost[`${row.product_id_numeric}|${row.color}|${row.size}`] = c;
    }
  } catch (_) { /* cost map best-effort */ }

  let realRevenue = 0, realOrderCount = 0, testRevenue = 0, testOrderCount = 0;
  let cogs = 0, itemsWithCost = 0, itemsTotal = 0;
  for (const o of (orders || [])) {
    const row = o as Record<string, unknown>;
    const amt = Number(row.total_amount) || 0;
    if (isInternalBuyer(row.buyer_email as string)) {
      testRevenue += amt; testOrderCount++;
      continue; // never price COGS for internal/test orders
    }
    realRevenue += amt; realOrderCount++;
    const items = Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>) : [];
    for (const it of items) {
      itemsTotal++;
      const qty = Number(it.quantity) || 1;
      const key = `${Number(it.id)}|${it.selectedColor}|${it.selectedSize}`;
      const c = variantCost[key];
      if (c != null) { cogs += c * qty; itemsWithCost++; }
    }
  }

  const cogsCoverage = itemsTotal > 0 ? itemsWithCost / itemsTotal : 0;
  // Only report a net-profit number when we could price (almost) every item;
  // otherwise null → the report shows "—" + a loss-leader note rather than a lie.
  const cogsKnown = realOrderCount === 0 ? true : cogsCoverage >= 0.6;
  const netProfit = cogsKnown ? (realRevenue - cogs - adSpend) : null;

  // Real external pageviews last 7d via the RPC (excludes is_internal, bypasses
  // the PostgREST 1000-row ceiling — decisions.md 2026-05-24).
  let pageViews7d: number | null = null;
  try {
    const { data: pv } = await sb.rpc('admin_page_views_summary', { days_back: 30 });
    const summary = (pv as Record<string, unknown>) || {};
    const v = Number(summary.views_7d);
    if (Number.isFinite(v)) pageViews7d = v;
  } catch (_) { /* RPC best-effort */ }

  return {
    realRevenue, realOrderCount, testRevenue, testOrderCount,
    cogs: cogsKnown ? cogs : null,
    netProfit, cogsCoverage,
    pageViews7d,
  };
}

// =============================================================
// $1,000 Plan tracker — added 2026-05-27.
// Reads plan_milestones (plan_id = road_to_1000_2026-04-28) and produces
// a daily snapshot: KPI rows with color coding, oren-blocked items,
// current phase, completion %. All best-effort: any failure returns null
// and the boss email omits the section silently.
// =============================================================
const PLAN_ID = 'road_to_1000_2026-04-28';
const W7_TARGET_DATE = '2026-06-15';

interface PlanKpi { title: string; current: string; target: string; color: 'green' | 'yellow' | 'red'; icon: string; }
interface PlanBlocked { title: string; oren_action: string; days_late: number; }
interface PlanStatus {
  total_actionable: number;
  done_count: number;
  in_progress_count: number;
  current_phase: number;
  phase_name: string;
  completion_pct: number;
  days_to_w7: number;
  blocked_on_oren: PlanBlocked[];
  kpis: PlanKpi[];
}

function parseKpiNumber(s: string): number | null {
  if (!s) return null;
  const m = String(s).match(/-?\$?[\d,]+\.?\d*/);
  if (!m) return null;
  const n = Number(m[0].replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function classifyKpi(title: string, currentStr: string): { color: 'green' | 'yellow' | 'red'; icon: string } {
  const cur = parseKpiNumber(currentStr);
  const lt = title.toLowerCase();
  let color: 'green' | 'yellow' | 'red' = 'yellow';
  if (cur === null) {
    color = 'yellow';
  } else if (/pageview|page view|visit|כניס|תנוע/i.test(lt)) {
    color = cur > 250 ? 'green' : cur >= 150 ? 'yellow' : 'red';
  } else if (/sales|מכיר|order|הזמנ/i.test(lt)) {
    color = cur >= 1 ? 'green' : 'red';
  } else if (/subscri|מייל|מנוי|email|newsletter/i.test(lt)) {
    color = cur > 40 ? 'green' : cur >= 20 ? 'yellow' : 'red';
  } else if (/profit|רווח|net/i.test(lt)) {
    // Loss-leader phase (decisions.md 2026-06-13): a negative/low margin is
    // INTENTIONAL, not a failure. Never paint it green unless real profit is
    // genuinely positive AND large enough to not be noise. The text marker
    // "שלב הפסד-מכוון" (cur === null) is neutral, not a warning.
    if (cur === null) { color = 'yellow'; }
    else if (cur > 50) { color = 'green'; }
    else if (cur >= 0) { color = 'yellow'; }
    else { color = 'red'; }
  }
  const icon = color === 'green' ? '🟢' : color === 'yellow' ? '🟡' : '🔴';
  return { color, icon };
}

async function syncPlanKpisFromSnapshot(sb: SB, metrics: RealMetrics): Promise<{ updated: number; errors: string[] }> {
  const out = { updated: 0, errors: [] as string[] };
  try {
    const { data: snap } = await sb.from('daily_snapshots')
      .select('snapshot_date, page_views_today, subscribers_total, orders_today, revenue_usd, campaigns_spend_total')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = (snap as Record<string, unknown>) || {};
    // Pageviews: REAL trailing-7d external count from the RPC (excludes internal,
    // bypasses 1000-row ceiling). Never page_views_today*7 — that was ~40× wrong.
    const pageViewsWeekly = metrics.pageViews7d != null ? metrics.pageViews7d : null;
    const subs = Math.round(num(s.subscribers_total));
    // Orders KPI = REAL external orders only (excludes Hila/internal).
    const ordersWeekly = metrics.realOrderCount;
    // Net profit = REAL revenue − Gelato COGS − ad spend. We are intentionally a
    // loss-leader, so this is expected to be negative/low. If COGS is unknown
    // (no cost lookup) we write the loss-leader marker instead of a fake number.
    const profitStr = metrics.netProfit == null
      ? 'שלב הפסד-מכוון'
      : (metrics.netProfit >= 0 ? `$${Math.round(metrics.netProfit)}` : `-$${Math.abs(Math.round(metrics.netProfit))}`);

    const { data: kpiRows } = await sb.from('plan_milestones')
      .select('id, title')
      .eq('plan_id', PLAN_ID)
      .eq('is_kpi', true);
    for (const r of (kpiRows || [])) {
      const row = r as Record<string, unknown>;
      const title = String(row.title || '').toLowerCase();
      let newVal: string | null = null;
      if (/pageview|page view|visit|כניס|תנוע/i.test(title)) newVal = pageViewsWeekly != null ? String(pageViewsWeekly) : null;
      else if (/sales|מכיר|order|הזמנ/i.test(title)) newVal = String(ordersWeekly);
      else if (/subscri|מייל|מנוי|email|newsletter/i.test(title)) newVal = String(subs);
      else if (/profit|רווח|net/i.test(title)) newVal = profitStr;
      if (newVal !== null) {
        const { error } = await sb.from('plan_milestones')
          .update({ kpi_current: newVal })
          .eq('id', row.id as string);
        if (error) out.errors.push(`${row.id}: ${error.message}`);
        else out.updated++;
      }
    }
  } catch (e) {
    out.errors.push((e as Error).message);
  }
  return out;
}

async function fetchPlanStatus(sb: SB): Promise<PlanStatus | null> {
  try {
    const { data } = await sb.from('plan_milestones')
      .select('id, phase, phase_name, title, status, due_date, is_kpi, kpi_current, kpi_target, oren_action')
      .eq('plan_id', PLAN_ID)
      .order('phase', { ascending: true });
    if (!data || data.length === 0) return null;
    const ml = data as Array<Record<string, unknown>>;

    let currentPhase = 1;
    let phaseName = '';
    for (const p of [1, 2, 3, 4]) {
      const phaseItems = ml.filter(m => m.phase === p && !m.is_kpi);
      if (phaseItems.length === 0) continue;
      const allDone = phaseItems.every(m => m.status === 'done');
      phaseName = String((phaseItems[0] as Record<string, unknown>).phase_name || '');
      if (!allDone) { currentPhase = p; break; }
      currentPhase = p;
    }

    const actionable = ml.filter(m => !m.is_kpi);
    const total = actionable.length;
    const done = actionable.filter(m => m.status === 'done').length;
    const inProgress = actionable.filter(m => m.status === 'in_progress').length;

    const blocked: PlanBlocked[] = ml
      .filter(m => m.status === 'blocked_on_oren')
      .map(m => {
        const dueStr = m.due_date ? String(m.due_date) : '';
        const daysLate = dueStr ? Math.max(0, Math.floor((Date.now() - new Date(dueStr).getTime()) / 86400000)) : 0;
        return {
          title: String(m.title || ''),
          oren_action: String(m.oren_action || ''),
          days_late: daysLate,
        };
      });

    const kpis: PlanKpi[] = ml.filter(m => m.is_kpi).map(k => {
      const title = String(k.title || '').replace(/\s*\(W7 target\).*$/i, '').trim();
      const current = String(k.kpi_current ?? '?');
      const target = String(k.kpi_target ?? '?');
      const cls = classifyKpi(title, current);
      return { title, current, target, color: cls.color, icon: cls.icon };
    });

    const w7Ms = new Date(`${W7_TARGET_DATE}T00:00:00Z`).getTime();
    const daysToW7 = Math.max(0, Math.ceil((w7Ms - Date.now()) / 86400000));
    const completion = total > 0 ? Math.round((done / total) * 100) : 0;

    return {
      total_actionable: total,
      done_count: done,
      in_progress_count: inProgress,
      current_phase: currentPhase,
      phase_name: phaseName,
      completion_pct: completion,
      days_to_w7: daysToW7,
      blocked_on_oren: blocked,
      kpis,
    };
  } catch (_) {
    return null;
  }
}

function buildPlanSectionHtml(p: PlanStatus): string {
  const KPI_COLOR: Record<string, string> = { green: '#27ae60', yellow: '#e67e22', red: '#c0392b' };
  const phaseLabel = p.phase_name ? `${p.phase_name}` : '';
  const kpiRows = p.kpis.length === 0
    ? '<tr><td dir="rtl" style="padding:8px;color:#888;font-size:12px">אין מדדי הצלחה מוגדרים בתוכנית</td></tr>'
    : p.kpis.map(k => `<tr style="border-bottom:1px solid #f0ebe0">
        <td dir="rtl" style="padding:8px 10px;text-align:right;font-size:12.5px;color:#2c2c2c;vertical-align:middle">${k.icon} ${esc(k.title)}</td>
        <td dir="rtl" style="padding:8px 10px;text-align:right;font-size:12.5px;color:${KPI_COLOR[k.color]};font-weight:700;vertical-align:middle;direction:rtl">${esc(k.current)} <span style="color:#999;font-weight:400">מתוך</span> <span style="color:#c8a96e">${esc(k.target)}</span></td>
      </tr>`).join('');

  const blockedHtml = p.blocked_on_oren.length === 0
    ? '<p dir="rtl" style="color:#27ae60;font-size:12.5px;margin:0">✅ אין פריטים שמחכים לך — אפשר להמשיך הלאה</p>'
    : p.blocked_on_oren.map(b => {
        const lateBadge = b.days_late > 0
          ? ` <span style="background:#c0392b;color:#fff;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700;margin-right:4px">חוסם ${b.days_late} ימים</span>`
          : '';
        const actionHtml = b.oren_action
          ? `<div dir="rtl" style="margin-top:6px;padding:8px 10px;background:#f0fbf4;border-radius:4px;color:#1e6e3a;font-size:11.5px;line-height:1.55"><b>פעולה דרושה ממך:</b> ${esc(b.oren_action)}</div>`
          : '';
        return `<div dir="rtl" style="padding:10px 12px;background:#fff5f5;border-right:3px solid #c0392b;margin:6px 0;border-radius:4px;text-align:right">
          <div style="font-size:13px;color:#2c2c2c;font-weight:600">🚧 ${esc(b.title)}${lateBadge}</div>
          ${actionHtml}
        </div>`;
      }).join('');

  const daysColor = p.days_to_w7 <= 7 ? '#c0392b' : p.days_to_w7 <= 21 ? '#e67e22' : '#c8a96e';
  const pctBarColor = p.completion_pct >= 60 ? '#27ae60' : p.completion_pct >= 30 ? '#e67e22' : '#c0392b';

  return `<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right">
    <h2 dir="rtl" style="margin:0 0 4px;font-size:17px;direction:rtl;text-align:right">📊 תוכנית $1,000 — מצב היום</h2>
    <p dir="rtl" style="margin:0 0 16px;color:#666;font-size:12.5px">
      🎯 אסטרטגיה נוכחית: loss-leader → מדידה → אורגני → ממומן. היעד עכשיו: ביקוש אמיתי, לא $1k בלו"ז קשיח.
      <span style="color:#ccc"> · </span>
      פאזה: <b style="color:#c8a96e">${p.current_phase}${phaseLabel ? ' — ' + esc(phaseLabel) : ''}</b>
    </p>

    <div dir="rtl" style="margin:0 0 14px">
      <div dir="rtl" style="font-size:13px;color:#444;font-weight:700;margin:0 0 8px">מדדי הצלחה (בפועל מול יעד W7):</div>
      <table dir="rtl" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border-radius:6px;border-collapse:collapse">${kpiRows}</table>
    </div>

    <div dir="rtl" style="margin:0 0 14px">
      <div dir="rtl" style="font-size:13px;color:#444;font-weight:700;margin:0 0 8px">🚨 מחכה לך (אורן):</div>
      ${blockedHtml}
    </div>

    <div dir="rtl" style="margin:0;padding:10px 14px;background:#f8f6f0;border-radius:6px;direction:rtl;text-align:right">
      <div dir="rtl" style="font-size:12.5px;color:#444;margin:0 0 6px">📈 התקדמות: <b>${p.done_count}/${p.total_actionable}</b> שלבים הושלמו${p.in_progress_count > 0 ? ` <span style="color:#888">· ${p.in_progress_count} בעבודה</span>` : ''} <span style="color:${pctBarColor};font-weight:700">(${p.completion_pct}%)</span></div>
      <div dir="rtl" style="background:#f0ebe0;border-radius:3px;height:8px;overflow:hidden;width:100%">
        <div style="background:${pctBarColor};height:100%;width:${Math.max(2, p.completion_pct)}%"></div>
      </div>
    </div>
  </td></tr><tr><td style="height:14px"></td></tr>`;
}


// =============================================================
// A.5 — Recurring issues: same recommendation 3+ days running
// =============================================================
async function fetchRecurringIssues(sb: SB, todayOpinions: Opinion[]): Promise<{ recurring: Array<{ rec: string; agent_he: string; priority: string; days: number; theme: string }>; nonRecurring: Opinion[] }> {
  const sinceDate = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  const { data: history } = await sb.from('boss_reports').select('report_date, assessment').gte('report_date', sinceDate).order('report_date', { ascending: false }).limit(7);
  // count occurrences of (theme, agent_he) over recent reports + today
  const themeCount: Record<string, { days: number; rec: string; agent_he: string; priority: string; theme: string }> = {};
  // include today
  for (const o of todayOpinions) {
    const key = `${o.theme}|${o.agent_he}`;
    themeCount[key] = { days: 1, rec: o.recommendation, agent_he: o.agent_he, priority: o.priority, theme: o.theme };
  }
  // walk historical reports
  for (const row of (history || [])) {
    const a = (row as Record<string, unknown>).assessment as Record<string, unknown> | null;
    const items = (a?.action_items as Array<Record<string, unknown>>) || [];
    const seenInRow = new Set<string>();
    for (const it of items) {
      const theme = (it.theme as string) || '';
      const agent_he = (it.agent_he as string) || '';
      const key = `${theme}|${agent_he}`;
      if (!key || seenInRow.has(key)) continue;
      seenInRow.add(key);
      if (themeCount[key]) themeCount[key].days++;
    }
  }
  const recurring = Object.values(themeCount).filter(v => v.days >= 3).sort((a, b) => b.days - a.days);
  const recurringKeys = new Set(recurring.map(r => `${r.theme}|${r.agent_he}`));
  const nonRecurring = todayOpinions.filter(o => !recurringKeys.has(`${o.theme}|${o.agent_he}`));
  return { recurring, nonRecurring };
}

// =============================================================
// Weekly marketing plan vs execution (2026-06-06) — surfaces the plan + progress + links
// =============================================================
// ---- TikTok post-URL backfill ----------------------------------------------
// Late.com publishes to TikTok ASYNC: the immediate POST response is status
// "publishing" with no public URL. Once TikTok finalizes, GET /posts/{id} returns
// platforms[0].platformPostId (the TikTok video id) + tiktokUsername → we build
// https://www.tiktok.com/@{user}/video/{id}. We backfill that onto the agent_tasks
// row so the daily report (next morning, after finalize) links to the real post.
let _lateKeyCache: string | null = null;
async function getLateKey(sb: SB): Promise<string | null> {
  if (_lateKeyCache !== null) return _lateKeyCache || null;
  try { const { data } = await sb.rpc('get_vault_secret', { secret_name: 'dubis_late_api_key' }); _lateKeyCache = (data || '').toString(); }
  catch { _lateKeyCache = ''; }
  return _lateKeyCache || null;
}
// A real TikTok video id is a ~19-digit numeric snowflake. Late.com, before
// the post finalizes, returns internal placeholders like `v_pub_url~v2-1.765...`
// — saving those as a /video/{id} URL produces a 404 ("Page not available").
// Guard: only treat all-digit ids of plausible length as real video ids.
const TIKTOK_PROFILE_URL = 'https://www.tiktok.com/@dubis.brand';
function isRealTiktokVideoId(id: string | null | undefined): boolean {
  return !!id && /^\d{15,}$/.test(String(id).trim());
}
async function resolveTiktokUrl(lateId: string, key: string): Promise<string | null> {
  try {
    const r = await fetch(`https://getlate.dev/api/v1/posts/${lateId}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json() as Record<string, unknown>;
    const p = (j.post as Record<string, unknown>) || j;
    const pf = ((((p.platforms as unknown[]) || [])[0]) || {}) as Record<string, unknown>;
    if (String(pf.status || '') !== 'published') return null;
    const vid = pf.platformPostId ? String(pf.platformPostId) : null;
    const user = ((pf.platformSpecificData as Record<string, unknown>)?.tiktokUsername as string) || 'dubis.brand';
    // Only persist a /video/{id} URL when {id} is a genuine numeric TikTok id.
    // A placeholder (e.g. `v_pub_url~...`) means TikTok hasn't finalized yet —
    // return null so the row stays empty and we retry next run, rather than
    // saving a guaranteed-404 link.
    if (!isRealTiktokVideoId(vid)) return null;
    return `https://www.tiktok.com/@${user}/video/${vid}`;
  } catch { return null; }
}
async function backfillTiktokUrls(sb: SB): Promise<void> {
  const key = await getLateKey(sb);
  if (!key) return;
  const since = new Date(Date.now() - 9 * 86400000).toISOString();
  const { data: rows } = await sb.from('agent_tasks').select('id, content_data').eq('agent_id', 'tiktok').eq('status', 'done').gte('updated_at', since).limit(60);
  for (const t of (rows || []) as Array<Record<string, unknown>>) {
    const cd = (t.content_data as Record<string, unknown>) || {};
    if (cd.tiktok_url) continue;
    const lateId = (cd.tiktok_late_post_id as string) || ((((cd.late_response as Record<string, unknown>)?.post) as Record<string, unknown>)?._id as string) || null;
    if (!lateId) continue;
    const url = await resolveTiktokUrl(String(lateId), key);
    if (!url) continue;
    await sb.from('agent_tasks').update({ content_data: { ...cd, tiktok_url: url } }).eq('id', t.id as string);
  }
}

// Render-time guard: a stored tiktok_url may still be a Late.com placeholder
// (e.g. .../video/v_pub_url~v2-1.765...) that 404s. Only return a /video/{id}
// link when {id} is a real numeric TikTok id; otherwise fall back to the
// public profile so oren never lands on "Page not available".
function safeTiktokUrl(rawUrl: string): string {
  const m = rawUrl.match(/\/video\/([^/?#]+)/i);
  if (!m) return TIKTOK_PROFILE_URL; // not a /video/ shape → profile
  return isRealTiktokVideoId(m[1]) ? rawUrl : TIKTOK_PROFILE_URL;
}

// Best published-post link from a content_data blob (POST itself, never the product page).
function bestPostLink(cd: Record<string, unknown>): { url: string; channel: string } | null {
  if (cd.ig_permalink) return { url: String(cd.ig_permalink), channel: 'IG' };
  if (cd.fb_permalink) return { url: String(cd.fb_permalink), channel: 'FB' };
  const tk = cd.tiktok_url ? String(cd.tiktok_url) : '';
  if (tk.startsWith('http')) return { url: safeTiktokUrl(tk), channel: 'TikTok' };
  return null;
}
const FMT_ICON: Record<string, string> = { feed_post: '🖼️', carousel: '🎠', reel: '🎬', tiktok: '🎵', story: '📖', unknown: '•' };

// Weekly plan as a 7-day calendar: each day → planned + published items with the POST link.
async function fetchWeeklyMarketing(sb: SB): Promise<{
  plan: Record<string, unknown>; weekStart: string; total: number; done: number; pending: number; backlog: number; extra: number;
  days: Array<{ date: string; label: string; items: Array<{ fmt: string; lang: string; status: string; slogan: string; platform: string; link: { url: string; channel: string } | null}> }>;
} | null> {
  const { data: plans } = await sb.from('weekly_marketing_plans').select('*').order('week_start_date', { ascending: false }).limit(1);
  const plan = (plans && plans[0]) as Record<string, unknown> | undefined;
  if (!plan) return null;
  const weekStart = String(plan.week_start_date || '').slice(0, 10);
  const startMs = new Date(weekStart + 'T00:00:00Z').getTime();
  const sinceIso = new Date(startMs).toISOString();
  const untilIso = new Date(startMs + 7 * 86400000).toISOString();
  const [{ data: contentTasks }, { data: ttTasks }] = await Promise.all([
    sb.from('agent_tasks').select('id, status, content_data, updated_at').eq('agent_id', 'content').gte('created_at', sinceIso).limit(300),
    sb.from('agent_tasks').select('status, content_data, updated_at').eq('agent_id', 'tiktok').eq('status', 'done').gte('updated_at', sinceIso).lt('updated_at', untilIso).limit(60),
  ]);
  // ONE DENOMINATOR (2026-07-10): the header counters count PLAN SLOTS only —
  // the 07-09 report showed "14/17 פורסמו · 10 בהמתנה" (14+10>17) because the done
  // counter also swallowed TikTok-GHA publishes and non-plan content tasks.
  // Published items OUTSIDE the plan are counted separately as `extra`.
  const planIds = new Set(((plan.task_ids as string[]) || []).map(String));
  const DOW_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  type Day = { date: string; label: string; items: Array<{ fmt: string; lang: string; status: string; slogan: string; platform: string; link: { url: string; channel: string } | null}> };
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startMs + i * 86400000); const date = d.toISOString().slice(0, 10);
    return { date, label: `${DOW_HE[d.getUTCDay()]} ${date.slice(5)}`, items: [] };
  });
  const byDate: Record<string, Day> = {}; for (const d of days) byDate[d.date] = d;
  let done = 0, pending = 0, backlog = 0, extra = 0;
  for (const t of (contentTasks || []) as Array<Record<string, unknown>>) {
    const cd = (t.content_data as Record<string, unknown>) || {};
    const st = String(t.status || '');
    if (planIds.has(String(t.id))) {
      if (st === 'done') done++; else if (st === 'backlog') backlog++; else pending++;
    } else if (st === 'done') { extra++; }
    const sched = String(cd.scheduled_for || '').slice(0, 10);
    const day = byDate[sched] || (st === 'done' ? byDate[String(t.updated_at || '').slice(0, 10)] : null);
    if (!day) continue;
    day.items.push({ fmt: String(cd.format || 'feed_post'), lang: String(cd.lang || cd.language || ''), status: st, slogan: String(cd.product_slogan || cd.slogan || cd.caption_he || cd.caption_en || '').slice(0, 46), platform: String(cd.platform || cd.channel || ''), link: bestPostLink(cd) });
  }
  for (const t of (ttTasks || []) as Array<Record<string, unknown>>) {
    const cd = (t.content_data as Record<string, unknown>) || {};
    const day = byDate[String(t.updated_at || '').slice(0, 10)];
    if (!day) continue;
    extra++;
    day.items.push({ fmt: 'tiktok', lang: String(cd.lang || ''), status: 'done', slogan: String(cd.product_slogan || cd.slogan || '').slice(0, 46), platform: 'tiktok', link: bestPostLink(cd) });
  }
  for (const d of days) d.items.sort((a, b) => (a.status === 'done' ? -1 : 1) - (b.status === 'done' ? -1 : 1));
  const total = (plan.total_slots as number) || (done + pending + backlog);
  return { plan, weekStart, total, done, pending, backlog, extra, days };
}

// 2026-07-12 SIMPLIFICATION (oren: "התוכנית השבועית נורא עמוסה — בלי כל האייקונים,
// רק מה מתוכנן ובאיזו פלטפורמה"): plain text per day — "פוסט · IG+FB · <סלוגן>".
// Detail about what actually went up (captions, thumbnails, links) lives in the
// "מה פורסם בפועל" section — NOT here.
function buildWeeklyMarketingHtml(wm: Awaited<ReturnType<typeof fetchWeeklyMarketing>>): string {
  if (!wm) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right">אין תוכנית שבועית פעילה — נוצרת אוטומטית כל יום ראשון בבוקר.</p>';
  const pct = wm.total > 0 ? Math.round(wm.done / wm.total * 100) : 0;
  const FMT_HE_PLAIN: Record<string, string> = { feed_post: 'פוסט', reel: 'ריל', carousel: 'קרוסלה', story: 'סטורי', tiktok: 'טיקטוק', unknown: 'פוסט' };
  const netPlain = (platform: string, fmt: string): string => {
    const p = (platform || '').toLowerCase();
    if (fmt === 'tiktok' || p.includes('tiktok')) return 'TikTok';
    const nets: string[] = [];
    if (p.includes('instagram') || p.includes('ig')) nets.push('אינסטגרם');
    if (p.includes('facebook') || p.includes('fb')) nets.push('פייסבוק');
    return nets.length ? nets.join('+') : 'אינסטגרם+פייסבוק';
  };
  const dayRows = wm.days.map(d => {
    const items = d.items.length
      ? d.items.map(it => {
          const stateWord = it.status === 'done' ? 'פורסם' : 'מתוכנן';
          const link = it.link ? ` · <a href="${esc(it.link.url)}" style="color:#c8a96e;font-weight:600;text-decoration:none">לפוסט →</a>` : '';
          return `<div dir="rtl" style="font-size:12px;margin:3px 0;text-align:right;color:${it.status === 'done' ? '#2c2c2c' : '#888'}">${FMT_HE_PLAIN[it.fmt] || 'פוסט'} ב${netPlain(it.platform, it.fmt)} — ${esc(it.slogan)} <span style="color:#aaa;font-size:11px">(${stateWord})</span>${link}</div>`;
        }).join('')
      : '<div style="font-size:11px;color:#ccc">אין תוכן מתוכנן</div>';
    return `<tr><td valign="top" style="padding:6px 8px;border-bottom:1px solid #f0ece0;white-space:nowrap;font-weight:700;font-size:12px;color:#2c2c2c">${esc(d.label)}</td><td valign="top" style="padding:6px 8px;border-bottom:1px solid #f0ece0">${items}</td></tr>`;
  }).join('');
  return `<p dir="rtl" style="font-size:13.5px;margin:0;text-align:right"><b>${wm.done} מתוך ${wm.total} פריטי-התוכנית פורסמו (${pct}%)</b>${wm.extra > 0 ? ` · ועוד ${wm.extra} פרסומים מחוץ לתוכנית` : ''}</p>
  <div style="background:#eee;border-radius:8px;height:10px;overflow:hidden;margin:6px 0"><div style="background:#c8a96e;height:10px;width:${pct}%"></div></div>
  <table dir="rtl" width="100%" style="border-collapse:collapse;margin-top:6px">${dayRows}</table>`;
}

// Agent-personas series ("מאחורי הקוד") — what published in 24h + who's next
// =============================================================
const PERSONA_HE: Record<string, string> = {
  boss:'גדי (הבוס)', supply:'משה (אספקה)', email:'מירי (שירות)', content:'שירה (תוכן)',
  cto:'רון (CTO)', design:'נועה (עיצוב)', marketing:'איתי (שיווק)', planner:'דורון (תכנון)',
  product:'טל (מוצר)', security:'בני (אבטחה)', siteaudit:'אורית (בקרת אתר)', video:'ליאת (וידאו)', team:'כל הצוות',
};
async function fetchPersonaSeries(sb: SB): Promise<{
  published: Array<{ persona: string; fb: string | null; ig: string | null }>;
  next: { persona: string; seq: number } | null;
  remaining: number;
} | null> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: rows } = await sb.from('agent_tasks')
    .select('status, content_data, updated_at')
    .eq('agent_id', 'content')
    .filter('content_data->>series', 'eq', 'agent_personas')
    .order('updated_at', { ascending: false }).limit(60);
  if (!rows) return null;
  const published: Array<{ persona: string; fb: string | null; ig: string | null }> = [];
  const frozen: Array<{ persona: string; seq: number }> = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const cd = (r.content_data as Record<string, unknown>) || {};
    const persona = String(cd.persona || '');
    const st = String(r.status || '');
    const frozenFlag = cd.publish_frozen === true || String(cd.publish_frozen || '') === 'true';
    if (st === 'done' && String(r.updated_at || '') >= since) {
      published.push({ persona, fb: (cd.fb_permalink as string) || null, ig: (cd.ig_permalink as string) || null });
    }
    if (st === 'approved' && frozenFlag) frozen.push({ persona, seq: Number(cd.persona_seq || 0) });
  }
  frozen.sort((a, b) => a.seq - b.seq);
  return { published, next: frozen[0] || null, remaining: frozen.length };
}
function buildPersonaSeriesHtml(ps: Awaited<ReturnType<typeof fetchPersonaSeries>>): string {
  if (!ps) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right">סדרת הסוכנים — אין נתונים.</p>';
  const pub = ps.published.length
    ? ps.published.map(p => {
        const links = [
          p.fb ? `<a href="${esc(p.fb)}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ FB</a>` : '',
          p.ig ? `<a href="${esc(p.ig)}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ IG</a>` : '',
        ].filter(Boolean).join(' · ');
        return `<div dir="rtl" style="font-size:12.5px;margin:4px 0;text-align:right">🐻 <b>${esc(PERSONA_HE[p.persona] || p.persona)}</b> פורסם ${links}</div>`;
      }).join('')
    : '<div style="font-size:12px;color:#999">לא עלה פוסט-סדרה ב-24 השעות האחרונות.</div>';
  const next = ps.next
    ? `<p dir="rtl" style="font-size:12.5px;margin:10px 0 0;text-align:right">📅 <b>הבא בתור (12:00 היום):</b> ${esc(PERSONA_HE[ps.next.persona] || ps.next.persona)}</p>`
    : '<p dir="rtl" style="font-size:12px;color:#999;margin:10px 0 0;text-align:right">תור ההיכרות הסתיים — עוברים לתוכן נרטיבי + 3/שבוע.</p>';
  return `<p dir="rtl" style="font-size:13px;margin:0 0 6px;text-align:right"><b>"מאחורי הקוד — יומן הסוכנים"</b> · נשארו ${ps.remaining} דמויות בתור</p>${pub}${next}`;
}

// Auto-product pipeline health (2026-06-09) — control surface for the weekly
// autonomous slogan→product flow. Reads agent_runs self-heal markers
// (auto_product_retry / auto_product_failed) + the queue + the latest auto product
// so oren has ONE daily line confirming the flow works even when runs hiccup.
// 2026-06-20 — classify a pipeline/run error correctly.
// A TECHNICAL failure (GHA / build / timeout / 5xx) is the only thing that goes in
// the red "needs manual check" box. A `cancelled` row whose last_error is a human
// visual reject (oren_visual_reject / mockup_visual_issue) is a CORRECT decision,
// NOT a system failure — it must NEVER be reported as "GHA workflow failed".
const VISUAL_REJECT_RX = /visual_reject|oren_|mockup_visual/i;
const TECH_FAIL_RX = /workflow|gha|previews|timeout|500|502|503|504|error|exception|build failed/i;
function isTechnicalPipelineFailure(status: string | null | undefined, lastError: string | null | undefined): boolean {
  const st = String(status || '').toLowerCase();
  const err = String(lastError || '');
  if (VISUAL_REJECT_RX.test(err)) return false;          // human decision, not a tech fault
  if (st === 'failed') return true;                       // explicit failed = technical
  if (TECH_FAIL_RX.test(err)) return true;               // error text smells technical
  return false;                                          // cancelled / other → not technical
}

// Asset-gate (2026-06-28): surface ACTIVE products that have NO reel in the bank, so a
// product without a usable reel never goes invisible again. The TikTok rotation + the
// weekly plan's reel slots both need product-{pid}-FINAL-EN.mp4; missing ones silently
// degrade to feed posts. Reels are generated on-demand via the Higgsfield MCP (runbook).
async function fetchReelBankGaps(sb: SB): Promise<{ total: number; withReel: number; missing: number[] } | null> {
  const { data: prods } = await sb.from('dubis_products')
    .select('product_id_numeric').eq('active', true).order('product_id_numeric', { ascending: true });
  const ids = (prods || []).map((p: Record<string, unknown>) => Number(p.product_id_numeric)).filter(Boolean);
  if (!ids.length) return null;
  const base = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object/public/video-assets/_pilot';
  const checks = await Promise.all(ids.map(async (id) => {
    try { const r = await fetch(`${base}/product-${id}-FINAL-EN.mp4`, { method: 'HEAD' }); return r.ok; }
    catch { return false; }
  }));
  const missing = ids.filter((_, i) => !checks[i]);
  return { total: ids.length, withReel: ids.length - missing.length, missing };
}
function buildReelBankGapsHtml(g: { total: number; withReel: number; missing: number[] } | null): string {
  if (!g || !g.total) return '';
  if (!g.missing.length) return `<p dir="rtl" style="font-size:13px;color:#2e7d32;text-align:right;margin:10px 0 0">🎬 בנק הרילים מלא — ${g.withReel}/${g.total} מוצרים פעילים עם ריל.</p>`;
  return `<p dir="rtl" style="font-size:13px;color:#b26a00;text-align:right;margin:10px 0 0">🎬 בנק הרילים: ${g.withReel}/${g.total} מכוסים. <b>חסר ריל ל-${g.missing.length}:</b> ${g.missing.map((n) => '#' + n).join(', ')} — לייצר על-דרישה דרך ה-Higgsfield MCP (runbook).</p>`;
}

async function fetchAutoProductHealth(sb: SB): Promise<{
  latest: { numeric: number; slogan: string; status: string; active: boolean } | null;
  retries7d: number;
  techFailures: Array<{ numeric: number; summary: string; run_id: string | null }>; // last 72h, technical only
  visualRejects: Array<{ numeric: number; reason: string }>;                          // human rejects (informational)
} | null> {
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const since72h = Date.now() - 72 * 3600000;
  const { data: prod } = await sb.from('dubis_products')
    .select('product_id_numeric, slogan, publishing_status, active, created_at')
    .eq('auto_publish', true)
    .order('created_at', { ascending: false }).limit(1);
  const p0 = (prod && prod[0]) as Record<string, unknown> | undefined;
  const latest = p0 ? {
    numeric: Number(p0.product_id_numeric || 0),
    slogan: String(p0.slogan || ''),
    status: String(p0.publishing_status || ''),
    active: p0.active === true,
  } : null;

  // self-heal retry count from agent_runs (7d), plus technical failures (72h only).
  const { data: runs } = await sb.from('agent_runs')
    .select('summary, side_effects, created_at')
    .eq('agent_id', 'product')
    .gte('created_at', since7d)
    .order('created_at', { ascending: false }).limit(40);
  let retries7d = 0;
  const techFailures: Array<{ numeric: number; summary: string; run_id: string | null }> = [];
  for (const r of (runs || []) as Array<Record<string, unknown>>) {
    const se = (r.side_effects as Record<string, unknown>) || {};
    if (se.auto_product_retry === true) retries7d++;
    if (se.auto_product_failed === true) {
      const createdMs = new Date(r.created_at as string).getTime();
      const summary = String(r.summary || '');
      // Only surface technical failures from the last 72h (older → dropped).
      if (createdMs >= since72h && isTechnicalPipelineFailure('failed', String(se.last_error || summary))) {
        techFailures.push({ numeric: Number(se.product_id_numeric || 0), summary: summary.slice(0, 100), run_id: (se.workflow_run_id as string) || null });
      }
    }
  }

  // Pipeline-queue rows in the last 7d, classified.
  const { data: q } = await sb.from('product_pipeline_queue')
    .select('product_id_numeric, status, last_error, updated_at')
    .in('status', ['failed', 'cancelled'])
    .gte('updated_at', since7d);
  const visualRejects: Array<{ numeric: number; reason: string }> = [];
  for (const row of (q || []) as Array<Record<string, unknown>>) {
    const st = String(row.status || '');
    const err = String(row.last_error || '');
    const numeric = Number(row.product_id_numeric || 0);
    const updatedMs = new Date(row.updated_at as string).getTime();
    if (VISUAL_REJECT_RX.test(err)) {
      visualRejects.push({ numeric, reason: err.slice(0, 80) });
      continue; // never a tech failure
    }
    // Technical failure only if it's genuinely technical AND fresh (≤72h).
    if (isTechnicalPipelineFailure(st, err) && updatedMs >= since72h) {
      techFailures.push({ numeric, summary: err.slice(0, 100) || `queue status=${st}`, run_id: null });
    }
  }
  return { latest, retries7d, techFailures, visualRejects };
}
function buildAutoProductHealthHtml(h: Awaited<ReturnType<typeof fetchAutoProductHealth>>): string {
  if (!h) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right">קו המוצרים האוטומטי — אין נתונים.</p>';
  const badge = (st: string, active: boolean) =>
    active ? '<span style="color:#2d6a4f;font-weight:700">✅ חי</span>'
    : st === 'failed' ? '<span style="color:#b91c1c;font-weight:700">❌ נכשל</span>'
    : st === 'pending_pipeline' ? '<span style="color:#c8a96e;font-weight:700">⏳ בתהליך</span>'
    : st === 'pending_visual_approval' ? '<span style="color:#c8a96e;font-weight:700">👀 ממתין לאישור</span>'
    : `<span style="color:#888">${esc(st)}</span>`;
  const latestHtml = h.latest
    ? `<p dir="rtl" style="font-size:12.5px;margin:0 0 6px;text-align:right">מוצר אוטומטי אחרון: <b>#${h.latest.numeric}</b> "${esc(h.latest.slogan)}" — ${badge(h.latest.status, h.latest.active)}${h.latest.active ? ` · <a href="https://www.dubis.net/#product-${h.latest.numeric}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ לדף המוצר</a>` : ''}</p>`
    : '<p dir="rtl" style="font-size:12px;color:#999;text-align:right">עדיין לא נוצר מוצר אוטומטי.</p>';
  const stats = `<p dir="rtl" style="font-size:12.5px;margin:0 0 6px;text-align:right">🔁 ${h.retries7d} ריצות-תיקון אוטומטיות (self-heal) · 🔧 ${h.techFailures.length} כשלים טכניים (72ש׳) · 👤 ${h.visualRejects.length} נדחו ידנית (ויזואלי)</p>`;
  // Visual rejects = a CORRECT human decision, shown in a neutral grey note (never red).
  const rejectsNote = h.visualRejects.length === 0 ? '' :
    `<div dir="rtl" style="background:#f5f5f5;border-right:3px solid #999;padding:8px 12px;border-radius:6px;margin-top:6px;text-align:right;font-size:12px;color:#555">👤 נדחו ידנית (ויזואלי) — החלטה תקינה, לא תקלה: ${h.visualRejects.map(r => `#${r.numeric || '?'}`).join(', ')}</div>`;
  // RED box only for genuine technical failures in the last 72h.
  let alert = '';
  if (h.techFailures.length) {
    const list = h.techFailures.map(f => `<li>#${f.numeric || '?'} — ${esc(f.summary)}${f.run_id ? ` · <a href="https://github.com/dubis-brand/dubis-website/actions/runs/${f.run_id}" style="color:#c8a96e">לוג</a>` : ''}</li>`).join('');
    alert = `<div dir="rtl" style="background:#fdecea;border-right:3px solid #b91c1c;padding:8px 12px;border-radius:6px;margin-top:6px;text-align:right"><b style="color:#b91c1c">דורש בדיקה ידנית — כשל טכני (72 שעות):</b><ul style="margin:6px 0;padding-right:18px;font-size:12px">${list}</ul></div>`;
  } else {
    alert = '<p dir="rtl" style="font-size:12px;color:#2d6a4f;text-align:right">✅ הצינור תקין — אין כשלים טכניים פתוחים.</p>';
  }
  return latestHtml + stats + alert + rejectsNote;
}

// Marketing-today (v9) — caption pulled from extensive field chain
// =============================================================
async function fetchMarketingToday(sb: SB): Promise<{
  total: number;
  byFormat: Record<string, number>;
  items: Array<{ format: string; caption: string; ig: string | null; fb: string | null; product_id: string | null; product_url: string | null; image: string | null; created_at: string }>;
  tiktok: { runs: number; latest: string | null; items: Array<{ caption: string; url: string | null; product_url: string | null; late_id: string | null; product_slug: string | null; created_at: string }> };
}> {
  const since = new Date(Date.now() - 24*3600000).toISOString();
  const { data: tasks } = await sb.from('agent_tasks')
    .select('title, content_data, updated_at')
    .eq('agent_id', 'content')
    .eq('status', 'done')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(15);
  const items: Array<{ format: string; caption: string; ig: string | null; fb: string | null; product_id: string | null; product_url: string | null; image: string | null; created_at: string }> = [];
  const byFormat: Record<string, number> = {};
  for (const t of (tasks || [])) {
    const row = t as Record<string, unknown>;
    const c = (row.content_data as Record<string, unknown>) || {};
    const fmt = (c.format as string) || 'unknown';
    byFormat[fmt] = (byFormat[fmt] || 0) + 1;
    // A.1 — exhaustive caption fallback chain so we never show "(no caption)" when data exists
    const captionSources = [
      c.caption_he, c.caption_en, c.caption, c.body, c.text, c.script,
      c.product_slogan, c.slogan, row.title,
    ];
    const caption = String(captionSources.find(v => typeof v === 'string' && (v as string).trim().length > 0) || '');
    items.push({
      format: fmt,
      caption: caption.slice(0, 240),
      ig: (c.ig_permalink as string) || null,
      fb: (c.fb_permalink as string) || null,
      product_id: c.product_id ? String(c.product_id) : null,
      product_url: (c.product_url as string) || null,
      image: (c.image_url as string) || (c.media_url as string) || null,
      created_at: row.updated_at as string,
    });
  }
  // TikTok — read from agent_tasks (carries the real tiktok_url after backfill, plus caption + product).
  // (agent_runs is still used for staleness elsewhere; the URL only lives on the task row.)
  const { data: ttTasks } = await sb.from('agent_tasks')
    .select('content_data, updated_at')
    .eq('agent_id', 'tiktok')
    .eq('status', 'done')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(6);
  const tiktokItems = (ttTasks || []).map(r => {
    const cd = ((r as Record<string, unknown>).content_data as Record<string, unknown>) || {};
    const rawTt = (cd.tiktok_url as string) || '';
    return {
      caption: String(cd.caption || cd.product_slogan || cd.slogan || '').slice(0, 240),
      // Sanitize: bad/placeholder ids → public profile (never a 404 /video/ link).
      url: rawTt.startsWith('http') ? safeTiktokUrl(rawTt) : null,
      product_url: (cd.product_url as string) || null,
      late_id: cd.tiktok_late_post_id ? String(cd.tiktok_late_post_id).slice(0, 16) : null,
      product_slug: cd.persona_id ? String(cd.persona_id) : null,
      created_at: (r as Record<string, unknown>).updated_at as string,
    };
  });
  const tiktok = { runs: (ttTasks || []).length, latest: tiktokItems[0]?.created_at || null, items: tiktokItems };
  return { total: items.length, byFormat, items, tiktok };
}

// =============================================================
// B.10 — Per-order daily tracking. Oren's directive 2026-05-20:
// "בכל הזמנה אמיתית חדשה כל יום יהיה מעקב על תהליך ההזמנה ויגיע אלי במייל"
// One row per active real order, what changed in last 24h, status + days.
// =============================================================
// Highlighted-order tracking — Hila's order (manual ask 2026-05-23). Always
// surfaced separately even if older than the 30-day window. Add more rows here
// when oren wants another order in the spotlight.
// 2026-06-21 (oren): emptied. Hila is the internal/test + loss-leader account; her
// delivered/cancelled orders dominated the tracking section as weeks-old noise.
// Internal buyers are excluded everywhere now (isInternalBuyer). To spotlight a REAL
// customer order, add them here.
const HIGHLIGHTED_ORDERS: Array<{ name_he: string; email?: string; gelato_prefix?: string }> = [];

// Shared human-readable order-status map (our statuses + raw Gelato statuses).
// Module-level so both the "new orders" list and the tracking section use it.
const ORDER_STATUS_HE: Record<string, string> = {
  'pending': '⏳ בהמתנה', 'paid': '⏳ בהמתנה (שולם)', 'created': '⏳ בהמתנה', 'open': '⏳ בהמתנה',
  'in_production': '🛠️ בייצור', 'in-production': '🛠️ בייצור', 'passed': '🛠️ בייצור',
  'passed_to_production': '🛠️ בייצור', 'printed': '🛠️ בייצור (הודפס)',
  'shipped': '📦 נשלח', 'in_transit': '📦 נשלח',
  'delivered': '✅ נמסר', 'fulfilled': '✅ נמסר',
  'canceled': '❌ בוטל', 'cancelled': '❌ בוטל', 'refunded': '❌ בוטל (זוכה)',
  'unknown': '❓ לא ידוע',
};
function humanOrderStatus(raw: string | null | undefined): string {
  const k = (raw || 'unknown').toLowerCase();
  return ORDER_STATUS_HE[k] || `❓ ${raw}`;
}

interface TrackedOrderRow {
  id: string;
  buyer_email: string;
  created_at: string;
  updated_at: string;
  days_in_status: number;
  age_days: number;
  status: string;
  total_amount: number;
  tracking_number: string | null;
  tracking_url: string | null;
  gelato_ref: string | null;
  handled_offline: boolean;
  changed_in_24h: boolean;
  highlight_name: string | null; // e.g. "הילה טהרלב" if matches HIGHLIGHTED_ORDERS
}

function mapOrderRow(o: Record<string, unknown>): TrackedOrderRow {
  const ageMs = Date.now() - new Date(o.created_at as string).getTime();
  const updatedMs = Date.now() - new Date((o.updated_at || o.created_at) as string).getTime();
  const email = ((o.buyer_email as string) || '').toLowerCase();
  const gelatoRef = (o.printful_order_id as string) || '';
  const highlight = HIGHLIGHTED_ORDERS.find(h =>
    (h.email && email === h.email.toLowerCase()) ||
    (h.gelato_prefix && gelatoRef.toLowerCase().startsWith(h.gelato_prefix.toLowerCase()))
  );
  return {
    id: o.id as string,
    buyer_email: (o.buyer_email as string) || '?',
    created_at: o.created_at as string,
    updated_at: (o.updated_at as string) || (o.created_at as string),
    days_in_status: Math.floor(updatedMs / 86400000),
    age_days: Math.floor(ageMs / 86400000),
    status: (o.status as string) || 'unknown',
    total_amount: num(o.total_amount),
    tracking_number: (o.tracking_number as string) || null,
    tracking_url: (o.tracking_url as string) || null,
    gelato_ref: gelatoRef || null,
    handled_offline: typeof o.gelato_ticket_id === 'string' && (o.gelato_ticket_id as string).startsWith('OREN-HANDLED-OFFLINE'),
    changed_in_24h: updatedMs < 24*3600000 && updatedMs < ageMs - 3600000,
    highlight_name: highlight?.name_he || null,
  };
}

// 2026-06-20 — order-tracking now shows ONLY orders that need attention.
// IN-PROGRESS = these statuses. delivered + cancelled + refunded are a count line,
// never per-row (oren: weeks-old delivered/cancelled noise drowned the real set).
const IN_PROGRESS_STATUSES = new Set([
  'pending', 'paid', 'created', 'open',
  'in_production', 'in-production', 'passed', 'passed_to_production',
  'printing', 'printed',
  'shipped', 'in_transit',
]);
// Internal / test / sandbox buyers must never appear in the attention list.
// (isInternalBuyer covers hila/oren/dubis.brand; this adds sandbox + empty email.)
function isNonRealTrackingBuyer(email: string | null | undefined): boolean {
  const e = (email || '').toLowerCase().trim();
  if (!e) return true;                              // empty buyer_email → not a real customer order
  if (isInternalBuyer(e)) return true;             // hila / oren / dubis.brand / *test*
  if (/hilateharlev/i.test(e)) return true;        // explicit per spec
  if (/sandbox|@personal/i.test(e)) return true;   // PayPal sandbox / personal test accounts
  return false;
}

async function fetchActiveOrdersTracking(sb: SB): Promise<{
  total: number;                 // count of attention rows (highlighted + rows)
  highlighted: TrackedOrderRow[];
  rows: TrackedOrderRow[];       // last-30-day IN-PROGRESS rows, real customers only
  deliveredCount: number;        // closed orders in window — shown as one count line
  cancelledCount: number;
}> {
  // 30-day window for normal tracking (was 90d, oren 2026-05-23: cluttered).
  const since = new Date(Date.now() - 30*86400000).toISOString();
  // Pull EVERYTHING in the window (incl. cancelled/refunded/delivered) so we can
  // count the closed ones for the summary line, then filter rows down to the
  // in-progress + real-customer set.
  const { data: orders } = await sb.from('orders')
    .select('id, buyer_email, created_at, updated_at, status, total_amount, tracking_number, tracking_url, printful_order_id, gelato_ticket_id, shipped_at')
    .eq('is_test', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  const allWindow = (orders || []) as Array<Record<string, unknown>>;
  // Real-customer subset only (drop internal/test/sandbox/empty) for both counts + rows.
  const realWindow = allWindow.filter(o => !isNonRealTrackingBuyer(o.buyer_email as string));
  const norm = (s: unknown) => String(s || 'unknown').toLowerCase();
  const deliveredCount = realWindow.filter(o => ['delivered', 'fulfilled'].includes(norm(o.status))).length;
  const cancelledCount = realWindow.filter(o => ['cancelled', 'canceled', 'refunded'].includes(norm(o.status))).length;
  const windowRows = realWindow
    .filter(o => IN_PROGRESS_STATUSES.has(norm(o.status)))
    .map(o => mapOrderRow(o));

  // Pull highlighted orders separately so they survive even if older than 30 days.
  const highlightFilters: string[] = [];
  for (const h of HIGHLIGHTED_ORDERS) {
    if (h.email) highlightFilters.push(`buyer_email.eq.${h.email}`);
    if (h.gelato_prefix) highlightFilters.push(`printful_order_id.ilike.${h.gelato_prefix}%`);
  }
  const highlightedRows: TrackedOrderRow[] = [];
  if (highlightFilters.length > 0) {
    const { data: hOrders } = await sb.from('orders')
      .select('id, buyer_email, created_at, updated_at, status, total_amount, tracking_number, tracking_url, printful_order_id, gelato_ticket_id, shipped_at')
      .eq('is_test', false)
      .or(highlightFilters.join(','))
      .order('created_at', { ascending: false });
    for (const o of (hOrders || [])) {
      const mapped = mapOrderRow(o as Record<string, unknown>);
      if (mapped.highlight_name) highlightedRows.push(mapped);
    }
  }
  // Dedupe: drop highlighted IDs from the main window list to avoid double display.
  const highlightIds = new Set(highlightedRows.map(r => r.id));
  const rows = windowRows.filter(r => !highlightIds.has(r.id));
  return { total: rows.length + highlightedRows.length, highlighted: highlightedRows, rows, deliveredCount, cancelledCount };
}

// =============================================================
// NEW products that went live this week (2026-06-15, oren ask).
// Replaces the "slogans awaiting approval" block — per DUBIS open-list policy
// every active DB slogan IS approved (no slogan-approval gate). What oren
// actually wants: which NEW products the system put live + a link to each.
// Source of truth for go-live = dubis_products.launched_at (set first-launch
// only by product-visual-approve / auto-product activation in agents/index.ts).
// =============================================================
async function fetchNewProductsThisWeek(sb: SB): Promise<Array<{
  numeric: number; slogan: string; type: string; auto: boolean; launched_at: string; days_ago: number;
}>> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await sb.from('dubis_products')
    .select('product_id_numeric, slogan, clothing_type, auto_publish, launched_at')
    .eq('active', true)
    .gte('launched_at', since)
    .order('launched_at', { ascending: false })
    .limit(12);
  return (data || []).map(r => {
    const row = r as Record<string, unknown>;
    const la = String(row.launched_at || '');
    return {
      numeric: Number(row.product_id_numeric || 0),
      slogan: String(row.slogan || ''),
      type: String(row.clothing_type || ''),
      auto: row.auto_publish === true,
      launched_at: la,
      days_ago: la ? Math.floor(hoursSince(la) / 24) : 0,
    };
  }).filter(p => p.numeric > 0);
}
// 2026-07-06 (oren): a new product is shown ONLY on the day it went live —
// never re-announced day after day. Older launches collapse to one status line.
function buildNewProductsHtml(rows: Awaited<ReturnType<typeof fetchNewProductsThisWeek>>): string {
  const TYPE_HE: Record<string, string> = {
    'tshirt':'חולצה', 't-shirt':'חולצה', 'hoodie':'קפוצון', 'zip-hoodie':'קפוצון רוכסן',
    'long-sleeve':'שרוול ארוך', 'longsleeve':'שרוול ארוך', 'tank-top':'גופייה', 'tanktop':'גופייה',
    'v-neck':'חולצת V', 'vneck':'חולצת V', 'cap':'כובע', 'cap-emb':'כובע רקום',
  };
  const fresh = rows.filter(p => p.days_ago === 0);
  if (!fresh.length) {
    const last = rows[0];
    const lastLine = last
      ? `האחרון: <b>#${last.numeric}</b> "${esc(last.slogan)}" (${esc(TYPE_HE[last.type] || last.type)}) — לפני ${last.days_ago} ימים. `
      : '';
    const cadence = last && last.days_ago > 7
      ? '<span style="color:#a12020;font-weight:600">⚠️ עברו יותר מ-7 ימים — הקצב השבועי (שלישי 09:00 UTC) דורש בדיקה.</span>'
      : 'המוצר השבועי הבא: שלישי 09:00 UTC (קרון אוטומטי).';
    return `<p dir="rtl" style="font-size:13px;color:#666;text-align:right;margin:0">אין מוצר חדש היום. ${lastLine}${cadence}</p>`;
  }
  const items = fresh.map(p => {
    const typeHe = TYPE_HE[p.type] || p.type;
    const autoBadge = p.auto ? '<span style="background:#f3eee2;border-radius:4px;padding:1px 5px;color:#7a6a4f;font-size:10px;font-weight:600;margin-right:4px">🤖 אוטומטי</span>' : '';
    return `<div dir="rtl" style="padding:8px 12px;background:#fafafa;margin:4px 0;border-radius:6px;text-align:right;font-size:12.5px;border-right:3px solid #c8a96e">
      <div style="margin-bottom:3px">✨ ${autoBadge}<b style="color:#2c2c2c">#${p.numeric}</b> ${esc(typeHe)} <span style="color:#999;font-size:11px">· עלה היום</span></div>
      <div style="color:#444;font-size:12px;margin-bottom:4px">"${esc(p.slogan)}"</div>
      <a href="https://www.dubis.net/#product-${p.numeric}" style="color:#c8a96e;font-weight:600;text-decoration:none;font-size:12px">▶ לדף המוצר →</a>
    </div>`;
  }).join('');
  return items;
}

// ── 📈 Content performance (2026-06-26) — closes the "publish into the dark" gap.
// Reads the daily post_metrics snapshots (written by agents ?type=collect-content-metrics)
// + the latest content_learnings (the weekly read), surfaces top posts + the diagnosis.
async function fetchContentPerf(sb: SB): Promise<{
  learning: { summary: string; sample_size: number; created_at: string } | null;
  posts: Array<{ eng: number; reach: number; format: string | null; product_id: number | null; permalink: string | null }>;
  reachAvailable: boolean; totalEng: number;
  siteClicks: { total: number; products: number; byProduct: Array<{ pid: number; sessions: number }> };
} | null> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: metrics } = await sb.from('post_metrics')
    .select('task_id, platform, captured_date, reach, views, likes, comments, shares, saves, format, product_id, permalink')
    .gte('captured_date', since).order('captured_date', { ascending: false }).limit(1000);
  const seen = new Set<string>();
  const byTask = new Map<string, { eng: number; reach: number; format: string | null; product_id: number | null; permalink: string | null }>();
  for (const r of (metrics || [])) {
    const row = r as Record<string, unknown>;
    const k = `${row.task_id}|${row.platform}`; if (seen.has(k)) continue; seen.add(k);
    const id = String(row.task_id);
    const a = byTask.get(id) || { eng: 0, reach: 0, format: (row.format as string) ?? null, product_id: (row.product_id as number) ?? null, permalink: (row.permalink as string) ?? null };
    a.eng += Number(row.likes || 0) + Number(row.comments || 0) + Number(row.shares || 0) + Number(row.saves || 0);
    a.reach += Number(row.reach || row.views || 0);
    if (!a.permalink && row.permalink) a.permalink = row.permalink as string;
    byTask.set(id, a);
  }
  const posts = [...byTask.values()].sort((a, b) => b.eng - a.eng);
  const reachAvailable = posts.filter(p => p.reach > 0).length >= 2;
  const totalEng = posts.reduce((s, p) => s + p.eng, 0);
  const { data: lrnRows } = await sb.from('content_learnings')
    .select('summary, sample_size, created_at, directives').order('created_at', { ascending: false }).limit(1);
  const learning = (lrnRows && lrnRows[0]) ? (lrnRows[0] as { summary: string; sample_size: number; created_at: string; directives?: Record<string, unknown> }) : null;
  // Real site clicks from social (our own funnel data — no Meta token). 30-day window for signal.
  const { data: clickData } = await sb.rpc('content_social_clicks', { days_back: 30 });
  const c = (clickData as { total_sessions?: number; product_sessions?: number; by_product?: Array<{ pid: number; sessions: number }> }) || {};
  const siteClicks = { total: c.total_sessions ?? 0, products: c.product_sessions ?? 0, byProduct: (c.by_product || []).filter(b => b.sessions > 0).slice(0, 4) };
  return { learning, posts: posts.slice(0, 6), reachAvailable, totalEng, siteClicks };
}
function buildContentPerfHtml(p: Awaited<ReturnType<typeof fetchContentPerf>>): string {
  if (!p) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right;margin:0">אין עדיין נתוני ביצועים — מנוע האיסוף ירוץ בקרון הלילה.</p>';
  const head = p.learning
    ? `<div dir="rtl" style="background:#2c2c2c;color:#fff;padding:12px 16px;border-radius:6px;margin-bottom:10px;text-align:right;font-size:12.5px;line-height:1.7">🧠 <b style="color:#c8a96e">קריאת התוכן:</b> ${esc(p.learning.summary)}</div>`
    : '';
  const sc = p.siteClicks;
  const clicksTop = sc.byProduct.length ? ' · מובילים: ' + sc.byProduct.map(b => `#${b.pid} (${b.sessions})`).join(', ') : '';
  const clicksLine = `<div dir="rtl" style="background:#f3eee2;border-radius:6px;padding:10px 14px;margin-bottom:10px;text-align:right;font-size:12.5px;color:#5a4a2f">🌐 <b>כניסות אמיתיות לאתר (30 ימים):</b> ${sc.total} · מתוכן ${sc.products} לעמודי מוצר${clicksTop}<div style="font-size:11px;color:#999;margin-top:3px">קליק = כוונה אמיתית (מנוכה בוטים/פנימי) — האות החזק יותר מ-reach, ונמדד מהנתונים שלנו בלי תלות ב-token.</div></div>`;
  const metricNote = p.reachAvailable ? '' : '<p dir="rtl" style="font-size:11px;color:#c0392b;margin:0 0 8px;text-align:right">⚠️ חשיפה (reach) מ-Meta חסומה — ה-token חסר הרשאת <code>instagram_manage_insights</code>. מודדים לייקים+תגובות + כניסות-לאתר. שדרוג ה-token (פעולה חד-פעמית) יוסיף reach + נתוני FB.</p>';
  if (!p.posts.length) return head + clicksLine + metricNote + '<p dir="rtl" style="font-size:13px;color:#888;text-align:right;margin:0">לא נמדדו פוסטים ב-7 הימים האחרונים.</p>';
  const rows = p.posts.map(it => {
    const link = it.permalink ? `<a href="${esc(it.permalink)}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ לפוסט →</a>` : '';
    return `<div dir="rtl" style="padding:8px 12px;background:#fafafa;margin:4px 0;border-radius:6px;text-align:right;font-size:12.5px;border-right:3px solid #c8a96e">
      <b style="color:#2c2c2c">${esc(it.format || 'פוסט')}</b> · מוצר #${it.product_id ?? '?'} <span style="color:#999">· ${it.eng} מעורבות${p.reachAvailable ? ` · ${it.reach} חשיפה` : ''}</span> &nbsp; ${link}
    </div>`;
  }).join('');
  return `${head}${clicksLine}${metricNote}<p dir="rtl" style="font-size:12px;color:#666;margin:0 0 8px;text-align:right">${p.posts.length} הפוסטים החזקים (7 ימים · ${p.totalEng} מעורבות סה"כ):</p>${rows}`;
}

// =============================================================
// 📬 Email digest (2026-06-15, oren ask). Reads the last-24h Gmail insights
// (agent_tasks category='gmail_insight', written by email_monitor / morning-report
// runGmailScan) → Gemini-summarizes into a short Hebrew digest + concrete
// recommended actions. HARD filters:
//   (a) DUBIS's own daily/weekly reports (subject "DUBIS דוח" / "DUBIS פגישה")
//       — the scanner self-ingests them; never echo them back.
//   (b) obvious vendor marketing newsletters (Gelato/Meta "grow your business",
//       "checklist", "newsletter", "unsubscribe"-only blasts).
// Only emails that need attention (customer mail, platform alerts, payment/
// fulfillment notices) reach the digest.
// =============================================================
const EMAIL_SELF_REPORT_RX = /(DUBIS\s*דוח|DUBIS\s*פגישה|דוח יומי|פגישה שבועית|daily report|weekly report|boss agent)/i;
const EMAIL_MARKETING_RX = /(grow your business|run your business|growth tips|newsletter|checklist|webinar|new feature|product update|tips? (and|&) tricks|unsubscribe to stop|special offer|% off|black friday|cyber monday|holiday sale|marketing|promo code|discover (new|more)|get inspired|inspiration|trending now|best ?sellers?)/i;
// 2026-07-12 REPLY LOOP (oren: "אני רוצה שדרך המיילים אוכל להשיב לכם ותוכלו לבצע"):
// a REPLY from oren to one of our own reports is a DIRECTIVE, not a self-report.
// It must survive the self-report filter, get flagged, and flow into the
// management board (the Gmail scanner already captures from:oren mail; the
// harvest pass already picks up its dubis_analysis). The report's Reply-To is
// dubis.brand@gmail.com so hitting "Reply" lands in the scanned inbox.
const OREN_SENDER_RX = /(teharlev1976@gmail\.com|dubis\.brand@gmail\.com)/i;
function isOrenReportReply(subject: string, from: string): boolean {
  return OREN_SENDER_RX.test(from) && /^(re|השב|תגובה)[:\s]/i.test(subject.trim()) && EMAIL_SELF_REPORT_RX.test(subject);
}
function emailNeedsAttention(subject: string, from: string): boolean {
  if (isOrenReportReply(subject, from)) return true;           // oren replying to a report = directive
  const s = `${subject} ${from}`;
  if (EMAIL_SELF_REPORT_RX.test(s)) return false;             // our own report bouncing back
  if (from.toLowerCase().includes('orders@dubis.net')) return false; // our own sender
  if (EMAIL_MARKETING_RX.test(subject)) return false;          // vendor marketing newsletter
  return true;
}
type EmailAnalysis = { idea?: string; relevance?: string; recommendation?: string; next_step?: string; agent?: string };
async function fetchEmailDigest(sb: SB): Promise<{
  scanned: number; kept: number; filtered: number;
  digest: string | null; actions: string[];
  emails: Array<{ subject: string; from: string; analysis: EmailAnalysis | null }>;
} | null> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: rows } = await sb.from('agent_tasks')
    .select('title, description, content_data, created_at')
    .eq('category', 'gmail_insight')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);
  const all = (rows || []) as Array<Record<string, unknown>>;
  const parsed = all.map(r => {
    // title shape: "📧 {subject}"; description: "From: {from}\n…".
    // 2026-06-20: the rewritten email_monitor also stores a structured per-email
    // analysis in content_data.dubis_analysis — prefer it when present.
    const subject = String(r.title || '').replace(/^[^\s]*\s/, '').trim();
    const desc = String(r.description || '');
    const fromMatch = desc.match(/^From:\s*(.+)$/m);
    const cd = (r.content_data || {}) as Record<string, unknown>;
    const from = String(cd.from || (fromMatch ? fromMatch[1].trim() : ''));
    const snippet = desc.replace(/^From:\s*.+$/m, '').trim().slice(0, 400);
    const analysis = (cd.dubis_analysis || null) as EmailAnalysis | null;
    return { subject, from, snippet, analysis, raw_title: String(r.title || '') };
  });
  const kept = parsed
    .filter(p => emailNeedsAttention(p.subject, p.from))
    .map(p => isOrenReportReply(p.subject, p.from) ? { ...p, subject: `📩 תשובה שלך לדוח: ${p.subject.replace(/^(re|השב|תגובה)[:\s]+/i, '').slice(0, 70)}` } : p);
  const filtered = parsed.length - kept.length;
  if (kept.length === 0) {
    return { scanned: parsed.length, kept: 0, filtered, digest: null, actions: [], emails: [] };
  }

  // If the scanner already produced per-email DUBIS analyses, surface them
  // directly — no second Gemini round-trip; the recommendations are concrete.
  const withAnalysis = kept.filter(p => p.analysis && p.analysis.recommendation);
  if (withAnalysis.length > 0) {
    const digest = withAnalysis.length === 1
      ? `מייל-רעיון אחד דורש תשומת לב: "${withAnalysis[0].subject}".`
      : `${withAnalysis.length} מיילי-רעיון מאורן/הילה דורשים תשומת לב.`;
    const actions = withAnalysis.slice(0, 6).map(p => {
      const a = p.analysis!;
      const who = a.agent ? ` [${a.agent}]` : '';
      return `${p.subject}: ${a.recommendation}${a.next_step ? ` → ${a.next_step}` : ''}${who}`.slice(0, 200);
    });
    return {
      scanned: parsed.length, kept: kept.length, filtered, digest, actions,
      emails: kept.slice(0, 8).map(e => ({
        subject: e.subject.slice(0, 90),
        from: e.from.replace(/<[^>]+>/, '').trim().slice(0, 50),
        analysis: e.analysis || null,
      })),
    };
  }

  // Fallback (no pre-computed analysis — e.g. Gemini was down during the scan):
  // summarize the raw snippets here, as before.
  let digest: string | null = null;
  let actions: string[] = [];
  const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (geminiKey) {
    try {
      const emailBlock = kept.slice(0, 12).map((e, i) => `${i + 1}. נושא: ${e.subject}\n   מאת: ${e.from}\n   תקציר: ${e.snippet}`).join('\n');
      const prompt = `אתה עוזר אישי של אורן, מפעיל יחיד של מותג אופנה (DUBIS). לפניך מיילים מ-24 השעות האחרונות שדורשים תשומת לב (כבר סוננו דיווחים עצמיים ושיווק של ספקים). סכם בקצרה בעברית מה קרה (2-4 משפטים) ותן רשימת פעולות מומלצות קונקרטיות. ענה אך ורק כ-JSON תקין בפורמט: {"summary":"...","actions":["...","..."]}. אם אין שום דבר שדורש פעולה, החזר actions ריק.\n\nמיילים:\n${emailBlock}`;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const j = await r.json() as Record<string, unknown>;
        const text = (((((j.candidates as unknown[]) || [])[0] as Record<string, unknown>)?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const obj = JSON.parse(m[0]) as { summary?: string; actions?: string[] };
          digest = obj.summary ? String(obj.summary).slice(0, 600) : null;
          actions = Array.isArray(obj.actions) ? obj.actions.map(a => String(a).slice(0, 160)).slice(0, 6) : [];
        }
      }
    } catch (_) { /* fall back to raw list */ }
  }
  return { scanned: parsed.length, kept: kept.length, filtered, digest, actions, emails: kept.slice(0, 8).map(e => ({ subject: e.subject.slice(0, 90), from: e.from.replace(/<[^>]+>/, '').trim().slice(0, 50), analysis: e.analysis || null })) };
}
function buildEmailDigestHtml(d: Awaited<ReturnType<typeof fetchEmailDigest>>): string {
  if (!d) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right;margin:0">סורק המייל לא החזיר נתונים ב-24 שעות.</p>';
  if (d.kept === 0) {
    const note = d.filtered > 0 ? ` (${d.filtered} סוננו: דיווחים עצמיים + שיווק ספקים)` : '';
    return `<p dir="rtl" style="font-size:13px;color:#27ae60;text-align:right;margin:0">✅ אין מיילים שדורשים טיפול ב-24 שעות${note}.</p>`;
  }
  const summaryHtml = d.digest
    ? `<div dir="rtl" style="background:#f8f6f0;border-radius:6px;padding:10px 12px;margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#2c2c2c;text-align:right">${esc(d.digest)}</div>`
    : '';
  const actionsHtml = d.actions.length
    ? `<div dir="rtl" style="margin:0 0 8px;text-align:right"><b style="font-size:12.5px;color:#c8a96e">פעולות מומלצות:</b>${d.actions.map(a => `<div dir="rtl" style="padding:5px 10px;background:#fff;border-right:3px solid #c8a96e;margin:3px 0;border-radius:4px;font-size:12px;text-align:right">▸ ${esc(a)}</div>`).join('')}</div>`
    : '';
  const listHtml = d.emails.length
    ? `<div dir="rtl" style="margin-top:6px;text-align:right"><div style="font-size:11px;color:#999;margin-bottom:3px">המיילים (${d.kept}, סוננו ${d.filtered}):</div>${d.emails.map(e => {
        const head = `<div dir="rtl" style="font-size:11.5px;color:#555;padding:2px 0;text-align:right">📧 <b>${esc(e.subject)}</b> <span style="color:#aaa">— ${esc(e.from)}</span></div>`;
        const a = e.analysis;
        if (!a || !a.recommendation) return head;
        const row = (label: string, val?: string) => val ? `<div dir="rtl" style="font-size:11px;color:#666;padding:1px 0;text-align:right"><span style="color:#c8a96e">${label}</span> ${esc(val)}</div>` : '';
        const block = `<div dir="rtl" style="background:#fcfbf7;border-right:2px solid #e7ddc8;border-radius:4px;padding:5px 9px;margin:2px 0 7px;text-align:right">${row('💡 הרעיון:', a.idea)}${row('🔗 ל-DUBIS:', a.relevance)}${row('✅ המלצה:', a.recommendation)}${row(`➡️ צעד${a.agent ? ` [${esc(a.agent)}]` : ''}:`, a.next_step)}</div>`;
        return head + block;
      }).join('')}</div>`
    : '';
  return summaryHtml + actionsHtml + listHtml;
}

// =============================================================
// 🧭 MANAGEMENT DECISION BOARD (2026-07-03, oren directive)
// "לא מספיק שהסוכן נותן תובנות ברמת המלצה — אתה והבוס תחליטו האם מאמצים".
// Every agent recommendation (email_monitor first; other sources next) becomes
// a row in management_decisions; the embedded-Adam judgment pass below decides
// ADOPT (→ creates an owned agent_task) / REJECT (with a reason) / ESCALATE
// (genuinely needs oren). The daily report renders the board.
// NOTE: this doctrine block is a MIRROR of the brain's decision principles
// (A-agents/adam-agent.md + M-memory/snapshot.md) — the cloud cannot read the
// repo. When the brain's principles change, regenerate this string (same rule
// as the copy-qa voice block).

const ADAM_DOCTRINE = `אתה אדם — ה-COO של DUBIS, מותג אופנה D2C המנוהל ע"י מפעיל יחיד (אורן) + צוות סוכני AI. אתה מכריע על המלצות שהסוכנים העלו. עקרונות ההחלטה שלך:
1. שלב העסק: מבחן-ביקוש במרווח-שלילי מכוון (loss-leader) — הצוואר הוא הפצה/ביקוש, לא רווחיות. קמפיין ממומן ראשון רץ בישראל עם שערי-עצירה. שיווק בעברית לישראל בלבד; מוצרים מותאמי-עונה; קול המותג: ציני-חם, זירו-התנצלות, בלי קלישאות.
2. כלכלת מפעיל-יחיד: אמץ רק מה שערכו הצפוי מצדיק את המאמץ, והעדף לרכוב על תשתית קיימת. משימה מאומצת חייבת בעלים ברור וצעד ראשון קונקרטי.
3. גבולות קשיחים — לעולם אל תאמץ בעצמך: הוצאה כספית חדשה / תקציב מודעות / כלי בתשלום / הזנת סיסמאות-טוקנים / שינוי אסטרטגי מהותי / עניין אישי או משפטי → אלה תמיד escalate לאורן, עם המלצה מנומקת.
4. דחייה היא החלטה לגיטימית ושכיחה: רעיון גנרי, לא-רלוונטי לשלב, כפול למשימה קיימת, או "נחמד אבל לא עכשיו" → reject עם סיבה במשפט אחד. עדיף לדחות מלהציף את המערכת.
5. אימוץ = משימה: כותרת ברורה, בעלים מבין הסוכנים (content/marketing/product/design/video/supply/cto) או manual כשזה אנושי, וצעד ראשון. שינוי בקוד הפונה-ללקוח מקבל הערת branch+preview.`;

type MgmtDecisionRow = {
  id: string; source_agent: string; recommendation: string;
  decision: string | null; rationale: string | null; owner_agent: string | null;
  created_task_id: string | null; status: string; decided_at: string | null; created_at: string;
  context: Record<string, unknown> | null; outcome: string | null;
};

// Harvest recommendations from ALL business sources into management_decisions.
// (oren 2026-07-03 evening: "תתייחסו לכל מה שקורה בעסק, לא רק מה שסוכן המייל העלה — תחבר את הכל".)
// Sources: 1) email_monitor idea analyses · 2) content-perf loop weekly learnings ·
// 3) site-audit findings · 4) product-pipeline failures awaiting manual handling.
// Dedup via idx_mgmt_decisions_source_task (unique on source_task_id) — dup insert
// errors are expected + ignored, so re-running every day is safe.
async function harvestRecommendations(sb: SB): Promise<{ harvested: number }> {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  let harvested = 0;
  const tryInsert = async (row: Record<string, unknown>) => {
    const { error } = await sb.from('management_decisions').insert(row);
    if (!error) harvested++;
  };

  // 1) Email-monitor idea analyses (48h)
  const { data: mails } = await sb.from('agent_tasks')
    .select('id, title, content_data, created_at')
    .eq('category', 'gmail_insight').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(20);
  for (const r of (mails || []) as Array<Record<string, unknown>>) {
    const cd = (r.content_data || {}) as Record<string, unknown>;
    const a = (cd.dubis_analysis || null) as { idea?: string; relevance?: string; recommendation?: string; next_step?: string; agent?: string } | null;
    if (!a || !a.recommendation) continue;
    await tryInsert({
      source_agent: 'email_monitor',
      source_task_id: r.id as string,
      recommendation: `${a.idea ? a.idea + ' | ' : ''}${a.recommendation}${a.next_step ? ' | צעד מוצע: ' + a.next_step : ''}`.slice(0, 900),
      context: { subject: cd.subject, suggested_agent: a.agent, relevance: a.relevance },
    });
  }

  // 2) Content-perf loop — the latest weekly learning's directives become ONE
  //    recommendation (source_task_id = the content_learnings row id → dedup).
  //    2026-07-06: FRESHNESS FILTER added — without it, a 6-day-old learning
  //    (pre-token-fix "אין נתוני חשיפה") got harvested + escalated on 07-04
  //    even though a newer learning had superseded it. Only harvest learnings
  //    from the last 48h; older ones are history, not a decision input.
  const { data: learn } = await sb.from('content_learnings')
    .select('id, summary, directives, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1);
  const L = (learn || [])[0] as Record<string, unknown> | undefined;
  if (L && L.summary) {
    const d = (L.directives || {}) as Record<string, unknown>;
    const bits: string[] = [];
    if (Array.isArray(d.boost_products) && d.boost_products.length) bits.push(`להקדים מוצרים ${(d.boost_products as unknown[]).slice(0, 4).join(', ')}`);
    if (Array.isArray(d.boost_formats) && d.boost_formats.length) bits.push(`להגביר פורמט ${(d.boost_formats as unknown[]).join(', ')}`);
    if (Array.isArray(d.cut_formats) && d.cut_formats.length) bits.push(`לצמצם ${(d.cut_formats as unknown[]).join(', ')}`);
    await tryInsert({
      source_agent: 'content_loop',
      source_task_id: L.id as string,
      recommendation: `ניתוח התוכן השבועי: ${String(L.summary).slice(0, 400)}${bits.length ? ' | הנחיות: ' + bits.join(' · ') : ''}`.slice(0, 900),
      context: { directives: d, learned_at: L.created_at },
    });
  }

  // 3) Site-audit findings (open, 48h) — each finding is a recommendation to fix.
  const { data: audits } = await sb.from('agent_tasks')
    .select('id, title, description, created_at')
    .eq('agent_id', 'site_audit').in('status', ['backlog', 'pending_approval'])
    .gte('created_at', since).limit(6);
  for (const r of (audits || []) as Array<Record<string, unknown>>) {
    await tryInsert({
      source_agent: 'site_audit',
      source_task_id: r.id as string,
      recommendation: `ממצא ביקורת-אתר: ${String(r.title || '').slice(0, 200)} — ${String(r.description || '').slice(0, 400)}`.slice(0, 900),
      context: { kind: 'site_audit_finding' },
    });
  }

  // 3b) Security findings (2026-07-12, oren: "סוכן אבטחה מעיר שמשהו לא זמין —
  //     מה אתם כמנהלים עושים עם זה? זה מופיע לי כל יום"). Open security tasks
  //     become board recommendations so they get DECIDED (adopt/reject/escalate)
  //     instead of nagging the report forever.
  const { data: secTasks } = await sb.from('agent_tasks')
    .select('id, title, description, created_at')
    .eq('agent_id', 'security').in('status', ['backlog', 'pending', 'pending_approval'])
    .gte('created_at', since).limit(4);
  for (const r of (secTasks || []) as Array<Record<string, unknown>>) {
    await tryInsert({
      source_agent: 'security',
      source_task_id: r.id as string,
      recommendation: `ממצא אבטחה: ${String(r.title || '').slice(0, 200)} — ${String(r.description || '').slice(0, 400)}`.slice(0, 900),
      context: { kind: 'security_finding' },
    });
  }

  // 4) Product-pipeline failures that already burned their auto-retry — a decision
  //    is due (retry again manually / retire the product / change type).
  const { data: fails } = await sb.from('product_pipeline_queue')
    .select('id, product_id_numeric, last_error, created_at')
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(4);
  for (const r of (fails || []) as Array<Record<string, unknown>>) {
    await tryInsert({
      source_agent: 'product',
      source_task_id: r.id as string,
      recommendation: `מוצר #${r.product_id_numeric ?? '?'} תקוע בצינור אחרי ניסיון-חוזר (${String(r.last_error || '').slice(0, 160)}) — להחליט: ניסיון ידני / פסילה / החלפת סוג`.slice(0, 900),
      context: { kind: 'pipeline_failure' },
    });
  }

  return { harvested };
}

const MGMT_VALID_OWNERS = new Set(['boss','cto','marketing','content','design','supply','email_monitor','site_audit','manual','product','security','tiktok','video','planner']);

// The embedded-Adam judgment pass: decide all pending recommendations in ONE Gemini call.
async function adamDecide(sb: SB): Promise<{ decided: number; adopted: number; rejected: number; escalated: number; errors: string[] }> {
  const out = { decided: 0, adopted: 0, rejected: 0, escalated: 0, errors: [] as string[] };
  const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (!geminiKey) { out.errors.push('GEMINI_API_KEY missing'); return out; }
  const { data: pend } = await sb.from('management_decisions')
    .select('id, recommendation, context, source_agent')
    .eq('status', 'pending').order('created_at', { ascending: true }).limit(8);
  if (!pend || pend.length === 0) return out;
  const items = pend.map((p, i) => `${i + 1}. [${p.id}] (מקור: ${p.source_agent}) ${p.recommendation}`).join('\n');
  const prompt = `${ADAM_DOCTRINE}

לפניך המלצות פתוחות מהסוכנים. הכרע על כל אחת. ענה אך ורק כ-JSON תקין — מערך שבו איבר לכל המלצה:
[{"id":"<ה-uuid מהסוגריים>","decision":"adopt|reject|escalate","rationale":"ההנמקה שלך במשפט-שניים, בעברית","owner_agent":"content|marketing|product|design|video|supply|cto|manual (רק אם adopt)","task_title":"כותרת משימה קצרה בעברית (רק אם adopt)","task_step":"הצעד הראשון הקונקרטי (רק אם adopt)"}]

ההמלצות:
${items}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) { out.errors.push(`gemini HTTP ${r.status}`); return out; }
    const j = await r.json() as Record<string, unknown>;
    const text = (((((j.candidates as unknown[]) || [])[0] as Record<string, unknown>)?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) { out.errors.push('no JSON array in Gemini response'); return out; }
    const decisions = JSON.parse(m[0]) as Array<Record<string, string>>;
    const validIds = new Set(pend.map(p => p.id as string));
    for (const d of decisions) {
      const id = String(d.id || '');
      const decision = String(d.decision || '').toLowerCase();
      if (!validIds.has(id) || !['adopt', 'reject', 'escalate'].includes(decision)) continue;
      let createdTaskId: string | null = null;
      if (decision === 'adopt') {
        const owner = MGMT_VALID_OWNERS.has(String(d.owner_agent || '').toLowerCase()) ? String(d.owner_agent).toLowerCase() : 'manual';
        const { data: task, error: tErr } = await sb.from('agent_tasks').insert({
          agent_id: owner,
          title: `🧭 ${String(d.task_title || 'משימת הנהלה').slice(0, 160)}`,
          description: `${String(d.rationale || '')}\nצעד ראשון: ${String(d.task_step || '')}`.slice(0, 1200),
          category: 'management_directive',
          status: 'backlog',
          priority: 'high',
          content_data: { management_decision_id: id, decided_by: 'adam_embedded' },
        }).select('id').single();
        if (tErr) { out.errors.push(`task insert: ${tErr.message}`); }
        else createdTaskId = (task as { id: string }).id;
      }
      const { error: upErr } = await sb.from('management_decisions').update({
        decision, rationale: String(d.rationale || '').slice(0, 600),
        owner_agent: decision === 'adopt' ? (MGMT_VALID_OWNERS.has(String(d.owner_agent || '').toLowerCase()) ? String(d.owner_agent).toLowerCase() : 'manual') : null,
        created_task_id: createdTaskId,
        status: 'decided', decided_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'pending');
      if (upErr) { out.errors.push(`update: ${upErr.message}`); continue; }
      out.decided++;
      if (decision === 'adopt') out.adopted++;
      else if (decision === 'reject') out.rejected++;
      else out.escalated++;
    }
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}

async function fetchManagementBoard(sb: SB): Promise<{ recent: MgmtDecisionRow[]; pending: number; taskStatus: Record<string, string> } | null> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recent } = await sb.from('management_decisions')
    .select('id, source_agent, recommendation, decision, rationale, owner_agent, created_task_id, status, decided_at, created_at, context, outcome')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(12);
  const rows = (recent || []) as MgmtDecisionRow[];
  const { count: pending } = await sb.from('management_decisions')
    .select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const taskIds = rows.map(r => r.created_task_id).filter(Boolean) as string[];
  const taskStatus: Record<string, string> = {};
  if (taskIds.length) {
    const { data: tasks } = await sb.from('agent_tasks').select('id, status').in('id', taskIds);
    for (const t of (tasks || []) as Array<{ id: string; status: string }>) taskStatus[t.id] = t.status;
  }
  return { recent: rows, pending: pending || 0, taskStatus };
}

// 2026-07-06 REWRITE (oren: "לא צריך לחזור כל יום על דברים שכבר כתבתם"):
// full cards ONLY for decisions from the last 24h; anything older shows up
// only if it's still OPEN — an escalation awaiting oren, or an adopted task
// that hasn't been executed yet (stuck >48h gets a red flag). Executed items
// show their outcome once (on the day it happened) and then disappear.
// 2026-07-12: returns hasNews so the daily report can SKIP the card entirely on
// a quiet day (oren: "שולחן ההנהלה — דברים חוזרים על עצמם") instead of rendering
// an empty-state paragraph every morning.
function buildManagementBoardHtml(b: Awaited<ReturnType<typeof fetchManagementBoard>>): { html: string; hasNews: boolean } {
  if (!b || (b.recent.length === 0 && b.pending === 0)) {
    return { html: '<p dir="rtl" style="font-size:13px;color:#888;text-align:right;margin:0">אין המלצות פתוחות על השולחן — הסוכנים לא העלו נושא להכרעה בשבוע האחרון.</p>', hasNews: false };
  }
  const H24 = Date.now() - 24 * 3600000;
  const isFresh = (r: MgmtDecisionRow) => r.status === 'pending' || (r.decided_at ? new Date(r.decided_at).getTime() > H24 : new Date(r.created_at).getTime() > H24) || Boolean(r.outcome && r.outcome.includes(new Date().toISOString().slice(0, 10)));
  const taskOf = (r: MgmtDecisionRow) => r.created_task_id ? (b.taskStatus[r.created_task_id] || 'backlog') : 'backlog';
  // An outcome on the row = CLOSED, regardless of the task's final status
  // (done/rejected/superseded) — closed items must never linger in "עדיין פתוח".
  const isOpen = (r: MgmtDecisionRow) =>
    (r.decision === 'escalate' && !r.outcome) ||
    (r.decision === 'adopt' && !r.outcome && taskOf(r) !== 'done');
  const badge = (r: MgmtDecisionRow) => {
    if (r.status === 'pending') return '<span style="background:#fdf3d7;color:#8a6d00;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">⏳ ממתין להכרעה</span>';
    if (r.decision === 'adopt') {
      const ts = taskOf(r);
      const done = ts === 'done';
      const stuck = !done && (Date.now() - new Date(r.decided_at || r.created_at).getTime()) > 48 * 3600000;
      if (done) return '<span style="background:#e6f4e6;color:#1e6b1e;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">✅ אומץ ובוצע</span>';
      if (stuck) return `<span style="background:#fdeaea;color:#a12020;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">🔴 אומץ אבל תקוע → ${esc(r.owner_agent || 'manual')} — יטופל בסשן /adam הקרוב</span>`;
      return `<span style="background:#eaf3fb;color:#1f618d;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">✅ אומץ → ${esc(r.owner_agent || 'manual')} (${esc(ts)})</span>`;
    }
    if (r.decision === 'reject') return '<span style="background:#f4f4f4;color:#777;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">❌ נדחה</span>';
    return '<span style="background:#fdeaea;color:#a12020;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700">⬆️ להחלטת אורן</span>';
  };
  const card = (r: MgmtDecisionRow) => {
    const ctxSubject = r.context ? String((r.context as Record<string, unknown>).subject || '') : '';
    // A recommendation that arrived as oren's email-reply to a report is HIS
    // directive — mark it so he sees the loop closed (2026-07-12 reply loop).
    const directiveMark = (r.source_agent === 'email_monitor' && /(^|\s)(re:|השב)|דוח/i.test(ctxSubject)) ? '<b style="color:#8a6d00">📩 הנחיה שלך במייל: </b>' : '';
    const subj = ctxSubject ? ` <span style="color:#aaa">(${esc(ctxSubject.slice(0, 60))})</span>` : '';
    const outcomeLine = r.outcome ? `<div dir="rtl" style="font-size:11px;color:#1e6b1e;margin-top:2px;text-align:right">📌 ${esc(r.outcome.slice(0, 180))}</div>` : '';
    return `<div dir="rtl" style="background:#fcfbf7;border-right:3px solid ${r.decision === 'escalate' ? '#c0392b' : '#c8a96e'};border-radius:4px;padding:7px 10px;margin:4px 0;text-align:right">
      <div dir="rtl" style="font-size:12px;color:#2c2c2c;text-align:right">${directiveMark}${esc(r.recommendation.slice(0, 220))}${subj}</div>
      <div dir="rtl" style="margin-top:3px;text-align:right">${badge(r)}${r.rationale ? ` <span style="font-size:11px;color:#666">— ${esc(r.rationale.slice(0, 160))}</span>` : ''}</div>${outcomeLine}
    </div>`;
  };
  const fresh = b.recent.filter(isFresh);
  const olderOpen = b.recent.filter(r => !isFresh(r) && isOpen(r));
  const freshHtml = fresh.length ? fresh.map(card).join('') : '<p dir="rtl" style="font-size:12px;color:#888;text-align:right;margin:4px 0">אין הכרעות חדשות ב-24 השעות האחרונות.</p>';
  const olderHtml = olderOpen.length
    ? `<div dir="rtl" style="font-size:11.5px;color:#8a6d00;margin:8px 0 2px;text-align:right;font-weight:700">📌 עדיין פתוח מהימים הקודמים:</div>` + olderOpen.map(r => {
        const age = Math.floor((Date.now() - new Date(r.decided_at || r.created_at).getTime()) / 86400000);
        return `<div dir="rtl" style="font-size:11.5px;color:#555;padding:3px 8px;background:#fcfbf7;border-radius:4px;margin:2px 0;text-align:right">${badge(r)} ${esc(r.recommendation.slice(0, 110))}… <span style="color:#999">(${age} ימים)</span></div>`;
      }).join('')
    : '';
  const pendingNote = b.pending > 0 ? `<div dir="rtl" style="font-size:11px;color:#8a6d00;margin:4px 0;text-align:right">⏳ ${b.pending} המלצות עדיין ממתינות להכרעה (יוכרעו בריצה הבאה).</div>` : '';
  const hasNews = fresh.length > 0 || olderOpen.length > 0 || b.pending > 0;
  return { html: `<div dir="rtl" style="font-size:11px;color:#999;margin:0 0 6px;text-align:right">הכרעות חדשות בלבד; פריט חוזר רק אם הוא עדיין פתוח. אומץ → משימה עם בעלים · נדחה → סיבה · כסף/אסטרטגיה → אורן.</div>${pendingNote}${freshHtml}${olderHtml}`, hasNews };
}

// =============================================================
async function fetchPendingApprovals(sb: SB): Promise<{
  products: Array<{ id: string; title: string; slogan: string | null; age_days: number; pid: string | null }>;
  pipelineFailed: Array<{ id: string; pid: number | null; error: string; age_days: number }>;
  pipelineDispatched: Array<{ id: string; pid: number | null; age_hours: number }>;
  candidates: Array<{ id: string; uid: string; brand: string; score: number; age_days: number }>;
}> {
  const { data: pendingProductTasks } = await sb.from('agent_tasks')
    .select('id, title, content_data, created_at')
    .eq('agent_id', 'product').eq('status', 'pending_approval')
    .order('created_at', { ascending: true }).limit(20);
  const products = (pendingProductTasks || []).map(t => {
    const row = t as Record<string, unknown>;
    const c = (row.content_data as Record<string, unknown>) || {};
    return { id: row.id as string, title: row.title as string, slogan: (c.product_slogan || c.slogan) as string | null,
      age_days: Math.floor(hoursSince(row.created_at as string) / 24), pid: (c.product_id as string) || null };
  });
  const { data: failedPipeline } = await sb.from('product_pipeline_queue')
    .select('id, product_id_numeric, last_error, created_at')
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 14*86400000).toISOString())
    .order('created_at', { ascending: false }).limit(10);
  // B.12 — only list pipeline failures that we've ALREADY retried at least once.
  // Brand-new failures (no retry yet) get retried automatically by tryAutoRetryFailedPipeline
  // and either flip to 'dispatched' (gone) or come back here next run as already-retried.
  const failedIds = (failedPipeline || []).map(r => (r as Record<string, unknown>).id as string);
  let retriedFailedIds = new Set<string>();
  if (failedIds.length > 0) {
    const { data: retryFixes } = await sb.from('boss_auto_fixes')
      .select('target_ref')
      .eq('action_type', 'pipeline_auto_retry')
      .in('target_ref', failedIds);
    retriedFailedIds = new Set((retryFixes || []).map(r => (r as Record<string, unknown>).target_ref as string));
  }
  const pipelineFailed = (failedPipeline || [])
    .filter(r => retriedFailedIds.has((r as Record<string, unknown>).id as string))
    .map(r => {
      const row = r as Record<string, unknown>;
      return { id: row.id as string, pid: (row.product_id_numeric as number) || null, error: (row.last_error as string) || 'unknown', age_days: Math.floor(hoursSince(row.created_at as string) / 24) };
    });
  const { data: dispatchedPipeline } = await sb.from('product_pipeline_queue')
    .select('id, product_id_numeric, dispatched_at')
    .eq('status', 'dispatched')
    .lt('dispatched_at', new Date(Date.now() - 2*3600000).toISOString())
    .order('dispatched_at', { ascending: true }).limit(5);
  const pipelineDispatched = (dispatchedPipeline || []).map(r => {
    const row = r as Record<string, unknown>;
    return { id: row.id as string, pid: (row.product_id_numeric as number) || null, age_hours: Math.floor(hoursSince(row.dispatched_at as string)) };
  });
  const { data: cands } = await sb.from('product_candidates')
    .select('id, product_uid, brand, score, recommended_at, status')
    .eq('status', 'pending')
    .order('score', { ascending: false }).limit(5);
  const candidates = (cands || []).map(r => {
    const row = r as Record<string, unknown>;
    return { id: row.id as string, uid: ((row.product_uid as string) || '').slice(0, 60), brand: (row.brand as string) || '?', score: num(row.score), age_days: Math.floor(hoursSince(row.recommended_at as string) / 24) };
  });
  // NOTE (2026-06-15): slogan_candidates count REMOVED from the report. Per the
  // DUBIS open-list policy every active DB slogan is auto-approved — there is no
  // slogan-approval gate, so surfacing "N slogans awaiting approval" was a lie.
  // The audience-submitted slogan box is scored + routed by ?type=review-slogan-submissions.
  return { products, pipelineFailed, pipelineDispatched, candidates };
}

// =============================================================
// A.4 — SVG sparkline (orders bars + revenue line)
// =============================================================
// 2026-07-06 REWRITE (oren: "לא ברור מה כתוב שם"): Gmail STRIPS <svg> from email
// HTML, so the old SVG chart rendered as its raw <text> nodes concatenated into
// an unreadable date-soup ("0407-0207-3007…"). Email-safe version: an explicit
// from–to period line + totals, and a plain table of the days that had activity.
function buildSparkline(snaps: Array<{ snapshot_date: string; revenue_usd: number; orders_today: number }>): string {
  if (snaps.length < 2) return '<p dir="rtl" style="color:#888;font-size:13px;margin:0">צריך לפחות 2 ימים של daily_snapshots לסיכום.</p>';
  const fmt = (d: string) => { const p = d.slice(0, 10).split('-'); return `${p[2]}.${p[1]}`; };
  const from = fmt(snaps[0].snapshot_date);
  const to = fmt(snaps[snaps.length - 1].snapshot_date);
  const totalOrders = snaps.reduce((a, s) => a + (s.orders_today || 0), 0);
  // daily_snapshots.revenue_usd is a CUMULATIVE lifetime figure — the period's
  // revenue is last-minus-first, never a sum (summing showed a fake $4,843).
  const periodRev = Math.max(0, (snaps[snaps.length - 1].revenue_usd || 0) - (snaps[0].revenue_usd || 0));
  const header = `<p dir="rtl" style="margin:0 0 8px;font-size:13.5px;color:#2c2c2c;text-align:right"><b>תקופה: ${from} – ${to}</b> (${snaps.length} ימים) · סה"כ <b>${totalOrders} הזמנות</b> · <b>$${periodRev.toFixed(0)}</b> הכנסות בתקופה</p>`;
  const activeDays = snaps.filter(s => (s.orders_today || 0) > 0);
  if (activeDays.length === 0) {
    return header + `<p dir="rtl" style="margin:0;font-size:12.5px;color:#888;text-align:right">אפס הזמנות בתקופה זו — אין ימים להצגה.</p>`;
  }
  const rows = activeDays.map((s) => {
    const idx = snaps.indexOf(s);
    const dayRev = idx > 0 ? Math.max(0, (s.revenue_usd || 0) - (snaps[idx - 1].revenue_usd || 0)) : 0;
    return `<tr>
    <td dir="rtl" style="padding:4px 10px;border-bottom:1px solid #f0ebe0;font-size:12px;text-align:right">${fmt(s.snapshot_date)}</td>
    <td dir="rtl" style="padding:4px 10px;border-bottom:1px solid #f0ebe0;font-size:12px;text-align:right"><b>${s.orders_today}</b> הזמנות</td>
    <td dir="rtl" style="padding:4px 10px;border-bottom:1px solid #f0ebe0;font-size:12px;text-align:right;color:#c8a96e"><b>$${dayRev.toFixed(0)}</b></td>
  </tr>`;
  }).join('');
  return header + `<table dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:6px;direction:rtl">
    <tr><td dir="rtl" style="padding:4px 10px;font-size:11px;color:#999;text-align:right">יום</td><td dir="rtl" style="padding:4px 10px;font-size:11px;color:#999;text-align:right">הזמנות</td><td dir="rtl" style="padding:4px 10px;font-size:11px;color:#999;text-align:right">הכנסה</td></tr>
    ${rows}
  </table>`;
}

// =============================================================
// 🦞 Agent-to-agent channel (2026-07-12, oren ask): what DUBIS-the-agent posted
// on Moltbook (with links + engagement) + the Neo correspondence status.
// Posts are recorded by agents?type=moltbook-post as agent_runs rows:
//   agent_id='marketing', summary='moltbook-post <id> "<title>"'.
// Engagement is fetched live from the Moltbook API (MOLTBOOK_API_KEY is a
// project-wide Supabase secret, so it's readable here too). All parsing is
// defensive — a missing key / API change degrades to links-only, never throws.
// =============================================================
type MoltbookPost = { id: string; title: string; url: string; upvotes: number | null; comments: number | null; topComments: Array<{ author: string; snippet: string }>; content: string; summaryHe: string | null };
async function fetchMoltbookChannel(sb: SB, windowHours: number): Promise<{
  posts: MoltbookPost[]; karma: number | null; neo: string | null; totalUp: number; totalCom: number; insightsHe: string | null;
} | null> {
  try {
    const since = new Date(Date.now() - windowHours * 3600000).toISOString();
    // NOTE: agent_runs has no started_at column — created_at is the timestamp.
    const { data: runs } = await sb.from('agent_runs')
      .select('summary, created_at, status')
      .eq('agent_id', 'marketing').ilike('summary', 'moltbook-post%')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(12);
    const posts: MoltbookPost[] = [];
    for (const r of (runs || []) as Array<Record<string, unknown>>) {
      const m = String(r.summary || '').match(/^moltbook-post\s+(\S+)\s+"([\s\S]*?)"/);
      if (!m) continue;
      posts.push({ id: m[1], title: m[2], url: `https://www.moltbook.com/post/${m[1]}`, upvotes: null, comments: null, topComments: [], content: '', summaryHe: null });
    }
    const mbKey = Deno.env.get('MOLTBOOK_API_KEY') ?? '';
    let karma: number | null = null;
    if (mbKey) {
      const mbHeaders = { 'Authorization': `Bearer ${mbKey}` };
      try {
        const meRes = await fetch('https://www.moltbook.com/api/v1/agents/me', { headers: mbHeaders, signal: AbortSignal.timeout(8000) });
        if (meRes.ok) { const me = await meRes.json() as Record<string, unknown>; const a = (me.agent as Record<string, unknown>) || me; karma = Number(a.karma ?? a.karma_score ?? NaN); if (Number.isNaN(karma)) karma = null; }
      } catch (_) { /* karma stays null */ }
      await Promise.all(posts.slice(0, 6).map(async (p) => {
        try {
          const r = await fetch(`https://www.moltbook.com/api/v1/posts/${p.id}`, { headers: mbHeaders, signal: AbortSignal.timeout(8000) });
          if (!r.ok) return;
          const j = await r.json() as Record<string, unknown>;
          const post = (j.post as Record<string, unknown>) || j;
          const up = Number(post.upvotes ?? post.score ?? post.karma ?? NaN);
          p.upvotes = Number.isNaN(up) ? null : up;
          p.content = String(post.content ?? post.body ?? '').replace(/\s+/g, ' ').slice(0, 900);
          const rawComments = (post.comments ?? j.comments) as unknown;
          const cc = Number(post.comment_count ?? post.comments_count ?? (Array.isArray(rawComments) ? (rawComments as unknown[]).length : NaN));
          p.comments = Number.isNaN(cc) ? null : cc;
          const mapComments = (arr: Array<Record<string, unknown>>) => arr.slice(0, 5).map(c => ({
            author: String(((c.author as Record<string, unknown>)?.name) ?? c.author_name ?? c.agent_name ?? 'agent'),
            snippet: String(c.content ?? c.body ?? '').replace(/\s+/g, ' ').slice(0, 220),
          })).filter(c => c.snippet);
          if (Array.isArray(rawComments)) p.topComments = mapComments(rawComments as Array<Record<string, unknown>>);
          // The post payload often carries only a COUNT — fetch the actual
          // comments so the Hebrew insights read real replies, not just numbers.
          if (!p.topComments.length && (p.comments || 0) > 0) {
            try {
              const cr = await fetch(`https://www.moltbook.com/api/v1/posts/${p.id}/comments`, { headers: mbHeaders, signal: AbortSignal.timeout(8000) });
              if (cr.ok) {
                const cj = await cr.json() as Record<string, unknown>;
                const list = (cj.comments ?? cj.data ?? cj) as unknown;
                if (Array.isArray(list)) p.topComments = mapComments(list as Array<Record<string, unknown>>);
              }
            } catch (_) { /* counts-only fallback */ }
          }
        } catch (_) { /* leave nulls */ }
      }));
    }
    // Neo correspondence — surfaces via the Gmail scanner (agents&me / neo@).
    let neo: string | null = null;
    try {
      const { data: neoRows } = await sb.from('agent_tasks')
        .select('title, created_at')
        .eq('category', 'gmail_insight')
        .or('title.ilike.%neo%,description.ilike.%agentsandme%')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(1);
      if (neoRows && neoRows.length) neo = String((neoRows[0] as Record<string, unknown>).title || '').slice(0, 120);
    } catch (_) { /* no neo signal */ }
    const totalUp = posts.reduce((s, p) => s + (p.upvotes || 0), 0);
    const totalCom = posts.reduce((s, p) => s + (p.comments || 0), 0);
    if (!posts.length && !neo) return { posts: [], karma, neo: null, totalUp: 0, totalCom: 0, insightsHe: null };

    // 🇮🇱 Hebrew digest (oren 2026-07-12: "תן תקציר בעברית מה הסוכן שלנו כתב
    // ומה התובנות מהתגובות"). ONE Gemini call summarizes what we posted (per
    // post, one Hebrew sentence) + what the other agents' comments reveal.
    // Best-effort: on any failure the section falls back to titles + snippets.
    let insightsHe: string | null = null;
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
    if (geminiKey && posts.length) {
      try {
        const postBlock = posts.slice(0, 6).map((p, i) =>
          `${i + 1}. [${p.id}] כותרת: ${p.title}\n   תוכן: ${p.content || '(לא נשלף)'}\n   הצבעות: ${p.upvotes ?? '?'} · תגובות של סוכנים אחרים: ${p.topComments.length ? p.topComments.map(c => `"${c.author}: ${c.snippet}"`).join(' | ') : 'אין'}`
        ).join('\n');
        const prompt = `אתה העוזר של אורן, בעל מותג האופנה DUBIS. הסוכן שלנו (DUBIS) מפרסם פוסטים באנגלית ב-Moltbook — רשת חברתית של סוכני AI. לפניך הפוסטים האחרונים + תגובות של סוכנים אחרים. החזר אך ורק JSON תקין:
{"posts":[{"id":"<id>","summary":"משפט אחד בעברית פשוטה — מה הפוסט שלנו אומר"}],"insights":"2-3 משפטים בעברית: מה עולה מהתגובות של הסוכנים האחרים — הטון, שאלות שחוזרות, והזדמנות אחת קונקרטית אם יש. אם אין תגובות — התייחס רק להיענות (הצבעות)."}
בלי מקפים ארוכים, בלי ז'רגון.

הפוסטים:
${postBlock}`;
        const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }),
          signal: AbortSignal.timeout(20000),
        });
        if (gr.ok) {
          const gj = await gr.json() as Record<string, unknown>;
          const text = (((((gj.candidates as unknown[]) || [])[0] as Record<string, unknown>)?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
          const mjs = text.match(/\{[\s\S]*\}/);
          if (mjs) {
            const obj = JSON.parse(mjs[0]) as { posts?: Array<{ id?: string; summary?: string }>; insights?: string };
            for (const s of (obj.posts || [])) {
              const target = posts.find(p => p.id === String(s.id || ''));
              if (target && s.summary) target.summaryHe = String(s.summary).slice(0, 220);
            }
            insightsHe = obj.insights ? String(obj.insights).slice(0, 600) : null;
          }
        }
      } catch (_) { /* fall back to raw titles */ }
    }
    return { posts, karma, neo, totalUp, totalCom, insightsHe };
  } catch (_) { return null; }
}
function buildMoltbookHtml(mb: Awaited<ReturnType<typeof fetchMoltbookChannel>>, isWeekly: boolean): string {
  if (!mb) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right;margin:0">ערוץ הסוכנים — אין נתונים.</p>';
  const winHe = isWeekly ? 'השבוע' : 'ב-24 השעות האחרונות';
  const head = `<p dir="rtl" style="font-size:12.5px;color:#555;margin:0 0 8px;text-align:right">הסוכן שלנו (<a href="https://www.moltbook.com/u/dubis" style="color:#c8a96e;font-weight:600;text-decoration:none">u/dubis</a>) פרסם <b>${mb.posts.length}</b> פוסטים ${winHe}${mb.karma != null ? ` · קארמה כוללת: <b>${mb.karma}</b>` : ''}${(mb.totalUp || mb.totalCom) ? ` · ${mb.totalUp} הצבעות · ${mb.totalCom} תגובות` : ''}</p>`;
  const postRows = mb.posts.slice(0, 6).map(p => {
    const stats = (p.upvotes != null || p.comments != null)
      ? `<span style="color:#999;font-size:11px">▲ ${p.upvotes ?? '?'} · 💬 ${p.comments ?? '?'} · </span>` : '';
    // Lead with the HEBREW summary of what our agent wrote (oren 2026-07-12);
    // the English title drops to a small secondary line.
    const mainLine = p.summaryHe
      ? `<div style="color:#2c2c2c;line-height:1.55">🦞 ${esc(p.summaryHe)}</div><div dir="ltr" style="font-size:10.5px;color:#aaa;text-align:left;margin-top:1px">${esc(p.title.slice(0, 90))}</div>`
      : `<div>🦞 <span dir="ltr" style="display:inline-block">${esc(p.title.slice(0, 90))}</span></div>`;
    const comments = p.topComments.length
      ? p.topComments.slice(0, 2).map(c => `<div dir="ltr" style="font-size:11px;color:#777;padding:2px 8px;background:#fff;border-radius:4px;margin:2px 0;text-align:left">💬 <b>${esc(c.author)}</b>: ${esc(c.snippet.slice(0, 110))}</div>`).join('')
      : '';
    return `<div dir="rtl" style="padding:7px 10px;background:#fafafa;margin:4px 0;border-radius:6px;text-align:right;font-size:12.5px">
      ${mainLine}<div style="margin-top:3px;font-size:11.5px">${stats}<a href="${esc(p.url)}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ לפוסט →</a></div>${comments}
    </div>`;
  }).join('');
  // 🧠 What the other agents' replies tell us — Hebrew, computed per window.
  const insightsBlock = mb.insightsHe
    ? `<div dir="rtl" style="margin-top:8px;padding:10px 14px;background:#2c2c2c;color:#fff;border-radius:6px;text-align:right;font-size:12.5px;line-height:1.7">🧠 <b style="color:#c8a96e">תובנות מהתגובות:</b> ${esc(mb.insightsHe)}</div>`
    : '';
  const neoLine = mb.neo
    ? `<div dir="rtl" style="margin-top:8px;padding:8px 12px;background:#f3eee2;border-radius:6px;text-align:right;font-size:12.5px;color:#5a4a2f">🤖 <b>ניאו (agents&me):</b> מייל חדש בשרשור — "${esc(mb.neo)}" · התשובה מנוהלת דרך שולחן ההנהלה.</div>`
    : `<div dir="rtl" style="margin-top:8px;font-size:11.5px;color:#999;text-align:right">🤖 ניאו: אין מייל חדש בחלון הזה.</div>`;
  const empty = mb.posts.length === 0 ? '<p dir="rtl" style="font-size:12.5px;color:#888;text-align:right;margin:0">לא פורסם פוסט בחלון הזה — המכונה רצה 3 פעמים ביום (06:10/11:10/17:10 UTC).</p>' : '';
  return head + postRows + empty + insightsBlock + neoLine;
}

// 📊 $1,000 plan — ONE line for the daily routine digest (oren 2026-07-12:
// "התוכנית לא מתקדמת — אל תעדכנו כל יום, רק מה השלב הבא ובמה זה תלוי").
// The full card renders ONLY in the weekly report.
function buildPlanNextStepLine(p: PlanStatus | null): string {
  if (!p) return 'תוכנית $1,000: אין נתוני תוכנית זמינים.';
  if (p.blocked_on_oren.length > 0) {
    const b = p.blocked_on_oren[0];
    return `תוכנית $1,000: הצעד הבא — "${b.title}" · תלוי בך${b.oren_action ? `: ${b.oren_action.slice(0, 90)}` : ''}${b.days_late > 0 ? ` (מחכה ${b.days_late} ימים)` : ''}.`;
  }
  return `תוכנית $1,000: שלב ${p.current_phase}${p.phase_name ? ` (${p.phase_name})` : ''} · ${p.done_count}/${p.total_actionable} הושלמו · אין חסם עליך כרגע.`;
}

// =============================================================
// Main HTTP handler
// =============================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  if (!isAuthed(req)) return json({ error: 'Unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'daily';
  const isWeekly = mode === 'weekly';
  // preview=1 → build the report + return it WITHOUT sending email or writing
  // boss_reports/agent_runs. Lets agents verify the HTML safely (2026-06-15).
  const isPreview = url.searchParams.get('preview') === '1';

  // ---- Campaign row FIRST (2026-07-10): the funnel must query the campaign that
  // is actually running, not a hardcoded id. The 07-09 report asked Meta about the
  // dead April campaign (META_CAMPAIGN default) and rendered "אין חשיפות" while the
  // live summer campaign burned ₪66 that day. ad_campaigns is the source of truth:
  // the live Meta campaign id is embedded in `notes` as "campaign_id: <digits>".
  // Prefer env override → most-recent ACTIVE row's id → most-recent row's id → legacy default.
  let campaignPaused = false; let campaignStatusKnown = false;
  let dbCampSpend = 0; let dbCampClicks = 0;
  let activeCampaignId = Deno.env.get('META_CAMPAIGN_ID') || '';
  try {
    const { data: campRows } = await sb.from('ad_campaigns')
      .select('status, notes, created_at, spend_to_date, clicks')
      .order('created_at', { ascending: false }).limit(50);
    const rows = (campRows || []) as Array<Record<string, unknown>>;
    const idOf = (r: Record<string, unknown>) => (String(r.notes || '').match(/campaign_id:\s*(\d+)/i) || [])[1] || '';
    if (!activeCampaignId) {
      const activeRow = rows.find(c => String(c.status || '').toLowerCase() === 'active' && idOf(c));
      const anyIdRow = rows.find(c => idOf(c));
      activeCampaignId = (activeRow && idOf(activeRow)) || (anyIdRow && idOf(anyIdRow)) || META_CAMPAIGN;
    }
    const idRx = new RegExp(`campaign_id:\\s*${String(activeCampaignId)}\\b`, 'i');
    const exact = rows.find(c => idRx.test(String(c.notes || '')));
    if (exact) {
      // Funnel reports on activeCampaignId → its own row decides paused/active.
      campaignStatusKnown = true;
      // Anything that isn't 'active' (paused/completed/draft) = not running.
      // The old ===  'paused' check let an ENDED campaign read as live (07-12).
      campaignPaused = String(exact.status || '').toLowerCase() !== 'active';
      dbCampSpend = Number(exact.spend_to_date || 0);
      dbCampClicks = Number(exact.clicks || 0);
    } else if (rows.length > 0) {
      // No row for the campaign. Use the fleet signal: if NO campaign is active,
      // the funnel can't be delivering — treat as paused (don't invent a delay).
      campaignStatusKnown = true;
      const anyActive = rows.some(c => String(c.status || '').toLowerCase() === 'active');
      campaignPaused = !anyActive;
    }
  } catch (_) { /* best-effort — fall back to generic copy */ }
  if (!activeCampaignId) activeCampaignId = META_CAMPAIGN;

  // ---- D.13: Meta API with explicit error capture ----
  let metaData: Record<string, unknown> = { ok: false };
  if (IG_TOKEN) {
    try {
      const accRes = await fetch(`https://graph.facebook.com/v19.0/act_26201135546175057?fields=currency&access_token=${IG_TOKEN}`);
      if (!accRes.ok) {
        const errBody = await accRes.text().catch(() => '');
        metaData.fetch_error = `account currency HTTP ${accRes.status}: ${errBody.slice(0,160)}`;
      } else {
        const acc = await accRes.json();
        metaData.currency = acc.currency || 'ILS';
        for (const w of ['yesterday', 'last_7d']) {
          const r = await fetch(`https://graph.facebook.com/v19.0/${activeCampaignId}/insights?fields=spend,impressions,clicks,cpc,ctr,reach,actions&date_preset=${w}&access_token=${IG_TOKEN}`);
          if (!r.ok) {
            const errBody = await r.text().catch(() => '');
            metaData[`fetch_error_${w}`] = `HTTP ${r.status}: ${errBody.slice(0,160)}`;
            metaData[w] = {};
          } else {
            const d = await r.json();
            metaData[w] = d.data?.[0] || {};
          }
        }
        metaData.ok = true;
      }
    } catch (e) { metaData.fetch_error = (e as Error).message; }
  } else {
    metaData.fetch_error = 'INSTAGRAM_ACCESS_TOKEN missing in env';
  }

  let igPosts7d = 0, dupes = 0;
  if (IG_TOKEN && IG_ACCOUNT) {
    try {
      const since = Math.floor((Date.now() - 7*86400000)/1000);
      const r = await fetch(`https://graph.facebook.com/v19.0/${IG_ACCOUNT}/media?fields=id,caption,timestamp&since=${since}&limit=30&access_token=${IG_TOKEN}`);
      const d = await r.json();
      const list = d.data || [];
      igPosts7d = list.length;
      const captions = (list as { caption?: string }[]).map(m => (m.caption || '').slice(0, 80));
      const seen = new Set<string>(); for (const c of captions) { if (seen.has(c)) dupes++; else seen.add(c); }
    } catch (_) {}
  }

  const sinceWindow = new Date(Date.now() - (isWeekly ? 7 : 1)*86400000).toISOString();
  const { data: allWindowOrders } = await sb.from('orders').select('id, total_amount, status, created_at, is_test, buyer_email').eq('is_test', false).neq('status', 'cancelled').gte('created_at', sinceWindow);
  // Headline revenue/orders = EXTERNAL customers only. Internal/test buyers
  // (Hila's checkout-validation orders, oren's own email) are split out and
  // labelled, never counted as business revenue (2026-06-15 fix).
  const realOrders = (allWindowOrders || []).filter(o => !isInternalBuyer((o as Record<string, unknown>).buyer_email as string));
  const internalOrders = (allWindowOrders || []).filter(o => isInternalBuyer((o as Record<string, unknown>).buyer_email as string));
  const totalRevenue = realOrders.reduce((s, o) => s + Number((o as Record<string, unknown>).total_amount || 0), 0);
  const internalRevenue = internalOrders.reduce((s, o) => s + Number((o as Record<string, unknown>).total_amount || 0), 0);
  // COGS-aware net profit + real pageviews, computed once for hero + KPI sync.
  const cwSpendForProfit = num(((isWeekly ? (metaData.last_7d as Record<string, unknown>) : (metaData.yesterday as Record<string, unknown>)) || {}).spend);
  const realMetrics = await fetchRealMetrics(sb, isWeekly ? 7 : 1, cwSpendForProfit).catch(() => null);
  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jerusalem' });
  const cur = (metaData.currency as string) || 'ILS';
  const sym = cur === 'ILS' ? '₪' : '$';

  // ---- 🧭 Management board (2026-07-03): harvest agent recommendations →
  // embedded-Adam decides adopt/reject/escalate BEFORE the report renders,
  // so the report shows DECISIONS, not open-ended recommendations. ----
  let mgmtDecide = { decided: 0, adopted: 0, rejected: 0, escalated: 0, errors: [] as string[] };
  try {
    await harvestRecommendations(sb);
    mgmtDecide = await adamDecide(sb);
  } catch (e) { mgmtDecide.errors.push((e as Error).message); }

  // ---- B.7 + B.9 + B.11 + B.12: Self-healing — runs BEFORE opinions so they reflect fixes ----
  const gelatoStockHeal = await tryAutoHealGelatoStock(sb);
  const ticketing = await autoTicketStuckOrders(sb);
  const oosHide = await tryAutoHideFullyOosProducts(sb);          // B.11
  const pipelineRetry = await tryAutoRetryFailedPipeline(sb);     // B.12
  const staleSlogans = await tryCloseStaleSloganTasks(sb);        // B.14
  const autoFixes: AutoFix[] = [];
  if (staleSlogans.closed.length > 0) {
    autoFixes.push({
      action: 'close_stale_slogan_task',
      succeeded: true,
      note: `סגרתי ${staleSlogans.closed.length} משימות סלוגן ישנות (אין שער-אישור): ${staleSlogans.closed.map(c => `"${c.title.replace(/^.*?:\s*/, '')}" (${c.days}י)`).join(', ')}`,
    });
  }
  if (gelatoStockHeal.attempted) autoFixes.push({ action: 'gelato_stock_retry', succeeded: gelatoStockHeal.healed, note: gelatoStockHeal.summary || gelatoStockHeal.error });
  for (const tid of ticketing.ticketIds) autoFixes.push({ action: 'gelato_auto_ticket', succeeded: true, target: tid });
  for (const err of ticketing.errors) autoFixes.push({ action: 'gelato_auto_ticket', succeeded: false, error: err });
  if (oosHide.hidden.length > 0) {
    const names = oosHide.hidden.map(h => `#${h.numeric ?? '?'} "${h.slogan}"`).join(', ');
    autoFixes.push({
      action: 'auto_hide_oos',
      succeeded: true,
      note: `${oosHide.hidden.length} מוצרים אזלו — הסתרנו אוטומטית מהקטלוג: ${names}`,
    });
  }
  for (const r of pipelineRetry.retried) {
    autoFixes.push({
      action: 'pipeline_auto_retry',
      succeeded: r.dispatched,
      target: `pipeline #${r.numeric ?? '?'}`,
      note: r.dispatched ? 'הצינור הופעל מחדש אוטומטית' : undefined,
      error: r.dispatched ? undefined : r.error,
    });
  }

  // ---- Opinions ----
  const rawOps = await Promise.all([
    opinionContent(sb, igPosts7d),
    opinionMarketing(metaData, realOrders || [], !campaignPaused),
    opinionProduct(sb),
    opinionSupply(sb, ticketing.ticketsOpened),
    opinionDesign(sb, dupes),
    opinionSiteAudit(sb),
    opinionEmailMonitor(sb), // B.8 happens inside if applicable
    opinionStock(sb, gelatoStockHeal),
    opinionCto(sb),
    opinionSecurity(sb),
    opinionVideo(sb),
    opinionPlanner(sb),
    opinionCheckoutCanary(sb), // 2026-05-23 — Gelato ↔ orders.row diff
  ]);
  const allOpinions: Opinion[] = rawOps.filter((o): o is Opinion => o !== null);

  // ---- A.5: split into recurring vs main ----
  const { recurring: recurringFromHistory, nonRecurring } = await fetchRecurringIssues(sb, allOpinions);
  // 2026-07-12 (oren: "ממצאים חדשים חוזר כל יום"): "חדשים" = FIRST appearance
  // only. A finding shown yesterday is not news — it either graduates to the
  // recurring card (3+ days, demands a decision) or stays silent until it
  // changes. Yesterday's themes come from the last report's assessment.
  let prevThemes = new Set<string>();
  try {
    const { data: lastRep } = await sb.from('boss_reports').select('assessment').order('created_at', { ascending: false }).limit(1);
    const arr = ((lastRep?.[0] as Record<string, unknown> | undefined)?.assessment as Record<string, unknown> | undefined)?.opinion_themes;
    if (Array.isArray(arr)) prevThemes = new Set(arr.map(String));
  } catch (_) { /* first run — everything is new */ }
  const opinions = nonRecurring.filter(o => !prevThemes.has(`${o.theme}|${o.agent_he}`));
  const synth = synthesize(opinions);

  // 2026-05-26 — Auto-handle two recurring-task themes per oren's directive:
  //   1) planner meta-review ("לסקור P0/P1 הפתוחים") — useless in the report,
  //      the boss itself reviews findings every run. Auto-close matching
  //      agent_tasks, log as auto-fix, drop from recurring section.
  //   2) IG dedup ("למחוק מ-IG ... Phase C dedup") — design-agent task that
  //      heals on next run. Rewrite display to plain Hebrew + close in DB.
  const recurring: typeof recurringFromHistory = [];
  for (const r of recurringFromHistory) {
    const text = r.rec || '';
    if (/לסקור.*פתוחים|review.*open|P0\/P1/i.test(text)) {
      try {
        await sb.from('agent_tasks')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('agent_id', AGENT_HE_TO_ID[r.agent_he] || 'planner')
          .in('status', ['pending','approved','pending_approval','backlog'])
          .ilike('description', '%לסקור%');
      } catch (_) { /* best-effort close */ }
      autoFixes.push({
        action: 'auto_close_planner_meta_review',
        succeeded: true,
        note: 'סגרנו אוטומטית — הבוס עצמו סוקר את כל הממצאים בכל דוח',
      });
      continue;
    }
    if (/למחוק מ.IG|Phase.*dedup|dedup/i.test(text)) {
      try {
        await sb.from('agent_tasks')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('agent_id', 'design')
          .in('status', ['pending','approved','pending_approval','backlog'])
          .or('description.ilike.%dedup%,description.ilike.%כפילויות%');
      } catch (_) { /* best-effort close */ }
      autoFixes.push({
        action: 'auto_close_ig_dedup',
        succeeded: true,
        note: 'נמצאו פוסטים כפולים ב-Instagram — הסוכן מטפל',
      });
      recurring.push({ ...r, rec: '🟠 בעיה חשובה: נמצאו פוסטים כפולים ב-Instagram — הסוכן מטפל' });
      continue;
    }
    recurring.push(r);
  }

  // ---- New v9 fetches + v10 B.10 per-order tracking ----
  // Sync KPI values from latest daily snapshot BEFORE reading the plan,
  // so the fetched kpi_current reflects today's numbers. Best-effort —
  // if either step fails we still build the rest of the report.
  const planKpiSync = realMetrics
    ? await syncPlanKpisFromSnapshot(sb, realMetrics).catch(() => ({ updated: 0, errors: ['sync-threw'] }))
    : { updated: 0, errors: ['no-real-metrics'] };
  // Resolve real TikTok post URLs (Late.com finalizes async) so marketing links point at the live post.
  await backfillTiktokUrls(sb).catch(() => {});
  const [marketingToday, pending, agentHealth, dailySnaps, orderTracking, planStatus, weeklyMktg, autoProductHealth, newProductsWeek, emailDigest, contentPerf, moltbook, personaData, reelGaps] = await Promise.all([
    fetchMarketingToday(sb),
    fetchPendingApprovals(sb),
    fetchAgentHealth(sb),
    fetchDailySnapshots(sb),
    fetchActiveOrdersTracking(sb),
    fetchPlanStatus(sb).catch(() => null),
    fetchWeeklyMarketing(sb).catch(() => null),
    fetchAutoProductHealth(sb).catch(() => null),
    fetchNewProductsThisWeek(sb).catch(() => []),
    fetchEmailDigest(sb).catch(() => null),
    fetchContentPerf(sb).catch(() => null),
    fetchMoltbookChannel(sb, isWeekly ? 168 : 26).catch(() => null),
    fetchPersonaSeries(sb).catch(() => null),
    fetchReelBankGaps(sb).catch(() => null),
  ]);
  const managementBoard = await fetchManagementBoard(sb).catch(() => null);

  let action_items_json: Opinion[] = synth.topActions.slice(0, isWeekly ? 5 : 3);
  let createdTaskIds: string[] = [];
  let lastWeekCheck = { total: 0, done: 0, open: 0, details: [] as { rec: string; agent: string; status: string }[] };
  let summary_he = '';

  if (isWeekly) {
    lastWeekCheck = await checkLastWeek(sb);
    action_items_json = synth.topActions;
    const reportDate = new Date().toISOString().slice(0, 10);
    const { data: meetingRow } = await sb.from('meeting_archive').insert({
      meeting_date: reportDate, meeting_type: 'weekly',
      title: `פגישת צוות DUBIS — ${dateStr}`,
      summary_he: '', attendees: opinions.map(o => o.agent),
      decisions: [], action_items: action_items_json,
      full_html: '', source_runs: { mode:'weekly', meta:metaData, igPosts7d, dupes, version:'v10-self-healing' },
    }).select('id').single();
    const meetingId = meetingRow?.id || null;
    for (const action of synth.topActions) {
      const targetAgentId = AGENT_HE_TO_ID[action.agent_he] || 'cto';
      try {
        const { data: task } = await sb.from('agent_tasks').insert({
          title: `משימה מפגישה ${reportDate}: ${action.recommendation.slice(0, 80)}`,
          description: `תצפית: ${action.observation}\n\nהמלצה: ${action.recommendation}\n\nעדיפות: ${action.priority}\nממליץ: ${action.agent_he}`,
          agent_id: targetAgentId, status: 'approved', priority: action.priority === 'P0' ? 'critical' : action.priority === 'P1' ? 'high' : 'medium',
          category: 'weekly_recommendation', requires_budget: false,
          notes: `נוצר מפגישה שבועית ${reportDate}`,
        }).select('id').single();
        if (task?.id) {
          createdTaskIds.push(task.id);
          await sb.from('weekly_action_items').insert({ meeting_id: meetingId, meeting_date: reportDate, agent_id: targetAgentId, agent_he: action.agent_he, priority: action.priority, observation: action.observation, recommendation: action.recommendation, theme: action.theme, task_id: task.id, status: 'open' });
        }
      } catch (e) { console.error(e); }
    }
    summary_he = `שבועי: ${(realOrders || []).length} הזמנות, $${totalRevenue.toFixed(0)}. ${opinions.length} תצפיות. ${createdTaskIds.length} משימות.`;
  }

  // ============================================================
  // HTML SECTIONS
  // ============================================================
  const cw7 = (metaData.last_7d as Record<string, unknown>) || {};
  const cwY = (metaData.yesterday as Record<string, unknown>) || {};
  const spendDisplay = num(isWeekly ? cw7.spend : cwY.spend);
  // Honest hero: external orders + external revenue + net profit (loss-leader
  // aware) + Meta spend. Internal/test revenue (Hila) shown as a small footnote,
  // never as headline. Net profit uses real COGS; if cost unknown → loss-leader
  // marker; if intentionally negative → red number (expected this phase).
  const profitDisplay = !realMetrics || realMetrics.netProfit == null
    ? { txt: 'הפסד-מכוון', color: '#e67e22', sub: 'שלב בדיקת ביקוש' }
    : realMetrics.netProfit >= 0
      ? { txt: `$${Math.round(realMetrics.netProfit)}`, color: realMetrics.netProfit > 50 ? '#27ae60' : '#e67e22', sub: 'רווח נטו (אחרי COGS)' }
      : { txt: `-$${Math.abs(Math.round(realMetrics.netProfit))}`, color: '#c0392b', sub: 'הפסד-מכוון (loss-leader)' };
  const internalNote = (internalOrders.length > 0)
    ? `<tr><td colspan="4" dir="rtl" align="center" style="padding:2px 8px 0;text-align:center"><span style="font-size:10.5px;color:#888">+ ${internalOrders.length} הזמנות פנימיות/בדיקה (הילה) על סך $${internalRevenue.toFixed(0)} — לא נספרות כהכנסה עסקית</span></td></tr>`
    : '';
  const heroStats = `<table dir="rtl" width="100%"><tr>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">${(realOrders || []).length}</div><div style="font-size:11px;color:#aaa">הזמנות לקוח ${isWeekly?'7ימ':'24h'}</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">$${totalRevenue.toFixed(0)}</div><div style="font-size:11px;color:#aaa">הכנסה אמיתית ${isWeekly?'7ימ':'24h'}</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:${profitDisplay.color};font-size:22px;font-weight:700">${profitDisplay.txt}</div><div style="font-size:11px;color:#aaa">${profitDisplay.sub}</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">${sym}${spendDisplay.toFixed(0)}</div><div style="font-size:11px;color:#aaa">Meta ${isWeekly?'7ימ':'אתמול'}</div></td>
  </tr>${internalNote}</table>`;

  // 🔧 Auto-fix summary card
  const autoFixHtml = autoFixes.length === 0
    ? ''
    : `<tr><td dir="rtl" style="background:#e8f8f0;border-radius:12px;padding:14px 20px;direction:rtl;text-align:right">
        <h3 dir="rtl" style="margin:0 0 8px;color:#1e6e3a;font-size:15px;direction:rtl;text-align:right">🔧 הבוס תיקן אוטומטית</h3>
        ${autoFixes.map(f => `<div dir="rtl" style="padding:6px 10px;background:#fff;margin:3px 0;border-radius:4px;text-align:right;font-size:12px;border-right:3px solid ${f.succeeded ? '#27ae60' : '#c0392b'}">
          ${f.succeeded ? '✅' : '❌'} <b>${esc(f.action)}</b>${f.target ? ` <code style="font-size:10px;color:#888">${esc(String(f.target).slice(0,12))}</code>` : ''}${f.note ? ` · ${esc(f.note)}` : ''}${f.error ? ` · <span style="color:#c0392b">${esc(f.error.slice(0,120))}</span>` : ''}
        </div>`).join('')}
      </td></tr><tr><td style="height:14px"></td></tr>`;

  // Priority → friendly Hebrew label (oren 2026-05-23: no P0/P1/P2 anywhere).
  const PRIORITY_HE: Record<string, { label: string; color: string }> = {
    'P0': { label: '🔴 דחוף', color: '#c0392b' },
    'P1': { label: '🟠 בעיה חשובה', color: '#e67e22' },
    'P2': { label: '🟡 כדאי לטפל', color: '#888' },
  };

  // 🔁 Recurring issues card
  const recurringHtml = recurring.length === 0
    ? ''
    : `<tr><td dir="rtl" style="background:#fff5f5;border-radius:12px;padding:14px 20px;direction:rtl;text-align:right;border:1px solid #ffcfcf">
        <h3 dir="rtl" style="margin:0 0 8px;color:#c0392b;font-size:15px;direction:rtl;text-align:right">🔁 חוזר על עצמו (3+ ימים)</h3>
        <p dir="rtl" style="margin:0 0 10px;color:#666;font-size:12px">הבעיות הבאות מופיעות בדוח שלושה ימים ומעלה — דורש החלטה.</p>
        ${recurring.map(r => {
          const p = PRIORITY_HE[r.priority] || { label: r.priority, color: '#888' };
          return `<div dir="rtl" style="padding:8px 12px;background:#fff;margin:4px 0;border-radius:4px;text-align:right;font-size:13px;border-right:3px solid ${p.color}">
            <b style="color:${p.color}">${p.label}:</b> ${esc(cleanRecommendationText(r.rec))}
            <span style="background:${p.color};color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;margin-right:6px">${r.days} ימים</span>
          </div>`;
        }).join('')}
      </td></tr><tr><td style="height:14px"></td></tr>`;

  const issuesHtml = opinions.length === 0
    ? '<p dir="rtl" style="color:#27ae60;font-size:13px;margin:0">✅ אין בעיות חדשות.</p>'
    : opinions.map(o => {
        const p = PRIORITY_HE[o.priority] || { label: o.priority, color: '#888' };
        return `<div dir="rtl" style="padding:10px 14px;border-right:4px solid ${p.color};background:#fafafa;margin:6px 0;border-radius:4px;direction:rtl;text-align:right">
          <div style="font-size:13px;color:#2c2c2c"><b style="color:${p.color}">${p.label}:</b> ${esc(o.observation)}</div>
          <div style="font-size:11.5px;color:#666;margin-top:4px">↳ ${esc(cleanRecommendationText(o.recommendation))}</div>
        </div>`;
      }).join('');

  // Meta funnel (D.13 — show error reason if API failed)
  const impY = num(cwY.impressions), clicksY = num(cwY.clicks), ctrY = num(cwY.ctr), cpcY = num(cwY.cpc);
  const purchasesY = num(((cwY.actions as Array<Record<string, unknown>>) || []).find(a => a.action_type === 'purchase')?.value);
  const drop1 = impY > 0 ? (1 - clicksY / impY) * 100 : 0;
  const drop2 = clicksY > 0 ? (1 - purchasesY / clicksY) * 100 : 100;
  const funnelHtml = (() => {
    // Deliberate PAUSE takes precedence over everything: never invent a
    // "delivery delay" explanation for a campaign oren paused on purpose.
    if (campaignPaused) {
      return '<div dir="rtl" style="padding:12px;background:#fff8ec;border-right:4px solid #e67e22;border-radius:4px;color:#9a5b1a;font-size:13px;text-align:right">🛑 <b>קמפיין מושהה</b> — אין הוצאה/חשיפות כי הקמפיין כבוי ביוזמת אורן (loss-leader · ממתין ל-FBIA re-test לפני הדלקה).</div>';
    }
    if (!metaData.ok) {
      const err = String(metaData.fetch_error || 'unknown');
      return `<div dir="rtl" style="padding:12px;background:#fff5f5;border-right:4px solid #c0392b;border-radius:4px;color:#c0392b;font-size:13px">❌ Meta API נכשל: <code style="font-size:11px;direction:ltr;display:inline-block">${esc(err)}</code><br><span style="color:#666;font-size:11px;margin-top:4px;display:block">לבדוק INSTAGRAM_ACCESS_TOKEN ב-Vercel envs ו-app permissions ב-developers.facebook.com</span></div>`;
    }
    if (impY === 0 && clicksY === 0) {
      // HONESTY CONTRACT (2026-07-10): an empty "yesterday" from Meta is a DATA GAP,
      // not proof of a delivery problem — never invent a "delivery delay" story.
      // Anchor the reader on the cumulative DB counter so the gap can't be misread
      // as "the campaign is dead" (07-09 the campaign burned ₪66 while this said 0).
      const dbAnchor = dbCampSpend > 0
        ? ` לפי המונה המצטבר ב-DB הקמפיין כן רץ: <b>₪${dbCampSpend.toFixed(0)} · ${dbCampClicks} קליקים סה"כ</b>.`
        : '';
      return campaignStatusKnown
        ? `<p dir="rtl" style="color:#888;font-size:13px;margin:0">⚠️ Meta לא החזיר נתוני-אתמול לקמפיין (פער-דיווח בצד Meta או שהשאילתה חזרה ריקה — לא בהכרח בעיית delivery).${dbAnchor}</p>`
        : '<p dir="rtl" style="color:#888;font-size:13px;margin:0">Meta לא החזיר נתוני-אתמול — סטטוס הקמפיין לא ידוע.</p>';
    }
    return `<table dir="rtl" width="100%" style="margin-bottom:10px"><tr>
        <td dir="rtl" align="center" style="width:20%;padding:6px"><div style="color:#3498db;font-size:16px;font-weight:700">${impY.toLocaleString()}</div><div style="color:#999;font-size:10px">חשיפות</div></td>
        <td dir="rtl" align="center" style="width:20%;padding:6px"><div style="color:#27ae60;font-size:16px;font-weight:700">${clicksY}</div><div style="color:#999;font-size:10px">קליקים</div></td>
        <td dir="rtl" align="center" style="width:20%;padding:6px"><div style="color:#9b59b6;font-size:16px;font-weight:700">${ctrY.toFixed(2)}%</div><div style="color:#999;font-size:10px">CTR</div></td>
        <td dir="rtl" align="center" style="width:20%;padding:6px"><div style="color:#e67e22;font-size:16px;font-weight:700">${sym}${cpcY.toFixed(2)}</div><div style="color:#999;font-size:10px">CPC</div></td>
        <td dir="rtl" align="center" style="width:20%;padding:6px"><div style="color:${purchasesY > 0 ? '#27ae60' : '#c0392b'};font-size:16px;font-weight:700">${purchasesY}</div><div style="color:#999;font-size:10px">רכישות</div></td>
      </tr></table>
      <div dir="rtl" style="background:#f8f6f0;border-radius:4px;padding:10px;font-family:monospace;font-size:11px;color:#666;line-height:1.7">חשיפות → קליקים: <b>${drop1.toFixed(1)}% נשירה</b><br>קליקים → רכישות: <b style="color:${purchasesY === 0 && clicksY > 5 ? '#c0392b' : '#666'}">${drop2.toFixed(1)}% נשירה</b></div>`;
  })();

  const actionsHtml = action_items_json.length === 0
    ? '<p dir="rtl" style="color:#888;font-size:13px;margin:0">אין פעולות דחופות</p>'
    : action_items_json.map((a, i) => {
        const p = PRIORITY_HE[a.priority] || { label: a.priority, color: '#888' };
        return `<div dir="rtl" style="padding:8px 12px;background:#fafafa;border-right:3px solid ${p.color};margin:4px 0;border-radius:4px;text-align:right;font-size:13px"><b style="color:${p.color}">${i + 1}.</b> ${esc(cleanRecommendationText(a.recommendation))} <span style="color:#888;font-size:11px">· ${p.label}</span></div>`;
      }).join('');

  // 📣 Marketing today — captions + clickable links + image thumbnails
  const FORMAT_HE: Record<string, string> = { feed_post:'📷 פוסט (Feed)', reel:'🎬 Reel', story:'⏱️ Story', carousel:'📑 קרוסלה', unknown:'? אחר' };
  const totalMarketing = marketingToday.total + marketingToday.tiktok.runs;
  const marketingStatsHtml = totalMarketing === 0
    ? '<p dir="rtl" style="color:#c0392b;font-size:13px;margin:0">לא פורסם תוכן ב-24 שעות אחרונות 🔴</p>'
    : `<table dir="rtl" width="100%" style="margin-bottom:12px"><tr>${Object.entries(marketingToday.byFormat).map(([fmt, n]) => `<td dir="rtl" align="center" style="padding:6px;text-align:center"><div style="color:#c8a96e;font-size:18px;font-weight:700">${n}</div><div style="font-size:11px;color:#aaa">${FORMAT_HE[fmt] || fmt}</div></td>`).join('')}${marketingToday.tiktok.runs > 0 ? `<td dir="rtl" align="center" style="padding:6px;text-align:center"><div style="color:#c8a96e;font-size:18px;font-weight:700">${marketingToday.tiktok.runs}</div><div style="font-size:11px;color:#aaa">🎵 TikTok</div></td>` : ''}</tr></table>`;
  const renderPostItem = (it: { format: string; caption: string; ig: string | null; fb: string | null; product_id: string | null; product_url: string | null; image: string | null }) => {
    const label = FORMAT_HE[it.format] || it.format;
    const captionText = it.caption?.trim() || '<span style="color:#bbb">[אין קופי בשדה content_data]</span>';
    const truncated = it.caption && it.caption.length > 180 ? esc(it.caption.slice(0, 180)) + '…' : (it.caption ? esc(it.caption) : captionText);
    // Permalink with friendly fallback hint
    const igLink = it.ig
      ? `<a href="${esc(it.ig)}" style="color:#e1306c;text-decoration:none;font-weight:600">📷 IG → ראה פוסט</a>`
      : `<span style="color:#888;font-size:11px">📷 IG — 🔄 פורסם, קישור יגיע תוך שעה</span>`;
    const fbLink = it.fb
      ? `<a href="${esc(it.fb)}" style="color:#1877f2;text-decoration:none;font-weight:600">📘 FB → ראה פוסט</a>`
      : `<span style="color:#888;font-size:11px">📘 FB — 🔄 פורסם, קישור יגיע תוך שעה</span>`;
    const prodLink = it.product_url ? `<a href="${esc(it.product_url)}" style="color:#aaa;text-decoration:none;font-size:10px">🛍 מוצר</a>` : '';
    const thumb = it.image ? `<img src="${esc(it.image)}" alt="" width="60" height="60" style="width:60px;height:60px;border-radius:6px;object-fit:cover;display:block;flex-shrink:0;border:1px solid #e8e4d4">` : '';
    return `<div dir="rtl" style="padding:10px 12px;background:#fafafa;margin:6px 0;border-radius:6px;text-align:right;font-size:12px;direction:rtl">
      <table dir="rtl" width="100%" cellspacing="0" cellpadding="0"><tr>
        ${thumb ? `<td valign="top" style="width:68px;padding-left:8px">${thumb}</td>` : ''}
        <td valign="top">
          <div style="margin-bottom:4px"><b style="color:#666;font-size:11px">${label}</b></div>
          <div style="color:#2c2c2c;font-size:12.5px;line-height:1.55;margin:0 0 6px;white-space:pre-wrap">${truncated}</div>
          <div style="font-size:11px">${igLink} <span style="color:#ddd">·</span> ${fbLink}${prodLink ? ' <span style="color:#ddd">·</span> ' + prodLink : ''}</div>
        </td>
      </tr></table>
    </div>`;
  };
  const renderTiktokItem = (it: { caption: string; url: string | null; product_url: string | null; late_id: string | null; product_slug: string | null }) => {
    // Caption is already cleaned of JSON upstream. Build a friendly label.
    const captionShort = it.caption ? esc(it.caption.slice(0, 120)) : '';
    const productBit = it.product_slug ? esc(it.product_slug) : '';
    const label = [productBit, captionShort].filter(Boolean).join(' · ');
    const headlineHtml = label
      ? `🎵 TikTok — פורסם ✅ <span style="color:#666">(${label})</span>`
      : `🎵 TikTok — פורסם ✅`;
    const ttLink = it.url
      ? `<a href="${esc(it.url)}" style="color:#000;text-decoration:none;font-weight:600">🎵 פתח ב-TikTok →</a>`
      : `<span style="color:#888;font-size:11px">🎵 TikTok — 🔄 קישור יגיע תוך שעה</span>`;
    const lateBit = it.late_id
      ? ` <span style="color:#ddd">·</span> <code style="font-size:10px;color:#888">Late ${esc(it.late_id)}</code>`
      : '';
    const prodLink = it.product_url ? ` <span style="color:#ddd">·</span> <a href="${esc(it.product_url)}" style="color:#aaa;text-decoration:none;font-size:10px">🛍 מוצר</a>` : '';
    return `<div dir="rtl" style="padding:10px 12px;background:#fafafa;margin:6px 0;border-radius:6px;text-align:right;font-size:12px;direction:rtl">
      <div style="color:#2c2c2c;font-size:12.5px;line-height:1.55;margin:0 0 6px">${headlineHtml}</div>
      <div style="font-size:11px">${ttLink}${lateBit}${prodLink}</div>
    </div>`;
  };
  const marketingItemsHtml = (marketingToday.items.length === 0 && marketingToday.tiktok.items.length === 0)
    ? ''
    : (marketingToday.items.slice(0, 6).map(renderPostItem).join('') + marketingToday.tiktok.items.slice(0, 4).map(renderTiktokItem).join(''));

  // ✍️ Pending approvals — slogan-approval framing REMOVED (2026-06-15).
  // pending.products are real products parked at pending_visual_approval (a genuine
  // gate), relabelled "מוצרים ממתינים לאישור ויזואלי". The slogan_candidates count
  // is gone entirely — every active DB slogan is auto-approved (open-list policy).
  const totalPending = pending.products.length + pending.pipelineFailed.length + pending.pipelineDispatched.length + pending.candidates.length;
  const pendingHtml = totalPending === 0
    ? '<p dir="rtl" style="color:#27ae60;font-size:13px;margin:0">✅ אין שום מוצר מחכה לאישור</p>'
    : [
      pending.products.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#e67e22;font-size:13px">👀 מוצרים ממתינים לאישור ויזואלי (${pending.products.length})</b>${pending.products.slice(0, 6).map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">${esc(p.title)} <span style="color:${p.age_days > 7 ? '#c0392b' : '#888'};font-size:11px">· ${p.age_days} ימים</span></div>`).join('')}</div>`,
      pending.pipelineFailed.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#c0392b;font-size:13px">🔴 מוצרים שממתינים לטיפול ידני (${pending.pipelineFailed.length})</b><div dir="rtl" style="color:#888;font-size:10.5px;margin:2px 0 4px">כבר ניסינו אוטומטית פעם אחת — עדיין נכשל.</div>${pending.pipelineFailed.slice(0, 4).map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">מוצר #${p.pid || '?'} · <span style="color:#888">${esc(p.error).slice(0, 80)}</span> · ${p.age_days} ימים</div>`).join('')}</div>`,
      pending.pipelineDispatched.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#e67e22;font-size:13px">⏳ צינור מוצר תקוע (${pending.pipelineDispatched.length})</b>${pending.pipelineDispatched.map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">מוצר #${p.pid || '?'} · ממתין כבר ${p.age_hours} שעות</div>`).join('')}</div>`,
      pending.candidates.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#3498db;font-size:13px">📊 מומלצות מ-Gelato Discovery (${pending.candidates.length})</b>${pending.candidates.map(c => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">${esc(c.brand)} · score ${c.score.toFixed(1)} · <code style="font-size:10px;color:#888">${esc(c.uid)}</code></div>`).join('')}</div>`,
    ].filter(Boolean).join('');

  // ✨ NEW products that went live this week — replaces the slogan-approval block.
  const newProductsHtml = buildNewProductsHtml(newProductsWeek);
  // 📬 Email digest (24h) — summary + recommended actions, self-reports/marketing filtered out.
  const emailDigestHtml = buildEmailDigestHtml(emailDigest);
  // 🧭 Management decision board — recommendations DECIDED by the embedded-Adam pass.
  const managementBuilt = buildManagementBoardHtml(managementBoard);
  const managementHtml = managementBuilt.html;

  // Orders — new in window (last 24h or 7d)
  const todaysOrders = (realOrders || []).slice(0, 5);
  const ordersHtml = (realOrders || []).length === 0
    ? '<p dir="rtl" style="color:#888;font-size:13px;margin:0">אין הזמנות בחלון</p>'
    : todaysOrders.map(o => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">📦 <code>${esc(String(o.id).slice(0, 8))}</code> · $${num(o.total_amount).toFixed(0)} · ${esc(humanOrderStatus(o.status as string))}</div>`).join('');

  // B.10 — Per-order daily tracking. Status must be human-meaningful (2026-06-15).
  // Labels come from the module-level humanOrderStatus() (our statuses + raw Gelato
  // statuses). Colors stay local. Oren must know WHERE the order is — never a raw code.
  const STATUS_COLOR: Record<string, string> = {
    'pending': '#e67e22', 'paid': '#e67e22', 'created': '#e67e22', 'open': '#e67e22',
    'in_production': '#3498db', 'in-production': '#3498db', 'passed': '#3498db', 'passed_to_production': '#3498db', 'printed': '#3498db',
    'shipped': '#9b59b6', 'in_transit': '#9b59b6',
    'delivered': '#27ae60', 'fulfilled': '#27ae60',
    'canceled': '#c0392b', 'cancelled': '#c0392b', 'refunded': '#c0392b',
    'unknown': '#999',
  };
  const renderOrderRow = (r: TrackedOrderRow, highlighted: boolean) => {
    const sk = (r.status || 'unknown').toLowerCase();
    const statusLabel = humanOrderStatus(r.status);
    const statusColor = STATUS_COLOR[sk] || '#999';
    const buyerShort = r.highlight_name || (r.buyer_email.length > 28 ? r.buyer_email.slice(0, 28) + '…' : r.buyer_email);
    const recentBadge = r.changed_in_24h ? '<span style="background:#27ae60;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">⚡ עודכן 24h</span>' : '';
    const handledBadge = r.handled_offline ? '<span style="background:#888;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">🤝 טופל ידנית</span>' : '';
    const highlightBadge = highlighted ? '<span style="background:#c8a96e;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">⭐ מעקב אישי</span>' : '';
    const stalenessColor = r.handled_offline ? '#888' : (r.days_in_status > 14 ? '#c0392b' : r.days_in_status > 7 ? '#e67e22' : '#666');
    // Always give oren SOMEWHERE to look: carrier tracking link if shipped,
    // else the Gelato dashboard order page (so "where is it?" always answerable).
    const gelatoDashLink = r.gelato_ref ? `https://dashboard.gelato.com/orders/${encodeURIComponent(String(r.gelato_ref))}` : null;
    const trackingLink = r.tracking_url
      ? ` · <a href="${esc(r.tracking_url)}" style="color:#9b59b6;text-decoration:none;font-weight:600">📦 מעקב משלוח →</a>`
      : (r.tracking_number
          ? ` · <code style="font-size:10px">${esc(r.tracking_number)}</code>`
          : (gelatoDashLink ? ` · <a href="${esc(gelatoDashLink)}" style="color:#9b59b6;text-decoration:none;font-weight:600">🔎 סטטוס ב-Gelato →</a>` : ''));
    const gelatoRef = r.gelato_ref ? `Gelato ID: <code style="font-size:10.5px;color:#666">${esc(String(r.gelato_ref).slice(0, 12))}</code>` : '';
    const bg = highlighted ? '#fff8ec' : (r.handled_offline ? '#f5f5f5' : (r.days_in_status > 14 ? '#fff5f5' : '#fafafa'));
    const borderColor = highlighted ? '#c8a96e' : statusColor;
    return `<div dir="rtl" style="padding:8px 12px;background:${bg};margin:4px 0;border-radius:6px;text-align:right;font-size:12px;border-right:3px solid ${borderColor}">
       <div style="margin-bottom:4px">
         ${highlightBadge}<b style="color:${statusColor}">${statusLabel}</b>
         ${recentBadge}${handledBadge}
         <span style="color:#999;font-size:11px;margin-right:4px">· $${r.total_amount.toFixed(0)}</span>
       </div>
       <div style="color:#444;font-size:11.5px">
         📦 <b>${esc(buyerShort)}</b>
         <span style="color:#999"> · </span>
         📅 הוזמן ${esc(r.created_at.slice(0,10))} (לפני ${r.age_days} ימים)
         <span style="color:#999"> · </span>
         <span style="color:${stalenessColor}">בסטטוס הזה כבר ${r.days_in_status} ימים</span>
         ${trackingLink}
       </div>
       ${gelatoRef ? `<div style="margin-top:3px;color:#888;font-size:10.5px">${gelatoRef} · <code style="font-size:10px;color:#bbb">${esc(r.id.slice(0,8))}</code></div>` : ''}
     </div>`;
  };
  const highlightedHtml = orderTracking.highlighted.length === 0 ? '' :
    `<div dir="rtl" style="margin:0 0 10px;direction:rtl;text-align:right">
       <div style="color:#c8a96e;font-size:11.5px;font-weight:700;margin-bottom:4px">⭐ מעקב אישי</div>
       ${orderTracking.highlighted.map(r => renderOrderRow(r, true)).join('')}
     </div>`;
  // Closed orders → one summary count line, never per-row (oren 2026-06-20).
  const closedLine = (orderTracking.deliveredCount > 0 || orderTracking.cancelledCount > 0)
    ? `<p dir="rtl" style="color:#999;font-size:11px;margin:8px 0 0;text-align:right">${orderTracking.deliveredCount} נמסרו · ${orderTracking.cancelledCount} בוטלו — לא מוצגים (30 ימים).</p>`
    : '';
  const trackingHtml = orderTracking.total === 0
    ? `<p dir="rtl" style="color:#27ae60;font-size:13px;margin:0">✅ אין הזמנות פעילות שדורשות תשומת לב.</p>${closedLine}`
    : `<p dir="rtl" style="color:#666;font-size:11px;margin:0 0 10px">${orderTracking.total} הזמנות בתהליך שדורשות תשומת לב (בהמתנה/בייצור/בהדפסה/נשלח). ${[...orderTracking.highlighted, ...orderTracking.rows].filter(r => r.changed_in_24h).length} שינו סטטוס ב-24 שעות אחרונות.</p>` +
       highlightedHtml +
       orderTracking.rows.map(r => renderOrderRow(r, false)).join('') +
       closedLine;

  // A.3 — Rich agent status table: name | when | what it did | error
  const allAgentIds = ['boss','content','marketing','product','supply','design','site_audit','email_monitor','gelato_stock','cto','security','video','planner','tiktok'];
  // On-demand agents: idle is NORMAL, never counted as a problem (boss.md contract).
  const ON_DEMAND_AGENTS = new Set(['cto','planner','video','product','design']);
  // 2026-06-15 fix: real watchdog counts from agent_runs (was hardcoded 0,0,0,0
  // in the boss_reports insert → the status engine was blind and could never
  // surface a real failure). Compute ok/amber/red/idle from live last-run +
  // recency, and collect the agents that actually failed.
  const agentCounts = { ok_count: 0, amber_count: 0, red_count: 0, grey_count: 0 };
  const failedAgents: Array<{ id: string; he: string; reason: string; hours: number }> = [];
  // 2026-07-12: the DAILY report shows only EXCEPTIONS (failed / stale scheduled
  // agents) — a table of 14 "ran fine" rows every morning is noise (oren).
  const exceptionAgentIds: string[] = [];
  // agent → its live opinion (first one wins) — feeds the per-agent conclusion line.
  const opinionByAgent = new Map<string, Opinion>();
  for (const o of allOpinions) if (!opinionByAgent.has(o.agent)) opinionByAgent.set(o.agent, o);
  for (const id of allAgentIds) {
    const h = agentHealth[id];
    if (!h) {
      // No run found in the 30-day window. Idle on-demand agents are fine (grey/ok);
      // a scheduled agent with zero runs is amber (worth a glance) — but since the
      // health map already covers 30d, truly-never-ran is rare.
      agentCounts.grey_count++;
      continue;
    }
    const hs = hoursSince(h.last_run);
    const isFailed = h.status === 'failed' || h.status === 'error';
    if (isFailed) {
      agentCounts.red_count++;
      failedAgents.push({ id, he: AGENT_ID_TO_HE[id] || id, reason: translateErrorPhrase(h.error || h.summary || 'unknown'), hours: hs });
      exceptionAgentIds.push(id);
    } else if ((h.status === 'completed' || h.status === 'ok') && hs < 26) {
      agentCounts.ok_count++;
    } else if (ON_DEMAND_AGENTS.has(id)) {
      // ran sometime, on-demand → idle is normal, count as ok (not amber).
      agentCounts.ok_count++;
    } else if (hs < 72) {
      agentCounts.amber_count++;
      exceptionAgentIds.push(id);
    } else {
      // scheduled agent that hasn't run in 3+ days → stale, flag amber-ish red.
      agentCounts.amber_count++;
      exceptionAgentIds.push(id);
    }
  }
  // Header summary line so the watchdog is visible at a glance + a red banner
  // listing real failures (the thing this section exists to catch).
  const agentSummaryLine = `<p dir="rtl" style="margin:0 0 10px;font-size:12px;color:#666;direction:rtl;text-align:right">✅ ${agentCounts.ok_count} תקינים · 🟡 ${agentCounts.amber_count} מתעכבים · 🔴 ${agentCounts.red_count} נכשלו · ⚪ ${agentCounts.grey_count} לא רצו</p>`;
  const agentFailBanner = failedAgents.length === 0 ? '' :
    `<div dir="rtl" style="background:#fff5f5;border:1px solid #ffcfcf;border-radius:6px;padding:8px 12px;margin:0 0 10px;direction:rtl;text-align:right">
      <b style="color:#c0392b;font-size:12px">🔴 סוכנים שנכשלו:</b>
      ${failedAgents.map(f => `<div style="font-size:11.5px;color:#333;margin-top:3px">• <b>${esc(f.he)}</b> — ${esc(f.reason)} <span style="color:#999">(לפני ${f.hours >= 24 ? Math.round(f.hours/24)+' ימים' : Math.round(f.hours)+' שעות'})</span></div>`).join('')}
    </div>`;
  const buildAgentTable = (ids: string[]) => `<table dir="rtl" width="100%" style="border-collapse:collapse;font-size:12px">
    <tr style="background:#f0ebe0">
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700;width:130px">סוכן</th>
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700;width:70px">אחרון</th>
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700">מה עשה</th>
    </tr>
    ${ids.map(id => {
      const h = agentHealth[id];
      const he = AGENT_ID_TO_HE[id] || id;
      let icon = '⚪', color = '#999', when = '—', actionText = 'לא הופעל היום';
      if (h) {
        const hs = hoursSince(h.last_run);
        const isFailed = h.status === 'failed' || h.status === 'error';
        if (isFailed) { icon = '🔴'; color = '#c0392b'; }
        else if ((h.status === 'completed' || h.status === 'ok') && hs < 26) { icon = '✅'; color = '#27ae60'; }
        else if (hs < 72) { icon = '🟡'; color = '#e67e22'; }
        when = hs < 1 ? `${Math.round(hs*60)} דק׳` : hs < 48 ? `${Math.round(hs)}ש` : `${Math.round(hs/24)}י`;
        // Auto-heal contextual hint for stock-check failure
        let healNote: string | null = null;
        if (id === 'gelato_stock' && isFailed) {
          if (gelatoStockHeal.attempted && gelatoStockHeal.healed) healNote = 'נפתרה אוטומטית, מחכה לריצה הבאה';
          else if (gelatoStockHeal.attempted) healNote = 'ניסה לתקן אוטומטית — נכשל גם כן';
        }
        actionText = esc(humanizeAgentSummary(id, h.summary, h.side_effects, hs, isFailed, h.error, healNote));
        if (h.runs_24h > 0) actionText += ` <span style="color:#999;font-size:10px">· ${h.runs_24h}× ב-24h${h.done_24h !== h.runs_24h ? ` (${h.done_24h} הצליחו)` : ''}</span>`;
        // 2026-07-08 manager-contract: conclusion-line per agent — what it CONCLUDED
        // (its live opinion), not just what it ran. "רץ תקין" is a log line.
        const agentOp = opinionByAgent.get(id);
        if (agentOp) actionText += `<div style="color:#5a4a2f;font-size:11px;margin-top:3px">🧠 <b>מסקנה:</b> ${esc(agentOp.observation)} → ${esc(cleanRecommendationText(agentOp.recommendation))}</div>`;
      }
      return `<tr style="border-bottom:1px solid #f0ebe0">
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top">${icon} <b>${esc(he)}</b></td>
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top;color:${color};font-size:11px">${esc(when)}</td>
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top;color:#333;font-size:11.5px;line-height:1.5">${actionText}</td>
      </tr>`;
    }).join('')}
  </table>`;
  // Weekly = the full 14-row table. Daily = summary line + failures banner +
  // rows ONLY for agents that need attention (2026-07-12, oren).
  const agentHealthFullHtml = agentSummaryLine + agentFailBanner + buildAgentTable(allAgentIds);
  const agentHealthExceptionsHtml = agentSummaryLine + agentFailBanner + (exceptionAgentIds.length ? buildAgentTable(exceptionAgentIds) : '');
  const agentsAllOk = exceptionAgentIds.length === 0;

  // A.4 — SVG sparkline
  const trendHtml = buildSparkline(dailySnaps);

  // 📊 $1,000 Plan section — silently omitted if fetch failed or no data.
  const planSectionHtml = planStatus ? buildPlanSectionHtml(planStatus) : '';
  const weeklyMktgHtml = buildWeeklyMarketingHtml(weeklyMktg);
  const personaHtml = buildPersonaSeriesHtml(personaData);
  const autoProductHealthHtml = buildAutoProductHealthHtml(autoProductHealth);
  const reelBankGapsHtml = buildReelBankGapsHtml(reelGaps);
  const contentPerfHtml = buildContentPerfHtml(contentPerf);
  const moltbookHtml = buildMoltbookHtml(moltbook, isWeekly);
  // 🎯 3 decisions — COMPUTED (manager-contract 2026-07-08): kill-switch gates +
  // open escalations + aging oren-blockers + live P0/P1 opinions, each with
  // cost-of-inaction; the card opens with the two-engines strip.
  const killSwitch = await fetchKillSwitch(sb).catch(() => null);
  const decisionItems = deriveDecisions(
    allOpinions,
    killSwitch,
    managementBoard,
    (planStatus?.blocked_on_oren || []).map(b => ({ title: b.title, days_late: b.days_late })),
  );
  const topDecisionsHtml = buildTopDecisionsHtml(decisionItems, killSwitch, contentPerf);

  const lastWeekSection = isWeekly && lastWeekCheck.total > 0
    ? `<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📊 מהשבוע הקודם</h2><p dir="rtl" style="font-size:13px;margin:0 0 10px"><b>${lastWeekCheck.done}/${lastWeekCheck.total} הושלמו (${Math.round(lastWeekCheck.done/lastWeekCheck.total*100)}%).</b></p>${lastWeekCheck.details.slice(0,5).map(d => { const ic = d.status === 'done' ? '✅' : d.status === 'open' ? '⏳' : '❌'; return `<div dir="rtl" style="padding:8px 12px;background:#fafafa;margin:4px 0;border-radius:4px;text-align:right;font-size:12px">${ic} <b>${esc(d.agent)}:</b> ${esc(d.rec.slice(0,100))}</div>`; }).join('')}</td></tr><tr><td style="height:14px"></td></tr>` : '';

  const reportTypeLabel = isWeekly ? 'ישיבת הנהלה שבועית' : 'דוח יומי';

  // ============================================================
  // v13 ASSEMBLY (2026-07-12, oren: "קחו את הדוחות לרמה 1,000,000").
  // DAILY = a manager's letter: a section renders ONLY when there is NEWS in it;
  // everything routine collapses into one "שגרה" digest card at the bottom.
  // WEEKLY = a real management meeting: week numbers, per-agent retrospective +
  // recommendation, the board's adopt/reject/escalate record, and what oren is
  // needed for — NO duplication of the daily layout.
  // ============================================================
  const sectionCard = (title: string, inner: string, border?: string) =>
    `<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right${border ? ';border:2px solid ' + border : ''}"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">${title}</h2>${inner}</td></tr><tr><td style="height:14px"></td></tr>`;
  const managerViewCard = `<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><div dir="rtl" style="background:#2c2c2c;color:#fff;padding:12px 16px;border-radius:6px;direction:rtl;text-align:right"><h3 dir="rtl" style="margin:0 0 6px;color:#c8a96e;font-size:13px">דעת המנהל</h3><p dir="rtl" style="margin:0;font-size:12.5px;line-height:1.7">${esc(synth.managerView)}</p></div></td></tr><tr><td style="height:14px"></td></tr>`;

  const routine: string[] = [];
  const freshProducts = newProductsWeek.filter(p => p.days_ago === 0);
  // Fresh AND materially changed — an unchanged weekly read repeating the same
  // numbers is routine, not news (oren 2026-07-12: "אותם מספרים כל הזמן").
  const learningFresh = !!(contentPerf?.learning && hoursSince(contentPerf.learning.created_at) < 26
    && ((contentPerf.learning as { directives?: Record<string, unknown> }).directives?.material_change !== false));
  const snapsOrders = dailySnaps.reduce((s, d) => s + (d.orders_today || 0), 0);
  const moltbookHasNews = !!(moltbook && (moltbook.posts.length > 0 || moltbook.neo));
  const autoNews = !!(autoProductHealth && (autoProductHealth.techFailures.length > 0 || freshProducts.some(p => p.auto))) || !!(reelGaps && reelGaps.missing.length > 0);

  let sections = '';
  if (!isWeekly) {
    // ---------- DAILY ----------
    sections += sectionCard('🎯 החלטות להיום', topDecisionsHtml, '#c8a96e');
    sections += autoFixHtml;
    sections += recurringHtml;
    if (opinions.length > 0) sections += sectionCard(`🚨 ממצאים חדשים (${opinions.length})`, issuesHtml);
    else routine.push('אין ממצאים חדשים מהסוכנים');
    if (freshProducts.length > 0) sections += sectionCard('✨ מוצר חדש היום', newProductsHtml);
    else {
      const last = newProductsWeek[0];
      routine.push(`מוצר חדש: אין היום${last ? ` (האחרון: #${last.numeric} לפני ${last.days_ago} ימים)` : ''} · הבא — שלישי בבוקר, אוטומטי`);
    }
    if (totalPending > 0) sections += sectionCard(`✍️ מחכה לאישורך (${totalPending})`, pendingHtml);
    else routine.push('אין מוצרים שמחכים לאישור שלך');
    if (managementBuilt.hasNews) sections += sectionCard('🧭 שולחן ההנהלה — מה הוכרע', managementHtml);
    else routine.push('שולחן ההנהלה: אין הכרעות חדשות ואין פריטים פתוחים');
    if (emailDigest && emailDigest.kept > 0) sections += sectionCard('📬 מיילים שדורשים טיפול', emailDigestHtml);
    else routine.push('מיילים: אין חדש שדורש טיפול');
    if (moltbookHasNews) sections += sectionCard('🦞 ערוץ הסוכנים — Moltbook + ניאו', moltbookHtml);
    else routine.push('ערוץ הסוכנים (Moltbook): אין פוסטים חדשים בחלון');
    // What actually went up gets FULL detail (captions, links) — oren's ask.
    sections += sectionCard(`📣 מה פורסם בפועל ב-24 שעות (${totalMarketing})`, marketingStatsHtml + marketingItemsHtml);
    sections += sectionCard('📅 התוכנית השבועית', weeklyMktgHtml);
    if (personaData && personaData.published.length > 0) sections += sectionCard('🐻 סדרת הסוכנים — עלה פרק/פוסט', personaHtml);
    else routine.push(personaData?.next
      ? `סדרת הסוכנים: אין פוסט חדש היום · הבא בתור — ${PERSONA_HE[personaData.next.persona] || personaData.next.persona}`
      : 'סדרת הסוכנים: אין פוסט חדש היום · התור מתמלא אוטומטית ביום ראשון');
    if ((realOrders || []).length > 0 || orderTracking.total > 0) {
      const newPart = (realOrders || []).length ? `<div dir="rtl" style="margin-bottom:10px;text-align:right"><b style="font-size:12.5px">חדשות (24 שעות):</b>${ordersHtml}</div>` : '';
      sections += sectionCard('🛒 הזמנות — חדשות ובתהליך', newPart + trackingHtml);
    } else routine.push('הזמנות: אין חדשות ואין הזמנות בתהליך');
    if (!campaignPaused) sections += sectionCard('📊 קמפיין ממומן — אתמול', funnelHtml);
    else routine.push('קמפיין ממומן: מושהה בכוונה — אפס הוצאה');
    if (snapsOrders > 0) sections += sectionCard('📈 הכנסות 14 הימים האחרונים', trendHtml);
    else routine.push('הכנסות: אפס הזמנות ב-14 הימים האחרונים');
    if (autoNews) sections += sectionCard('🤖 קו המוצרים האוטומטי — דורש מבט', autoProductHealthHtml + reelBankGapsHtml);
    else routine.push('קו המוצרים האוטומטי: תקין · המוצר הבא — שלישי בבוקר');
    if (learningFresh) sections += sectionCard('📈 ביצועי תוכן — ניתוח שבועי טרי', contentPerfHtml);
    else routine.push(`תוכן אורגני: ${contentPerf?.siteClicks.total ?? 0} כניסות לאתר ב-30 ימים · הניתוח השבועי הבא — יום ראשון`);
    routine.push(buildPlanNextStepLine(planStatus));
    sections += managerViewCard;
    if (!agentsAllOk) sections += sectionCard('🤖 סוכנים שדורשים טיפול', agentHealthExceptionsHtml);
    else routine.push(`הסוכנים: כולם רצו תקין (✅ ${agentCounts.ok_count})`);
    const routineHtml = routine.map(l => `<div dir="rtl" style="font-size:12px;color:#666;padding:4px 0;text-align:right;border-bottom:1px dashed #f0ebe0">· ${esc(l)}</div>`).join('');
    sections += sectionCard('💤 שגרה — רץ ותקין, בלי חדשות', routineHtml || '<p dir="rtl" style="font-size:12px;color:#888;margin:0;text-align:right">הכל למעלה — יום עמוס.</p>');
  } else {
    // ---------- WEEKLY ----------
    const wb = (managementBoard?.recent || []);
    const wkLines = [
      `🛒 <b>${(realOrders || []).length}</b> הזמנות לקוח · <b>$${totalRevenue.toFixed(0)}</b> הכנסה`,
      `🌐 <b>${realMetrics?.pageViews7d ?? '?'}</b> כניסות אמיתיות לאתר (7 ימים)`,
      weeklyMktg ? `📣 פורסמו <b>${weeklyMktg.done + weeklyMktg.extra}</b> פריטי תוכן (${weeklyMktg.done} מהתוכנית + ${weeklyMktg.extra} מחוץ לה)` : '',
      newProductsWeek.length ? `✨ <b>${newProductsWeek.length}</b> מוצרים חדשים עלו: ${newProductsWeek.map(p => `<a href="https://www.dubis.net/#product-${p.numeric}" style="color:#c8a96e;text-decoration:none">#${p.numeric}</a>`).join(', ')}` : '✨ לא עלו מוצרים חדשים השבוע',
      moltbook && moltbook.posts.length ? `🦞 <b>${moltbook.posts.length}</b> פוסטים ב-Moltbook · ${moltbook.totalUp} הצבעות · ${moltbook.totalCom} תגובות${moltbook.karma != null ? ` · קארמה ${moltbook.karma}` : ''}` : '',
    ].filter(Boolean).map(l => `<div dir="rtl" style="font-size:13px;margin:5px 0;text-align:right">${l}</div>`).join('');

    const recOf = (id: string, fallback: string) => {
      const o = opinionByAgent.get(id);
      return o ? `${esc(o.observation)} ← ${esc(cleanRecommendationText(o.recommendation))}` : esc(fallback);
    };
    const retroRow = (name: string, what: string, recText: string) =>
      `<div dir="rtl" style="padding:9px 12px;background:#fafafa;border-right:3px solid #c8a96e;border-radius:6px;margin:5px 0;text-align:right"><div style="font-size:12.5px;color:#2c2c2c"><b>${name}</b> — ${what}</div><div style="font-size:11.5px;color:#5a4a2f;margin-top:3px">🧠 המלצה: ${recText}</div></div>`;
    const ks = killSwitch;
    const secOp = opinionByAgent.get('security');
    const weeklyRetroHtml = [
      retroRow('שיווק ממומן',
        ks && ks.active ? `הוצאה ${esc(ks.sym)}${ks.spend.toFixed(0)} · ${ks.clicks} קליקים · ${ks.carts} הוספות לסל · ${ks.purchases} רכישות. ${esc(ks.gateLine)}` : 'הקמפיין מושהה — אפס הוצאה השבוע.',
        recOf('marketing', 'להשאיר מושהה עד שתיקוני-האמון יראו המרה אורגנית')),
      retroRow('תוכן אורגני',
        `${weeklyMktg ? `${weeklyMktg.done}/${weeklyMktg.total} מהתוכנית פורסם + ${weeklyMktg.extra} נוספים` : 'אין תוכנית פעילה'}${contentPerf ? ` · ${contentPerf.totalEng} מעורבות · ${contentPerf.siteClicks.total} כניסות לאתר (30 ימים)` : ''}`,
        recOf('content', contentPerf?.learning ? contentPerf.learning.summary.slice(0, 160) : 'ממשיכים לפי התוכנית')),
      retroRow('מוצר',
        `${newProductsWeek.length} מוצרים חדשים השבוע${autoProductHealth ? ` · ${autoProductHealth.techFailures.length} כשלים טכניים · ${autoProductHealth.retries7d} תיקונים אוטומטיים` : ''}`,
        recOf('product', 'הקו האוטומטי ממשיך — מוצר חדש כל שלישי')),
      retroRow('הזמנות ואספקה',
        `${(realOrders || []).length} חדשות · ${orderTracking.total} בתהליך · ${orderTracking.deliveredCount} נמסרו · ${orderTracking.cancelledCount} בוטלו`,
        recOf('supply', 'אין חריגים — מעקב שוטף')),
      retroRow('אבטחה',
        secOp ? esc(secOp.observation) : 'הסריקה השבועית רצה — אין ממצאים פתוחים. (בדיקות RLS/npm/git רצות בשכבת GitHub, לא בענן — פער ידוע ומנוהל.)',
        recOf('security', 'אין פעולה נדרשת')),
      retroRow('וידאו וסדרת הסוכנים',
        `${personaData ? `בתור הסדרה: ${personaData.remaining} פוסטים` : 'אין נתוני סדרה'}${reelGaps ? ` · בנק רילים: ${reelGaps.withReel}/${reelGaps.total} מוצרים מכוסים` : ''}`,
        recOf('video', 'ממשיכים במנדט האוטונומי — פרק חדש כשיש אירוע אמיתי')),
      retroRow('ערוץ הסוכנים (Moltbook + ניאו)',
        moltbook ? `${moltbook.posts.length} פוסטים${moltbook.karma != null ? ` · קארמה ${moltbook.karma}` : ''}${moltbook.neo ? ' · מייל חדש מניאו' : ''}` : 'אין נתונים',
        'ממשיכים 3 פוסטים ביום · עוקבים אחרי תגובות וקארמה'),
    ].join('');

    const bRow = (txt: string, color: string) => `<div dir="rtl" style="font-size:12px;color:#333;padding:6px 10px;background:#fcfbf7;border-right:3px solid ${color};border-radius:4px;margin:3px 0;text-align:right">${txt}</div>`;
    const adopted = wb.filter(r => r.decision === 'adopt');
    const rejected = wb.filter(r => r.decision === 'reject');
    const escalated = wb.filter(r => r.decision === 'escalate');
    const taskStatusHe: Record<string, string> = { done: 'בוצע ✅', backlog: 'בתור', pending: 'בתור', approved: 'בתור', in_progress: 'בעבודה' };
    const weeklyBoardHtml = (adopted.length + rejected.length + escalated.length) === 0
      ? '<p dir="rtl" style="font-size:12.5px;color:#888;margin:0;text-align:right">לא עלו המלצות חדשות להכרעה השבוע.</p>'
      : [
          adopted.length ? `<div dir="rtl" style="font-size:12.5px;font-weight:700;color:#1e6b1e;margin:4px 0;text-align:right">✅ אימצנו (${adopted.length}):</div>` + adopted.map(r => bRow(`${esc(r.recommendation.slice(0, 150))} ← <b>${esc(r.owner_agent || 'manual')}</b> (${taskStatusHe[r.created_task_id ? (managementBoard!.taskStatus[r.created_task_id] || 'backlog') : 'backlog'] || 'בתור'})`, '#27ae60')).join('') : '',
          rejected.length ? `<div dir="rtl" style="font-size:12.5px;font-weight:700;color:#777;margin:8px 0 4px;text-align:right">❌ דחינו (${rejected.length}):</div>` + rejected.map(r => bRow(`${esc(r.recommendation.slice(0, 120))} — <span style="color:#888">${esc((r.rationale || '').slice(0, 120))}</span>`, '#bbb')).join('') : '',
          escalated.length ? `<div dir="rtl" style="font-size:12.5px;font-weight:700;color:#a12020;margin:8px 0 4px;text-align:right">⬆️ העלינו אליך (${escalated.length}):</div>` + escalated.map(r => bRow(`${esc(r.recommendation.slice(0, 150))}${r.rationale ? ` — <span style="color:#888">${esc(r.rationale.slice(0, 100))}</span>` : ''}`, '#c0392b')).join('') : '',
        ].filter(Boolean).join('');

    const needsRows = [
      ...escalated.filter(r => !r.outcome).map(r => `⬆️ ${esc(r.recommendation.slice(0, 140))}`),
      ...(planStatus?.blocked_on_oren || []).map(b => `🚧 ${esc(b.title)}${b.oren_action ? ' — ' + esc(b.oren_action.slice(0, 100)) : ''}${b.days_late > 0 ? ` <span style="color:#c0392b">(מחכה ${b.days_late} ימים)</span>` : ''}`),
    ];
    const needsFromOrenHtml = needsRows.length
      ? needsRows.map(t => `<div dir="rtl" style="font-size:12.5px;padding:7px 10px;background:#fff5f5;border-right:3px solid #c0392b;border-radius:4px;margin:4px 0;text-align:right">${t}</div>`).join('')
      : '<p dir="rtl" style="font-size:12.5px;color:#27ae60;margin:0;text-align:right">✅ שום דבר לא מחכה לך השבוע.</p>';

    sections += sectionCard('🎯 ההחלטות לשבוע הקרוב', topDecisionsHtml, '#c8a96e');
    sections += sectionCard('🧭 מה קרה השבוע — במספרים', wkLines);
    sections += sectionCard('🪑 סבב הסוכנים — מה קרה ומה כל אחד ממליץ', `<p dir="rtl" style="font-size:11px;color:#999;margin:0 0 8px;text-align:right">ההמלצות מוכרעות בשולחן ההנהלה (למטה) — אימוץ מקבל בעלים ומבוצע; רק כסף/אסטרטגיה עולים אליך.</p>` + weeklyRetroHtml);
    sections += sectionCard('🧭 שולחן ההנהלה השבוע — אימצנו / דחינו / עולה אליך', weeklyBoardHtml);
    sections += sectionCard('🚨 מה אנחנו צריכים ממך', needsFromOrenHtml);
    sections += planSectionHtml;
    if (moltbookHasNews) sections += sectionCard('🦞 ערוץ הסוכנים השבוע — Moltbook + ניאו', moltbookHtml);
    sections += sectionCard('📈 התוכן החזק של השבוע', contentPerfHtml);
    sections += lastWeekSection;
    sections += sectionCard('📈 הכנסות 14 הימים האחרונים', trendHtml);
    sections += managerViewCard;
    sections += sectionCard('🤖 מצב כל הסוכנים (שבועי)', agentHealthFullHtml);
  }

  const replyNote = `<tr><td dir="rtl" align="center" style="padding-top:6px;text-align:center"><p dir="rtl" style="margin:0;color:#8a6d00;font-size:12px;background:#fdf7e3;border-radius:8px;padding:8px 14px;display:inline-block">📩 אפשר פשוט <b>להשיב למייל הזה</b> — סוכן המייל קורא את התשובה, היא נכנסת לשולחן ההנהלה ומבוצעת.</p></td></tr>`;

  const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="color-scheme" content="light"></head><body dir="rtl" style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;direction:rtl;text-align:right;color:#2c2c2c"><table dir="rtl" align="center" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 16px"><tr><td align="center"><table dir="rtl" align="center" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%">
<tr><td dir="rtl" align="center" style="padding-bottom:18px"><span style="font-size:30px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span><p style="margin:6px 0 0;color:#666;font-size:15px;text-align:center">${reportTypeLabel}</p><p style="margin:6px 0 0;color:#999;font-size:13px;text-align:center">${dateStr}</p></td></tr>
<tr><td dir="rtl" style="background:#2c2c2c;border-radius:12px;padding:18px 22px;color:#fff;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 10px;font-size:16px;color:#c8a96e;direction:rtl;text-align:right">שורה תחתונה</h2>${heroStats}</td></tr><tr><td style="height:14px"></td></tr>
${sections}
${replyNote}
<tr><td dir="rtl" align="center" style="padding-top:14px;text-align:center"><p style="margin:0;color:#aaa;font-size:11px">${reportTypeLabel} v13 · ${autoFixes.length > 0 ? `🔧 ${autoFixes.filter(f=>f.succeeded).length}/${autoFixes.length} תיקונים אוטומטיים · ` : ''}<a href="https://www.dubis.net/admin" style="color:#c8a96e">פתח Admin</a></p></td></tr>
</table></td></tr></table></body></html>`;

  if (!summary_he) summary_he = `${reportTypeLabel} v13: ${(realOrders || []).length} הזמנות, $${totalRevenue.toFixed(0)}, ${opinions.length} ממצאים חדשים, ${autoFixes.filter(f=>f.succeeded).length} תיקונים אוטומטיים, ${isWeekly ? '' : `${routine.length} סעיפי שגרה קופלו, `}${totalMarketing} פרסומים.`;

  const reportDate = new Date().toISOString().slice(0, 10);

  // preview=1 → return the report + computed truth-metrics WITHOUT sending email
  // or writing boss_reports/agent_runs. Safe verification path for agents.
  // preview=1&html=1 → return the rendered HTML directly (so agents can grep the
  // actual report, e.g. confirm zero v_pub_url / real #product-N links). Auth-gated
  // (isAuthed already ran). Never sends email or writes DB.
  if (isPreview && url.searchParams.get('html') === '1') {
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (isPreview) {
    return json({
      ok: true, preview: true, mode, version: 'v13-letter',
      routine_lines: routine.length,
      moltbook: moltbook ? { posts: moltbook.posts.length, karma: moltbook.karma, neo: !!moltbook.neo } : null,
      agent_counts: agentCounts,
      failed_agents: failedAgents.map(f => ({ id: f.id, reason: f.reason, hours: Math.round(f.hours) })),
      real_orders: (realOrders || []).length, real_revenue: totalRevenue,
      internal_orders: internalOrders.length, internal_revenue: internalRevenue,
      net_profit: realMetrics?.netProfit ?? null, cogs: realMetrics?.cogs ?? null,
      cogs_coverage: realMetrics?.cogsCoverage ?? null,
      pageviews_7d: realMetrics?.pageViews7d ?? null,
      blocked_on_oren: (planStatus?.blocked_on_oren || []).map(b => ({ title: b.title, days_late: b.days_late })),
      plan_kpi_sync: planKpiSync,
      opinion_count: opinions.length,
      // Pass-2 verification fields (2026-06-15)
      new_products_week: newProductsWeek.map(p => ({ numeric: p.numeric, slogan: p.slogan, days_ago: p.days_ago })),
      email_digest: emailDigest ? { scanned: emailDigest.scanned, kept: emailDigest.kept, filtered: emailDigest.filtered, has_summary: !!emailDigest.digest, actions: emailDigest.actions.length } : null,
      // 🧭 Management board verification (2026-07-03)
      management: { ...mgmtDecide, board_recent: managementBoard?.recent.length ?? 0, board_pending: managementBoard?.pending ?? 0 },
      campaign_paused: campaignPaused, campaign_status_known: campaignStatusKnown,
      tiktok_placeholder_urls: (html.match(/v_pub_url/g) || []).length,
      html_bytes: html.length,
    });
  }

  let resendId: string | null = null; let resendError: string | null = null;
  let useKey = RESEND_KEY;
  const useEmails = (Deno.env.get('OWNER_EMAILS') || 'dubis.brand@gmail.com').split(',').map(s => s.trim()).filter(Boolean);
  if (!useKey) { try { const { data: vk } = await sb.rpc('dubis_get_vault_secret_safe', { secret_name: 'dubis_resend_api_key' }); if (vk) useKey = vk as string; } catch (_) {} }
  if (useKey) {
    try {
      const autoFixCount = autoFixes.filter(f => f.succeeded).length;
      // Subject carries only what's NON-ZERO — no noise counters (2026-07-12).
      const subjBits = [
        opinions.length ? `${opinions.length} חדש` : '',
        autoFixCount ? `${autoFixCount} תוקן` : '',
        totalPending ? `${totalPending} לאישור` : '',
      ].filter(Boolean).join(' · ');
      const subj = isWeekly
        ? `📅 DUBIS ישיבת הנהלה שבועית — ${dateStr}`
        : `📊 DUBIS דוח יומי${subjBits ? ' — ' + subjBits : ' — יום שקט'} · ${dateStr}`;
      // reply_to = the scanned inbox → oren can just hit Reply and the email
      // monitor turns his answer into a management-board directive (v13 loop).
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${useKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'DUBIS המנהל <orders@dubis.net>', to: useEmails, reply_to: 'dubis.brand@gmail.com', subject: subj, html }) });
      const data = await r.json();
      if (r.ok) resendId = data.id; else resendError = data.message || `HTTP ${r.status}`;
    } catch (e) { resendError = (e as Error).message; }
  } else { resendError = 'RESEND_API_KEY חסר'; }

  await sb.from('boss_reports').insert({
    report_date: reportDate,
    ok_count: agentCounts.ok_count, amber_count: agentCounts.amber_count,
    red_count: agentCounts.red_count, grey_count: agentCounts.grey_count,
    phantom_count: 0, frozen_count: 0,
    today_orders:(realOrders || []).length, today_revenue:totalRevenue, meta_alive:!!metaData.ok,
    resend_id:resendId, resend_error:resendError, full_html:html,
    assessment:{
      mode, version:'v13-letter', summary_he,
      // Yesterday-vs-today dedup source for "ממצאים חדשים" (2026-07-12).
      opinion_themes: allOpinions.map(o => `${o.theme}|${o.agent_he}`),
      agent_counts: agentCounts,
      failed_agents: failedAgents.map(f => ({ id: f.id, reason: f.reason, hours: Math.round(f.hours) })),
      real_revenue: totalRevenue, internal_revenue: internalRevenue,
      net_profit: realMetrics?.netProfit ?? null, cogs: realMetrics?.cogs ?? null,
      cogs_coverage: realMetrics?.cogsCoverage ?? null,
      pageviews_7d: realMetrics?.pageViews7d ?? null,
      action_items:action_items_json, opinion_count:opinions.length,
      recurring_count: recurring.length, recurring,
      auto_fix_count: autoFixes.filter(f=>f.succeeded).length, auto_fixes: autoFixes,
      pending_count:totalPending, marketing_total:totalMarketing,
      meta_error: metaData.ok ? null : String(metaData.fetch_error || 'unknown'),
      created_task_ids:createdTaskIds, last_week:lastWeekCheck,
      plan_status: planStatus,
      plan_kpi_sync: planKpiSync,
    },
  });
  await sb.from('agent_runs').insert({
    agent_id:'boss', run_date:reportDate, status:'completed',
    summary:`${isWeekly ? 'weekly' : 'daily'} v13: ${opinions.length} new, ${recurring.length} recurring, ${autoFixes.filter(f=>f.succeeded).length} auto-fixed, ${totalPending} pending, ${totalMarketing} marketing · agents ${agentCounts.ok_count}ok/${agentCounts.red_count}red`,
    tasks_created:createdTaskIds.length, tasks_completed_ids:[],
    side_effects:{ mode, resend_id:resendId, resend_error:resendError, version:'v13', opinion_count:opinions.length, recurring_count: recurring.length, auto_fix_count: autoFixes.filter(f=>f.succeeded).length, pending_count:totalPending, marketing_total:totalMarketing, created_task_ids:createdTaskIds, meta_error: metaData.fetch_error || null, plan_status: planStatus, agent_counts: agentCounts, net_profit: realMetrics?.netProfit ?? null, pageviews_7d: realMetrics?.pageViews7d ?? null },
  });

  // Best-effort: stash a plan_status snapshot into today's daily_snapshots.raw_data.
  // morning-report.js owns the main upsert; we patch raw_data only. If the column
  // doesn't exist or the row is missing we move on silently.
  if (planStatus) {
    try {
      const { data: existingSnap } = await sb.from('daily_snapshots')
        .select('snapshot_date, raw_data')
        .eq('snapshot_date', reportDate)
        .maybeSingle();
      const prev = (existingSnap?.raw_data as Record<string, unknown>) || {};
      await sb.from('daily_snapshots').upsert({
        snapshot_date: reportDate,
        raw_data: { ...prev, plan_status: planStatus, plan_status_at: new Date().toISOString() },
      }, { onConflict: 'snapshot_date' });
    } catch (e) { console.error('[boss] daily_snapshots.raw_data patch failed:', (e as Error).message); }
  }

  return json({
    ok:true, mode, version:'v13-letter', resend_id:resendId, resend_error:resendError,
    opinion_count:opinions.length, recurring_count: recurring.length,
    auto_fix_count: autoFixes.filter(f=>f.succeeded).length, auto_fixes: autoFixes,
    pending_count:totalPending, marketing_total:totalMarketing,
    meta_ok: !!metaData.ok, meta_error: metaData.fetch_error || null,
    agent_counts: agentCounts, net_profit: realMetrics?.netProfit ?? null,
    real_revenue: totalRevenue, pageviews_7d: realMetrics?.pageViews7d ?? null,
    summary_he,
  });
});
