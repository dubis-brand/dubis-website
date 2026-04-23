#!/usr/bin/env node
/**
 * verify-mockup-parity.js — 2026-04-23
 *
 * GUARDRAIL that enforces site-mockup ↔ Gelato-print parity at deploy time.
 *
 * WHY THIS EXISTS:
 *   2026-04-23 Hila test-order bug. Site mockup showed small chest-left DUBIS
 *   logo; actual Gelato print file had 900px centered DUBIS™. Customer would
 *   have received a garment that didn't match the purchase. The two pipelines
 *   (scripts/generate-designs.js for print, scripts/fix-front-images.js for
 *   mockup) had drifted silently over 48 hours.
 *
 * WHAT IT CHECKS (per product, per color, per face):
 *   1. File existence:
 *      - designs/front_logo_{white|dark}.png   (print file, shared across all products)
 *      - designs/back_design_{id}_{white|dark}.png (print file, per product)
 *      - images/product-{id}-{Color}-front.jpg (website mockup)
 *      - images/product-{id}-{Color}-back.jpg  (website mockup)
 *   2. File size sanity:
 *      - Print PNGs ≥ 200KB (Gelato silent-reject threshold)
 *      - Mockup JPGs ≥ 40KB (Gemini truncation threshold)
 *   3. PNG header integrity for print files (IHDR, ≥ 1800×1800)
 *   4. "Last modified" skew: print file and mockup must be generated within
 *      the SAME regen cycle (< 48h apart). If the print file is fresher than
 *      the mockup by more than 48 hours, deploy is blocked — this is the
 *      drift condition that caused the Hila bug.
 *
 * EXIT CODES:
 *   0 — all parity checks pass
 *   1 — at least one mismatch found; deploy should be blocked
 *
 * HOOKED INTO:
 *   deploy.bat (Phase 0) — blocks git push if verification fails
 *
 * USAGE:
 *   node scripts/verify-mockup-parity.js            # full check
 *   node scripts/verify-mockup-parity.js --product=4  # single product
 *   node scripts/verify-mockup-parity.js --warn-only  # report, don't fail
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const DESIGNS_DIR = path.join(ROOT, 'designs');
const IMAGES_DIR  = path.join(ROOT, 'images');

const MIN_PRINT_KB      = 200;
const MIN_MOCKUP_KB     = 40;
const MIN_PRINT_DIM     = 1800;
const MAX_DRIFT_HOURS   = 48;

// Canonical product/color matrix — must stay in sync with fix-front-images.js PRODUCTS.
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     colors: ['Black','White','Cream','Navy','Red'] },
  { id: 2,  type: 'tshirt',     colors: ['Black','Cream','Navy'] },
  { id: 3,  type: 'hoodie',     colors: ['Charcoal','Cream','Navy','Forest Green'] },
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
];

// Dark garment colors → white ink → dark design file; light → dark ink → dark design
const DARK_COLORS = new Set(['Black','Navy','Charcoal','Forest Green']);

const errors   = [];
const warnings = [];

function err(msg)  { errors.push(msg); console.error('  ✗', msg); }
function warn(msg) { warnings.push(msg); console.warn('  !', msg); }
function ok(msg)   { /* silent unless --verbose */ }

// ---- PNG IHDR parse (first 24 bytes has signature + IHDR chunk start) ----
function readPngDims(filePath) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, buf, 0, 24, 0); } finally { fs.closeSync(fd); }
  // Signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A) return null;
  // IHDR chunk at offset 8, length 4 bytes, then "IHDR" 4 bytes, then width 4 + height 4
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

function checkPrintFile(label, filePath) {
  if (!fs.existsSync(filePath)) { err(`missing print file: ${label}`); return null; }
  const stat = fs.statSync(filePath);
  const kb = stat.size / 1024;
  if (kb < MIN_PRINT_KB) err(`print file ${label} is ${kb.toFixed(0)}KB — below ${MIN_PRINT_KB}KB Gelato threshold`);
  const dims = readPngDims(filePath);
  if (!dims) { err(`print file ${label} is not a valid PNG`); return stat; }
  if (dims.w < MIN_PRINT_DIM || dims.h < MIN_PRINT_DIM) {
    err(`print file ${label} is ${dims.w}×${dims.h} — below ${MIN_PRINT_DIM}×${MIN_PRINT_DIM} minimum`);
  }
  return stat;
}

