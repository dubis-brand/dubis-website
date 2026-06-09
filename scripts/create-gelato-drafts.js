'use strict';

/**
 * DUBIS — Gelato Draft Mockup Generator
 *
 * Creates FREE Gelato draft orders for every active product × every color,
 * waits for Gelato to render mockups, then downloads front + back previews
 * to images/gelato-mockups/{product-{id}-{Color}-{front|back}.png}.
 *
 * This is a QA tool — review the saved files before approving as site assets.
 *
 * Run: node scripts/create-gelato-drafts.js
 * Env: .env.local must contain SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, Gelato
 */

const fs   = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}

// sharp is optional — only needed for --save-as-site-images JPG flatten.
// Skip require failure so non-site-images mode still works without it.
let sharp = null;
try { sharp = require('sharp'); } catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GELATO_KEY   = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_*'); process.exit(1); }
if (!GELATO_KEY)                    { console.error('Missing GELATO_API_KEY/Gelato'); process.exit(1); }

// ─────────── CLI argv (2026-05-16 autonomous-product-pipeline) ───────────
//   --product=N           limit to one product_id_numeric (defaults to all active)
//   --first-color-only    only test the first color per product (faster, used by GHA)
//   --save-as-site-images write previews to images/ (renamed product-{id}-{Color}-{face}.jpg)
//                         instead of images/gelato-mockups/ — this is the "production" mode
//                         where Gelato's real previews BECOME the site mockups
//   --json                print a JSON manifest to stdout at the end (for the workflow to parse)
const _argv = process.argv.slice(2);
const _getFlag = name => {
  const eq = _argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = _argv.indexOf(name);
  return idx >= 0 ? true : null;
};
const CLI_PRODUCT          = _getFlag('--product');
const CLI_FIRST_COLOR_ONLY = !!_getFlag('--first-color-only');
const CLI_SAVE_AS_SITE     = !!_getFlag('--save-as-site-images');
const CLI_JSON             = !!_getFlag('--json');

const GELATO_API_BASE = 'https://order.gelatoapis.com';
const DESIGN_BASE_URL = 'https://www.dubis.net/designs';
const DESIGN_VERSION  = process.env.DESIGN_VERSION || '2026052301';
const OUT_DIR         = CLI_SAVE_AS_SITE
  ? path.join(__dirname, '..', 'images')                    // production: site mockups
  : path.join(__dirname, '..', 'images', 'gelato-mockups'); // QA: separate folder

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─────────── Mirror of api/create-gelato-order.js TEMPLATES + COLOR_MAP ───────────
const TEMPLATES = {
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000'  },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'   },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500'  },
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'organic', gpr: '4-4',     brand: 'sols',             sku: '04237'  },  // 2026-06-02 K-C: SOL'S 04237 (Lane Seven was Gelato staging, no mockups)
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'   },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075'  },
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'   },
  // 2026-05-16: Embroidered cap (Flexfit 6245cm). normType strips hyphen
  // from clothing_type='cap-emb' → 'capemb' → templateKey 'capemb-unisex'.
  'capemb-unisex':     { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-emb', brand: 'flexfit',          sku: '6245cm' },
};

const SIZE_MAP = { S:'s', M:'m', L:'l', XL:'xl', '2XL':'2xl', '3XL':'3xl', 'One Size':'onesize' };
const SIZE_OVERRIDE = { 'ziphoodie-unisex': { '2XL':'xxl' } };  // SOL'S 04237 uses xxl for 2XL

const COLOR_MAP = {
  'tshirt-unisex': {
    Black:'black', White:'white', Cream:'natural', Navy:'navy', Charcoal:'charcoal',
    Red:'red', Gray:'rs-sport-grey',
    'Forest Green': { color:'forest-green', brand:'next-level', sku:'3600' },
  },
  'tshirt-women':      { Black:'black', White:'white', Cream:'soft-cream', Navy:'navy' },
  'hoodie-unisex':     { Black:'black', White:'white', Cream:'sand', Navy:'navy', Charcoal:'dark-heather', 'Forest Green':'forest-green', Gray:'sport-grey' },
  'hoodie-women':      { Black:'black', White:'white', Navy:'navy', Charcoal:'charcoal' },
  'ziphoodie-unisex':  { Black:'black', White:'white', Navy:'french-navy', Gray:'grey-melange', 'Royal Blue':'royal-blue' },  // SOL'S 04237 (2026-06-02)
  'longsleeve-unisex': { Black:'black', White:'white', Cream:'sand', Navy:'navy', 'Forest Green':'forest-green', Gray:'sports-grey' },
  'longsleeve-women':  { Black:'deep-black', White:'white', Navy:'french-navy' },
  'cap-unisex':        { Black:'black', White:'white', Cream:'ecru', Navy:'navy' },
  'capemb-unisex':     { Black:'black', White:'white', Navy:'navy', Cream:'stone', Charcoal:'dark-grey' },
};

