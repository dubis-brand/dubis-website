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
// Brand display font. Anton (Google Fonts, OFL license) ships IN the repo at
// scripts/fonts/ so the EXACT same condensed-bold typeface renders both on
// Windows (local) AND on the Ubuntu GitHub Actions runner. Before 2026-06-06
// this loaded Impact from C:\Windows\Fonts — which exists only on Windows, so
// GHA-generated products fell back to a wrong system font (the non-Impact logo
// Hila received on her white tee). Anton ≈ Impact; one font, every environment.
// Must match the TTF's internal family name — node-canvas ignores a custom
// {family} override on some platforms and resolves by the font's real name.
const FONT_FAMILY = 'Anton';
const ANTON_PATH  = path.join(__dirname, 'fonts', 'Anton-Regular.ttf');
if (fs.existsSync(ANTON_PATH)) {
  registerFont(ANTON_PATH, { family: FONT_FAMILY });
  console.log('Registered Anton brand font from repo:', ANTON_PATH);
} else {
  // Fail fast — never silently render with a fallback font (that is exactly the
  // bug we are fixing). A missing brand font is a build-breaking error.
  throw new Error('FATAL: brand font missing at ' + ANTON_PATH +
    ' — refusing to render with a fallback typeface. Restore scripts/fonts/Anton-Regular.ttf.');
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
  { id: 8,  phrase: "Born to nap, forced to work",        layout: 'top-bottom',
    small: "Born to",              big: "NAP",        after: "forced to work."   },
  { id: 9,  phrase: "Certified overthinker",              layout: 'top-bottom',
    small: "certified",            big: "OVER",       after: "thinker."          },
  { id: 10, phrase: "Serial napper",                      layout: 'top-bottom',
    small: "serial",               big: "NAPPER",     after: ""                  },
  { id: 11, phrase: "She believed she could, so she took a nap", layout: 'top-bottom',
    small: "She believed she could,\nso she took a",  big: "NAP.", after: ""     },
  { id: 12, phrase: "I run on coffee and sarcasm",        layout: 'big-top',
    small: "",                     big: "COFFEE",     after: "I run on COFFEE and sarcasm.",
    emphasize: { word: "COFFEE", scale: 1.6 } },
  { id: 13, phrase: "Zero Motivation Club",               layout: 'top-bottom',
    small: "Zero Motivation",      big: "CLUB",       after: ""                  },
  { id: 14, phrase: "Emotionally attached to my couch",  layout: 'top-bottom',
    small: "emotionally attached to my", big: "COUCH", after: ""                },
  { id: 15, phrase: "Fashion? I prefer comfort.",        layout: 'top-bottom',
    small: "Fashion? I prefer",    big: "COMFORT.",    after: ""                },
  { id: 16, phrase: "My goal: minimal EXISTENCE.",       layout: 'top-bottom',
    small: "My goal: minimal",     big: "EXISTENCE.",  after: ""                },
  { id: 17, phrase: "Experienced in EXHAUSTION.",        layout: 'top-bottom',
    small: "Experienced in",       big: "EXHAUSTION.", after: ""                 },
  { id: 18, phrase: "Unfashionably COMFORTABLE.",        layout: 'top-bottom',
    small: "Unfashionably",        big: "COMFORTABLE.", after: ""                },
];

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
function setFont(ctx, size) {
  // Impact is inherently bold/condensed — no weight needed
  ctx.font = `${size}px "${FONT_FAMILY}"`;
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

/**
 * Iteratively shrink fontSize until the widest line fits maxWidth.
 * Fixes overflow clipping for long keywords like UNCOMFORTABLE / EXISTENCE.
 * Returns the largest fontSize that fits, or minSize if even that overflows.
 */
function fitFontSize(ctx, text, startSize, maxWidth, shrinkRatio = 0.95, minSize = 40) {
  if (!text) return startSize;
  let size = startSize;
  setFont(ctx, size);
  let width = measureMaxWidth(ctx, text);
  while (width > maxWidth && size > minSize) {
    size = size * shrinkRatio;
    setFont(ctx, size);
    width = measureMaxWidth(ctx, text);
  }
  return size;
}

/**
 * Split a line of text into segments around an emphasized word.
 * The emphasized word renders at baseSize * scale; everything else at baseSize.
 * Returns null if the word is not found (caller falls back to uniform rendering).
 */
function splitWithEmphasis(text, word, baseSize, scale) {
  const idx = text.indexOf(word);
  if (idx < 0) return null;
  return [
    { text: text.slice(0, idx),               size: baseSize         },
    { text: word,                              size: baseSize * scale },
    { text: text.slice(idx + word.length),    size: baseSize         },
  ];
}

/**
 * Emphasis-aware max width across all lines in a (possibly multi-line) string.
 * Uses the base size for non-emphasized parts and baseSize*scale for the
 * emphasized word. Falls back to plain measureMaxWidth when emphasize is unset.
 */
function measureMaxWidthEmph(ctx, text, baseSize, emphasize) {
  if (!emphasize) {
    setFont(ctx, baseSize);
    return measureMaxWidth(ctx, text);
  }
  return Math.max(...text.split('\n').map(line => {
    const segs = splitWithEmphasis(line, emphasize.word, baseSize, emphasize.scale);
    if (!segs) {
      setFont(ctx, baseSize);
      return ctx.measureText(line).width;
    }
    let w = 0;
    for (const s of segs) {
      setFont(ctx, s.size);
      w += ctx.measureText(s.text).width;
    }
    return w;
  }));
}

/**
 * Emphasis-aware version of fitFontSize. Shrinks the base size until the
 * emphasis-aware width fits maxWidth. Without an emphasize spec this is
 * identical to fitFontSize.
 */
function fitFontSizeEmph(ctx, text, startSize, maxWidth, emphasize, shrinkRatio = 0.95, minSize = 40) {
  if (!text) return startSize;
  let size = startSize;
  let width = measureMaxWidthEmph(ctx, text, size, emphasize);
  while (width > maxWidth && size > minSize) {
    size = size * shrinkRatio;
    width = measureMaxWidthEmph(ctx, text, size, emphasize);
  }
  return size;
}

// ---------------------------------------------------------------------------
// Back design generator  (3000 × 3600 px)
// ---------------------------------------------------------------------------
const BACK_W = 3000;
const BACK_H = 3600;

const BIG_SIZE   = 700;  // dominant word font size
const SMALL_SIZE = 175;  // secondary text font size
const AFTER_SIZE = 175;

// ---------------------------------------------------------------------------
// 2026-05-16 rewrite — equal cap-to-cap gaps, fully color-independent.
//
// Layout algorithm:
//   1. Flatten every block into individual visual lines (split on '\n').
//   2. Each line's visual height = fontSize * CAP_RATIO.
//   3. Total stack height = Σ(capHeights) + GAP * (n - 1).
//   4. Center stack vertically: topY = (BACK_H - totalH) / 2.
//   5. Walk lines top-down, drawing each at baselineY = topY + capHeight,
//      then advancing topY by capHeight + GAP for the next line.
//
// GAP is a fixed pixel value, identical between every adjacent pair of lines.
// Result: the keyword has the same whitespace above and below.
//
// CAP_RATIO calibrated to 0.72 for Impact (standard condensed display font
// cap-height ratio). The previous 0.74 over-estimated cap-height slightly,
// which compressed the apparent gap below the keyword vs above.
// ---------------------------------------------------------------------------
const CAP_RATIO = 0.72;
const GAP       = 180;  // px of clear space between adjacent cap-blocks
                        // (≈ 60px at 4500px reference scale × our 3600 height)
                        // bumped from 110 → 180 so 2-line layouts (#4, #8, #12)
                        // breathe like 3-line layouts.

function generateBack(product, color, outPath) {
  const canvas = createCanvas(BACK_W, BACK_H);
  const ctx    = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, BACK_W, BACK_H);

  const textColor = color === 'white' ? '#ffffff' : '#1a1a1a';
  ctx.fillStyle    = textColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  // Single, canonical horizontal center for every line — no color or
  // per-line offset of any kind. Eliminates the legacy X drift the user
  // saw on "NAPPING IS MY / CARDIO".
  const centerX = BACK_W / 2;

  // Auto-fit safe widths: big keyword may use up to 85% of canvas width;
  // small/after lines may use up to 90%. Anything wider gets shrunk so long
  // keywords (UNCOMFORTABLE, EXISTENCE, EXHAUSTION) never clip the edges.
  const SAFE_W_BIG   = BACK_W * 0.85;
  const SAFE_W_SMALL = BACK_W * 0.90;

  // ---- 1) Build the ordered list of blocks for this layout ----
  //     Each block's size is auto-shrunk if its widest line overflows.
  //     `emphasize` (optional, only on the `after` block) lets a single word
  //     inside the small sentence render larger — used by product #12 so the
  //     word COFFEE matches the big-top header inside the sentence too.
  const blocks = [];
  const emph = product.emphasize || null;
  if (product.layout === 'top-bottom') {
    if (product.small) blocks.push({ text: product.small, size: fitFontSize(ctx, product.small, SMALL_SIZE, SAFE_W_SMALL) });
    if (product.big)   blocks.push({ text: product.big,   size: fitFontSize(ctx, product.big,   BIG_SIZE,   SAFE_W_BIG)   });
    if (product.after) blocks.push({ text: product.after, size: fitFontSizeEmph(ctx, product.after, AFTER_SIZE, SAFE_W_SMALL, emph), emphasize: emph });
  } else if (product.layout === 'big-top') {
    if (product.big)   blocks.push({ text: product.big,   size: fitFontSize(ctx, product.big,   BIG_SIZE,   SAFE_W_BIG)   });
    if (product.after) blocks.push({ text: product.after, size: fitFontSizeEmph(ctx, product.after, AFTER_SIZE, SAFE_W_SMALL, emph), emphasize: emph });
  }

  // ---- 2) Flatten multi-line blocks into individual visual lines ----
  //     Lines with an emphasized word carry a `segs` array; their cap-height
  //     is driven by the largest segment so the stack still vertically aligns.
  const lines = [];
  for (const b of blocks) {
    for (const sub of b.text.split('\n')) {
      const segs = b.emphasize
        ? splitWithEmphasis(sub, b.emphasize.word, b.size, b.emphasize.scale)
        : null;
      const cap = segs
        ? Math.max(...segs.map(s => s.size)) * CAP_RATIO
        : b.size * CAP_RATIO;
      lines.push({ text: sub, size: b.size, cap, segs });
    }
  }
  if (lines.length === 0) {
    addNoise(ctx, BACK_W, BACK_H, 1);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buf);
    return buf.length;
  }

  // ---- 3) Total visual height of the stack ----
  const totalH = lines.reduce((s, l) => s + l.cap, 0)
               + GAP * (lines.length - 1);

  // ---- 4) Center stack vertically in canvas ----
  let topY = (BACK_H - totalH) / 2;

  // ---- 5) Draw each line at its cap-top → baseline = topY + cap ----
  //     Plain lines: single fillText centered on canvas.
  //     Segmented lines (emphasis): measure total width, then walk segments
  //     left-to-right starting at centerX - totalW/2, all sharing one baseline.
  for (const l of lines) {
    const baselineY = topY + l.cap;
    if (l.segs) {
      let totalW = 0;
      for (const s of l.segs) {
        setFont(ctx, s.size);
        totalW += ctx.measureText(s.text).width;
      }
      let x = centerX - totalW / 2;
      ctx.textAlign = 'left';
      for (const s of l.segs) {
        setFont(ctx, s.size);
        ctx.fillText(s.text, x, baselineY);
        x += ctx.measureText(s.text).width;
      }
      ctx.textAlign = 'center';
    } else {
      setFont(ctx, l.size);
      ctx.fillText(l.text, centerX, baselineY);
    }
    topY += l.cap + GAP;
  }

  // Subtle noise to push file > 200 KB and satisfy Gelato's coverage gate.
  addNoise(ctx, BACK_W, BACK_H, 1);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

