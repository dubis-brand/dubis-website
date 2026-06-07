#!/usr/bin/env node
// compose-reels.mjs (2026-06-07) — compose-ONLY, no Higgsfield spend.
// The batch-en-reels.mjs Veo step works, but its ffmpeg calls went through execSync's
// shell layer where `-map '[v]'` / `-filter_complex [v]` get mangled and `| tail` silently
// masks the failure. This script re-composes from the ALREADY-DOWNLOADED {id}-veo-EN.mp4
// using spawnSync(ffmpeg, [argsArray]) — ZERO shell parsing, every arg passed literally.
//
// Output: {id}-FINAL-EN.mp4, uploaded to BOTH _pilot/{id}-FINAL-EN.mp4 and -HE.mp4
// (English Veo reel serves both language slots; Hebrew story lives in the caption).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FFMPEG = 'C:\\Users\\tehar\\bin\\ffmpeg.exe';
const ROOT = path.resolve(import.meta.dirname || process.cwd(), '..');
const SAMPLES = path.join(ROOT, 'samples-2026-05-19');
const PILOT = path.join(ROOT, '_pilot');
const STORAGE_URL = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => {
  const m = readFileSync(path.join(ROOT, '..', '..', '.env.local'), 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
  return m ? m[1] : null;
})();
const SUPA = createClient('https://ntzwvqtpdmvvavbhuyeb.supabase.co', SRK, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function ff(args, label) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout || '').split('\n').slice(-6).join('\n');
    throw new Error(`ffmpeg ${label} failed (exit ${r.status}):\n${tail}`);
  }
}

const PERSONAS = ['men-1', 'women-1', 'women-5'];

async function compose(id) {
  const veo  = path.join(PILOT, `${id}-veo-EN.mp4`);
  const back = path.join(SAMPLES, `${id}-back.jpg`);
  if (!existsSync(veo))  { log(`✗ ${id} — no veo-EN.mp4, skip`); return null; }
  if (!existsSync(back)) { log(`✗ ${id} — no back image, skip`); return null; }
  log(`▶ ${id} — compose`);

  const segA = path.join(PILOT, `${id}-segA-EN.mp4`);
  const segB = path.join(PILOT, `${id}-segB.mp4`);
  const segC = path.join(PILOT, `${id}-segC.mp4`);
  const segD = path.join(PILOT, `${id}-segD.mp4`);

  // segA — Veo scaled/cropped to 1080x1920, keep native English audio
  ff(['-y', '-i', veo,
    '-filter_complex', '[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]',
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', segA], 'segA');

  // segB — back-reveal slow zoom in
  ff(['-y', '-loop', '1', '-i', back, '-t', '3',
    '-filter_complex', "[0:v]scale=2160:2160,zoompan=z='1.0+0.025*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', segB], 'segB');

  // segC — back-reveal push toward slogan
  ff(['-y', '-loop', '1', '-i', back, '-t', '3',
    '-filter_complex', "[0:v]scale=2160:2160,zoompan=z='1.3+0.3*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih*0.68-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', segC], 'segC');

  // segD — DUBIS outro (brand + url)
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=0x2C2C2C:s=1080x1920:d=3:r=24',
    '-vf', "drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+120",
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', segD], 'segD');

  // concat
  const list = path.join(PILOT, `${id}-concat-EN.txt`);
  writeFileSync(list, `file '${id}-segA-EN.mp4'\nfile '${id}-segB.mp4'\nfile '${id}-segC.mp4'\nfile '${id}-segD.mp4'\n`);
  const final = path.join(PILOT, `${id}-FINAL-EN.mp4`);
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final], 'concat');

  // upload to BOTH EN + HE slots
  const buf = readFileSync(final);
  const urls = {};
  for (const lang of ['EN', 'HE']) {
    const key = `_pilot/${id}-FINAL-${lang}.mp4`;
    const { error } = await SUPA.storage.from('video-assets').upload(key, buf, { contentType: 'video/mp4', cacheControl: '3600', upsert: true });
    if (error) throw new Error(`upload ${lang}: ${error.message}`);
    urls[lang] = `${STORAGE_URL}/public/video-assets/${key}`;
  }
  log(`✓ ${id} — ${(buf.length/1e6).toFixed(1)}MB → EN+HE slots`);
  return { id, ...urls };
}

const results = [];
for (const id of PERSONAS) {
  try { results.push(await compose(id) || { id, error: 'skipped' }); }
  catch (e) { log(`✗ ${id} — ${e.message}`); results.push({ id, error: e.message }); }
}
console.log('=== COMPOSE DONE ===');
console.log(JSON.stringify(results, null, 2));
