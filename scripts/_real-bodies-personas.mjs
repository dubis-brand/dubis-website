#!/usr/bin/env node
// REAL-BODIES persona refresh (2026-07-11) — community feedback: "כולם דוגמנים, אין כרס של אבא".
// Stage 1: 6 fresh faces (nano-banana class = gemini-2.5-flash-image), REAL bodies visible.
// Stage 2: hero try-on — face-ref + REAL product front mockup ref, logo must read DUBIS™.
// Output: preview/img/real-bodies/  (approval assets only — NOT published)
// Usage: node scripts/_real-bodies-personas.mjs faces | heroes | one <id>
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

let KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  const t = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const m = t.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
  if (m) KEY = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!KEY) { console.error('no key'); process.exit(1); }

const OUT = path.resolve('preview/img/real-bodies');
fs.mkdirSync(OUT, { recursive: true });

const FILM = `Photorealistic documentary photograph, shot on Sony A7IV 35mm f/2.2, soft natural light, Kodak Portra 400 film grain, visible real skin texture and pores, natural catchlights, candid editorial feel. Vertical 3:4 portrait orientation.`;
const REALBODY_NEG = `STRICT: absolutely NOT a model, NOT fit, NOT athletic, NOT slim, NOT toned. No airbrushed skin, no AI glow, no fashion-glamour lighting, no gym physique, no jawline sculpting. Ordinary tired real person.`;

const PERSONAS = [
  { id:'r1', gender:'m', age:51, product:38, color:'White', type:'tank top',
    body:`a heavyset Israeli man around 51 with a LARGE round dad belly that clearly pushes the garment forward, thick soft arms with no muscle definition, balding crown with short grey side hair, grey stubble, warm tired eyes`,
    scene:`standing on a sunlit Tel Aviv apartment balcony with plants and old plastic chairs, holding a small coffee cup, relaxed half-smile` },
  { id:'r2', gender:'f', age:47, product:23, color:'Red', type:'crew-neck t-shirt',
    body:`a full-figured Israeli woman around 47 with a soft round belly and wide soft upper arms, double chin when she smiles, shoulder-length wavy brown-grey hair, no makeup, laugh lines`,
    scene:`in a real lived-in Israeli kitchen in the morning, leaning on the counter next to a finjan coffee pot, unimpressed morning face` },
  { id:'r3', gender:'m', age:44, product:32, color:'Cream', type:'crew-neck t-shirt',
    body:`a chubby Israeli man around 44 with a prominent soft belly and love handles visible under the shirt, double chin, receding hairline with short dark thinning hair, simple glasses, ordinary soft arms`,
    scene:`sitting on a worn living-room sofa with kids' toys blurred in the background, TV remote next to him, dry friendly expression` },
  { id:'r4', gender:'f', age:52, product:41, color:'White', type:'tank top',
    body:`a plump Israeli woman around 52 with a heavy soft build, full round belly and thick soft arms, silver-grey curly hair, reading glasses pushed into her hair, warm confident face`,
    scene:`on a shaded Israeli mirpeset (balcony) with laundry lines and potted herbs behind her, hanging a towel, mid-laugh` },
  { id:'r5', gender:'m', age:39, product:40, color:'Royal Blue', type:'zip-up hoodie',
    body:`a stocky overweight Israeli man around 39 with a big belly stretching the hoodie, round full face, short hair already thinning at the crown, few days of beard, thick forearms`,
    scene:`standing in a stairwell entrance of an old Israeli apartment building at evening, carrying a watermelon under one arm, caught-mid-moment honest look. There are NO boxes, NO packages, NO printed objects in the scene` },
  { id:'r6', gender:'f', age:42, product:31, color:'White', type:'crew-neck t-shirt',
    body:`an ordinary Israeli woman around 42 with a soft post-kids belly and wide hips, ordinary untoned arms, messy dark bun with grey streaks, tired but warm eyes, no makeup`,
    scene:`on a bench at a neighborhood playground at golden hour, kid's scooter leaning next to her, exhaling the end-of-day exhale` },
];

const b64 = (p) => fs.readFileSync(path.resolve(p)).toString('base64');

async function gen(parts, retries = 2) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}`;
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.85, responseModalities: ['IMAGE'] } }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const j = await res.json();
      const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
      if (!part) throw new Error('no image in response');
      return Buffer.from(part.inlineData.data, 'base64');
    } catch (e) { if (a === retries) throw e; console.warn(`  retry ${a + 1}: ${e.message}`); await sleep(2500 * (a + 1)); }
  }
}

async function makeFace(p) {
  const prompt = `${FILM}
Medium shot from mid-thigh up so the body build is CLEARLY visible: ${p.body}.
He/she wears a plain blank ${p.color.toLowerCase() === 'white' || p.color.toLowerCase() === 'cream' ? 'light' : 'dark'} ${p.type} with NO text and NO logo (completely blank garment).
Scene: ${p.scene}.
${REALBODY_NEG}
No text anywhere in the image.`;
  return gen([{ text: prompt }]);
}

async function makeHero(p) {
  const mockup = `images/product-${p.product}-${p.color.replace(/ /g, '-')}-front.jpg`;
  const mock = fs.existsSync(mockup) ? mockup : `images/product-${p.product}-${p.color}-front.jpg`;
  const prompt = `${FILM}
Image 1 is the person reference: keep the SAME person, same face, same identity, and the SAME heavy REAL body build — ${p.body}. Do NOT slim the person down; the belly must stay just as large and visible, pressing against the garment.
Image 2 is the garment reference: the person now wears EXACTLY this garment — a ${p.color} ${p.type} — same color, same cut, with the small grey "DUBIS™" logo printed on the chest exactly as in the reference. The logo text must read exactly "DUBIS" — clean, sharp, correctly spelled. The garment fits relaxed on the heavy body, slightly stretched over the belly, natural wrinkles.
Scene: ${p.scene}. Front-facing towards camera, chest logo clearly visible and not covered.
${REALBODY_NEG}
No other text anywhere in the image.`;
  return gen([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: b64(path.join(OUT, `face-${p.id}.jpg`)) } },
    { inlineData: { mimeType: 'image/jpeg', data: b64(mock) } },
  ]);
}

const mode = process.argv[2] || 'faces';
const only = process.argv[3];
for (const p of PERSONAS) {
  if (only && p.id !== only) continue;
  try {
    if (mode === 'faces' || mode === 'one-face') {
      process.stdout.write(`face ${p.id} (#${p.product} ${p.color})… `);
      fs.writeFileSync(path.join(OUT, `face-${p.id}.jpg`), await makeFace(p));
      console.log('OK');
    }
    if (mode === 'heroes' || mode === 'one-hero') {
      process.stdout.write(`hero ${p.id} (#${p.product} ${p.color})… `);
      fs.writeFileSync(path.join(OUT, `hero-${p.id}.jpg`), await makeHero(p));
      console.log('OK');
    }
  } catch (e) { console.error(`FAIL ${p.id}: ${e.message}`); }
  await sleep(1500);
}
console.log('done');