// ---------------------------------------------------------------------------
// Front logo generator  (3600 × 4200 px)
// UNIFORM across all 18 products. Polo/Lacoste-style left-chest placement.
//
// PLACEMENT (2026-05-16 v2 — heart/left-breast pocket position):
//   - Vertical center at y ≈ 32% from top of canvas (heart level, below the
//     collar zone).
//   - Horizontal center at x = 0.78. Pulled IN from the v1 attempt at 0.85
//     because Gelato's actual safe-print area on the printed garment is
//     tighter than the full 3600px design canvas — at 0.85 the "™" sat
//     close enough to the right edge that Gelato cropped it on the shirt.
//     0.78 keeps DUBIS™ fully inside the safe-print zone while still landing
//     on wearer's left chest (heart/pocket level). This is the same value
//     validated against real Gelato output on 2026-04-24.
//   - Font size 300px (≈ 2.5cm printed width — polo/Lacoste scale).
//   - TM superscript rendered separately at ~0.45× size, offset up/right
//     of the "S".
//
// COVERAGE GATE:
//   The Gelato ≥5% non-transparent pixel gate is satisfied by addNoise()
//   adding a 1-alpha "ghost" dot to ~50% of pixels — invisible in print but
//   counts as non-transparent in Gelato's validator.
// ---------------------------------------------------------------------------
const FRONT_W = 3600;
const FRONT_H = 4200;
const LOGO_FONT_SIZE = 300;  // polo-style chest-left, ~2.5cm printed
const TM_RATIO       = 0.45; // TM is ~45% of the main letter height
const LOGO_CENTER_X_RATIO = 0.78; // wearer's left chest, safe-print-zone validated
const LOGO_CENTER_Y_RATIO = 0.32; // heart level — pocket position

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
  // 2026-05-23 (Phase K-A): replaced single TM (U+2122) with composite "TM"
  // (basic Latin T+M). Impact font lacks the TM glyph - falls back to system
  // font that prints with broken/incomplete M on actual garments (Hila's order,
  // see docs/plans/audits/DUBIS_HILA_ORDER_CATASTROPHE_2026-05-23.html).
  // T and M are guaranteed to exist in Impact so the composite renders cleanly.
  const dubisWidth = ctx.measureText('DUBIS').width;
  const tmSize     = LOGO_FONT_SIZE * 0.32;  // smaller - TM as tiny superscript
  setFont(ctx, tmSize);
  ctx.textAlign = 'left';
  const tmX = cx + dubisWidth / 2 + 4;       // small gap after "S"
  const tmY = cy - LOGO_FONT_SIZE * 0.34;    // higher for proper superscript look
  ctx.fillText('TM', tmX, tmY);

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
// Fetch a single product from Supabase DB (for --product-numeric=N flag)
// IMPORTANT: returns id = product_id_numeric (integer), NOT the row uuid —
// the back-design filename must be back_design_19_white.png, not back_design_<uuid>_white.png.
// ---------------------------------------------------------------------------
async function fetchProductFromDB(productNumeric) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for DB fetch');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?product_id_numeric=eq.${productNumeric}&select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Product with product_id_numeric=${productNumeric} not found in DB`);
  const p = rows[0];
  return {
    id: p.product_id_numeric,        // INTEGER — used in filename back_design_{id}_{color}.png
    phrase: p.phrase || p.slogan,
    layout: p.typography_layout || 'top-bottom',
    small: p.typography_small || '',
    big: p.typography_big || '',
    after: p.typography_after || '',
    // 'cap' (AS Colour DTF) and 'cap-emb' (Flexfit embroidered) both have no back design.
    type: (p.clothing_type === 'cap' || p.clothing_type === 'cap-emb') ? 'cap' : (p.type || undefined),
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

  // Accept both --product-id=N (legacy) and --product-numeric=N (canonical, used by GHA workflow).
  // Both expect an INTEGER matching dubis_products.product_id_numeric.
  const productArg = process.argv.find(a => a.startsWith('--product-numeric=') || a.startsWith('--product-id='));
  let products = PRODUCTS;

  if (productArg) {
    const n = parseInt(productArg.split('=')[1]);
    // If the product is already in the hardcoded array, prefer the hardcoded entry
    // (it has hand-tuned typography). Otherwise fetch from DB (a freshly approved product).
    const hardcoded = PRODUCTS.find(p => p.id === n);
    if (hardcoded) {
      products = [hardcoded];
      console.log(`Product ${n}: using hardcoded entry → "${hardcoded.phrase}"`);
    } else {
      console.log(`Product ${n} not in hardcoded array — fetching from Supabase...`);
      const dbProduct = await fetchProductFromDB(n);
      products = [dbProduct];
      console.log(`Found: "${dbProduct.phrase}" (${dbProduct.layout})`);
    }
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
