#!/usr/bin/env node
// strip-seedance-audio-2026-05-25.mjs
// CRITICAL BUG FIX: Seedance generate_audio default=true hallucinated speech audio
// in random languages (Hebrew gibberish, French) which leaked into our reels via
// the 8% ambient mix in add-en-voiceover.
//
// Fix: strip the Seedance audio entirely. Use ONLY the ElevenLabs EN narration MP3.
// Re-mix each persona's reel, then re-compose the 19s full version, re-upload.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const FFMPEG = 'C:/Users/tehar/bin/ffmpeg.exe';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SRK) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const SAMPLES = path.resolve('videos/il-campaign/samples-2026-05-19');
const AUDIO_DIR = path.join(SAMPLES, '_audio');
const TMP = path.join(SAMPLES, '_tmp-clean');
fs.mkdirSync(TMP, { recursive: true });

const PERSONAS = ['men-1','men-2','men-3','men-4','men-5','women-1','women-2','women-3','women-4','women-5'];

const POWER_WORDS = {
  'men-1': 'CARDIO', 'men-2': 'NEVER', 'men-3': 'FASHION', 'men-4': 'OVER', 'men-5': 'NAP',
  'women-1': 'NAP', 'women-2': 'CLUB', 'women-3': 'EXISTENCE', 'women-4': 'EXHAUSTION', 'women-5': 'COMFORTABLE',
};

const PRODUCTS = {
  'men-1': { id: 3, color: 'Forest-Green' }, 'men-2': { id: 6, color: 'Charcoal' },
  'men-3': { id: 15, color: 'Navy' }, 'men-4': { id: 9, color: 'Navy' }, 'men-5': { id: 8, color: 'Red' },
  'women-1': { id: 11, color: 'Cream' }, 'women-2': { id: 13, color: 'Cream' },
  'women-3': { id: 16, color: 'White' }, 'women-4': { id: 17, color: 'Black' }, 'women-5': { id: 31, color: 'White' },
};

function ff(args, label) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 128*1024*1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr || '').slice(-400)}`);
}

// Find best source video — prefer -original (raw Seedance, 10s); else the existing -reel.mp4
function findSource(persona) {
  const candidates = [
    path.join(SAMPLES, `${persona}-reel-original.mp4`),
    path.join(SAMPLES, `${persona}-reel-en.mp4`),
    path.join(SAMPLES, `${persona}-reel.mp4`),
    path.join(SAMPLES, `${persona}-reel-full.mp4`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findNarration(persona) {
  const p = path.join(AUDIO_DIR, `${persona}-en.mp3`);
  return fs.existsSync(p) ? p : null;
}

function stripAndMixNarration(persona, sourceVideo, narrationMp3, outPath) {
  console.log(`  [${persona}] strip+mix → ${path.basename(outPath)}`);
  // Take source video (Seedance), strip its audio entirely (-an on map 0:v)
  // Take narration MP3, mix as the ONLY audio track
  // Output: video from source, audio = pure narration. No Seedance gibberish.
  // Apad ensures narration extends to video duration if shorter (silence padding).
  const args = [
    '-y',
    '-i', sourceVideo,
    '-i', narrationMp3,
    '-filter_complex',
    "[1:a]volume=1.2,acompressor=threshold=-14dB:ratio=2.5:attack=20:release=200," +
      "apad,atrim=duration=10,afade=t=in:st=0:d=0.2,afade=t=out:st=9.7:d=0.3," +
      "dynaudnorm=f=200:g=15[a]",
    '-map', '0:v:0',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', '10',
    '-movflags', '+faststart',
    outPath,
  ];
  ff(args, 'strip-mix');
}

function makeBackKenBurns(backMockup, outPath, durationSec = 3) {
  const frames = durationSec * 24;
  const args = [
    '-y', '-loop', '1', '-i', backMockup, '-t', String(durationSec),
    '-filter_complex',
    `[0:v]scale=2160:2160,zoompan=z='1.0+0.18*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', outPath,
  ];
  ff(args, 'back-kenburns');
}

