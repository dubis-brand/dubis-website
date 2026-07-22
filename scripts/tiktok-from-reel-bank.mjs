#!/usr/bin/env node
// tiktok-from-reel-bank.mjs — daily TikTok publisher from the PRODUCT-keyed reel bank.
//
// Locked 2026-05-23 per oren ("boring slideshows + bad music must die").
// Rewritten 2026-06-28 per oren ("חוזרים כל הזמן על אותם רילים + כפילות לכל ריל — מתכון לאסון").
//
// ─── Why the rewrite (root cause, proven against DB + Storage) ───────────────
//  The OLD bank was persona-keyed with TWO slots per persona: {persona}-FINAL-HE
//  and {persona}-FINAL-EN. But since 2026-06-07 reels are ENGLISH-VIDEO-ONLY — the
//  HE file is the SAME video as the EN file, only the caption differs. So the
//  rotation landed on the same video twice (men-1/HE then men-1/EN) and TikTok got
//  two IDENTICAL videos = the duplicate pairs in the feed. On top of that, after the
//  active-product filter the persona bank held only ~4 unique videos, so the same
//  handful cycled forever. agent_tasks showed 10 consecutive HE→EN identical-video
//  pairs (2026-06-09 → 06-28).
//
// ─── The fix ─────────────────────────────────────────────────────────────────
//   1. Rotate over UNIQUE VIDEOS — one per active product — from the product-keyed
//      bank `video-assets/_pilot/product-{pid}-FINAL-EN.mp4` (16 products live).
//      No HE/EN split → a video can never be posted twice.
//   2. Pick LEAST-RECENTLY-POSTED first (read agent_tasks history), not day%N — the
//      whole pool cycles before anything repeats.
//   3. Caption is HEBREW ONLY (IL-only marketing, locked 2026-06-19). The video is
//      English-spoken; the Hebrew story/slogan lives in the caption.
//
// Env (Vercel/GHA secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (Late.com creds are pulled from vault, not env)
//   FORCE_PRODUCT (optional, workflow_dispatch) — force a specific product id.
//   FORCE_PERSONA is still read for backward-compat and mapped to its product id.
//   DRY_RUN=1 — resolve + log the pick and caption, do NOT publish or write rows.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const DRY_RUN = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());

// Optional rooted-Hebrew narration overrides for products that already have good
// copy from the May persona bank. Any product NOT listed falls back to its DB slogan.
// Per-product caption polish is a Dana → Copywriter → Gatekeeper follow-up, not this
// script's job — here we only stop the duplication + repetition.
const HE_NARRATION = {
  3:  'כולם רצים בשש בבוקר לאסיק. אני? אני מאסטר ב-Power Nap. זה הקרדיו האמיתי. קפוצון לכל השאר.',
  8:  'נולדתי לישון. אילצו אותי לעבוד. את שני המסרים האלה אני לובש על הגב. בכבוד.',
  11: 'האמינו בי שאוכל. אז לקחתי שלוף קצר. מסתבר שזה היה הדבר הכי חכם של היום.',
  31: 'את יפה יותר כשנוח לך. אמרו לי את זה לפני עשרים שנה. רק עכשיו אני מתחילה להאמין.',
};

// Backward-compat: map the old FORCE_PERSONA ids to product ids.
const PERSONA_TO_PRODUCT = {
  'men-1': 3, 'men-2': 6, 'men-3': 15, 'men-4': 9, 'men-5': 8,
  'women-1': 11, 'women-2': 13, 'women-3': 16, 'women-4': 17, 'women-5': 31,
};

// 2026-07-06: scene-format reels (oren-approved rebuild, batch 1) — hosted on dubis.net.
// When a product has an override here, it is used INSTEAD of the old bank URL.
// All 3 carry a music bed (Kevin MacLeod "Wallpaper", CC-BY) mixed 45/55 with the
// original ambient. #38 is v4: the AI clip kept painting the chest logo on the
// garment's flipped side instead of the real back slogan (oren caught it twice),
// so the in-scene turn is now a seedance start_image+end_image anchored clip —
// front frame from the verified footage, end frame = nano_banana still of the SAME
// scene holding the REAL back print (verified letter-for-letter). The turn lands
// on the true "Sleeves were OPTIONAL" back inside the scene. See
// .claude/skills/higgsfield-reels/SKILL.md → "The CANONICAL flip fix".
const REEL_OVERRIDES = {
  38: 'https://www.dubis.net/preview/reels/format-38-unboxing-v4.mp4',
  23: 'https://www.dubis.net/preview/reels/fmt-23-paparazzi.mp4',
  40: 'https://www.dubis.net/preview/reels/fmt-40-streetstop.mp4',
  43: 'https://www.dubis.net/preview/reels/fmt-43-endingfairy.mp4',
};

function bankUrl(productId) {
  if (REEL_OVERRIDES[productId]) return REEL_OVERRIDES[productId];
  return `${SUPABASE_URL}/storage/v1/object/public/video-assets/_pilot/product-${productId}-FINAL-EN.mp4`;
}

