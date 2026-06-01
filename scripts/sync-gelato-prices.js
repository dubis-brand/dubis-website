#!/usr/bin/env node
/**
 * sync-gelato-prices.js
 * Local Node.js port of the cost+shipping logic now baked into the
 * gelato-stock-check Supabase Edge Function. Use this for the FIRST sync
 * (and any forced re-syncs from a workstation). Daily prod syncs go through
 * the Edge Function via the scheduled-tasks MCP / Vercel cron.
 *
 * Usage:
 *   node scripts/sync-gelato-prices.js                # writes everything
 *   node scripts/sync-gelato-prices.js --dry-run      # logs but doesn't write
 *
 * Env (.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, Gelato (or GELATO_API_KEY)
 */

const fs   = require('fs');
const path = require('path');

// Load .env.local manually (no dotenv dependency required).
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      const k = m[1];
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
const DRY_RUN       = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_ROLE || !GELATO_API_KEY) {
  console.error('Missing required env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GELATO (or GELATO_API_KEY).');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ── Mirror of buildProductUid + COLOR_MAP from api/create-gelato-order.js ──
const ALL_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const CAP_SIZES = ['One Size'];

const TEMPLATES = {
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000'  },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'   },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500'  },
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: 'lane-seven',       sku: 'ls14003' },  // K-C 2026-05-23 — was brand:null (silent Just Hoods JH050)
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'   },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075'  },
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'   },
};

const COLOR_MAP = {
  'tshirt-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Navy': 'navy',
    'Charcoal': 'charcoal', 'Red': 'red', 'Gray': 'rs-sport-grey',
    'Forest Green': { color: 'forest-green', brand: 'next-level', sku: '3600' },
  },
  'tshirt-women': { 'Black': 'black', 'White': 'white', 'Cream': 'soft-cream', 'Navy': 'navy' },
  'hoodie-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy',
    'Charcoal': 'dark-heather', 'Forest Green': 'forest-green', 'Gray': 'sport-grey',
  },
  'hoodie-women': { 'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Charcoal': 'charcoal' },
  'ziphoodie-unisex': { 'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Forest Green': 'forest-green', 'Red': 'red' },  // Lane Seven LS14003 (2026-05-23)
  'longsleeve-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy',
    'Forest Green': 'forest-green', 'Gray': 'sports-grey',
  },
  'longsleeve-women': { 'Black': 'deep-black', 'White': 'white', 'Navy': 'french-navy' },
  'cap-unisex': { 'Black': 'black', 'White': 'white', 'Cream': 'ecru', 'Navy': 'navy' },
};

const SIZE_MAP = { 'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl', 'One Size': 'onesize' };

function templateKey(type, gender) { return `${type}-${gender === 'women' ? 'women' : 'unisex'}`; }

function buildProductUid(type, color, size, gender = 'unisex') {
  const key = templateKey(type, gender);
  const t = TEMPLATES[key];
  if (!t) return null;
  const entry = (COLOR_MAP[key] || {})[color];
  if (!entry) return null;
  const gColor = typeof entry === 'string' ? entry : entry.color;
  const brand  = (typeof entry === 'object' && entry.brand) ? entry.brand : t.brand;
  const sku    = (typeof entry === 'object' && entry.sku)   ? entry.sku   : t.sku;
  const gSize  = SIZE_MAP[size];
  if (!gSize) return null;
  const suffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${suffix}`;
}

async function fetchPrice(productUid, country) {
  const url = `https://product.gelatoapis.com/v3/products/${productUid}/prices?country=${country}`;
  try {
    const r = await fetch(url, { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr)) return null;
    const q1 = arr.find(p => p.quantity === 1) || arr[0];
    const v = q1?.price;
    return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 100) / 100 : null;
  } catch { return null; }
}

