#!/usr/bin/env node
// tiktok-from-reel-bank.mjs — daily TikTok publisher from the bilingual persona reel bank.
//
// Locked 2026-05-23 per oren ("boring slideshows + bad music must die").
// Replaces dubis-website/video/scripts/render-and-publish.js (3-slide ffmpeg + Kevin MacLeod).
//
// Pipeline:
//   1. Pull the reel of the day from Supabase Storage `video-assets/_pilot/{persona}-FINAL.mp4`
//      using a deterministic rotation over POPULATED personas: pos = dayOfYear mod available.
//      (HE/EN bank files are byte-identical, so each persona is ONE slot — see buildAvailableBank.)
//   2. Build a caption whose LANGUAGE alternates per day (even→HE, odd→EN).
//   3. POST to Late.com /v1/posts with the public mp4 URL.
//   4. Insert an agent_tasks row with category='tiktok_post' for tracking.
//
// Env (Vercel/GHA secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (Late.com creds are pulled from vault, not env)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// Bank — 10 personas × 2 langs = 20 reels, walked deterministically.
// Each persona has product_default which we use to build the caption + URL.
const BANK = [
  { id: 'men-1',   gender: 'men',   product_id: 3,  slogan: 'Napping is my cardio',
    narration_he: 'כולם רצים בשש בבוקר לאסיק. אני? אני מאסטר ב-Power Nap. זה הקרדיו האמיתי. קפוצון לכל השאר.',
    narration_en: "Everyone's at the 6 AM CrossFit. I'm a master of the power nap. That's the real cardio. A hoodie for the rest of us." },
  { id: 'men-2',   gender: 'men',   product_id: 6,  slogan: 'Not a model. Never wanted to be.' },
  { id: 'men-3',   gender: 'men',   product_id: 15, slogan: 'Low maintenance, high value.' },
  { id: 'men-4',   gender: 'men',   product_id: 9,  slogan: 'Certified overthinker.' },
  { id: 'men-5',   gender: 'men',   product_id: 8,  slogan: 'Born to nap, forced to work.',
    narration_he: 'נולדתי לישון. אילצו אותי לעבוד. את שני המסרים האלה לובש על הגב. בכבוד.',
    narration_en: 'Born to nap, forced to work. Both messages, on my back. With respect.' },
  { id: 'women-1', gender: 'women', product_id: 11, slogan: 'She believed she could, so she took a nap.',
    narration_he: 'האמינו בי שאוכל. אז לקחתי שלוף קצר. מסתבר שזה היה הדבר הכי חכם של היום.',
    narration_en: 'They believed she could. So she took a nap. Turns out that was the smartest move of the day.' },
  { id: 'women-2', gender: 'women', product_id: 13, slogan: 'Zero Motivation Club.' },
  { id: 'women-3', gender: 'women', product_id: 16, slogan: 'Minimal existence.' },
  { id: 'women-4', gender: 'women', product_id: 17, slogan: 'Experienced in exhaustion.' },
  { id: 'women-5', gender: 'women', product_id: 31, slogan: "You're prettier when you're comfortable.",
    narration_he: 'את יפה יותר כשנוח לך. הם אמרו לי לפני עשרים שנה. רק עכשיו אני מתחילה להאמין.',
    narration_en: "You're prettier when you're comfortable. Someone told me twenty years ago. I'm only starting to believe it now." },
];
const LANGS = ['HE', 'EN'];

function dayOfYearUTC() {
  const now = new Date();
  // Day-of-year in UTC — TikTok cron fires at 15:00 UTC = 18:00 IL (IDT)
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
}