async function checkReelExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

// Build the available bank: every ACTIVE product that has a product-keyed reel in
// Storage. One slot per product = one unique video. No language split.
async function buildAvailableBank() {
  const { data: actives, error } = await sb
    .from('dubis_products')
    .select('product_id_numeric, slogan')
    .eq('active', true)
    .order('product_id_numeric', { ascending: true });
  if (error) throw new Error(`active-products query failed: ${error.message}`);

  const candidates = (actives || [])
    .map(r => ({ product_id: Number(r.product_id_numeric), slogan: r.slogan, url: bankUrl(Number(r.product_id_numeric)) }))
    .filter(c => Number.isFinite(c.product_id));

  const checks = await Promise.all(candidates.map(c => checkReelExists(c.url)));
  const avail = candidates.filter((_, i) => checks[i]);
  const missing = candidates.filter((_, i) => !checks[i]).map(c => c.product_id);
  if (missing.length) console.log(`Active products without a reel yet (need ensure-reel-bank.mjs + hf): ${missing.join(', ')}`);
  return avail;
}

// Pick the available product whose video was posted LONGEST ago (never-posted first).
// This walks the entire pool before repeating anything.
async function pickProductForToday(available) {
  // Manual override (workflow_dispatch)
  const fProductRaw = (process.env.FORCE_PRODUCT || '').trim();
  const fPersona    = (process.env.FORCE_PERSONA || '').trim();
  const forcedId = fProductRaw ? Number(fProductRaw) : (fPersona ? PERSONA_TO_PRODUCT[fPersona] : null);
  if (forcedId) {
    const match = available.find(s => s.product_id === forcedId);
    if (!match) throw new Error(`Forced product ${forcedId} not in available bank (${available.map(s => s.product_id).join(',')})`);
    console.log(`Override: forced product ${forcedId}`);
    return { ...match, forced: true };
  }

  // Last-posted timestamp per product from history.
  const { data: hist } = await sb
    .from('agent_tasks')
    .select('content_data, created_at')
    .eq('agent_id', 'tiktok')
    .eq('category', 'tiktok_post')
    .order('created_at', { ascending: false })
    .limit(200);
  const lastPosted = new Map();
  for (const row of (hist || [])) {
    const pid = Number(row?.content_data?.product_id);
    if (Number.isFinite(pid) && !lastPosted.has(pid)) lastPosted.set(pid, new Date(row.created_at).getTime());
  }

  let best = null, bestTs = Infinity;
  for (const s of available) {
    const ts = lastPosted.has(s.product_id) ? lastPosted.get(s.product_id) : 0; // never posted = 0 = oldest
    if (ts < bestTs) { bestTs = ts; best = s; }
  }
  const ageDays = bestTs === 0 ? 'never' : Math.round((Date.now() - bestTs) / 86400000) + 'd ago';
  console.log(`Least-recently-posted pick: product ${best.product_id} (last posted: ${ageDays})`);
  return { ...best, forced: false };
}

function buildCaption(product) {
  const url = `https://www.dubis.net/?p=${product.product_id}`;
  const story = HE_NARRATION[product.product_id] || product.slogan || 'בגדים שנבנו לגוף שאתה גר בו.';
  return `${story}\n\nDUBIS — בשביל כולנו.\n\n👉 ${url}\n\n#DUBIS #גוףאמיתי #קפוצון #פוראופנה`;
}

async function vaultGet(name) {
  const { data, error } = await sb.rpc('get_vault_secret', { secret_name: name });
  if (error) throw new Error(`vault ${name}: ${error.message}`);
  return (data || '').toString();
}

async function publishToLate({ videoUrl, caption }) {
  let apiKey  = process.env.DUBIS_LATE_API_KEY        || '';
  let account = process.env.DUBIS_LATE_TIKTOK_ACCOUNT || '';
  if (!apiKey)  apiKey  = await vaultGet('dubis_late_api_key');
  if (!account) account = await vaultGet('dubis_late_tiktok_account_id');
  if (!apiKey || !account) throw new Error('Late.com creds missing (env + vault both empty)');

  const payload = {
    content: caption,
    platforms: [{ platform: 'tiktok', accountId: account }],
    mediaItems: [{ type: 'video', url: videoUrl }],
    tiktokSettings: {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
    },
    publishNow: true,
  };
  const r = await fetch('https://getlate.dev/api/v1/posts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const txt = await r.text();
  console.log('Late response', r.status, txt.slice(0, 1000));
  if (!r.ok) throw new Error(`Late.com publish failed ${r.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return { raw: txt.slice(0, 500) }; }
}

function extractLatePostId(lateResponse) {
  if (!lateResponse || typeof lateResponse !== 'object') return null;
  return (
    lateResponse.post?._id ||
    lateResponse.post?.id ||
    lateResponse._id ||
    lateResponse.id ||
    lateResponse.data?._id ||
    lateResponse.posts?.[0]?._id ||
    null
  );
}

// Late.com publishes to TikTok ASYNC — the immediate POST returns status "publishing"
// with no public URL. Once TikTok finalizes, GET /posts/{id} returns platformPostId
// (TikTok video id) + tiktokUsername → build the public URL. Poll briefly; if it isn't
// ready in time, the Boss daily-report backfill (backfillTiktokUrls) resolves it later.
async function resolveTiktokUrl(latePostId, tries = 5, delayMs = 15000) {
  let key = process.env.DUBIS_LATE_API_KEY || '';
  if (!key) { try { key = await vaultGet('dubis_late_api_key'); } catch { return null; } }
  if (!key) return null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://getlate.dev/api/v1/posts/${latePostId}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        const p = j.post || j;
        const pf = (p.platforms || [])[0] || {};
        if (pf.status === 'published' && pf.platformPostId) {
          const user = pf.platformSpecificData?.tiktokUsername || 'dubis.brand';
          return `https://www.tiktok.com/@${user}/video/${pf.platformPostId}`;
        }
      }
    } catch { /* keep polling */ }
    if (i < tries - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  return null;
}

