#!/usr/bin/env node
/**
 * sync-products-to-js.js
 * Reads dubis_products from Supabase (active=true) and generates products.js
 *
 * Usage:
 *   node scripts/sync-products-to-js.js           # dry-run (shows diff)
 *   node scripts/sync-products-to-js.js --write   # writes to js/products.js
 *   node scripts/sync-products-to-js.js --write --commit  # writes + git commit + push
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env or environment)
 */

const fs = require('fs');
const path = require('path');

// Try loading .env if available
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTS_JS_PATH = path.resolve(__dirname, '../js/products.js');

const WRITE_MODE = process.argv.includes('--write');
const COMMIT_MODE = process.argv.includes('--commit');

// ── Type metadata ──
const TYPE_META = {
  tshirt: {
    typeLabel: 'T-Shirt',
    fabric: '100% combed ring-spun cotton',
    fitUnisex: 'Unisex, regular fit',
    fitWomen: "Women's fitted cut",
    printMethod: 'DTG — Direct-to-Garment',
    printAreas: '["Front", "Back"]',
    care: 'CARE_TSHIRT',
    care_he: 'CARE_TSHIRT_HE',
    sizes: 'SIZES_TSHIRT',
    sizeGuide: 'SIZE_GUIDE_TSHIRT',
  },
  hoodie: {
    typeLabel: 'Hoodie',
    fabric: '80% cotton, 20% polyester — heavyweight fleece',
    fitUnisex: 'Unisex, relaxed fit',
    fitWomen: "Women's relaxed fit",
    printMethod: 'DTG — Direct-to-Garment',
    printAreas: '["Front", "Back"]',
    care: 'CARE_HOODIE',
    care_he: 'CARE_HOODIE_HE',
    sizes: 'SIZES_HOODIE',
    sizeGuide: 'SIZE_GUIDE_HOODIE',
  },
  ziphoodie: {
    typeLabel: 'Zip Hoodie',
    fabric: '80% cotton, 20% polyester — heavyweight fleece',
    fitUnisex: 'Unisex, regular fit',
    fitWomen: "Women's fitted cut",
    printMethod: 'DTG — Direct-to-Garment',
    printAreas: '["Front", "Back"]',
    care: 'CARE_HOODIE',
    care_he: 'CARE_HOODIE_HE',
    sizes: 'SIZES_HOODIE',
    sizeGuide: 'SIZE_GUIDE_HOODIE',
  },
  longsleeve: {
    typeLabel: 'Long-Sleeve',
    fabric: '100% combed ring-spun cotton',
    fitUnisex: 'Unisex, regular fit',
    fitWomen: "Women's fitted cut",
    printMethod: 'DTG — Direct-to-Garment',
    printAreas: '["Front", "Back"]',
    care: 'CARE_TSHIRT',
    care_he: 'CARE_TSHIRT_HE',
    sizes: 'SIZES_LONGSLEEVE',
    sizeGuide: 'SIZE_GUIDE_LONGSLEEVE',
  },
  cap: {
    typeLabel: 'Cap',
    fabric: '100% chino cotton twill, unstructured',
    fitUnisex: 'One Size, adjustable strap',
    fitWomen: 'One Size, adjustable strap',
    printMethod: 'Embroidery',
    printAreas: '["Front"]',
    care: null,  // inline for caps
    care_he: 'CARE_CAP_HE',
    sizes: 'SIZES_CAP',
    sizeGuide: null,  // inline for caps
  },
  // 2026-05-16: Embroidered Flexfit 6245cm dad-hat — alternative to AS Colour 1114 DTF.
  // Frontend treats 'capemb' as the Cap category for filtering (see js/main.js category resolution).
  capemb: {
    typeLabel: 'Cap',
    fabric: '100% combed cotton, structured 6-panel dad cap',
    fitUnisex: 'One Size, adjustable strap',
    fitWomen: 'One Size, adjustable strap',
    printMethod: 'Embroidery',
    printAreas: '["Front"]',
    care: null,
    care_he: 'CARE_CAP_HE',
    sizes: 'SIZES_CAP',
    sizeGuide: null,
  },
};

const PRICES = {
  tshirt: 28,
  hoodie: 41,
  ziphoodie: 46,
  longsleeve: 31,
  cap: 28,
  capemb: 32,  // premium embroidered cap, slightly higher than DTF
};

async function fetchProducts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?active=eq.true&order=id.asc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

