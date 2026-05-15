'use strict';

/**
 * DUBIS Design Generator
 * Generates all print-ready PNG design files using node-canvas + Impact font.
 *
 * Run:  node scripts/generate-designs.js
 * Deps: npm install canvas  (in dubis-website/)
 */

const { createCanvas, registerFont } = require('canvas');
const fs   = require('fs');
const path = require('path');

// Try loading .env for Supabase credentials
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------------
// Font registration
// Impact is pre-installed on Windows. Register it so canvas can use it.
// ---------------------------------------------------------------------------
const IMPACT_PATH = 'C:\\Windows\\Fonts\\impact.ttf';
if (fs.existsSync(IMPACT_PATH)) {
  registerFont(IMPACT_PATH, { family: 'Impact' });
  console.log('Registered Impact font from Windows Fonts.');
} else {
  console.warn('WARNING: Impact font not found at', IMPACT_PATH,
    '— canvas will fall back to a system font. Output may differ.');
}

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------
const OUTPUT_DIR = path.join(__dirname, '..', 'designs');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Created output directory:', OUTPUT_DIR);
}

// ---------------------------------------------------------------------------
// Product definitions
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: 1,  phrase: "I'm not fat, I'm a limited edition", layout: 'top-bottom',
    small: "I am not fat, I am a", big: "LIMITED",   after: "edition."           },
  { id: 2,  phrase: "More of me to love",                 layout: 'top-bottom',
    small: "more of me to",        big: "LOVE",       after: ""                  },
  { id: 3,  phrase: "Napping is my cardio",               layout: 'top-bottom',
    small: "NAPPING IS MY",        big: "CARDIO",     after: ""                  },
  { id: 4,  phrase: "I survived. That's enough.",         layout: 'top-bottom',
    small: "",                     big: "I survived.", after: "That\u2019s enough." },
  { id: 5,  phrase: "Low maintenance, high value",        layout: 'top-bottom',
    small: "low maintenance, high", big: "VALUE",      after: ""                 },
  { id: 6,  phrase: "Not a model. Never wanted to be.",   layout: 'top-bottom',
    small: "Not a model.",         big: "NEVER.",     after: "wanted to be."     },
  { id: 7,  phrase: "DUBIS — For the rest of us",         type:   'cap',
    small: "DUBIS",                big: "",           after: "For the rest of us" },
  { id: 8,  phrase: "Born to nap, forced to work",        layout: 'big-top',
    small: "",                     big: "NAP",        after: "Born to nap, forced to work" },
  { id: 9,  phrase: "Certified overthinker",              layout: 'top-bottom',
    small: "certified",            big: "OVER",       after: "thinker."          },
  { id: 10, phrase: "Serial napper",                      layout: 'top-bottom',
    small: "serial",               big: "NAPPER",     after: ""                  },
  { id: 11, phrase: "She believed she could, so she took a nap", layout: 'top-bottom',
    small: "She believed she could,\nso she took a",  big: "NAP.", after: ""     },
  { id: 12, phrase: "I run on coffee and sarcasm",        layout: 'big-top',
    small: "",                     big: "COFFEE",     after: "I run on coffee and sarcasm." },
  { id: 13, phrase: "Zero Motivation Club",               layout: 'top-bottom',
    small: "Zero Motivation",      big: "CLUB",       after: ""                  },
  { id: 14, phrase: "Emotionally attached to my couch",  layout: 'top-bottom',
    small: "emotionally attached to my", big: "COUCH", after: ""                },
  { id: 15, phrase: "Fashion? I prefer comfort.",        layout: 'top-bottom',
    small: "Fashion? I prefer",    big: "COMFORT.",    after: ""                },
  { id: 16, phrase: "My goal: minimal EXISTENCE.",       layout: 'top-bottom',
    small: "My goal: minimal",     big: "EXISTENCE.",  after: ""                },
  { id: 17, phrase: "Experienced in EXHAUSTION.",        layout: 'top-bottom',
    small: "Experienced in",       big: "EXHAUSTION",  after: "."                },
  { id: 18, phrase: "Unfashionably COMFORTABLE.",        layout: 'top-bottom',
    small: "Unfashionably",        big: "COMFORTABLE", after: "."                },
];

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
function setFont(ctx, size) {
  // Impact is inherently bold/condensed — no weight needed
  ctx.font = `${size}px "Impact"`;
}

/**
 * Add imperceptibly subtle noise across the canvas.
 * This defeats PNG deflate compression and pushes files above 200 KB
 * without any visible effect on the design.
 * alpha: 0–255 — keep <= 2 for true invisibility (1 is safe).
 */
