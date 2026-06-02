// DUBIS — Download Gelato draft-order mockup previews for every product × color combo.
// Usage:
//   node scripts/download-gelato-mockups.js
//   MOCKUPS_OUT_DIR="C:/.../images/gelato-mockups" node scripts/download-gelato-mockups.js
//
// Creates Gelato draft orders (orderType: 'draft' → no production, no charge),
// waits ~40s for Gelato to render mockups, then downloads previews to
// {OUT_DIR}/product-{id}-{Color}-{front|back}.png
//
// Source of truth for productUid + fileUrl logic: api/create-gelato-order.js.
// Re-run after bumping DESIGN_VERSION whenever new design files ship.

'use strict';

const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');

// ─────────────────────────────────────────────────────────────────
// ENV — load Gelato key (supports GELATO_API_KEY / GELATO / Gelato).
// Falls back to dubis-website/.env.local in the main repo so worktrees work.
// ─────────────────────────────────────────────────────────────────
(function loadEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '..', '..', '..', '.env.local'),
    'C:\\Users\\tehar\\OneDrive\\Cladue Projects\\Dubis\\dubis-website\\.env.local',
  ];
  for (const envPath of candidates) {
    try {
      const text = fs.readFileSync(envPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = val;
      }
      console.log(`[env] loaded ${envPath}`);
      return;
    } catch (e) { /* try next */ }
  }
  console.warn('[env] no .env.local found in any candidate path');
})();

const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
if (!GELATO_API_KEY) {
  console.error('FATAL: GELATO_API_KEY not found in env (.env.local). Aborting.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────
const GELATO_API_BASE = 'https://order.gelatoapis.com';
const DESIGN_BASE_URL = 'https://www.dubis.net/designs';
// Bumped 2026-05-18 after the product-12 COFFEE-emphasis design fix landed.
// Always bump after deploying new design files so Gelato re-fetches (cache-buster).
const DESIGN_VERSION  = '2026052301';
const OUT_DIR         = process.env.MOCKUPS_OUT_DIR
                     || path.join(__dirname, '..', 'images', 'gelato-mockups');
const PROGRESS_FILE   = path.join(OUT_DIR, 'progress.json');
const BATCH_SIZE      = 3;
const WAIT_MS         = 60_000; // 60s — preview_back takes longer than preview_default
const MAX_FETCH_RETRIES = 3;    // retry order fetch every 30s if preview_back not ready
const RETRY_WAIT_MS    = 30_000;

// ─────────────────────────────────────────────────────────────────
// GELATO MAPPINGS (copied verbatim from api/create-gelato-order.js — keep in sync)
// ─────────────────────────────────────────────────────────────────
const TEMPLATES = {
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000' },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'  },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500' },
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null   },
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'organic', gpr: '4-4',     brand: 'sols',             sku: '04237' },  // 2026-06-02 K-C: SOL'S 04237 (Lane Seven was Gelato staging, no mockups)
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'  },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075' },
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'  },
  // 2026-05-19: V-neck + Tank-top (prm/4-4 brand-less). Verified via Gelato API.
  'vneck-unisex':      { cat: 't-shirt', sub: 'v-neck',          cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null   },
  'vneck-women':       { cat: 't-shirt', sub: 'v-neck',          cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null   },
  'tanktop-unisex':    { cat: 't-shirt', sub: 'tank-top',        cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null   },
  'tanktop-women':     { cat: 't-shirt', sub: 'tank-top',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null   },
};

const SIZE_MAP = { S: 's', M: 'm', L: 'l', XL: 'xl', '2XL': '2xl', '3XL': '3xl', 'One Size': 'onesize' };

