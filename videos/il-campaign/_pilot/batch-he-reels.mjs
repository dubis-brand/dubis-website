#!/usr/bin/env node
// Batch BILINGUAL reel production — per-persona pair (HE + EN, shared pair_id)
// HE pipeline: Seedance 2.0 + Dicta Nakdan + ElevenLabs Brian/Charlotte + ffmpeg compose
// EN pipeline: Veo 3.1 native lipsync + ffmpeg compose
// Sequential per persona (Higgsfield CLI race-condition on UUID validation)
//
// Cost per persona pair: $1.20 (Seedance HE) + $0.05 (ElevenLabs) + $2.64 (Veo EN) = ~$3.89
// Total batch (9 personas): ~$35 + 9 × pair_id UUIDs
//
// Pre-flight: ensure 250+ Higgsfield credits available
//   hf account status

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const FFMPEG = 'C:\\Users\\tehar\\bin\\ffmpeg.exe';
const ROOT = path.resolve(import.meta.dirname || process.cwd(), '..');
const SAMPLES = path.join(ROOT, 'samples-2026-05-19');
const PILOT = path.join(ROOT, '_pilot');
const STORAGE_URL = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object';

const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => {
  const env = readFileSync(path.join(ROOT, '..', '..', '.env.local'), 'utf-8');
  const m = env.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
  return m ? m[1] : null;
})();
const TTS_KEY = 'f51c9a74768ad0d1de3ecaac12e96ce0134adcd23d51ede8';
const SUPA = createClient('https://ntzwvqtpdmvvavbhuyeb.supabase.co', SRK, { auth: { persistSession: false } });
// Free-plan workaround (2026-06-06): ElevenLabs Free blocks LIBRARY voices via API (402).
// Premade voices work on Free with eleven_multilingual_v2 (verified: Hebrew text → valid MP3).
// oren directive: "אם אין קולו בעברית תשתמש בקולות באנגלית" — use English premade voices for HE narration.
const ELEVEN_BRIAN = 'pNInz6obpgDQGcFmaJgB';      // Adam (premade) — male
const ELEVEN_CHARLOTTE = '21m00Tcm4TlvDq8ikWAM';  // Rachel (premade) — female

const PERSONAS_PATH = path.join(ROOT, 'personas-v3.json');
const personas = JSON.parse(readFileSync(PERSONAS_PATH, 'utf-8')).personas;

// Reel bank policy (2026-06-07): a reel only ships if it links a LIVE product.
// Persona→product→active map: men-1→#3✓ men-5→#8✓ women-1→#11✓ women-5→#31✓ are the
// only personas tied to active products. men-2/3/4 + women-2/3/4 map to inactive/retired
// products (#6/#15/#9/#13/#16/#17) → their reels would violate the product-link rule, skip.
// men-1 + men-5 already in Storage bank. Gap = women-1 + women-5.
const TODO_IDS = new Set(['women-1', 'women-5']);
const TODO = personas.filter(p => TODO_IDS.has(p.id));

