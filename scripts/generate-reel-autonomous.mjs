#!/usr/bin/env node
// generate-reel-autonomous.mjs — HEADLESS reel generation. No Higgsfield, no oren's machine.
//
// ─── Why this exists (oren, 2026-08-19) ──────────────────────────────────────
//   "אני רוצה שהרילים ירוצו לבד ללא תלות בי כולל יצירת תוכן חדש"
//
//   The old pipeline (scripts/_build-new-reels.mjs) shells out to
//   C:/Users/tehar/bin/hf.exe — the Higgsfield CLI, whose session expires in
//   minutes and only exists on oren's Windows box. That is why the reel bank
//   froze on 2026-07-14 and every published reel for three weeks was a
//   re-publish of a July asset (see M-memory/troubleshooting.md
//   §"The silence bug" for how that stayed invisible).
//
//   The unlock, verified 2026-08-19: Veo 3.1 is reachable from the plain
//   GEMINI_API_KEY we already hold, via predictLongRunning — 8s, 720x1280,
//   h264 + AAC with NATIVE SPOKEN AUDIO, ~60s per generation. Combined with
//   gemini-3-pro-image for the garment-locked hero frame, the whole chain runs
//   on ubuntu-latest with nothing but env vars. See
//   .github/workflows/dubis-reels-autonomous.yml.
//
// ─── Contract (do not break) ─────────────────────────────────────────────────
//   Output path  video-assets/_pilot/product-{pid}-FINAL-EN.mp4  (+ -HE copy)
//   That is the exact path scripts/tiktok-from-reel-bank.mjs rotates over, so a
//   new reel is picked up by the existing daily publisher with ZERO consumer
//   changes. The previous asset is archived to video-assets/archive/ first —
//   never destroy a reel we might want to compare against.
//
//   WARDROBE LOCK: the person must wear the EXACT active product, front print
//   intact. The product's real catalog mockup is passed to the image model as a
//   reference and the prompt forbids morphing. Non-apparel products (mug /
//   bottle / tote) get a "person using the object" treatment instead of try-on.
//
// ─── Usage ───────────────────────────────────────────────────────────────────
//   node scripts/generate-reel-autonomous.mjs                 # auto-pick 1
//   node scripts/generate-reel-autonomous.mjs --product=52
//   node scripts/generate-reel-autonomous.mjs --count=3
//   node scripts/generate-reel-autonomous.mjs --dry-run       # plan only, no spend
//
// Env: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      FFMPEG (optional path override, default "ffmpeg")

import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const args = process.argv.slice(2);
const argVal = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const DRY_RUN = args.includes('--dry-run');
const FORCE_PID = argVal('product') ? Number(argVal('product')) : null;
const COUNT = Number(argVal('count') || 1);

if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');
if (!SERVICE_ROLE && !DRY_RUN) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE || 'anon', { auth: { persistSession: false } });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dubis-reel-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const GEN = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-3-pro-image';
const VIDEO_MODEL = 'veo-3.1-generate-preview';   // full model — the fast one rejects audio

// Products that are not worn. A try-on prompt on a mug produces nonsense.
const NON_APPAREL = new Set(['mug', 'bottle', 'tote']);

// ── The DUBIS voice, inlined ────────────────────────────────────────────────
// The cloud cannot read C-core/voice-dna.md (repo files are invisible to
// non-repo runtimes). This block is a GENERATED COPY of the brand rules and must
// be regenerated whenever C-core/voice-dna.md or company-glossary.md changes —
// same contract as the copy-qa string in agents/index.ts.
const VOICE_RULES = `You write for DUBIS, a D2C apparel brand for real bodies, men and women 38-52.
Tagline: "Built for the body you actually live in."

STRUCTURE — the 3-beat formula, mandatory:
  1. Cynical hook: name the absurd thing the world demands.
  2. Agitation: the real, tired human reaction to it.
  3. DUBIS drop: the garment as a quiet declaration, never a discount.

VOICE: a sharp friend over a beer, not an ad. Dry, warm, a little sardonic.
Humour comes from STRENGTH, never from self-deprecation about the body.

BANNED, never write these or anything like them:
  "don't miss this sale", "20% off", "buy now", "perfect", "stunning",
  "lifestyle", "plus-size", any fat-joke or "big but cute" framing,
  any apology for the reader's body.

CTA is identity, not transaction: belonging ("For the rest of us"), never "shop now".

READ-ALOUD TEST: if it sounds like a TV commercial, delete it and start again.`;