const COLOR_MAP = {
  'tshirt-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Navy': 'navy',
    'Charcoal': 'charcoal', 'Red': 'red', 'Gray': 'rs-sport-grey',
    'Forest Green': { color: 'forest-green', brand: 'next-level', sku: '3600' },
  },
  'tshirt-women':   { 'Black': 'black', 'White': 'white', 'Cream': 'soft-cream', 'Navy': 'navy' },
  'hoodie-unisex':  { 'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy', 'Charcoal': 'dark-heather', 'Forest Green': 'forest-green', 'Gray': 'sport-grey' },
  'hoodie-women':   { 'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Charcoal': 'charcoal' },
  'ziphoodie-unisex': { 'Black': 'black', 'White': 'white', 'Navy': 'french-navy', 'Gray': 'grey-melange', 'Royal Blue': 'royal-blue' },  // 2026-06-02 K-C: SOL'S 04237 colors
  'longsleeve-unisex': { 'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy', 'Forest Green': 'forest-green', 'Gray': 'sports-grey' },
  'longsleeve-women':  { 'Black': 'deep-black', 'White': 'white', 'Navy': 'french-navy' },
  'cap-unisex':        { 'Black': 'black', 'White': 'white', 'Cream': 'ecru', 'Navy': 'navy' },
  // 2026-05-19 v-neck + tank — verified colors via /v3/products/...gco_{color}
  'vneck-unisex':      { 'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Red': 'red' },
  'vneck-women':       { 'Black': 'black', 'White': 'white', 'Navy': 'navy' },
  'tanktop-unisex':    { 'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Red': 'red' },
  'tanktop-women':     { 'Black': 'black' },
};

const DARK_COLORS = new Set(['Black', 'Charcoal', 'Navy', 'Forest Green', 'Royal Blue']);
const SIZE_OVERRIDE = { 'ziphoodie-unisex': { '2XL': 'xxl' } };  // SOL'S 04237 uses xxl for 2XL

function templateKey(type, gender) { return `${type}-${gender === 'women' ? 'women' : 'unisex'}`; }