function makePowerZoom(backMockup, outPath, durationSec = 3) {
  const frames = durationSec * 24;
  const args = [
    '-y', '-loop', '1', '-i', backMockup, '-t', String(durationSec),
    '-filter_complex',
    `[0:v]scale=2160:2160,zoompan=z='1.4+0.5*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih*0.58-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', outPath,
  ];
  ff(args, 'power-zoom');
}

function makeOutro(outPath, durationSec = 3) {
  const fontImpact = 'C\\:/Windows/Fonts/impact.ttf';
  const fontArial = 'C\\:/Windows/Fonts/arial.ttf';
  const args = [
    '-y', '-f', 'lavfi', '-i', `color=c=0x2C2C2C:s=1080x1920:d=${durationSec}:r=24`,
    '-vf',
    `drawtext=fontfile='${fontImpact}':text='DUBIS™':fontcolor=0xC17E3A:fontsize=200:x=(w-text_w)/2:y=(h-text_h)/2-80,` +
    `drawtext=fontfile='${fontArial}':text='dubis.net':fontcolor=0xF5F0E8:fontsize=54:x=(w-text_w)/2:y=(h-text_h)/2+100`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', outPath,
  ];
  ff(args, 'outro');
}

function concatAll(persona, segs, outPath) {
  const listPath = path.join(TMP, `${persona}-concat.txt`);
  fs.writeFileSync(listPath, segs.map((p) => `file '${p.replace(/\\/g,'/')}'`).join('\n'));
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

async function main() {
  const stamp = Date.now();
  const manifest = { generated_at: new Date().toISOString(), action: 'strip-seedance-audio', reels: [] };

  for (const persona of PERSONAS) {
    console.log(`\n=== ${persona} ===`);
    const src = findSource(persona);
    const narr = findNarration(persona);
    if (!src) { console.log(`  SKIP — no source video`); continue; }
    if (!narr) { console.log(`  SKIP — no narration MP3 (${persona}-en.mp3 missing)`); continue; }
    console.log(`  source: ${path.basename(src)}`);
    console.log(`  narration: ${path.basename(narr)}`);

    const cleanReel = path.join(TMP, `${persona}-clean.mp4`);
    stripAndMixNarration(persona, src, narr, cleanReel);

    const product = PRODUCTS[persona];
    const backMockup = path.resolve(`images/product-${product.id}-${product.color}-back.jpg`);
    if (!fs.existsSync(backMockup)) { console.warn(`  no back mockup: ${path.basename(backMockup)}`); continue; }

    const segB = path.join(TMP, `${persona}-segB.mp4`);
    const segC = path.join(TMP, `${persona}-segC.mp4`);
    const segD = path.join(TMP, `${persona}-segD.mp4`);
    console.log(`  [B] Ken Burns back…`); makeBackKenBurns(backMockup, segB);
    console.log(`  [C] Power-word zoom (${POWER_WORDS[persona]})…`); makePowerZoom(backMockup, segC);
    console.log(`  [D] DUBIS outro…`); makeOutro(segD);

    const finalOut = path.join(SAMPLES, `${persona}-reel-clean.mp4`);
    console.log(`  concat 4 segments (10s clean + 3 + 3 + 3 = ~19s)…`);
    concatAll(persona, [cleanReel, segB, segC, segD], finalOut);

    // Replace main reel file
    const mainReel = path.join(SAMPLES, `${persona}-reel.mp4`);
    fs.copyFileSync(finalOut, mainReel);

    // Upload
    const storagePath = `samples-2026-05-19/${persona}-reel-clean-${stamp}.mp4`;
    const publicUrl = await uploadStorage(mainReel, storagePath);
    console.log(`  uploaded: ${publicUrl}`);
    manifest.reels.push({ persona, public_url: publicUrl });
    await sleep(800);
  }

  fs.writeFileSync(path.join(SAMPLES, '_clean-reels-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone — ${manifest.reels.length} reels cleaned + re-uploaded.`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
