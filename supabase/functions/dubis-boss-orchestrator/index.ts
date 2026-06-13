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
async function opinionMarketing(meta: Record<string, unknown>, realOrders: unknown[]): Promise<Opinion | null> {
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
  if (notPosted <= 3) return null;
  return { agent:'product', agent_he:'מנהל המוצרים', observation:`${total} מוצרים פעילים, ${productIdsPosted.size} קיבלו פוסט השבוע, ${notPosted} לא.`, recommendation:'לתקן rotation ב-auto-content', priority: notPosted > 8 ? 'P1' : 'P2', theme:'catalog-coverage' };
}
async function opinionSupply(sb: SB, ticketsOpened: number): Promise<Opinion | null> {
  const { data: openOrders } = await sb.from('orders').select('id, status, created_at, gelato_ticket_opened_at').in('status', ['pending', 'in_production', 'shipped']);
  const oldestPending = (openOrders || []).filter(o => o.status === 'pending' && !o.gelato_ticket_opened_at).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
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
  if (ic > 0) return { agent:'security', agent_he:'בודק האבטחה', observation:`${ic} הצעות תיקון.`, recommendation:'לפתוח agent_tasks WHERE agent_id=security', priority:'P1', theme:'security-findings' };
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
      const processed = n('processed') || n('found') || n('messages');
      return processed > 0 ? `סרק מיילים — ${processed} חדשים` : 'סרק מיילים — אין חדשים';
    }
    case 'security': {
      const issues = n('issues_count') || n('issues');
      return issues > 0 ? `סקירת אבטחה — ${issues} ממצאים` : 'סקירת אבטחה — נקי ✅';
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
    color = cur > 0 ? 'green' : 'red';
  }
  const icon = color === 'green' ? '🟢' : color === 'yellow' ? '🟡' : '🔴';
  return { color, icon };
}

async function syncPlanKpisFromSnapshot(sb: SB): Promise<{ updated: number; errors: string[] }> {
  const out = { updated: 0, errors: [] as string[] };
  try {
    const { data: snap } = await sb.from('daily_snapshots')
      .select('snapshot_date, page_views_today, subscribers_total, orders_today, revenue_usd, campaigns_spend_total')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) { out.errors.push('no daily snapshot'); return out; }
    const s = snap as Record<string, unknown>;
    const pageViewsWeekly = Math.round(num(s.page_views_today) * 7);
    const subs = Math.round(num(s.subscribers_total));
    const ordersWeekly = Math.round(num(s.orders_today));
    const adSpend = num(s.campaigns_spend_total);
    const profit = Math.round(num(s.revenue_usd) - adSpend);
    const profitStr = profit >= 0 ? `$${profit}` : `-$${Math.abs(profit)}`;

    const { data: kpiRows } = await sb.from('plan_milestones')
      .select('id, title')
      .eq('plan_id', PLAN_ID)
      .eq('is_kpi', true);
    for (const r of (kpiRows || [])) {
      const row = r as Record<string, unknown>;
      const title = String(row.title || '').toLowerCase();
      let newVal: string | null = null;
      if (/pageview|page view|visit|כניס|תנוע/i.test(title)) newVal = String(pageViewsWeekly);
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
      ⏰ נותרו <b style="color:${daysColor}">${p.days_to_w7} ימים</b> ליעד שבוע 7 (15 ביוני)
      <span style="color:#ccc"> · </span>
      פאזה נוכחית: <b style="color:#c8a96e">${p.current_phase}${phaseLabel ? ' — ' + esc(phaseLabel) : ''}</b>
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
    return vid ? `https://www.tiktok.com/@${user}/video/${vid}` : null;
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

// Best published-post link from a content_data blob (POST itself, never the product page).
function bestPostLink(cd: Record<string, unknown>): { url: string; channel: string } | null {
  if (cd.ig_permalink) return { url: String(cd.ig_permalink), channel: 'IG' };
  if (cd.fb_permalink) return { url: String(cd.fb_permalink), channel: 'FB' };
  const tk = cd.tiktok_url ? String(cd.tiktok_url) : '';
  if (tk.startsWith('http')) return { url: tk, channel: 'TikTok' };
  return null;
}
const FMT_ICON: Record<string, string> = { feed_post: '🖼️', carousel: '🎠', reel: '🎬', tiktok: '🎵', story: '📖', unknown: '•' };

// Weekly plan as a 7-day calendar: each day → planned + published items with the POST link.
async function fetchWeeklyMarketing(sb: SB): Promise<{
  plan: Record<string, unknown>; weekStart: string; total: number; done: number; pending: number; backlog: number;
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
    sb.from('agent_tasks').select('status, content_data, updated_at').eq('agent_id', 'content').gte('created_at', sinceIso).limit(300),
    sb.from('agent_tasks').select('status, content_data, updated_at').eq('agent_id', 'tiktok').eq('status', 'done').gte('updated_at', sinceIso).lt('updated_at', untilIso).limit(60),
  ]);
  const DOW_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  type Day = { date: string; label: string; items: Array<{ fmt: string; lang: string; status: string; slogan: string; platform: string; link: { url: string; channel: string } | null}> };
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startMs + i * 86400000); const date = d.toISOString().slice(0, 10);
    return { date, label: `${DOW_HE[d.getUTCDay()]} ${date.slice(5)}`, items: [] };
  });
  const byDate: Record<string, Day> = {}; for (const d of days) byDate[d.date] = d;
  let done = 0, pending = 0, backlog = 0;
  for (const t of (contentTasks || []) as Array<Record<string, unknown>>) {
    const cd = (t.content_data as Record<string, unknown>) || {};
    const st = String(t.status || '');
    if (st === 'done') done++; else if (st === 'backlog') backlog++; else pending++;
    const sched = String(cd.scheduled_for || '').slice(0, 10);
    const day = byDate[sched] || (st === 'done' ? byDate[String(t.updated_at || '').slice(0, 10)] : null);
    if (!day) continue;
    day.items.push({ fmt: String(cd.format || 'feed_post'), lang: String(cd.lang || cd.language || ''), status: st, slogan: String(cd.product_slogan || cd.slogan || cd.caption_he || cd.caption_en || '').slice(0, 46), platform: String(cd.platform || cd.channel || ''), link: bestPostLink(cd) });
  }
  for (const t of (ttTasks || []) as Array<Record<string, unknown>>) {
    const cd = (t.content_data as Record<string, unknown>) || {};
    const day = byDate[String(t.updated_at || '').slice(0, 10)];
    if (!day) continue;
    done++;
    day.items.push({ fmt: 'tiktok', lang: String(cd.lang || ''), status: 'done', slogan: String(cd.product_slogan || cd.slogan || '').slice(0, 46), platform: 'tiktok', link: bestPostLink(cd) });
  }
  for (const d of days) d.items.sort((a, b) => (a.status === 'done' ? -1 : 1) - (b.status === 'done' ? -1 : 1));
  const total = (plan.total_slots as number) || (done + pending + backlog);
  return { plan, weekStart, total, done, pending, backlog, days };
}

