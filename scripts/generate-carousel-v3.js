#!/usr/bin/env node
/**
 * generate-carousel-v3.js — Lifestyle photos from real product mockups.
 * Approach: pass the actual product mockup JPG to Gemini as a visual reference,
 * then ask it to generate a candid lifestyle photo of an ordinary person wearing
 * that exact garment. No overlays, no badge stickers.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Walk up from the script dir looking for known env files
const ENV_CANDIDATES = [
  '../.env.local',
  '../.env',
  '../../../../.env.local',
  '../../../../.env',
  '../../../../../.env.agents',
  '../../../../../.env.local',
];
for (const rel of ENV_CANDIDATES) {
  try { require('dotenv').config({ path: path.resolve(__dirname, rel) }); } catch {}
}

const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').replace(/^"|"$/g, '');
if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

const IMAGES_DIR = path.resolve(__dirname, '../images');
const OUT_DIR = path.join(IMAGES_DIR, 'carousel', 'v3');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MODEL = 'gemini-2.5-flash-image';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

const FRONT_JOBS = [
  {
    out: 'front-1.jpg',
    ref: 'product-1-Black-front.jpg',
    garment: 'black crew-neck t-shirt with a small DUBIS chest badge',
    person: 'a man in his late 40s, slightly overweight, salt-and-pepper beard, regular guy',
    setting: 'walking on a sunlit Brooklyn brownstone street, mid-morning',
  },
  {
    out: 'front-2.jpg',
    ref: 'product-1-White-front.jpg',
    garment: 'white crew-neck t-shirt with a small DUBIS chest badge',
    person: 'a woman around 42, soft curvy body type, natural curly hair, no makeup',
    setting: 'sitting at an outdoor cafe table with a coffee, candid morning light',
  },
  {
    out: 'front-3.jpg',
    ref: 'product-3-Navy-front.jpg',
    garment: 'navy blue pullover hoodie with a small DUBIS chest badge and front kangaroo pocket',
    person: 'a man around 38, average build, short beard, glasses, looks like a teacher or dad',
    setting: 'standing on an urban side street near a brick wall, overcast afternoon',
  },
  {
    out: 'front-4.jpg',
    ref: 'product-13-Charcoal-front.jpg',
    garment: 'charcoal grey pullover hoodie with a small DUBIS chest badge',
    person: 'a woman around 50, plus size, short silver hair, warm confident expression',
    setting: 'browsing a Sunday street market with produce stalls, candid',
  },
  {
    out: 'front-5.jpg',
    ref: 'product-1-Navy-front.jpg',
    garment: 'navy blue crew-neck t-shirt with a small DUBIS chest badge',
    person: 'a man around 45, dad-bod build, beard, looks like a contractor on his weekend',
    setting: 'in a public park with green trees behind, sunny afternoon',
  },
  {
    out: 'front-6.jpg',
    ref: 'product-15-Black-front.jpg',
    garment: 'black pullover hoodie with a small DUBIS chest badge',
    person: 'a woman around 36, athletic but real, no makeup, hair tied back',
    setting: 'walking through a graffitied urban alley, late afternoon golden light',
  },
];

const BACK_JOBS = [
  {
    out: 'back-1.jpg',
    ref: 'product-1-Black-back.jpg',
    garment: 'black crew-neck t-shirt',
    slogan: "BUILT DIFFERENT. THAT'S THE POINT.",
    person: 'a man around 47, average build with a slight belly, salt-and-pepper hair',
    setting: 'walking away from camera down a sunlit city street, candid',
  },
  {
    out: 'back-2.jpg',
    ref: 'product-3-Navy-back.jpg',
    garment: 'navy blue pullover hoodie',
    slogan: 'LOW MAINTENANCE, HIGH VALUE.',
    person: 'a woman around 44, soft curvy body, natural hair, walking with hands in pockets',
    setting: 'walking away on a tree-lined park path, autumn light',
  },
  {
    out: 'back-3.jpg',
    ref: 'product-1-White-back.jpg',
    garment: 'white crew-neck t-shirt',
    slogan: 'FASHION FINALLY CAUGHT UP.',
    person: 'a man around 40, regular build, casual jeans, walking confidently',
    setting: 'walking away in an urban plaza area, mid-day soft light',
  },
  {
    out: 'back-4.jpg',
    ref: 'product-15-Charcoal-back.jpg',
    garment: 'charcoal grey pullover hoodie',
    slogan: 'COMFORTABLE IN MY SKIN. AND MY HOODIE.',
    person: 'a woman around 49, plus size, short hair, walking with relaxed posture',
    setting: 'walking away on a city sidewalk near brick buildings, soft daylight',
  },
];

function buildFrontPrompt(job) {
  return `The first image is the OFFICIAL PRODUCT MOCKUP of a DUBIS brand ${job.garment}. Study it carefully — the exact color, the exact small chest badge artwork and its position, the fabric texture, the silhouette.

Now generate a single new photograph: a realistic, candid lifestyle photo of a REAL ORDINARY PERSON (NOT a professional model, NOT airbrushed, NOT stylized) wearing THIS EXACT GARMENT.

Person: ${job.person}. Real skin texture, real body. Authentic, unposed expression.

Setting: ${job.setting}. Natural ambient light. Subject framed roughly waist-up so the full chest area and the DUBIS chest badge are clearly visible. Person facing the camera (front view).

CRITICAL — the garment must look like an ACTUAL PRINTED PIECE OF CLOTHING THE PERSON IS WEARING, not a sticker or overlay:
- The fabric must follow the body's contours, drape, wrinkle, and shadow naturally.
- The chest badge must look printed on the fabric — it must move with the cloth, pick up the same lighting, slightly distort over folds.
- Match the garment color from the reference image exactly.
- The chest logo MUST READ EXACTLY "DUBIS™" — the five letters D-U-B-I-S in bold uppercase, IMMEDIATELY followed by a clearly visible superscript ™ (trademark) symbol in the top-right corner of the wordmark. The ™ is mandatory, must be clearly legible, not a stray dot or smudge.
- Match the chest badge artwork from the reference image — same shape, same lettering (DUBIS™), same position on the chest. The ™ in the reference image MUST be reproduced and must be visible at viewing scale.
- Do NOT add any other text, logos, watermarks, or graphic elements anywhere in the frame.

Photographic style: candid street/lifestyle photography. 35mm lens look. Slight grain. Authentic, documentary feel. Not a fashion editorial. Square 1:1 aspect ratio.`;
}

function buildBackPrompt(job) {
  return `The first image is the OFFICIAL PRODUCT MOCKUP of the BACK of a DUBIS brand ${job.garment}. The back of this garment is printed with the slogan "${job.slogan}" across the upper-to-mid back area.

Now generate a single new photograph: a realistic, candid lifestyle photo of a REAL ORDINARY PERSON (NOT a model) wearing THIS EXACT GARMENT, photographed FROM BEHIND so the full back of the garment fills most of the frame.

Person: ${job.person}. Real body, real proportions.

Setting: ${job.setting}. The person is walking away from the camera. Natural light.

CRITICAL — the garment must look like an ACTUAL PRINTED PIECE OF CLOTHING:
- The text "${job.slogan}" must appear CLEARLY READABLE across the back of the garment.
- The text must look PRINTED on the fabric — same lighting as the cloth, slight wrinkle distortion, follows the body's contours.
- Match the garment color from the reference image exactly.
- Use the same typography and layout style as the reference back mockup.
- Do NOT add any other text, logos, or graphic elements anywhere in the frame.
- Do NOT crop out the text — the entire slogan must be in frame and legible.

Photographic style: candid documentary lifestyle photography. 35mm lens look. Slight grain. Authentic. Square 1:1 aspect ratio.`;
}

async function generate(prompt, refPath, outPath) {
  const refBytes = fs.readFileSync(refPath);
  const refB64 = refBytes.toString('base64');

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: refB64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.substring(0, 300)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart?.inlineData?.data) {
    const txt = parts.find(p => p.text)?.text || '';
    throw new Error(`No image returned. Text: ${txt.substring(0, 200)}`);
  }

  const raw = Buffer.from(imgPart.inlineData.data, 'base64');
  if (raw.length < 10000) throw new Error(`Image too small (${raw.length} bytes)`);

  await sharp(raw)
    .resize(1080, 1080, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outPath);

  const sz = fs.statSync(outPath).size;
  console.log(`  OK ${path.basename(outPath)} (${(sz / 1024).toFixed(0)}KB)`);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1] : null;

  let total = 0, ok = 0, fail = 0;

  for (const job of FRONT_JOBS) {
    if (only && !job.out.startsWith(only)) continue;
    total++;
    const ref = path.join(IMAGES_DIR, job.ref);
    const out = path.join(OUT_DIR, job.out);
    if (!fs.existsSync(ref)) { console.log(`  SKIP ${job.out} - missing ref ${job.ref}`); fail++; continue; }
    console.log(`Front: ${job.out} <- ${job.ref}`);
    try {
      await generate(buildFrontPrompt(job), ref, out);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${job.out}: ${e.message}`);
      fail++;
    }
    await delay(2500);
  }

  for (const job of BACK_JOBS) {
    if (only && !job.out.startsWith(only)) continue;
    total++;
    const ref = path.join(IMAGES_DIR, job.ref);
    const out = path.join(OUT_DIR, job.out);
    if (!fs.existsSync(ref)) { console.log(`  SKIP ${job.out} - missing ref ${job.ref}`); fail++; continue; }
    console.log(`Back: ${job.out} <- ${job.ref}`);
    try {
      await generate(buildBackPrompt(job), ref, out);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${job.out}: ${e.message}`);
      fail++;
    }
    await delay(2500);
  }

  console.log(`\nDone: ${ok}/${total} succeeded, ${fail} failed.`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