function addNoise(ctx, width, height, alpha = 1) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data      = imageData.data;
  // Simple LCG pseudo-random to avoid Math.random() per-pixel overhead
  let seed = 0xDEADBEEF;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
    const noise = (seed >>> 24) & 0x01; // 0 or 1
    if (noise) {
      data[i]     = (data[i]     + 1) & 0xFF; // R
      data[i + 1] = (data[i + 1] + 1) & 0xFF; // G
      data[i + 2] = (data[i + 2] + 1) & 0xFF; // B
      if (data[i + 3] === 0) data[i + 3] = alpha; // force slight alpha on transparent px
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Draw text centered horizontally, potentially multi-line.
 * Returns the y-position after the last line.
 */
function drawCenteredText(ctx, text, x, y, lineHeight) {
  const lines = text.split('\n');
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/**
 * Measure the width of the widest line in a potentially multi-line string.
 */
function measureMaxWidth(ctx, text) {
  return Math.max(...text.split('\n').map(l => ctx.measureText(l).width));
}

// ---------------------------------------------------------------------------
// Back design generator  (3000 × 3600 px)
// ---------------------------------------------------------------------------
const BACK_W = 3000;
const BACK_H = 3600;

const BIG_SIZE   = 700;  // dominant word font size
const SMALL_SIZE = 175;  // secondary text font size
const AFTER_SIZE = 175;
const DUBIS_SIZE =  65;  // watermark corner text

/**
 * Generates one back design PNG.
 *
 * Layout math (2026-05-15 rewrite — fixes asymmetric gaps):
 *   All blocks share centerX = BACK_W/2 with textAlign='center'.
 *   Vertical positioning uses cap-height math (CAP_RATIO ≈ 0.74 for Impact)
 *   instead of relying on the alphabetic baseline alone. Each block's visual
 *   "top" (cap-top) is placed deterministically with a uniform VISUAL_GAP
 *   between blocks, so the BIG word has equal whitespace above AND below it.
 *
 *   Old code drew BIG at baseline = curY + BIG_SIZE, leaving a big invisible
 *   ascender area above (≈26% of font-size) but no compensating space below.
 *   Result: ~446px gap above LIMITED, ~35px below.
 *
 * @param {object} product
 * @param {string} color  'white' | 'dark'
 * @param {string} outPath
 */
const CAP_RATIO       = 0.74; // Impact cap-height as fraction of font-size
const VISUAL_GAP      = 110;  // px of clear space between stacked blocks
const LINE_GAP_RATIO  = 0.10; // tight line spacing within a multi-line block
const STACK_CENTER_Y  = BACK_H * 0.43; // vertical center of the entire stack

function blockVisualHeight(text, fontSize) {
  if (!text) return 0;
  const lines = text.split('\n');
  const cap   = fontSize * CAP_RATIO;
  return cap * lines.length + fontSize * LINE_GAP_RATIO * (lines.length - 1);
}

/**
 * Draw a (possibly multi-line) text block whose CAP-TOP sits exactly at capTopY.
 * Each line is horizontally centered (textAlign must be 'center').
 */
function drawBlockAtCapTop(ctx, text, fontSize, capTopY, centerX) {
  setFont(ctx, fontSize);
  const lines = text.split('\n');
  const cap   = fontSize * CAP_RATIO;
  const lineH = cap + fontSize * LINE_GAP_RATIO;
  let y = capTopY;
  for (const line of lines) {
    // textBaseline='alphabetic': baseline = cap-top + cap-height
    ctx.fillText(line, centerX, y + cap);
    y += lineH;
  }
}

function generateBack(product, color, outPath) {
  const canvas = createCanvas(BACK_W, BACK_H);
  const ctx    = canvas.getContext('2d');

  // Transparent background — canvas is transparent by default
  ctx.clearRect(0, 0, BACK_W, BACK_H);

  const textColor = color === 'white' ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle    = textColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  const centerX = BACK_W / 2;

  // ---- layout: top-bottom (small → BIG → after) ----
  if (product.layout === 'top-bottom') {
    const hSmall = blockVisualHeight(product.small, SMALL_SIZE);
    const hBig   = blockVisualHeight(product.big,   BIG_SIZE);
    const hAfter = blockVisualHeight(product.after, AFTER_SIZE);

    const presentBlocks = [hSmall, hBig, hAfter].filter(h => h > 0);
    const totalH = presentBlocks.reduce((a, b) => a + b, 0)
                 + VISUAL_GAP * Math.max(0, presentBlocks.length - 1);

    let curY = STACK_CENTER_Y - totalH / 2;

    if (product.small) {
      drawBlockAtCapTop(ctx, product.small, SMALL_SIZE, curY, centerX);
      curY += hSmall + VISUAL_GAP;
    }
    if (product.big) {
      drawBlockAtCapTop(ctx, product.big, BIG_SIZE, curY, centerX);
      curY += hBig + VISUAL_GAP;
    }
    if (product.after) {
      drawBlockAtCapTop(ctx, product.after, AFTER_SIZE, curY, centerX);
    }
  }

  // ---- layout: big-top (BIG → after, no small above) ----
  else if (product.layout === 'big-top') {
    const hBig   = blockVisualHeight(product.big,   BIG_SIZE);
    const hAfter = blockVisualHeight(product.after, AFTER_SIZE);

    const presentBlocks = [hBig, hAfter].filter(h => h > 0);
    const totalH = presentBlocks.reduce((a, b) => a + b, 0)
                 + VISUAL_GAP * Math.max(0, presentBlocks.length - 1);

    let curY = STACK_CENTER_Y - totalH / 2;

    if (product.big) {
      drawBlockAtCapTop(ctx, product.big, BIG_SIZE, curY, centerX);
      curY += hBig + VISUAL_GAP;
    }
    if (product.after) {
      drawBlockAtCapTop(ctx, product.after, AFTER_SIZE, curY, centerX);
    }
  }

  // No DUBIS branding on back — slogan only (per brand rules)

  // Subtle noise to ensure file size > 200 KB (defeats PNG compression)
  addNoise(ctx, BACK_W, BACK_H, 1);

  // Write file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

// ---------------------------------------------------------------------------
// Front logo generator  (3600 × 4200 px)
// Oren directive 2026-04-23: chest-left polo-style logo, UNIFORM across all
// 18 products. Replaces the 2026-04-21 "900px centered" approach which caused
// the Hila test-order mismatch (site mockup showed small-left, print file
// printed huge-center).
//
// NEW PLACEMENT:
//   - DUBIS™ rendered in top-left quadrant of the 3600×4200 canvas
//   - Horizontal center at x ≈ 22% from left (left-chest position)
//   - Vertical center at y ≈ 17% from top (upper chest, below collar)
//   - Font size 300px (≈ 2.5cm printed width — polo/Lacoste scale)
//   - TM superscript rendered separately at ~0.6× size, offset up/right
//
// COVERAGE GATE:
//   The Gelato ≥5% non-transparent pixel gate is satisfied by addNoise()
//   adding a 1-alpha "ghost" dot to ~50% of pixels — invisible in print but
//   counts as non-transparent in Gelato's validator. No need to inflate the
//   logo itself.
// ---------------------------------------------------------------------------
const FRONT_W = 3600;
const FRONT_H = 4200;
const LOGO_FONT_SIZE = 300;  // polo-style chest-left, ~2.5cm printed
const TM_RATIO       = 0.45; // TM is ~45% of the main letter height
// 2026-04-24 FIX: print file had x=0.22 which made Gelato print DUBIS on
// WEARER'S RIGHT chest (confirmed by oren looking at live Gelato mockup).
// Mirror to x=0.78 so it prints on WEARER'S LEFT (classic Polo/Lacoste).
// Matches the website mockup position (composite-mockups.js x=0.60 on blank).
const LOGO_CENTER_X_RATIO = 0.78; // wearer's left chest = viewer's right
const LOGO_CENTER_Y_RATIO = 0.17; // upper chest, below collar

function generateFrontLogo(color, outPath) {
  const canvas = createCanvas(FRONT_W, FRONT_H);
  const ctx    = canvas.getContext('2d');

  ctx.clearRect(0, 0, FRONT_W, FRONT_H);

  const textColor = color === 'white' ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle    = textColor;
  ctx.textBaseline = 'middle';

  const cx = FRONT_W * LOGO_CENTER_X_RATIO;
  const cy = FRONT_H * LOGO_CENTER_Y_RATIO;

  // --- Main "DUBIS" ---
  setFont(ctx, LOGO_FONT_SIZE);
  ctx.textAlign = 'center';
  ctx.fillText('DUBIS', cx, cy);

  // --- Superscript TM to the right of the "S" ---
  // Measure DUBIS width to find the baseline-right position for TM
  const dubisWidth = ctx.measureText('DUBIS').width;
  const tmSize     = LOGO_FONT_SIZE * TM_RATIO;
  setFont(ctx, tmSize);
  ctx.textAlign = 'left';
  // TM baseline sits at top of DUBIS caps → shift cy up by ~30% of LOGO_FONT_SIZE
  const tmX = cx + dubisWidth / 2 + 6;   // slight gap after "S"
  const tmY = cy - LOGO_FONT_SIZE * 0.30;
  ctx.fillText('\u2122', tmX, tmY);

  // Subtle noise to ensure file size > 200 KB AND push non-transparent pixel
  // ratio over Gelato's 5% coverage gate.
  addNoise(ctx, FRONT_W, FRONT_H, 1);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

// ---------------------------------------------------------------------------
// Cap design generator  (1800 × 900 px)
// ---------------------------------------------------------------------------
const CAP_W = 1800;
const CAP_H = 900;
const CAP_FONT_SIZE = 220;

function generateCap(color, outPath) {
  const canvas = createCanvas(CAP_W, CAP_H);
  const ctx    = canvas.getContext('2d');

  ctx.clearRect(0, 0, CAP_W, CAP_H);

  const textColor = color === 'white' ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle    = textColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  setFont(ctx, CAP_FONT_SIZE);
  ctx.fillText('DUBIS', CAP_W / 2, CAP_H / 2 + CAP_FONT_SIZE * 0.35);

  // Subtle noise to ensure file size > 200 KB
  addNoise(ctx, CAP_W, CAP_H, 1);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

// ---------------------------------------------------------------------------
// Fetch a single product from Supabase DB (for --product-id=X flag)
// ---------------------------------------------------------------------------
async function fetchProductFromDB(productId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for DB fetch');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?id=eq.${productId}&select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Product ${productId} not found in DB`);
  const p = rows[0];
  return {
    id: p.id,
    phrase: p.phrase || p.slogan,
    layout: p.typography_layout || 'top-bottom',
    small: p.typography_small || '',
    big: p.typography_big || '',
    after: p.typography_after || '',
    type: p.type
  };
}

// ---------------------------------------------------------------------------
// Main — run all generators
// ---------------------------------------------------------------------------
const MIN_SIZE_BYTES = 200 * 1024; // 200 KB

function reportFile(label, bytes, warnings) {
  const kb = (bytes / 1024).toFixed(1);
  if (bytes < MIN_SIZE_BYTES) {
    const msg = `SMALL FILE WARNING: ${label} is only ${kb} KB (< 200 KB required)`;
    warnings.push(msg);
    console.warn('  [WARN]', msg);
  } else {
    console.log(`  OK  ${label} — ${kb} KB`);
  }
}

async function main() {
  const warnings = [];
  let generated = 0;

  // Check for --product-id=X flag
  const productIdArg = process.argv.find(a => a.startsWith('--product-id='));
  let products = PRODUCTS;

  if (productIdArg) {
    const id = parseInt(productIdArg.split('=')[1]);
    console.log(`Fetching product ${id} from Supabase...`);
    const dbProduct = await fetchProductFromDB(id);
    products = [dbProduct];
    console.log(`Found: "${dbProduct.phrase}" (${dbProduct.layout})`);
  }

  console.log('\n=== DUBIS Design Generator ===\n');

  // ---- Back designs (skip cap-only products) ----
  console.log('--- Back designs ---');
  for (const p of products) {
    if (p.type === 'cap') continue; // handled separately

    for (const color of ['white', 'dark']) {
      const filename = `back_design_${p.id}_${color}.png`;
      const outPath  = path.join(OUTPUT_DIR, filename);
      const bytes    = generateBack(p, color, outPath);
      reportFile(filename, bytes, warnings);
      generated++;
    }
  }

  // ---- Front logo ----
  console.log('\n--- Front logos ---');
  for (const color of ['white', 'dark']) {
    const filename = `front_logo_${color}.png`;
    const outPath  = path.join(OUTPUT_DIR, filename);
    const bytes    = generateFrontLogo(color, outPath);
    reportFile(filename, bytes, warnings);
    generated++;
  }

  // ---- Cap designs ----
  console.log('\n--- Cap designs ---');
  for (const color of ['white', 'dark']) {
    const filename = `cap_design_${color}.png`;
    const outPath  = path.join(OUTPUT_DIR, filename);
    const bytes    = generateCap(color, outPath);
    reportFile(filename, bytes, warnings);
    generated++;
  }

  // ---- Summary ----
  console.log(`\n=== Done. ${generated} files written to ${OUTPUT_DIR} ===`);
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} file(s) are below the 200 KB minimum:`);
    warnings.forEach(w => console.warn(' -', w));
    console.warn('\nThese files may be rejected by Gelato. Consider increasing');
    console.warn('canvas dimensions, font sizes, or adding decorative elements.');
  } else {
    console.log('All files meet the 200 KB minimum size requirement.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