function buildWeeklyMarketingHtml(wm: Awaited<ReturnType<typeof fetchWeeklyMarketing>>): string {
  if (!wm) return '<p dir="rtl" style="font-size:13px;color:#888;text-align:right">אין תוכנית שבועית פעילה — נוצרת אוטומטית כל יום ראשון 04:00 UTC.</p>';
  const pct = wm.total > 0 ? Math.round(wm.done / wm.total * 100) : 0;
  const heSlots = (wm.plan.he_slots as number) ?? '?'; const enSlots = (wm.plan.en_slots as number) ?? '?';
  const badge = (st: string) => st === 'done' ? '<span style="color:#2e7d32">✅</span>' : st === 'backlog' ? '<span style="color:#bbb">⚪</span>' : '<span style="color:#c8a96e">🟡</span>';
  // Target social network(s) per item — derived from content_data.platform/channel (else from format).
  const netBadges = (platform: string, fmt: string): string => {
    const p = (platform || '').toLowerCase();
    const out: string[] = [];
    if (fmt === 'tiktok' || p.includes('tiktok')) out.push('🎵TikTok');
    if (p.includes('instagram') || p.includes('ig')) out.push('📷IG');
    if (p.includes('facebook') || p.includes('fb')) out.push('📘FB');
    if (!out.length) out.push(fmt === 'tiktok' ? '🎵TikTok' : '📷IG 📘FB');
    return `<span style="background:#f3eee2;border-radius:4px;padding:1px 5px;color:#7a6a4f;font-size:10px;font-weight:600">${out.join(' ')}</span>`;
  };
  const dayRows = wm.days.map(d => {
    const items = d.items.length
      ? d.items.map(it => {
          const icon = FMT_ICON[it.fmt] || '•';
          const flag = it.lang === 'he' ? '🇮🇱' : it.lang === 'en' ? '🇺🇸' : '';
          const link = it.link
            ? ` <a href="${esc(it.link.url)}" style="color:#c8a96e;font-weight:600;text-decoration:none">▶ ${esc(it.link.channel)}</a>`
            : (it.status === 'done' ? ' <span style="color:#bbb;font-size:10px">פורסם — קישור בקרוב</span>' : '');
          return `<div dir="rtl" style="font-size:11.5px;margin:3px 0;text-align:right">${badge(it.status)} ${icon} ${netBadges(it.platform, it.fmt)} ${flag} ${esc(it.slogan)}${link}</div>`;
        }).join('')
      : '<div style="font-size:11px;color:#ccc">—</div>';
    return `<tr><td valign="top" style="padding:6px 8px;border-bottom:1px solid #f0ece0;white-space:nowrap;font-weight:700;font-size:12px;color:#2c2c2c">${esc(d.label)}</td><td valign="top" style="padding:6px 8px;border-bottom:1px solid #f0ece0">${items}</td></tr>`;
  }).join('');
  return `<p dir="rtl" style="font-size:13px;margin:0 0 4px;text-align:right"><b>שבוע ${esc(wm.weekStart)}</b> · ${esc(String(wm.plan.status || ''))} · ${heSlots} HE / ${enSlots} EN</p>
  <p dir="rtl" style="font-size:14px;margin:0;text-align:right"><b>${wm.done}/${wm.total} פורסמו (${pct}%)</b> · ${wm.pending} בתהליך · ${wm.backlog} בהמתנה</p>
  <div style="background:#eee;border-radius:8px;height:12px;overflow:hidden;margin:6px 0"><div style="background:#c8a96e;height:12px;width:${pct}%"></div></div>
  <table dir="rtl" width="100%" style="border-collapse:collapse;margin-top:8px"><tr><th align="right" style="font-size:11px;color:#888;padding:4px 8px;text-align:right">יום</th><th align="right" style="font-size:11px;color:#888;padding:4px 8px;text-align:right">מתוכנן/פורסם · קישור לפוסט</th></tr>${dayRows}</table>
  <p dir="rtl" style="font-size:10px;color:#aaa;margin:6px 0 0;text-align:right">התג הצבעוני = הרשת שאליה התוכן מיועד (📷IG / 📘FB / 🎵TikTok). ▶ = קישור לפוסט עצמו ברשת, לא לעמוד המוצר.</p>`;
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
async function fetchAutoProductHealth(sb: SB): Promise<{
  latest: { numeric: number; slogan: string; status: string; active: boolean } | null;
  retries7d: number;
  failures: Array<{ numeric: number; summary: string; run_id: string | null }>;
  queueFailed: number;
} | null> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
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

  const { data: runs } = await sb.from('agent_runs')
    .select('summary, side_effects, created_at')
    .eq('agent_id', 'product')
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(40);
  let retries7d = 0;
  const failures: Array<{ numeric: number; summary: string; run_id: string | null }> = [];
  for (const r of (runs || []) as Array<Record<string, unknown>>) {
    const se = (r.side_effects as Record<string, unknown>) || {};
    if (se.auto_product_retry === true) retries7d++;
    if (se.auto_product_failed === true) {
      failures.push({ numeric: Number(se.product_id_numeric || 0), summary: String(r.summary || '').slice(0, 100), run_id: (se.workflow_run_id as string) || null });
    }
  }

  const { data: q } = await sb.from('product_pipeline_queue')
    .select('status').eq('status', 'failed').gte('updated_at', since);
  return { latest, retries7d, failures, queueFailed: (q || []).length };
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
  const stats = `<p dir="rtl" style="font-size:12.5px;margin:0 0 6px;text-align:right">🔁 ${h.retries7d} ריצות-תיקון אוטומטיות (self-heal) · ❌ ${h.failures.length} כשלים סופיים (7 ימים)</p>`;
  let alert = '';
  if (h.failures.length || h.queueFailed) {
    const list = h.failures.map(f => `<li>#${f.numeric || '?'} — ${esc(f.summary)}${f.run_id ? ` · <a href="https://github.com/dubis-brand/dubis-website/actions/runs/${f.run_id}" style="color:#c8a96e">לוג</a>` : ''}</li>`).join('');
    alert = `<div dir="rtl" style="background:#fdecea;border-right:3px solid #b91c1c;padding:8px 12px;border-radius:6px;margin-top:6px;text-align:right"><b style="color:#b91c1c">דורש בדיקה ידנית — נכשל גם אחרי retry:</b><ul style="margin:6px 0;padding-right:18px;font-size:12px">${list || `<li>${h.queueFailed} שורות תור במצב failed</li>`}</ul></div>`;
  } else {
    alert = '<p dir="rtl" style="font-size:12px;color:#2d6a4f;text-align:right">✅ הצינור תקין — self-heal פעיל, אין כשלים פתוחים.</p>';
  }
  return latestHtml + stats + alert;
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
    return {
      caption: String(cd.caption || cd.product_slogan || cd.slogan || '').slice(0, 240),
      url: (cd.tiktok_url as string) || null,
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
const HIGHLIGHTED_ORDERS: Array<{ name_he: string; email?: string; gelato_prefix?: string }> = [
  { name_he: 'הילה טהרלב', email: 'hilateharlev@gmail.com', gelato_prefix: '0cf6a5f1' },
];

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

async function fetchActiveOrdersTracking(sb: SB): Promise<{
  total: number;
  highlighted: TrackedOrderRow[];
  rows: TrackedOrderRow[]; // last-30-day rows excluding highlighted
}> {
  // 30-day window for normal tracking (was 90d, oren 2026-05-23: cluttered).
  const since = new Date(Date.now() - 30*86400000).toISOString();
  const { data: orders } = await sb.from('orders')
    .select('id, buyer_email, created_at, updated_at, status, total_amount, tracking_number, tracking_url, printful_order_id, gelato_ticket_id, shipped_at')
    .eq('is_test', false)
    .not('status', 'in', '(cancelled,refunded)')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  const windowRows = (orders || []).map(o => mapOrderRow(o as Record<string, unknown>));

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
  return { total: rows.length + highlightedRows.length, highlighted: highlightedRows, rows };
}

// =============================================================
async function fetchPendingApprovals(sb: SB): Promise<{
  products: Array<{ id: string; title: string; slogan: string | null; age_days: number; pid: string | null }>;
  pipelineFailed: Array<{ id: string; pid: number | null; error: string; age_days: number }>;
  pipelineDispatched: Array<{ id: string; pid: number | null; age_hours: number }>;
  candidates: Array<{ id: string; uid: string; brand: string; score: number; age_days: number }>;
  slogans: number;
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
  const { count: slogans } = await sb.from('slogan_candidates').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  return { products, pipelineFailed, pipelineDispatched, candidates, slogans: slogans || 0 };
}

// =============================================================
// A.4 — SVG sparkline (orders bars + revenue line)
// =============================================================
function buildSparkline(snaps: Array<{ snapshot_date: string; revenue_usd: number; orders_today: number }>): string {
  if (snaps.length < 2) return '<p dir="rtl" style="color:#888;font-size:13px;margin:0">צריך לפחות 2 ימים של daily_snapshots לגרף.</p>';
  const W = 640, H = 140, padL = 38, padR = 38, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxRev = Math.max(20, ...snaps.map(s => s.revenue_usd));
  const maxOrd = Math.max(1, ...snaps.map(s => s.orders_today));
  const xAt = (i: number) => padL + (snaps.length === 1 ? innerW/2 : (i/(snaps.length-1)) * innerW);
  const yRev = (v: number) => padT + innerH - (v / maxRev) * innerH;
  const revPath = snaps.map((s, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yRev(s.revenue_usd).toFixed(1)}`).join(' ');
  // Orders bars (lighter, behind line)
  const barW = Math.max(4, Math.floor(innerW / snaps.length) - 2);
  const bars = snaps.map((s, i) => {
    const x = xAt(i) - barW/2;
    const barH = (s.orders_today / maxOrd) * innerH;
    const y = padT + innerH - barH;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" fill="#3498db" opacity="0.18" rx="2"/>`;
  }).join('');
  // X-axis date labels — only every nth so we don't overlap
  const step = snaps.length > 7 ? 2 : 1;
  const xLabels = snaps.map((s, i) => i % step === 0 || i === snaps.length-1 ? `<text x="${xAt(i).toFixed(1)}" y="${H-8}" font-size="9" fill="#999" text-anchor="middle" font-family="Arial">${s.snapshot_date.slice(5)}</text>` : '').join('');
  // Revenue points
  const revPoints = snaps.map((s, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yRev(s.revenue_usd).toFixed(1)}" r="3" fill="#c8a96e"/>`).join('');
  // Y-axis labels (revenue)
  const yLabels = [0, 0.5, 1].map(t => {
    const v = maxRev * t;
    const y = padT + innerH * (1 - t);
    return `<text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="9" fill="#999" text-anchor="end" font-family="Arial">$${v.toFixed(0)}</text>`;
  }).join('');
  const yLabelsRight = [0, maxOrd].map(v => {
    const y = padT + innerH * (1 - v/maxOrd);
    return `<text x="${W-padR+6}" y="${(y+3).toFixed(1)}" font-size="9" fill="#3498db" text-anchor="start" font-family="Arial">${v}</text>`;
  }).join('');
  const lastRev = snaps[snaps.length-1].revenue_usd;
  const lastOrd = snaps[snaps.length-1].orders_today;
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:#fafafa;border-radius:6px;display:block;max-width:${W}px">
    ${bars}
    <path d="${revPath}" fill="none" stroke="#c8a96e" stroke-width="2"/>
    ${revPoints}
    ${yLabels}${yLabelsRight}${xLabels}
    <text x="${padL}" y="${H-3}" font-size="10" fill="#c8a96e" font-family="Arial" font-weight="700">● הכנסה</text>
    <text x="${padL+90}" y="${H-3}" font-size="10" fill="#3498db" font-family="Arial" font-weight="700">▮ הזמנות</text>
    <text x="${W-padR}" y="${padT+10}" font-size="11" fill="#333" font-family="Arial" font-weight="700" text-anchor="end">היום: $${lastRev.toFixed(0)} · ${lastOrd} הזמנות</text>
  </svg>`;
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
          const r = await fetch(`https://graph.facebook.com/v19.0/${META_CAMPAIGN}/insights?fields=spend,impressions,clicks,cpc,ctr,reach,actions&date_preset=${w}&access_token=${IG_TOKEN}`);
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
  const { data: realOrders } = await sb.from('orders').select('id, total_amount, status, created_at, is_test').eq('is_test', false).neq('status', 'cancelled').gte('created_at', sinceWindow);
  const totalRevenue = (realOrders || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jerusalem' });
  const cur = (metaData.currency as string) || 'ILS';
  const sym = cur === 'ILS' ? '₪' : '$';

  // ---- B.7 + B.9 + B.11 + B.12: Self-healing — runs BEFORE opinions so they reflect fixes ----
  const gelatoStockHeal = await tryAutoHealGelatoStock(sb);
  const ticketing = await autoTicketStuckOrders(sb);
  const oosHide = await tryAutoHideFullyOosProducts(sb);          // B.11
  const pipelineRetry = await tryAutoRetryFailedPipeline(sb);     // B.12
  const autoFixes: AutoFix[] = [];
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
    opinionMarketing(metaData, realOrders || []),
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
  const opinions = nonRecurring;
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
  const planKpiSync = await syncPlanKpisFromSnapshot(sb).catch(() => ({ updated: 0, errors: ['sync-threw'] }));
  // Resolve real TikTok post URLs (Late.com finalizes async) so marketing links point at the live post.
  await backfillTiktokUrls(sb).catch(() => {});
  const [marketingToday, pending, agentHealth, dailySnaps, orderTracking, planStatus, weeklyMktg, autoProductHealth] = await Promise.all([
    fetchMarketingToday(sb),
    fetchPendingApprovals(sb),
    fetchAgentHealth(sb),
    fetchDailySnapshots(sb),
    fetchActiveOrdersTracking(sb),
    fetchPlanStatus(sb).catch(() => null),
    fetchWeeklyMarketing(sb).catch(() => null),
    fetchAutoProductHealth(sb).catch(() => null),
  ]);

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
  const heroStats = `<table dir="rtl" width="100%"><tr>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">${(realOrders || []).length}</div><div style="font-size:11px;color:#aaa">הזמנות ${isWeekly?'7ימ':'24h'}</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">$${totalRevenue.toFixed(0)}</div><div style="font-size:11px;color:#aaa">הכנסה ${isWeekly?'7ימ':'24h'}</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">${igPosts7d}</div><div style="font-size:11px;color:#aaa">פוסטים 7ימ</div></td>
    <td dir="rtl" align="center" style="width:25%;padding:8px;text-align:center"><div style="color:#c8a96e;font-size:22px;font-weight:700">${sym}${spendDisplay.toFixed(0)}</div><div style="font-size:11px;color:#aaa">Meta ${isWeekly?'7ימ':'אתמול'}</div></td>
  </tr></table>`;

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
    if (!metaData.ok) {
      const err = String(metaData.fetch_error || 'unknown');
      return `<div dir="rtl" style="padding:12px;background:#fff5f5;border-right:4px solid #c0392b;border-radius:4px;color:#c0392b;font-size:13px">❌ Meta API נכשל: <code style="font-size:11px;direction:ltr;display:inline-block">${esc(err)}</code><br><span style="color:#666;font-size:11px;margin-top:4px;display:block">לבדוק INSTAGRAM_ACCESS_TOKEN ב-Vercel envs ו-app permissions ב-developers.facebook.com</span></div>`;
    }
    if (impY === 0 && clicksY === 0) return '<p dir="rtl" style="color:#888;font-size:13px;margin:0">קמפיין פעיל אבל אין impressions ב-24 שעות אחרונות. (delivery delay או pause חלקי)</p>';
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

  // ✍️ Pending approvals (unchanged from v9)
  const totalPending = pending.products.length + pending.pipelineFailed.length + pending.pipelineDispatched.length + pending.candidates.length + pending.slogans;
  const pendingHtml = totalPending === 0
    ? '<p dir="rtl" style="color:#27ae60;font-size:13px;margin:0">✅ אין שום מוצר מחכה לאישור</p>'
    : [
      pending.products.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#e67e22;font-size:13px">✍️ סלוגנים לאישור (${pending.products.length})</b>${pending.products.slice(0, 6).map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">${esc(p.title)} <span style="color:${p.age_days > 7 ? '#c0392b' : '#888'};font-size:11px">· ${p.age_days} ימים</span></div>`).join('')}</div>`,
      pending.pipelineFailed.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#c0392b;font-size:13px">🔴 מוצרים שממתינים לטיפול ידני (${pending.pipelineFailed.length})</b><div dir="rtl" style="color:#888;font-size:10.5px;margin:2px 0 4px">כבר ניסינו אוטומטית פעם אחת — עדיין נכשל.</div>${pending.pipelineFailed.slice(0, 4).map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">מוצר #${p.pid || '?'} · <span style="color:#888">${esc(p.error).slice(0, 80)}</span> · ${p.age_days} ימים</div>`).join('')}</div>`,
      pending.pipelineDispatched.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#e67e22;font-size:13px">⏳ צינור מוצר תקוע (${pending.pipelineDispatched.length})</b>${pending.pipelineDispatched.map(p => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">מוצר #${p.pid || '?'} · ממתין כבר ${p.age_hours} שעות</div>`).join('')}</div>`,
      pending.candidates.length === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right"><b style="color:#3498db;font-size:13px">📊 מומלצות מ-Gelato Discovery (${pending.candidates.length})</b>${pending.candidates.map(c => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">${esc(c.brand)} · score ${c.score.toFixed(1)} · <code style="font-size:10px;color:#888">${esc(c.uid)}</code></div>`).join('')}</div>`,
      pending.slogans === 0 ? '' : `<div dir="rtl" style="margin:8px 0;direction:rtl;text-align:right;font-size:12px;color:#666">📝 ${pending.slogans} סלוגנים מומלצים מחכים בתור (slogan_candidates)</div>`,
    ].filter(Boolean).join('');

  // Orders — new in window (last 24h or 7d)
  const todaysOrders = (realOrders || []).slice(0, 5);
  const ordersHtml = (realOrders || []).length === 0
    ? '<p dir="rtl" style="color:#888;font-size:13px;margin:0">אין הזמנות בחלון</p>'
    : todaysOrders.map(o => `<div dir="rtl" style="padding:6px 10px;background:#fafafa;margin:3px 0;border-radius:4px;text-align:right;font-size:12px">📦 <code>${esc(String(o.id).slice(0, 8))}</code> · $${num(o.total_amount).toFixed(0)} · ${esc(o.status)}</div>`).join('');

  // B.10 — Per-order daily tracking (every active real order, last 90d)
  const STATUS_HE: Record<string, string> = {
    'pending': '⏳ ממתין ל-Gelato',
    'in_production': '🛠️ בייצור',
    'shipped': '📦 נשלח',
    'delivered': '✅ נמסר',
    'unknown': '❓ לא ידוע',
  };
  const STATUS_COLOR: Record<string, string> = {
    'pending': '#e67e22', 'in_production': '#3498db', 'shipped': '#9b59b6',
    'delivered': '#27ae60', 'unknown': '#999',
  };
  const renderOrderRow = (r: TrackedOrderRow, highlighted: boolean) => {
    const statusLabel = STATUS_HE[r.status] || r.status;
    const statusColor = STATUS_COLOR[r.status] || '#999';
    const buyerShort = r.highlight_name || (r.buyer_email.length > 28 ? r.buyer_email.slice(0, 28) + '…' : r.buyer_email);
    const recentBadge = r.changed_in_24h ? '<span style="background:#27ae60;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">⚡ עודכן 24h</span>' : '';
    const handledBadge = r.handled_offline ? '<span style="background:#888;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">🤝 טופל ידנית</span>' : '';
    const highlightBadge = highlighted ? '<span style="background:#c8a96e;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px;margin-right:4px">⭐ מעקב אישי</span>' : '';
    const stalenessColor = r.handled_offline ? '#888' : (r.days_in_status > 14 ? '#c0392b' : r.days_in_status > 7 ? '#e67e22' : '#666');
    const trackingLink = r.tracking_url
      ? ` · <a href="${esc(r.tracking_url)}" style="color:#9b59b6;text-decoration:none;font-weight:600">📦 מעקב משלוח →</a>`
      : (r.tracking_number ? ` · <code style="font-size:10px">${esc(r.tracking_number)}</code>` : '');
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
         📅 ${esc(r.created_at.slice(0,10))} (${r.age_days}י)
         <span style="color:#999"> · </span>
         <span style="color:${stalenessColor}">בסטטוס ${r.days_in_status}י</span>
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
  const trackingHtml = orderTracking.total === 0
    ? '<p dir="rtl" style="color:#888;font-size:13px;margin:0">אין הזמנות פעילות ב-30 ימים אחרונים.</p>'
    : `<p dir="rtl" style="color:#666;font-size:11px;margin:0 0 10px">${orderTracking.total} הזמנות פעילות ב-30 ימים אחרונים (לא cancelled/refunded). ${[...orderTracking.highlighted, ...orderTracking.rows].filter(r => r.changed_in_24h).length} שינו סטטוס ב-24 שעות אחרונות.</p>` +
       highlightedHtml +
       orderTracking.rows.map(r => renderOrderRow(r, false)).join('');

  // A.3 — Rich agent status table: name | when | what it did | error
  const allAgentIds = ['boss','content','marketing','product','supply','design','site_audit','email_monitor','gelato_stock','cto','security','video','planner','tiktok'];
  const agentHealthHtml = `<table dir="rtl" width="100%" style="border-collapse:collapse;font-size:12px">
    <tr style="background:#f0ebe0">
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700;width:130px">סוכן</th>
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700;width:70px">אחרון</th>
      <th dir="rtl" style="padding:6px 8px;text-align:right;font-size:11px;color:#666;font-weight:700">מה עשה</th>
    </tr>
    ${allAgentIds.map(id => {
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
      }
      return `<tr style="border-bottom:1px solid #f0ebe0">
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top">${icon} <b>${esc(he)}</b></td>
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top;color:${color};font-size:11px">${esc(when)}</td>
        <td dir="rtl" style="padding:6px 8px;direction:rtl;text-align:right;vertical-align:top;color:#333;font-size:11.5px;line-height:1.5">${actionText}</td>
      </tr>`;
    }).join('')}
  </table>`;

  // A.4 — SVG sparkline
  const trendHtml = buildSparkline(dailySnaps);

  // 📊 $1,000 Plan section — silently omitted if fetch failed or no data.
  const planSectionHtml = planStatus ? buildPlanSectionHtml(planStatus) : '';
  const weeklyMktgHtml = buildWeeklyMarketingHtml(weeklyMktg);
  const personaHtml = buildPersonaSeriesHtml(await fetchPersonaSeries(sb).catch(() => null));
  const autoProductHealthHtml = buildAutoProductHealthHtml(autoProductHealth);

  const lastWeekSection = isWeekly && lastWeekCheck.total > 0
    ? `<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📊 מהשבוע הקודם</h2><p dir="rtl" style="font-size:13px;margin:0 0 10px"><b>${lastWeekCheck.done}/${lastWeekCheck.total} הושלמו (${Math.round(lastWeekCheck.done/lastWeekCheck.total*100)}%).</b></p>${lastWeekCheck.details.slice(0,5).map(d => { const ic = d.status === 'done' ? '✅' : d.status === 'open' ? '⏳' : '❌'; return `<div dir="rtl" style="padding:8px 12px;background:#fafafa;margin:4px 0;border-radius:4px;text-align:right;font-size:12px">${ic} <b>${esc(d.agent)}:</b> ${esc(d.rec.slice(0,100))}</div>`; }).join('')}</td></tr><tr><td style="height:14px"></td></tr>` : '';

  const reportTypeLabel = isWeekly ? 'פגישה צוות שבועית' : 'דוח יומי';

  const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="color-scheme" content="light"></head><body dir="rtl" style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;direction:rtl;text-align:right;color:#2c2c2c"><table dir="rtl" align="center" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 16px"><tr><td align="center"><table dir="rtl" align="center" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%">
<tr><td dir="rtl" align="center" style="padding-bottom:18px"><span style="font-size:30px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span><p style="margin:6px 0 0;color:#666;font-size:15px;text-align:center">${reportTypeLabel}</p><p style="margin:6px 0 0;color:#999;font-size:13px;text-align:center">${dateStr}</p></td></tr>
<tr><td dir="rtl" style="background:#2c2c2c;border-radius:12px;padding:18px 22px;color:#fff;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 10px;font-size:16px;color:#c8a96e;direction:rtl;text-align:right">שורה תחתונה</h2>${heroStats}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📈 הכנסות 14 הימים האחרונים</h2>${trendHtml}</td></tr><tr><td style="height:14px"></td></tr>
${autoFixHtml}
${recurringHtml}
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🚨 ממצאים חדשים (${opinions.length})</h2>${issuesHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">✍️ מחכה לאישורך (${totalPending})</h2>${pendingHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📅 תוכנית שיווק שבועית — תכנון מול ביצוע</h2>${weeklyMktgHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🐻 סדרת הסוכנים — מאחורי הקוד</h2>${personaHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🤖 קו המוצרים האוטומטי</h2>${autoProductHealthHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📣 שיווק היום (${totalMarketing})</h2>${marketingStatsHtml}${marketingItemsHtml}</td></tr><tr><td style="height:14px"></td></tr>
${lastWeekSection}
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📊 Meta Funnel — אתמול</h2>${funnelHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🎯 ${isWeekly?'5':'3'} פעולות מומלצות</h2>${actionsHtml}<div dir="rtl" style="background:#2c2c2c;color:#fff;padding:12px 16px;margin-top:14px;border-radius:6px;direction:rtl;text-align:right"><h3 dir="rtl" style="margin:0 0 6px;color:#c8a96e;font-size:13px">דעת המנהל</h3><p dir="rtl" style="margin:0;font-size:12.5px;line-height:1.7">${esc(synth.managerView)}</p></div></td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🛒 הזמנות חדשות ב-${isWeekly?'7 ימים':'24 שעות'} (${(realOrders || []).length})</h2>${ordersHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">📋 מעקב הזמנות פעילות (${orderTracking.total})</h2>${trackingHtml}</td></tr><tr><td style="height:14px"></td></tr>
${planSectionHtml}
<tr><td dir="rtl" style="background:#fff;border-radius:12px;padding:20px 22px;direction:rtl;text-align:right"><h2 dir="rtl" style="margin:0 0 12px;font-size:17px;direction:rtl;text-align:right">🤖 מצב הסוכנים (24 שעות)</h2>${agentHealthHtml}</td></tr><tr><td style="height:14px"></td></tr>
<tr><td dir="rtl" align="center" style="padding-top:18px;text-align:center"><p style="margin:0;color:#aaa;font-size:11px">${reportTypeLabel} v10 · ${autoFixes.length > 0 ? `🔧 ${autoFixes.filter(f=>f.succeeded).length}/${autoFixes.length} תיקונים אוטומטיים · ` : ''}<a href="https://www.dubis.net/admin" style="color:#c8a96e">פתח Admin</a></p></td></tr>
</table></td></tr></table></body></html>`;

  if (!summary_he) summary_he = `${reportTypeLabel} v10: ${(realOrders || []).length} הזמנות, $${totalRevenue.toFixed(0)}, ${opinions.length} תצפיות חדשות, ${recurring.length} חוזרות, ${autoFixes.filter(f=>f.succeeded).length} תיקונים אוטומטיים, ${totalPending} לאישור, ${totalMarketing} פעילויות שיווק.`;

  const reportDate = new Date().toISOString().slice(0, 10);
  let resendId: string | null = null; let resendError: string | null = null;
  let useKey = RESEND_KEY;
  const useEmails = (Deno.env.get('OWNER_EMAILS') || 'dubis.brand@gmail.com').split(',').map(s => s.trim()).filter(Boolean);
  if (!useKey) { try { const { data: vk } = await sb.rpc('dubis_get_vault_secret_safe', { secret_name: 'dubis_resend_api_key' }); if (vk) useKey = vk as string; } catch (_) {} }
  if (useKey) {
    try {
      const autoFixCount = autoFixes.filter(f => f.succeeded).length;
      const subj = isWeekly
        ? `📅 DUBIS פגישה שבועית — ${dateStr}`
        : `📊 DUBIS דוח יומי — ${opinions.length} חדש · ${recurring.length} חוזר · ${autoFixCount} תוקן · ${totalPending} לאישור · ${dateStr}`;
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${useKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'DUBIS המנהל <orders@dubis.net>', to: useEmails, subject: subj, html }) });
      const data = await r.json();
      if (r.ok) resendId = data.id; else resendError = data.message || `HTTP ${r.status}`;
    } catch (e) { resendError = (e as Error).message; }
  } else { resendError = 'RESEND_API_KEY חסר'; }

  await sb.from('boss_reports').insert({
    report_date: reportDate, ok_count:0, amber_count:0, red_count:0, grey_count:0, phantom_count:0, frozen_count:0,
    today_orders:(realOrders || []).length, today_revenue:totalRevenue, meta_alive:!!metaData.ok,
    resend_id:resendId, resend_error:resendError, full_html:html,
    assessment:{
      mode, version:'v10-self-healing', summary_he,
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
    summary:`${isWeekly ? 'weekly' : 'daily'} v10: ${opinions.length} new, ${recurring.length} recurring, ${autoFixes.filter(f=>f.succeeded).length} auto-fixed, ${totalPending} pending, ${totalMarketing} marketing`,
    tasks_created:createdTaskIds.length, tasks_completed_ids:[],
    side_effects:{ mode, resend_id:resendId, resend_error:resendError, version:'v10', opinion_count:opinions.length, recurring_count: recurring.length, auto_fix_count: autoFixes.filter(f=>f.succeeded).length, pending_count:totalPending, marketing_total:totalMarketing, created_task_ids:createdTaskIds, meta_error: metaData.fetch_error || null, plan_status: planStatus },
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
    ok:true, mode, version:'v10-self-healing', resend_id:resendId, resend_error:resendError,
    opinion_count:opinions.length, recurring_count: recurring.length,
    auto_fix_count: autoFixes.filter(f=>f.succeeded).length, auto_fixes: autoFixes,
    pending_count:totalPending, marketing_total:totalMarketing,
    meta_ok: !!metaData.ok, meta_error: metaData.fetch_error || null,
    summary_he,
  });
});
