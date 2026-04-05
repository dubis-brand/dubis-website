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

// All products and their colors (from products.js)
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy','Red'] },
  { id: 2,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Honey Brown','Black','Cream','Navy'] },
  { id: 3,  type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Charcoal','Cream','Navy','Forest Green'] },
  { id: 4,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Charcoal','Navy'] },
  { id: 5,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Charcoal','Honey Brown'] },
  { id: 6,  type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Charcoal','Black','Navy','Honey Brown'] },
  { id: 7,  type: 'cap',        desc: 'unstructured dad hat/cap with curved brim, one size adjustable', colors: ['Charcoal','Cream','Honey Brown','Black','Navy'] },
  { id: 8,  type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','Charcoal','Navy','Red','Forest Green'] },
  { id: 9,  type: 'ziphoodie',  desc: 'full-zip hoodie with front pockets, long sleeves, regular fit', colors: ['Black','Navy','Charcoal'] },
  { id: 10, type: 'longsleeve', desc: 'long-sleeve crew-neck shirt, long sleeves, regular fit', colors: ['Black','Navy','White','Forest Green'] },
  { id: 11, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['White','Cream','Black','Navy'] },
  { id: 12, type: 'tshirt',     desc: 'crew-neck t-shirt, short sleeves, regular fit', colors: ['Black','White','Cream','Navy'] },
  { id: 13, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed fit', colors: ['Charcoal','Cream','Navy','Honey Brown'] },
  { id: 14, type: 'longsleeve', desc: 'long-sleeve crew-neck shirt, long sleeves, regular fit', colors: ['Cream','White','Black','Navy'] },
  { id: 15, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Black','White','Navy','Charcoal'] },
  { id: 16, type: 'hoodie',     desc: 'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit', colors: ['Black','White','Navy','Charcoal'] },
];

function buildFrontPrompt(product, color) {
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;
  const inkColor = ['Black', 'Navy', 'Charcoal', 'Forest Green'].includes(color) ? 'white' : 'black';

  if (product.type === 'cap') {
    return `Professional product photo of a ${product.desc}, ${colorDesc}. Small embroidered "DUBIS" text on the front center panel of the cap in ${inkColor} thread. Clean white studio background. Product photography, no person, just the cap displayed on its own. Studio lighting, high quality, photorealistic. Square 1:1 format. No other text, no watermark, no tags.`;
  }

  return `Professional product photo of a ${product.desc}, ${colorDesc}.

LOGO PLACEMENT (CRITICAL — must be exact):
- Small "${inkColor}" colored "DUBIS" text on the upper-left chest area of the garment
- Position: approximately 20-25% from the left edge, 20-25% from the top
- The text should be small (like a polo brand logo) — about 2-3cm equivalent
- The logo is on the VIEWER'S LEFT side (garment's right breast)
- NOT centered, NOT on the right side, NOT at the bottom, NOT large

The garment has NO other text, NO graphics, NO prints — just the small DUBIS logo on the upper-left chest.

Clean white studio background. Product photography, no person, just the garment on invisible mannequin or laid flat. Studio lighting, high quality, photorealistic. Square 1:1 format. No watermark, no tags, no labels visible.`;
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
