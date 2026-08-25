#!/usr/bin/env node
// generate-reel-autonomous.mjs — HEADLESS reel generation on HIGGSFIELD, direct REST.
//
// ─── Why REST and not the CLI (2026-08-21) ───────────────────────────────────
//   oren: "רוצה דרך היגספילד אבל שתמצא דרך שזה יהיה אוטמטי בלעדי".
//   8 CI runs proved the `higgsfield` CLI binary cannot make requests from
//   GitHub runners ("no response received") while plain fetch to the SAME hosts
//   works — including token refresh AND every API call. Schema was farmed from
//   FastAPI 422s + /agents/models (probe runs 32470823556, 32471381971):
//     auth    POST fnf-device-auth.higgsfield.ai/refresh {refresh_token}
//             → {access_token, refresh_token}   (single-use — rotates!)
//     select  POST /agents/workspaces/select {workspace_id}      → 200
//     models  GET  /agents/models          → full JSON schema per job_set_type
//     upload  POST /agents/uploads?type=image → {id, upload_url} (presigned PUT)
//     cost    POST /agents/jobs/cost {job_set_type, params}      → {credits}
//             veo3_1 @ 9:16/8s/high = 22 credits (verified from the runner)
//     create  POST /agents/jobs {job_set_type, params}
//     veo3_1 params: prompt (req) · aspect_ratio · duration · quality · model ·
//             input_image: {id, type:'media_input'}   ← the WARDROBE-LOCK hook
//
// ─── Rotation contract ───────────────────────────────────────────────────────
//   The refresh token is SINGLE-USE. This script refreshes once at start,
//   rewrites CREDS_PATH, and prints the file between ===HF_CREDENTIALS===
//   markers at exit; the workflow persists it back to the GitHub secret
//   (if: always()). Running `hf auth login` on a laptop creates an independent
//   chain and does NOT break this one.
//
// ─── Chain ───────────────────────────────────────────────────────────────────
//   pick (never-had-a-reel first) → script (Gemini text, slogan fallback) →
//   hero (nano_banana_flash + product mockup reference = WARDROBE LOCK) →
//   video (veo3_1 image-to-video, native speech) → compose (ffmpeg optional) →
//   publish to video-assets/_pilot/product-{pid}-FINAL-EN.mp4 (the exact path
//   the daily TikTok publisher rotates over) → agent_runs row.
//
// Env: HIGGSFIELD_CREDENTIALS_PATH, HIGGSFIELD_WORKSPACE_ID, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (script text only), FFMPEG

import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
const FFMPEG       = process.env.FFMPEG || 'ffmpeg';
const CREDS_PATH   = process.env.HIGGSFIELD_CREDENTIALS_PATH
  || path.join(os.homedir(), '.config', 'higgsfield', 'credentials.json');
const WORKSPACE_ID = process.env.HIGGSFIELD_WORKSPACE_ID || '52a7bfe8-e226-42cf-856a-6d5ccbba0f7f';
const API  = 'https://fnf.higgsfield.ai';
const AUTH = 'https://fnf-device-auth.higgsfield.ai';

const args = process.argv.slice(2);
const argVal = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const DRY_RUN   = args.includes('--dry-run');
const FORCE_PID = argVal('product') ? Number(argVal('product')) : null;
const COUNT     = Number(argVal('count') || 1);

if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const sb  = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dubis-reel-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const NON_APPAREL = new Set(['mug', 'bottle', 'tote']);

// ── The DUBIS voice, inlined (generated copy of C-core/voice-dna.md) ─────────
const VOICE_RULES = `You write for DUBIS, a D2C apparel brand for real bodies, men and women 38-52.
Tagline: "Built for the body you actually live in."

STRUCTURE — the 3-beat formula, mandatory:
  1. Cynical hook: name the absurd thing the world demands.
  2. Agitation: the real, tired human reaction to it.
  3. DUBIS drop: the garment as a quiet declaration, never a discount.

VOICE: a sharp friend over a beer, not an ad. Dry, warm, a little sardonic.
Humour comes from STRENGTH, never from self-deprecation about the body.

BANNED: "don't miss this sale", "20% off", "buy now", "perfect", "stunning",
"lifestyle", "plus-size", any fat-joke framing, any apology for the reader's body.

CTA is identity, not transaction. READ-ALOUD TEST: sounds like a TV ad → delete.`;

// ── auth ─────────────────────────────────────────────────────────────────────
let TOKEN = '';

