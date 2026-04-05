#!/usr/bin/env node
/**
 * fix-back-images.js — Regenerate ONLY back images for products with text issues
 * Uses ultra-explicit prompts to prevent Gemini from hallucinating extra text
 */

const fs = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const IMAGES_DIR = path.resolve(__dirname, '../images');

const GARMENT_DESC = {
  tshirt: 'crew-neck t-shirt, short sleeves',
  hoodie: 'pullover hoodie with front kangaroo pocket, long sleeves',
  ziphoodie: 'full-zip hoodie with front pockets, long sleeves',
  longsleeve: 'long-sleeve crew-neck shirt, long sleeves',
};

const COLOR_DESC = {
  'Black': 'solid black fabric',
  'White': 'solid white fabric',
  'Cream': 'off-white cream/ivory fabric',
  'Navy': 'dark navy blue fabric',
  'Charcoal': 'dark charcoal grey fabric',
  'Honey Brown': 'warm honey brown/caramel fabric',
  'Red': 'deep red/burgundy fabric',
  'Forest Green': 'deep forest green fabric',
};

// Products that need back image fixes — with EXACT text specification
const FIXES = [
  {
    id: 3, type: 'hoodie',
    colors: ['Black', 'White', 'Charcoal', 'Cream', 'Navy', 'Forest Green'],
    line1: 'NAPPING IS MY',
    line2: 'CARDIO',
    line3: '',
    desc: 'Line 1: "NAPPING IS MY" in small white text. Line 2: "CARDIO" in HUGE bold Impact font, 4x larger. That is ALL. Total words on garment: NAPPING IS MY CARDIO. Exactly 4 words.',
  },
  {
    id: 4, type: 'tshirt',
    colors: ['Black', 'White', 'Charcoal', 'Cream', 'Navy'],
    line1: 'I survived.',
    line2: "That's enough.",
    line3: '',
    desc: 'Line 1: "I survived." in medium bold text. Line 2: "That\'s enough." in larger bold text below it. That is ALL. Total words: I survived. That\'s enough. Exactly 4 words plus punctuation.',
  },
  {
    id: 5, type: 'tshirt',
    colors: ['Black', 'White', 'Cream', 'Charcoal', 'Honey Brown', 'Navy'],
    line1: 'low maintenance, high',
    line2: 'VALUE',
    line3: '',
    desc: 'Line 1: "low maintenance, high" in small text. Line 2: "VALUE" in HUGE bold Impact font, 4x larger. That is ALL. Total words: low maintenance high VALUE. Exactly 4 words. Do NOT add "reward" or any other word.',
  },
  {
    id: 8, type: 'tshirt',
    colors: ['Black', 'White', 'Charcoal', 'Navy', 'Red', 'Forest Green'],
    line1: 'Born to nap, forced to work',
    line2: 'NAP',
    line3: '',
    desc: 'Line 1: "NAP" in HUGE bold Impact font at the top. Line 2: "Born to nap, forced to work" in small text below. That is ALL. Do NOT add "zzz" or sleep symbols or any other text.',
  },
  {
    id: 10, type: 'longsleeve',
    colors: ['Black', 'White', 'Navy', 'Forest Green'],
    line1: 'serial',
    line2: 'NAPPER',
    line3: '',
    desc: 'Line 1: "serial" in small text. Line 2: "NAPPER" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 2 words total: serial NAPPER. Do NOT repeat the word NAPPER or add quotes around it.',
  },
  {
    id: 14, type: 'longsleeve',
    colors: ['Black', 'White', 'Cream', 'Navy'],
    line1: 'emotionally attached to my',
    line2: 'COUCH',
    line3: '',
    desc: 'Line 1: "emotionally attached to my" in small text. Line 2: "COUCH" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 5 words. Do NOT add any subtitle, attribution, or extra text below.',
  },
  {
    id: 15, type: 'hoodie',
    colors: ['Black', 'White', 'Navy', 'Charcoal'],
    line1: 'Fashion? I prefer',
    line2: 'COMFORT.',
    line3: '',
    desc: 'Line 1: "Fashion? I prefer" in small text. Line 2: "COMFORT." in HUGE bold Impact font, 4x larger. The big word is COMFORT, NOT fashion. That is ALL. Exactly 4 words.',
  },
];

function buildBackPrompt(fix, color) {
  const garmentDesc = GARMENT_DESC[fix.type];
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;
  const inkColor = ['Black', 'Navy', 'Charcoal', 'Forest Green'].includes(color) ? 'white' : 'black';

  return `Professional product photo showing the BACK of a ${garmentDesc}, ${colorDesc}.

TEXT ON THE BACK (${inkColor} ink):
${fix.desc}

STRICT RULES:
- Print ONLY the exact words specified above in ${inkColor} color
- Do NOT add ANY extra words, symbols, hashtags, dates, years, decorative text, or characters
- Do NOT add "zzz", "cooldown", "reward", copyright symbols, registered marks, or ANY additions
- Do NOT repeat any word that already appears
- Do NOT add quotation marks around any text
- The garment back must show ONLY the slogan text, nothing else
- No logo, no branding, no DUBIS text on the back

Clean white studio background. Product photography, no person, just the garment back view on invisible mannequin. Studio lighting, high quality, photorealistic. Square 1:1 format.`;
}

async function generateImage(prompt, outputPath) {
  console.log(`  Generating: ${path.basename(outputPath)}...`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal: AbortSignal.timeout(120000),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imgPart?.inlineData?.data) {
    throw new Error('No image data returned from Gemini');
  }

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  if (imgBuffer.length < 10000) {
    throw new Error(`Image too small (${imgBuffer.length} bytes)`);
  }

  fs.writeFileSync(outputPath, imgBuffer);
  console.log(`  ✅ Saved: ${path.basename(outputPath)} (${(imgBuffer.length / 1024).toFixed(0)}KB)`);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  let total = 0, success = 0, failed = 0;

  for (const fix of FIXES) {
    console.log(`\n=== Product ${fix.id}: ${fix.line1} ${fix.line2} ${fix.line3} ===`);

    for (const color of fix.colors) {
      total++;
      const safeColor = color.replace(/\s+/g, '-');
      const outPath = path.join(IMAGES_DIR, `product-${fix.id}-${safeColor}-back.jpg`);

      try {
        const prompt = buildBackPrompt(fix, color);
        await generateImage(prompt, outPath);
        success++;
        await delay(3000); // Rate limit — slightly longer delay
      } catch (e) {
        console.log(`  ❌ ${safeColor}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${success}/${total} succeeded, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
