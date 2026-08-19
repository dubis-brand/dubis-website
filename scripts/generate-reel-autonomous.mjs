#!/usr/bin/env node
// generate-reel-autonomous.mjs — HEADLESS reel generation THROUGH HIGGSFIELD.
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
//   oren on the engine: "רוצה דרך היגספילד אבל שתמצא דרך שזה יהיה אוטמטי בלעדי".
//   So: Higgsfield, headless.
//
//   Our docs recorded "no headless token exists — the session expires in minutes".
//   That was WRONG, and it is what kept the bank frozen for a month. The
//   short-lived thing is the ACCESS token, which is normal and irrelevant: the
//   credentials also carry a refresh_token and the CLI self-heals through
//   /auth/refresh with no human. Proven 2026-08-19 by deliberately corrupting the
//   access token and watching `hf model list --video` succeed while the
//   credentials file rewrote itself.
//
//   THE ONE REAL CONSTRAINT: the refresh token is SINGLE-USE and ROTATES on every
//   refresh, so it cannot be a static secret. This script therefore treats the
//   credentials file as STATE and prints the rotated value back inside markers so
//   the workflow can persist it for the next run. Running `hf` manually on a
//   machine sharing the same chain will break CI auth — re-run `hf auth login`
//   there to get an independent chain. See the workflow for the write-back.
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

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';   // script text only — never video
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const HF = process.env.HF || 'hf';
const CREDS_PATH = process.env.HIGGSFIELD_CREDENTIALS_PATH
  || path.join(os.homedir(), '.config', 'higgsfield', 'credentials.json');
// The workspace selection lives OUTSIDE credentials.json, so a restored
// credentials secret alone leaves the CLI with "No workspace selected". This is
// the DUBIS paid workspace (dubis.brand@gmail.com, plus plan) — the same one the
// Higgsfield MCP bills against. Overridable for a future team workspace.
const WORKSPACE_ID = process.env.HIGGSFIELD_WORKSPACE_ID || '52a7bfe8-e226-42cf-856a-6d5ccbba0f7f';

const args = process.argv.slice(2);
const argVal = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const DRY_RUN = args.includes('--dry-run');
const FORCE_PID = argVal('product') ? Number(argVal('product')) : null;
const COUNT = Number(argVal('count') || 1);

if (!SERVICE_ROLE && !DRY_RUN) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE || 'anon', { auth: { persistSession: false } });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dubis-reel-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const GEN = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_MODEL = 'gemini-2.5-flash';
const HF_VIDEO_MODEL = 'veo3_1';   // Google Veo 3.1 via Higgsfield — 22 credits @ 9:16/8s/high

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

