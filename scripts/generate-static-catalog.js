#!/usr/bin/env node
/**
 * generate-static-catalog.js — Wave 2 of the 2026-06-12 site-modernization plan.
 *
 * Makes the catalog visible to crawlers (Google) and AI bots (GPTBot/ClaudeBot),
 * which do NOT execute JS and previously saw 0 of the active products.
 *
 * Regenerates, idempotently, from js/products.js (which the sync pipeline
 * regenerates from the DB right before this script runs):
 *   1. Static product grid inside #products-grid in index.html
 *      (between STATIC-CATALOG markers; renderProducts() replaces it on JS load)
 *   2. Product ItemList JSON-LD in <head> (between STATIC-SCHEMA markers)
 *   3. llms.txt (full regeneration from template + live catalog)
 *   4. sitemap.xml <lastmod> refresh
 *
 * Usage:
 *   node scripts/generate-static-catalog.js              # generate
 *   node scripts/generate-static-catalog.js --verify-db  # also compare against live DB
 *                                                        # (freshness contract — exits 1 on drift)
 *
 * Env (only for --verify-db): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const PRODUCTS_JS = path.join(ROOT, 'js', 'products.js');
const LLMS = path.join(ROOT, 'llms.txt');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

const SITE = 'https://www.dubis.net';

// ── Load the catalog from js/products.js (the synced artifact) ──
function loadProducts() {
  const src = fs.readFileSync(PRODUCTS_JS, 'utf8');
  const code = src.slice(0, src.lastIndexOf('];') + 2) + ';globalThis.__dubisProducts = products;';
  // products.js defines consts + the products array; evaluate in this process.
  eval(code);
  const products = globalThis.__dubisProducts;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products parsed from js/products.js');
  }
  return products;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPE_LABEL = {
  tshirt: 'T-Shirt', hoodie: 'Hoodie', ziphoodie: 'Zip Hoodie',
  longsleeve: 'Long Sleeve', cap: 'Cap', capemb: 'Cap',
  vneck: 'V-Neck', tanktop: 'Tank Top',
  mug: 'Mug', bottle: 'Water Bottle', tote: 'Tote Bag',
};

function mockupUrl(p) {
  const colors = Array.isArray(p.colors) ? p.colors : [];
  const c = colors.includes('Black') ? 'Black' : (colors[0] || 'Black');
  return `images/product-${p.id}-${encodeURIComponent(c)}-front.jpg`;
}

// The garment-mockup path is CONSTRUCTED — accessories (mug/bottle/tote) have no
// images/product-{id}-{Color}-front.jpg on disk, so blindly emitting it put 404s in the
// JSON-LD (2026-08-27 audit). Verify on disk; dead → the product's own image field
// (synced from dubis_products.image_url). Returns an ABSOLUTE url for JSON-LD.
function productImageUrl(p) {
  const rel = mockupUrl(p);
  if (fs.existsSync(path.join(ROOT, rel))) return `${SITE}/${rel}`;
  if (p.image) return /^https?:/i.test(p.image) ? p.image : `${SITE}/${String(p.image).replace(/^\//, '')}`;
  return `${SITE}/${rel}`;
}

// 2026-07-25 (HOODIES-style shelf): the static card leads with the real-body
// persona photo where one exists on disk — crawlers index the on-model look.
// JSON-LD keeps the flat mockup (product image, not lifestyle — Merchant rules).
function staticCardImgUrl(p) {
  const persona = `images/personas-real/persona-${p.id}.jpg`;
  if (fs.existsSync(path.join(ROOT, persona))) return persona;
  const rel = mockupUrl(p);
  if (fs.existsSync(path.join(ROOT, rel))) return rel; // keep same-origin relative path
  return productImageUrl(p); // accessory fallback (absolute, from the synced image field)
}

// ── 1. Static grid cards (crawler content + no-JS fallback; JS hydrates over) ──
function buildGrid(products) {
  return products.map((p) => {
    const label = TYPE_LABEL[p.type] || 'Apparel';
    return [
      `<a class="product-card product-card-static" href="/?p=${p.id}">`,
      `<img src="${staticCardImgUrl(p)}" alt="${esc(p.phrase)} — DUBIS ${esc(label).toLowerCase()}" loading="lazy" width="600" height="600">`,
      `<div class="product-info">`,
      `<div class="product-phrase">"${esc(p.phrase)}"</div>`,
      `<div class="product-meta-static">${esc(label)} · $${p.price}</div>`,
      `</div></a>`,
    ].join('');
  }).join('\n');
}

// ── 2. Product ItemList JSON-LD ──
function buildSchema(products) {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'DUBIS catalog',
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.phrase,
        image: productImageUrl(p),
        description: p.description || `${p.phrase}. ${TYPE_LABEL[p.type] || 'Apparel'} from DUBIS — built for the body you actually live in.`,
        url: `${SITE}/?p=${p.id}`,
        brand: { '@type': 'Brand', name: 'DUBIS' },
        offers: {
          '@type': 'Offer',
          price: String(p.price),
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `${SITE}/?p=${p.id}`,
        },
      },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(itemList, null, 2)}\n<\/script>`;
}

function replaceBetween(content, startMarker, endMarker, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) throw new Error(`Markers not found: ${startMarker}`);
  return content.slice(0, start + startMarker.length) + '\n' + replacement + '\n    ' + content.slice(end);
}

// ── 3. llms.txt ──
function buildLlms(products) {
  const lines = products.map((p) => {
    const label = (TYPE_LABEL[p.type] || 'apparel').toLowerCase();
    return `- ${p.phrase} — ${label}, ${p.gender || 'unisex'}, $${p.price} — ${SITE}/?p=${p.id}`;
  }).join('\n');
  return `# DUBIS

> DUBIS is a direct-to-consumer apparel brand for real bodies — men and women 35–55 who are done with fashion that talks to 22-year-olds with flat stomachs. Tagline: "Built for the body you actually live in." Humor-slogan t-shirts, hoodies, zip hoodies and long sleeves, printed fresh to order (DTG), shipping to the US, Israel and 25+ more countries. Site is bilingual English/Hebrew.

## Brand facts

- Founded by a solo founder after a clothing-store moment of realizing nothing on the racks was made for the body he actually lives in; today the business is run day-to-day by a team of AI agents with the founder as the human in the loop.
- Every garment carries the small DUBIS™ chest logo on the front and a humor slogan on the back.
- Sizes S–3XL. All cuts run comfortable and roomy — between sizes, take the smaller one.
- Made to order: US production 2–3 business days, US delivery 3–4 business days (5–7 total). Rest of world up to 14 business days. Shipping $8.99, free over $60.
- Returns: defective, wrong, or lost items — email within 30 days of delivery with a photo and order number. Full policy: ${SITE}/returns
- Print: DTG (direct-to-garment) — survives dozens of washes. Wash at 30°C inside out, no tumble dry.

## Catalog (live products, prices in USD — regenerated automatically from the store database)

${lines}

## Links

- Shop: ${SITE}
- Returns policy: ${SITE}/returns
- Terms: ${SITE}/terms
- Instagram: https://www.instagram.com/dubis.brand
- Facebook: https://www.facebook.com/people/DUBIS/61577669910761/
- TikTok: https://www.tiktok.com/@dubis.brand
- Contact: dubis.brand@gmail.com
`;
}

// ── 4. Freshness contract: compare generated catalog against the live DB ──
async function verifyAgainstDb(products) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('--verify-db requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${url}/rest/v1/dubis_products?active=eq.true&select=product_id_numeric,slogan,price_usd`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`DB fetch failed: ${res.status}`);
  const db = await res.json();
  const dbById = new Map(db.map((r) => [Number(r.product_id_numeric), r]));
  const errors = [];
  if (db.length !== products.length) {
    errors.push(`product count drift: DB has ${db.length} active, static has ${products.length}`);
  }
  // Sample-check every product's price (cheap at this catalog size — full check, not 3)
  for (const p of products) {
    const row = dbById.get(Number(p.id));
    if (!row) { errors.push(`product #${p.id} in static but not active in DB`); continue; }
    if (Number(row.price_usd) !== Number(p.price)) {
      errors.push(`price drift on #${p.id}: DB $${row.price_usd} vs static $${p.price}`);
    }
  }
  if (errors.length) {
    console.error('FRESHNESS CONTRACT VIOLATED:\n - ' + errors.join('\n - '));
    process.exit(1);
  }
  console.log(`verify-db OK: ${products.length} products match the live DB (count + prices).`);
}

(async () => {
  const products = loadProducts();

  let html = fs.readFileSync(INDEX, 'utf8');
  html = replaceBetween(html, '<!-- STATIC-CATALOG:START -->', '<!-- STATIC-CATALOG:END -->', buildGrid(products));
  html = replaceBetween(html, '<!-- STATIC-SCHEMA:START -->', '<!-- STATIC-SCHEMA:END -->', buildSchema(products));
  fs.writeFileSync(INDEX, html);

  fs.writeFileSync(LLMS, buildLlms(products));

  if (fs.existsSync(SITEMAP)) {
    const today = new Date().toISOString().slice(0, 10);
    const sm = fs.readFileSync(SITEMAP, 'utf8').replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
    fs.writeFileSync(SITEMAP, sm);
  }

  console.log(`generated: static grid + Product schema (${products.length} products), llms.txt, sitemap lastmod.`);

  if (process.argv.includes('--verify-db')) await verifyAgainstDb(products);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
