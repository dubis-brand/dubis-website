#!/usr/bin/env node
// compose-full-reels-2026-05-20.mjs
// For each 10s narrated reel, compose the full 19s pipeline per higgsfield-reels SKILL:
//   [A] 10s narrated persona reel (front-facing, EN voiceover)
//   [B]  3s Ken Burns wide zoom on catalog back mockup (real Gelato-printed slogan, no AI text)
//   [C]  3s zoom-in on the power word of the slogan
//   [D]  3s DUBIS™ outro card (Charcoal bg, Honey logo, Cream URL)
// = 19s total. Re-upload to Supabase Storage.
//
// Why this pipeline:
//   Seedance i2v can't preserve back-of-garment text during motion (turns to gibberish).
//   The catalog back mockup IS the real Gelato print — perfect typography.
//   Ken Burns + power-word zoom reveals the slogan with cinematic emphasis.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const FFMPEG = 'C:/Users/tehar/bin/ffmpeg.exe';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SRK) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const ROOT = path.resolve('.');
const SAMPLES = path.join(ROOT, 'videos/il-campaign/samples-2026-05-19');
const IMAGES = path.join(ROOT, 'images');

// Per-persona product + color (match generate-samples-2026-05-19.mjs PRODUCT_SLOGANS).
// Plus the POWER WORD of the slogan (the big word in the typography for the zoom).
const PERSONAS = {
  'men-1':   { product: 3,  color: 'Forest-Green', power: 'CARDIO' },
  'men-2':   { product: 6,  color: 'Charcoal',     power: 'NEVER' },
  'men-3':   { product: 15, color: 'Navy',         power: 'FASHION' },
  'men-4':   { product: 9,  color: 'Navy',         power: 'OVER' },
  'men-5':   { product: 8,  color: 'Red',          power: 'NAP' },
  'women-1': { product: 11, color: 'Cream',        power: 'NAP' },
  'women-2': { product: 13, color: 'Cream',        power: 'CLUB' },
  'women-3': { product: 16, color: 'White',        power: 'EXISTENCE' },
  'women-4': { product: 17, color: 'Black',        power: 'EXHAUSTION' },
  'women-5': { product: 31, color: 'White',        power: 'COMFORTABLE' },
};

const TMP = path.join(SAMPLES, '_tmp');
fs.mkdirSync(TMP, { recursive: true });

function ff(args, label) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 128*1024*1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label} failed (${r.status}): ${(r.stderr || '').slice(-500)}`);
}

function makeBackKenBurns(backMockup, outPath, durationSec = 3) {
  // Wide-to-medium slow zoom on the back mockup — reveals slogan in context
  // Mockup is 1500x1500 square. Crop to 1080x1920 (centered) with zoom.
  // Start zoom 1.0, end zoom 1.18, total 3s = 72 frames at 24fps
  const frames = durationSec * 24;
  const args = [
    '-y', '-loop', '1', '-i', backMockup, '-t', String(durationSec),
    '-filter_complex',
    `[0:v]scale=2160:2160,zoompan=z='1.0+0.18*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', outPath,
  ];
  ff(args, 'back-kenburns');
}

