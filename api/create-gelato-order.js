// DUBIS — Gelato Order Creation
// Vercel Serverless Function — called after PayPal payment capture
// Gelato ships to 200+ countries including Israel (unlike Printful)
// =================================================================
// SETUP:
//   1. Sign up at gelato.com
//   2. Dashboard → Settings → API → Generate API Key
//   3. Add to Vercel env vars: GELATO_API_KEY
// =================================================================

const GELATO_API_BASE = 'https://order.gelatoapis.com';
const DESIGN_BASE_URL = 'https://www.dubis.net/designs';
// Cache-busting version — bump whenever designs are regenerated.
// Gelato CDN caches by full URL; same URL = same cached file. Without this
// param, re-uploading a fixed PNG has no effect — Gelato keeps serving the
// broken cached version. Set via env or hardcode to a date tag.
const DESIGN_VERSION = process.env.DESIGN_VERSION || '2026042101';

// ─────────────────────────────────────────────────────────────────
// COLOR MAP — DUBIS display name → Gelato color code
// Verified against Gelato catalog API (March 2026)
// T-shirt: black, white, natural, charcoal, navy, sports-grey, sand, red, forest
// Hoodie:  black, navy, white, dark-heather, sand
// ─────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  tshirt: {
    'Black':        'black',
    'White':        'white',
    'Cream':        'natural',
    'Honey Brown':  'sand',
    'Charcoal':     'charcoal',
    'Navy':         'navy',
    'Gray':         'sports-grey',
    'Red':          'red',
    'Forest Green': 'forest',
  },
  hoodie: {
    'Black':        'black',
    'White':        'white',
    'Cream':        'sand',
    'Honey Brown':  'sand',
    'Charcoal':     'dark-heather',
    'Navy':         'navy',
    'Gray':         'sports-grey',
    'Forest Green': 'forest',
  },
  ziphoodie: {
    'Black':        'black',
    'White':        'white',
    'Charcoal':     'dark-heather',
    'Navy':         'navy',
    'Honey Brown':  'sand',
  },
  longsleeve: {
    'Black':        'black',
    'White':        'white',
    'Cream':        'natural',
    'Navy':         'navy',
    'Forest Green': 'forest',
    'Gray':         'sports-grey',
  },
  cap: {
    'Black':        'black',
    'White':        'white',
    'Cream':        'natural',
    'Honey Brown':  'sand',
    'Charcoal':     'dark-heather',
    'Navy':         'navy',
    'Gray':         'sports-grey',
  },
};

// ─────────────────────────────────────────────────────────────────
// SIZE MAP — DUBIS size → Gelato size code
// ─────────────────────────────────────────────────────────────────
const SIZE_MAP = {
  'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl',
  'One Size': 'os',
};

// ─────────────────────────────────────────────────────────────────
// DARK COLORS — use white design files on these garments
// ─────────────────────────────────────────────────────────────────
const DARK_COLORS = new Set(['Black', 'Charcoal', 'Navy', 'Forest Green']);

// ─────────────────────────────────────────────────────────────────
// Build Gelato productUid from item type, color, size, gender
// gender: 'men'|'unisex' → gcu_unisex, 'women' → gcu_women
// ─────────────────────────────────────────────────────────────────
function buildProductUid(type, gelatoColor, gelatoSize, gender = 'unisex') {
  const genderCode = gender === 'women' ? 'women' : 'unisex';
  if (type === 'tshirt') {
    return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'hoodie') {
    return `apparel_product_gca_hoodie_gsc_pullover_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'ziphoodie') {
    return `apparel_product_gca_hoodie_gsc_zip_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'longsleeve') {
    return `apparel_product_gca_long-sleeve_gsc_crewneck_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'cap') {
    return `apparel_product_gca_dad-hat_gsc_classic_gcu_unisex_gqa_classic_gsi_os_gco_${gelatoColor}_gpr_4-0`;
  }
  return null;
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
module.exports = async function handler(req, res) {
  const t0 = Date.now();
  dlog('request-received', {
    method: req.method,
    hasBody: !!req.body,
    userAgent: (req.headers && req.headers['user-agent']) || '',
    designVersion: DESIGN_VERSION,
  });

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
    const colorMap    = COLOR_MAP[item.type] || COLOR_MAP.tshirt;
    const gelatoColor = colorMap[item.selectedColor];
    const gelatoSize  = SIZE_MAP[item.selectedSize];
    const productUid  = gelatoColor && gelatoSize
      ? buildProductUid(item.type, gelatoColor, gelatoSize, item.gender)
      : null;
    return !productUid;
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
    items: cartItems.map((item, i) => {
      const colorMap    = COLOR_MAP[item.type] || COLOR_MAP.tshirt;
      const gelatoColor = colorMap[item.selectedColor];
      const gelatoSize  = SIZE_MAP[item.selectedSize];
      return {
        itemReferenceId: `item-${i + 1}`,
        productUid:      buildProductUid(item.type, gelatoColor, gelatoSize, item.gender),
        files:           getDesignFiles(item.id, item.selectedColor, item.designRef, item.type),
        quantity:        1,
      };
    }),
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
      // Payment already captured — return success to customer, handle manually
      return res.status(200).json({ success: true, manual: true, reason: 'gelato_api_error' });
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