// --- helpers ---
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf-8', ...opts });
// hf wrapper — uses spawnSync with args array to bypass Windows shell JSON quoting bugs
function hf(args) {
  const r = spawnSync(HF, args, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`hf failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

async function vocalize(text) {
  const r = await fetch('https://nakdan-2-0.loadbalancer.dicta.org.il/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'nakdan', data: text, genre: 'modern', addmorph: false, matchpartial: true, keepmetagim: true, keepqq: false }),
  });
  const arr = await r.json();
  return arr.map(t => t.sep ? t.word : (t.options[0] || t.word).replace(/\|/g, '')).join('');
}

async function tts(text, voice, outPath) {
  const r = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/tts-quick', {
    method: 'POST',
    headers: { 'x-tts-key': TTS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, model_id: 'eleven_multilingual_v2', stability: 0.5, similarity: 0.78, style: 0.35, speed: 1.0 }),
  });
  if (!r.ok) throw new Error(`tts failed ${r.status}: ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return outPath;
}

function buildSeedancePrompt(persona) {
  return `A ${persona.age}-year-old Israeli ${persona.gender === 'men' ? 'man' : 'woman'} in a dark green DUBIS hoodie with subtle chest logo. ${persona.body_anchor}. Setting: ${persona.scene_anchor}. The character is ANIMATED and EXPRESSIVE throughout the 10-second clip: starts with a natural small action (sip, glance, slight nod), mid-clip turns slightly to gesture at something nearby in the scene with a wry half-smile, then turns back to face the camera with a knowing look, ends with a soft chuckle or eyebrow raise. Multiple natural micro-movements: blinks, eyebrow flickers, head tilts, hand gestures. The character STAYS COMPLETELY FRONT-FACING — never turns his/her back, never fully turns away from camera. Warm natural ambient light matching the scene. Camera holds steady (no zoom, no pan). Documentary realism, natural skin texture, no model-agency polish, intimate close-up framing. Atmosphere: cozy, slightly sardonic, very alive.`;
}

function buildVeoPrompt(p) {
  return `Cinematic intimate documentary-style 9:16 portrait shot. A ${p.age}-year-old Israeli ${p.gender === 'men' ? 'man' : 'woman'} in a dark green DUBIS hoodie. ${p.body_anchor}. Setting: ${p.scene_anchor}. The character speaks directly to the camera in a warm, dry, slightly sardonic Israeli-accented English voice. Spoken text: "${p.narration_en}" Subtle natural hand gestures, mid-clip raises a small toast or expressive gesture, ends with a small knowing half-smile. The character STAYS COMPLETELY FRONT-FACING. Documentary realism, soft cinematic color grade, intimate close-up framing.`;
}

function pairId() {
  // RFC4122 v4 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function processPersona(p) {
  log(`▶ ${p.id} — start pair`);
  const heroPath = path.join(SAMPLES, `${p.id}-hero.jpg`);
  const backPath = path.join(SAMPLES, `${p.id}-back.jpg`);
  if (!existsSync(heroPath) || !existsSync(backPath)) {
    log(`✗ ${p.id} — missing hero or back`);
    return null;
  }

  const pid = pairId();
  log(`  pair_id: ${pid}`);

  // 1. Upload hero ONCE (re-used for both HE Seedance + EN Veo)
  const uploadOut = JSON.parse(hf(['upload', 'create', heroPath, '--json']));
  const uploadId = uploadOut.id;
  log(`  upload: ${uploadId}`);

  // === HE TRACK (Seedance) ===
  // 2. Seedance i2v — use spawnSync args array (no shell quoting)
  const sdPrompt = buildSeedancePrompt(p);
  const medias = JSON.stringify([{ role: 'image', data: { id: uploadId, type: 'media_input' } }]);
  const seedanceJson = hf([
    'generate', 'create', 'seedance_2_0',
    '--aspect_ratio', '9:16',
    '--duration', '10',
    '--resolution', '720p',
    '--mode', 'std',
    '--medias', medias,
    '--prompt', sdPrompt,
    '--json',
  ]);
  const sdJobId = JSON.parse(seedanceJson)[0];
  log(`  seedance job: ${sdJobId}`);

  // 3. EN TRACK in PARALLEL — Veo 3.1
  const veoPrompt = buildVeoPrompt(p);
  const veoJson = hf([
    'generate', 'create', 'veo3_1',
    '--aspect_ratio', '9:16',
    '--duration', '8',
    '--quality', 'high',
    '--image', uploadId,
    '--prompt', veoPrompt,
    '--json',
  ]);
  const veoJobId = JSON.parse(veoJson)[0];
  log(`  veo job: ${veoJobId}`);

  // 4. Wait for both
  const waitSd = JSON.parse(hf(['generate', 'wait', sdJobId, '--json']));
  const waitVeo = JSON.parse(hf(['generate', 'wait', veoJobId, '--json']));
  if (waitSd.status !== 'completed' || !waitSd.result_url) {
    log(`✗ ${p.id} — seedance failed: ${waitSd.status}`);
    return null;
  }
  if (waitVeo.status !== 'completed' || !waitVeo.result_url) {
    log(`✗ ${p.id} — veo failed: ${waitVeo.status}`);
    return null;
  }
  log(`  both visuals done`);

  // 5. Download
  const seedanceLocal = path.join(PILOT, `${p.id}-seedance-HE.mp4`);
  const veoLocal = path.join(PILOT, `${p.id}-veo-EN.mp4`);
  sh(`curl -sL "${waitSd.result_url}" -o "${seedanceLocal}"`);
  sh(`curl -sL "${waitVeo.result_url}" -o "${veoLocal}"`);

  // 6. Niqqud + ElevenLabs TTS (HE only — Veo handles EN natively)
  const niqqudText = await vocalize(p.narration_he);
  log(`  niqqud: ${niqqudText.slice(0, 60)}...`);
  const ttsPath = path.join(PILOT, `${p.id}-narration-HE.mp3`);
  const voice = p.gender === 'men' ? ELEVEN_BRIAN : ELEVEN_CHARLOTTE;
  await tts(niqqudText, voice, ttsPath);
  log(`  tts: ${ttsPath}`);

  // 7. Shared back-reveal segments + outro (same for HE + EN, render once)
  const segB = path.join(PILOT, `${p.id}-segB.mp4`);
  sh(`"${FFMPEG}" -y -loop 1 -i "${backPath}" -t 3 -filter_complex "[0:v]scale=2160:2160,zoompan=z='1.0+0.025*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]" -map '[v]' -an -c:v libx264 -preset medium -crf 18 "${segB}" 2>&1 | tail -1`);
  const segC = path.join(PILOT, `${p.id}-segC.mp4`);
  sh(`"${FFMPEG}" -y -loop 1 -i "${backPath}" -t 3 -filter_complex "[0:v]scale=2160:2160,zoompan=z='1.3+0.3*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih*0.68-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]" -map '[v]' -an -c:v libx264 -preset medium -crf 18 "${segC}" 2>&1 | tail -1`);
  const segD = path.join(PILOT, `${p.id}-segD.mp4`);
  sh(`"${FFMPEG}" -y -f lavfi -i color=c=0x2C2C2C:s=1080x1920:d=3:r=24 -vf "drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='בשביל כולנו':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=70:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+60,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+180" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "${segD}" 2>&1 | tail -1`);

  // 8. HE compose — Seedance scaled + ElevenLabs narration overlay
  const segA_HE = path.join(PILOT, `${p.id}-segA-HE.mp4`);
  sh(`"${FFMPEG}" -y -i "${seedanceLocal}" -i "${ttsPath}" -filter_complex "[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v];[1:a]volume=1.0,apad,atrim=duration=10.0,afade=t=in:st=0:d=0.15,afade=t=out:st=9.7:d=0.3[a]" -map '[v]' -map '[a]' -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -t 10 "${segA_HE}" 2>&1 | tail -1`);

  // 9. EN compose — Veo (keeps native audio) scaled to 1080×1920
  const segA_EN = path.join(PILOT, `${p.id}-segA-EN.mp4`);
  sh(`"${FFMPEG}" -y -i "${veoLocal}" -filter_complex "[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]" -map '[v]' -map '0:a?' -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k "${segA_EN}" 2>&1 | tail -1`);

  // 10. Concat both languages
  const finalUrls = {};
  for (const lang of ['HE', 'EN']) {
    const concatList = path.join(PILOT, `${p.id}-concat-${lang}.txt`);
    writeFileSync(concatList, `file '${p.id}-segA-${lang}.mp4'\nfile '${p.id}-segB.mp4'\nfile '${p.id}-segC.mp4'\nfile '${p.id}-segD.mp4'\n`);
    const finalPath = path.join(PILOT, `${p.id}-FINAL-${lang}.mp4`);
    sh(`"${FFMPEG}" -y -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${finalPath}" 2>&1 | tail -1`);

    // Upload via supabase-js (curl --data-binary breaks on Windows paths with spaces)
    const uploadKey = `_pilot/${p.id}-FINAL-${lang}.mp4`;
    const buf = readFileSync(finalPath);
    const { error: upErr } = await SUPA.storage.from('video-assets').upload(uploadKey, buf, {
      contentType: 'video/mp4', cacheControl: '3600', upsert: true,
    });
    if (upErr) throw new Error(`upload ${lang} failed: ${upErr.message}`);
    finalUrls[lang] = `${STORAGE_URL}/public/video-assets/${uploadKey}`;
  }
  log(`✓ ${p.id} pair — HE: ${finalUrls.HE}`);
  log(`✓ ${p.id} pair — EN: ${finalUrls.EN}`);
  return { pair_id: pid, ...finalUrls };
}

// Main
console.log(`Batch BILINGUAL production — ${TODO.length} personas × 2 langs = ${TODO.length * 2} reels`);
console.log(`Estimated cost: ~$${(TODO.length * 3.89).toFixed(2)}, time: ~${TODO.length * 6} min sequential`);
const results = [];
for (const p of TODO) {
  try {
    const out = await processPersona(p);
    results.push({ id: p.id, ...out });
  } catch (e) {
    log(`✗ ${p.id} — error: ${e.message}`);
    results.push({ id: p.id, error: e.message });
  }
  // Save incrementally so a crash doesn't lose progress
  writeFileSync(path.join(PILOT, 'batch-results.json'), JSON.stringify(results, null, 2));
}
console.log('=== DONE ===');
console.log(JSON.stringify(results, null, 2));