function makePowerWordZoom(backMockup, outPath, durationSec = 3) {
  // Tight zoom-in on the power word (centered on lower half of back mockup where big word sits)
  // Start zoom 1.4, end zoom 1.9, centered on the slogan position (y ~ 0.55-0.65 of mockup)
  const frames = durationSec * 24;
  const args = [
    '-y', '-loop', '1', '-i', backMockup, '-t', String(durationSec),
    '-filter_complex',
    `[0:v]scale=2160:2160,zoompan=z='1.4+0.5*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih*0.58-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', outPath,
  ];
  ff(args, 'power-word-zoom');
}

function makeOutro(outPath, durationSec = 3) {
  // Charcoal #2C2C2C bg, "DUBIS™" Honey #C17E3A 180pt, "dubis.net" Cream #F5F0E8 52pt
  const fontPath = 'C\\:/Windows/Fonts/impact.ttf';
  const fontArial = 'C\\:/Windows/Fonts/arial.ttf';
  const args = [
    '-y', '-f', 'lavfi', '-i', `color=c=0x2C2C2C:s=1080x1920:d=${durationSec}:r=24`,
    '-vf',
    `drawtext=fontfile='${fontPath}':text='DUBIS™':fontcolor=0xC17E3A:fontsize=200:x=(w-text_w)/2:y=(h-text_h)/2-80,` +
    `drawtext=fontfile='${fontArial}':text='dubis.net':fontcolor=0xF5F0E8:fontsize=54:x=(w-text_w)/2:y=(h-text_h)/2+100`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', outPath,
  ];
  ff(args, 'outro');
}

function concatAll(persona, segPaths, outPath) {
  // Build concat list file
  const listPath = path.join(TMP, `${persona}-concat.txt`);
  const content = segPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(listPath, content);

  // Re-encode (different codecs/audio across segs) — use libx264 + aac, scale all to 1080x1920
  const args = [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0d,setsar=1,fps=24',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath,
  ];
  ff(args, 'concat');
}

async function uploadStorage(localPath, storagePath) {
  const bytes = fs.readFileSync(localPath);
  const url = `${SUPABASE_URL}/storage/v1/object/video-assets/${storagePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) {
    const t = await res.text();
    if (!t.includes('Duplicate')) throw new Error(`upload ${storagePath}: ${res.status} ${t.slice(0,200)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/video-assets/${storagePath}`;
}

async function processPersona(persona, cfg) {
  console.log(`\n=== ${persona} (product ${cfg.product} ${cfg.color}, power="${cfg.power}") ===`);
  const reelPath = path.join(SAMPLES, `${persona}-reel.mp4`); // already narrated 10s
  const backMockup = path.join(IMAGES, `product-${cfg.product}-${cfg.color}-back.jpg`);
  if (!fs.existsSync(reelPath)) { console.log(`  SKIP: no reel ${persona}-reel.mp4`); return null; }
  if (!fs.existsSync(backMockup)) { console.log(`  SKIP: no back mockup ${path.basename(backMockup)}`); return null; }

  const segB = path.join(TMP, `${persona}-segB-back.mp4`);
  const segC = path.join(TMP, `${persona}-segC-powerword.mp4`);
  const segD = path.join(TMP, `${persona}-segD-outro.mp4`);
  const outFull = path.join(SAMPLES, `${persona}-reel-full.mp4`);

  console.log(`  [B] Ken Burns back (3s)…`); makeBackKenBurns(backMockup, segB);
  console.log(`  [C] Power-word zoom on "${cfg.power}" (3s)…`); makePowerWordZoom(backMockup, segC);
  console.log(`  [D] DUBIS outro (3s)…`); makeOutro(segD);
  console.log(`  Concat A+B+C+D → 19s…`); concatAll(persona, [reelPath, segB, segC, segD], outFull);

  // Replace main reel file with full version
  fs.copyFileSync(outFull, reelPath);

  // Upload to Supabase Storage with fresh URL
  const stamp = Date.now();
  const storageName = `samples-2026-05-19/${persona}-reel-full-${stamp}.mp4`;
  const publicUrl = await uploadStorage(reelPath, storageName);
  console.log(`  uploaded: ${publicUrl}`);
  return { persona, public_url: publicUrl, full_local: reelPath };
}

async function main() {
  const personas = Object.keys(PERSONAS).filter((id) => fs.existsSync(path.join(SAMPLES, `${id}-reel.mp4`)));
  console.log(`Composing full 19s reels for ${personas.length} personas: ${personas.join(', ')}\n`);

  const results = [];
  for (const persona of personas) {
    try {
      const r = await processPersona(persona, PERSONAS[persona]);
      if (r) results.push(r);
    } catch (e) {
      console.error(`  [${persona}] ERR: ${e.message.slice(0, 400)}`);
    }
    await sleep(1000);
  }

  const manifestPath = path.join(SAMPLES, '_full-reels-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ generated_at: new Date().toISOString(), reels: results }, null, 2));
  console.log(`\nDone — ${results.length} reels composed (19s each).`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