async function probeShipping(countryIsoCode, postCode) {
  const probeUid = 'apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_classic_gsi_m_gco_black_gpr_4-4_gildan_64000';
  // Gelato v4 orders:quote requires `recipient` (not shippingAddress), `products`
  // (not items), and a `files[]` per product. We use a public DUBIS design URL
  // as a placeholder file so Gelato can run the production-cost calc.
  try {
    const r = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
      method: 'POST',
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderReferenceId: `dubis-rate-probe-${countryIsoCode}-${Date.now()}`,
        customerReferenceId: 'dubis-rate-probe',
        currency: 'USD',
        recipient: {
          firstName: 'Rate', lastName: 'Probe',
          addressLine1: '1 Probe St',
          city: countryIsoCode === 'IL' ? 'Tel Aviv' : 'Los Angeles',
          postCode,
          country: countryIsoCode,
          state: countryIsoCode === 'IL' ? '' : 'CA',
          email: 'probe@dubis.test',
        },
        products: [{
          itemReferenceId: 'probe',
          productUid: probeUid,
          quantity: 1,
          files: [{ type: 'default', url: 'https://www.dubis.net/designs/front_logo_white.png' }],
        }],
      }),
    });
    if (!r.ok) {
      console.warn(`  ship probe ${countryIsoCode}: HTTP ${r.status}`);
      return null;
    }
    const json = await r.json();
    const methods = json?.quotes?.[0]?.shipmentMethods || json?.shipmentMethods || [];
    const prices = methods.map(m => m?.price).filter(p => typeof p === 'number');
    if (prices.length === 0) {
      console.warn(`  ship probe ${countryIsoCode}: no methods`, JSON.stringify(json).slice(0, 200));
      return null;
    }
    return Math.round(Math.min(...prices) * 100) / 100;
  } catch (e) { console.warn(`  ship probe ${countryIsoCode}: ${e.message}`); return null; }
}

(async function main() {
  console.log(`[sync-gelato-prices] start ${DRY_RUN ? '(DRY RUN)' : ''}`);
  const t0 = Date.now();

  const { data: products, error } = await sb
    .from('dubis_products')
    .select('id, product_id_numeric, clothing_type, gender, colors')
    .eq('active', true)
    .order('product_id_numeric');
  if (error) { console.error('DB error:', error); process.exit(1); }
  console.log(`Active products: ${products.length}`);

  const queue = [];
  for (const p of products) {
    const rawType = p.clothing_type;
    const type = rawType.replace(/-/g, '');
    const colors = Array.isArray(p.colors) ? p.colors : [];
    const sizes = type === 'cap' ? CAP_SIZES : ALL_SIZES;
    const tplKey = templateKey(type, p.gender);
    if (!TEMPLATES[tplKey]) continue;
    const cm = COLOR_MAP[tplKey] || {};
    for (const color of colors) {
      if (!cm[color]) continue;
      for (const size of sizes) {
        const uid = buildProductUid(type, color, size, p.gender);
        if (!uid) continue;
        queue.push({ p, rawType, color, size, uid });
      }
    }
  }
  console.log(`Variants to process: ${queue.length}`);

  let ok = 0, fail = 0;
  const samples = [];
  const BATCH = 8;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    await Promise.all(batch.map(async w => {
      const [costUs, costIl] = await Promise.all([
        fetchPrice(w.uid, 'US'),
        fetchPrice(w.uid, 'IL'),
      ]);
      if (costUs == null && costIl == null) {
        fail++;
        return;
      }
      const updates = {
        product_id_numeric: w.p.product_id_numeric,
        clothing_type: w.rawType,
        color: w.color,
        size: w.size,
        gelato_product_uid: w.uid,
        cost_synced_at: new Date().toISOString(),
      };
      if (costUs != null) updates.gelato_cost_us_usd = costUs;
      if (costIl != null) updates.gelato_cost_usd    = costIl;
      if (samples.length < 5) samples.push({ pid: w.p.product_id_numeric, color: w.color, size: w.size, us: costUs, il: costIl });
      if (!DRY_RUN) {
        const { error: upErr } = await sb
          .from('product_variant_stock')
          .upsert(updates, { onConflict: 'product_id_numeric,color,size' });
        if (upErr) { console.warn(`  upsert fail ${w.p.product_id_numeric} ${w.color}/${w.size}:`, upErr.message); fail++; return; }
      }
      ok++;
    }));
    process.stdout.write(`\r  progress: ${Math.min(i + BATCH, queue.length)}/${queue.length}`);
    await new Promise(r => setTimeout(r, 100));
  }
  process.stdout.write('\n');

  // Shipping rates
  console.log('Probing shipping rates...');
  const [shipUs, shipIl] = await Promise.all([
    probeShipping('US', '90210'),
    probeShipping('IL', '4365817'),
  ]);
  console.log(`  US: $${shipUs}   IL: $${shipIl}`);
  if (!DRY_RUN) {
    const nowIso = new Date().toISOString();
    if (shipUs != null) await sb.from('app_config').upsert({ key: 'gelato_ship_us_usd', value: String(shipUs), updated_at: nowIso }, { onConflict: 'key' });
    if (shipIl != null) await sb.from('app_config').upsert({ key: 'gelato_ship_il_usd', value: String(shipIl), updated_at: nowIso }, { onConflict: 'key' });
  }

  console.log(`\n[sync-gelato-prices] done in ${Math.round((Date.now() - t0) / 1000)}s — ok=${ok} fail=${fail}`);
  console.log('Sample variants:');
  console.table(samples);
})();
