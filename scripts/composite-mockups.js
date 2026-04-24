#!/usr/bin/env node
/**
 * composite-mockups.js — 2026-04-24
 *
 * Part of Option B+ pipeline. DETERMINISTIC overlay of DUBIS™ + slogan onto a
 * blank garment photo using node-canvas + Impact font.
 *
 * Guarantees identical font, size, and position across ALL products + colors,
 * because the text is rendered by the same code path as generate-designs.js
 * (the PNG files sent to Gelato). No Gemini variance, no drift.
 *
 * Input:
 *   blanks/{type}-{Color}-{face}-flat.jpg   (from generate-blanks.js)
 * Output:
 *   images/product-{id}-{Color}-{face}.jpg
 *
 * Usage:
 *   node scripts/composite-mockups.js                 # all active products
 *   node scripts/composite-mockups.js --product=1     # single product (POC)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const BLANKS_DIR = path.resolve(__dirname, '../blanks');
const IMAGES_DIR = path.resolve(__dirname, '../images');

// ─────────────────────────────────────────────────────────────────
// Font — same Impact as generate-designs.js for parity with Gelato print files
// ─────────────────────────────────────────────────────────────────
const IMPACT_PATH = 'C:\\Windows\\Fonts\\impact.ttf';
if (fs.existsSync(IMPACT_PATH)) {
  registerFont(IMPACT_PATH, { family: 'Impact' });
}

function setFont(ctx, size) {
  ctx.font = `${size}px "Impact"`;
}

// ─────────────────────────────────────────────────────────────────
// Product definitions — mirror scripts/generate-designs.js PRODUCTS
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     colors: ['Black','White','Cream','Navy','Red'],
    phrase: "I'm not fat, I'm a limited edition", layout: 'top-bottom',
    small: "I am not fat, I am a", big: "LIMITED", after: "edition." },
  { id: 2,  type: 'tshirt',     colors: ['Black','Cream','Navy'],
    phrase: "More of me to love", layout: 'top-bottom',
    small: "more of me to", big: "LOVE", after: "" },
  { id: 3,  type: 'hoodie',     colors: ['Charcoal','Cream','Navy','Forest Green'],
    phrase: "Napping is my cardio", layout: 'top-bottom',
    small: "NAPPING IS MY", big: "CARDIO", after: "" },
  { id: 4,  type: 'tshirt',     colors: ['Black','White','Charcoal','Navy'],
    phrase: "I survived. That's enough.", layout: 'top-bottom',
    small: "", big: "I survived.", after: "That\u2019s enough." },
  { id: 5,  type: 'tshirt',     colors: ['Black','White','Cream','Charcoal'],
    phrase: "Low maintenance, high value", layout: 'top-bottom',
    small: "low maintenance, high", big: "VALUE", after: "" },
  { id: 6,  type: 'hoodie',     colors: ['Charcoal','Black','Navy'],
    phrase: "Not a model. Never wanted to be.", layout: 'top-bottom',
    small: "Not a model.", big: "NEVER.", after: "wanted to be." },
  { id: 7,  type: 'cap',        colors: ['Charcoal','Cream','Black','Navy'],
    phrase: "DUBIS", layout: 'cap',
    small: "", big: "DUBIS", after: "" },
  { id: 8,  type: 'tshirt',     colors: ['Black','Charcoal','Navy','Red','Forest Green'],
    phrase: "Born to nap, forced to work", layout: 'big-top',
    small: "", big: "NAP", after: "Born to nap, forced to work" },
  { id: 9,  type: 'ziphoodie',  colors: ['Black','Navy','Charcoal'],
    phrase: "Certified overthinker", layout: 'top-bottom',
    small: "certified", big: "OVER", after: "thinker." },
  { id: 10, type: 'longsleeve', colors: ['Black','Navy','White','Forest Green'],
    phrase: "Serial napper", layout: 'top-bottom',
    small: "serial", big: "NAPPER", after: "" },
  { id: 11, type: 'tshirt',     colors: ['White','Cream','Black','Navy'],
    phrase: "She believed she could, so she took a nap", layout: 'top-bottom',
    small: "She believed she could,\nso she took a", big: "NAP.", after: "" },
  { id: 12, type: 'tshirt',     colors: ['Black','White','Cream','Navy'],
    phrase: "I run on coffee and sarcasm", layout: 'big-top',
    small: "", big: "COFFEE", after: "I run on coffee and sarcasm." },
  { id: 13, type: 'hoodie',     colors: ['Charcoal','Cream','Navy'],
    phrase: "Zero Motivation Club", layout: 'top-bottom',
    small: "Zero Motivation", big: "CLUB", after: "" },
  { id: 14, type: 'longsleeve', colors: ['Cream','White','Black','Navy'],
    phrase: "Emotionally attached to my couch", layout: 'top-bottom',
    small: "emotionally attached to my", big: "COUCH", after: "" },
  { id: 15, type: 'hoodie',     colors: ['Black','White','Navy','Charcoal'],
    phrase: "Fashion? I prefer comfort.", layout: 'top-bottom',
    small: "Fashion? I prefer", big: "COMFORT.", after: "" },
  { id: 16, type: 'hoodie',     colors: ['Black','White','Navy','Charcoal'],
    phrase: "My goal: minimal EXISTENCE.", layout: 'top-bottom',
    small: "My goal: minimal", big: "EXISTENCE.", after: "" },
  { id: 17, type: 'tshirt',     colors: ['Black','White','Cream','Navy'],
    phrase: "Experienced in EXHAUSTION.", layout: 'top-bottom',
    small: "Experienced in", big: "EXHAUSTION", after: "." },
  { id: 18, type: 'tshirt',     colors: ['Black','White','Cream','Navy'],
    phrase: "Unfashionably COMFORTABLE.", layout: 'top-bottom',
    small: "Unfashionably", big: "COMFORTABLE", after: "." },
];

const DARK_COLORS = new Set(['Black','Charcoal','Navy','Forest Green']);

// ─────────────────────────────────────────────────────────────────
// Draw the DUBIS™ chest-left logo onto the front canvas.
// Positioning is RELATIVE to canvas size. Calibrated twice against real
// Gemini blank output + oren visual review (2026-04-24):
//   v1 (0.28, 0.24): logo landed on background, not on shirt
//   v2 (0.38, 0.20): logo landed near the collar — too high & slightly left
//   v3 (0.43, 0.33): chest-pocket position — classic polo-style placement
// This matches the zone where a real polo/Lacoste logo sits: upper chest,
// roughly at heart level, on the left side of the shirt body (viewer's right
// in an as-worn photo, but the Gemini blanks are symmetric so x=0.43 lands
// in the intended visual zone).
// ─────────────────────────────────────────────────────────────────
// v4 (2026-04-24): oren — "זה צד שני". Chest-left on the WEARER =
// viewer's RIGHT in an as-worn photo. Mirror 0.43 → 0.57 across centerline.
const LOGO_CENTER_X_RATIO = 0.57;  // wearer's left chest = viewer's right
const LOGO_CENTER_Y_RATIO = 0.33;  // heart level, not collar level
const LOGO_WIDTH_RATIO    = 0.09;  // DUBIS fills ~9% of image width → fits within shirt body

function drawFrontLogo(ctx, w, h, color) {
  const inkColor = DARK_COLORS.has(color) ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle = inkColor;

  // Auto-size font so DUBIS fits LOGO_WIDTH_RATIO of image width
  const targetW = w * LOGO_WIDTH_RATIO;
  let fontSize  = 10;
  setFont(ctx, fontSize);
  while (ctx.measureText('DUBIS').width < targetW && fontSize < 500) {
    fontSize += 2;
    setFont(ctx, fontSize);
  }
  // Step back one
  fontSize -= 2;
  setFont(ctx, fontSize);

  const cx = w * LOGO_CENTER_X_RATIO;
  const cy = h * LOGO_CENTER_Y_RATIO;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DUBIS', cx, cy);

  // TM superscript
  const dubisW = ctx.measureText('DUBIS').width;
  const tmSize = fontSize * 0.45;
  setFont(ctx, tmSize);
  ctx.textAlign = 'left';
  const tmX = cx + dubisW / 2 + 2;
  const tmY = cy - fontSize * 0.30;
  ctx.fillText('\u2122', tmX, tmY);
}

// ─────────────────────────────────────────────────────────────────
// Draw the slogan onto the back canvas.
// Layout mirrors generate-designs.js back design layout (top-bottom / big-top).
// ─────────────────────────────────────────────────────────────────
function drawBackSlogan(ctx, w, h, color, product) {
  const inkColor = DARK_COLORS.has(color) ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle = inkColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = w / 2;

  // Shirt back body in the Gemini blanks occupies roughly y=10%..85% of canvas.
  // Slogan must fit ENTIRELY within y=20%..70% to avoid hitting hem/bottom.
  // Total vertical budget = 0.50 of canvas height.
  //
  // We also constrain the BIG word to ~12% of image height (was 16% — too tall),
  // and verify the text horizontally fits within shirt body width (~45% of canvas).
  //
  // Horizontal constraint: shirt body is x=30%..75%, centered at 52.5% of canvas,
  // width = 45% of canvas. BIG word must be < 42% of canvas width to have margin.

  const MAX_TEXT_WIDTH = w * 0.42;  // horizontal budget

  function fitFontSize(text, targetHeight) {
    let fs = targetHeight;
    setFont(ctx, fs);
    while (ctx.measureText(text).width > MAX_TEXT_WIDTH && fs > 10) {
      fs *= 0.95;
      setFont(ctx, fs);
    }
    return fs;
  }

  if (product.layout === 'top-bottom') {
    const bigH   = h * 0.11;    // BIG word ~11% (was 16%)
    const smallH = h * 0.033;   // small text ~3.3% (was 4%)
    const afterH = h * 0.033;

    let curY = h * 0.22;         // start higher (was 0.30)

    if (product.small) {
      const lines = product.small.split('\n');
      for (const line of lines) {
        const fs = fitFontSize(line, smallH);
        setFont(ctx, fs);
        ctx.fillText(line, centerX, curY);
        curY += fs * 1.25;
      }
      curY += smallH * 0.35;
    }

    if (product.big) {
      const fs = fitFontSize(product.big, bigH);
      setFont(ctx, fs);
      ctx.fillText(product.big, centerX, curY + fs / 2);
      curY += fs * 1.05 + fs * 0.20;
    }

    if (product.after) {
      curY += afterH * 0.25;
      const lines = product.after.split('\n');
      for (const line of lines) {
        const fs = fitFontSize(line, afterH);
        setFont(ctx, fs);
        ctx.fillText(line, centerX, curY);
        curY += fs * 1.25;
      }
    }
  } else if (product.layout === 'big-top') {
    const bigH   = h * 0.11;
    const afterH = h * 0.033;

    let curY = h * 0.22;

    if (product.big) {
      const fs = fitFontSize(product.big, bigH);
      setFont(ctx, fs);
      ctx.fillText(product.big, centerX, curY + fs / 2);
      curY += fs * 1.25;
    }

    if (product.after) {
      curY += afterH * 0.5;
      const lines = product.after.split('\n');
      for (const line of lines) {
        const fs = fitFontSize(line, afterH);
        setFont(ctx, fs);
        ctx.fillText(line, centerX, curY);
        curY += fs * 1.3;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Composite a single product × color × face
// ─────────────────────────────────────────────────────────────────
async function composite(product, color, face) {
  const safeColor = color.replace(/\s+/g, '-');
  const blankFile = path.join(BLANKS_DIR, `${product.type}-${safeColor}-${face}-flat.jpg`);
  const outFile   = path.join(IMAGES_DIR, `product-${product.id}-${safeColor}-${face}.jpg`);

  if (!fs.existsSync(blankFile)) {
    return { skipped: true, reason: 'blank_missing', blankFile };
  }

  const blank = await loadImage(blankFile);
  const canvas = createCanvas(blank.width, blank.height);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(blank, 0, 0);

  if (face === 'front') {
    drawFrontLogo(ctx, blank.width, blank.height, color);
  } else {
    // Caps only have a front design (embroidered logo) — no back image
    if (product.type === 'cap') return { skipped: true, reason: 'cap_no_back' };
    drawBackSlogan(ctx, blank.width, blank.height, color, product);
  }

  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  fs.writeFileSync(outFile, buffer);
  return { outFile, bytes: buffer.length };
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────
async function main() {
  const pidArg = process.argv.find(a => a.startsWith('--product='));
  const onlyId = pidArg ? parseInt(pidArg.split('=')[1]) : null;

  const products = onlyId ? PRODUCTS.filter(p => p.id === onlyId) : PRODUCTS;

  console.log(`\n=== DUBIS Mockup Compositor ===`);
  console.log(`Products in scope: ${products.length}`);
  console.log('');

  let success = 0, skipped = 0, failed = 0;

  for (const p of products) {
    console.log(`Product ${p.id} (${p.type}) — ${p.phrase}`);

    for (const color of p.colors) {
      for (const face of ['front', 'back']) {
        try {
          const res = await composite(p, color, face);
          if (res.skipped) {
            skipped++;
            console.log(`  ⏭  ${color} ${face}: ${res.reason}`);
          } else {
            success++;
            console.log(`  ✅ ${color} ${face} → ${path.basename(res.outFile)} (${(res.bytes/1024).toFixed(0)}KB)`);
          }
        } catch (e) {
          failed++;
          console.log(`  ❌ ${color} ${face}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${success} composited, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
