#!/usr/bin/env node
/**
 * generate-product-images.js
 * Generates front + back product mockup images using Gemini 2.5 Flash
 *
 * Usage:
 *   node scripts/generate-product-images.js --product-id=15
 *   node scripts/generate-product-images.js --product-id=15 --colors="Black,White"
 *   node scripts/generate-product-images.js --all  (regenerate all active products)
 *
 * Env: GEMINI_API_KEY (from .env.local or environment)
 */

const fs = require('fs');
const path = require('path');

// Load env
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const IMAGES_DIR = path.resolve(__dirname, '../images');

// Parse args
const args = process.argv.slice(2);
const productIdArg = args.find(a => a.startsWith('--product-id='));
const colorsArg = args.find(a => a.startsWith('--colors='));
const allMode = args.includes('--all');
const productId = productIdArg ? parseInt(productIdArg.split('=')[1]) : null;
const specificColors = colorsArg ? colorsArg.split('=')[1].split(',') : null;

// Garment type descriptions for prompts
const GARMENT_DESC = {
  tshirt: { name: 'crew-neck t-shirt', sleeves: 'short sleeves', fit: 'regular fit' },
  hoodie: { name: 'pullover hoodie with front kangaroo pocket', sleeves: 'long sleeves', fit: 'relaxed oversized fit' },
  ziphoodie: { name: 'full-zip hoodie with front pockets', sleeves: 'long sleeves', fit: 'regular fit' },
  longsleeve: { name: 'long-sleeve crew-neck shirt', sleeves: 'long sleeves', fit: 'regular fit' },
  cap: { name: 'unstructured dad hat/cap with curved brim', sleeves: '', fit: 'one size adjustable' },
};

// Color hex for prompts
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

function buildFrontPrompt(garment, color, slogan) {
  const g = GARMENT_DESC[garment] || GARMENT_DESC.tshirt;
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;

  if (garment === 'cap') {
    return `Professional product photo of a ${g.name}, ${colorDesc}. Small embroidered "DUBIS™" text on the front center of the cap. Clean white studio background. Product photography, no person, just the garment laid flat or on invisible mannequin. Studio lighting, high quality, photorealistic. Square 1:1 format. No watermark.`;
  }

  return `Professional product photo of a ${g.name}, ${colorDesc}, ${g.sleeves}, ${g.fit}. Small "DUBIS™" text/logo on the LEFT CHEST area (upper left, like a polo logo placement — NOT at the bottom, NOT centered). Clean white studio background. Product photography, no person, just the garment on invisible mannequin or laid flat. Studio lighting, high quality, photorealistic. Square 1:1 format. No watermark. No other text anywhere.`;
}

function buildBackPrompt(garment, color, slogan, typography) {
  const g = GARMENT_DESC[garment] || GARMENT_DESC.tshirt;
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;
  const inkColor = ['Black', 'Navy', 'Charcoal', 'Forest Green'].includes(color) ? 'white' : 'black';

  if (garment === 'cap') {
    // Caps only have front design
    return null;
  }

  let textDesc = '';
  if (typography && typography.big) {
    const before = typography.small || '';
    const big = typography.big;
    const after = typography.after || '';
    textDesc = `The back print reads: "${before}" in small ${inkColor} text, then "${big}" in HUGE bold Impact font (3-5x larger than the other text), then "${after}" in small ${inkColor} text below. The word "${big}" dominates the design.`;
  } else {
    textDesc = `The back has "${slogan}" printed in bold ${inkColor} text with dramatic mixed-size typography.`;
  }

  return `Professional product photo showing the BACK of a ${g.name}, ${colorDesc}, ${g.sleeves}. ${textDesc} Small "DUBIS" text at the very bottom of the back. Clean white studio background. Product photography, no person, just the garment back view on invisible mannequin. Studio lighting, high quality, photorealistic. Square 1:1 format. No watermark.`;
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
      signal: AbortSignal.timeout(90000),
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

  // Validate image size (should be > 10KB for a real image)
  if (imgBuffer.length < 10000) {
    throw new Error(`Image too small (${imgBuffer.length} bytes) — likely invalid`);
  }

  fs.writeFileSync(outputPath, imgBuffer);
  console.log(`  ✅ Saved: ${path.basename(outputPath)} (${(imgBuffer.length / 1024).toFixed(0)}KB)`);
  return outputPath;
}

// Delay to avoid rate limits
const delay = ms => new Promise(r => setTimeout(r, ms));

