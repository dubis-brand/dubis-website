#!/usr/bin/env node
// Batch ENGLISH-ONLY reel production (2026-06-07 — oren directive).
// There is NO good Hebrew TTS available (Veo HE = gibberish, ElevenLabs HE library
// voices blocked on Free, English voices reading Hebrew "נשמע רע"). So EVERY reel is
// English (Veo 3.1 native speech — sounds good). The Hebrew story lives in the POST
// CAPTION, not in the video, and NOT as on-screen subtitles ("בלי כתוביות זה יוצא לא טוב").
//
// To make the HE-slot post use this good English video, we upload the SAME final to
// BOTH `_pilot/{id}-FINAL-EN.mp4` and `_pilot/{id}-FINAL-HE.mp4`. The publish pipeline
// then picks the Hebrew caption for the HE slot and the English caption for the EN slot,
// both over the identical English-spoken reel.
//
// Per reel: ~$2.64 (Veo). Needs hero + back image in samples-2026-05-19/.

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
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
const SUPA = createClient('https://ntzwvqtpdmvvavbhuyeb.supabase.co', SRK, { auth: { persistSession: false } });

const PERSONAS_PATH = path.join(ROOT, 'personas-v3.json');
const personas = JSON.parse(readFileSync(PERSONAS_PATH, 'utf-8')).personas;

// Only personas tied to ACTIVE products that need an English reel generated.
// (men-5 → active #8 already has FINAL-EN; handled by copy-en-to-he.mjs, no Veo spend.)
const TODO_IDS = new Set(['men-1', 'women-1', 'women-5']);
const TODO = personas.filter(p => TODO_IDS.has(p.id));

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf-8', ...opts });
function hf(args) {
  const r = spawnSync(HF, args, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`hf failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

function buildVeoPrompt(p) {
  return `Cinematic intimate documentary-style 9:16 portrait shot. A ${p.age}-year-old Israeli ${p.gender === 'men' ? 'man' : 'woman'} in a dark green DUBIS hoodie. ${p.body_anchor}. Setting: ${p.scene_anchor_en || p.scene_anchor}. The character speaks directly to the camera in a warm, dry, slightly sardonic Israeli-accented English voice. Spoken text: "${p.narration_en}" Subtle natural hand gestures, mid-clip raises a small toast or expressive gesture, ends with a small knowing half-smile. The character STAYS COMPLETELY FRONT-FACING. Documentary realism, soft cinematic color grade, intimate close-up framing.`;
}

async function processPersona(p) {
  log(`▶ ${p.id} — start EN reel (narration_en: "${(p.narration_en||'').slice(0,50)}...")`);
  const heroPath = path.join(SAMPLES, `${p.id}-hero.jpg`);
  const backPath = path.join(SAMPLES, `${p.id}-back.jpg`);
  if (!existsSync(heroPath) || !existsSync(backPath)) {
    log(`✗ ${p.id} — missing hero or back`);
    return null;
  }

  // 1. Upload hero
  const uploadOut = JSON.parse(hf(['upload', 'create', heroPath, '--json']));
  const uploadId = uploadOut.id;
  log(`  upload: ${uploadId}`);

  // 2. Veo 3.1 EN (native speech)
  const veoJson = hf([
    'generate', 'create', 'veo3_1',
    '--aspect_ratio', '9:16',
    '--duration', '8',
    '--quality', 'high',
    '--image', uploadId,
    '--prompt', buildVeoPrompt(p),
    '--json',
  ]);
  const veoJobId = JSON.parse(veoJson)[0];
  log(`  veo job: ${veoJobId}`);

  const waitVeo = JSON.parse(hf(['generate', 'wait', veoJobId, '--json']));
  if (waitVeo.status !== 'completed' || !waitVeo.result_url) {
    log(`✗ ${p.id} — veo failed: ${waitVeo.status}`);
    return null;
  }
  log(`  veo done`);

  // 3. Download
  const veoLocal = path.join(PILOT, `${p.id}-veo-EN.mp4`);
  sh(`curl -sL "${waitVeo.result_url}" -o "${veoLocal}"`);

  // 4. Shared back-reveal segments + outro
  const segB = path.join(PILOT, `${p.id}-segB.mp4`);
  sh(`"${FFMPEG}" -y -loop 1 -i "${backPath}" -t 3 -filter_complex "[0:v]scale=2160:2160,zoompan=z='1.0+0.025*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]" -map '[v]' -an -c:v libx264 -preset medium -crf 18 "${segB}" 2>&1 | tail -1`);
  const segC = path.join(PILOT, `${p.id}-segC.mp4`);
  sh(`"${FFMPEG}" -y -loop 1 -i "${backPath}" -t 3 -filter_complex "[0:v]scale=2160:2160,zoompan=z='1.3+0.3*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih*0.68-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]" -map '[v]' -an -c:v libx264 -preset medium -crf 18 "${segC}" 2>&1 | tail -1`);
  const segD = path.join(PILOT, `${p.id}-segD.mp4`);
  sh(`"${FFMPEG}" -y -f lavfi -i color=c=0x2C2C2C:s=1080x1920:d=3:r=24 -vf "drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+120" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "${segD}" 2>&1 | tail -1`);

  // 5. Compose segA (Veo keeps native audio) scaled to 1080×1920
  const segA = path.join(PILOT, `${p.id}-segA-EN.mp4`);
  sh(`"${FFMPEG}" -y -i "${veoLocal}" -filter_complex "[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]" -map '[v]' -map '0:a?' -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k "${segA}" 2>&1 | tail -1`);

  // 6. Concat
  const concatList = path.join(PILOT, `${p.id}-concat-EN.txt`);
  writeFileSync(concatList, `file '${p.id}-segA-EN.mp4'\nfile '${p.id}-segB.mp4'\nfile '${p.id}-segC.mp4'\nfile '${p.id}-segD.mp4'\n`);
  const finalPath = path.join(PILOT, `${p.id}-FINAL-EN.mp4`);
  sh(`"${FFMPEG}" -y -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${finalPath}" 2>&1 | tail -1`);

  // 7. Upload to BOTH EN and HE slots (HE slot gets a Hebrew caption at publish time)
  const buf = readFileSync(finalPath);
  const urls = {};
  for (const lang of ['EN', 'HE']) {
    const uploadKey = `_pilot/${p.id}-FINAL-${lang}.mp4`;
    const { error: upErr } = await SUPA.storage.from('video-assets').upload(uploadKey, buf, {
      contentType: 'video/mp4', cacheControl: '3600', upsert: true,
    });
    if (upErr) throw new Error(`upload ${lang} failed: ${upErr.message}`);
    urls[lang] = `${STORAGE_URL}/public/video-assets/${uploadKey}`;
  }
  log(`✓ ${p.id} — EN+HE slots both = English Veo reel`);
  log(`   ${urls.EN}`);
  return { id: p.id, ...urls };
}

console.log(`Batch ENGLISH reel production — ${TODO.length} personas, dual-upload (EN+HE slots)`);
console.log(`Estimated cost: ~$${(TODO.length * 2.64).toFixed(2)}, time: ~${TODO.length * 4} min`);
const results = [];
for (const p of TODO) {
  try {
    const out = await processPersona(p);
    results.push(out || { id: p.id, error: 'skipped (missing assets)' });
  } catch (e) {
    log(`✗ ${p.id} — error: ${e.message}`);
    results.push({ id: p.id, error: e.message });
  }
  writeFileSync(path.join(PILOT, 'batch-en-results.json'), JSON.stringify(results, null, 2));
}
console.log('=== DONE ===');
console.log(JSON.stringify(results, null, 2));
