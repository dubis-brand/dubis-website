#!/usr/bin/env node
// regen-il-personas-2026-05-19.mjs
// Phase 0 regen — 10 personas × 10 photos each = 100 face/upper-body photos
// for Higgsfield Soul ID training.
//
// Strategy:
//   - PLAIN garment in prompt (no DUBIS™, no slogan) — Soul training learns FACE,
//     not branding. Garment branding gets composited downstream by Higgsfield
//     product-photoshoot + catalog mockup reference.
//   - 10 varied poses per persona: front, 3/4 left, 3/4 right, slight up, slight
//     down, expression variants (neutral, smile, talking), distance variants
//     (headshot, half-body), lighting variants (window, golden hour, indoor warm).
//   - Saves to dubis-website/images/personas/{persona_id}/photo-NN.jpg
//   - Uses Gemini 2.5 Flash Image (cheap, ~$0.04 per image)
//
// Run: node scripts/regen-il-personas-2026-05-19.mjs [--persona men-3] [--start 1] [--end 10]
// Env: GEMINI_API_KEY must be set
//
// Idempotent: skips existing files unless --force.

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const ARGS = process.argv.slice(2);
const onlyPersona = ARGS.includes('--persona') ? ARGS[ARGS.indexOf('--persona') + 1] : null;
const force = ARGS.includes('--force');
const startN = ARGS.includes('--start') ? Number(ARGS[ARGS.indexOf('--start') + 1]) : 1;
const endN   = ARGS.includes('--end')   ? Number(ARGS[ARGS.indexOf('--end') + 1])   : 10;

const PERSONAS_PATH = path.resolve('videos/il-campaign/personas-v3.json');
const personasData = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
const PERSONAS = personasData.personas;
const OUT_BASE = path.resolve('images/personas');

// 10 prompt variations per persona: vary angle / lighting / expression / distance
const VARIATIONS = [
  { idx: 1, angle: 'front-facing direct eye contact', lighting: 'soft natural window light from left, indoor', expression: 'neutral relaxed', distance: 'shoulders-up headshot', framing: 'centered, plain background slight bokeh' },
  { idx: 2, angle: '3/4 turn to camera-left', lighting: 'golden hour warm light from right', expression: 'subtle hint of smile', distance: 'chest-up', framing: 'off-center composition right third' },
  { idx: 3, angle: '3/4 turn to camera-right', lighting: 'overcast soft diffused outdoor', expression: 'thoughtful mid-sentence speaking', distance: 'half-body', framing: 'slight side profile, neutral background' },
  { idx: 4, angle: 'slight upward angle (camera below)', lighting: 'Rembrandt lighting triangle on cheek', expression: 'natural calm', distance: 'shoulders-up', framing: 'cinematic mood' },
  { idx: 5, angle: 'slight downward angle (camera above)', lighting: 'butterfly light from above', expression: 'looking away from camera, candid', distance: 'half-body', framing: 'spontaneous feel' },
  { idx: 6, angle: 'profile view side-on', lighting: 'window backlight rim, soft fill from front', expression: 'looking forward, focused', distance: 'chest-up', framing: 'silhouette-leaning composition' },
  { idx: 7, angle: 'looking down then up (candid moment)', lighting: 'soft kitchen indoor warm tungsten', expression: 'mid-laugh natural', distance: 'shoulders-up', framing: 'authentic in-the-moment' },
  { idx: 8, angle: 'front-facing chin slightly lifted', lighting: 'studio softbox 45 degrees', expression: 'confident no smile', distance: 'half-body', framing: 'editorial neutral background' },
  { idx: 9, angle: 'looking off to camera-right corner', lighting: 'late afternoon golden side light', expression: 'sardonic half-smirk', distance: 'shoulders-up', framing: 'movie-still feeling' },
  { idx: 10, angle: 'three-quarter back-turn glancing over shoulder', lighting: 'warm interior lamp', expression: 'relaxed neutral', distance: 'half-body', framing: 'classic over-shoulder portrait' },
];