// ── small helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function gJSON(url, body, label) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${label} ${r.status}: ${JSON.stringify(j.error || j).slice(0, 400)}`);
  return j;
}

function ff(fargs, label) {
  const r = spawnSync(FFMPEG, fargs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr || r.stdout || '').split('\n').slice(-8).join('\n')}`);
  }
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url.slice(0, 90)}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

// ── 1 · pick the target product ──────────────────────────────────────────────
// Missing-from-bank first (a product with NO reel is a hole, not a rotation),
// then oldest reel. This is why the bank grows instead of cycling the same
// July assets forever.
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
    return [p];
  }

  return products
    .map(p => ({ ...p, _age: bankAge.has(Number(p.product_id_numeric)) ? bankAge.get(Number(p.product_id_numeric)) : -1 }))
    .sort((a, b) => a._age - b._age)     // -1 (missing) first, then oldest timestamp
    .slice(0, n);
}

// ── 2 · write the script (brand voice, grounded in the real slogan) ──────────
async function writeScript(p) {
  const worn = !NON_APPAREL.has(p.clothing_type);
  const prompt = `${VOICE_RULES}

Write ONE 8-second vertical reel for this real DUBIS product.

Product: ${p.clothing_type}
Printed slogan (verbatim, on the garment): "${p.slogan}"
Audience gender for casting: ${p.gender === 'women' ? 'a woman' : p.gender === 'men' ? 'a man' : 'either a man or a woman'}

Return STRICT JSON, no markdown fence, with exactly these keys:
{
  "age": <integer 38-52>,
  "person": "man" | "woman",
  "scene": "<short physical setting, an ordinary Israeli or American everyday place, e.g. 'a sunlit kitchen mid-morning' — no studio, no runway>",
  "narration": "<what they say to camera, ENGLISH, 2 short sentences, MUST be speakable in under 8 seconds (max 32 words), follows the 3-beat formula, ends on the DUBIS drop>",
  "caption_he": "<Hebrew caption for the post, rooted-local Israeli — NOT a translation of the narration. 2-3 short lines. Anchors like נתיבי איילון / הקפה השני / שישי are welcome.>",
  "caption_en": "<English caption, original, 2-3 short lines>"
}

The narration must sound spoken, not written. No hashtags inside narration.
${worn ? 'The person is WEARING the product.' : `The person is USING the ${p.clothing_type}, holding it naturally in the scene.`}`;

  const j = await gJSON(
    `${GEN}/models/${TEXT_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, responseMimeType: 'application/json' } },
    'script',
  );
  const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let s;
  try { s = JSON.parse(raw); } catch { throw new Error(`script not JSON: ${raw.slice(0, 200)}`); }
  for (const k of ['age', 'person', 'scene', 'narration', 'caption_he', 'caption_en']) {
    if (!s[k]) throw new Error(`script missing "${k}"`);
  }
  // 8s of natural speech is ~30 words. Longer and Veo compresses it into gibberish
  // (the failure mode that killed the Hebrew narration attempts in June).
  const words = String(s.narration).trim().split(/\s+/).length;
  if (words > 34) throw new Error(`narration too long for 8s: ${words} words`);
  return s;
}