// Probe each persona's reel and return only the ones that actually exist in
// Supabase Storage, in stable bank order — ONE slot per persona.
//
// 2026-06-01 (oren complaint "בטיק טוק אותו פוסט עלה פעמיים"): the old rotation
// did `idx = day % 20` then walked FORWARD past empty slots, collapsing most days
// onto men-1/HE. Fixed by rotating over only populated slots.
//
// 2026-06-16 (oren complaint "כל סרטון בטיק טוק יוצא כפול"): the deeper cause —
// `{persona}-FINAL-HE.mp4` and `{persona}-FINAL-EN.mp4` are BYTE-IDENTICAL files
// (verified via storage etag match; the reels are English Veo footage, only the
// caption differs by language). Treating HE+EN as two slots published the SAME
// video twice to the one @dubis.brand account. Fix: one rotation slot per persona;
// the caption language alternates per day (see pickReelForToday). EN is the
// canonical file, with HE as a fallback in case only that name was uploaded.
async function buildAvailableBank() {
  const slots = BANK.map((persona, i) => ({
    persona, idx: i,
    canonicalUrl: bankUrl(persona, 'EN'),
    fallbackUrl:  bankUrl(persona, 'HE'),
  }));
  const resolved = await Promise.all(slots.map(async s => {
    if (await checkReelExists(s.canonicalUrl)) return s.canonicalUrl;
    if (await checkReelExists(s.fallbackUrl))  return s.fallbackUrl;
    return null;
  }));
  let avail = slots
    .map((s, i) => ({ persona: s.persona, idx: s.idx, url: resolved[i] }))
    .filter(s => s.url);
  // 2026-06-07: only publish reels whose product is ACTIVE on the site. Old reels
  // (men-2→product 6, men-3→product 15) point at retired pullover-hoodie products
  // that no longer exist — the caption's product URL would 404. Filter them out so
  // we never market a dead product. A fresh reel for an active product rejoins the
  // rotation automatically once it lands in the bank.
  try {
    const { data: actives } = await sb.from('dubis_products').select('product_id_numeric').eq('active', true);
    const activeIds = new Set((actives || []).map(r => Number(r.product_id_numeric)));
    const before = avail.length;
    avail = avail.filter(s => activeIds.has(Number(s.persona.product_id)));
    if (avail.length < before) console.log(`Skipped ${before - avail.length} reel(s) whose product is inactive (dead-product link guard)`);
  } catch (e) { console.warn('active-product filter skipped:', e.message); }
  return avail;
}

function pickReelForToday(available) {
  const day = dayOfYearUTC();

  // Caption language alternates per day (oren 2026-06-16): even day-of-year → HE,
  // odd → EN. The footage is identical across languages — only the caption text
  // changes — so each unique video is published exactly once per rotation turn.
  const fPersona = (process.env.FORCE_PERSONA || '').trim();
  const fLang    = (process.env.FORCE_LANG    || '').trim().toUpperCase();
  if (fLang && !LANGS.includes(fLang)) throw new Error(`FORCE_LANG "${fLang}" not HE or EN`);
  const lang = fLang || (day % 2 === 0 ? 'HE' : 'EN');

  // Manual persona override via workflow_dispatch inputs (forwarded as env vars)
  if (fPersona) {
    const match = available.find(s => s.persona.id === fPersona);
    if (!match) throw new Error(`FORCE_PERSONA "${fPersona}" not in available bank`);
    console.log(`Override: forced persona=${fPersona} lang=${lang} → bank idx=${match.idx}`);
    return { persona: match.persona, lang, day, idx: match.idx, pos: -1, url: match.url };
  }

  // Rotate over ONLY the populated personas — consecutive days always advance to a
  // different reel (no repeats until the whole available set is exhausted).
  const pos     = day % available.length;
  const chosen  = available[pos];
  return { persona: chosen.persona, lang, day, idx: chosen.idx, pos, url: chosen.url };
}

function bankUrl(persona, lang) {
  return `${SUPABASE_URL}/storage/v1/object/public/video-assets/_pilot/${persona.id}-FINAL-${lang}.mp4`;
}

async function checkReelExists(url) {
  const r = await fetch(url, { method: 'HEAD' });
  return r.ok;
}

function buildCaption(persona, lang) {
  const url = `https://www.dubis.net/?p=${persona.product_id}`;
  // 2026-06-07 (oren): all reels are English (Veo native). The STORY goes in the caption,
  // per language — the Hebrew caption tells the Hebrew story; the English caption the English
  // one. No on-screen subtitles. narration_* falls back to the slogan if absent.
  if (lang === 'HE') {
    const story = persona.narration_he || persona.slogan;
    return `${story}\n\nDUBIS — בשביל כולנו.\n\n👉 ${url}\n\n#DUBIS #גוףאמיתי #קפוצון #פוראופנה`;
  }
  const story = persona.narration_en || persona.slogan;
  return `${story}\n\nDUBIS — for the rest of us.\n\n👉 ${url}\n\n#DUBIS #realbodies #hoodieseason #fortherestofus`;
}

async function vaultGet(name) {
  const { data, error } = await sb.rpc('get_vault_secret', { secret_name: name });
  if (error) throw new Error(`vault ${name}: ${error.message}`);
  return (data || '').toString();
}

