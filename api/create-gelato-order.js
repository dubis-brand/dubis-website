// DUBIS — Gelato Order Creation
// Vercel Serverless Function — called after PayPal payment capture
// Gelato ships to 200+ countries including Israel (unlike Printful)
// =================================================================
// SETUP:
//   1. Sign up at gelato.com
//   2. Dashboard → Settings → API → Generate API Key
//   3. Add to Vercel env vars: GELATO_API_KEY
// =================================================================

const { refundOrder } = require('./_paypal');

const GELATO_API_BASE = 'https://order.gelatoapis.com';
const DESIGN_BASE_URL = 'https://www.dubis.net/designs';
// Cache-busting version — bump whenever designs are regenerated.
// Gelato CDN caches by full URL; same URL = same cached file. Without this
// param, re-uploading a fixed PNG has no effect — Gelato keeps serving the
// broken cached version. Set via env or hardcode to a date tag.
const DESIGN_VERSION = process.env.DESIGN_VERSION || '2026042401';

// ─────────────────────────────────────────────────────────────────
// GELATO TEMPLATES — type+cut → Gelato catalog config
// Verified 2026-05-15 against Gelato Product API v3 with the active API key.
// Each row produces UIDs of shape:
//   apparel_product_gca_{cat}_gsc_{sub}_gcu_{cut}_gqa_{qa}_gsi_{size}_gco_{color}_gpr_{gpr}[_{brand}_{sku}]
//
// History: pre-2026-05-15 UIDs were the legacy short form
//   `..._gsc_crewneck_gcu_unisex_gqa_classic_..._gpr_4-4`
// Gelato still resolves a small set of those as aliases (unisex t-shirt/hoodie/zip-hoodie).
// EVERYTHING ELSE returns 404 — including all women's-cut variants, every long-sleeve,
// and every cap — so this rewrite is required, not optional.
// ─────────────────────────────────────────────────────────────────
const TEMPLATES = {
  // DUBIS `gender: 'men'` maps to Gelato `cut: unisex` (we don't sell men's-only cuts).
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000'  },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'   },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500'  },
  // Women's hoodie has no single-brand catalog with our colors; the un-suffixed
  // legacy alias (`...gpr_4-4` with no brand) DOES carry charcoal/navy/black/white.
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  // Zip-hoodie: legacy alias only — Gelato hasn't published branded UIDs we can use.
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: null,                sku: null    },
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'   },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075'  },
  // Caps were entirely broken pre-2026-05-15. Old `gca_dad-hat_gsc_classic` no
  // longer exists; the live shape is `gca_hat_gsc_dad-hat ... _as-colour_1114` (DTF).
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'   },
};

// ─────────────────────────────────────────────────────────────────
// SIZE MAP — DUBIS size → Gelato size code
// ─────────────────────────────────────────────────────────────────
const SIZE_MAP = {
  'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl',
  'One Size': 'onesize',
};

// ─────────────────────────────────────────────────────────────────
// COLOR MAP — keyed by `${type}-${gender-bucket}` (women vs unisex).
// Entries are either a plain Gelato color string, or { color, brand, sku }
// to override the template's brand for this specific color (e.g. Forest Green
// isn't in Gildan 64000 — falls back to Next Level 3600).
//
// NEVER add colors that don't physically exist in Gelato's catalog for that
// cut. The 2026-04-22 Honey Brown catastrophe started with a lie like that.
// ─────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  'tshirt-unisex': {
    'Black':        'black',
    'White':        'white',
    'Cream':        'natural',
    'Navy':         'navy',
    'Charcoal':     'charcoal',
    'Red':          'red',
    'Gray':         'rs-sport-grey',
    // Gildan 64000 doesn't carry forest-green → use Next Level 3600 for this color only.
    'Forest Green': { color: 'forest-green', brand: 'next-level', sku: '3600' },
  },
  'tshirt-women': {
    'Black': 'black',
    'White': 'white',
    'Cream': 'soft-cream',
    'Navy':  'navy',
  },
  'hoodie-unisex': {
    'Black':        'black',
    'White':        'white',
    'Cream':        'sand',
    'Navy':         'navy',
    'Charcoal':     'dark-heather',
    'Forest Green': 'forest-green',
    'Gray':         'sport-grey',
  },
  'hoodie-women': {
    'Black':    'black',
    'White':    'white',
    'Navy':     'navy',
    'Charcoal': 'charcoal',
    // No Cream/Sand variant for womens pullover hoodie — Cream removed from product 13.
  },
  'ziphoodie-unisex': {
    'Black':    'black',
    'White':    'white',
    'Navy':     'navy',
    'Charcoal': 'dark-heather',
  },
  'longsleeve-unisex': {
    'Black':        'black',
    'White':        'white',
    'Cream':        'sand',
    'Navy':         'navy',
    'Forest Green': 'forest-green',
    'Gray':         'sports-grey',
  },
  'longsleeve-women': {
    'Black': 'deep-black',
    'White': 'white',
    'Navy':  'french-navy',
    // No Cream variant on SOLS 02075 — Cream removed from product 14.
  },
  'cap-unisex': {
    'Black': 'black',
    'White': 'white',
    'Cream': 'ecru',
    'Navy':  'navy',
    // No Charcoal variant on AS Colour 1114 dad-hat — Charcoal removed from product 7.
  },
};

