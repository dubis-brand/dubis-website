#!/usr/bin/env node
// generate-samples-2026-05-19.mjs (v2 — virtual_model_tryout pipeline)
// Per persona: 1 front hero + 1 back hero + 1 reel
// Uses hf product-photoshoot virtual_model_tryout for hero (exact garment from mockup)
// Uses hf generate create seedance_2_0 for reel (front hero as start frame)
//
// Why this pipeline:
//   - oren requirement (2026-05-19): personas must wear the EXACT DUBIS product
//     with the actual slogan printed, not a generic garment.
//   - virtual_model_tryout takes face photo + catalog mockup as 2 references and
//     composites them faithfully — the mockup IS the Gelato draft-order preview
//     of the real printed garment.
//   - Soul ID NOT used here (those work via text2image_soul_v2 which doesn't
//     preserve product fidelity well). Soul trainings continue for future content
//     cycles where infinite scene variations are needed.
//
// Run: node scripts/generate-samples-2026-05-19.mjs [--persona men-3] [--skip-reel]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const ARGS = process.argv.slice(2);
const onlyPersona = ARGS.includes('--persona') ? ARGS[ARGS.indexOf('--persona') + 1] : null;
const skipReel = ARGS.includes('--skip-reel');

const PERSONAS_PATH = path.resolve('videos/il-campaign/personas-v3.json');
const PERSONAS_FILE = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
const OUT_BASE = path.resolve('videos/il-campaign/samples-2026-05-19');
fs.mkdirSync(OUT_BASE, { recursive: true });

// product_default → garment color. ONLY combos validated against dubis_products.colors DB.
// (Honey-Brown removed 2026-04-23 — leftover mockup files don't reflect real SKUs.)
// 7 colors across 10 personas.
const PRODUCT_SLOGANS = {
  3:  { slogan: "Napping is my cardio", type: "hoodie", color: "Forest-Green" },         // men-1
  6:  { slogan: "Not a model. Never wanted to be.", type: "hoodie", color: "Charcoal" }, // men-2 (DONE)
  15: { slogan: "Fashion? I prefer comfort.", type: "hoodie", color: "Navy" },           // men-3
  9:  { slogan: "Certified overthinker", type: "zip-hoodie", color: "Navy" },            // men-4
  8:  { slogan: "Born to nap, forced to work", type: "t-shirt", color: "Red" },          // men-5 (was 10)
  11: { slogan: "She believed she could, so she took a nap", type: "t-shirt", color: "Cream" }, // women-1
  13: { slogan: "Zero Motivation Club", type: "hoodie", color: "Cream" },                // women-2 (was Honey-Brown, not in DB)
  16: { slogan: "My goal: minimal EXISTENCE.", type: "hoodie", color: "White" },         // women-3
  17: { slogan: "Experienced in EXHAUSTION.", type: "zip-hoodie", color: "Black" },      // women-4
  31: { slogan: "You're prettier when you're comfortable.", type: "t-shirt", color: "White" }, // women-5
};