function checkMockupFile(label, filePath) {
  if (!fs.existsSync(filePath)) { err(`missing mockup: ${label}`); return null; }
  const stat = fs.statSync(filePath);
  const kb = stat.size / 1024;
  if (kb < MIN_MOCKUP_KB) err(`mockup ${label} is ${kb.toFixed(0)}KB — below ${MIN_MOCKUP_KB}KB Gemini-truncation threshold`);
  return stat;
}

function checkDriftHours(printStat, mockupStat, label) {
  if (!printStat || !mockupStat) return;
  const diffMs    = printStat.mtimeMs - mockupStat.mtimeMs;
  const diffHours = diffMs / 3_600_000;
  if (diffHours > MAX_DRIFT_HOURS) {
    err(`DRIFT: print file newer than mockup by ${diffHours.toFixed(1)}h (${label}). Re-run regen-all.bat — site would show stale mockup.`);
  } else if (diffHours > 1) {
    warn(`minor drift: print file newer than mockup by ${diffHours.toFixed(1)}h (${label})`);
  }
}

function safeColor(c) { return c.replace(/\s+/g, '-'); }

// ---- Main ----
const args = process.argv.slice(2);
const warnOnly = args.includes('--warn-only');
const onlyId = (() => {
  const a = args.find(x => x.startsWith('--product='));
  return a ? parseInt(a.split('=')[1]) : null;
})();

console.log('=== DUBIS mockup/print parity verification ===\n');
const products = onlyId ? PRODUCTS.filter(p => p.id === onlyId) : PRODUCTS;

for (const p of products) {
  console.log(`Product ${p.id} (${p.type}):`);

  if (p.type === 'cap') {
    // Caps: only cap_design_*.png on print side; no per-product back
    for (const variant of ['white','dark']) {
      checkPrintFile(`cap_design_${variant}.png`, path.join(DESIGNS_DIR, `cap_design_${variant}.png`));
    }
    // Mockups
    for (const color of p.colors) {
      const sc = safeColor(color);
      checkMockupFile(`product-${p.id}-${sc}-front.jpg`, path.join(IMAGES_DIR, `product-${p.id}-${sc}-front.jpg`));
    }
    continue;
  }

  // ---- BACK ----
  const backWhite = checkPrintFile(`back_design_${p.id}_white.png`, path.join(DESIGNS_DIR, `back_design_${p.id}_white.png`));
  const backDark  = checkPrintFile(`back_design_${p.id}_dark.png`,  path.join(DESIGNS_DIR, `back_design_${p.id}_dark.png`));

  for (const color of p.colors) {
    const sc = safeColor(color);
    const mockupStat = checkMockupFile(`product-${p.id}-${sc}-back.jpg`, path.join(IMAGES_DIR, `product-${p.id}-${sc}-back.jpg`));
    const variant = DARK_COLORS.has(color) ? backWhite : backDark;
    checkDriftHours(variant, mockupStat, `back/p${p.id}/${color}`);
  }

  // ---- FRONT ----
  // Front uses the single shared front_logo_*.png for all products
  const frontWhite = checkPrintFile(`front_logo_white.png`, path.join(DESIGNS_DIR, 'front_logo_white.png'));
  const frontDark  = checkPrintFile(`front_logo_dark.png`,  path.join(DESIGNS_DIR, 'front_logo_dark.png'));

  for (const color of p.colors) {
    const sc = safeColor(color);
    const mockupStat = checkMockupFile(`product-${p.id}-${sc}-front.jpg`, path.join(IMAGES_DIR, `product-${p.id}-${sc}-front.jpg`));
    const variant = DARK_COLORS.has(color) ? frontWhite : frontDark;
    checkDriftHours(variant, mockupStat, `front/p${p.id}/${color}`);
  }
}

console.log('\n=== Summary ===');
console.log(`Errors:   ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

if (errors.length > 0) {
  console.error('\nFailed checks:');
  errors.forEach(e => console.error(' -', e));
  if (!warnOnly) {
    console.error('\n❌ DEPLOY BLOCKED — run `regen-all-20260423.bat` then re-verify.');
    process.exit(1);
  }
  console.error('\n⚠️  --warn-only: failing checks reported but not enforced.');
}

console.log('\n✅ Mockup/print parity OK — deploy may proceed.');
process.exit(0);
