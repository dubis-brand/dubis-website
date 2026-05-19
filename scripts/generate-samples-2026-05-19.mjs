#!/usr/bin/env node
// generate-samples-2026-05-19.mjs — Phase 0 step 3
// For each persona with a trained soul_id: generate 1 hero still + 1 reel.
// Outputs to: dubis-website/videos/il-campaign/samples-2026-05-19/
//
// Run: node scripts/generate-samples-2026-05-19.mjs [--persona men-3] [--mode image|reel|both]
// Default mode: both

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const ARGS = process.argv.slice(2);
const onlyPersona = ARGS.includes('--persona') ? ARGS[ARGS.indexOf('--persona') + 1] : null;
const mode = ARGS.includes('--mode') ? ARGS[ARGS.indexOf('--mode') + 1] : 'both';

const PERSONAS_PATH = path.resolve('videos/il-campaign/personas-v3.json');
const PERSONAS_FILE = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
const OUT_BASE = path.resolve('videos/il-campaign/samples-2026-05-19');
fs.mkdirSync(OUT_BASE, { recursive: true });

// Slogans from DB (frozen snapshot 2026-05-19)
const PRODUCT_SLOGANS = {
  1: { slogan: "I'm not fat, I'm a limited edition", type: "t-shirt", colors: ["Charcoal","White","Cream"] },
  2: { slogan: "More of me to love", type: "t-shirt", colors: ["Black","Charcoal","Cream"] },
  3: { slogan: "Napping is my cardio", type: "hoodie", colors: ["Charcoal","Black","Cream","Navy","Forest Green"] },
  4: { slogan: "I survived. That's enough.", type: "t-shirt", colors: ["Black","White","Charcoal"] },
  5: { slogan: "Low maintenance, high value", type: "t-shirt", colors: ["Charcoal","White","Cream","Honey Brown"] },
  6: { slogan: "Not a model. Never wanted to be.", type: "hoodie", colors: ["Charcoal","Black","Cream","Navy"] },
  7: { slogan: "DUBIS — For the rest of us", type: "cap", colors: ["Black","Charcoal","Navy"] },
  8: { slogan: "Born to nap, forced to work", type: "t-shirt", colors: ["Charcoal","Black","Navy"] },
  9: { slogan: "Certified overthinker", type: "zip-hoodie", colors: ["Charcoal","Black","Forest Green"] },
  10: { slogan: "Serial napper", type: "long-sleeve", colors: ["Charcoal","Navy","Black"] },
  11: { slogan: "She believed she could, so she took a nap", type: "t-shirt", colors: ["Cream","White","Charcoal"] },
  13: { slogan: "Zero Motivation Club", type: "hoodie", colors: ["Charcoal","Black","Cream"] },
  15: { slogan: "Fashion? I prefer comfort.", type: "hoodie", colors: ["Charcoal","Black","Cream"] },
  16: { slogan: "My goal: minimal EXISTENCE.", type: "hoodie", colors: ["Charcoal","Black","Cream"] },
  17: { slogan: "Experienced in EXHAUSTION.", type: "zip-hoodie", colors: ["Charcoal","Black"] },
  18: { slogan: "Unfashionably COMFORTABLE.", type: "t-shirt", colors: ["Charcoal","White","Cream"] },
  31: { slogan: "You're prettier when you're comfortable.", type: "t-shirt", colors: ["Cream","White","Charcoal"] }
};