function buildPrompt(persona, variation) {
  const { age, gender, body_anchor } = persona;
  // Plain garment — Soul training learns FACE not branding
  const garment = gender === 'men'
    ? 'plain blank gray t-shirt with absolutely no text, no logos, no graphics, no prints, no patches, no embroidery anywhere'
    : 'plain blank cream-color t-shirt with absolutely no text, no logos, no graphics, no prints, no patches, no embroidery anywhere';

  return `Ultra-realistic photograph of a ${age}-year-old Israeli ${gender === 'men' ? 'man' : 'woman'}, ${body_anchor}, wearing ${garment}. ${variation.angle}, ${variation.lighting}, ${variation.expression}, ${variation.distance}, ${variation.framing}. Shot on Sony A7IV 85mm f/1.8 ISO 200, visible skin pores and natural imperfections, slight asymmetry, real-skin micro-texture, subtle freckles or sun spots where natural for age, Kodak Portra 400 film grain, 2K resolution, shallow depth of field, natural eye catchlights.

Negative: no plastic skin, no airbrushed, no over-smoothed, no perfect symmetry, no AI glow, no studio gloss, no model glamour, no stunning aesthetic, no perfect lighting, no anorexic body, no gym-built physique, no overcompensating happy expression, no flowers, no peace signs, no editorial cliche, no group photo, no sunglasses, no hat covering face.`;
}

async function generateOne(persona, variation, retries = 2) {
  const prompt = buildPrompt(persona, variation);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, responseModalities: ['IMAGE'] },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('No image data in response: ' + JSON.stringify(json).slice(0, 200));
      return Buffer.from(part.inlineData.data, 'base64');
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`  retry ${attempt + 1}/${retries}: ${e.message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

async function processPersona(persona) {
  console.log(`\n=== ${persona.id} (${persona.age}yo ${persona.gender}, ${persona.body_anchor}) ===`);
  const dir = path.join(OUT_BASE, persona.id);
  fs.mkdirSync(dir, { recursive: true });
  let made = 0, skipped = 0, failed = 0;

  for (const variation of VARIATIONS) {
    if (variation.idx < startN || variation.idx > endN) continue;
    const fname = path.join(dir, `photo-${String(variation.idx).padStart(2, '0')}.jpg`);
    if (fs.existsSync(fname) && !force) {
      console.log(`  [${variation.idx}/10] SKIP existing ${path.basename(fname)}`);
      skipped++; continue;
    }
    try {
      console.log(`  [${variation.idx}/10] generating: ${variation.angle.slice(0, 40)}…`);
      const bytes = await generateOne(persona, variation);
      fs.writeFileSync(fname, bytes);
      console.log(`  [${variation.idx}/10] saved ${path.basename(fname)} (${(bytes.length / 1024).toFixed(0)} KB)`);
      made++;
      await sleep(1500); // pace requests
    } catch (e) {
      console.error(`  [${variation.idx}/10] FAIL: ${e.message}`);
      failed++;
    }
  }
  console.log(`  ${persona.id}: ${made} made, ${skipped} skipped, ${failed} failed`);
  return { made, skipped, failed };
}

async function main() {
  const startTs = Date.now();
  const targets = onlyPersona ? PERSONAS.filter((p) => p.id === onlyPersona) : PERSONAS;
  if (!targets.length) { console.error(`Persona "${onlyPersona}" not found`); process.exit(1); }

  console.log(`Phase 0 regen: ${targets.length} personas × ${endN - startN + 1} photos = ${targets.length * (endN - startN + 1)} images max`);
  console.log(`Output base: ${OUT_BASE}\n`);

  let totalMade = 0, totalSkipped = 0, totalFailed = 0;
  for (const persona of targets) {
    const r = await processPersona(persona);
    totalMade += r.made; totalSkipped += r.skipped; totalFailed += r.failed;
  }

  const dur = ((Date.now() - startTs) / 1000).toFixed(0);
  console.log(`\n=== DONE in ${dur}s ===`);
  console.log(`Total: ${totalMade} made, ${totalSkipped} skipped, ${totalFailed} failed`);
  console.log(`Approx Gemini cost: $${(totalMade * 0.04).toFixed(2)}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