async function recordTask({ product, videoUrl, caption, lateResponse, tiktokUrl }) {
  const latePostId = extractLatePostId(lateResponse);
  const row = {
    agent_id: 'tiktok',
    category: 'tiktok_post',
    status: 'done',
    title: `TikTok product ${product.product_id} (least-recently-posted rotation)`,
    content_data: {
      format: 'reel',
      platform: 'tiktok',
      lang: 'he',
      product_id: product.product_id,
      product_slogan: product.slogan,
      product_url: `https://www.dubis.net/?p=${product.product_id}`,
      video_url: videoUrl,
      bank_path: `video-assets/_pilot/product-${product.product_id}-FINAL-EN.mp4`,
      caption: caption,
      publisher: 'late-direct',
      renderer: 'reel-bank-product-rotation-v2',
      late_response: lateResponse,
      tiktok_late_post_id: latePostId,
      tiktok_url: tiktokUrl || null,
      api_response: latePostId ? `late:${latePostId}` : JSON.stringify(lateResponse).slice(0, 500),
      content_approved: true,
      auto_approved: true,
    },
    due_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('agent_tasks').insert(row).select('id').single();
  if (error) throw new Error(`agent_tasks insert failed: ${error.message}`);
  console.log('Recorded task:', data.id);
  return data.id;
}

// The Boss daily-report staleness check reads `agent_runs`, NOT `agent_tasks`.
async function recordRun({ product, taskId, latePostId, startedAt, tiktokUrl }) {
  const row = {
    agent_id: 'tiktok',
    status: 'completed',
    summary: `TikTok published product ${product.product_id} (product-rotation)`
           + (latePostId ? ` → late:${latePostId}` : ''),
    tasks_created: 1,
    tasks_completed_ids: taskId ? [taskId] : [],
    duration_ms: startedAt ? (Date.now() - startedAt) : null,
    side_effects: {
      publisher: 'late-direct',
      renderer: 'reel-bank-product-rotation-v2',
      product_id: product.product_id,
      lang: 'he',
      tiktok_late_post_id: latePostId || null,
      tiktok_url: tiktokUrl || null,
    },
  };
  const { data, error } = await sb.from('agent_runs').insert(row).select('id').single();
  if (error) {
    console.error('agent_runs insert failed (non-fatal):', error.message);
    return null;
  }
  console.log('Recorded run:', data.id);
  return data.id;
}

async function main() {
  const startedAt = Date.now();
  console.log('=== DUBIS TikTok Daily (product-keyed rotation v2) ===', new Date().toISOString());

  const available = await buildAvailableBank();
  console.log(`Bank: ${available.length} unique product reels available → ${available.map(s => s.product_id).join(', ') || '(none)'}`);
  if (!available.length) throw new Error('No product reel available in bank. Run ensure-reel-bank.mjs first.');

  const product = await pickProductForToday(available);
  const videoUrl = bankUrl(product.product_id);
  const caption = buildCaption(product);
  console.log(`Pick → product ${product.product_id} | video ${videoUrl}`);
  console.log('Caption preview:', caption.replace(/\n/g, ' ⏎ ').slice(0, 160));

  if (DRY_RUN) {
    console.log('DRY_RUN=1 → not publishing, not writing rows. Done.');
    return;
  }

  const late = await publishToLate({ videoUrl, caption });
  const latePostId = extractLatePostId(late);
  let tiktokUrl = null;
  if (latePostId) { tiktokUrl = await resolveTiktokUrl(latePostId); console.log('TikTok URL:', tiktokUrl || '(pending finalize — Boss will backfill)'); }
  const taskId = await recordTask({ product, videoUrl, caption, lateResponse: late, tiktokUrl });
  await recordRun({ product, taskId, latePostId, startedAt, tiktokUrl });
  console.log('=== DONE ===');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
