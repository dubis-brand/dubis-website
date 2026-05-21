#!/usr/bin/env node
/**
 * probe-product-country-availability.js
 *
 * For each active product in dubis_products, runs Gelato /v4/orders:quote
 * solo against US + IL recipients to determine which countries the product
 * CAN ship to when ordered alone (no cart-mixing context).
 *
 * Stores the result in dubis_products.supported_countries TEXT[].
 *
 * Usage:
 *   node scripts/probe-product-country-availability.js          # dry-run (logs only)
 *   node scripts/probe-product-country-availability.js --write  # also UPDATEs DB
 *
 * IMPORTANT: This is the SOLO-availability — a product flagged "IL" here
 * may still fail to ship to IL when mixed in a cart with other products
 * Gelato can only produce from a different warehouse. The runtime
 * cart-level /v4/orders:quote in api/create-gelato-order.js is what
 * catches that warehouse-mixing case.
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}

const WRITE_MODE = process.argv.includes('--write');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env');
  process.exit(2);
}
if (!GELATO_API_KEY) {
  console.error('Missing GELATO_API_KEY env');
  process.exit(2);
}

// Mirror of TEMPLATES + COLOR_MAP + SIZE_MAP from api/create-gelato-order.js.
// Keep in sync with that file. The probe needs a valid UID for at least one
// variant per product to know whether Gelato can produce it for a country.
const TEMPLATES = {
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000'  },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'   },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500'  },
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,               sku: null     },
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: null,               sku: null     },
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'   },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075'  },
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'   },
  'capemb-unisex':     { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-emb', brand: 'flexfit',          sku: '6245cm' },
  'vneck-unisex':      { cat: 't-shirt', sub: 'v-neck',          cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,               sku: null     },
  'vneck-women':       { cat: 't-shirt', sub: 'v-neck',          cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,               sku: null     },
  'tanktop-unisex':    { cat: 't-shirt', sub: 'tank-top',        cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,               sku: null     },
  'tanktop-women':     { cat: 't-shirt', sub: 'tank-top',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,               sku: null     },
};

const SIZE_MAP = { 'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl', 'One Size': 'onesize' };

// Pick the cheapest/most-likely-in-stock variant per type for probing.
// Black is the most universal color across all our SKUs. M is mid-size,
// One Size for caps.
const PROBE_VARIANT = {
  'tshirt':     { color: 'black', size: 'm' },
  'hoodie':     { color: 'black', size: 'm' },
  'ziphoodie':  { color: 'black', size: 'm' },
  'longsleeve': { color: 'black', size: 'm' },
  'cap':        { color: 'black', size: 'onesize' },
  'capemb':     { color: 'black', size: 'onesize' },
  'vneck':      { color: 'black', size: 'm' },
  'tanktop':    { color: 'black', size: 'm' },
};

// DB clothing_type (hyphenated) → JS normType (no hyphens).
const NORM_TYPE = {
  't-shirt': 'tshirt',
  'hoodie': 'hoodie',
  'zip-hoodie': 'ziphoodie',
  'long-sleeve': 'longsleeve',
  'cap': 'cap',
  'cap-emb': 'capemb',
  'v-neck': 'vneck',
  'tank-top': 'tanktop',
};

function templateKey(type, gender) {
  return `${type}-${gender === 'women' ? 'women' : 'unisex'}`;
}

function buildProbeUid(p) {
  const normType = NORM_TYPE[p.clothing_type] || p.clothing_type;
  const variant  = PROBE_VARIANT[normType];
  if (!variant) return null;
  const key = templateKey(normType, p.gender);
  const t   = TEMPLATES[key];
  if (!t) return null;
  const brandSuffix = (t.brand && t.sku) ? `_${t.brand}_${t.sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${variant.size}_gco_${variant.color}_gpr_${t.gpr}${brandSuffix}`;
}

// Representative recipient per probe country. ONE valid postal_code + city
// per ISO-2 — chosen to be a major metro that Gelato definitely routes through.
// We're probing for SHIP-TO support, not stock at this exact ZIP, so any valid
// address in the country suffices. 2026-05-21: expanded from US/IL to 30 countries
// covering North America, EU+UK, Israel/UAE/Saudi, Australia/NZ, Japan/SG/HK, Brazil/Argentina.
const RECIPIENTS = {
  // North America
  US: { firstName: 'Test', lastName: 'Probe', addressLine1: '123 Main St',           city: 'San Francisco', state: 'CA', postalCode: '94105',   country: 'US', email: 'probe@dubis.net', phone: '+14155550100' },
  CA: { firstName: 'Test', lastName: 'Probe', addressLine1: '100 King St',           city: 'Toronto',       state: 'ON', postalCode: 'M5H 1A1', country: 'CA', email: 'probe@dubis.net', phone: '+14165550100' },
  MX: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Av Reforma 1',          city: 'Mexico City',   state: 'CMX', postalCode: '06600',  country: 'MX', email: 'probe@dubis.net', phone: '+525555550100' },
  // EU + UK
  GB: { firstName: 'Test', lastName: 'Probe', addressLine1: '10 Downing St',         city: 'London',        state: '',   postalCode: 'SW1A 2AA', country: 'GB', email: 'probe@dubis.net', phone: '+442075550100' },
  DE: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Unter den Linden 1',    city: 'Berlin',        state: '',   postalCode: '10117',  country: 'DE', email: 'probe@dubis.net', phone: '+493055550100' },
  FR: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Rue de Rivoli',       city: 'Paris',         state: '',   postalCode: '75001',  country: 'FR', email: 'probe@dubis.net', phone: '+33155550100' },
  IT: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Via del Corso 1',       city: 'Rome',          state: '',   postalCode: '00186',  country: 'IT', email: 'probe@dubis.net', phone: '+390655550100' },
  ES: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Gran Via 1',            city: 'Madrid',        state: '',   postalCode: '28013',  country: 'ES', email: 'probe@dubis.net', phone: '+34915550100' },
  NL: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Damrak 1',              city: 'Amsterdam',     state: '',   postalCode: '1012 LG', country: 'NL', email: 'probe@dubis.net', phone: '+31205550100' },
  PL: { firstName: 'Test', lastName: 'Probe', addressLine1: 'ul Marszalkowska 1',    city: 'Warsaw',        state: '',   postalCode: '00-001', country: 'PL', email: 'probe@dubis.net', phone: '+48225550100' },
  SE: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Drottninggatan 1',      city: 'Stockholm',     state: '',   postalCode: '111 51', country: 'SE', email: 'probe@dubis.net', phone: '+4685550100' },
  NO: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Karl Johans gate 1',    city: 'Oslo',          state: '',   postalCode: '0154',   country: 'NO', email: 'probe@dubis.net', phone: '+4722550100' },
  DK: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Stroget 1',             city: 'Copenhagen',    state: '',   postalCode: '1200',   country: 'DK', email: 'probe@dubis.net', phone: '+4533550100' },
  FI: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Mannerheimintie 1',     city: 'Helsinki',      state: '',   postalCode: '00100',  country: 'FI', email: 'probe@dubis.net', phone: '+358955550100' },
  BE: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Grand Place 1',         city: 'Brussels',      state: '',   postalCode: '1000',   country: 'BE', email: 'probe@dubis.net', phone: '+3225550100' },
  AT: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Stephansplatz 1',       city: 'Vienna',        state: '',   postalCode: '1010',   country: 'AT', email: 'probe@dubis.net', phone: '+43155550100' },
  CH: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Bahnhofstrasse 1',      city: 'Zurich',        state: '',   postalCode: '8001',   country: 'CH', email: 'probe@dubis.net', phone: '+41445550100' },
  PT: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Praca do Comercio 1',   city: 'Lisbon',        state: '',   postalCode: '1100-148', country: 'PT', email: 'probe@dubis.net', phone: '+351215550100' },
  GR: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Syntagma Square 1',     city: 'Athens',        state: '',   postalCode: '105 63', country: 'GR', email: 'probe@dubis.net', phone: '+302105550100' },
  CZ: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Wenceslas Sq 1',        city: 'Prague',        state: '',   postalCode: '110 00', country: 'CZ', email: 'probe@dubis.net', phone: '+420225550100' },
  // Middle East
  IL: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Rothschild 1',          city: 'Tel Aviv',      state: '',   postalCode: '6688101', country: 'IL', email: 'probe@dubis.net', phone: '+972500000000' },
  AE: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Sheikh Zayed Rd 1',     city: 'Dubai',         state: '',   postalCode: '00000',   country: 'AE', email: 'probe@dubis.net', phone: '+97145550100' },
  SA: { firstName: 'Test', lastName: 'Probe', addressLine1: 'King Fahd Rd 1',        city: 'Riyadh',        state: '',   postalCode: '11564',   country: 'SA', email: 'probe@dubis.net', phone: '+966115550100' },
  // Oceania
  AU: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Pitt St',             city: 'Sydney',        state: 'NSW', postalCode: '2000',   country: 'AU', email: 'probe@dubis.net', phone: '+61255550100' },
  NZ: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Queen St',            city: 'Auckland',      state: '',   postalCode: '1010',   country: 'NZ', email: 'probe@dubis.net', phone: '+6495550100' },
  // Asia-Pacific
  JP: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Marunouchi',          city: 'Tokyo',         state: '',   postalCode: '100-0005', country: 'JP', email: 'probe@dubis.net', phone: '+81355550100' },
  SG: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Orchard Rd',          city: 'Singapore',     state: '',   postalCode: '238824', country: 'SG', email: 'probe@dubis.net', phone: '+6555550100' },
  HK: { firstName: 'Test', lastName: 'Probe', addressLine1: '1 Queens Rd Central',   city: 'Hong Kong',     state: '',   postalCode: '999077', country: 'HK', email: 'probe@dubis.net', phone: '+85255550100' },
  // South America
  BR: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Av Paulista 1',         city: 'Sao Paulo',     state: 'SP', postalCode: '01310-100', country: 'BR', email: 'probe@dubis.net', phone: '+551155550100' },
  AR: { firstName: 'Test', lastName: 'Probe', addressLine1: 'Av 9 de Julio 1',       city: 'Buenos Aires',  state: '',   postalCode: 'C1043', country: 'AR', email: 'probe@dubis.net', phone: '+541155550100' },
};

// Reachable file URL — Gelato won't quote without one. We use the live
// front_logo_white.png which is a real print file already.
const FILE_URL = 'https://www.dubis.net/designs/front_logo_white.png';

async function quoteSolo(uid, country) {
  const body = {
    orderReferenceId: `dubis-probe-${Date.now()}-${country}-${uid.slice(-12)}`,
    currency: 'USD',
    recipient: RECIPIENTS[country],
    products: [{ itemReferenceId: 'i1', productUid: uid, quantity: 1, fileUrl: FILE_URL }],
  };
  try {
    const res = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
      method:  'POST',
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, http: res.status, reason: data?.message || `http_${res.status}` };
    if (!data) return { ok: false, reason: 'empty_response' };
    if (data.refusalReasonCode) return { ok: false, reason: `refused_${data.refusalReasonCode}` };
    const q = data.quotes && data.quotes[0];
    if (!q) return { ok: false, reason: 'no_quote' };
    // Partial OOS signals — same logic as create-gelato-order.js partial-OOS detection
    const sm = (q.shipmentMethods || []).find(s => s.shipmentMethodUid === 'api_out_of_stock_for_part_order');
    if (sm) return { ok: false, reason: 'partial_oos' };
    const oosProduct = (q.products || []).find(pr => (typeof pr.price === 'number' && pr.price === 0));
    if (oosProduct) return { ok: false, reason: 'product_price_zero' };
    return { ok: true, fulfillmentCountry: q.fulfillmentCountry || null };
  } catch (err) {
    return { ok: false, reason: `exception_${err.message}` };
  }
}

async function fetchActiveProducts() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dubis_products?active=eq.true&order=product_id_numeric.asc&select=id,product_id_numeric,slogan,clothing_type,gender,supported_countries`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase fetch ${res.status}: ${await res.text()}`);
  return res.json();
}

async function updateSupportedCountries(productUuid, countries) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dubis_products?id=eq.${productUuid}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ supported_countries: countries }),
    },
  );
  if (!res.ok) throw new Error(`PATCH ${productUuid} → ${res.status}: ${await res.text()}`);
}

(async () => {
  const products = await fetchActiveProducts();
  console.log(`Loaded ${products.length} active product(s). Probing US + IL...\n`);

  // 2026-05-21: 30 countries — covers >95% of plausible global demand.
  // Probe parallelism: all countries per product in one Promise.all (per-product
  // wall-clock = slowest single quote ≈ 1-2s). Then sequential across products
  // to stay polite to Gelato's API (~30 products × 1.5s = ~45s total).
  const COUNTRIES = Object.keys(RECIPIENTS);
  const summary = [];

  for (const p of products) {
    const uid = buildProbeUid(p);
    if (!uid) {
      console.log(`#${p.product_id_numeric} (${p.clothing_type}/${p.gender}) — SKIP, no UID mappable`);
      summary.push({ id: p.product_id_numeric, slogan: p.slogan, supported: [], reason: 'no_uid' });
      continue;
    }
    // Probe US + IL in parallel
    const results = await Promise.all(COUNTRIES.map(c => quoteSolo(uid, c).then(r => [c, r])));
    const supported = results.filter(([, r]) => r.ok).map(([c]) => c);
    const blocked   = results.filter(([, r]) => !r.ok);

    const blockedMsg = blocked.length
      ? blocked.map(([c, r]) => `${c}=${r.reason}`).join(' / ')
      : '(none)';
    console.log(`#${p.product_id_numeric} ${p.clothing_type}/${p.gender} → supports [${supported.join(',')}] · blocked: ${blockedMsg}`);

    if (WRITE_MODE) {
      try {
        await updateSupportedCountries(p.id, supported);
      } catch (err) {
        console.error(`  ↳ DB update FAILED: ${err.message}`);
      }
    }
    summary.push({ id: p.product_id_numeric, slogan: p.slogan, supported, blocked: blocked.map(([c, r]) => ({ country: c, reason: r.reason })) });
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Total products: ${products.length}`);
  console.log(`Countries probed: ${COUNTRIES.length}`);
  // Country popularity — how many products ship to each country
  const countryCount = {};
  for (const c of COUNTRIES) countryCount[c] = 0;
  for (const s of summary) for (const c of (s.supported || [])) countryCount[c]++;
  const sorted = COUNTRIES.slice().sort((a, b) => countryCount[b] - countryCount[a]);
  console.log(`\nCoverage per country (products that ship there):`);
  for (const c of sorted) console.log(`  ${c}: ${countryCount[c]} / ${products.length}`);
  // Products by coverage breadth
  const fullCoverage = summary.filter(s => (s.supported || []).length === COUNTRIES.length).length;
  const partial      = summary.filter(s => (s.supported || []).length > 0 && (s.supported || []).length < COUNTRIES.length).length;
  const none         = summary.filter(s => (s.supported || []).length === 0).length;
  console.log(`\nProduct coverage breakdown:`);
  console.log(`  All ${COUNTRIES.length} countries : ${fullCoverage}`);
  console.log(`  Partial               : ${partial}`);
  console.log(`  Zero (unavailable)    : ${none}`);
  console.log(WRITE_MODE ? '\nDB updated.\n' : '\nDry run (no DB writes). Re-run with --write to persist.\n');
})().catch(err => { console.error(err); process.exit(1); });
