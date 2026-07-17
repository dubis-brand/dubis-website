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
  // 2026-05-19: V-neck — premium-tier brand-less alias (Bella+Canvas-class fabric).
  vneck: {
    typeLabel: 'V-Neck',
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
  // 2026-05-19: Tank-top — premium-tier brand-less alias.
  tanktop: {
    typeLabel: 'Tank Top',
    fabric: '100% combed ring-spun cotton, lightweight jersey',
    fitUnisex: 'Unisex, regular fit',
    fitWomen: "Women's fitted cut",
    printMethod: 'DTG — Direct-to-Garment',
    printAreas: '["Front", "Back"]',
    care: 'CARE_TSHIRT',
    care_he: 'CARE_TSHIRT_HE',
    sizes: 'SIZES_TSHIRT',
    sizeGuide: 'SIZE_GUIDE_TSHIRT',
  },
  // 2026-07-17: ACCESSORIES pilot — single-variant Gelato products (One Size).
  // care/care_he/sizeGuide are inline literals so no extra output consts are needed.
  mug: {
    typeLabel: 'Mug',
    fabric: '11oz ceramic',
    fitUnisex: '11oz / 330ml',
    fitWomen: '11oz / 330ml',
    printMethod: 'Sublimation wrap',
    printAreas: '["Wrap"]',
    care: '["Dishwasher safe", "Microwave safe", "Print stays put with normal use"]',
    care_he: '["בטוח למדיח כלים", "בטוח למיקרוגל", "ההדפס נשאר במקום בשימוש רגיל"]',
    sizes: 'SIZES_CAP',
    sizeGuide: '[]',
  },
  bottle: {
    typeLabel: 'Water Bottle',
    fabric: '17oz stainless steel',
    fitUnisex: '17oz / 500ml',
    fitWomen: '17oz / 500ml',
    printMethod: 'Sublimation wrap',
    printAreas: '["Wrap"]',
    care: '["Hand wash recommended", "Do not microwave", "Keeps drinks cold for hours"]',
    care_he: '["מומלץ לשטוף ידנית", "לא להכניס למיקרוגל", "שומר על משקאות קרים לשעות"]',
    sizes: 'SIZES_CAP',
    sizeGuide: '[]',
  },
  tote: {
    typeLabel: 'Tote Bag',
    fabric: '100% cotton canvas',
    fitUnisex: '38 x 42 cm',
    fitWomen: '38 x 42 cm',
    printMethod: 'DTG print',
    printAreas: '["Front"]',
    care: '["Machine wash cold", "Hang to dry", "Do not iron the print"]',
    care_he: '["כביסה קרה במכונה", "לתלות לייבוש", "לא לגהץ על ההדפס"]',
    sizes: 'SIZES_CAP',
    sizeGuide: '[]',
  },
};

const PRICES = {
  tshirt: 28,
  hoodie: 41,
  ziphoodie: 55,  // 2026-06-02 K-C: SOL'S 04237 IL $52.66-54.90 → CEIL $55 (Lane Seven LS14003 was Gelato staging, no mockups)
  longsleeve: 31,
  cap: 28,
  capemb: 32,  // premium embroidered cap, slightly higher than DTF
  // 2026-05-19 — defaults per rule #7 (CEIL of cheapest IL cost):
  // vneck unisex $29.44 → $30, womens $25.03 → $26
  // tanktop unisex $27.11 → $28, womens $31.11 → $32
  vneck: 30,
  tanktop: 30,
  mug: 10,     // accessories pilot 2026-07-17: cost_il + $1
  bottle: 25,
  tote: 18,
};

