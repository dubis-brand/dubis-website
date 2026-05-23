// One-shot: take JPGs that the migration script wrote to
// `images/products/{id}/product-{id}-{lowercase}-{face}.jpg` and produce the
// canonical site-catalog filenames at `images/product-{id}-{Color}-{face}.jpg`,
// flattened against #D7D7D7 + mozjpeg q90 (matches scripts/create-gelato-drafts.js).
//
// Fixes 2026-05-23 modal back-thumbnail bug: products 23 + 25 had per-color
// images only at the nested subfolder path, so productImg() in js/main.js 404'd
// both front and back thumbnails. See memory/troubleshooting.md.

import { readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const PRODUCT_IDS = process.argv.slice(2).map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
if (!PRODUCT_IDS.length) {
  console.error('usage: node scripts/_normalize-subfolder-mockups.mjs <product-id> [<product-id> …]');
  process.exit(1);
}

const ROOT = 'images';

function toCapCase(lowerColor) {
  // "black" → "Black", "forest green" → "Forest-Green", "navy" → "Navy"
  return lowerColor
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-');
}

let totalWritten = 0;

for (const id of PRODUCT_IDS) {
  const src = join(ROOT, 'products', String(id));
  if (!existsSync(src)) {
    console.error(`✗ ${src} does not exist — skipping product ${id}`);
    continue;
  }
  const files = await readdir(src);
  const targets = files.filter(f => /^product-\d+-[a-z][a-z\s]*-(front|back)\.jpg$/i.test(f));
  console.log(`\n=== Product ${id} (${targets.length} mockups) ===`);

  for (const f of targets) {
    // product-25-forest green-back.jpg → ["25", "forest green", "back"]
    const m = f.match(/^product-(\d+)-(.+?)-(front|back)\.jpg$/i);
    if (!m) { console.warn(`  ?? cannot parse ${f}`); continue; }
    const [, pid, lowerColor, face] = m;
    const Color = toCapCase(lowerColor);
    const srcPath = join(src, f);
    const dstPath = join(ROOT, `product-${pid}-${Color}-${face}.jpg`);

    try {
      await sharp(srcPath)
        .flatten({ background: { r: 215, g: 215, b: 215 } })   // #D7D7D7 canonical site grey
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(dstPath);
      const { size } = await import('node:fs/promises').then(m => m.stat(dstPath));
      console.log(`  ✓ ${dstPath}  (${(size/1024).toFixed(0)} KB)`);
      totalWritten++;
    } catch (e) {
      console.error(`  ✗ ${dstPath}: ${e.message}`);
    }
  }

  // Also produce the hero `images/product-{id}.jpg` (used as the global fallback
  // in onerror handlers + products.js `image` field). Use the Black-front (or
  // whichever first color/front exists) as canonical hero.
  const heroSource = files.find(f => /^product-\d+-black-front\.jpg$/i.test(f))
                  || files.find(f => /^product-\d+-[a-z][a-z\s]*-front\.jpg$/i.test(f));
  if (heroSource) {
    const heroDst = join(ROOT, `product-${id}.jpg`);
    try {
      await sharp(join(src, heroSource))
        .flatten({ background: { r: 215, g: 215, b: 215 } })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(heroDst);
      console.log(`  ✓ ${heroDst}  (hero from ${heroSource})`);
      totalWritten++;
    } catch (e) {
      console.error(`  ✗ ${heroDst}: ${e.message}`);
    }
  }
}

console.log(`\nDone. Wrote ${totalWritten} files.`);