async function refreshAuth() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  if (!creds.refresh_token) throw new Error('credentials file has no refresh_token');
  const r = await fetch(`${AUTH}/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`auth refresh ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  TOKEN = j.access_token;
  fs.writeFileSync(CREDS_PATH, JSON.stringify({
    access_token: j.access_token, refresh_token: j.refresh_token || creds.refresh_token,
  }));
  log('auth: refreshed (chain rotated + written back)');
}

const TRANSIENT = /timeout|timed out|EOF|reset|temporarily|502|503|504|fetch failed|network/i;

async function api(method, p, body, label, { retries = 2 } = {}) {
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${API}${p}`, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (r.status === 401 && attempt < retries) { log(`  ${label}: 401 — re-refreshing token`); await refreshAuth(); continue; }
      if (!r.ok) {
        lastErr = `${label} HTTP ${r.status}: ${text.slice(0, 300)}`;
        if (r.status >= 500 && attempt < retries) { await sleep(5000 * (attempt + 1)); continue; }
        throw new Error(lastErr);
      }
      try { return JSON.parse(text); } catch { return text; }
    } catch (e) {
      lastErr = e.message;
      if (!TRANSIENT.test(lastErr) || attempt === retries) throw new Error(`${label}: ${lastErr.slice(0, 300)}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error(`${label}: ${lastErr.slice(0, 300)}`);
}

// ── media upload (presigned S3 PUT) ─────────────────────────────────────────
async function uploadImage(filePath) {
  const meta = await api('POST', '/agents/uploads?type=image', {}, 'upload-init');
  if (!meta.id || !meta.upload_url) throw new Error(`upload-init: unexpected shape ${JSON.stringify(meta).slice(0, 150)}`);
  let buf = fs.readFileSync(filePath);
  // Run 32471925271 died here with PUT 403: the presigned URL's SIGNED headers
  // include content-type, and the object key is always .png — the signature is
  // for image/png regardless of what we hold. Convert real JPEGs to PNG when
  // ffmpeg is around; otherwise send the bytes under the signed type (decoders
  // sniff magic bytes, but converted-PNG is the honest path).
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
  if (!isPng && ffmpegAvailable()) {
    const pngPath = filePath.replace(/\.[a-z]+$/i, '') + '.conv.png';
    ff(['-y', '-i', filePath, pngPath], 'jpg->png');
    buf = fs.readFileSync(pngPath);
  }
  const put = await fetch(meta.upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: buf });
  if (!put.ok) throw new Error(`upload PUT ${put.status}: ${(await put.text().catch(() => '')).slice(0, 150)}`);
  return meta.id;
}

// ── job create + poll ────────────────────────────────────────────────────────
function findMediaUrl(v, out = []) {
  if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.(mp4|mov|webm|png|jpe?g|webp)(\?|$)/i.test(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach(x => findMediaUrl(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => findMediaUrl(x, out));
  return out;
}
function findStatuses(v, out = []) {
  if (v && typeof v === 'object') {
    if (typeof v.status === 'string') out.push(v.status);
    Object.values(v).forEach(x => { if (x && typeof x === 'object') findStatuses(x, out); });
  }
  return out;
}

// Poll contract is the one thing the probes could not fully pin down, so try
// the plausible shapes in order and remember the first that answers.
let POLL_STYLE = null;
async function pollJob(created, label, budgetMs) {
  const ids = [];
  (function collect(v) {
    if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) ids.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && /^[0-9a-f-]{36}$/.test(v.id)) ids.push(v.id);
      Object.values(v).forEach(collect);
    }
  })(created);
  const primary = ids[0];
  if (!primary) throw new Error(`${label}: no job id in create response: ${JSON.stringify(created).slice(0, 200)}`);

  const candidates = [
    { name: 'get-by-id',   fn: () => api('GET', `/agents/jobs/${primary}`, undefined, `${label}-poll`, { retries: 0 }) },
    { name: 'post-ids',    fn: () => api('POST', '/agents/jobs/poll', { ids }, `${label}-poll`, { retries: 0 }) },
    { name: 'post-jobset', fn: () => api('POST', '/agents/jobs/poll', { job_set_ids: [primary] }, `${label}-poll`, { retries: 0 }) },
    { name: 'get-query',   fn: () => api('GET', `/agents/jobs/poll?ids=${ids.join(',')}`, undefined, `${label}-poll`, { retries: 0 }) },
  ];

  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    let state = null;
    if (POLL_STYLE) {
      try { state = await candidates.find(c => c.name === POLL_STYLE).fn(); } catch { state = null; }
    } else {
      for (const c of candidates) {
        try { state = await c.fn(); POLL_STYLE = c.name; log(`  poll style: ${c.name}`); break; }
        catch { /* try next */ }
      }
      if (!POLL_STYLE) throw new Error(`${label}: no poll endpoint variant answered`);
    }
    if (state) {
      const statuses = findStatuses(state);
      const urls = findMediaUrl(state);
      const failed = statuses.find(x => /fail|error|nsfw|reject|cancel/i.test(x));
      if (failed) throw new Error(`${label}: job ${failed}: ${JSON.stringify(state).slice(0, 250)}`);
      const done = statuses.length && statuses.every(x => /complete|succeed|done|finished/i.test(x));
      if (urls.length && (done || statuses.length === 0)) return urls[0];
      if (done && !urls.length) throw new Error(`${label}: completed but no media URL: ${JSON.stringify(state).slice(0, 300)}`);
    }
    await sleep(12000);
  }
  throw new Error(`${label}: poll timed out after ${Math.round(budgetMs / 60000)}m`);
}