async function generateProductImages(product) {
  const { id, phrase, type, colors, typography } = product;
  console.log(`\n🔨 Product #${id}: "${phrase}" (${type})`);

  const colorList = specificColors || colors || ['Black', 'White'];
  const results = { success: [], failed: [] };

  for (const color of colorList) {
    const safeColor = color.replace(/\s+/g, '-');

    // Front image
    try {
      const frontPrompt = buildFrontPrompt(type, color, phrase);
      const frontPath = path.join(IMAGES_DIR, `product-${id}-${safeColor}-front.jpg`);
      await generateImage(frontPrompt, frontPath);
      results.success.push(`${safeColor}-front`);
      await delay(2000); // Rate limit
    } catch (e) {
      console.log(`  ❌ Front ${safeColor}: ${e.message}`);
      results.failed.push(`${safeColor}-front`);
    }

    // Back image (not for caps)
    const backPrompt = buildBackPrompt(type, color, phrase, typography);
    if (backPrompt) {
      try {
        const backPath = path.join(IMAGES_DIR, `product-${id}-${safeColor}-back.jpg`);
        await generateImage(backPrompt, backPath);
        results.success.push(`${safeColor}-back`);
        await delay(2000);
      } catch (e) {
        console.log(`  ❌ Back ${safeColor}: ${e.message}`);
        results.failed.push(`${safeColor}-back`);
      }
    }
  }

  // Also generate base fallback image
  try {
    const defaultColor = colorList[0];
    const baseFrontPath = path.join(IMAGES_DIR, `product-${id}.jpg`);
    if (!fs.existsSync(baseFrontPath)) {
      fs.copyFileSync(
        path.join(IMAGES_DIR, `product-${id}-${defaultColor.replace(/\s+/g, '-')}-front.jpg`),
        baseFrontPath
      );
      console.log(`  📋 Base fallback: product-${id}.jpg (copy of ${defaultColor} front)`);
    }
  } catch {}

  console.log(`  Summary: ${results.success.length} ✅ / ${results.failed.length} ❌`);
  return results;
}

async function fetchProducts() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  let url = `${SUPABASE_URL}/rest/v1/dubis_products?active=eq.true&order=product_id_numeric.asc`;
  if (productId) {
    url = `${SUPABASE_URL}/rest/v1/dubis_products?product_id_numeric=eq.${productId}&active=eq.true`;
  }

  const res = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

// Typography map (same as in CLAUDE.md)
const TYPOGRAPHY = {
  "I'm not fat, I'm a limited edition": { small: "I am not fat, I am a", big: "LIMITED", after: "edition." },
  "More of me to love": { small: "more of me to", big: "LOVE", after: "" },
  "Napping is my cardio": { small: "NAPPING IS MY", big: "CARDIO", after: "" },
  "I survived. That's enough.": { small: "I survived.", big: "That's enough.", after: "" },
  "Low maintenance, high value": { small: "low maintenance", big: "VALUE", after: "high" },
  "Not a model. Never wanted to be.": { small: "Not a model.", big: "NEVER.", after: "wanted to be." },
  "DUBIS — For the rest of us": { small: "", big: "DUBIS", after: "For the rest of us" },
  "Born to nap, forced to work": { small: "Born to nap, forced to work", big: "NAP", after: "" },
  "Certified overthinker": { small: "certified", big: "OVER", after: "thinker." },
  "Serial napper": { small: "serial", big: "NAPPER", after: "" },
  "She believed she could, so she took a nap": { small: "She believed she could, so she took a", big: "NAP.", after: "" },
  "I run on coffee and sarcasm": { small: "I run on coffee and sarcasm.", big: "COFFEE", after: "" },
  "Zero Motivation Club": { small: "Zero Motivation", big: "CLUB", after: "" },
  "Emotionally attached to my couch": { small: "emotionally attached to my", big: "COUCH", after: "" },
};

const JS_TYPE_MAP = { 't-shirt': 'tshirt', 'hoodie': 'hoodie', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'cap': 'cap' };

async function main() {
  if (!GEMINI_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  if (!productId && !allMode) {
    console.log('Usage:');
    console.log('  node scripts/generate-product-images.js --product-id=15');
    console.log('  node scripts/generate-product-images.js --all');
    console.log('  node scripts/generate-product-images.js --product-id=15 --colors="Black,White"');
    process.exit(0);
  }

  console.log('Fetching products from Supabase...');
  const dbProducts = await fetchProducts();
  console.log(`Found ${dbProducts.length} products`);

  const products = dbProducts.map(p => ({
    id: p.product_id_numeric,
    phrase: p.slogan,
    type: JS_TYPE_MAP[p.clothing_type] || p.clothing_type,
    colors: p.colors || ['Black', 'White'],
    typography: TYPOGRAPHY[p.slogan] || {
      small: p.typography_small || '',
      big: p.typography_big || p.slogan?.split(' ').pop()?.toUpperCase() || '',
      after: p.typography_after || '',
    },
  }));

  let totalSuccess = 0, totalFailed = 0;

  for (const product of products) {
    const result = await generateProductImages(product);
    totalSuccess += result.success.length;
    totalFailed += result.failed.length;
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${totalSuccess} images generated, ${totalFailed} failed`);
  console.log(`Images saved to: ${IMAGES_DIR}`);
  console.log(`\nNext: git add images/ && git commit -m "add product images" && git push`);
}

main().catch(e => { console.error(e); process.exit(1); });
