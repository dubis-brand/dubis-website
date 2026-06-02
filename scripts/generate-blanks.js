#!/usr/bin/env node
/**
 * generate-blanks.js — 2026-04-24
 *
 * Part of Option B+ pipeline.
 *
 * Creates EMPTY garment photos via Gemini — NO text, NO logo, NO print anywhere.
 * These are the "canvas" for composite-mockups.js which overlays our actual
 * DUBIS™ logo + slogan using node-canvas + Impact font (deterministic).
 *
 * Output:
 *   blanks/{type}-{Color}-front-flat.jpg
 *   blanks/{type}-{Color}-back-flat.jpg
 *
 * Sharing: all products of the same (type, color) share the same blank.
 * Adding product 19 with an existing (type, color) combination requires ZERO
 * new Gemini calls — we reuse the existing blank.
 *
 * HEX codes are the ACTUAL Gelato fabric colors, fetched from their Product API.
 * This means our blank matches the garment customers will receive.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const BLANKS_DIR = path.resolve(__dirname, '../blanks');

if (!fs.existsSync(BLANKS_DIR)) fs.mkdirSync(BLANKS_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────
// Ground truth colors — HEX values fetched from Gelato Product API
// (GET https://product.gelatoapis.com/v3/products/{productUid}).
// These are the actual fabric colors Gelato prints on. DO NOT estimate.
// To add a new color: run the probe endpoint and copy the exact HEX.
// ─────────────────────────────────────────────────────────────────
const GELATO_COLOR_HEX = {
  'Black':        '#25282A',
  'White':        '#FFFFFF',
  'Cream':        '#DFD1A7',
  'Navy':         '#1F2A44',
  'Red':          '#D50032',
  'Charcoal':     '#36454F',  // TODO: replace with actual Gelato HEX when we fetch it
  'Forest Green': '#0F3D2E',  // TODO: ditto
  // SOL'S 04237 zip-hoodie fabric colors (fetched from Gelato product API 2026-06-02)
  'Gray':         '#92949B',  // SOL'S grey-melange
  'Royal Blue':   '#003373',  // SOL'S royal-blue
};

// ─────────────────────────────────────────────────────────────────
// Garment descriptors per type (human-readable for the prompt)
// ─────────────────────────────────────────────────────────────────
const GARMENT_DESC = {
  tshirt:     'classic unisex crew-neck t-shirt, short sleeves, relaxed regular fit, 100% cotton',
  hoodie:     'pullover hoodie with front kangaroo pocket, long sleeves, relaxed oversized fit, 100% cotton fleece',
  ziphoodie:  'full-zip hoodie with front side pockets and metal zipper, long sleeves, 100% cotton fleece',
  longsleeve: 'long-sleeve crew-neck t-shirt, long sleeves, regular fit, 100% cotton',
  cap:        'unstructured dad hat / baseball cap with curved brim, one size adjustable strap back, 100% cotton',
};

// ─────────────────────────────────────────────────────────────────
// Products to generate blanks for — pass --product=1 to limit to POC
// Full list mirrors dubis_products WHERE active=true.
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     colors: ['Black','White','Cream','Navy','Red'] },
  { id: 2,  type: 'tshirt',     colors: ['Black','Cream','Navy'] },
  { id: 3,  type: 'ziphoodie',  colors: ['Black','White','Navy','Gray','Royal Blue'] },  // SOL'S 04237 zip (2026-06-02)
  { id: 4,  type: 'tshirt',     colors: ['Black','White','Charcoal','Navy'] },
  { id: 5,  type: 'tshirt',     colors: ['Black','White','Cream','Charcoal'] },
  { id: 6,  type: 'hoodie',     colors: ['Charcoal','Black','Navy'] },
  { id: 7,  type: 'cap',        colors: ['Charcoal','Cream','Black','Navy'] },
  { id: 8,  type: 'tshirt',     colors: ['Black','Charcoal','Navy','Red','Forest Green'] },
  { id: 9,  type: 'ziphoodie',  colors: ['Black','Navy','Charcoal'] },
  { id: 10, type: 'longsleeve', colors: ['Black','Navy','White','Forest Green'] },
  { id: 11, type: 'tshirt',     colors: ['White','Cream','Black','Navy'] },
  { id: 12, type: 'tshirt',     colors: ['Black','White','Cream','Navy'] },
  { id: 13, type: 'hoodie',     colors: ['Charcoal','Cream','Navy'] },
  { id: 14, type: 'longsleeve', colors: ['Cream','White','Black','Navy'] },
  { id: 15, type: 'hoodie',     colors: ['Black','White','Navy','Charcoal'] },
  { id: 16, type: 'hoodie',     colors: ['Black','White','Navy','Charcoal'] },
  { id: 17, type: 'tshirt',     colors: ['Black','White','Cream','Navy'] },
  { id: 18, type: 'tshirt',     colors: ['Black','White','Cream','Navy'] },
  { id: 25, type: 'ziphoodie',  colors: ['Black','White','Navy','Gray','Royal Blue'] },  // SOL'S 04237 zip (2026-06-02)
];

// ─────────────────────────────────────────────────────────────────
// Build a (type, color) uniqueness set — same blank is reused by
// multiple products. That's the whole point of the Template Library.
// ─────────────────────────────────────────────────────────────────
function uniqueBlanks(products) {
  const set = new Map();
  for (const p of products) {
    for (const color of p.colors) {
      const key = `${p.type}|${color}`;
      set.set(key, { type: p.type, color });
    }
  }
  return Array.from(set.values());
}

// ─────────────────────────────────────────────────────────────────
// Prompt builder — optimized for "completely empty garment"
// ─────────────────────────────────────────────────────────────────
function buildBlankPrompt(type, color, face) {
  const garmentDesc = GARMENT_DESC[type];
  const hex = GELATO_COLOR_HEX[color] || '#808080';
  const faceDesc = face === 'front'
    ? 'FRONT view of the garment, viewed straight-on from the front'
    : 'BACK view of the garment, viewed straight-on from the back';

  return `Professional product photography of a ${garmentDesc}.

COLOR: The fabric color is EXACTLY the solid color hex ${hex}. No pattern, no gradient, no shading variation — just a clean uniform solid color fabric.

VIEW: ${faceDesc}. The garment is displayed on an invisible mannequin (ghost-mannequin style) or laid flat against a clean background. Studio lighting. Photorealistic. Square 1:1 format.

CRITICAL — THE GARMENT MUST BE COMPLETELY BLANK:
- NO text anywhere — no words, no letters, no slogans, no brand name, no "DUBIS", no numbers
- NO logo anywhere — no chest logo, no back print, no sleeve print, no watermark
- NO graphics — no patterns, no prints, no illustrations, no icons, no emojis
- NO decorative elements — no stripes, no pockets stitching detail, no contrast trim
- NO tags visible from outside — no neck label, no size label, no care label visible
- NO embroidery, NO screen print, NO DTG print — the garment is completely unprinted

The garment is a blank, unbranded, unprinted ${type} in solid ${color} color. Think of it as a blank canvas from a garment warehouse — this is what we print on top of later.

Background: clean neutral light-grey studio background (#f0f0f0). Natural fabric drape. High quality, photorealistic.`;
}

// ─────────────────────────────────────────────────────────────────
// Gemini call
// ─────────────────────────────────────────────────────────────────
async function generateBlank(type, color, face, outPath) {
  const prompt = buildBlankPrompt(type, color, face);

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
  if (!imgPart?.inlineData?.data) throw new Error('No image data returned');

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  if (imgBuffer.length < 10000) throw new Error(`Image too small (${imgBuffer.length} bytes)`);

  fs.writeFileSync(outPath, imgBuffer);
  return imgBuffer.length;
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────
async function main() {
  if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  // Flags
  const pidArg       = process.argv.find(a => a.startsWith('--product='));
  const onlyId       = pidArg ? parseInt(pidArg.split('=')[1]) : null;
  const missingOnly  = process.argv.includes('--missing-only');

  const sourceProducts = onlyId ? PRODUCTS.filter(p => p.id === onlyId) : PRODUCTS;
  const blanks = uniqueBlanks(sourceProducts);

  console.log(`\n=== DUBIS Blank Generator ===`);
  console.log(`Products in scope: ${sourceProducts.length}`);
  console.log(`Unique (type,color) blanks needed: ${blanks.length}`);
  console.log(`Missing-only mode: ${missingOnly}`);
  console.log('');

  let total = 0, success = 0, failed = 0, skipped = 0;

  for (const { type, color } of blanks) {
    for (const face of ['front', 'back']) {
      // Caps only have a front view
      if (type === 'cap' && face === 'back') continue;

      total++;
      const safeColor = color.replace(/\s+/g, '-');
      const filename = `${type}-${safeColor}-${face}-flat.jpg`;
      const outPath = path.join(BLANKS_DIR, filename);

      if (missingOnly && fs.existsSync(outPath)) {
        const size = fs.statSync(outPath).size;
        if (size >= 40 * 1024) {
          skipped++;
          console.log(`  ⏭  ${filename}: exists (${(size/1024).toFixed(0)}KB), skipping`);
          continue;
        }
      }

      console.log(`  Generating: ${filename}...`);
      try {
        const bytes = await generateBlank(type, color, face, outPath);
        console.log(`  ✅ ${filename} (${(bytes/1024).toFixed(0)}KB)`);
        success++;
        await delay(3000);
      } catch (e) {
        console.log(`  ❌ ${filename}: ${e.message}`);
        failed++;
        if (String(e.message).includes('503')) await delay(15000);
      }
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${success} succeeded, ${skipped} skipped, ${failed} failed (total ${total})`);
}

main().catch(e => { console.error(e); process.exit(1); });