function hf(args, opts = {}) {
  const r = spawnSync(HF, args, { encoding: 'utf8', shell: false, maxBuffer: 100 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`hf ${args.slice(0,3).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  }
  return r.stdout;
}

function uploadFile(filepath) {
  if (!fs.existsSync(filepath)) throw new Error(`Missing: ${filepath}`);
  const out = hf(['upload', 'create', filepath, '--json']);
  return JSON.parse(out).id;
}

function pickMockupUrl(productId, color) {
  // Catalog mockups (Gelato draft-order previews, refreshed 2026-05-16)
  return `https://www.dubis.net/images/product-${productId}-${color}-front.jpg`;
}

function buildHeroPrompt(persona, slogan) {
  const garmentType = PRODUCT_SLOGANS[persona.product_default].type;
  return `Ultra-realistic photograph of the same Israeli ${persona.gender === 'men' ? 'man' : 'woman'} from the reference, age ${persona.age}, ${persona.body_anchor}. ${persona.scene_anchor}. Wearing a DUBIS ${garmentType} with "${slogan}" printed on the back in Impact-style typography. Shot on Sony A7IV 85mm f/1.8, soft Rembrandt window light from camera-left, late afternoon golden tone, visible skin pores and natural imperfections, slight asymmetry, real-skin micro-texture, Kodak Portra 400 film grain, 2K resolution, shallow depth of field, natural eye catchlights.

Negative: no plastic skin, no airbrushed, no over-smoothed, no perfect symmetry, no AI glow, no studio gloss, no model glamour, no stunning aesthetic, no anorexic body, no gym-built physique, no overcompensating happy expression, no flowers, no peace signs, no editorial cliche.`;
}

function buildReelMotionPrompt(persona) {
  // Animation prompt for image-to-video — keeps character forward-facing
  return `Subtle natural motion: slow camera dolly-in over 10 seconds, the subject's hair moves gently in a soft breeze, slight head turn left then back to camera, blinking once, subtle hand adjustment at side. ${persona.scene_anchor}. Keep the subject FRONT-FACING throughout — do not turn around, do not show back of garment. Ambient sound: distant urban Tel Aviv hum. Cinematic, lo-fi, authentic.`;
}

async function generateHero(persona) {
  const sloganInfo = PRODUCT_SLOGANS[persona.product_default];
  if (!sloganInfo) throw new Error(`No slogan for product ${persona.product_default}`);

  const color = sloganInfo.colors[0]; // Default to first listed color
  const mockupUrl = pickMockupUrl(persona.product_default, color);

  // Download mockup locally (Higgsfield upload wants local file or UUID)
  const localMockup = path.join(OUT_BASE, `_mockups`, `product-${persona.product_default}-${color}-front.jpg`);
  fs.mkdirSync(path.dirname(localMockup), { recursive: true });
  if (!fs.existsSync(localMockup)) {
    console.log(`    downloading ${mockupUrl}…`);
    const r = await fetch(mockupUrl);
    if (!r.ok) throw new Error(`mockup fetch ${r.status}: ${mockupUrl}`);
    fs.writeFileSync(localMockup, Buffer.from(await r.arrayBuffer()));
  }

  console.log(`    uploading mockup…`);
  const mockupId = uploadFile(localMockup);

  // Pick one of the persona's training photos as additional face reference
  // (text2image_soul_v2 takes both custom_reference_id AND medias — combo gives best identity lock)
  const faceRef = path.resolve(`images/personas/${persona.id}/photo-01.jpg`);
  const faceRefId = uploadFile(faceRef);

  const prompt = buildHeroPrompt(persona, sloganInfo.slogan);
  const mediasJson = JSON.stringify([
    { role: 'image', data: { id: mockupId, type: 'media_input' } },
    { role: 'image', data: { id: faceRefId, type: 'media_input' } },
  ]);

  console.log(`    submitting text2image_soul_v2 (soul=${persona.soul_id?.slice(0, 8)}…)…`);
  const args = [
    'generate', 'create', 'text2image_soul_v2',
    '--prompt', prompt,
    '--aspect_ratio', '4:5',
    '--quality', '2k',
    '--medias', mediasJson,
  ];
  // custom_reference_id needs the trained Soul; CLI passes as --custom_reference_id JSON
  if (persona.soul_id) {
    args.push('--custom_reference_id', JSON.stringify({ id: persona.soul_id, type: 'soul_2' }));
  }
  args.push('--wait', '--wait-timeout', '15m', '--json');

  const out = hf(args);
  let result;
  try { result = JSON.parse(out); } catch { result = { raw: out.slice(0, 500) }; }
  // hf typically returns array of job IDs OR URLs after --wait
  const url = (Array.isArray(result) ? result[0] : (result.url || result.result_url || result.payload?.url));
  if (!url) {
    console.warn(`    hero result has no URL — saving raw response. ${JSON.stringify(result).slice(0,300)}`);
    return { url: null, raw: result };
  }

  // Download hero image locally
  const heroPath = path.join(OUT_BASE, `${persona.id}-hero.jpg`);
  const r = await fetch(url);
  fs.writeFileSync(heroPath, Buffer.from(await r.arrayBuffer()));
  console.log(`    hero saved: ${heroPath}`);
  return { url, local: heroPath };
}

async function generateReel(persona, heroPath) {
  if (!heroPath || !fs.existsSync(heroPath)) {
    console.log(`    no hero image — skipping reel`);
    return null;
  }
  console.log(`    uploading hero as start frame…`);
  const startId = uploadFile(heroPath);

  const prompt = buildReelMotionPrompt(persona);
  const mediasJson = JSON.stringify([
    { role: 'start_image', data: { id: startId, type: 'media_input' } },
  ]);

  console.log(`    submitting seedance_2_0 i2v (10s 9:16)…`);
  const args = [
    'generate', 'create', 'seedance_2_0',
    '--prompt', prompt,
    '--aspect_ratio', '9:16',
    '--duration', '10',
    '--resolution', '720p',
    '--mode', 'std',
    '--medias', mediasJson,
    '--wait', '--wait-timeout', '20m', '--json',
  ];
  const out = hf(args);
  let result;
  try { result = JSON.parse(out); } catch { result = { raw: out.slice(0, 500) }; }
  const url = (Array.isArray(result) ? result[0] : (result.url || result.result_url || result.payload?.url));
  if (!url) {
    console.warn(`    reel result has no URL — saving raw. ${JSON.stringify(result).slice(0,300)}`);
    return null;
  }

  const reelPath = path.join(OUT_BASE, `${persona.id}-reel.mp4`);
  const r = await fetch(url);
  fs.writeFileSync(reelPath, Buffer.from(await r.arrayBuffer()));
  console.log(`    reel saved: ${reelPath}`);
  return { url, local: reelPath };
}

async function main() {
  const startBalance = JSON.parse(hf(['account', 'status', '--json'])).credits;
  console.log(`Starting balance: ${startBalance} credits`);

  const targets = (onlyPersona
    ? PERSONAS_FILE.personas.filter((p) => p.id === onlyPersona)
    : PERSONAS_FILE.personas).filter((p) => p.soul_id); // Only personas with trained Souls

  if (!targets.length) {
    console.error(`No personas with soul_id ready. Run train-souls first.`);
    process.exit(1);
  }
  console.log(`Generating samples for ${targets.length} personas (mode=${mode})\n`);

  const manifest = { generated_at: new Date().toISOString(), samples: [] };

  for (const persona of targets) {
    console.log(`\n=== ${persona.id} (product ${persona.product_default}: ${PRODUCT_SLOGANS[persona.product_default]?.slogan}) ===`);
    const sample = { persona_id: persona.id, product_id: persona.product_default, slogan: PRODUCT_SLOGANS[persona.product_default]?.slogan };
    try {
      if (mode === 'image' || mode === 'both') {
        const hero = await generateHero(persona);
        sample.hero_url = hero?.url;
        sample.hero_local = hero?.local;
        if (mode === 'both' && hero?.local) {
          const reel = await generateReel(persona, hero.local);
          sample.reel_url = reel?.url;
          sample.reel_local = reel?.local;
        }
      } else if (mode === 'reel') {
        // Reel-only: need pre-existing hero
        const existingHero = path.join(OUT_BASE, `${persona.id}-hero.jpg`);
        const reel = await generateReel(persona, existingHero);
        sample.reel_url = reel?.url;
        sample.reel_local = reel?.local;
      }
    } catch (e) {
      console.error(`  ${persona.id} FAIL: ${e.message}`);
      sample.error = e.message;
    }
    manifest.samples.push(sample);
    fs.writeFileSync(path.join(OUT_BASE, '_manifest.json'), JSON.stringify(manifest, null, 2));
    await sleep(2000);
  }

  const endBalance = JSON.parse(hf(['account', 'status', '--json'])).credits;
  console.log(`\n=== DONE ===`);
  console.log(`Samples: ${manifest.samples.filter((s) => !s.error).length} success / ${manifest.samples.filter((s) => s.error).length} failed`);
  console.log(`Credit usage: ${startBalance} → ${endBalance} (delta: ${startBalance - endBalance})`);
  console.log(`Manifest: ${path.join(OUT_BASE, '_manifest.json')}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