// ─────────────────────────────────────────────────────────────────
// DARK COLORS — use white-ink design files on these garments
// ─────────────────────────────────────────────────────────────────
const DARK_COLORS = new Set(['Black', 'Charcoal', 'Navy', 'Forest Green']);

// ─────────────────────────────────────────────────────────────────
// Build Gelato productUid from item type, DUBIS color, DUBIS size, gender.
// Returns null if the (type, gender, color) combo isn't in the catalog.
// gender: 'men' | 'unisex' → gcu_unisex; 'women' → gcu_womens.
// ─────────────────────────────────────────────────────────────────
function templateKey(type, gender) {
  return `${type}-${gender === 'women' ? 'women' : 'unisex'}`;
}

function buildProductUid(type, dubisColor, dubisSize, gender = 'unisex') {
  const key = templateKey(type, gender);
  const t   = TEMPLATES[key];
  if (!t) return null;
  const colorEntry = (COLOR_MAP[key] || {})[dubisColor];
  if (!colorEntry) return null;
  const gColor = typeof colorEntry === 'string' ? colorEntry : colorEntry.color;
  const brand  = (typeof colorEntry === 'object' && colorEntry.brand) ? colorEntry.brand : t.brand;
  const sku    = (typeof colorEntry === 'object' && colorEntry.sku)   ? colorEntry.sku   : t.sku;
  const gSize  = SIZE_MAP[dubisSize];
  if (!gSize) return null;
  const brandSuffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${brandSuffix}`;
}

// Helper for older callers that just want the resolved Gelato color string
// (used by mockup-preview / shipping-quote routes for error reporting).
function getGelatoColor(type, gender, dubisColor) {
  const entry = (COLOR_MAP[templateKey(type, gender)] || {})[dubisColor];
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.color;
}

// ─────────────────────────────────────────────────────────────────
// Select design file URLs for an item
// dark garment → white ink design; light garment → dark ink design
// designRef: use a different product's design file (for shared phrases or placeholders)
// ─────────────────────────────────────────────────────────────────
function getDesignFiles(productId, color, designRef, productType) {
  const variant  = DARK_COLORS.has(color) ? 'white' : 'dark';
  const designId = designRef || productId;
  // Caps use different file naming: cap_design_*.png (front only, no back)
  const v = `?v=${DESIGN_VERSION}`;
  if (productType === 'cap') {
    return [
      { type: 'front', url: `${DESIGN_BASE_URL}/cap_design_${variant}.png${v}` },
    ];
  }
  return [
    { type: 'back',  url: `${DESIGN_BASE_URL}/back_design_${designId}_${variant}.png${v}` },
    { type: 'front', url: `${DESIGN_BASE_URL}/front_logo_${variant}.png${v}` },
  ];
}

// ─────────────────────────────────────────────────────────────────
// Normalize postal code — Gelato requires 7 digits, no whitespace
// Israeli post converted 5-digit → 7-digit by appending '00'
// ─────────────────────────────────────────────────────────────────
function normalizePostCode(postCode, country) {
  if (!postCode) return '';
  const clean = String(postCode).replace(/\s/g, '');
  if (country === 'IL' && /^\d{5}$/.test(clean)) return clean + '00';
  return clean;
}

// ─────────────────────────────────────────────────────────────────
// Parse first/last name from full name string
// ─────────────────────────────────────────────────────────────────
function parseName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName  = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

// ─────────────────────────────────────────────────────────────────
// DESIGN FILE VALIDATOR
// Gelato silently rejects undersized files and prints its own default
// template with no error. This guard catches the problem on our side
// before the order is ever sent.
//
// Rules (based on incident March 2026 — order 3DK112398R8006062B):
//   - File must be reachable (HTTP 200)
//   - Content-Length must be ≥ MIN_DESIGN_BYTES (200 KB)
//     A proper 3600×4200px PNG is ~300–800 KB.
//     The broken 600×200px file was only ~10 KB.
// ─────────────────────────────────────────────────────────────────
const MIN_DESIGN_BYTES = 200 * 1024; // 200 KB minimum
const MIN_DESIGN_W     = 1800;       // Gelato rejects below this
const MIN_DESIGN_H     = 1800;

// Parse a PNG's IHDR chunk to extract width/height without a decoder library.
// IHDR layout: bytes 8-15 are PNG signature tail, 16-19 = IHDR length, 20-23 = "IHDR",
// 24-27 = width (big-endian uint32), 28-31 = height.
function parsePngDimensions(buf) {
  if (!buf || buf.length < 32) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
  const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
  return { w, h };
}

async function validateDesignFile(url) {
  try {
    // Single GET with Range: bytes=0-31 — fetch only the IHDR bytes and also
    // verify the file is reachable. Some CDNs ignore Range and return full body;
    // either way we get the IHDR.
    const res = await fetch(url, { headers: { 'Range': 'bytes=0-31' } });
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: `HTTP ${res.status} for ${url}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Full length comes from content-range header on 206, or content-length on 200.
    let totalLen = 0;
    const cr = res.headers.get('content-range');
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) totalLen = parseInt(m[1], 10);
    }
    if (!totalLen) totalLen = parseInt(res.headers.get('content-length') || '0', 10);
    if (totalLen > 0 && totalLen < MIN_DESIGN_BYTES) {
      return {
        ok: false,
        reason: `Design file too small: ${url} is only ${Math.round(totalLen / 1024)}KB (min ${MIN_DESIGN_BYTES / 1024}KB). Gelato will silently reject it → JB default template.`,
      };
    }
    const dims = parsePngDimensions(buf.slice(0, 32));
    if (!dims) {
      return { ok: false, reason: `Not a valid PNG (missing IHDR): ${url}` };
    }
    if (dims.w < MIN_DESIGN_W || dims.h < MIN_DESIGN_H) {
      return {
        ok: false,
        reason: `Design dimensions too small: ${url} is ${dims.w}×${dims.h} (min ${MIN_DESIGN_W}×${MIN_DESIGN_H}). Gelato will reject → JB default.`,
      };
    }
    return { ok: true, width: dims.w, height: dims.h, bytes: totalLen };
  } catch (err) {
    return { ok: false, reason: `Cannot reach design file: ${url} — ${err.message}` };
  }
}

