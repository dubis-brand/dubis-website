#!/usr/bin/env node
// add-en-voiceover-2026-05-20.mjs
// For each existing 10s Higgsfield reel: generate EN narration via tts-quick,
// then ffmpeg-mix on top of the existing reel (narration 100%, ambient 8%).
// Overwrites the local mp4 + uploads to Supabase Storage with new timestamp.
// oren directive 2026-05-19: EN-only voiceover, never HE.
// oren directive 2026-05-20: NO Hebrew text baked into video.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const FFMPEG = 'C:/Users/tehar/bin/ffmpeg.exe';
const TTS_URL = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/tts-quick';
const TTS_KEY = 'f51c9a74768ad0d1de3ecaac12e96ce0134adcd23d51ede8';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SRK) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const SAMPLES = path.resolve('videos/il-campaign/samples-2026-05-19');
const AUDIO_DIR = path.join(SAMPLES, '_audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Tight, ~10-second EN scripts per persona — designed to fit a 10s reel.
// Following memory/copy-playbook.md 3-beat formula: Hook → Agitation → DUBIS Drop.
const SCRIPTS = {
  'men-1': {
    text: "Everyone's doing 5 AM cardio. Mine starts at 2 PM. On the couch. With a show. For the rest of us.",
    voice: 'nPczCjzI2devNBz1zQrb', // Brian
  },
  'men-2': {
    text: "My kids said I'm not a model. Truth is, I never wanted to be. For everyone who stopped pretending.",
    voice: 'nPczCjzI2devNBz1zQrb',
  },
  'men-3': {
    text: "Fashion? Skip it. I'm in traffic. I want comfort that doesn't ask questions. Same.",
    voice: 'nPczCjzI2devNBz1zQrb',
  },
  'men-4': {
    text: "Experts say rest the mind. Mine works three shifts. The shirt says it so I don't have to.",
    voice: 'nPczCjzI2devNBz1zQrb',
  },
  'men-5': {
    text: "Everyone has a morning routine. Mine starts at noon. Coffee. Couch. Born to nap, forced to work.",
    voice: 'nPczCjzI2devNBz1zQrb',
  },
  'women-1': {
    text: "They told me I could do anything. I took a nap instead. Smartest move of the day.",
    voice: 'XB0fDUnXU5powFXDhCwa', // Charlotte
  },
  'women-2': {
    text: "I tried every motivation workshop. Then I joined the Zero Motivation Club. Lifetime membership.",
    voice: 'XB0fDUnXU5powFXDhCwa',
  },
  'women-3': {
    text: "My goal this year: minimal existence. Yes, that's an achievement. Yes, that's a headline.",
    voice: 'XB0fDUnXU5powFXDhCwa',
  },
  'women-4': {
    text: "Licensed in exhaustion. Years of credentials. The zip-hoodie says it for me.",
    voice: 'XB0fDUnXU5powFXDhCwa',
  },
  'women-5': {
    text: "Someone told me twenty years ago: you're prettier when you're comfortable. Now I believe it.",
    voice: 'XB0fDUnXU5powFXDhCwa',
  },
};

async function generateTTS(persona, script) {
  const audioPath = path.join(AUDIO_DIR, `${persona}-en.mp3`);
  if (fs.existsSync(audioPath)) {
    console.log(`  [${persona}] TTS cached: ${path.basename(audioPath)}`);
    return audioPath;
  }
  console.log(`  [${persona}] generating EN TTS (${script.text.length} chars)…`);
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: { 'x-tts-key': TTS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: script.text,
      voice_id: script.voice,
      model_id: 'eleven_v3',
      stability: 0.5,
      similarity: 0.78,
      style: 0.35,
      speed: 1.0,
    }),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`TTS ${res.status}: ${errTxt.slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(audioPath, bytes);
  console.log(`  [${persona}] saved ${path.basename(audioPath)} (${(bytes.length/1024).toFixed(0)} KB)`);
  return audioPath;
}

function mixReel(persona, reelPath, audioPath, outPath) {
  console.log(`  [${persona}] mixing reel + narration with ffmpeg…`);
  // narration 100% + original ambient ducked to 8%
  // Total output = same duration as reel (10s) — narration loops/clips to fit
  const args = [
    '-y',
    '-i', reelPath,
    '-i', audioPath,
    '-filter_complex',
    "[1:a]volume=1.0,acompressor=threshold=-14dB:ratio=2.5:attack=20:release=200[narr];" +
    "[0:a]volume=0.08[amb];" +
    "[narr][amb]amix=inputs=2:duration=first:dropout_transition=0,dynaudnorm=f=200:g=15[a]",
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ];
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64*1024*1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr || '').slice(0, 400)}`);
}

async function uploadStorage(localPath, storagePath) {
  const bytes = fs.readFileSync(localPath);
  const mime = localPath.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg';
  const url = `${SUPABASE_URL}/storage/v1/object/video-assets/${storagePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': mime, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) {
    const t = await res.text();
    if (!t.includes('Duplicate')) throw new Error(`upload ${storagePath}: ${res.status} ${t.slice(0, 200)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/video-assets/${storagePath}`;
}

async function main() {
  const personas = Object.keys(SCRIPTS).filter((id) => {
    const p = path.join(SAMPLES, `${id}-reel.mp4`);
    return fs.existsSync(p);
  });
  console.log(`Found ${personas.length} reels with audio to add: ${personas.join(', ')}\n`);

  const stamp = Date.now();
  const manifest = { generated_at: new Date().toISOString(), narrated: [] };

  for (const persona of personas) {
    console.log(`=== ${persona} ===`);
    const script = SCRIPTS[persona];
    const reelPath = path.join(SAMPLES, `${persona}-reel.mp4`);
    const reelBackup = path.join(SAMPLES, `${persona}-reel-original.mp4`);
    const audioPath = await generateTTS(persona, script);

    // Backup original (ambient-only) before mixing
    if (!fs.existsSync(reelBackup)) fs.copyFileSync(reelPath, reelBackup);

    const tmpOut = path.join(SAMPLES, `${persona}-reel-narrated.mp4`);
    mixReel(persona, reelBackup, audioPath, tmpOut);

    // Replace the main reel file with the narrated version
    fs.copyFileSync(tmpOut, reelPath);
    fs.unlinkSync(tmpOut);

    // Upload to Supabase Storage (new timestamp = fresh URL)
    const storageName = `samples-2026-05-19/${persona}-reel-narrated-${stamp}.mp4`;
    const publicUrl = await uploadStorage(reelPath, storageName);
    console.log(`  uploaded: ${publicUrl}`);
    manifest.narrated.push({ persona, script: script.text, voice: script.voice, public_url: publicUrl });

    await sleep(1500);
  }

  fs.writeFileSync(path.join(SAMPLES, '_narration-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone — ${manifest.narrated.length} reels narrated + uploaded.`);
  console.log(`Manifest: ${path.join(SAMPLES, '_narration-manifest.json')}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
