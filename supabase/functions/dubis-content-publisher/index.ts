// DUBIS Content Publisher v2 — standalone, atomic-claim, with Meta Graph backfill
// Triggered by Vercel cron at 10:00 + 16:00 UTC daily.
// Auth: x-agent-secret header OR ?token=SERVICE_ROLE_KEY
// 2026-04-25: replaces agents/?type=publish-ready (which had dup-publish bug)
// 2026-06-01 (v14): backfill no longer marks empty weekly-plan placeholders as done.
//   Guards added: (1) skip tasks with needs_copy===true, (2) skip tasks with no real
//   caption AND no real media, (3) dedup IG media ids so two tasks can't claim the same
//   post. Root cause of the '23 tagged / 4 real' count inflation in the Boss daily report.
// 2026-06 service-role rotation: dubis-cron-dispatcher + dubis-run-all call this with the
//   service-role key (dispatcher now sends the new sb_secret 'dubissecretkey'). Accept BOTH
//   keys (SVC_KEYS); use the preferred one (SERVICE_ROLE) for the DB client — so the legacy
//   + exposed 'default' keys can be disabled with zero downtime.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type TaskRow = { id: string; title: string; status: string; content_data: Record<string, unknown> };
type Result = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SVC_KEYS = (() => {
  const s = new Set<string>();
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) s.add(k as string); } catch { /* not migrated yet */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (legacy) s.add(legacy);
  return s;
})();
const SERVICE_ROLE = [...SVC_KEYS][0] ?? '';   // prefer dubissecretkey for DB client
const AGENT_SECRET = Deno.env.get('AGENT_SECRET') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const IG_TOKEN = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
const IG_ACCOUNT = Deno.env.get('INSTAGRAM_ACCOUNT_ID') ?? '';
const FB_PAGE_ID = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
const FB_TOKEN = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? IG_TOKEN;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function isAuthed(req: Request): boolean {
  const url = new URL(req.url);
  const tok = url.searchParams.get('token') || req.headers.get('x-agent-secret') || (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  return !!tok && (SVC_KEYS.has(tok) || tok === AGENT_SECRET || tok === CRON_SECRET);
}

/** A task is 'rendered' (real, publishable content) only if it has a real caption OR real media.
 *  Empty weekly-plan placeholders (needs_copy:true, only product_slogan + product_url) are NOT. */
function isRenderedContent(cd: Record<string, unknown>): boolean {
  if (cd.needs_copy === true) return false;
  const capEn = ((cd.caption_en as string) || '').trim();
  const capHe = ((cd.caption_he as string) || '').trim();
  const hasCaption = capEn.length > 0 || capHe.length > 0;
  const hasImage = !!((cd.generated_image_url as string) || '').trim();
  const hasVideo = !!((cd.video_url as string) || '').trim();
  return hasCaption || hasImage || hasVideo;
}

async function logRun(sb: ReturnType<typeof createClient>, summary: string, ids: string[], status: string, sideEffects: Record<string, unknown>): Promise<void> {
  try {
    await sb.from('agent_runs').insert({
      agent_id: 'content',
      run_date: new Date().toISOString().slice(0, 10),
      status,
      summary,
      tasks_created: 0,
      tasks_completed_ids: ids,
      side_effects: sideEffects,
    });
  } catch (e) { console.error('logRun failed', e); }
}

/** Backfill instagram_post_id for tasks that we know were published but DB doesn't reflect it.
 *  Pulls last 30 IG media items and matches by caption substring (slogan + product URL pattern).
 *  v14: only backfills REAL rendered content, never empty placeholders, and never lets two tasks
 *  claim the same IG media id. */
async function backfillFromMetaGraph(sb: ReturnType<typeof createClient>): Promise<{ matched: number; checked: number; skipped_placeholder: number; details: Result[] }> {
  if (!IG_TOKEN || !IG_ACCOUNT) return { matched: 0, checked: 0, skipped_placeholder: 0, details: [] };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${IG_ACCOUNT}/media?fields=id,caption,timestamp,permalink&limit=30&access_token=${IG_TOKEN}`);
    const data = await r.json();
    if (!r.ok || data.error) return { matched: 0, checked: 0, skipped_placeholder: 0, details: [{ error: data.error?.message || `HTTP ${r.status}` }] };
    const media = (data.data || []) as { id: string; caption?: string; timestamp: string; permalink?: string }[];

    // Seed the used-media set with EVERY IG id already attributed in the DB so a media item
    // that's already credited to one task can't be re-credited to a second task.
    const usedMediaIds = new Set<string>();
    const { data: already } = await sb.from('agent_tasks')
      .select('content_data')
      .eq('agent_id', 'content')
      .not('content_data->>instagram_post_id', 'is', null);
    for (const a of (already || [])) {
      const igid = ((a as { content_data: Record<string, unknown> }).content_data || {}).instagram_post_id as string | undefined;
      if (igid) usedMediaIds.add(igid);
    }

    // Pull tasks that lack instagram_post_id but were created in last 14 days
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: tasks } = await sb.from('agent_tasks').select('id, content_data, status, created_at')
      .eq('agent_id', 'content')
      .gte('created_at', since);
    let matched = 0;
    let skippedPlaceholder = 0;
    const details: Result[] = [];
    for (const t of (tasks || [])) {
      const cd = (t as { content_data: Record<string, unknown> }).content_data || {};
      if (cd.instagram_post_id) continue; // already has it
      // GUARD: never attribute a published post to an empty weekly-plan placeholder.
      if (!isRenderedContent(cd)) { skippedPlaceholder++; continue; }
      const slogan = ((cd.product_slogan as string) || '').toLowerCase();
      const productUrl = ((cd.product_url as string) || '').match(/\#product-(\d+)|\?p=(\d+)/);
      const pid = productUrl ? (productUrl[1] || productUrl[2]) : null;
      // Match heuristic: caption contains slogan AND ?p=N or #product-N AND media not already used
      const match = media.find(m => {
        if (usedMediaIds.has(m.id)) return false;
        const cap = (m.caption || '').toLowerCase();
        if (!slogan || !cap.includes(slogan.toLowerCase().slice(0, 20))) return false;
        if (pid && (cap.includes(`?p=${pid}`) || cap.includes(`#product-${pid}`))) return true;
        return false;
      });
      if (match) {
        usedMediaIds.add(match.id);
        const newCd = { ...cd, instagram_post_id: match.id, published_at: match.timestamp, instagram_permalink: match.permalink, backfilled_at: new Date().toISOString(), backfill_source: 'meta_graph_api' };
        await sb.from('agent_tasks').update({ content_data: newCd, status: 'done', proof_of_completion: { instagram_post_id: match.id, meta_graph_verified: true, backfilled_at: new Date().toISOString() } }).eq('id', (t as { id: string }).id);
        matched++;
        details.push({ task_id: (t as { id: string }).id, ig_id: match.id, slogan: cd.product_slogan });
      }
    }
    return { matched, checked: (tasks || []).length, skipped_placeholder: skippedPlaceholder, details };
  } catch (e) {
    return { matched: 0, checked: 0, skipped_placeholder: 0, details: [{ error: (e as Error).message }] };
  }
}