function buildProductUid(type, dubisColor, dubisSize, gender = 'unisex') {
  const key = templateKey(type, gender);
  const t = TEMPLATES[key]; if (!t) return null;
  const ce = (COLOR_MAP[key] || {})[dubisColor]; if (!ce) return null;
  const gColor = typeof ce === 'string' ? ce : ce.color;
  const brand  = (typeof ce === 'object' && ce.brand) ? ce.brand : t.brand;
  const sku    = (typeof ce === 'object' && ce.sku)   ? ce.sku   : t.sku;
  const gSize  = (SIZE_OVERRIDE[key] && SIZE_OVERRIDE[key][dubisSize]) || SIZE_MAP[dubisSize]; if (!gSize) return null;
  const brandSuffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${brandSuffix}`;
}

function getDesignFiles(productId, color, productType) {
  const variant = DARK_COLORS.has(color) ? 'white' : 'dark';
  const v = `?v=${DESIGN_VERSION}`;
  if (productType === 'cap') {
    return [{ type: 'front', url: `${DESIGN_BASE_URL}/cap_design_${variant}.png${v}` }];
  }
  return [
    { type: 'back',  url: `${DESIGN_BASE_URL}/back_design_${productId}_${variant}.png${v}` },
    { type: 'front', url: `${DESIGN_BASE_URL}/front_logo_${variant}.png${v}` },
  ];
}

// ─────────────────────────────────────────────────────────────────
// PRODUCT CATALOG — mirrors js/products.js. Default size = M.
// p19 omitted: no back_design_19_*.png on prod.
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 1,  type: 'tshirt',     gender: 'unisex', colors: ['Black','White','Cream','Navy','Red'] },
  { id: 2,  type: 'tshirt',     gender: 'unisex', colors: ['Black','Cream','Navy'] },
  { id: 3,  type: 'hoodie',     gender: 'unisex', colors: ['Charcoal','Cream','Navy','Forest Green'] },
  { id: 4,  type: 'tshirt',     gender: 'unisex', colors: ['Black','White','Charcoal','Navy'] },
  { id: 5,  type: 'tshirt',     gender: 'unisex', colors: ['Black','White','Cream','Charcoal'] },
  { id: 6,  type: 'hoodie',     gender: 'unisex', colors: ['Charcoal','Black','Navy'] },
  { id: 7,  type: 'cap',        gender: 'unisex', colors: ['Cream','Black','Navy'] },
  { id: 8,  type: 'tshirt',     gender: 'men',    colors: ['Black','Charcoal','Navy','Red','Forest Green'] },
  { id: 9,  type: 'ziphoodie',  gender: 'men',    colors: ['Black','Navy','Charcoal'] },
  { id: 10, type: 'longsleeve', gender: 'men',    colors: ['Black','Navy','White','Forest Green'] },
  { id: 11, type: 'tshirt',     gender: 'women',  colors: ['White','Cream','Black','Navy'] },
  { id: 12, type: 'tshirt',     gender: 'women',  colors: ['Black','White','Cream','Navy'] },
  { id: 13, type: 'hoodie',     gender: 'women',  colors: ['Charcoal','Navy','Black'] },
  { id: 14, type: 'longsleeve', gender: 'women',  colors: ['White','Black','Navy'] },
  { id: 15, type: 'hoodie',     gender: 'unisex', colors: ['Black','White','Navy','Charcoal'] },
  { id: 16, type: 'hoodie',     gender: 'unisex', colors: ['Black','White','Navy','Charcoal'] },
  { id: 17, type: 'ziphoodie',  gender: 'unisex', colors: ['Black','White','Navy','Charcoal'] },
  { id: 18, type: 'tshirt',     gender: 'unisex', colors: ['Black','White','Navy','Charcoal'] },
];

// ─────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeColor(c) { return c.replace(/\s+/g, '-'); }

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

async function loadProgress() {
  try {
    const text = await fsp.readFile(PROGRESS_FILE, 'utf8');
    return JSON.parse(text);
  } catch { return { combos: {}, startedAt: new Date().toISOString() }; }
}

async function saveProgress(progress) {
  progress.updatedAt = new Date().toISOString();
  await fsp.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return buf.length;
}

const SHIPPING = {
  firstName: 'Draft', lastName: 'Mockup',
  addressLine1: '1 Test St',
  city: 'Los Angeles', postCode: '90210',
  country: 'US', state: 'CA',
  email: 'mockup@dubis.net',
};

// ─────────────────────────────────────────────────────────────────
// GELATO API CALLS
// ─────────────────────────────────────────────────────────────────
async function createDraftOrder(product, color) {
  // Caps come in 'One Size' only — Gelato rejects 'gsi_m' for hats.
  const size = product.type === 'cap' ? 'One Size' : 'M';
  const productUid = buildProductUid(product.type, color, size, product.gender);
  if (!productUid) throw new Error(`buildProductUid returned null for p${product.id} ${color}`);
  const files = getDesignFiles(product.id, color, product.type);
  const orderReferenceId = `mockup-p${product.id}-${safeColor(color)}-${Date.now()}`;
  const payload = {
    orderType: 'draft',
    orderReferenceId,
    customerReferenceId: `mockup-${product.id}`,
    currency: 'USD',
    items: [{ itemReferenceId: 'i1', productUid, quantity: 1, files }],
    shippingAddress: SHIPPING,
  };
  const res = await fetch(`${GELATO_API_BASE}/v4/orders`, {
    method: 'POST',
    headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`createDraft ${res.status}: ${text.slice(0, 300)}`);
  return { orderId: json.id || json.orderId, orderReferenceId, productUid, raw: json };
}

async function fetchOrder(orderId) {
  const res = await fetch(`${GELATO_API_BASE}/v4/orders/${encodeURIComponent(orderId)}`, {
    headers: { 'X-API-KEY': GELATO_API_KEY },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`fetchOrder ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// Gelato item.previews contains up to 4 types when fully rendered:
//   preview_default   → realistic mockup, FRONT view (the "hero" image)
//   preview_back      → realistic mockup, BACK view
//   preview_flat      → flat technical view (design on flat shirt) — front-only
//   preview_thumbnail → small thumb of preview_default (~18KB, useless for site)
//
// preview_back is rendered LAST — initial responses may only contain the first
// three. Caller must retry-fetch until preview_back exists (or product has no
// back design, e.g. caps).
function pickPreviews(order) {
  const item = order?.items?.[0];
  if (!item) return { front: null, back: null, all: [] };
  const previews = item.previews || item.previewUrls || [];
  const all = previews.map(p => ({ type: (p.type || p.previewType || p.name || '').toLowerCase(), url: p.url || p.previewUrl }))
    .filter(p => p.url);
  const exact = t => all.find(p => p.type === t)?.url || null;
  // Front: prefer the realistic default mockup. preview_flat is a fallback
  // (technical flat view). NEVER pick preview_thumbnail — it's an 18KB stub.
  const front = exact('preview_default') || exact('preview_flat');
  const back  = exact('preview_back');
  return { front, back, all };
}

// ─────────────────────────────────────────────────────────────────
// PROCESS ONE COMBO
// ─────────────────────────────────────────────────────────────────
async function processCombo(product, color, progress) {
  const key = `p${product.id}-${color}`;
  if (progress.combos[key]?.status === 'done' && progress.combos[key]?.designVersion === DESIGN_VERSION) {
    return { key, status: 'skipped' };
  }
  const entry = progress.combos[key] = progress.combos[key] || {};
  entry.product = product.id; entry.color = color;
  entry.designVersion = DESIGN_VERSION;
  entry.startedAt = new Date().toISOString();
  try {
    const created = await createDraftOrder(product, color);
    entry.orderId          = created.orderId;
    entry.orderReferenceId = created.orderReferenceId;
    entry.productUid       = created.productUid;
    entry.status           = 'created';
    return { key, status: 'created', orderId: created.orderId, product, color };
  } catch (err) {
    entry.status = 'create-failed';
    entry.error  = String(err.message || err);
    return { key, status: 'create-failed', error: entry.error };
  }
}

async function fetchAndDownload(combo, progress) {
  const { key, product, color, orderId } = combo;
  const entry = progress.combos[key];
  const needsBack = product.type !== 'cap';
  try {
    // Retry-fetch the order until preview_back is available (or attempts exhausted).
    // Caps have no back design, so preview_back will never appear — skip the wait.
    let order = null;
    let front = null, back = null, all = [];
    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
      order = await fetchOrder(orderId);
      ({ front, back, all } = pickPreviews(order));
      if (front && (back || !needsBack)) break;
      if (attempt < MAX_FETCH_RETRIES) {
        console.log(`  [retry ${attempt}/${MAX_FETCH_RETRIES - 1}] ${key}: waiting ${RETRY_WAIT_MS/1000}s for preview_back…`);
        await sleep(RETRY_WAIT_MS);
      }
    }
    entry.previewsAll = all;
    entry.frontUrl    = front;
    entry.backUrl     = back;
    const files = [];
    if (front) {
      const dest = path.join(OUT_DIR, `product-${product.id}-${safeColor(color)}-front.png`);
      const bytes = await downloadFile(front, dest);
      files.push({ type: 'front', dest: path.basename(dest), bytes });
    }
    if (back) {
      const dest = path.join(OUT_DIR, `product-${product.id}-${safeColor(color)}-back.png`);
      const bytes = await downloadFile(back, dest);
      files.push({ type: 'back', dest: path.basename(dest), bytes });
    }
    if (files.length === 0) {
      entry.status = 'no-previews';
      entry.error  = 'No preview URLs in Gelato response';
      return { key, status: 'no-previews' };
    }
    if (needsBack && !back) {
      entry.status = 'partial';
      entry.error  = 'preview_back never appeared (front saved)';
      entry.downloaded  = files;
      entry.completedAt = new Date().toISOString();
      return { key, status: 'partial', files };
    }
    entry.status      = 'done';
    entry.downloaded  = files;
    entry.completedAt = new Date().toISOString();
    return { key, status: 'done', files };
  } catch (err) {
    entry.status = 'download-failed';
    entry.error  = String(err.message || err);
    return { key, status: 'download-failed', error: entry.error };
  }
}