function escapeStr(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

const JS_TYPE_MAP = { 't-shirt': 'tshirt', 'hoodie': 'hoodie', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'cap': 'cap', 'cap-emb': 'capemb' };

function generateProductEntry(p) {
  const pType = JS_TYPE_MAP[p.clothing_type] || p.clothing_type || p.type || 'tshirt';
  const meta = TYPE_META[pType] || TYPE_META.tshirt;
  const fit = p.gender === 'women' ? meta.fitWomen : meta.fitUnisex;
  const price = p.price_usd || p.price || PRICES[pType] || 28;
  const colors = JSON.stringify(p.colors || ['Black', 'White']);

  let careStr = meta.care ? `care: ${meta.care},` : `care: [\n            "Spot clean only",\n            "Do not machine wash",\n            "Do not tumble dry",\n            "Reshape and air dry"\n        ],`;
  let sizeGuideStr = meta.sizeGuide ? `sizeGuide: ${meta.sizeGuide}` : `sizeGuide: [{ size: 'One Size', note: 'Adjustable strap, fits most head sizes' }]`;

  const lines = [
    `    {`,
    `        id: ${p.product_id_numeric || p.id},`,
    `        phrase: "${escapeStr(p.slogan || p.phrase)}",`,
    `        type: "${pType}",`,
    `        typeLabel: "${meta.typeLabel}",`,
    `        gender: "${p.gender || 'unisex'}",`,
    `        price: ${price},`,
    `        image: "images/product-${p.product_id_numeric || p.id}.jpg",`,
    `        colors: ${colors},`,
    `        sizes: ${meta.sizes},`,
    `        description: "${escapeStr(p.description_en || p.description || '')}",`,
    `        description_he: "${escapeStr(p.description_he || '')}",`,
    `        fabric: "${meta.fabric}",`,
    `        fit: "${fit}",`,
    `        printMethod: "${meta.printMethod}",`,
    `        printAreas: ${meta.printAreas},`,
    `        ${careStr}`,
    `        care_he: ${meta.care_he},`,
    `        ${sizeGuideStr}`,
    `    }`,
  ];
  return lines.join('\n');
}

function generateProductsJS(products) {
  const header = `// DUBIS - Product Catalog
// Auto-generated by sync-products-to-js.js — DO NOT EDIT MANUALLY
// Last sync: ${new Date().toISOString()}
// Collection 01 - For the rest of us

const SIZES_TSHIRT    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_HOODIE    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_LONGSLEEVE = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_CAP       = ['One Size'];

const SIZE_GUIDE_TSHIRT = [
    { size: 'S',   chest: 46, length: 70 },
    { size: 'M',   chest: 51, length: 72 },
    { size: 'L',   chest: 56, length: 74 },
    { size: 'XL',  chest: 61, length: 76 },
    { size: '2XL', chest: 66, length: 78 },
    { size: '3XL', chest: 71, length: 80 },
];

const SIZE_GUIDE_HOODIE = [
    { size: 'S',   chest: 56, length: 67 },
    { size: 'M',   chest: 61, length: 70 },
    { size: 'L',   chest: 66, length: 73 },
    { size: 'XL',  chest: 71, length: 76 },
    { size: '2XL', chest: 76, length: 79 },
    { size: '3XL', chest: 81, length: 82 },
];

const SIZE_GUIDE_LONGSLEEVE = SIZE_GUIDE_TSHIRT;

const CARE_TSHIRT = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_HOODIE = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_TSHIRT_HE = [
    "כביסה קרה במכונה, בפנים החוצה",
    "ייבוש בחום נמוך",
    "אין להלבין",
    "אל תגהץ ישירות על ההדפסה",
    "אין לניקוי יבש"
];

const CARE_HOODIE_HE = CARE_TSHIRT_HE;

const CARE_CAP_HE = [
    "ניקוי ידני בלבד",
    "אין כביסה במכונה",
    "אין לייבש במייבש",
    "עצב מחדש וייבש באוויר"
];
`;

  // Group by gender (DB uses 'category' or 'gender' column)
  const getGender = (p) => p.gender || p.category || 'unisex';
  const unisex = products.filter(p => getGender(p) === 'unisex');
  const men = products.filter(p => getGender(p) === 'men');
  const women = products.filter(p => getGender(p) === 'women');

  let body = 'const products = [\n';

  if (unisex.length) {
    body += '\n    // ─── UNISEX ────────────────────────────────────────────────────────────\n\n';
    body += unisex.map(p => generateProductEntry(p)).join(',\n');
    body += ',\n';
  }
  if (men.length) {
    body += '\n    // ─── MEN\'S ─────────────────────────────────────────────────────────────\n\n';
    body += men.map(p => generateProductEntry(p)).join(',\n');
    body += ',\n';
  }
  if (women.length) {
    body += '\n    // ─── WOMEN\'S ───────────────────────────────────────────────────────────\n\n';
    body += women.map(p => generateProductEntry(p)).join(',\n');
    body += ',\n';
  }

  body += '];\n';

  return header + '\n' + body;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('Fetching products from Supabase...');
  const products = await fetchProducts();
  console.log(`Found ${products.length} active products`);

  const newContent = generateProductsJS(products);

  if (!WRITE_MODE) {
    console.log('\n--- DRY RUN (use --write to save) ---\n');
    console.log(`Would write ${newContent.length} chars to ${PRODUCTS_JS_PATH}`);
    console.log(`Products: ${products.map(p => `${p.id}: ${p.slogan || p.phrase}`).join(', ')}`);
    return;
  }

  // Backup current file
  const backupPath = PRODUCTS_JS_PATH + '.backup';
  if (fs.existsSync(PRODUCTS_JS_PATH)) {
    fs.copyFileSync(PRODUCTS_JS_PATH, backupPath);
    console.log(`Backup saved: ${backupPath}`);
  }

  fs.writeFileSync(PRODUCTS_JS_PATH, newContent, 'utf8');
  console.log(`Written: ${PRODUCTS_JS_PATH} (${products.length} products)`);

  if (COMMIT_MODE) {
    const { execSync } = require('child_process');
    const repoDir = path.resolve(__dirname, '..');
    try {
      execSync('git add js/products.js', { cwd: repoDir, stdio: 'inherit' });
      execSync(`git commit -m "sync: update products.js from DB (${products.length} products)"`, { cwd: repoDir, stdio: 'inherit' });
      execSync('git push', { cwd: repoDir, stdio: 'inherit' });
      console.log('Committed and pushed to GitHub → Vercel auto-deploy');
    } catch (e) {
      console.error('Git error:', e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