async function publishToLate({ videoUrl, caption, persona, lang }) {
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

async function recordTask({ persona, lang, videoUrl, caption, lateResponse, rotationDay, rotationIdx, tiktokUrl }) {
  const latePostId = extractLatePostId(lateResponse);
  const row = {
    agent_id: 'tiktok',
    category: 'tiktok_post',
    status: 'done',
    title: `TikTok ${persona.id} / ${lang} / day ${rotationDay} idx ${rotationIdx}`,
    content_data: {
      format: 'reel',
      platform: 'tiktok',
      lang: lang.toLowerCase(),
      persona_id: persona.id,
      product_id: persona.product_id,
      product_slogan: persona.slogan,
      product_url: `https://www.dubis.net/?p=${persona.product_id}`,
      video_url: videoUrl,
      bank_path: videoUrl.replace(/^.*\/video-assets\//, 'video-assets/'),
      caption: caption,
      publisher: 'late-direct',
      renderer: 'reel-bank-rotation-v1',
      rotation_day: rotationDay,
      rotation_idx: rotationIdx,
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
// Without this row, the Boss falsely flags TikTok as "N days idle" even though we
// publish daily (false-alarm diagnosed 2026-06-01: agent_runs last tiktok = 2026-05-22,
// while agent_tasks shows 05-29/05-30/05-31). The old render-and-publish.js wrote
// agent_runs; this reel-bank rewrite forgot to. This closes the tracking gap so the
// Boss correctly shows tiktok GREEN.
async function recordRun({ persona, lang, taskId, latePostId, rotationDay, rotationIdx, startedAt, tiktokUrl }) {
  const row = {
    agent_id: 'tiktok',
    status: 'completed',
    summary: `TikTok published ${persona.id}/${lang} (day ${rotationDay} idx ${rotationIdx})`
           + (latePostId ? ` → late:${latePostId}` : ''),
    tasks_created: 1,
    tasks_completed_ids: taskId ? [taskId] : [],
    duration_ms: startedAt ? (Date.now() - startedAt) : null,
    side_effects: {
      publisher: 'late-direct',
      renderer: 'reel-bank-rotation-v1',
      persona_id: persona.id,
      lang: lang.toLowerCase(),
      product_id: persona.product_id,
      tiktok_late_post_id: latePostId || null,
      tiktok_url: tiktokUrl || null,
      rotation_day: rotationDay,
      rotation_idx: rotationIdx,
    },
  };
  const { data, error } = await sb.from('agent_runs').insert(row).select('id').single();
  if (error) {
    // Non-fatal: the post already published; don't fail the run over bookkeeping.
    console.error('agent_runs insert failed (non-fatal):', error.message);
    return null;
  }
  console.log('Recorded run:', data.id);
  return data.id;
}

// IL campaign reels are manually scheduled in Late.com for this window
// (men-3, women-3, men-4, women-4, women-5 — see scripts/publish-il-campaign-to-late.mjs).
// The daily cron must NOT post on those days or it will duplicate.
// Resumes deterministic rotation from 2026-05-28 onward.
const MANUAL_SKIP_FROM = Date.UTC(2026, 4, 23); // 2026-05-23
const MANUAL_SKIP_TO   = Date.UTC(2026, 4, 27); // 2026-05-27

function todayInManualWindow() {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return utcMidnight >= MANUAL_SKIP_FROM && utcMidnight <= MANUAL_SKIP_TO;
}

async function main() {
  const startedAt = Date.now();
  console.log('=== DUBIS TikTok Daily (reel-bank rotation) ===', new Date().toISOString());

  if (todayInManualWindow() && !process.env.FORCE_PERSONA) {
    console.log('Today falls inside the manual IL-campaign window (2026-05-23 → 2026-05-27).');
    console.log('Reels for this window were scheduled in Late.com via publish-il-campaign-to-late.mjs.');
    console.log('Skipping daily rotation to avoid duplicate posts. (Pass FORCE_PERSONA via workflow_dispatch to override.)');
    return;
  }

  const available = await buildAvailableBank();
  console.log(`Bank probe: ${available.length}/${BANK.length} personas populated → ${available.map(s => s.persona.id).join(', ') || '(none)'}`);
  if (!available.length) throw new Error('No reel available in bank. Run batch-he-reels.mjs first.');

  const { persona, lang, day, idx, pos, url: videoUrl } = pickReelForToday(available);
  console.log(`Day ${day} → rotation slot ${pos < 0 ? 'forced' : `${pos}/${available.length}`} → persona=${persona.id} lang=${lang} (bank idx ${idx})`);

  const caption = buildCaption(persona, lang);
  console.log('Caption preview:', caption.slice(0, 120));
  const late = await publishToLate({ videoUrl, caption, persona, lang });
  const latePostId = extractLatePostId(late);
  // Best-effort: wait for TikTok to finalize so we can store the real post URL now.
  // If it isn't ready within ~75s, the Boss report's backfillTiktokUrls fills it later.
  let tiktokUrl = null;
  if (latePostId) { tiktokUrl = await resolveTiktokUrl(latePostId); console.log('TikTok URL:', tiktokUrl || '(pending finalize — Boss will backfill)'); }
  const taskId = await recordTask({ persona, lang, videoUrl, caption, lateResponse: late, rotationDay: day, rotationIdx: idx, tiktokUrl });
  await recordRun({ persona, lang, taskId, latePostId, rotationDay: day, rotationIdx: idx, startedAt, tiktokUrl });
  console.log('=== DONE ===');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