async function createJob(job_set_type, params, label, budgetMs) {
  const cost = await api('POST', '/agents/jobs/cost', { job_set_type, params }, `${label}-cost`);
  log(`  ${label}: ${cost.credits} credits`);
  const created = await api('POST', '/agents/jobs', { job_set_type, params }, `${label}-create`);
  return pollJob(created, label, budgetMs);
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${String(url).slice(0, 90)}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// ── 1 · pick ────────────────────────────────────────────────────────────────
async function pickTargets(n) {
  const { data: products, error } = await sb
    .from('dubis_products')
    .select('product_id_numeric, slogan, clothing_type, gender, colors, image_url')
    .eq('active', true);
  if (error) throw new Error(`products: ${error.message}`);
  const { data: objects } = await sb.storage.from('video-assets').list('_pilot', { limit: 1000 });
  const bankAge = new Map();
  for (const o of objects || []) {
    const m = /^product-(\d+)-FINAL-EN\.mp4$/.exec(o.name);
    if (m) bankAge.set(Number(m[1]), Date.parse(o.created_at || o.updated_at || 0) || 0);
  }
  if (FORCE_PID) {
    const p = products.find(x => Number(x.product_id_numeric) === FORCE_PID);
    if (!p) throw new Error(`product ${FORCE_PID} not found or not active`);
    return [{ ...p, _age: bankAge.has(FORCE_PID) ? bankAge.get(FORCE_PID) : -1 }];
  }
  return products
    .map(p => ({ ...p, _age: bankAge.has(Number(p.product_id_numeric)) ? bankAge.get(Number(p.product_id_numeric)) : -1 }))
    .sort((a, b) => a._age - b._age)
    .slice(0, n);
}

// ── 2 · script ──────────────────────────────────────────────────────────────
const SCENES = [
  'in a sunlit kitchen mid-morning', 'on a small balcony at golden hour',
  'in a cluttered home office at the end of the day', 'in a doorway with the afternoon light behind them',
  'on a couch with the TV off', 'in a hallway holding car keys',
];

// ── FORMAT ROTATION (2026-08-25, oren: "נראה משעמם וחוזר על עצמו — לא כמו
// שסיכמנו שאתה מגוון") ── the video prompt used to hardcode "They speak
// directly to camera", so EVERY autonomous reel was a talking-head — the exact
// format oren banned as a default on 2026-07-10. Each reel now rotates through
// scene FORMATS; talking-head survives as one option in seven, never the default.
//   speak: 'vo'     → narration is an unseen VOICE-OVER while the person acts
//   speak: 'camera' → the person says the line to camera
//   apparel: true   → only makes sense worn; mugs/bottles/totes draw from the rest
const FORMATS = [
  { key: 'broll',       speak: 'vo',     apparel: false, action: 'goes about the scene naturally, absorbed in a small everyday task, never looking at the camera — candid documentary b-roll' },
  { key: 'mirror',      speak: 'vo',     apparel: true,  action: 'stands at a mirror giving themselves a quick honest once-over, adjusting the garment, ending on a small approving nod' },
  { key: 'unboxing',    speak: 'vo',     apparel: false, action: 'opens a plain cardboard package at a table and lifts the product out, turning it over appreciatively — close framing on hands and product' },
  { key: 'delivery',    speak: 'vo',     apparel: false, action: 'stands at the front door having just received a package, opens it on the spot, breaks into a knowing half-smile' },
  { key: 'cctv',        speak: 'vo',     apparel: false, action: 'is seen from a slightly high static security-camera-style angle, going about the scene unaware of being filmed' },
  { key: 'streetstop',  speak: 'camera', apparel: true,  action: 'pauses mid-walk as if a street interviewer just stopped them, relaxed and amused' },
  { key: 'talkinghead', speak: 'camera', apparel: false, action: 'sits comfortably and talks straight to camera' },
];
function pickFormat(p, idx) {
  const day = Math.floor(Date.now() / 86400000);
  const worn = !NON_APPAREL.has(p.clothing_type);
  const pool = FORMATS.filter(f => worn || !f.apparel);
  return pool[(Number(p.product_id_numeric) + day + idx) % pool.length];
}
function fallbackScript(p) {
  const n = Number(p.product_id_numeric) || 1;
  return {
    age: 38 + (n * 7) % 15,
    person: p.gender === 'women' ? 'woman' : p.gender === 'men' ? 'man' : (n % 2 ? 'woman' : 'man'),
    scene: SCENES[n % SCENES.length],
    narration: `Somewhere along the way this stopped being about looking right. ${String(p.slogan).replace(/\.$/, '')}. That is the whole message.`,
    caption_he: `${p.slogan}\nלשאר המין האנושי 👇`,
    caption_en: `${p.slogan}\nFor the rest of us 👇`,
    _fallback: true,
  };
}
async function writeScript(p) {
  if (!GEMINI_KEY) { log('    (no GEMINI_API_KEY — slogan-derived script)'); return fallbackScript(p); }
  const worn = !NON_APPAREL.has(p.clothing_type);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${VOICE_RULES}

Write ONE 8-second vertical reel for this real DUBIS product.
Product: ${p.clothing_type} · printed slogan (verbatim): "${p.slogan}"
Casting: ${p.gender === 'women' ? 'a woman' : p.gender === 'men' ? 'a man' : 'either'}
Return STRICT JSON: {"age":<38-52>,"person":"man"|"woman","scene":"<ordinary everyday place>","narration":"<ENGLISH, 2 short sentences, MAX 32 words, 3-beat, speakable in 8s>","caption_he":"<rooted Hebrew, not a translation, 2-3 lines>","caption_en":"<original English, 2-3 lines>"}
${worn ? 'The person WEARS the product.' : `The person USES the ${p.clothing_type}.`}` }] }],
        generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150));
    const s = JSON.parse(j.candidates[0].content.parts[0].text);
    for (const k of ['age', 'person', 'scene', 'narration']) if (!s[k]) throw new Error(`missing ${k}`);
    if (String(s.narration).trim().split(/\s+/).length > 34) throw new Error('narration too long for 8s');
    return s;
  } catch (e) { log(`    (script fallback: ${e.message.slice(0, 90)})`); return fallbackScript(p); }
}

// ── 3 · hero (WARDROBE LOCK via nano_banana_flash + mockup reference) ───────
async function makeHero(p, s) {
  if (!p.image_url) throw new Error(`product ${p.product_id_numeric} has no image_url to lock the garment against`);
  const color = (p.colors && p.colors[0]) || 'Black';
  const worn = !NON_APPAREL.has(p.clothing_type);
  const mock = await download(p.image_url, path.join(TMP, `mock-${p.product_id_numeric}.jpg`));
  const mediaId = await uploadImage(mock);
  log(`  mockup uploaded: ${mediaId}`);

  const prompt = worn
    ? `A ${s.age}-year-old ${s.person} with an ordinary, real, non-model body, ${s.scene}. Wearing the EXACT ${color} ${p.clothing_type} shown in the reference image — same colour, same cut, same printed chest design, reproduced faithfully. Do NOT redesign, re-letter or move the print. Do NOT slim the person. The ${p.clothing_type} is the OUTERMOST layer and fully visible from shoulders to waist: no jacket, cardigan or coat over it, nothing held in front of the chest. Front-facing, three-quarter framing, fully and modestly clothed. Vertical 9:16 composition. Soft natural window light, candid documentary portrait, 85mm f/1.8, Kodak Portra 400 grain.`
    : `A ${s.age}-year-old ${s.person} with an ordinary, real body, ${s.scene}, holding and using the EXACT ${color} ${p.clothing_type} from the reference image — same colour, same shape, same printed design reproduced faithfully. Vertical 9:16 composition, natural candid framing, soft window light, Kodak Portra 400 grain.`;

  // Read the image-reference field name from the live schema — never guess.
  const models = await api('GET', '/agents/models', undefined, 'models');
  const nb = models.find(m => m.job_set_type === 'nano_banana_flash') || models.find(m => m.job_set_type === 'nano_banana');
  if (!nb) throw new Error('no nano_banana model in catalog');
  const props = (nb.params && nb.params.properties) || {};
  const params = { prompt };
  if (props.aspect_ratio) params.aspect_ratio = '9:16';
  const imgRef = { id: mediaId, type: 'media_input' };
  if (props.medias) params.medias = [{ role: 'image', data: imgRef }];
  else if (props.media) params.media = [{ role: 'image', data: imgRef }];
  else if (props.input_images) params.input_images = [imgRef];
  else if (props.input_image) params.input_image = imgRef;
  else throw new Error(`no image-reference field on ${nb.job_set_type}: ${Object.keys(props).join(',')}`);

  const url = await createJob(nb.job_set_type, params, 'hero', 8 * 60000);
  return download(url, path.join(TMP, `hero-${p.product_id_numeric}.png`));
}

// ── 4 · video (veo3_1 image-to-video, native speech) ────────────────────────
async function makeVideo(p, s, heroPath) {
  const color = (p.colors && p.colors[0]) || 'Black';
  const worn = !NON_APPAREL.has(p.clothing_type);
  const heroId = await uploadImage(heroPath);
  log(`  hero uploaded: ${heroId}`);
  const prompt = `Cinematic intimate documentary 9:16 vertical portrait. The person from the start frame, unchanged: a ${s.age}-year-old ${s.person}, ${s.scene}. ${
    worn
      ? `Wearing a ${color} ${p.clothing_type}. The garment MUST remain the same ${color} ${p.clothing_type} for the entire clip — it must not morph and the printed chest design must not change or re-letter.`
      : `Holding the ${color} ${p.clothing_type}. The object must not morph and its printed design must not change.`
  } ${(() => {
    const fmt = s._format || FORMATS[FORMATS.length - 1];
    return fmt.speak === 'camera'
      ? `They ${fmt.action}. They speak directly to camera in a warm, dry, slightly sardonic voice at a relaxed conversational pace. Spoken words: "${s.narration}"`
      : `They ${fmt.action}. They do NOT address or look at the camera. An unseen narrator with a warm, dry, slightly sardonic voice speaks over the scene at a relaxed pace, as a voice-over: "${s.narration}"`;
  })()} ${worn ? 'The printed chest design stays clearly readable for most of the clip.' : 'The printed design on the product stays clearly readable.'} Subtle natural movement, a small knowing half-smile at the end. Soft golden afternoon light, Kodak Portra grain. No on-screen text, no captions, no subtitles.`;

  const params = {
    prompt, aspect_ratio: '9:16', duration: 8, quality: 'high',
    input_image: { id: heroId, type: 'media_input' },
  };
  const url = await createJob('veo3_1', params, 'veo3_1', 25 * 60000);
  return download(url, path.join(TMP, `veo-${p.product_id_numeric}.mp4`));
}

// ── 5 · compose (ffmpeg optional — never lose a paid clip to a tooling gap) ──
function ffmpegAvailable() {
  try { return spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).status === 0; }
  catch { return false; }
}
function ff(fargs, label) {
  const r = spawnSync(FFMPEG, fargs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr || '').split('\n').slice(-6).join('\n')}`);
}
async function compose(p, veoPath) {
  if (!ffmpegAvailable()) { log('    (no ffmpeg — publishing the raw clip)'); return veoPath; }
  const out = path.join(TMP, `final-${p.product_id_numeric}.mp4`);
  const scaled = path.join(TMP, `scaled-${p.product_id_numeric}.mp4`);
  const beat = path.join(TMP, `beat-${p.product_id_numeric}.mp4`);
  ff(['-y', '-i', veoPath, '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', scaled], 'scale');
  let beatSrc = null;
  try { if (p.image_url) beatSrc = await download(p.image_url, path.join(TMP, `beatimg-${p.product_id_numeric}.jpg`)); }
  catch { /* no beat */ }
  if (!beatSrc) { ff(['-y', '-i', scaled, '-c', 'copy', out], 'copy'); return out; }
  ff(['-y', '-loop', '1', '-t', '2.2', '-i', beatSrc,
    '-f', 'lavfi', '-t', '2.2', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xF5F0E8,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '24',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', beat], 'beat');
  const list = path.join(TMP, `concat-${p.product_id_numeric}.txt`);
  fs.writeFileSync(list, `file '${scaled.replace(/\\/g, '/')}'\nfile '${beat.replace(/\\/g, '/')}'\n`);
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', out], 'concat');
  const mb = fs.statSync(out).size / 1048576;
  if (mb > 25) throw new Error(`final reel ${mb.toFixed(1)}MB exceeds the 25MB cap`);
  return out;
}

// ── 6 · publish ─────────────────────────────────────────────────────────────
async function publish(p, finalPath, s) {
  const pid = p.product_id_numeric;
  const buf = fs.readFileSync(finalPath);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { data: old } = await sb.storage.from('video-assets').download(`_pilot/product-${pid}-FINAL-EN.mp4`);
  if (old) {
    await sb.storage.from('video-assets')
      .upload(`archive/product-${pid}-${stamp}.mp4`, await old.arrayBuffer(), { contentType: 'video/mp4', upsert: true });
    log('    archived previous reel');
  }
  for (const lang of ['EN', 'HE']) {
    const { error } = await sb.storage.from('video-assets')
      .upload(`_pilot/product-${pid}-FINAL-${lang}.mp4`, buf, { contentType: 'video/mp4', upsert: true });
    if (error) throw new Error(`upload ${lang}: ${error.message}`);
  }
  const url = `${SUPABASE_URL}/storage/v1/object/public/video-assets/_pilot/product-${pid}-FINAL-EN.mp4`;
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`published reel not reachable: HTTP ${head.status}`);
  await sb.from('agent_runs').insert({
    agent_id: 'video', run_date: new Date().toISOString().slice(0, 10), status: 'completed',
    summary: `autonomous reel for product ${pid} — "${String(p.slogan).slice(0, 40)}" (Higgsfield REST veo3_1, headless)`,
    tasks_created: 0,
    side_effects: { product_id: pid, video_url: url, narration: s.narration, caption_he: s.caption_he,
                    caption_en: s.caption_en, engine: 'higgsfield-rest:veo3_1', script_fallback: !!s._fallback, bytes: buf.length },
  });
  return url;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  await refreshAuth();
  await api('POST', '/agents/workspaces/select', { workspace_id: WORKSPACE_ID }, 'workspace-select');
  const bal = await api('GET', '/agents/balance', undefined, 'balance');
  log(`higgsfield: ${bal.email} — ${bal.subscription_plan_type}, ${bal.credits} credits`);

  const targets = await pickTargets(COUNT);
  log(`targets: ${targets.map(t => `#${t.product_id_numeric}${t._age === -1 ? ' (no reel yet)' : ''}`).join(', ')}`);

  const results = [];
  let fmtIdx = 0;
  for (const p of targets) {
    const pid = p.product_id_numeric;
    try {
      log(`▶ #${pid} "${String(p.slogan).slice(0, 46)}" (${p.clothing_type})`);
      const s = await writeScript(p);
      s._format = pickFormat(p, fmtIdx++);
      log(`  format: ${s._format.key} (${s._format.speak})`);
      log(`  ${s.person} ${s.age}, ${s.scene}`);
      log(`  says: "${s.narration}"`);
      if (DRY_RUN) { results.push({ pid, ok: true, dry: true, script: s }); continue; }
      const hero = await makeHero(p, s);        log('  hero ok (wardrobe-locked)');
      const veo  = await makeVideo(p, s, hero); log('  veo3_1 ok');
      const fin  = await compose(p, veo);       log(`  composed ${(fs.statSync(fin).size / 1048576).toFixed(1)}MB`);
      const url  = await publish(p, fin, s);
      log(`✅ #${pid} → ${url}`);
      results.push({ pid, ok: true, url, script: s });
    } catch (e) {
      log(`❌ #${pid}: ${e.message}`);
      results.push({ pid, ok: false, error: e.message });
    }
  }

  console.log('===REEL_MANIFEST===');
  console.log(JSON.stringify({ generated: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 2));
  console.log('===END_REEL_MANIFEST===');
  try {
    console.log('===HF_CREDENTIALS===');
    console.log(fs.readFileSync(CREDS_PATH, 'utf8').trim());
    console.log('===END_HF_CREDENTIALS===');
  } catch (e) { log(`⚠ could not read back credentials: ${e.message}`); }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  if (results.every(r => !r.ok)) process.exit(1);
})();