async function publishOne(sb: ReturnType<typeof createClient>, task: TaskRow): Promise<Result> {
  const cd = task.content_data || {};
  const priorStatus = task.status;
  const acceptStatuses = priorStatus === 'publishing' ? ['publishing'] : ['pending_approval', 'approved'];
  const attemptCount = ((cd.publish_attempts as number) || 0) + 1;
  const claimNow = new Date().toISOString();

  // ATOMIC CLAIM — only one worker wins
  const { data: claimed, error: claimErr } = await sb.from('agent_tasks')
    .update({ status: 'publishing', content_data: { ...cd, publish_lock_at: claimNow, publish_attempts: attemptCount }, updated_at: claimNow })
    .eq('id', task.id)
    .in('status', acceptStatuses)
    .select('id')
    .maybeSingle();
  if (claimErr || !claimed) return { id: task.id, status: 'skipped', reason: claimErr?.message || 'lock-held-by-another-worker' };

  // Build captions
  const productUrl = (cd.product_url as string) || 'https://www.dubis.net';
  const productUrlQP = productUrl.replace(/\/?#product-(\d+)/, '/?p=$1');
  const igUrl = productUrlQP.replace(/^https?:\/\/(www\.)?/, '');
  const priceUsd = cd.product_price_usd as number | null;
  const priceTag = priceUsd != null ? ` — $${priceUsd}` : '';
  const shopLineIG = `🛒 Shop this${priceTag} → ${igUrl}\n🔗 Tap link in bio @dubis.brand`;
  const shopLineFB = `🛒 Shop this${priceTag} → ${productUrlQP}`;
  const baseBody = (cd.caption_en as string) || (cd.caption_he as string) || task.title;
  const tags = (cd.hashtags as string) || '#DUBIS #ForTheRestOfUs';
  const cleanBody = baseBody.replace(/https?:\/\/(www\.)?dubis\.net\/?/gi, '').replace(/www\.dubis\.net\/?/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  const captionIG = `${cleanBody}\n\n${shopLineIG}\n\n${tags}`;
  const captionFB = `${cleanBody}\n\n${shopLineFB}\n\n${tags}`;

  let image_url = cd.generated_image_url as string;
  if (image_url?.includes('supabase.co/storage/v1/object/public/ig-images/')) {
    const filename = image_url.split('/ig-images/').pop();
    image_url = `${SUPABASE_URL.replace('/rest/v1', '')}/functions/v1/agents?type=serve-image&f=${encodeURIComponent(filename || '')}`;
  }

  const igBase = `https://graph.facebook.com/v19.0/${IG_ACCOUNT}`;
  try {
    // 1. Create container
    const cRes = await fetch(`${igBase}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption: captionIG, access_token: IG_TOKEN }) });
    const container = await cRes.json();
    if (!cRes.ok || container.error) {
      const errMsg = container.error?.message || 'container failed';
      await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg }, updated_at: new Date().toISOString() }).eq('id', task.id);
      return { id: task.id, status: 'error', error: errMsg };
    }
    await new Promise((r) => setTimeout(r, 7000));

    // 2. Publish
    const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: IG_TOKEN }) });
    const pub = await pRes.json();
    if (!pRes.ok || pub.error) {
      const errMsg = pub.error?.message || 'publish failed';
      await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg }, updated_at: new Date().toISOString() }).eq('id', task.id);
      return { id: task.id, status: 'error', error: errMsg };
    }

    // 3. Cross-post to Facebook (best-effort)
    let fbPostId: string | null = null;
    let fbError: string | null = null;
    try {
      if (FB_PAGE_ID) {
        const fbRes = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: image_url, caption: captionFB, access_token: FB_TOKEN }) });
        const fbData = await fbRes.json();
        if (fbRes.ok && fbData.id && !fbData.error) fbPostId = fbData.id;
        else fbError = fbData.error?.message || `HTTP ${fbRes.status}`;
      } else fbError = 'FACEBOOK_PAGE_ID not set';
    } catch (fbErr) { fbError = (fbErr as Error).message; }

    // 4. Mark done with proof_of_completion (will pass proof_guard_v2)
    const publishNow = new Date().toISOString();
    await sb.from('agent_tasks').update({
      status: 'done',
      content_data: { ...cd, instagram_post_id: pub.id, facebook_post_id: fbPostId, published_at: publishNow, publish_lock_at: null, publish_attempts: attemptCount },
      proof_of_completion: { instagram_post_id: pub.id, facebook_post_id: fbPostId, published_at: publishNow, publisher: 'dubis-content-publisher-v2' },
      updated_at: publishNow,
    }).eq('id', task.id);

    return { id: task.id, status: 'published', ig_id: pub.id, fb_id: fbPostId, fb_error: fbError };
  } catch (e) {
    const errMsg = (e as Error).message;
    try { await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg }, updated_at: new Date().toISOString() }).eq('id', task.id); } catch { /* swallow */ }
    return { id: task.id, status: 'error', error: errMsg };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  if (!isAuthed(req)) return json({ error: 'Unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);
  if (!IG_TOKEN || !IG_ACCOUNT) return json({ error: 'Instagram env vars missing' }, 503);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'publish';
  const batchSize = parseInt(url.searchParams.get('batch') || '1', 10);
  const STALE_LOCK_MS = 10 * 60 * 1000;
  const nowMs = Date.now();

  // ── Action: backfill ────────────────────────────────────────────────
  if (action === 'backfill') {
    const r = await backfillFromMetaGraph(sb);
    await logRun(sb, `backfill: matched ${r.matched} of ${r.checked} tasks (skipped ${r.skipped_placeholder} placeholders) from Meta Graph API`, [], 'completed', { backfill: r });
    return json({ action, ...r });
  }

  // ── Action: unfreeze ────────────────────────────────────────────────
  if (action === 'unfreeze') {
    const { data: frozen } = await sb.from('agent_tasks').select('id, content_data')
      .eq('agent_id', 'content')
      .filter('content_data->>publish_frozen', 'eq', 'true');
    let cleared = 0;
    for (const t of (frozen || [])) {
      const cd = (t as { content_data: Record<string, unknown> }).content_data || {};
      const newCd = { ...cd };
      delete newCd.publish_frozen;
      delete newCd.publish_frozen_at;
      delete newCd.publish_frozen_reason;
      newCd.unfrozen_at = new Date().toISOString();
      newCd.unfrozen_by = 'dubis-content-publisher-v2';
      await sb.from('agent_tasks').update({ content_data: newCd }).eq('id', (t as { id: string }).id);
      cleared++;
    }
    await logRun(sb, `unfreeze: cleared publish_frozen on ${cleared} tasks`, [], 'completed', { unfrozen: cleared });
    return json({ action, unfrozen: cleared });
  }

  // ── Default action: publish ─────────────────────────────────────────
  const { data: candidates, error: fetchErr } = await sb.from('agent_tasks')
    .select('id, title, content_data, status')
    .in('status', ['pending_approval', 'approved', 'publishing'])
    .eq('agent_id', 'content')
    .order('created_at', { ascending: true });
  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const readyTasks = (candidates || []).filter((t: TaskRow) => {
    const cd = t.content_data || {};
    if (cd.publish_frozen) return false;
    const hasImage = !!(cd.generated_image_url as string);
    const hasReel = !!(cd.video_url && cd.reel_status === 'ready');
    if (!cd.content_approved || (!hasImage && !hasReel)) return false;
    if (t.status === 'publishing') {
      const lockAt = cd.publish_lock_at as string | undefined;
      if (lockAt && (nowMs - new Date(lockAt).getTime()) < STALE_LOCK_MS) return false;
    }
    if ((cd.publish_attempts as number) >= 5) return false;
    return true;
  }).slice(0, batchSize);

  if (!readyTasks.length) {
    await logRun(sb, 'no ready tasks to publish', [], 'no_op', {});
    return json({ published: 0, summary: 'no ready tasks' });
  }

  const results: Result[] = [];
  const publishedIds: string[] = [];
  for (const task of readyTasks) {
    const r = await publishOne(sb, task as TaskRow);
    results.push(r);
    if (r.status === 'published') publishedIds.push(r.id as string);
  }

  const publishedCount = results.filter(r => r.status === 'published').length;
  const summary = `published ${publishedCount}/${readyTasks.length} via atomic-claim`;
  await logRun(sb, summary, publishedIds, 'completed', { results });
  return json({ published: publishedCount, total_ready: readyTasks.length, results });
});