// ─────────────────────────────────────────────────────────────────
// BATCH RUNNER
// ─────────────────────────────────────────────────────────────────
function chunk(arr, n) {
  const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  await ensureDir(OUT_DIR);
  const progress = await loadProgress();
  console.log(`[out] ${OUT_DIR}`);
  console.log(`[design-version] ${DESIGN_VERSION}`);

  const onlyArg = process.argv.find(a => a.startsWith('--product='));
  const onlyId  = onlyArg ? parseInt(onlyArg.split('=')[1]) : null;
  const products = onlyId ? PRODUCTS.filter(p => p.id === onlyId) : PRODUCTS;

  const combos = [];
  for (const p of products) for (const c of p.colors) combos.push({ product: p, color: c });
  console.log(`[mockups] Total combos: ${combos.length}`);
  console.log(`[mockups] Batch size: ${BATCH_SIZE}, wait between create & fetch: ${WAIT_MS}ms`);

  const batches = chunk(combos, BATCH_SIZE);
  let batchIdx = 0;
  const summary = { done: [], failed: [], skipped: [] };

  for (const batch of batches) {
    batchIdx += 1;
    console.log(`\n[batch ${batchIdx}/${batches.length}] creating drafts: ${batch.map(b => `p${b.product.id}-${b.color}`).join(', ')}`);

    const created = await Promise.all(batch.map(b => processCombo(b.product, b.color, progress)));
    for (const r of created) {
      if (r.status === 'skipped') { summary.skipped.push(r.key); continue; }
      if (r.status === 'create-failed') {
        summary.failed.push({ key: r.key, stage: 'create', error: r.error });
        console.log(`  [create] ${r.key}: FAILED — ${r.error}`);
      } else {
        console.log(`  [create] ${r.key}: order ${r.orderId}`);
      }
    }
    await saveProgress(progress);

    const toFetch = created.filter(r => r.status === 'created');
    if (toFetch.length > 0) {
      console.log(`  [wait] ${WAIT_MS / 1000}s for Gelato to render…`);
      await sleep(WAIT_MS);

      const fetched = await Promise.all(toFetch.map(c => fetchAndDownload(c, progress)));
      for (const r of fetched) {
        if (r.status === 'done') {
          summary.done.push(r.key);
          console.log(`  [download] ${r.key}: OK — ${r.files.map(f => f.type).join(', ')}`);
        } else {
          summary.failed.push({ key: r.key, stage: r.status, error: progress.combos[r.key]?.error });
          console.log(`  [download] ${r.key}: ${r.status} — ${progress.combos[r.key]?.error}`);
        }
      }
    }
    await saveProgress(progress);
  }

  console.log('\n========================= SUMMARY =========================');
  console.log(`Total combos:   ${combos.length}`);
  console.log(`Downloaded OK:  ${summary.done.length}`);
  console.log(`Failed:         ${summary.failed.length}`);
  console.log(`Skipped (prev): ${summary.skipped.length}`);
  if (summary.failed.length > 0) {
    console.log('\nFailures:');
    for (const f of summary.failed) console.log(`  - ${f.key} [${f.stage}]: ${f.error}`);
  }
  const onDisk = (await fsp.readdir(OUT_DIR)).filter(f => f.endsWith('.png'));
  console.log(`\nFiles in ${OUT_DIR}: ${onDisk.length}`);
  console.log('===========================================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
