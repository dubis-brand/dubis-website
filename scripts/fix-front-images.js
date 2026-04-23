#!/usr/bin/env node
/**
 * fix-front-images.js — Regenerate ALL front mockup images for consistency
 * Ensures DUBIS logo is in the same position across all colors/products
 */

const fs = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const IMAGES_DIR = path.resolve(__dirname, '../images');

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

// All 18 products and their colors (2026-04-23: Honey Brown removed per product agent audit).
// IMPORTANT: this list is the source of truth for mockup regeneration. Keep in sync with
// dubis_products WHERE active=true. When adding a product, add it here too.
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy','Red'] },
  { id: 2,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','Cream','Navy'] },
  { id: 3,  type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Charcoal','Cream','Navy','Forest Green'] },
  { id: 4,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Charcoal','Navy'] },
  { id: 5,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Charcoal'] },
  { id: 6,  type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Charcoal','Black','Navy'] },
  { id: 7,  type: 'cap',        desc: 'unstructured dad hat/cap with curved brim, one size adjustable', colors: ['Charcoal','Cream','Black','Navy'] },
  { id: 8,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','Charcoal','Navy','Red','Forest Green'] },
  { id: 9,  type: 'ziphoodie',  desc: 'full-zip hoodie with front pockets, long sleeves, regular fit', colors: ['Black','Navy','Charcoal'] },
  { id: 10, type: 'longsleeve', desc: 'long-sleeve crew-neck shirt, long sleeves, regular fit', colors: ['Black','Navy','White','Forest Green'] },
  { id: 11, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['White','Cream','Black','Navy'] },
  { id: 12, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy'] },
  { id: 13, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed fit', colors: ['Charcoal','Cream','Navy'] },
  { id: 14, type: 'longsleeve', desc: 'long-sleeve crew-neck shirt, long sleeves, regular fit', colors: ['Cream','White','Black','Navy'] },
  { id: 15, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Black','White','Navy','Charcoal'] },
  { id: 16, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Black','White','Navy','Charcoal'] },
  { id: 17, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy'] },
  { id: 18, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy'] },
];

function buildFrontPrompt(product, color) {
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;
  const inkColor = ['Black', 'Navy', 'Charcoal', 'Forest Green'].includes(color) ? 'white' : 'black';

  if (product.type === 'cap') {
    return `Professional product photo of a ${product.desc}, ${colorDesc}. Small embroidered "DUBIS™" text on the front center panel of the cap in ${inkColor} thread. Clean white studio background. Product photography, no person, just the cap displayed on its own. Studio lighting, high quality, photorealistic. Square 1:1 format. No other text, no watermark, no tags.`;
  }

  return `Professional product photo of a ${product.desc}, ${colorDesc}, front view.

LOGO PLACEMENT — this must match EXACTLY what Gelato will print:
- Small "${inkColor}" colored "DUBIS™" text on the upper-left chest area (viewer's left side)
- Position: horizontal center of logo at ~22% from the left edge of the garment
- Position: vertical center of logo at ~17% from the top of the garment (just below the collar line)
- Size: approximately 2.5cm wide — roughly the size of a Lacoste crocodile or a Polo Ralph Lauren pony
- The ™ symbol is rendered as a small superscript immediately to the right of the "S" of DUBIS
- Font style: bold sans-serif (Impact / Helvetica Black)

ABSOLUTELY FORBIDDEN on the FRONT:
- Do NOT place the logo in the center of the chest
- Do NOT make the logo large (no bigger than ~3cm wide)
- Do NOT place it on the viewer's right (garment's left breast)
- Do NOT add ANY other text, graphics, patterns, or prints anywhere on the front
- Do NOT add size tags, wash tags, or brand tags visible on the outside of the garment
- Do NOT repeat DUBIS anywhere else (not at the hem, not on the sleeves, not on the neck label)

Clean white studio background. Product photography, no person, just the garment on invisible mannequin or laid flat. Studio lighting, high quality, photorealistic. Square 1:1 format. No watermark, no text captions, no overlays.`;
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
    throw new Error('No image data returned');
  }

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  if (imgBuffer.length < 10000) {
    throw new Error(`Image too small (${imgBuffer.length} bytes)`);
  }

  fs.writeFileSync(outputPath, imgBuffer);
  console.log(`  ✅ ${path.basename(outputPath)} (${(imgBuffer.length / 1024).toFixed(0)}KB)`);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  // Parse --product-id=X to only do specific products
  const pidArg = process.argv.find(a => a.startsWith('--product-id='));
  const onlyId = pidArg ? parseInt(pidArg.split('=')[1]) : null;

  const products = onlyId ? PRODUCTS.filter(p => p.id === onlyId) : PRODUCTS;

  let total = 0, success = 0, failed = 0;

  for (const product of products) {
    console.log(`\n=== Product ${product.id} (${product.type}) ===`);

    for (const color of product.colors) {
      total++;
      const safeColor = color.replace(/\s+/g, '-');
      const outPath = path.join(IMAGES_DIR, `product-${product.id}-${safeColor}-front.jpg`);

      try {
        const prompt = buildFrontPrompt(product, color);
        await generateImage(prompt, outPath);
        success++;
        await delay(3000);
      } catch (e) {
        console.log(`  ❌ ${safeColor}: ${e.message}`);
        failed++;
        await delay(2000);
      }
    }

    // Copy first color as base fallback
    try {
      const firstColor = product.colors[0].replace(/\s+/g, '-');
      const basePath = path.join(IMAGES_DIR, `product-${product.id}.jpg`);
      const srcPath = path.join(IMAGES_DIR, `product-${product.id}-${firstColor}-front.jpg`);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, basePath);
      }
    } catch {}
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${success}/${total} succeeded, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