function hf(hfArgs, label) {
  const r = spawnSync(HF, hfArgs, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, HIGGSFIELD_CREDENTIALS_PATH: CREDS_PATH },
  });
  if (r.status !== 0) throw new Error(`hf ${label} (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  return r.stdout || '';
}

// hf --json shapes vary per command; pull the first media URL out of whatever came back.
function firstUrl(stdout) {
  try {
    const seen = [];
    (function walk(v) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) seen.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(JSON.parse(stdout));
    const media = seen.find(u => /\.(mp4|mov|webm|png|jpe?g|webp)(\?|$)/i.test(u));
    if (media) return media;
    if (seen.length) return seen[0];
  } catch { /* not json */ }
  const line = stdout.split(String.fromCharCode(10)).map(x => x.trim()).find(x => x.startsWith('http'));
  if (line) return line;
  throw new Error(`no URL in hf output: ${stdout.slice(0, 300)}`);
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
const SCENES = [
  'in a sunlit kitchen mid-morning', 'on a small balcony at golden hour',
  'in a cluttered home office at the end of the day', 'in a doorway with the afternoon light behind them',
  'on a couch with the TV off', 'in a hallway holding car keys',
];
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

  try {
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
  } catch (e) { log(`    (script fallback: ${e.message.slice(0, 90)})`); return fallbackScript(p); }
}

// ── 3 · hero frame with the REAL garment (WARDROBE LOCK) ────────────────────
// Higgsfield product-photoshoot, mode virtual_model_tryout, with the product's
// real catalog mockup as the reference so the person wears the EXACT garment.
async function makeHero(p, s) {
  if (!p.image_url) throw new Error(`product ${p.product_id_numeric} has no image_url to lock the garment against`);
  const color = (p.colors && p.colors[0]) || 'Black';
  const worn  = !NON_APPAREL.has(p.clothing_type);
  const mock  = await download(p.image_url, path.join(TMP, `mock-${p.product_id_numeric}.jpg`));

  const prompt = worn
    ? `A ${s.age}-year-old ${s.person} with an ordinary, real, non-model body, ${s.scene}. Wearing the EXACT ${color} ${p.clothing_type} shown in the reference image — same colour, same cut, same printed chest design, reproduced faithfully. Do NOT redesign, re-letter or move the print. Do NOT slim the person. The ${p.clothing_type} is the OUTERMOST layer and fully visible from shoulders to waist: no jacket, cardigan or coat over it, nothing held in front of the chest. Front-facing, three-quarter framing, fully and modestly clothed. Soft natural window light, candid documentary portrait, 85mm f/1.8, Kodak Portra 400 grain.`
    : `A ${s.age}-year-old ${s.person} with an ordinary, real body, ${s.scene}, holding and using the EXACT ${color} ${p.clothing_type} from the reference image — same colour, same shape, same printed design reproduced faithfully. Natural candid framing, soft window light, 85mm f/1.8, Kodak Portra 400 grain.`;

  const out = hf(['product-photoshoot', 'create', '--mode', 'virtual_model_tryout',
    '--prompt', prompt, '--image', mock, '--count', '1', '--aspect_ratio', '3:4',
    '--timeout', '10m', '--json'], 'product-photoshoot');
  return download(firstUrl(out), path.join(TMP, `hero-${p.product_id_numeric}.jpg`));
}

// ── 4 · Veo 3.1 THROUGH HIGGSFIELD ──────────────────────────────────────────
async function makeVideo(p, s, hero) {
  const color = (p.colors && p.colors[0]) || 'Black';
  const worn  = !NON_APPAREL.has(p.clothing_type);
  const prompt = `Cinematic intimate documentary 9:16 vertical portrait. The person from the start frame, unchanged: a ${s.age}-year-old ${s.person}, ${s.scene}. ${
    worn
      ? `Wearing a ${color} ${p.clothing_type}. The garment MUST remain the same ${color} ${p.clothing_type} for the entire clip — it must not morph into a different garment and the printed chest design must not change or re-letter.`
      : `Holding the ${color} ${p.clothing_type}. The object must not morph and its printed design must not change.`
  } They speak directly to camera in a warm, dry, slightly sardonic voice at a relaxed conversational pace. Spoken words: "${s.narration}" Subtle natural gestures, a small knowing half-smile at the end. Stays front-facing. Soft golden afternoon light, Kodak Portra grain. No on-screen text, no captions, no subtitles.`;

  const out = hf(['generate', 'create', HF_VIDEO_MODEL, '--aspect_ratio', '9:16', '--duration', '8',
    '--quality', 'high', '--image', hero, '--prompt', prompt,
    '--wait', '--wait-timeout', '20m', '--json'], HF_VIDEO_MODEL);
  return download(firstUrl(out), path.join(TMP, `veo-${p.product_id_numeric}.mp4`));
}

// ── 5 · compose: upscale + the back-reveal product beat ─────────────────────
// The reveal beat is what makes it an AD and not just a talking head — it puts
// the actual purchasable garment on screen with its slogan, matching the
// product-link rule (every asset ties to one real active product).
// ffmpeg only adds polish (upscale + product tail beat). The Higgsfield clip is
// already 9:16 h264+AAC and is a perfectly shippable reel on its own, so a
// missing ffmpeg must never cost us the reel we already paid 22 credits for.
function ffmpegAvailable() {
  try { return spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).status === 0; }
  catch { return false; }
}

async function compose(p, veoPath) {
  if (!ffmpegAvailable()) {
    log('    (no ffmpeg — publishing the raw Higgsfield clip, no tail beat)');
    return veoPath;
  }
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
    side_effects: { product_id: pid, video_url: url, narration: s.narration, caption_he: s.caption_he, caption_en: s.caption_en, engine: 'higgsfield:veo3_1', bytes: buf.length },
  });

  return url;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Fail loudly and EARLY if the Higgsfield auth chain is broken — never spend
  // credits on a half-run, and never fail silently the way the bank did.
  hf(['workspace', 'set', WORKSPACE_ID], 'workspace set');
  const who = hf(['account', 'status'], 'account status').trim();
  log('higgsfield: ' + who.split(String.fromCharCode(10))[0]);

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

  // The refresh token rotated during this run (single-use). Emit the new
  // credentials so the workflow can store them for next time.
  try {
    console.log('===HF_CREDENTIALS===');
    console.log(fs.readFileSync(CREDS_PATH, 'utf8').trim());
    console.log('===END_HF_CREDENTIALS===');
  } catch (e) { log(`⚠ could not read back credentials: ${e.message}`); }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  if (results.every(r => !r.ok)) process.exit(1);
})();