async function fetchProducts() {
  // 2026-05-21: supported_countries added to SELECT (added via migration
  // add_supported_countries_to_dubis_products). Source-populated by
  // scripts/probe-product-country-availability.js. Surfaced on product
  // cards as flag emojis so an IL visitor knows what they can order.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?active=eq.true&order=id.asc&select=*,supported_countries`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

// 2026-05-20: per oren — only ship to the public site what's actually
// in stock at Gelato. DB-level rows stay intact so admin sees the full
// catalog (including OOS variants). The customer site shows ONLY
// in-stock colors. A color is "fully OOS" when every size of that
// (product_id, color) is in_stock=false in product_variant_stock.
async function fetchInStockColorsMap() {
  // Paginate through all rows — Supabase default limit is 1000 but
  // product_variant_stock has ~400 rows, fine in one call.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/product_variant_stock?select=product_id_numeric,color,in_stock&limit=10000`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase stock error: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  // Build map: { "<product_id>::<color>": bool any_size_in_stock }
  const map = new Map();
  for (const r of rows) {
    const k = `${r.product_id_numeric}::${r.color}`;
    map.set(k, (map.get(k) || false) || !!r.in_stock);
  }
  return map;
}

function filterInStockColors(product, stockMap) {
  const allColors = product.colors || [];
  if (!allColors.length) return allColors;
  const pid = product.product_id_numeric || product.id;
  // If we have NO stock data for this product (e.g. brand new, cron hasn't
  // populated rows yet) — assume in-stock to avoid hiding the product
  // entirely. The first failed Gelato order will mark variants OOS.
  const hasAnyStockRow = allColors.some(c => stockMap.has(`${pid}::${c}`));
  if (!hasAnyStockRow) return allColors;
  return allColors.filter(c => stockMap.get(`${pid}::${c}`) === true);
}

function escapeStr(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// 2026-05-23 — Build per-color { front, back } URL map for the modal gallery.
// Source of truth: dubis_products.proof_of_completion.permanent_preview_urls
// (set by _migrate-product-23-images.mjs and the auto-migrate path in the
// agents pipeline). Falls back to gelato_preview_urls (presigned, can expire)
// only if permanent_* is missing. Returns {} for legacy products that still
// rely on the flat images/product-{id}-{Color}-{view}.jpg path on disk; main.js
// productImg() detects an empty map and uses the flat path.
function buildColorImagesMap(p, inStockColors) {
  const proof = p.proof_of_completion || {};
  const src = proof.permanent_preview_urls || proof.gelato_preview_urls || null;
  if (!src || typeof src !== 'object') return null;
  const allowed = new Set(inStockColors);
  const out = {};
  for (const [color, sides] of Object.entries(src)) {
    if (!allowed.has(color)) continue;  // skip OOS colors filtered above
    if (!sides || typeof sides !== 'object') continue;
    const entry = {};
    if (typeof sides.front === 'string') entry.front = sides.front;
    if (typeof sides.back  === 'string') entry.back  = sides.back;
    if (entry.front || entry.back) out[color] = entry;
  }
  return Object.keys(out).length ? out : null;
}

function formatColorImages(map) {
  if (!map) return null;
  const lines = ['{'];
  const colors = Object.keys(map);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const v = map[c];
    const parts = [];
    if (v.front) parts.push(`front: "${escapeStr(v.front)}"`);
    if (v.back)  parts.push(`back: "${escapeStr(v.back)}"`);
    const trailing = i < colors.length - 1 ? ',' : '';
    lines.push(`            "${escapeStr(c)}": { ${parts.join(', ')} }${trailing}`);
  }
  lines.push('        }');
  return lines.join('\n');
}

const JS_TYPE_MAP = { 't-shirt': 'tshirt', 'hoodie': 'hoodie', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'cap': 'cap', 'cap-emb': 'capemb', 'v-neck': 'vneck', 'tank-top': 'tanktop', 'mug': 'mug', 'bottle': 'bottle', 'tote': 'tote' };

function generateProductEntry(p, stockMap) {
  const pType = JS_TYPE_MAP[p.clothing_type] || p.clothing_type || p.type || 'tshirt';
  const meta = TYPE_META[pType] || TYPE_META.tshirt;
  const fit = p.gender === 'women' ? meta.fitWomen : meta.fitUnisex;
  const price = p.price_usd || p.price || PRICES[pType] || 28;
  // 2026-05-20: filter out fully-OOS colors so the customer site doesn't
  // offer variants Gelato won't fulfill. DB row keeps full color list →
  // admin still sees them all.
  const inStockColors = stockMap ? filterInStockColors(p, stockMap) : (p.colors || ['Black', 'White']);
  const colors = JSON.stringify(inStockColors);
  const colorImagesMap = buildColorImagesMap(p, inStockColors);
  const colorImagesStr = formatColorImages(colorImagesMap);

  let careStr = meta.care ? `care: ${meta.care},` : `care: [\n            "Spot clean only",\n            "Do not machine wash",\n            "Do not tumble dry",\n            "Reshape and air dry"\n        ],`;
  let sizeGuideStr = meta.sizeGuide ? `sizeGuide: ${meta.sizeGuide}` : `sizeGuide: [{ size: 'One Size', note: 'Adjustable strap, fits most head sizes' }]`;

  // 2026-05-16: NEW badge — products launched within the last 30 days get
  // a "NEW" badge on the site (front-end reads isNew + featuredUntil).
  // launched_at is set by ?type=product-visual-approve when oren approves
  // a product. Backfilled to created_at for legacy active products.
  const launchedAt = p.launched_at ? `"${p.launched_at}"` : 'null';
  let isNew = false;
  let featuredUntil = null;
  if (p.launched_at) {
    const launched = new Date(p.launched_at);
    const ageDays = (Date.now() - launched.getTime()) / 86400000;
    if (ageDays < 30) {
      isNew = true;
      featuredUntil = new Date(launched.getTime() + 30 * 86400000).toISOString();
    }
  }
  const featuredUntilStr = featuredUntil ? `"${featuredUntil}"` : 'null';

  // 2026-05-21: supportedCountries — ISO-2 country codes this product can
  // ship to when ordered ALONE via Gelato (warehouse-mixing in a cart can
  // still cause failures; that's caught at runtime by the stock-probe).
  // Source: scripts/probe-product-country-availability.js. Refreshed via
  // dubis_products.supported_countries column.
  const supportedArr = Array.isArray(p.supported_countries) ? p.supported_countries : ['US','IL'];
  const supportedCountries = JSON.stringify(supportedArr);

  const lines = [
    `    {`,
    `        id: ${p.product_id_numeric || p.id},`,
    `        phrase: "${escapeStr(p.slogan || p.phrase)}",`,
    `        type: "${pType}",`,
    `        typeLabel: "${meta.typeLabel}",`,
    `        gender: "${p.gender || 'unisex'}",`,
    `        price: ${price},`,
    `        image: "${escapeStr(p.image_url || `images/product-${p.product_id_numeric || p.id}.jpg`)}",`,
    `        colors: ${colors},`,
    ...(colorImagesStr ? [`        colorImages: ${colorImagesStr},`] : []),
    `        supportedCountries: ${supportedCountries},`,
    `        launchedAt: ${launchedAt},`,
    `        isNew: ${isNew},`,
    `        featuredUntil: ${featuredUntilStr},`,
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

function generateProductsJS(products, stockMap) {
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

  // 2026-05-20: skip products whose colors are ALL fully OOS. The DB row
  // stays active (admin sees it) but it never reaches js/products.js
  // until at least one color is back in stock.
  const visibleProducts = products.filter(p => {
    if (!stockMap) return true;
    return filterInStockColors(p, stockMap).length > 0;
  });
  const skippedCount = products.length - visibleProducts.length;
  if (skippedCount > 0) {
    console.log(`Skipping ${skippedCount} product(s) — every color fully OOS (still visible in admin):`);
    products.filter(p => !visibleProducts.includes(p)).forEach(p => {
      console.log(`  - id=${p.product_id_numeric}: ${p.slogan || p.phrase}`);
    });
  }

  // Group by gender (DB uses 'category' or 'gender' column)
  const getGender = (p) => p.gender || p.category || 'unisex';
  const unisex = visibleProducts.filter(p => getGender(p) === 'unisex');
  const men    = visibleProducts.filter(p => getGender(p) === 'men');
  const women  = visibleProducts.filter(p => getGender(p) === 'women');

  let body = 'const products = [\n';

  if (unisex.length) {
    body += '\n    // ─── UNISEX ────────────────────────────────────────────────────────────\n\n';
    body += unisex.map(p => generateProductEntry(p, stockMap)).join(',\n');
    body += ',\n';
  }
  if (men.length) {
    body += '\n    // ─── MEN\'S ─────────────────────────────────────────────────────────────\n\n';
    body += men.map(p => generateProductEntry(p, stockMap)).join(',\n');
    body += ',\n';
  }
  if (women.length) {
    body += '\n    // ─── WOMEN\'S ───────────────────────────────────────────────────────────\n\n';
    body += women.map(p => generateProductEntry(p, stockMap)).join(',\n');
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

  console.log('Fetching in-stock color map from product_variant_stock...');
  let stockMap = null;
  try {
    stockMap = await fetchInStockColorsMap();
    console.log(`Loaded stock map for ${stockMap.size} (product,color) combos`);
  } catch (e) {
    console.warn(`WARNING — could not load stock map (${e.message}). All colors will be published, which may include OOS variants. Fix this before next sync.`);
  }

  const newContent = generateProductsJS(products, stockMap);

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