async function validateAllDesignFiles(items) {
  const errors = [];
  const checked = new Set(); // avoid duplicate HEAD requests for same URL
  for (const item of items) {
    for (const file of item.files) {
      if (checked.has(file.url)) continue;
      checked.add(file.url);
      const result = await validateDesignFile(file.url);
      if (!result.ok) errors.push(result.reason);
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────
// STRUCTURED LOGGER — all lines prefixed [DUBIS-GELATO] for grep
// These lines appear in Vercel runtime logs (Observability tab).
// ─────────────────────────────────────────────────────────────────
function dlog(stage, data = {}) {
  // Single-line JSON so Vercel log viewer can parse and search.
  try {
    console.log(`[DUBIS-GELATO] ${stage} ${JSON.stringify(data)}`);
  } catch (_) {
    console.log(`[DUBIS-GELATO] ${stage} <unserializable>`);
  }
}

function derr(stage, data = {}) {
  try {
    console.error(`[DUBIS-GELATO] ERROR ${stage} ${JSON.stringify(data)}`);
  } catch (_) {
    console.error(`[DUBIS-GELATO] ERROR ${stage} <unserializable>`);
  }
}

// ─────────────────────────────────────────────────────────────────
// FALLBACK LOGGER (legacy — kept for human-readable multi-line dumps)
// ─────────────────────────────────────────────────────────────────
function logManualOrder(label, payload) {
  console.log(`\n====== DUBIS MANUAL ORDER — ${label} ======`);
  console.log(JSON.stringify(payload, null, 2));
  console.log('=============================================\n');
  // Also emit a structured line so it's discoverable via grep.
  dlog('manual-order', { label, paypalOrderId: payload && payload.paypalOrderId });
}

// ─────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// MOCKUP PREVIEW — Gelato MockupStudio / Product Mockup API
// Returns pre-rendered photos of the actual garment with our print file on it.
// Replaces Gemini-generated mockups: guaranteed parity with what Gelato prints.
//
// Usage: POST /api/create-gelato-order?action=mockup-preview
// Body:  { productId: 1, color: 'Black', gender: 'unisex' }
// Returns: { mockups: { front: <url>, back: <url> } }
// ─────────────────────────────────────────────────────────────────
async function handleMockupPreview(req, res) {
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) {
    return res.status(500).json({ error: 'no_api_key' });
  }

  const { productId, color, gender = 'unisex', type, size = 'M', designRef } = req.body || {};
  if (!productId || !color || !type) {
    return res.status(400).json({ error: 'missing_fields', need: ['productId','color','type'] });
  }

  const gelatoColor = getGelatoColor(type, gender, color);
  if (!gelatoColor) {
    return res.status(400).json({ error: 'unsupported_color', color, type, gender });
  }
  const productUid = buildProductUid(type, color, size, gender);
  if (!productUid) return res.status(400).json({ error: 'unsupported_variant', type, gender, color, size });

  const variant = DARK_COLORS.has(color) ? 'white' : 'dark';
  const designId = designRef || productId;
  const v = `?v=${DESIGN_VERSION}`;
  const files = (type === 'cap')
    ? [{ type: 'front', url: `${DESIGN_BASE_URL}/cap_design_${variant}.png${v}` }]
    : [
        { type: 'front', url: `${DESIGN_BASE_URL}/front_logo_${variant}.png${v}` },
        { type: 'back',  url: `${DESIGN_BASE_URL}/back_design_${designId}_${variant}.png${v}` },
      ];

  // Try several Gelato API hosts — MockupStudio endpoints differ by plan/region.
  // We attempt each and return the first success. Pure diagnostic probe.
  // Round 2 (2026-04-23): round 1 all returned 404 "No route found" — different URLs needed.
  const attempts = [
    // Round 2 — new guesses based on Gelato API conventions
    {
      label: 'product-v3-uid-mockups',
      method: 'POST',
      url: `https://product.gelatoapis.com/v3/products/${encodeURIComponent(productUid)}/mockups`,
      body: { files },
    },
    {
      label: 'mockupstudio-v1-mockups',
      method: 'POST',
      url: 'https://mockupstudio.gelatoapis.com/v1/mockups',
      body: { productUid, files },
    },
    {
      label: 'mockupstudio-v1-uid',
      method: 'POST',
      url: `https://mockupstudio.gelatoapis.com/v1/products/${encodeURIComponent(productUid)}/mockups`,
      body: { files },
    },
    // Diagnostic: confirm Product API works at all with our key
    {
      label: 'GET-product-info',
      method: 'GET',
      url: `https://product.gelatoapis.com/v3/products/${encodeURIComponent(productUid)}`,
      body: null,
    },
    // Ecommerce API needs storeId per docs — we don't have one, but probe anyway
    {
      label: 'ecommerce-stores',
      method: 'GET',
      url: 'https://ecommerce.gelatoapis.com/v1/stores',
      body: null,
    },
    // Product catalog — sanity check
    {
      label: 'GET-catalogs',
      method: 'GET',
      url: 'https://product.gelatoapis.com/v3/catalogs',
      body: null,
    },
  ];

  const diagnostics = [];
  for (const a of attempts) {
    try {
      const opts = {
        method: a.method || 'POST',
        headers: {
          'X-API-KEY':    GELATO_API_KEY,
        },
      };
      if (a.body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(a.body);
      }
      const r = await fetch(a.url, opts);
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      diagnostics.push({
        attempt:    a.label,
        method:     opts.method,
        status:     r.status,
        ok:         r.ok,
        bodyPreview: text.substring(0, 600),
        json:       json ? Object.keys(json).slice(0, 10) : null,
      });
      if (r.ok && json) {
        return res.status(200).json({
          success:     true,
          attempt:     a.label,
          productUid,
          files,
          response:    json,
          diagnostics,
        });
      }
    } catch (e) {
      diagnostics.push({ attempt: a.label, error: e.message });
    }
  }

  return res.status(502).json({
    success:     false,
    productUid,
    files,
    diagnostics,
  });
}

// ─────────────────────────────────────────────────────────────────
// SHIPPING QUOTE — probe Gelato shipment API for real delivery ETAs
// Returns available shipping methods + production + transit days
//
// Usage: POST /api/create-gelato-order?action=shipping-quote
// Body:  { productId, color, type, size, countryIsoCode, stateCode, postCode }
// ─────────────────────────────────────────────────────────────────
async function handleShippingQuote(req, res) {
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) {
    return res.status(500).json({ error: 'no_api_key' });
  }

  const {
    productId, color, gender = 'unisex', type, size = 'M',
    countryIsoCode = 'US', stateCode = 'CA', postCode = '90210',
  } = req.body || {};
  if (!productId || !color || !type) {
    return res.status(400).json({ error: 'missing_fields', need: ['productId','color','type'] });
  }

  if (!getGelatoColor(type, gender, color)) {
    return res.status(400).json({ error: 'unsupported_color', color, type, gender });
  }
  const productUid = buildProductUid(type, color, size, gender);
  if (!productUid) return res.status(400).json({ error: 'unsupported_variant', type, gender, color, size });

  // Try common Gelato shipment endpoint patterns
  const attempts = [
    {
      label: 'shipment-v1-quotes',
      url: 'https://shipment.gelatoapis.com/v1/quotes',
      body: {
        currency: 'USD',
        recipient: { countryIsoCode, postCode, stateCode },
        products: [{ productUid, quantity: 1 }],
      },
    },
    {
      label: 'order-v4-quote',
      url: 'https://order.gelatoapis.com/v4/orders:quote',
      body: {
        orderReferenceId: 'quote-probe',
        customerReferenceId: 'quote-probe',
        currency: 'USD',
        items: [{ itemReferenceId: 'i1', productUid, quantity: 1 }],
        shippingAddress: {
          firstName: 'Q',
          lastName: 'Probe',
          addressLine1: '1 Test St',
          city: 'Los Angeles',
          postCode,
          country: countryIsoCode,
          state: stateCode,
          email: 'quote@probe.test',
        },
      },
    },
  ];

  const diagnostics = [];
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: 'POST',
        headers: {
          'X-API-KEY':    GELATO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(a.body),
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      diagnostics.push({
        attempt: a.label,
        status: r.status,
        ok: r.ok,
        bodyPreview: text.substring(0, 1500),
        json: json ? Object.keys(json).slice(0, 10) : null,
      });
      if (r.ok && json) {
        return res.status(200).json({
          success: true,
          attempt: a.label,
          productUid,
          countryIsoCode, stateCode, postCode,
          response: json,
          diagnostics,
        });
      }
    } catch (e) {
      diagnostics.push({ attempt: a.label, error: e.message });
    }
  }

  return res.status(502).json({ success: false, productUid, diagnostics });
}