// ── 3 · hero frame with the REAL garment (WARDROBE LOCK) ────────────────────
async function makeHero(p, s) {
  const worn = !NON_APPAREL.has(p.clothing_type);
  const color = (p.colors && p.colors[0]) || 'Black';
  const mockUrl = p.image_url;
  if (!mockUrl) throw new Error(`product ${p.product_id_numeric} has no image_url to lock the garment against`);

  const mockPath = await download(mockUrl, path.join(TMP, `mock-${p.product_id_numeric}.jpg`));
  const b64 = fs.readFileSync(mockPath).toString('base64');
  const mime = mockUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const instruction = worn
    ? `Photorealistic vertical 9:16 portrait. A ${s.age}-year-old ${s.person} with an ordinary, real, non-model body, ${s.scene}.
They are wearing the EXACT ${color} ${p.clothing_type} shown in the reference image — same colour, same cut, and the same printed chest design, reproduced faithfully. Do NOT redesign, restyle, re-letter or move the print. Do NOT slim the person.
The ${p.clothing_type} must be the OUTERMOST layer and fully visible from shoulders to waist: no jacket, cardigan, coat, scarf, apron or open shirt over it, and nothing held in front of the chest. The person is standing or seated upright with the chest unobstructed and facing camera.
Front-facing, three-quarter framing from mid-thigh up, fully and modestly clothed. Soft natural window light, late afternoon, natural skin texture and real pores, candid documentary portrait, 85mm f/1.8, Kodak Portra 400 grain.`
    : `Photorealistic vertical 9:16 portrait. A ${s.age}-year-old ${s.person} with an ordinary, real body, ${s.scene}.
They are holding and using the EXACT ${color} ${p.clothing_type} shown in the reference image — same colour, same shape, and the same printed design reproduced faithfully. Do NOT redesign or re-letter the print.
Natural candid framing, soft window light, 85mm f/1.8, Kodak Portra 400 grain.`;

  const j = await gJSON(
    `${GEN}/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { contents: [{ parts: [{ text: instruction }, { inline_data: { mime_type: mime, data: b64 } }] }] },
    'hero',
  );
  const parts = j.candidates?.[0]?.content?.parts || [];
  const img = parts.find(x => x.inlineData || x.inline_data);
  if (!img) throw new Error(`hero: model returned no image (${JSON.stringify(parts).slice(0, 200)})`);
  const data = (img.inlineData || img.inline_data).data;
  const out = path.join(TMP, `hero-${p.product_id_numeric}.png`);
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  return out;
}

// ── 4 · Veo 3.1 image-to-video with native spoken audio ─────────────────────
async function makeVideo(p, s, heroPath) {
  const color = (p.colors && p.colors[0]) || 'Black';
  const worn = !NON_APPAREL.has(p.clothing_type);
  const prompt = `Cinematic intimate documentary 9:16 vertical portrait. The person from the start frame, unchanged: a ${s.age}-year-old ${s.person}, ${s.scene}.
${worn
      ? `They are wearing a ${color} ${p.clothing_type}. The garment MUST remain the same ${color} ${p.clothing_type} for the entire clip — it must not morph into a different garment, and the printed chest design must not change or re-letter.`
      : `They are holding the ${color} ${p.clothing_type}. The object must not morph or change its printed design.`}
They speak directly to camera in a warm, dry, slightly sardonic voice, at a relaxed conversational pace.
Spoken words: "${s.narration}"
Subtle natural gestures, a small knowing half-smile at the end. Stays front-facing throughout. Soft golden afternoon light, Kodak Portra grain. No on-screen text, no captions, no subtitles.`;

  const b64 = fs.readFileSync(heroPath).toString('base64');
  const op = await gJSON(
    `${GEN}/models/${VIDEO_MODEL}:predictLongRunning?key=${GEMINI_KEY}`,
    { instances: [{ prompt, image: { bytesBase64Encoded: b64, mimeType: 'image/png' } }],
      parameters: { aspectRatio: '9:16' } },
    'veo-start',
  );
  const name = op.name;
  if (!name) throw new Error(`veo: no operation name`);

  // ~60s typical, 6 min ceiling. A silent retry cap is a drop-guard violation
  // (feedback-system 2026-08-08) — on timeout we THROW so the workflow goes red
  // and the daily report shows it, rather than skipping quietly.
  for (let i = 0; i < 40; i++) {
    await sleep(15000);
    const r = await fetch(`${GEN}/${name}?key=${GEMINI_KEY}`);
    const j = await r.json();
    if (j.error) throw new Error(`veo-poll: ${JSON.stringify(j.error).slice(0, 300)}`);
    if (j.done) {
      const uri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error(`veo finished with no video: ${JSON.stringify(j).slice(0, 300)}`);
      return download(`${uri}${uri.includes('?') ? '&' : '?'}key=${GEMINI_KEY}`, path.join(TMP, `veo-${p.product_id_numeric}.mp4`));
    }
    if (i % 4 === 0) log(`    …veo ${(i + 1) * 15}s`);
  }
  throw new Error('veo timed out after 10 minutes');
}

// ── 5 · compose: upscale + the back-reveal product beat ─────────────────────
// The reveal beat is what makes it an AD and not just a talking head — it puts
// the actual purchasable garment on screen with its slogan, matching the
// product-link rule (every asset ties to one real active product).
async function compose(p, veoPath) {
  const out = path.join(TMP, `final-${p.product_id_numeric}.mp4`);
  const scaled = path.join(TMP, `scaled-${p.product_id_numeric}.mp4`);
  const beat = path.join(TMP, `beat-${p.product_id_numeric}.mp4`);

  ff(['-y', '-i', veoPath, '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', scaled], 'scale');

  // 2.2s product still on brand cream, silent — becomes the tail card.
  let beatSrc = null;
  try {
    if (p.image_url) beatSrc = await download(p.image_url, path.join(TMP, `beatimg-${p.product_id_numeric}.jpg`));
  } catch (e) { log(`    (no beat image: ${e.message.slice(0, 80)})`); }

  if (!beatSrc) {
    ff(['-y', '-i', scaled, '-c', 'copy', out], 'passthrough');
    return out;
  }

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
  if (mb > 25) throw new Error(`final reel ${mb.toFixed(1)}MB exceeds the 25MB platform cap`);
  return out;
}

// ── 6 · publish into the bank the daily publisher already reads ─────────────
async function publish(p, finalPath, s) {
  const pid = p.product_id_numeric;
  const buf = fs.readFileSync(finalPath);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Archive the outgoing asset before overwriting. Never destroy a reel.
  for (const lang of ['EN']) {
    const key = `_pilot/product-${pid}-FINAL-${lang}.mp4`;
    const { data: old } = await sb.storage.from('video-assets').download(key);
    if (old) {
      await sb.storage.from('video-assets')
        .upload(`archive/product-${pid}-${stamp}-${lang}.mp4`, await old.arrayBuffer(),
          { contentType: 'video/mp4', upsert: true });
      log(`    archived previous ${lang}`);
    }
  }

  for (const lang of ['EN', 'HE']) {
    const { error } = await sb.storage.from('video-assets')
      .upload(`_pilot/product-${pid}-FINAL-${lang}.mp4`, buf, { contentType: 'video/mp4', upsert: true });
    if (error) throw new Error(`upload ${lang}: ${error.message}`);
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/video-assets/_pilot/product-${pid}-FINAL-EN.mp4`;

  // HEAD-verify the constructed URL before we call this done (feedback-system
  // 2026-08-08: every constructed asset URL gets HEAD-verified before use).
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`published reel not reachable: HTTP ${head.status} ${url}`);

  await sb.from('agent_runs').insert({
    agent_id: 'video', run_date: new Date().toISOString().slice(0, 10), status: 'completed',
    summary: `autonomous reel generated for product ${pid} — "${String(p.slogan).slice(0, 40)}" (Veo 3.1, headless)`,
    tasks_created: 0,
    side_effects: { product_id: pid, video_url: url, narration: s.narration, caption_he: s.caption_he, caption_en: s.caption_en, engine: 'veo-3.1-generate-preview', bytes: buf.length },
  });

  return url;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const targets = await pickTargets(COUNT);
  log(`targets: ${targets.map(t => `#${t.product_id_numeric}${t._age === -1 ? ' (MISSING)' : ''}`).join(', ')}`);

  const results = [];
  for (const p of targets) {
    const pid = p.product_id_numeric;
    try {
      log(`▶ #${pid} "${String(p.slogan).slice(0, 46)}" (${p.clothing_type})`);
      const s = await writeScript(p);
      log(`  script: ${s.person} ${s.age}, ${s.scene}`);
      log(`  says: "${s.narration}"`);
      if (DRY_RUN) { results.push({ pid, ok: true, dry: true, script: s }); continue; }

      const hero = await makeHero(p, s);   log('  hero ok');
      const veo = await makeVideo(p, s, hero); log('  video ok');
      const fin = await compose(p, veo);   log(`  composed ${(fs.statSync(fin).size / 1048576).toFixed(1)}MB`);
      const url = await publish(p, fin, s);
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

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  if (results.every(r => !r.ok)) process.exit(1);
})();