const DARK = new Set(['Black','Charcoal','Navy','Forest Green','Royal Blue']);

function normType(t) { return String(t).replace(/-/g,''); }
function templateKey(type, gender) { return `${normType(type)}-${gender === 'women' ? 'women' : 'unisex'}`; }

function buildProductUid(type, color, size, gender) {
  const key = templateKey(type, gender);
  const t = TEMPLATES[key]; if (!t) return null;
  const entry = (COLOR_MAP[key] || {})[color]; if (!entry) return null;
  const gColor = typeof entry === 'string' ? entry : entry.color;
  const brand  = (typeof entry === 'object' && entry.brand) ? entry.brand : t.brand;
  const sku    = (typeof entry === 'object' && entry.sku)   ? entry.sku   : t.sku;
  const gSize = (SIZE_OVERRIDE[key] && SIZE_OVERRIDE[key][size]) || SIZE_MAP[size]; if (!gSize) return null;
  const suffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${suffix}`;
}

function getDesignFiles(productId, color, productType) {
  const variant = DARK.has(color) ? 'white' : 'dark';
  const v = `?v=${DESIGN_VERSION}`;
  if (normType(productType) === 'cap') {
    return [{ type:'front', url:`${DESIGN_BASE_URL}/cap_design_${variant}.png${v}` }];
  }
  return [
    { type:'front', url:`${DESIGN_BASE_URL}/front_logo_${variant}.png${v}` },
    { type:'back',  url:`${DESIGN_BASE_URL}/back_design_${productId}_${variant}.png${v}` },
  ];
}

// ─────────── Supabase: pull products ───────────
async function fetchProducts({ includeInactive = false } = {}) {
  const activeFilter = includeInactive ? '' : '&active=eq.true';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?select=product_id_numeric,clothing_type,gender,colors,active,slogan${activeFilter}&order=product_id_numeric.asc`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

// ─────────── Gelato: create draft, get order ───────────
async function createDraft({ productId, color, size, type, gender }) {
  const productUid = buildProductUid(type, color, size, gender);
  if (!productUid) return { ok:false, skip:'unsupported_variant' };

  const files = getDesignFiles(productId, color, type);
  const ref = `mockup-${Date.now()}-${productId}-${color}-${size}`.replace(/[^a-zA-Z0-9-]/g,'-');
  const payload = {
    orderType: 'draft',
    orderReferenceId: ref,
    customerReferenceId: 'mockup-batch',
    currency: 'USD',
    items: [{ itemReferenceId:'i1', productUid, quantity:1, files }],
    shippingAddress: {
      firstName:'Mockup', lastName:'Test',
      addressLine1:'1 Test St', city:'Los Angeles', postCode:'90210',
      country:'US', state:'CA', email:'mockup@dubis.net',
    },
  };

  const r = await fetch(`${GELATO_API_BASE}/v4/orders`, {
    method:'POST',
    headers: { 'X-API-KEY': GELATO_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  if (!r.ok) return { ok:false, status:r.status, body:text.substring(0,300), productUid };
  return { ok:true, id: json.id || json.orderId, productUid, ref, raw:json };
}

async function getOrder(id) {
  const r = await fetch(`${GELATO_API_BASE}/v4/orders/${id}`, {
    headers: { 'X-API-KEY': GELATO_KEY },
  });
  if (!r.ok) return null;
  return r.json();
}

// ─────────── HTTP download ───────────
async function downloadTo(url, outPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────── MAIN ───────────
(async function main() {
  console.log('=== DUBIS Gelato Draft Mockup Generator ===\n');
  console.log('OUT_DIR:', OUT_DIR);

  // When called by the autonomous pipeline with --product=N, we need the row
  // even if active=false (the workflow runs BEFORE we flip active=true).
  let products = await fetchProducts({ includeInactive: !!CLI_PRODUCT });
  console.log(`Loaded ${products.length} products from Supabase.\n`);

  if (CLI_PRODUCT) {
    const target = Number(CLI_PRODUCT);
    products = products.filter(p => Number(p.product_id_numeric) === target);
    if (products.length === 0) {
      console.error(`No product with product_id_numeric=${target}`);
      process.exit(1);
    }
    console.log(`Filtered to product ${target}: ${products[0].slogan}\n`);
  }

  // Build job list: product × color
  const jobs = [];
  for (const p of products) {
    const id = p.product_id_numeric;
    if (!id) continue;
    // Legacy guard for product 19. When --product=19 is passed explicitly we DO want
    // to run for it (that's the whole point of the new pipeline).
    if (id === 19 && !CLI_PRODUCT) {
      console.log(`  [skip] product 19 — no back_design_19_*.png on dubis.net yet`); continue;
    }
    const colors = p.colors || [];
    const colorList = CLI_FIRST_COLOR_ONLY ? colors.slice(0, 1) : colors;
    for (const color of colorList) {
      jobs.push({
        productId: id,
        color,
        // 2026-05-16: caps (both 'cap' AS Colour DTF and 'cap-emb' Flexfit embroidered) → One Size.
        size: (normType(p.clothing_type) === 'cap' || normType(p.clothing_type) === 'capemb') ? 'One Size' : 'M',
        type: p.clothing_type,
        gender: p.gender,
        slogan: p.slogan,
      });
    }
  }
  console.log(`Queued ${jobs.length} draft orders (product × color).\n`);

  // PHASE 1: create all drafts (parallel in small batches)
  console.log('--- Phase 1: creating draft orders ---');
  const drafts = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async j => {
      const r = await createDraft(j);
      const label = `p${j.productId}-${j.color}`;
      if (!r.ok) {
        console.log(`  [FAIL] ${label} — ${r.skip || `HTTP ${r.status}`} ${r.body || ''}`.trim());
        return null;
      }
      console.log(`  [OK]   ${label} → ${r.id}`);
      return { job: j, draft: r };
    }));
    drafts.push(...results.filter(Boolean));
  }
  console.log(`\nCreated ${drafts.length}/${jobs.length} drafts.\n`);

  // PHASE 2: wait for Gelato to render mockups.
  // Initial 60s — preview_back renders LAST (often 30-60s after preview_default).
  console.log('--- Phase 2: waiting 60s for Gelato to render mockups ---');
  await sleep(60000);

  // ─────────────────────────────────────────────────────────────
  // Helpers for STRICT preview-type matching + JPG conversion
  // ─────────────────────────────────────────────────────────────
  function pickPreviews(item) {
    // Gelato preview types observed (memory: gelato-operations.md):
    //   preview_default   = front view, the "hero" mockup
    //   preview_flat      = technical flat view (rarely used as fallback)
    //   preview_back      = back view (renders LAST — often missing on first fetch)
    //   preview_thumbnail = 18KB stub of preview_default (USELESS — never pick this)
    const previews = item?.previews || [];
    const exact = (t) => (previews.find(p => String(p.type).toLowerCase() === t) || {}).url || null;
    const front = exact('preview_default') || exact('preview_flat');
    const back  = exact('preview_back');
    return { front, back };
  }
  const isCap = (t) => normType(t) === 'cap' || normType(t) === 'capemb';
  async function saveAsSiteImage(srcPath, productId, colorSafe, face) {
    // Convert downloaded PNG → JPG with the canonical #D7D7D7 gray background.
    // This matches the rest of the site catalog (see .claude/rules/gelato-operations.md).
    if (!CLI_SAVE_AS_SITE) return srcPath;
    if (!sharp) {
      console.warn(`  [WARN] sharp not installed — keeping PNG for ${path.basename(srcPath)}`);
      return srcPath;
    }
    const jpgPath = path.join(OUT_DIR, `product-${productId}-${colorSafe}-${face}.jpg`);
    await sharp(srcPath)
      .flatten({ background: { r: 215, g: 215, b: 215 } })   // #D7D7D7 — canonical site grey
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(jpgPath);
    // Remove the intermediate PNG (we only commit the JPG).
    try { fs.unlinkSync(srcPath); } catch {}
    return jpgPath;
  }

  // PHASE 3: fetch each order back and extract preview URLs (STRICT match)
  console.log('\n--- Phase 3: fetching mockup URLs + downloading ---');
  let saved = 0;
  const savedFiles = [];
  const failed = [];
  // For --json manifest: track preview URLs per (color)
  const previewIndex = {};

  for (const d of drafts) {
    const { job, draft } = d;
    const label = `p${job.productId}-${job.color}`;
    const needsBack = !isCap(job.type);

    // Retry-fetch the order until preview_back is available (or attempts exhausted).
    // Up to 8 attempts × 30s (~4 min/draft) — Gelato's render queue can be slow
    // on a bad day (2026-06-09: all colors empty after 5 tries, fine on re-run).
    // The callback-level auto-retry is the safety net beyond this.
    let order = await getOrder(draft.id);
    let attempts = 1;
    while (order && attempts < 8) {
      const { front, back } = pickPreviews(order.items?.[0]);
      if (front && (!needsBack || back)) break;
      console.log(`  [wait ${attempts}/7] ${label} — front=${!!front} back=${!!back}, retrying in 30s…`);
      await sleep(30000);
      order = await getOrder(draft.id);
      attempts++;
    }
    if (!order) { console.log(`  [SKIP] ${label} — order fetch returned null`); failed.push(label); continue; }

    const { front: frontUrl, back: backUrl } = pickPreviews(order.items?.[0]);
    if (!frontUrl) {
      console.log(`  [NONE] ${label} — no preview_default after ${attempts} attempts`);
      failed.push(label);
      continue;
    }
    if (needsBack && !backUrl) {
      console.log(`  [PARTIAL] ${label} — preview_back never appeared, saving FRONT only`);
      // Don't fail completely; we still have the front. Caller will flag back as missing.
    }

    const colorSafe = job.color.replace(/\s+/g,'-');
    previewIndex[job.color] = previewIndex[job.color] || {};
    if (frontUrl) {
      const png = path.join(OUT_DIR, `product-${job.productId}-${colorSafe}-front.png`);
      try {
        const bytes = await downloadTo(frontUrl, png);
        const final = await saveAsSiteImage(png, job.productId, colorSafe, 'front');
        console.log(`  [DL]  ${label} front → ${(bytes/1024).toFixed(1)} KB raw → ${path.basename(final)}`);
        savedFiles.push(path.basename(final));
        previewIndex[job.color].front = frontUrl;
        saved++;
      } catch (e) {
        console.log(`  [ERR] ${label} front — ${e.message}`);
      }
    }
    if (backUrl && needsBack) {
      const png = path.join(OUT_DIR, `product-${job.productId}-${colorSafe}-back.png`);
      try {
        const bytes = await downloadTo(backUrl, png);
        // Hard guard: preview_thumbnail is ~18KB. If somehow we got a tiny file, it's the stub.
        if (bytes < 50_000) {
          try { fs.unlinkSync(png); } catch {}
          console.log(`  [STUB] ${label} back  → ${(bytes/1024).toFixed(1)} KB — discarded (stub, not real back)`);
        } else {
          const final = await saveAsSiteImage(png, job.productId, colorSafe, 'back');
          console.log(`  [DL]  ${label} back  → ${(bytes/1024).toFixed(1)} KB raw → ${path.basename(final)}`);
          savedFiles.push(path.basename(final));
          previewIndex[job.color].back = backUrl;
          saved++;
        }
      } catch (e) {
        console.log(`  [ERR] ${label} back — ${e.message}`);
      }
    }
  }

  console.log(`\n=== Done. ${saved} files saved to ${OUT_DIR} ===`);
  if (failed.length) {
    console.log(`\n${failed.length} draft(s) had no preview URLs:`);
    failed.forEach(f => console.log('  -', f));
  }
  console.log('\nSaved filenames:');
  savedFiles.sort().forEach(f => console.log('  ' + f));

  // Emit JSON manifest for autonomous pipeline. The GHA workflow parses this
  // to build the callback payload (gelato_draft_id + per-color preview URLs).
  if (CLI_JSON) {
    // Build preview map { Color: { front: url, back: url } } from previewIndex.
    const manifest = {
      orderId: drafts[0]?.draft?.id || null,
      productId: drafts[0]?.job?.productId ?? (CLI_PRODUCT ? Number(CLI_PRODUCT) : null),
      saved: saved,
      failed: failed,
      previews: previewIndex,  // populated during phase 3 below
      savedFiles: savedFiles,
    };
    console.log('\n===JSON_MANIFEST===');
    console.log(JSON.stringify(manifest, null, 2));
    console.log('===END_JSON_MANIFEST===');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