// ─────────────────────────────────────────────────────────────────
// CREATE DRAFT ORDER — admin-only, creates a free Gelato draft order
// Used to verify mockups + fulfillment facility BEFORE real orders.
// No production, no billing, no revenue entry. Auto-expires in ~30 days.
//
// Usage: POST /api/create-gelato-order?action=create-draft
//   Headers: Authorization: Bearer <supabase_jwt>
//   Body:    { productId, color, size, type, gender, shipCountry }
// ─────────────────────────────────────────────────────────────────
async function handleCreateDraft(req, res) {
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) return res.status(500).json({ error: 'no_api_key' });

  // --- Admin auth via Supabase JWT ---
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — admin only' });
  }
  let userEmail = null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user }, error } = await sb.auth.getUser(authHeader.slice(7));
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    userEmail = user.email;
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
      .split(',').map(e => e.trim());
    if (!ADMIN_EMAILS.includes(userEmail)) {
      const { data: adminRow } = await sb
        .from('admin_users').select('email').eq('email', userEmail).single();
      if (!adminRow) return res.status(403).json({ error: 'Forbidden — admin only' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'auth_error', details: e.message });
  }

  const { productId, color, size = 'M', type, gender = 'unisex',
          shipCountry = 'US' } = req.body || {};
  if (!productId || !color || !type) {
    return res.status(400).json({ error: 'missing_fields', need: ['productId','color','type'] });
  }

  if (!getGelatoColor(type, gender, color)) {
    return res.status(400).json({ error: 'unsupported_color', color, type, gender });
  }
  const productUid = buildProductUid(type, color, size, gender);
  if (!productUid) return res.status(400).json({ error: 'unsupported_variant', type, gender, color, size });

  // Build print files — same logic as the real order flow
  const variant  = DARK_COLORS.has(color) ? 'white' : 'dark';
  const designId = productId;
  const v = `?v=${DESIGN_VERSION}`;
  const files = (type === 'cap')
    ? [{ type: 'front', url: `${DESIGN_BASE_URL}/cap_design_${variant}.png${v}` }]
    : [
        { type: 'front', url: `${DESIGN_BASE_URL}/front_logo_${variant}.png${v}` },
        { type: 'back',  url: `${DESIGN_BASE_URL}/back_design_${designId}_${variant}.png${v}` },
      ];

  // Shipping addresses per country (for facility routing check)
  const SHIP_ADDR = {
    US: {
      firstName: 'Draft', lastName: 'Test',
      addressLine1: '1 Test St',
      city: 'Los Angeles', postCode: '90210',
      country: 'US', state: 'CA',
      email: 'draft@dubis.net',
    },
    IL: {
      firstName: 'Draft', lastName: 'Test',
      addressLine1: 'Ramat Yohanan 1',
      city: 'Ramat Yohanan', postCode: '3003500',
      country: 'IL',
      email: 'draft@dubis.net',
    },
  };
  const shippingAddress = SHIP_ADDR[shipCountry] || SHIP_ADDR.US;

  // Draft order payload (orderType: 'draft' — Gelato creates mockup, no production)
  const draftRef = `draft-${Date.now()}-${productId}-${color}-${size}`.replace(/[^a-zA-Z0-9-]/g,'-');
  const payload = {
    orderType: 'draft',
    orderReferenceId: draftRef,
    customerReferenceId: `admin-${userEmail}`,
    currency: 'USD',
    items: [{
      itemReferenceId: 'i1',
      productUid,
      quantity: 1,
      files,
    }],
    shippingAddress,
  };

  dlog('create-draft', { userEmail, productUid, shipCountry, draftRef });

  try {
    const r = await fetch('https://order.gelatoapis.com/v4/orders', {
      method: 'POST',
      headers: {
        'X-API-KEY':    GELATO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!r.ok) {
      derr('create-draft-failed', { status: r.status, body: text.substring(0, 500) });
      return res.status(502).json({
        success: false,
        status: r.status,
        error: json?.message || 'Gelato error',
        details: json || text.substring(0, 500),
        sent_payload: payload,
      });
    }

    // Extract useful fields from Gelato response
    const summary = {
      gelatoOrderId:       json.id || json.orderId || null,
      gelatoOrderReferenceId: json.orderReferenceId || draftRef,
      orderType:           json.orderType || 'draft',
      fulfillmentCountry:  json.fulfillmentCountry || json.items?.[0]?.fulfillmentCountry || 'unknown',
      fulfillmentFacility: json.productionFacility || json.items?.[0]?.productionFacility || 'unknown',
      totalAmount:         json.amount || json.totalAmount || null,
      shippingMethod:      json.shipmentMethodName || json.shipment?.shipmentMethodName || null,
      estimatedDelivery:   json.estimatedDeliveryDate || json.shipment?.estimatedDeliveryDate || null,
      mockupUrl:           json.items?.[0]?.mockupUrl || json.items?.[0]?.previews?.[0]?.url || null,
      dashboardUrl:        json.id ? `https://dashboard.gelato.com/orders/view/${json.id}` : null,
    };

    return res.status(200).json({
      success: true,
      summary,
      productUid,
      shipCountry,
      filesUsed: files,
      fullResponse: json,
    });
  } catch (e) {
    derr('create-draft-exception', { message: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  dlog('request-received', {
    method: req.method,
    hasBody: !!req.body,
    userAgent: (req.headers && req.headers['user-agent']) || '',
    designVersion: DESIGN_VERSION,
    query: req.query,
  });

  // Route: mockup preview (probing Gelato MockupStudio)
  if (req.method === 'POST' && req.query && req.query.action === 'mockup-preview') {
    return handleMockupPreview(req, res);
  }

  // Route: shipping quote
  if (req.method === 'POST' && req.query && req.query.action === 'shipping-quote') {
    return handleShippingQuote(req, res);
  }

  // Route: create draft order (admin only)
  if (req.method === 'POST' && req.query && req.query.action === 'create-draft') {
    return handleCreateDraft(req, res);
  }

  if (req.method !== 'POST') {
    derr('method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cartItems, shippingAddress, paypalOrderId, buyerEmail } = req.body || {};

  if (!cartItems || !shippingAddress || !paypalOrderId) {
    derr('missing-required-fields', {
      hasCartItems: !!cartItems,
      hasShippingAddress: !!shippingAddress,
      hasPaypalOrderId: !!paypalOrderId,
    });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  dlog('order-input', {
    paypalOrderId,
    buyerEmailDomain: (buyerEmail || '').split('@')[1] || '',
    itemsCount: cartItems.length,
    shippingCountry: shippingAddress.country_code,
    shippingState: shippingAddress.admin_area_1 || '',
    itemsPreview: cartItems.map(i => ({
      id: i.id,
      type: i.type,
      color: i.selectedColor,
      size: i.selectedSize,
      gender: i.gender,
      designRef: i.designRef || null,
    })),
  });

  // ── Case 1: Gelato not configured yet ──
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  dlog('env-check', {
    hasGelatoKey: !!GELATO_API_KEY,
    keyLen: GELATO_API_KEY ? GELATO_API_KEY.length : 0,
    keySource: process.env.GELATO_API_KEY ? 'GELATO_API_KEY' :
               process.env.GELATO         ? 'GELATO' :
               process.env.Gelato         ? 'Gelato' : 'none',
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    node: process.version,
  });
  if (!GELATO_API_KEY) {
    derr('no-api-key', { paypalOrderId });
    logManualOrder('NO API KEY', { paypalOrderId, buyerEmail, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'gelato_not_configured' });
  }

  // ── Case 2: Validate all items can be mapped ──
  const unmapped = cartItems.filter(item => {
    return !buildProductUid(item.type, item.selectedColor, item.selectedSize, item.gender);
  });

  if (unmapped.length > 0) {
    derr('items-unmapped', {
      paypalOrderId,
      unmappedCount: unmapped.length,
      unmapped: unmapped.map(u => ({ type: u.type, color: u.selectedColor, size: u.selectedSize, gender: u.gender })),
    });
    logManualOrder('UNMAPPED ITEMS', { paypalOrderId, buyerEmail, unmapped, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'items_not_mapped', unmapped });
  }

  // ── Case 3: Full Gelato order ──
  const { firstName, lastName } = parseName(shippingAddress.name);

  // ── Pre-flight: validate design files before sending to Gelato ──
  // Gelato silently rejects undersized files and prints a default template.
  // We catch this here so we never ship an order with the wrong design.
  const preflightItems = cartItems.map((item, i) => ({
    itemReferenceId: `item-${i + 1}`,
    files: getDesignFiles(item.id, item.selectedColor, item.designRef, item.type),
  }));
  dlog('design-preflight-start', {
    paypalOrderId,
    uniqueUrls: [...new Set(preflightItems.flatMap(pi => pi.files.map(f => f.url)))],
  });
  const fileErrors = await validateAllDesignFiles(preflightItems);
  dlog('design-preflight-done', {
    paypalOrderId,
    errorCount: fileErrors.length,
    errors: fileErrors,
    durationMs: Date.now() - t0,
  });
  if (fileErrors.length > 0) {
    const errorMsg = 'DESIGN FILE VALIDATION FAILED — order blocked:\n' + fileErrors.join('\n');
    console.error(errorMsg);
    derr('design-validation-failed', { paypalOrderId, fileErrors });
    logManualOrder('DESIGN FILE VALIDATION FAILED', { paypalOrderId, buyerEmail, fileErrors, cartItems });
    // Return error so admin is notified — do NOT silently continue
    return res.status(500).json({
      success: false,
      error: 'design_file_invalid',
      details: fileErrors,
      message: 'Design files failed pre-flight validation. Order was not sent to Gelato. Please fix the design files and retry.',
    });
  }

  const gelatoOrder = {
    orderReferenceId:    `DUBIS-${paypalOrderId}`,
    customerReferenceId: paypalOrderId,
    currency:            'USD',
    items: cartItems.map((item, i) => ({
      itemReferenceId: `item-${i + 1}`,
      productUid:      buildProductUid(item.type, item.selectedColor, item.selectedSize, item.gender),
      files:           getDesignFiles(item.id, item.selectedColor, item.designRef, item.type),
      quantity:        1,
    })),
    shipmentMethodUid: 'express',
    shippingAddress: {
      firstName:    firstName,
      lastName:     lastName,
      email:        buyerEmail || '',
      addressLine1: shippingAddress.address_line_1,
      addressLine2: shippingAddress.address_line_2 || '',
      city:         shippingAddress.admin_area_2,
      state:        shippingAddress.admin_area_1 || '',
      country:      shippingAddress.country_code,
      postCode:     normalizePostCode(shippingAddress.postal_code, shippingAddress.country_code),
    },
  };

  dlog('gelato-request-start', {
    paypalOrderId,
    endpoint: `${GELATO_API_BASE}/v4/orders`,
    orderReferenceId: gelatoOrder.orderReferenceId,
    itemsCount: gelatoOrder.items.length,
    productUids: gelatoOrder.items.map(i => i.productUid),
    shippingCountry: gelatoOrder.shippingAddress.country,
    shippingState: gelatoOrder.shippingAddress.state,
    shippingPostCode: gelatoOrder.shippingAddress.postCode,
    currency: gelatoOrder.currency,
    shipmentMethodUid: gelatoOrder.shipmentMethodUid,
  });

  const gelatoT0 = Date.now();
  try {
    const gRes = await fetch(`${GELATO_API_BASE}/v4/orders`, {
      method:  'POST',
      headers: {
        'X-API-KEY':    GELATO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gelatoOrder),
    });

    const data = await gRes.json();
    const gelatoDuration = Date.now() - gelatoT0;

    dlog('gelato-response', {
      paypalOrderId,
      httpStatus: gRes.status,
      ok: gRes.ok,
      gelatoDurationMs: gelatoDuration,
      responseId: data && (data.id || data.orderId || data.orderReferenceId) || null,
      responseKeys: data ? Object.keys(data).slice(0, 20) : [],
    });

    if (!gRes.ok) {
      derr('gelato-api-error', {
        paypalOrderId,
        httpStatus: gRes.status,
        errorData: data,
        productUids: gelatoOrder.items.map(i => i.productUid),
      });
      logManualOrder('GELATO API ERROR', { paypalOrderId, error: data, gelatoOrder });

      // ── AUTO-REFUND — Gelato won't fulfill, customer's money must go back ──
      // Triggers on: out-of-stock (400/422), invalid product, any 4xx/5xx
      // Lesson from incident 2026-04-22: manual-only left hila's $20.89 stuck.
      const errMsg = (data && (data.message || data.error || JSON.stringify(data))) || '';
      dlog('auto-refund-start', { paypalOrderId, gelatoHttpStatus: gRes.status, reason: errMsg.slice(0, 120) });
      const refundResult = await refundOrder({
        paypalOrderId,
        reason: `gelato_${gRes.status}_${(errMsg.match(/out of stock/i) ? 'out_of_stock' : 'api_error')}`,
      });
      dlog('auto-refund-done', { paypalOrderId, refunded: refundResult.refunded, refundId: refundResult.refundId || null, refundReason: refundResult.reason || null });

      return res.status(200).json({
        success: true,
        manual:  !refundResult.refunded,
        refunded: !!refundResult.refunded,
        refundId: refundResult.refundId || null,
        reason:   refundResult.refunded ? 'gelato_rejected_refunded' : 'gelato_api_error',
        gelatoError: errMsg.slice(0, 200),
      });
    }

    const gelatoOrderId = data.id || data.orderId || data.orderReferenceId;
    console.log(`Gelato order created: ${gelatoOrderId} for PayPal ${paypalOrderId}`);
    dlog('gelato-success', {
      paypalOrderId,
      gelatoOrderId,
      totalDurationMs: Date.now() - t0,
    });
    return res.status(200).json({
      success:        true,
      manual:         false,
      gelatoOrderId:  gelatoOrderId,
      printfulOrderId: gelatoOrderId, // alias for save.js compatibility
    });

  } catch (err) {
    derr('gelato-network-error', {
      paypalOrderId,
      errorMessage: err.message,
      errorStack: (err.stack || '').split('\n').slice(0, 3).join(' | '),
      gelatoDurationMs: Date.now() - gelatoT0,
    });
    logManualOrder('NETWORK ERROR', { paypalOrderId, error: err.message, gelatoOrder });
    return res.status(200).json({ success: true, manual: true, reason: 'network_error' });
  }
};
