#!/usr/bin/env node
// tiktok-from-reel-bank.mjs — daily TikTok publisher from the bilingual persona reel bank.
//
// Locked 2026-05-23 per oren ("boring slideshows + bad music must die").
// Replaces dubis-website/video/scripts/render-and-publish.js (3-slide ffmpeg + Kevin MacLeod).
//
// Pipeline:
//   1. Pull the reel of the day from Supabase Storage `video-assets/_pilot/{persona}-FINAL-{HE,EN}.mp4`
//      using a deterministic rotation: index = dayOfYear mod BANK_SIZE.
//   2. Build a per-language caption (slogan + product URL + brand line).
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
  { id: 'men-1',   gender: 'men',   product_id: 3,  slogan: 'Napping is my cardio' },
  { id: 'men-2',   gender: 'men',   product_id: 6,  slogan: 'Not a model. Never wanted to be.' },
  { id: 'men-3',   gender: 'men',   product_id: 15, slogan: 'Low maintenance, high value.' },
  { id: 'men-4',   gender: 'men',   product_id: 9,  slogan: 'Certified overthinker.' },
  { id: 'men-5',   gender: 'men',   product_id: 8,  slogan: 'Born to nap, forced to work.' },
  { id: 'women-1', gender: 'women', product_id: 11, slogan: 'She believed she could, so she took a nap.' },
  { id: 'women-2', gender: 'women', product_id: 13, slogan: 'Zero Motivation Club.' },
  { id: 'women-3', gender: 'women', product_id: 16, slogan: 'Minimal existence.' },
  { id: 'women-4', gender: 'women', product_id: 17, slogan: 'Experienced in exhaustion.' },
  { id: 'women-5', gender: 'women', product_id: 31, slogan: "You're prettier when you're comfortable." },
];
const LANGS = ['HE', 'EN'];
const BANK_SIZE = BANK.length * LANGS.length; // 20

function dayOfYearUTC() {
  const now = new Date();
  // Day-of-year in UTC — TikTok cron fires at 15:00 UTC = 18:00 IL (IDT)
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
}

// Probe every one of the 20 bank slots and return only the reels that actually
// exist in Supabase Storage, in stable bank order.
//
// 2026-06-01 (oren complaint "בטיק טוק אותו פוסט עלה פעמיים" — the same post went
// up twice): the bank has 20 slots (10 personas × 2 langs) but only ~8 are
// populated. The old rotation did `idx = day % 20` then walked FORWARD to the
// next existing reel when the slot was empty — so most days collapsed onto the
// earliest populated slot (men-1/HE), publishing it again and again. Rotating
// over ONLY the populated reels gives each one an equal, non-repeating turn.
async function buildAvailableBank() {
  const slots = [];
  for (let i = 0; i < BANK_SIZE; i++) {
    const persona = BANK[Math.floor(i / 2)];
    const lang    = LANGS[i % 2];
    slots.push({ persona, lang, idx: i, url: bankUrl(persona, lang) });
  }
  const checks = await Promise.all(slots.map(s => checkReelExists(s.url)));
  let avail = slots.filter((_, i) => checks[i]);
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

  // Manual override via workflow_dispatch inputs (forwarded as env vars by the workflow)
  const fPersona = (process.env.FORCE_PERSONA || '').trim();
  const fLang    = (process.env.FORCE_LANG    || '').trim().toUpperCase();
  if (fPersona) {
    if (fLang && !LANGS.includes(fLang)) throw new Error(`FORCE_LANG "${fLang}" not HE or EN`);
    const match = available.find(s => s.persona.id === fPersona && (!fLang || s.lang === fLang));
    if (!match) throw new Error(`FORCE_PERSONA "${fPersona}"${fLang ? '/' + fLang : ''} not in available bank`);
    console.log(`Override: forced persona=${fPersona} lang=${match.lang} → bank idx=${match.idx}`);
    return { persona: match.persona, lang: match.lang, day, idx: match.idx, pos: -1 };
  }

  // Rotate over ONLY the populated reels — consecutive days always advance to a
  // different reel (no repeats until the whole available set is exhausted).
  const pos     = day % available.length;
  const chosen  = available[pos];
  return { persona: chosen.persona, lang: chosen.lang, day, idx: chosen.idx, pos };
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
  if (lang === 'HE') {
    return `${persona.slogan}\n\nDUBIS — בשביל כולנו.\n\n👉 ${url}\n\n#DUBIS #גוףאמיתי #קפוצון #פוראופנה`;
  }
  return `${persona.slogan}\n\nDUBIS — for the rest of us.\n\n👉 ${url}\n\n#DUBIS #realbodies #hoodieseason #fortherestofus`;
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

async function recordTask({ persona, lang, videoUrl, caption, lateResponse, rotationDay, rotationIdx }) {
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
      bank_path: `video-assets/_pilot/${persona.id}-FINAL-${lang}.mp4`,
      caption: caption,
      publisher: 'late-direct',
      renderer: 'reel-bank-rotation-v1',
      rotation_day: rotationDay,
      rotation_idx: rotationIdx,
      late_response: lateResponse,
      tiktok_late_post_id: latePostId,
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
async function recordRun({ persona, lang, taskId, latePostId, rotationDay, rotationIdx, startedAt }) {
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
  console.log(`Bank probe: ${available.length}/${BANK_SIZE} reels populated → ${available.map(s => `${s.persona.id}/${s.lang}`).join(', ') || '(none)'}`);
  if (!available.length) throw new Error('No reel available in bank. Run batch-he-reels.mjs first.');

  const { persona, lang, day, idx, pos } = pickReelForToday(available);
  console.log(`Day ${day} → rotation slot ${pos < 0 ? 'forced' : `${pos}/${available.length}`} → persona=${persona.id} lang=${lang} (bank idx ${idx})`);

  const videoUrl = bankUrl(persona, lang);
  const caption = buildCaption(persona, lang);
  console.log('Caption preview:', caption.slice(0, 120));
  const late = await publishToLate({ videoUrl, caption, persona, lang });
  const taskId = await recordTask({ persona, lang, videoUrl, caption, lateResponse: late, rotationDay: day, rotationIdx: idx });
  await recordRun({ persona, lang, taskId, latePostId: extractLatePostId(late), rotationDay: day, rotationIdx: idx, startedAt });
  console.log('=== DONE ===');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
