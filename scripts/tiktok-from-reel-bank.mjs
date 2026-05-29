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

function pickReelForToday() {
  const now = new Date();
  // Day-of-year in UTC — TikTok cron fires at 15:00 UTC = 18:00 IL (IDT)
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day   = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
  let idx     = day % BANK_SIZE;

  // Manual override via workflow_dispatch inputs (forwarded as env vars by the workflow)
  const fPersona = (process.env.FORCE_PERSONA || '').trim();
  const fLang    = (process.env.FORCE_LANG    || '').trim().toUpperCase();
  if (fPersona) {
    const p = BANK.findIndex(b => b.id === fPersona);
    if (p < 0) throw new Error(`FORCE_PERSONA "${fPersona}" not in bank`);
    const l = LANGS.indexOf(fLang || LANGS[idx % 2]);
    if (l < 0) throw new Error(`FORCE_LANG "${fLang}" not HE or EN`);
    idx = p * 2 + l;
    console.log(`Override: forced persona=${fPersona} lang=${LANGS[l]} → idx=${idx}`);
  }

  const persona = BANK[Math.floor(idx / 2)];
  const lang    = LANGS[idx % 2];
  return { persona, lang, day, idx };
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
  console.log('=== DUBIS TikTok Daily (reel-bank rotation) ===', new Date().toISOString());

  if (todayInManualWindow() && !process.env.FORCE_PERSONA) {
    console.log('Today falls inside the manual IL-campaign window (2026-05-23 → 2026-05-27).');
    console.log('Reels for this window were scheduled in Late.com via publish-il-campaign-to-late.mjs.');
    console.log('Skipping daily rotation to avoid duplicate posts. (Pass FORCE_PERSONA via workflow_dispatch to override.)');
    return;
  }

  const { persona, lang, day, idx } = pickReelForToday();
  console.log(`Day ${day}, idx ${idx}/${BANK_SIZE} → persona=${persona.id} lang=${lang}`);

  const videoUrl = bankUrl(persona, lang);
  const exists = await checkReelExists(videoUrl);
  if (!exists) {
    console.error(`✗ Reel not in bank yet: ${videoUrl}`);
    console.error('  The batch-he-reels.mjs run might still be in progress, or this persona failed.');
    console.error('  Falling back: try the immediately-next index, walking forward up to BANK_SIZE times.');
    for (let bump = 1; bump < BANK_SIZE; bump++) {
      const altIdx = (idx + bump) % BANK_SIZE;
      const altPersona = BANK[Math.floor(altIdx / 2)];
      const altLang    = LANGS[altIdx % 2];
      const altUrl     = bankUrl(altPersona, altLang);
      if (await checkReelExists(altUrl)) {
        console.log(`Fallback hit at idx=${altIdx} (${altPersona.id} / ${altLang})`);
        const caption = buildCaption(altPersona, altLang);
        const late = await publishToLate({ videoUrl: altUrl, caption, persona: altPersona, lang: altLang });
        await recordTask({ persona: altPersona, lang: altLang, videoUrl: altUrl, caption, lateResponse: late, rotationDay: day, rotationIdx: altIdx });
        return;
      }
    }
    throw new Error('No reel available in bank. Run batch-he-reels.mjs first.');
  }

  const caption = buildCaption(persona, lang);
  console.log('Caption preview:', caption.slice(0, 120));
  const late = await publishToLate({ videoUrl, caption, persona, lang });
  await recordTask({ persona, lang, videoUrl, caption, lateResponse: late, rotationDay: day, rotationIdx: idx });
  console.log('=== DONE ===');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