function hf(args, opts = {}) {
  const r = spawnSync(HF, args, { encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`hf ${args.slice(0, 4).join(' ')} (${r.status}): ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  return r.stdout;
}

function balance() {
  return JSON.parse(hf(['account', 'status', '--json'])).credits;
}

function pickMockupPath(productId, color, face) {
  return path.resolve(`images/product-${productId}-${color}-${face}.jpg`);
}

function buildFrontPrompt(persona, slogan, garmentType, color) {
  return `${persona.age}-year-old Israeli ${persona.gender === 'men' ? 'man' : 'woman'} with ${persona.body_anchor}. ${persona.scene_anchor_en || persona.scene_anchor}. Wearing the EXACT ${color} DUBIS ${garmentType} shown in the reference, front-facing camera, three-quarter body framing. Soft window light, late afternoon golden tone, visible skin pores and natural imperfections, slight asymmetry, anti-stunning real-body aesthetic, candid authentic feel. Shot on Sony A7IV 85mm f/1.8, Kodak Portra 400 film grain, natural eye catchlights. The DUBIS™ chest logo from the reference garment must be clearly visible on the wearer's left chest.`;
}

function buildBackPrompt(persona, slogan, garmentType, color) {
  // NSFW-safe phrasing (no "shoulder blades", no "viewed from behind" — those triggered
  // Higgsfield's content filter in the 2026-05-19 batch). Focus on the GARMENT, not the body.
  return `Three-quarter rear angle of a ${persona.age}-year-old Israeli ${persona.gender === 'men' ? 'man' : 'woman'} with ${persona.body_anchor}, looking back over the shoulder toward the camera with a calm expression. ${persona.scene_anchor_en || persona.scene_anchor}. The DUBIS ${color} ${garmentType} from the reference is the focal point — the back slogan "${slogan}" is sharply rendered, fully readable, centered on the garment, matching the typography of the reference exactly. Soft window light, late afternoon golden tone, Kodak Portra 400 film grain, candid authentic feel, photographic documentary style.`;
}

function buildReelPrompt(persona, slogan, garmentType, color) {
  return `10-second documentary lifestyle reel of a ${persona.age}-year-old Israeli ${persona.gender === 'men' ? 'man' : 'woman'} wearing the ${color} DUBIS ${garmentType} from the start frame. ${persona.scene_anchor_en || persona.scene_anchor}.

Subtle natural motion throughout: slow camera dolly-in, gentle hair movement in breeze, small head turn left then back to camera, blinking, hand adjustment, slight smile then neutral. Character STAYS FRONT-FACING — never turns around, do not show back of garment in motion (the back slogan reveal is handled separately in post-compose).

Cinematic anti-stunning style: Kodak Portra 400 film grain, soft golden hour tone, Sony A7IV 85mm aesthetic, shallow depth of field. Authentic IL lifestyle ad. No on-screen text overlays.

Negative: no studio gloss, no model glamour, no overcompensating happy expression, no spinning, no full body turn, no back-of-garment view (will composite separately).`;
}

async function generateHero(persona, face) {
  const sloganInfo = PRODUCT_SLOGANS[persona.product_default];
  if (!sloganInfo) throw new Error(`No slogan for product ${persona.product_default}`);

  const mockup = pickMockupPath(persona.product_default, sloganInfo.color, face);
  if (!fs.existsSync(mockup)) {
    console.warn(`    no ${face} mockup: ${mockup}`);
    return null;
  }
  const personaPhoto = path.resolve(`images/personas/${persona.id}/photo-01.jpg`);

  const prompt = face === 'front'
    ? buildFrontPrompt(persona, sloganInfo.slogan, sloganInfo.type, sloganInfo.color)
    : buildBackPrompt(persona, sloganInfo.slogan, sloganInfo.type, sloganInfo.color);

  console.log(`    submitting product-photoshoot virtual_model_tryout (${face})…`);
  const args = [
    'product-photoshoot', 'create',
    '--mode', 'virtual_model_tryout',
    '--prompt', prompt,
    '--image', personaPhoto,
    '--image', mockup,
    '--count', '1',
    '--aspect_ratio', face === 'front' ? '3:4' : '3:4',
    '--timeout', '8m',
  ];
  // product-photoshoot returns URLs on stdout, one per line
  const out = hf(args);
  const urls = out.trim().split('\n').filter((l) => l.startsWith('http'));
  if (!urls.length) {
    console.warn(`    no URL in output: ${out.slice(0, 200)}`);
    return null;
  }
  const url = urls[0];
  const heroPath = path.join(OUT_BASE, `${persona.id}-${face === 'front' ? 'hero' : 'back'}.jpg`);
  const r = await fetch(url);
  fs.writeFileSync(heroPath, Buffer.from(await r.arrayBuffer()));
  console.log(`    saved: ${path.basename(heroPath)}`);
  return { url, local: heroPath };
}

async function generateReel(persona, heroPath) {
  if (!heroPath || !fs.existsSync(heroPath)) {
    console.log(`    no front hero — skipping reel`);
    return null;
  }
  const sloganInfo = PRODUCT_SLOGANS[persona.product_default];
  const prompt = buildReelPrompt(persona, sloganInfo.slogan, sloganInfo.type, sloganInfo.color);
  console.log(`    submitting seedance_2_0 (10s 9:16 from start frame)…`);

  const args = [
    'generate', 'create', 'seedance_2_0',
    '--prompt', prompt,
    '--aspect_ratio', '9:16',
    '--duration', '10',
    '--resolution', '720p',
    '--mode', 'std',
    '--image', heroPath,
    '--wait', '--wait-timeout', '20m', '--json',
  ];
  const out = hf(args);
  let result;
  try { result = JSON.parse(out); } catch { return null; }
  let url = null;
  if (Array.isArray(result) && result.length > 0) {
    url = result[0].result_url || result[0].url;
  } else if (result && typeof result === 'object') {
    url = result.result_url || result.url;
  }
  if (!url) {
    console.warn(`    reel: no URL. ${JSON.stringify(result).slice(0, 200)}`);
    return null;
  }
  const reelPath = path.join(OUT_BASE, `${persona.id}-reel.mp4`);
  const r = await fetch(url);
  fs.writeFileSync(reelPath, Buffer.from(await r.arrayBuffer()));
  console.log(`    saved: ${path.basename(reelPath)}`);
  return { url, local: reelPath };
}

async function processPersona(persona) {
  const sloganInfo = PRODUCT_SLOGANS[persona.product_default];
  console.log(`\n=== ${persona.id} (product ${persona.product_default}: "${sloganInfo?.slogan}") ===`);
  const sample = {
    persona_id: persona.id,
    product_id: persona.product_default,
    slogan: sloganInfo?.slogan,
    garment: `${sloganInfo?.color} ${sloganInfo?.type}`,
  };
  try {
    const front = await generateHero(persona, 'front');
    sample.front_url = front?.url;
    sample.front_local = front?.local;

    const back = await generateHero(persona, 'back');
    sample.back_url = back?.url;
    sample.back_local = back?.local;

    if (!skipReel && front?.local) {
      const reel = await generateReel(persona, front.local);
      sample.reel_url = reel?.url;
      sample.reel_local = reel?.local;
    }
  } catch (e) {
    console.error(`  ${persona.id} ERR: ${e.message.slice(0, 300)}`);
    sample.error = e.message;
  }
  return sample;
}

async function main() {
  const start = balance();
  console.log(`Starting balance: ${start} credits`);

  const targets = onlyPersona
    ? PERSONAS_FILE.personas.filter((p) => p.id === onlyPersona)
    : PERSONAS_FILE.personas;

  if (!targets.length) { console.error(`No personas`); process.exit(1); }

  const MANIFEST_PATH = path.join(OUT_BASE, '_manifest.json');
  let manifest = { generated_at: new Date().toISOString(), pipeline: 'virtual_model_tryout', samples: [] };
  if (fs.existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch {}
  }

  for (const persona of targets) {
    // Smart skip: regenerate only what's actually missing on disk (manifest may be stale)
    const heroPath = path.join(OUT_BASE, `${persona.id}-hero.jpg`);
    const backPath = path.join(OUT_BASE, `${persona.id}-back.jpg`);
    const reelPath = path.join(OUT_BASE, `${persona.id}-reel.mp4`);
    const hasFront = fs.existsSync(heroPath);
    const hasBack = fs.existsSync(backPath);
    const hasReel = fs.existsSync(reelPath);

    if (hasFront && hasBack && hasReel) {
      console.log(`[${persona.id}] SKIP — front+back+reel all on disk`);
      continue;
    }

    // Partial regeneration: do only what's missing
    console.log(`\n=== ${persona.id} :: needs ${[!hasFront && 'front', !hasBack && 'back', !hasReel && 'reel'].filter(Boolean).join(', ')} ===`);
    const sloganInfo = PRODUCT_SLOGANS[persona.product_default];
    const existing = manifest.samples.find((s) => s.persona_id === persona.id) || { persona_id: persona.id };
    const sample = {
      ...existing,
      persona_id: persona.id,
      product_id: persona.product_default,
      slogan: sloganInfo?.slogan,
      garment: `${sloganInfo?.color} ${sloganInfo?.type}`,
    };
    delete sample.error;

    // Per-asset try/catch (2026-05-20 lesson): back failure (e.g. NSFW filter on
    // men-3 steering-wheel scene) MUST NOT block reel. Each asset is independent.
    // For the reel, we only need the front hero — the back-reveal segment uses
    // the catalog Gelato mockup, not the AI-generated persona back.
    const errors = [];
    if (!hasFront) {
      try {
        const front = await generateHero(persona, 'front');
        sample.front_url = front?.url;
        sample.front_local = front?.local;
      } catch (e) {
        errors.push(`front: ${e.message.slice(0, 150)}`);
        console.error(`  ${persona.id} front ERR: ${e.message.slice(0, 300)}`);
      }
    }
    if (!hasBack) {
      try {
        const back = await generateHero(persona, 'back');
        sample.back_url = back?.url;
        sample.back_local = back?.local;
      } catch (e) {
        errors.push(`back: ${e.message.slice(0, 150)}`);
        console.error(`  ${persona.id} back ERR: ${e.message.slice(0, 300)}`);
      }
    }
    if (!hasReel && !skipReel) {
      try {
        const frontForReel = fs.existsSync(heroPath) ? heroPath : sample.front_local;
        if (frontForReel) {
          const reel = await generateReel(persona, frontForReel);
          sample.reel_url = reel?.url;
          sample.reel_local = reel?.local;
        } else {
          errors.push('reel: no front hero available');
        }
      } catch (e) {
        errors.push(`reel: ${e.message.slice(0, 150)}`);
        console.error(`  ${persona.id} reel ERR: ${e.message.slice(0, 300)}`);
      }
    }
    if (errors.length) sample.error = errors.join(' | ');

    manifest.samples = manifest.samples.filter((s) => s.persona_id !== persona.id).concat(sample);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    await sleep(2000);
  }

  const end = balance();
  console.log(`\n=== DONE ===`);
  console.log(`Samples: ${manifest.samples.filter((s) => !s.error).length} OK / ${manifest.samples.filter((s) => s.error).length} ERR`);
  console.log(`Credit usage: ${start} → ${end} (delta: ${(start - end).toFixed(2)})`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
