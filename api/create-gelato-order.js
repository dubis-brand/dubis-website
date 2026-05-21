// DUBIS — Gelato Order Creation
// Vercel Serverless Function — called after PayPal payment capture
// Gelato ships to 200+ countries including Israel (unlike Printful)
// =================================================================
// SETUP:
//   1. Sign up at gelato.com
//   2. Dashboard → Settings → API → Generate API Key
//   3. Add to Vercel env vars: GELATO_API_KEY
// =================================================================

const crypto = require('crypto');
const { refundOrder } = require('./_paypal');
const { splitCartByWarehouse } = require('./_orderSplit');

const GELATO_API_BASE = 'https://order.gelatoapis.com';
const DESIGN_BASE_URL = 'https://www.dubis.net/designs';
// Cache-busting version — bump whenever designs are regenerated.
// Gelato CDN caches by full URL; same URL = same cached file. Without this
// param, re-uploading a fixed PNG has no effect — Gelato keeps serving the
// broken cached version. Set via env or hardcode to a date tag.
const DESIGN_VERSION = process.env.DESIGN_VERSION || '2026051501';

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
  // 2026-05-16: Embroidered cap (DUBIS™ stitched, not printed). Premium tier
  // alongside the AS Colour DTF cap. Same dad-hat silhouette, different print
  // method. Use clothing_type='cap-emb' in dubis_products to route here.
  // normType strips hyphens so the key becomes 'capemb-unisex'.
  'capemb-unisex':     { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-emb', brand: 'flexfit',          sku: '6245cm' },
  // 2026-05-19: V-neck + Tank-top — brand-less Gelato aliases (premium quality,
  // 4-4 = front+back print). Verified via /v3/products/{uid} (200) AND
  // /v3/products/{uid}/prices (200) with real cost data. Same brand-less-alias
  // pattern as longsleeve-unisex and hoodie-women — Gelato resolves these to a
  // canonical default brand internally. Use clothing_type='v-neck' / 'tank-top'
  // in dubis_products (normType strips hyphens → 'vneck' / 'tanktop' keys).
  'vneck-unisex':      { cat: 't-shirt', sub: 'v-neck',          cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'vneck-women':       { cat: 't-shirt', sub: 'v-neck',          cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'tanktop-unisex':    { cat: 't-shirt', sub: 'tank-top',        cut: 'unisex', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'tanktop-women':     { cat: 't-shirt', sub: 'tank-top',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
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
  // 2026-05-16: Embroidered Flexfit 6245cm dad-hat. 5 site-friendly colors that
  // map to real Flexfit catalog entries (verified live against
  // /v3/products/apparel_product_gca_hat_..._flexfit_6245cm).
  'capemb-unisex': {
    'Black':     'black',
    'White':     'white',
    'Navy':      'navy',
    'Cream':     'stone',       // closest natural-cotton tone
    'Charcoal':  'dark-grey',   // closest charcoal tone (Flexfit hex #2E2E2E)
  },
  // 2026-05-19: V-neck unisex (prm/4-4 brand-less). Verified colors against
  // /v3/products/...gco_{color}: black/white/navy/red return 200.
  // charcoal/cream/forest-green return 404 — do NOT add them.
  'vneck-unisex': {
    'Black': 'black',
    'White': 'white',
    'Navy':  'navy',
    'Red':   'red',
  },
  // V-neck womens: verified colors black/white/navy only.
  'vneck-women': {
    'Black': 'black',
    'White': 'white',
    'Navy':  'navy',
  },
  // Tank-top unisex: verified black/white/navy/red.
  'tanktop-unisex': {
    'Black': 'black',
    'White': 'white',
    'Navy':  'navy',
    'Red':   'red',
  },
  // Tank-top womens: ONLY black in Gelato catalog as of 2026-05-19.
  'tanktop-women': {
    'Black': 'black',
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
  // Caps use different file naming: cap_design_*.png (front only, no back).
  // 'cap' = AS Colour 1114 DTF. 'capemb' = Flexfit 6245cm embroidery (product 20).
  // Both reuse the same single-color text design — embroidery engines accept
  // the same flat PNG and Gelato converts to thread.
  const v = `?v=${DESIGN_VERSION}`;
  if (productType === 'cap' || productType === 'capemb') {
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
// SHIPPING ADDRESS VALIDATION
// Added after the May 2026 DHL-undeliverable incident: PayPal flows
// were occasionally yielding orders with blank / "?" / "undefined"
// address fields. Gelato accepted them, label printed with garbage,
// DHL bounced the package. Validate BEFORE the Gelato call.
//
// Applies to both manually-entered (window.checkoutAddress) and
// PayPal-profile shipping_address values — they reach this function
// in the same shape because paypal.js normalizes them in onApprove.
// ─────────────────────────────────────────────────────────────────
const INVALID_PLACEHOLDERS = new Set([
  '', '-', '--', '?', '??', '???', '????', '.', '..', '...',
  'undefined', 'null', 'none', 'n/a', 'na', 'tbd', 'xxx', 'xx',
]);

function isFieldPresent(value, opts = {}) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (INVALID_PLACEHOLDERS.has(s.toLowerCase())) return false;
  // Reject strings made up entirely of punctuation/whitespace
  if (!/[a-zA-Z0-9֐-׿؀-ۿ一-鿿]/.test(s)) return false;
  const minLen = opts.minLen || 2;
  if (s.length < minLen) return false;
  return true;
}

function isPhonePresent(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (INVALID_PLACEHOLDERS.has(s.toLowerCase())) return false;
  // At least 5 digits anywhere in the string (DHL wants a contact number)
  const digits = s.replace(/\D+/g, '');
  return digits.length >= 5;
}

function isCountryCodePresent(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s);
}

// Hebrew character range U+0590..U+05FF. Israeli customers sometimes
// fill the address form in Hebrew — Gelato's print partner / DHL labels
// can't read Hebrew script, so the package ships and bounces. Reject
// at the gate and ask the customer to re-enter in English.
// We DO NOT flag Hebrew in `name` — recipient name in Hebrew is fine
// on the label as long as the address is Latin-script.
const HEBREW_RE = /[֐-׿]/;
function containsHebrew(value) {
  if (value === null || value === undefined) return false;
  return HEBREW_RE.test(String(value));
}

function validateShippingAddress(shippingAddress = {}, buyerEmail = '') {
  const missing = [];
  const hebrewFields = [];
  if (!isFieldPresent(shippingAddress.name, { minLen: 2 })) missing.push('name');

  if (!isFieldPresent(shippingAddress.address_line_1, { minLen: 3 })) missing.push('address_line_1');
  else if (containsHebrew(shippingAddress.address_line_1)) hebrewFields.push('address_line_1');

  if (!isFieldPresent(shippingAddress.admin_area_2, { minLen: 2 })) missing.push('city');
  else if (containsHebrew(shippingAddress.admin_area_2)) hebrewFields.push('city');

  // Optional fields: only flag if PRESENT and Hebrew (don't add to missing).
  if (shippingAddress.address_line_2 && containsHebrew(shippingAddress.address_line_2)) hebrewFields.push('address_line_2');
  if (shippingAddress.admin_area_1   && containsHebrew(shippingAddress.admin_area_1))   hebrewFields.push('state');

  if (!isFieldPresent(shippingAddress.postal_code, { minLen: 3 })) missing.push('postal_code');
  if (!isCountryCodePresent(shippingAddress.country_code)) missing.push('country');
  if (!isPhonePresent(shippingAddress.phone)) missing.push('phone');
  // Email is required to actually reach the customer about the gap.
  if (!isFieldPresent(buyerEmail, { minLen: 5 }) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(buyerEmail).trim())) {
    missing.push('email');
  }
  return { valid: missing.length === 0 && hebrewFields.length === 0, missing, hebrewFields };
}

// Confirmation token = HMAC(paypal_order_id) using a secret already
// in the env (CRON_SECRET). Unguessable, deterministic — we don't
// have to store it; the resubmit route just re-derives and compares.
function signOrderToken(paypalOrderId) {
  const secret = process.env.CRON_SECRET || process.env.AGENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dubis-fallback';
  return crypto.createHmac('sha256', secret).update(String(paypalOrderId)).digest('hex').slice(0, 24);
}

function verifyOrderToken(paypalOrderId, token) {
  if (!paypalOrderId || !token) return false;
  const expected = signOrderToken(paypalOrderId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token)));
  } catch (_) {
    return false;
  }
}

// HTML-escape helper shared by both email templates below.
function _addrEscHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ADDR_FIELD_LABELS = {
  name:           'Full name',
  address_line_1: 'Street address',
  address_line_2: 'Apartment / suite',
  city:           'City',
  state:          'State / Province',
  postal_code:    'ZIP / postal code',
  country:        'Country',
  phone:          'Phone number',
  email:          'Email',
};

// ─────────────────────────────────────────────────────────────────
// Customer email — "your order is paid, we need your address"
// Sent via Resend (same provider as confirm-order.js).
// Handles two scenarios:
//   - missingFields:  required fields blank/garbage   → "what's missing"
//   - hebrewFields:   address typed in Hebrew script  → "please use English"
// Both can coexist (e.g. blank postal_code + Hebrew city).
// ─────────────────────────────────────────────────────────────────
async function sendAddressConfirmationEmail({ buyerEmail, buyerName, paypalOrderId, missingFields, hebrewFields, confirmUrl }) {
  if (!process.env.RESEND_API_KEY) {
    dlog('address-email-skipped', { reason: 'no_resend_key', paypalOrderId });
    return { ok: false, reason: 'no_resend_key' };
  }
  const esc = _addrEscHtml;
  const firstName = (buyerName || buyerEmail || '').split(/[\s@]/)[0] || 'there';
  const missing = Array.isArray(missingFields) ? missingFields : [];
  const hebrew  = Array.isArray(hebrewFields)  ? hebrewFields  : [];

  const missingBlock = missing.length ? `
          <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:1px">What's missing</p>
          <ul style="margin:0 0 20px;padding-left:20px;color:#e8e0d5;font-size:14px;line-height:1.7">
            ${missing.map(f => `<li>${esc(ADDR_FIELD_LABELS[f] || f)}</li>`).join('')}
          </ul>` : '';

  const hebrewBlock = hebrew.length ? `
          <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:1px">Please re-enter in English</p>
          <p style="margin:0 0 8px;color:#bbb;font-size:14px;line-height:1.55">
            Our shipping carrier (DHL/USPS) can only read Latin characters on the shipping label. We found Hebrew text in:
          </p>
          <ul style="margin:0 0 20px;padding-left:20px;color:#e8e0d5;font-size:14px;line-height:1.7">
            ${hebrew.map(f => `<li>${esc(ADDR_FIELD_LABELS[f] || f)}</li>`).join('')}
          </ul>
          <p style="margin:0 0 20px;color:#888;font-size:13px;line-height:1.55">
            Examples: <em>Tel Aviv</em> instead of תל אביב, <em>Herzl 5</em> instead of הרצל 5.
          </p>` : '';

  const intro = hebrew.length && !missing.length
    ? `Hey ${esc(firstName)} — your payment went through, but the shipping address has Hebrew text in some fields. Couriers can't read those characters on the label, so the package would never reach you. We've held the order until you can re-enter the address in English (Latin script).`
    : `Hey ${esc(firstName)} — your payment went through, but a few details we need to ship your order didn't come through correctly. Your money is safe and we've held off sending anything to the printer until we have a valid address.`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Confirm your DUBIS shipping address</title></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td style="text-align:center;padding-bottom:32px">
          <span style="font-size:28px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span>
          <p style="margin:4px 0 0;color:#888;font-size:12px;letter-spacing:2px">FOR THE REST OF US</p>
        </td></tr>
        <tr><td style="background:#1a1a1a;border-radius:12px;padding:36px 40px">
          <h1 style="margin:0 0 8px;font-size:22px;color:#e8e0d5;font-weight:600">We need your shipping address</h1>
          <p style="margin:0 0 20px;color:#bbb;font-size:15px;line-height:1.55">${intro}</p>
          ${missingBlock}
          ${hebrewBlock}
          <a href="${esc(confirmUrl)}" style="display:inline-block;background:#c8a96e;color:#0d0d0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.5px">Confirm my address</a>
          <p style="margin:24px 0 0;color:#666;font-size:12px;line-height:1.6">
            Or copy this link into your browser:<br>
            <span style="color:#888;word-break:break-all">${esc(confirmUrl)}</span>
          </p>
          <p style="margin:24px 0 0;color:#888;font-size:13px;line-height:1.6">
            Order reference: <code style="color:#c8a96e">${esc(paypalOrderId)}</code><br>
            If this wasn't you or you'd rather cancel and get a refund, just reply to this email.
          </p>
        </td></tr>
        <tr><td style="text-align:center;padding-top:28px">
          <p style="margin:0;color:#444;font-size:12px">DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e;text-decoration:none">dubis.net</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     'DUBIS Orders <orders@dubis.net>',
        to:       [buyerEmail],
        subject:  `Action needed: confirm your DUBIS shipping address`,
        html,
        reply_to: 'hello@dubis.net',
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      derr('address-email-resend-failed', { paypalOrderId, status: r.status, body: JSON.stringify(data).slice(0, 300) });
      return { ok: false, reason: 'resend_error', status: r.status };
    }
    dlog('address-email-sent', { paypalOrderId, emailId: data.id, to: buyerEmail });
    return { ok: true, emailId: data.id };
  } catch (err) {
    derr('address-email-exception', { paypalOrderId, err: err.message });
    return { ok: false, reason: 'exception', message: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// Admin alert — DUBIS team gets a separate email so oren sees the
// issue in real time instead of waiting for the morning report.
// Recipients pulled from ADMIN_EMAILS env (comma-separated), default
// dubis.brand@gmail.com — same convention as the other API files.
// ─────────────────────────────────────────────────────────────────
async function sendDubisAdminAlert({ paypalOrderId, buyerEmail, buyerName, missingFields, hebrewFields, shippingAddress, cartItems, totalAmount }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: 'no_resend_key' };
  const recipients = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
    .split(',').map(e => e.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, reason: 'no_admin_emails' };

  const esc = _addrEscHtml;
  const missing = Array.isArray(missingFields) ? missingFields : [];
  const hebrew  = Array.isArray(hebrewFields)  ? hebrewFields  : [];
  const a = shippingAddress || {};
  const items = Array.isArray(cartItems) ? cartItems : [];
  const itemsTotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const total = Number(totalAmount) || itemsTotal;

  const issueSummary = [
    missing.length ? `${missing.length} missing field${missing.length > 1 ? 's' : ''}` : null,
    hebrew.length  ? `${hebrew.length} Hebrew field${hebrew.length > 1 ? 's' : ''}`    : null,
  ].filter(Boolean).join(' + ');

  const itemsRows = items.map(i => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.phrase || i.type || '')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.selectedSize)} / ${esc(i.selectedColor)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${Number(i.price || 0).toFixed(2)}</td>
        </tr>`).join('');

  const addrRow = (label, val, flagHebrew) => `
        <tr>
          <td style="padding:4px 8px;color:#666;width:140px">${esc(label)}</td>
          <td style="padding:4px 8px;color:${flagHebrew ? '#b91c1c' : '#111'};font-weight:${flagHebrew ? '600' : '400'}">${esc(val || '—')}${flagHebrew ? ' <span style="color:#b91c1c;font-size:11px">⚠ Hebrew</span>' : ''}</td>
        </tr>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#f6f6f6;margin:0;padding:24px;color:#111">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e2e2e2">
    <h2 style="margin:0 0 8px;color:#b91c1c;font-size:18px">⚠ Order held — address issue (${esc(issueSummary)})</h2>
    <p style="margin:0 0 16px;color:#444;font-size:14px">
      Payment captured but the shipping address can't be sent to Gelato as-is. Customer has been emailed a confirmation link. This task is also queued in <code>agent_tasks</code> with <code>category='address_missing'</code>.
    </p>

    <h3 style="margin:20px 0 6px;font-size:14px">Order</h3>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr><td style="padding:4px 8px;color:#666;width:140px">PayPal order ID</td><td style="padding:4px 8px"><code>${esc(paypalOrderId)}</code></td></tr>
      <tr><td style="padding:4px 8px;color:#666">Customer</td><td style="padding:4px 8px">${esc(buyerName || '—')} &lt;${esc(buyerEmail || '—')}&gt;</td></tr>
      <tr><td style="padding:4px 8px;color:#666">Items total</td><td style="padding:4px 8px">$${itemsTotal.toFixed(2)}${total && Math.abs(total - itemsTotal) > 0.01 ? ` (paid: $${total.toFixed(2)})` : ''}</td></tr>
    </table>

    ${missing.length ? `
    <h3 style="margin:20px 0 6px;font-size:14px;color:#b91c1c">Missing fields (${missing.length})</h3>
    <ul style="margin:0 0 8px;padding-left:20px;font-size:13px">
      ${missing.map(f => `<li>${esc(ADDR_FIELD_LABELS[f] || f)}</li>`).join('')}
    </ul>` : ''}

    ${hebrew.length ? `
    <h3 style="margin:20px 0 6px;font-size:14px;color:#b91c1c">Hebrew detected — can't print on label (${hebrew.length})</h3>
    <ul style="margin:0 0 8px;padding-left:20px;font-size:13px">
      ${hebrew.map(f => `<li>${esc(ADDR_FIELD_LABELS[f] || f)}: <code style="color:#b91c1c">${esc(a[f === 'city' ? 'admin_area_2' : f === 'state' ? 'admin_area_1' : f] || '')}</code></li>`).join('')}
    </ul>` : ''}

    <h3 style="margin:20px 0 6px;font-size:14px">Original address (as submitted)</h3>
    <table style="width:100%;font-size:13px;border-collapse:collapse;background:#fafafa;border:1px solid #eee;border-radius:6px">
      ${addrRow('Name',          a.name,           containsHebrew(a.name)          && hebrew.includes('name'))}
      ${addrRow('Phone',         a.phone,          false)}
      ${addrRow('Address line 1',a.address_line_1, hebrew.includes('address_line_1'))}
      ${addrRow('Address line 2',a.address_line_2, hebrew.includes('address_line_2'))}
      ${addrRow('City',          a.admin_area_2,   hebrew.includes('city'))}
      ${addrRow('State',         a.admin_area_1,   hebrew.includes('state'))}
      ${addrRow('Postal code',   a.postal_code,    false)}
      ${addrRow('Country',       a.country_code,   false)}
    </table>

    ${items.length ? `
    <h3 style="margin:20px 0 6px;font-size:14px">Cart (${items.length} item${items.length > 1 ? 's' : ''})</h3>
    <table style="width:100%;font-size:13px;border-collapse:collapse;background:#fafafa;border:1px solid #eee;border-radius:6px">
      ${itemsRows}
    </table>` : ''}

    <p style="margin:24px 0 0;color:#666;font-size:12px;line-height:1.6">
      No action required if the customer responds within 24h — the held task auto-resolves when they submit a corrected address.<br>
      Otherwise: reach out to the customer or issue a refund from the PayPal dashboard.
    </p>
  </div>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     'DUBIS Alerts <orders@dubis.net>',
        to:       recipients,
        subject:  `⚠ DUBIS order held — address issue (${String(paypalOrderId).slice(0, 12)})`,
        html,
        reply_to: 'hello@dubis.net',
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      derr('admin-alert-resend-failed', { paypalOrderId, status: r.status, body: JSON.stringify(data).slice(0, 300) });
      return { ok: false, reason: 'resend_error', status: r.status };
    }
    dlog('admin-alert-sent', { paypalOrderId, emailId: data.id, recipientCount: recipients.length });
    return { ok: true, emailId: data.id };
  } catch (err) {
    derr('admin-alert-exception', { paypalOrderId, err: err.message });
    return { ok: false, reason: 'exception', message: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// Surface the gap in oren's morning report by writing an agent_task.
// agent_id='supply' is the fulfillment-related agent slot; category
// 'address_missing' is the discriminator the morning-report Boss
// agent will look for. Status 'pending_approval' satisfies the table
// CHECK constraint and signals "admin needs to act on this".
// ─────────────────────────────────────────────────────────────────
async function createAddressMissingTask({ paypalOrderId, buyerEmail, buyerName, missingFields, hebrewFields, shippingAddress, cartItems }) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    dlog('address-task-skipped', { reason: 'no_supabase', paypalOrderId });
    return { ok: false, reason: 'no_supabase' };
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const issueParts = [
      (missingFields && missingFields.length) ? `Missing: ${missingFields.join(', ')}` : null,
      (hebrewFields  && hebrewFields.length)  ? `Hebrew: ${hebrewFields.join(', ')}`   : null,
    ].filter(Boolean).join(' | ');
    const { error } = await sb.from('agent_tasks').insert({
      agent_id:    'supply',
      title:       `Address held — order ${String(paypalOrderId).slice(0, 12)}`,
      description: `Customer paid via PayPal but shipping address is incomplete or in Hebrew. Order held until customer confirms via email.\n${issueParts}\nBuyer: ${buyerName || ''} <${buyerEmail || ''}>`,
      category:    'address_missing',
      status:      'pending_approval',
      priority:    'critical',
      content_data: {
        paypal_order_id:   paypalOrderId,
        buyer_email:       buyerEmail || null,
        buyer_name:        buyerName  || null,
        missing_fields:    missingFields || [],
        hebrew_fields:     hebrewFields  || [],
        original_address:  shippingAddress || null,
        cart_items:        cartItems || [],
        held_at:           new Date().toISOString(),
      },
    });
    if (error) {
      derr('address-task-insert-failed', { paypalOrderId, code: error.code, message: error.message });
      return { ok: false, reason: error.message };
    }
    dlog('address-task-created', { paypalOrderId });
    return { ok: true };
  } catch (err) {
    derr('address-task-exception', { paypalOrderId, err: err.message });
    return { ok: false, reason: 'exception', message: err.message };
  }
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

// 2026-05-20: cap designs are 1800×900 per gelato-operations.md spec
// (dad-hat front panel is wider than it is tall). Using the same 1800×1800
// minimum as shirts/hoodies wrongly rejected every cap order. The Hila
// $94.35 round-2 capture failed here — design-validation-failed → 500 →
// no refund (the explicit 500 return path wasn't covered by the handler-
// level catch since it's not an exception). Per-file minimum dimensions
// fix the underlying false-positive; the post-capture refund guard around
// the design-validation-failed branch fixes the safety hole.
function minDimensionsFor(url) {
  if (/\/cap_design_/i.test(url)) {
    return { minW: 1800, minH: 900 };
  }
  return { minW: MIN_DESIGN_W, minH: MIN_DESIGN_H };
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
    const { minW, minH } = minDimensionsFor(url);
    if (dims.w < minW || dims.h < minH) {
      return {
        ok: false,
        reason: `Design dimensions too small: ${url} is ${dims.w}×${dims.h} (min ${minW}×${minH}). Gelato will reject → JB default.`,
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

// ─────────────────────────────────────────────────────────────────
// LOOKUP — confirm-address.html calls this on page load to verify
// the token is valid and pre-fill any fields we already have.
// We DO NOT return cart contents or full PII to the page — just the
// minimum: which fields are missing, and what the (partial) name and
// country code were. Anything else stays server-side.
// ─────────────────────────────────────────────────────────────────
async function handleLookupPending(req, res) {
  const o = req.query?.o;
  const t = req.query?.t;
  if (!o || !t) return res.status(400).json({ error: 'missing_params' });
  if (!verifyOrderToken(o, t)) {
    derr('lookup-bad-token', { paypalOrderId: o });
    return res.status(403).json({ error: 'invalid_token' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'no_supabase' });
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: task } = await sb
      .from('agent_tasks')
      .select('content_data, status, created_at')
      .eq('category', 'address_missing')
      .contains('content_data', { paypal_order_id: o })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!task) {
      return res.status(404).json({ error: 'order_not_found_or_already_resolved' });
    }
    if (task.status === 'done') {
      return res.status(200).json({ alreadyResolved: true });
    }
    const cd = task.content_data || {};
    const orig = cd.original_address || {};
    // Pre-fill the form with whatever non-Hebrew values we have. Strip
    // Hebrew values so the customer is forced to retype them in English
    // instead of just resubmitting the same garbage with one char tweaked.
    const sanitize = (v) => (v && !containsHebrew(v)) ? v : '';
    return res.status(200).json({
      paypalOrderId: o,
      missingFields: cd.missing_fields || [],
      hebrewFields:  cd.hebrew_fields  || [],
      partialAddress: {
        name:           orig.name || '',
        address_line_1: sanitize(orig.address_line_1),
        address_line_2: sanitize(orig.address_line_2),
        admin_area_2:   sanitize(orig.admin_area_2),
        admin_area_1:   sanitize(orig.admin_area_1),
        postal_code:    orig.postal_code || '',
        country_code:   orig.country_code || 'US',
        phone:          orig.phone || '',
      },
    });
  } catch (err) {
    derr('lookup-exception', { err: err.message });
    return res.status(500).json({ error: 'lookup_failed', message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// SUBMIT CORRECTED ADDRESS — customer fills out confirm-address.html
// form and POSTs here. We re-validate, mark the held task done, then
// run the SAME validation + Gelato submission path that the normal
// checkout takes. Keeps the validation surface in exactly one place.
// ─────────────────────────────────────────────────────────────────
async function handleSubmitCorrectedAddress(req, res) {
  const { paypalOrderId, token, shippingAddress, buyerEmail } = req.body || {};
  if (!paypalOrderId || !token) return res.status(400).json({ error: 'missing_params' });
  if (!verifyOrderToken(paypalOrderId, token)) {
    derr('resubmit-bad-token', { paypalOrderId });
    return res.status(403).json({ error: 'invalid_token' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'no_supabase' });
  }

  // Re-validate the corrected address with the same rules used at checkout
  // (missing fields + Hebrew script). If the customer typed Hebrew again,
  // tell them specifically rather than just saying "invalid".
  const addrCheck = validateShippingAddress(shippingAddress, buyerEmail);
  if (!addrCheck.valid) {
    return res.status(400).json({
      error:         'address_still_invalid',
      missingFields: addrCheck.missing,
      hebrewFields:  addrCheck.hebrewFields,
    });
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find the held task to pull the cart items we stashed.
  const { data: task, error: taskErr } = await sb
    .from('agent_tasks')
    .select('id, content_data, status')
    .eq('category', 'address_missing')
    .contains('content_data', { paypal_order_id: paypalOrderId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (taskErr || !task) {
    return res.status(404).json({ error: 'order_not_found' });
  }
  if (task.status === 'done') {
    return res.status(200).json({ alreadyResolved: true });
  }
  const cartItems = (task.content_data && task.content_data.cart_items) || [];
  if (!cartItems.length) {
    return res.status(500).json({ error: 'no_cart_items_in_task' });
  }

  // Reuse the Gelato API call exactly as the main path does.
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) {
    return res.status(500).json({ error: 'no_api_key' });
  }

  const unmapped = cartItems.filter(item => !buildProductUid(item.type, item.selectedColor, item.selectedSize, item.gender));
  if (unmapped.length > 0) {
    return res.status(400).json({ error: 'items_not_mapped', unmapped });
  }

  const { firstName, lastName } = parseName(shippingAddress.name);
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
      firstName,
      lastName,
      email:        buyerEmail || '',
      phone:        shippingAddress.phone || '',
      addressLine1: shippingAddress.address_line_1,
      addressLine2: shippingAddress.address_line_2 || '',
      city:         shippingAddress.admin_area_2,
      state:        shippingAddress.admin_area_1 || '',
      country:      shippingAddress.country_code,
      postCode:     normalizePostCode(shippingAddress.postal_code, shippingAddress.country_code),
    },
  };

  dlog('resubmit-gelato-start', {
    paypalOrderId,
    itemsCount: gelatoOrder.items.length,
    shippingCountry: gelatoOrder.shippingAddress.country,
  });

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
    if (!gRes.ok) {
      derr('resubmit-gelato-failed', { paypalOrderId, status: gRes.status, data });
      return res.status(502).json({ error: 'gelato_rejected', status: gRes.status, details: data });
    }
    const gelatoOrderId = data.id || data.orderId || data.orderReferenceId;

    // Mark the held task done so it stops surfacing in oren's report.
    await sb.from('agent_tasks').update({
      status: 'done',
      notes:  `Customer submitted corrected address; Gelato order ${gelatoOrderId} created at ${new Date().toISOString()}.`,
      content_data: {
        ...(task.content_data || {}),
        resolved_at:       new Date().toISOString(),
        gelato_order_id:   gelatoOrderId,
        corrected_address: shippingAddress,
      },
    }).eq('id', task.id);

    // Update the orders row (if any) with the new shipping address +
    // gelato id + status. If save.js never ran (rare), this is a no-op.
    await sb.from('orders').update({
      shipping_address:  shippingAddress,
      printful_order_id: gelatoOrderId,
      status:            'pending',
    }).eq('paypal_order_id', paypalOrderId);

    dlog('resubmit-gelato-success', { paypalOrderId, gelatoOrderId });
    return res.status(200).json({ success: true, gelatoOrderId });
  } catch (err) {
    derr('resubmit-gelato-exception', { paypalOrderId, err: err.message });
    return res.status(500).json({ error: 'network_error', message: err.message });
  }
}

// =====================================================================
// MULTI-WAREHOUSE ORDER SPLITTING (2026-05-21)
// =====================================================================
// Some carts need items from multiple Gelato warehouses. Their API
// accepts ONE warehouse per /v4/orders POST, so a cart that mixes (say)
// an IL-only t-shirt with a CZ-only hoodie would be refused outright.
//
// The splitter (api/_orderSplit.js) runs /v4/orders:quote with a peeling
// algorithm to discover the per-warehouse breakdown. This dispatcher
// then submits N separate /v4/orders POSTs behind ONE PayPal capture,
// guaranteeing atomicity: any sub-order failure → cancel all submitted
// siblings + refund the FULL capture.
//
// The customer sees ONE order — the split is invisible (oren directive
// 2026-05-21). We absorb the slightly-higher Gelato cost (extra shipping
// across packages); customer pays a single shipping fee.
// =====================================================================

// Cancel a single Gelato order. Best-effort — failures are swallowed
// because we're already in an error path; an orphan Gelato order is
// strictly better than failing to attempt cancellation.
async function cancelGelatoOrder(gelatoOrderId, apiKey) {
  try {
    // Gelato accepts both PATCH (status=canceled) and POST /cancel.
    // PATCH is the documented standard.
    const res = await fetch(`${GELATO_API_BASE}/v4/orders/${gelatoOrderId}`, {
      method:  'PATCH',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'canceled' }),
    });
    dlog('cancel-suborder', { gelatoOrderId, http: res.status });
    return res.ok;
  } catch (err) {
    derr('cancel-suborder-exception', { gelatoOrderId, message: err.message });
    return false;
  }
}

async function cancelAllSubOrders(submittedOrders, apiKey) {
  for (const so of submittedOrders) {
    await cancelGelatoOrder(so.gelatoOrderId, apiKey);
  }
}

// Build a single Gelato POST payload for a sub-cart of a split.
function buildGelatoSubOrderPayload({ paypalOrderId, subCart, splitIndex, splitCount, shippingAddress, firstName, lastName, buyerEmail }) {
  return {
    orderReferenceId:    `DUBIS-${paypalOrderId}-${splitIndex}of${splitCount}`,
    customerReferenceId: paypalOrderId,
    currency:            'USD',
    items: subCart.entries.map((e, j) => ({
      itemReferenceId: `item-${splitIndex}-${j + 1}`,
      productUid:      e.uid,
      files:           getDesignFiles(e.item.id, e.item.selectedColor, e.item.designRef, e.item.type),
      quantity:        1,
    })),
    shipmentMethodUid: 'express',
    shippingAddress: {
      firstName,
      lastName,
      email:        buyerEmail || '',
      phone:        shippingAddress.phone || '',
      addressLine1: shippingAddress.address_line_1,
      addressLine2: shippingAddress.address_line_2 || '',
      city:         shippingAddress.admin_area_2,
      state:        shippingAddress.admin_area_1 || '',
      country:      shippingAddress.country_code,
      postCode:     normalizePostCode(shippingAddress.postal_code, shippingAddress.country_code),
    },
  };
}

// SERIAL multi-order dispatch. Submits sub-orders one at a time so we
// can abort the chain on the first failure without wasted POSTs.
async function dispatchMultiOrderSplit({
  res, req,
  paypalOrderId, buyerEmail, shippingAddress, cartItems,
  splitResult, firstName, lastName, GELATO_API_KEY, t0,
}) {
  const splitGroupId = crypto.randomUUID();
  const splitCount = splitResult.subCarts.length;
  const submittedOrders = []; // { gelatoOrderId, splitIndex, subCart, gelatoData }

  dlog('split-dispatch-start', {
    paypalOrderId,
    splitGroupId,
    splitCount,
    warehouses: splitResult.subCarts.map(sc => sc.country),
    subCartSizes: splitResult.subCarts.map(sc => sc.items.length),
  });

  // ── Phase 1: Serial POST of all sub-orders ──────────────────────
  for (let i = 0; i < splitCount; i++) {
    const subCart = splitResult.subCarts[i];
    const splitIndex = i + 1;
    const payload = buildGelatoSubOrderPayload({
      paypalOrderId, subCart, splitIndex, splitCount, shippingAddress,
      firstName, lastName, buyerEmail,
    });
    dlog('split-suborder-post', {
      paypalOrderId, splitIndex, splitCount,
      orderRef: payload.orderReferenceId,
      itemsCount: payload.items.length,
      uids: payload.items.map(it => it.productUid),
    });
    let gRes, data, postErr;
    try {
      gRes = await fetch(`${GELATO_API_BASE}/v4/orders`, {
        method:  'POST',
        headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      data = await gRes.json().catch(() => null);
    } catch (err) {
      postErr = err;
    }
    const bodyCanceled = data && (
      data.financialStatus === 'canceled' ||
      data.financialStatus === 'cancelled' ||
      data.fulfillmentStatus === 'failed' ||
      !!data.refusalReasonCode
    );

    if (postErr || !gRes || !gRes.ok || bodyCanceled) {
      derr('split-suborder-failed', {
        paypalOrderId, splitIndex, splitCount,
        httpStatus: gRes ? gRes.status : 'no_response',
        bodyCanceled,
        refusal: data ? (data.refusalReasonCode || data.message || '').slice(0, 200) : null,
        exception: postErr ? postErr.message : null,
        priorSubmitted: submittedOrders.length,
      });
      // CRITICAL: cancel all previously-submitted sub-orders before refunding,
      // so Gelato doesn't keep producing things the customer won't receive.
      if (submittedOrders.length > 0) {
        await cancelAllSubOrders(submittedOrders, GELATO_API_KEY);
      }
      // Refund the FULL PayPal capture.
      const refundResult = await refundOrder({
        paypalOrderId,
        reason: bodyCanceled
          ? `split_canceled_${splitIndex}_of_${splitCount}_${(data && data.refusalReasonCode) || 'unknown'}`
          : `split_failed_${splitIndex}_of_${splitCount}_${gRes ? gRes.status : 'exception'}`,
      });
      dlog('split-failure-refund-done', {
        paypalOrderId, splitIndex, splitCount,
        refunded: refundResult.refunded,
        refundId: refundResult.refundId || null,
      });
      return res.status(200).json({
        success:  true,
        manual:   !refundResult.refunded,
        refunded: !!refundResult.refunded,
        refundId: refundResult.refundId || null,
        reason:   refundResult.refunded ? 'split_partial_refunded' : 'split_partial_no_refund',
        gelatoError: postErr
          ? `Network error on sub-order ${splitIndex}/${splitCount}: ${postErr.message}`
          : `Sub-order ${splitIndex}/${splitCount} rejected: ${(data && (data.refusalReason || data.message)) || 'api_error'}`,
        split: true,
        splitCount,
      });
    }
    const gelatoOrderId = data.id || data.orderId || data.orderReferenceId;
    submittedOrders.push({ gelatoOrderId, splitIndex, subCart, gelatoData: data });
    dlog('split-suborder-success', { paypalOrderId, splitIndex, splitCount, gelatoOrderId });
  }

  // ── Phase 2: Async-cancel race-window poll on ALL sub-orders in PARALLEL ──
  // Gelato may flip status from 'open' to 'canceled' within 1-3 seconds after
  // accepting the POST (we've seen this on single-order flow too). Poll each
  // sub-order for 4 seconds; if any cancels, refund the whole chain.
  const RACE_WINDOW_MS = 4000;
  const POLL_INTERVAL_MS = 1500;
  const cancelledAfterPost = [];
  await Promise.all(submittedOrders.map(async (so) => {
    const t0sub = Date.now();
    let polls = 0;
    while (Date.now() - t0sub < RACE_WINDOW_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      polls++;
      try {
        const vRes = await fetch(`${GELATO_API_BASE}/v4/orders/${so.gelatoOrderId}`, {
          headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' },
        });
        if (!vRes.ok) continue;
        const vData = await vRes.json().catch(() => null);
        if (!vData) continue;
        const fs = vData.financialStatus || '';
        if (/^(canceled|cancelled)$/i.test(fs)) {
          cancelledAfterPost.push({
            splitIndex: so.splitIndex,
            gelatoOrderId: so.gelatoOrderId,
            refusalCode: vData.refusalReasonCode || null,
            refusalReason: vData.refusalReason || null,
          });
          break;
        }
        if (/^(passed_to_production|printed|shipped|delivered)$/i.test(fs)) break;
      } catch (e) { /* keep polling */ }
    }
    dlog('split-suborder-verify-done', {
      paypalOrderId,
      splitIndex: so.splitIndex,
      gelatoOrderId: so.gelatoOrderId,
      polls,
      durationMs: Date.now() - t0sub,
    });
  }));

  if (cancelledAfterPost.length > 0) {
    derr('split-async-cancel', {
      paypalOrderId, splitGroupId, splitCount,
      cancelled: cancelledAfterPost,
    });
    // Cancel any sub-orders Gelato HASN'T yet canceled to stop production
    const stillLive = submittedOrders.filter(so =>
      !cancelledAfterPost.find(c => c.splitIndex === so.splitIndex)
    );
    await cancelAllSubOrders(stillLive, GELATO_API_KEY);
    const refundResult = await refundOrder({
      paypalOrderId,
      reason: `split_async_canceled_${cancelledAfterPost.map(c => c.refusalCode || 'unknown').join('_').slice(0, 80)}`,
    });
    return res.status(200).json({
      success:  true,
      manual:   !refundResult.refunded,
      refunded: !!refundResult.refunded,
      refundId: refundResult.refundId || null,
      reason:   refundResult.refunded ? 'split_async_refunded' : 'split_async_no_refund',
      gelatoError: `Gelato canceled ${cancelledAfterPost.length}/${splitCount} sub-orders during async stock verification.`,
      split: true,
      splitCount,
    });
  }

  // ── Phase 3: Persist N rows in `orders` table ──────────────────
  // We bypass /api/orders/save (which only knows about single-order flows)
  // and INSERT here directly using the service role. Row 1 carries the full
  // totalAmount + full cartItems + shipping_address; rows 2..N have ONLY
  // their sub-cart items, total_amount=0 (bookkeeping = single sale on row 1).
  // All N rows share split_group_id + split_index + split_count.
  let primaryOrderId = null;
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const itemsSubtotal = (cartItems || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
      // The full cart is stored on row 1; row 2..N just carry their sub-cart for
      // Gelato-status cross-referencing later (admin needs to see what's in each).
      for (const so of submittedOrders) {
        const isPrimary = so.splitIndex === 1;
        const row = {
          paypal_order_id:   paypalOrderId,
          printful_order_id: so.gelatoOrderId,
          buyer_email:       buyerEmail || '',
          shipping_address:  shippingAddress,
          items:             isPrimary ? cartItems : so.subCart.items,
          total_amount:      isPrimary ? itemsSubtotal : 0,
          items_subtotal:    isPrimary ? itemsSubtotal : 0,
          status:            'pending',
          currency:          'USD',
          split_group_id:    splitGroupId,
          split_index:       so.splitIndex,
          split_count:       splitCount,
        };
        const { data: ins, error: insErr } = await sb.from('orders').insert(row).select('id').single();
        if (insErr) {
          derr('split-db-insert-failed', {
            paypalOrderId, splitIndex: so.splitIndex,
            error: insErr.message,
          });
          // Don't abort — Gelato orders are already submitted, refunding now would
          // strand the production. Log and continue; oren can reconcile manually.
        } else if (isPrimary) {
          primaryOrderId = ins.id;
        }
      }
      dlog('split-db-rows-inserted', {
        paypalOrderId, splitGroupId, splitCount, primaryOrderId,
      });
    }
  } catch (dbErr) {
    derr('split-db-exception', { paypalOrderId, message: dbErr.message });
  }

  // ── Phase 4: Success response. ─────────────────────────────────
  // paypal.js: `skipSave: true` tells the client NOT to call /api/orders/save
  // since we've already inserted the rows. printfulOrderId is the PRIMARY (row 1)
  // sub-order's Gelato ID — preserves API shape for downstream consumers that
  // expect a single-order response.
  dlog('split-dispatch-success', {
    paypalOrderId, splitGroupId, splitCount,
    gelatoOrderIds: submittedOrders.map(so => so.gelatoOrderId),
    totalDurationMs: Date.now() - t0,
  });
  const primarySubOrder = submittedOrders.find(so => so.splitIndex === 1);
  return res.status(200).json({
    success:         true,
    manual:          false,
    split:           true,
    splitGroupId,
    splitCount,
    skipSave:        true,    // tell paypal.js not to also call /api/orders/save
    gelatoOrderId:   primarySubOrder ? primarySubOrder.gelatoOrderId : null,
    printfulOrderId: primarySubOrder ? primarySubOrder.gelatoOrderId : null,
    gelatoOrderIds:  submittedOrders.map(so => so.gelatoOrderId),
  });
}

// 2026-05-20 REV 2 — QUOTE-BASED probe.
// First version used /v3/stock/region-availability which returns per-region
// "in-stock / out-of-stock / unavailable" — but Gelato's actual fulfillment
// routing for IL doesn't match the region we'd guess (Hila's 5th capture
// today: region-availability said EU/AS in-stock, Gelato refused order
// with stock anyway). The /v4/orders:quote endpoint is the AUTHORITATIVE
// source — Gelato runs the exact same routing logic it uses for real
// order placement. If quote returns a valid quote → fulfillment will work.
// If quote returns refusalReasonCode or empty quotes[] → stock issue.
async function handleStockProbe(req, res) {
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) {
    return res.status(200).json({ ok: true, skipped: 'no_api_key' });
  }

  const { cartItems = [], country = 'US', shippingAddress = null } = req.body || {};
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: 'cart_empty', message: 'No items to probe' });
  }

  // Build (cartIdx → productUid) for items that can be mapped. Items that
  // can't map at all (e.g. unsupported color) get flagged as OOS too —
  // safer than letting them through to PayPal.
  const probeList = cartItems.map((item, i) => {
    const uid = buildProductUid(item.type, item.selectedColor, item.selectedSize, item.gender);
    return { i, item, uid };
  });

  // 2026-05-20: cross-check against our DB stock map FIRST. If we have
  // manually marked a variant OOS (because Gelato refused it in a past
  // order even though their quote API said in-stock — IL routing race),
  // honor that mark — Gelato's quote may transiently say ok again but
  // the actual placement may still refuse. Stale localStorage carts can
  // contain variants no longer in js/products.js; this layer catches them.
  const dbOosKeys = new Set();
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const ids = [...new Set(cartItems.map(i => i.id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: rows } = await sb.from('product_variant_stock')
          .select('product_id_numeric,color,size,in_stock,manual_override')
          .in('product_id_numeric', ids);
        for (const r of (rows || [])) {
          if (r.in_stock === false) {
            dbOosKeys.add(`${r.product_id_numeric}|${r.color}|${r.size}`);
          }
        }
      }
    }
  } catch (dbErr) {
    derr('stock-probe-db-check-failed', { message: dbErr.message });
    // Fall through — quote API check is still in play.
  }

  // Items that don't map → immediate OOS flag, no Gelato call needed.
  const unmapped = probeList.filter(p => !p.uid);
  // Items flagged OOS in our DB → also immediate OOS flag.
  const dbOos = probeList.filter(p => p.uid && dbOosKeys.has(`${p.item.id}|${p.item.selectedColor}|${p.item.selectedSize}`));
  const mappable = probeList.filter(p => p.uid && !dbOosKeys.has(`${p.item.id}|${p.item.selectedColor}|${p.item.selectedSize}`));

  if (dbOos.length > 0 || unmapped.length > 0) {
    if (mappable.length === 0) {
      // Every cart item is OOS or unmapped — short-circuit, no Gelato call.
      const oosItems = [
        ...unmapped.map(p => ({
          cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
          reason: 'unsupported_variant',
          label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
        })),
        ...dbOos.map(p => ({
          cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
          reason: 'db_marked_oos', productUid: p.uid,
          label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
        })),
      ];
      return res.status(200).json({
        ok: false,
        country: (shippingAddress && shippingAddress.country_code) || country,
        mode: 'all_blocked_pre_gelato',
        oosItems,
        cartCount: cartItems.length,
      });
    }
    // Some OOS, some mappable — we'll still call Gelato to validate the
    // rest, but the OOS ones are guaranteed to surface in the final list.
  }

  if (mappable.length === 0) {
    // Every cart item failed mapping. Don't call Gelato — return the unmapped list.
    return res.status(200).json({
      ok: false,
      country,
      mode: 'all_unmapped',
      oosItems: unmapped.map(p => ({
        cartIndex: p.i,
        type:  p.item.type,
        color: p.item.selectedColor,
        size:  p.item.selectedSize,
        reason: 'unsupported_variant',
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      })),
      cartCount: cartItems.length,
    });
  }

  // 2026-05-20: AUTHORITATIVE probe via Gelato's /v4/orders:quote endpoint.
  // Quote runs the SAME stock+routing logic as real order placement, so a
  // successful quote ≈ guaranteed-fulfillable order (modulo seconds-level
  // race conditions which the post-capture safety nets cover).
  //
  // Required shape per Gelato v4 docs:
  //   { orderReferenceId, currency, recipient: {...}, products: [{...}] }
  // Each product needs `fileUrl` — pass any reachable URL; we use a real
  // print file so the quote also validates file reachability.
  const recipientCountry = (shippingAddress && shippingAddress.country_code) || country || 'US';
  const recipient = {
    firstName: (shippingAddress && (shippingAddress.full_name || '').split(' ')[0]) || 'Probe',
    lastName:  (shippingAddress && ((shippingAddress.full_name || '').split(' ').slice(1).join(' ') || 'Probe')) || 'Probe',
    addressLine1: (shippingAddress && shippingAddress.address_line_1) || 'Probe St 1',
    city:         (shippingAddress && shippingAddress.admin_area_2) || (recipientCountry === 'IL' ? 'Tel Aviv' : 'Los Angeles'),
    postCode:     normalizePostCode((shippingAddress && shippingAddress.postal_code) || (recipientCountry === 'IL' ? '6473207' : '90210'), recipientCountry),
    country:      recipientCountry,
    state:        (shippingAddress && shippingAddress.admin_area_1) || (recipientCountry === 'US' ? 'CA' : ''),
    email:        (shippingAddress && shippingAddress.email) || 'probe@dubis.net',
    phone:        (shippingAddress && shippingAddress.phone) || '+10000000000',
  };
  const products = mappable.map(p => {
    const files = getDesignFiles(p.item.id, p.item.selectedColor, p.item.designRef, p.item.type);
    // Quote requires at least one fileUrl per product — use front if available.
    const fileUrl = (files.find(f => f.type === 'front') || files[0] || {}).url || `${DESIGN_BASE_URL}/front_logo_white.png`;
    return {
      itemReferenceId: `probe-${p.i}`,
      productUid: p.uid,
      quantity: 1,
      fileUrl,
    };
  });

  let quoteResponse = null;
  try {
    const gRes = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
      method:  'POST',
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderReferenceId: `dubis-probe-${Date.now()}`,
        currency: 'USD',
        recipient,
        products,
      }),
    });
    quoteResponse = await gRes.json().catch(() => null);
    if (!gRes.ok) {
      // Gelato hiccup OR Gelato returned 4xx with a refusal reason. If the
      // body has refusalReasonCode/refusalReason, surface it; otherwise
      // fail OPEN (post-capture safety nets cover the residual risk).
      const refusalCode   = quoteResponse && (quoteResponse.refusalReasonCode || quoteResponse.code);
      const refusalReason = quoteResponse && (quoteResponse.refusalReason || quoteResponse.message);
      derr('stock-probe-quote-http-error', {
        httpStatus: gRes.status,
        refusalCode,
        refusalReason: (refusalReason || '').slice(0, 200),
      });
      if (refusalCode === 'stock' || /out of stock/i.test(refusalReason || '')) {
        return res.status(200).json({
          ok: false,
          country: recipientCountry,
          mode: 'quote_refused_stock',
          reason: refusalReason || 'Gelato refused: stock',
          oosItems: mappable.map(p => ({
            cartIndex: p.i,
            type:  p.item.type,
            color: p.item.selectedColor,
            size:  p.item.selectedSize,
            reason: 'gelato_quote_stock_refusal',
            label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
            productUid: p.uid,
          })).concat(unmapped.map(p => ({
            cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
            reason: 'unsupported_variant',
            label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
          }))),
          cartCount: cartItems.length,
        });
      }
      return res.status(200).json({
        ok: true,
        skipped: 'gelato_http_' + gRes.status,
        fallback: 'allowing_order_post_capture_safety_nets_apply',
      });
    }
  } catch (e) {
    derr('stock-probe-quote-exception', { message: e.message });
    return res.status(200).json({
      ok: true,
      skipped: 'fetch_exception',
      fallback: 'allowing_order_post_capture_safety_nets_apply',
    });
  }

  // Success path: quote returned 2xx. Validate it actually has a usable quote
  // with shipping options for each item. An empty quotes[] or any item missing
  // a price means Gelato couldn't fulfill — treat as OOS.
  const quoteRefusal = quoteResponse && (quoteResponse.refusalReasonCode || quoteResponse.refusalReason);
  if (quoteRefusal) {
    derr('stock-probe-quote-refused-2xx', {
      refusalCode: quoteResponse.refusalReasonCode,
      refusalReason: (quoteResponse.refusalReason || '').slice(0, 200),
    });
    return res.status(200).json({
      ok: false,
      country: recipientCountry,
      mode: 'quote_refused_in_body',
      reason: quoteResponse.refusalReason || 'Gelato refused: stock',
      oosItems: mappable.map(p => ({
        cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
        reason: 'gelato_quote_refused', productUid: p.uid,
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      })),
      cartCount: cartItems.length,
    });
  }
  const quotes = (quoteResponse && quoteResponse.quotes) || [];
  if (quotes.length === 0) {
    return res.status(200).json({
      ok: false,
      country: recipientCountry,
      mode: 'quote_empty',
      reason: 'Gelato returned no fulfillment quote — likely stock or routing issue',
      oosItems: mappable.map(p => ({
        cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
        reason: 'gelato_quote_empty', productUid: p.uid,
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      })),
      cartCount: cartItems.length,
    });
  }
  // 2026-05-21 (Hila round 6, $361+ stuck): even with HTTP 200 + non-empty
  // quotes[] + no refusalReasonCode, the quote can encode partial-OOS via
  //   - shipmentMethods[].shipmentMethodUid containing "out_of_stock"
  //     (e.g. "api_out_of_stock_for_part_order")
  //   - any product in quote.products[] with price === 0 (zero price means
  //     Gelato couldn't quote that variant from the chosen warehouse)
  // Both signals fired on the failed order DUBIS-73K316186J403870S — the
  // longsleeve had price=0 and the shipment method was "api_out_of_stock_for_part_order".
  // We detect either and treat the cart as not fulfillable.
  const partialOosFlags = [];
  for (const q of quotes) {
    for (const sm of (q.shipmentMethods || [])) {
      if (sm && sm.shipmentMethodUid && /out[_-]of[_-]stock|stock/i.test(sm.shipmentMethodUid)) {
        partialOosFlags.push({ quoteId: q.id, shipmentMethodUid: sm.shipmentMethodUid });
      }
    }
    for (const prod of (q.products || [])) {
      if (prod && (prod.price === 0 || prod.price === null || prod.price === undefined)) {
        partialOosFlags.push({ quoteId: q.id, productUid: prod.productUid, price: prod.price });
      }
    }
  }
  if (partialOosFlags.length > 0) {
    derr('stock-probe-quote-partial-oos', { paypalOrderId: null, country: recipientCountry, flags: partialOosFlags.slice(0, 10) });
    // Identify the offending items by matching their productUid back to cart positions.
    const oosUidSet = new Set(partialOosFlags.filter(f => f.productUid).map(f => f.productUid));

    // 2026-05-21 — when only the shipment-level flag fires (no per-product price=0),
    // identify the MINORITY-warehouse items by probing each cart item alone and
    // comparing fulfillmentCountry. The combined-cart quote already chose ONE country
    // (chosenCountry). Items whose own quote returns a DIFFERENT country are the ones
    // that broke the cart — they're forcing Gelato to attempt cross-warehouse fulfillment.
    const chosenCountry = (quotes[0] && quotes[0].fulfillmentCountry) || null;
    if (oosUidSet.size === 0 && chosenCountry && mappable.length > 1) {
      try {
        const soloResults = await Promise.all(mappable.map(async (p) => {
          try {
            const files = getDesignFiles(p.item.id, p.item.selectedColor, p.item.designRef, p.item.type);
            const fileUrl = (files.find(f => f.type === 'front') || files[0] || {}).url || `${DESIGN_BASE_URL}/front_logo_white.png`;
            const r = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
              method:  'POST',
              headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderReferenceId: `dubis-solo-probe-${Date.now()}-${p.i}`,
                currency: 'USD',
                recipient,
                products: [{ itemReferenceId: 'i1', productUid: p.uid, quantity: 1, fileUrl }],
              }),
            });
            const j = await r.json().catch(() => null);
            const country = j && j.quotes && j.quotes[0] && j.quotes[0].fulfillmentCountry;
            return { uid: p.uid, country };
          } catch (e) {
            return { uid: p.uid, country: null };
          }
        }));
        // Mark items whose solo-fulfillment country differs from the chosen combined one
        for (const r of soloResults) {
          if (r.country && r.country !== chosenCountry) {
            oosUidSet.add(r.uid);
          }
        }
        dlog('stock-probe-minority-warehouse', { chosenCountry, soloResults });
      } catch (e) {
        // Fall back to "mark all" if solo probing fails
      }
    }

    const oosItemsByCart = [];
    for (const p of probeList) {
      // Item is in oosUidSet (specific culprit) OR we couldn't narrow it down → mark all
      if (oosUidSet.size > 0 ? oosUidSet.has(p.uid) : true) {
        oosItemsByCart.push({
          cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
          reason: 'partial_stock_in_fulfillment_warehouse', productUid: p.uid,
          label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
        });
      }
    }
    // 2026-05-21: BEFORE telling the customer "can't ship", check if the cart is
    // SPLITTABLE across warehouses. If yes → return ok=true (transparent — the
    // checkout dispatcher will submit N sub-orders). The customer never sees a
    // "ships in N packages" message because oren wants the split invisible.
    try {
      const splitEntries = mappable.map(p => {
        const files = getDesignFiles(p.item.id, p.item.selectedColor, p.item.designRef, p.item.type);
        const fileUrl = (files.find(f => f.type === 'front') || files[0] || {}).url || `${DESIGN_BASE_URL}/front_logo_white.png`;
        return { uid: p.uid, item: p.item, fileUrl };
      });
      const splitResult = await splitCartByWarehouse({
        entries: splitEntries,
        recipient,
        gelatoApiKey: GELATO_API_KEY,
      });
      if (splitResult.splittable && splitResult.subCarts.length > 1 && splitResult.unfulfillable.length === 0) {
        dlog('stock-probe-splittable', {
          country: recipientCountry,
          subCarts: splitResult.subCarts.length,
          warehouses: splitResult.subCarts.map(sc => sc.country),
        });
        return res.status(200).json({
          ok: true,
          country: recipientCountry,
          mode: 'splittable',
          splittable: true,
          splitCount: splitResult.subCarts.length,
          // We DON'T expose per-warehouse breakdown to the client — oren's
          // requirement is full transparency: customer sees one order.
        });
      }
    } catch (splitErr) {
      // Splitter failure → fall through to the existing partial-OOS error.
      derr('stock-probe-split-exception', { message: splitErr.message });
    }

    const itemsCausing = oosItemsByCart.length;
    const reasonMsg = itemsCausing < cartItems.length && itemsCausing > 0
      ? `One or more items in your cart can't ship from the same warehouse together. Removing or swapping just ${itemsCausing === 1 ? 'this' : 'these'} item(s) should fix it.`
      : 'Items in this cart can\'t all be fulfilled from a single warehouse for your country. Try removing items one at a time to find the conflict.';
    return res.status(200).json({
      ok: false,
      country: recipientCountry,
      mode: 'quote_partial_oos',
      reason: reasonMsg,
      flags: partialOosFlags.slice(0, 10),
      oosItems: oosItemsByCart,
      cartCount: cartItems.length,
    });
  }

  // Verify every cart item was priced. Items absent from quote.products → OOS.
  const quotedItemIds = new Set();
  for (const q of quotes) {
    for (const prod of (q.products || [])) {
      quotedItemIds.add(prod.itemReferenceId);
    }
  }
  const oosItems = [];
  for (const p of probeList) {
    if (!p.uid) {
      oosItems.push({
        cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
        reason: 'unsupported_variant',
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      });
      continue;
    }
    // DB-level manual OOS override beats anything Gelato's quote says.
    if (dbOosKeys.has(`${p.item.id}|${p.item.selectedColor}|${p.item.selectedSize}`)) {
      oosItems.push({
        cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
        reason: 'db_marked_oos', productUid: p.uid,
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      });
      continue;
    }
    if (!quotedItemIds.has(`probe-${p.i}`)) {
      oosItems.push({
        cartIndex: p.i, type: p.item.type, color: p.item.selectedColor, size: p.item.selectedSize,
        reason: 'not_in_quote', productUid: p.uid,
        label: `${p.item.typeLabel || p.item.type} ${p.item.selectedColor} ${p.item.selectedSize}`,
      });
    }
  }

  const allOk = oosItems.length === 0;
  dlog('stock-probe-quote-result', {
    country: recipientCountry,
    cartCount: cartItems.length,
    quotedCount: quotedItemIds.size,
    oosCount: oosItems.length,
    allOk,
    quoteCount: quotes.length,
  });

  return res.status(200).json({
    ok: allOk,
    country: recipientCountry,
    mode: 'quote_ok',
    oosItems,
    cartCount: cartItems.length,
  });
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

  // Route: pre-capture stock probe (called from paypal.js BEFORE PayPal opens)
  if (req.method === 'POST' && req.query && req.query.action === 'stock-probe') {
    return handleStockProbe(req, res);
  }

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

  // Route: lookup an order held for address confirmation
  //   GET  /api/create-gelato-order?action=lookup-pending&o={paypalId}&t={token}
  // Returns minimal info needed to render confirm-address.html.
  if (req.method === 'GET' && req.query && req.query.action === 'lookup-pending') {
    return handleLookupPending(req, res);
  }

  // Route: customer submits a corrected address — resubmit to Gelato
  //   POST /api/create-gelato-order?action=submit-corrected-address
  //   Body: { paypalOrderId, token, shippingAddress, buyerEmail }
  if (req.method === 'POST' && req.query && req.query.action === 'submit-corrected-address') {
    return handleSubmitCorrectedAddress(req, res);
  }

  if (req.method !== 'POST') {
    derr('method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2026-05-20: top-level safety net around the entire PayPal-capture flow.
  // Background: Hila test order ($94.35) captured cleanly on PayPal's side,
  // /api/create-gelato-order then 500'd at an unknown point AFTER request-received
  // but before order-input. The original try/catch only wrapped the Gelato HTTP
  // call (lines ~1612-1687), so any earlier exception left the customer charged
  // with no refund, no DB row, no Gelato order, and the frontend stuck on PayPal's
  // checkout page. This outer try/catch guarantees: ANY unhandled exception →
  // attempt refund → 200 with structured refund payload → frontend shows refund
  // modal. NO MORE silent 500 after capture, ever.
  try {
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

  // ── Case 1b: Validate shipping address BEFORE anything else ──
  // PayPal flows have produced orders with blank / "?" / "undefined"
  // address fields (DHL-undeliverable incident, May 2026). Israeli
  // customers also occasionally type the address in Hebrew, which the
  // courier label can't render. If any required field is missing OR
  // any address field is Hebrew we never call Gelato — we hold the
  // order, email the customer for a corrected address, email the
  // DUBIS team an alert, and surface the gap in oren's morning report.
  const addrCheck = validateShippingAddress(shippingAddress, buyerEmail);
  if (!addrCheck.valid) {
    derr('address-invalid', {
      paypalOrderId,
      missing:      addrCheck.missing,
      hebrewFields: addrCheck.hebrewFields,
      receivedKeys: Object.keys(shippingAddress || {}),
    });
    const confirmToken = signOrderToken(paypalOrderId);
    const confirmUrl   = `https://www.dubis.net/confirm-address.html?o=${encodeURIComponent(paypalOrderId)}&t=${confirmToken}`;
    const buyerName    = (shippingAddress && shippingAddress.name) || '';
    const itemsTotal   = (cartItems || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
    const [emailRes, adminRes, taskRes] = await Promise.all([
      sendAddressConfirmationEmail({
        buyerEmail,
        buyerName,
        paypalOrderId,
        missingFields: addrCheck.missing,
        hebrewFields:  addrCheck.hebrewFields,
        confirmUrl,
      }),
      sendDubisAdminAlert({
        paypalOrderId,
        buyerEmail,
        buyerName,
        missingFields: addrCheck.missing,
        hebrewFields:  addrCheck.hebrewFields,
        shippingAddress,
        cartItems,
        totalAmount:   itemsTotal,
      }),
      createAddressMissingTask({
        paypalOrderId,
        buyerEmail,
        buyerName,
        missingFields: addrCheck.missing,
        hebrewFields:  addrCheck.hebrewFields,
        shippingAddress,
        cartItems,
      }),
    ]);
    dlog('address-hold-complete', {
      paypalOrderId,
      customerEmailSent: !!emailRes.ok,
      adminEmailSent:    !!adminRes.ok,
      taskCreated:       !!taskRes.ok,
      missing:           addrCheck.missing,
      hebrewFields:      addrCheck.hebrewFields,
    });
    return res.status(200).json({
      success:           true,
      manual:            true,
      addressMissing:    true,
      reason:            'address_missing',
      missingFields:     addrCheck.missing,
      hebrewFields:      addrCheck.hebrewFields,
      confirmationToken: confirmToken,
      message:           'Order held pending address confirmation. Customer + DUBIS alerted.',
    });
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

    // 2026-05-20 (Hila round-2 incident): PayPal already captured. This path
    // used to return 500 with no refund — explicit 500 is NOT an exception,
    // so the handler-level catch never fired. Refund inline, then return
    // 200 with a structured payload the frontend already knows how to render.
    dlog('design-validation-refund-start', { paypalOrderId, errorCount: fileErrors.length });
    const refundResult = await refundOrder({
      paypalOrderId,
      reason: `design_file_invalid_${(fileErrors[0] || 'unknown').slice(0, 60).replace(/\s+/g, '_')}`,
    });
    dlog('design-validation-refund-done', {
      paypalOrderId,
      refunded: refundResult.refunded,
      refundId: refundResult.refundId || null,
      refundReason: refundResult.reason || null,
    });

    return res.status(200).json({
      success:     true,
      manual:      !refundResult.refunded,
      refunded:    !!refundResult.refunded,
      refundId:    refundResult.refundId || null,
      reason:      refundResult.refunded ? 'design_invalid_refunded' : 'design_invalid_no_refund',
      gelatoError: `Design file validation failed: ${fileErrors[0] || 'unknown'}`.slice(0, 220),
      details:     fileErrors,
    });
  }

  // 2026-05-21: MULTI-WAREHOUSE SPLITTING.
  // Before submitting a single Gelato order, probe whether the cart needs
  // splitting across warehouses. If subCarts.length === 1, this is a free
  // dry-run (the existing single-warehouse path handles it). If > 1, we
  // route to the multi-order dispatcher and return early.
  try {
    const splitEntries = cartItems.map(item => {
      const uid = buildProductUid(item.type, item.selectedColor, item.selectedSize, item.gender);
      const files = getDesignFiles(item.id, item.selectedColor, item.designRef, item.type);
      const fileUrl = (files[0] && files[0].url) || `${DESIGN_BASE_URL}/front_logo_white.png`;
      return uid ? { uid, item, fileUrl } : null;
    }).filter(Boolean);

    const splitRecipient = {
      firstName, lastName,
      email:        buyerEmail || '',
      phone:        shippingAddress.phone || '',
      addressLine1: shippingAddress.address_line_1,
      city:         shippingAddress.admin_area_2,
      state:        shippingAddress.admin_area_1 || '',
      postalCode:   normalizePostCode(shippingAddress.postal_code, shippingAddress.country_code),
      country:      shippingAddress.country_code,
    };

    const splitProbeT0 = Date.now();
    const splitResult = await splitCartByWarehouse({
      entries: splitEntries,
      recipient: splitRecipient,
      gelatoApiKey: GELATO_API_KEY,
    });
    dlog('split-probe-done', {
      paypalOrderId,
      durationMs: Date.now() - splitProbeT0,
      splittable: splitResult.splittable,
      subCartCount: splitResult.subCarts.length,
      warehouses: splitResult.subCarts.map(sc => sc.country),
      unfulfillable: splitResult.unfulfillable.length,
      reason: splitResult.reason,
    });

    if (splitResult.splittable && splitResult.subCarts.length > 1) {
      // Multi-warehouse cart — route to dispatcher and return early.
      return await dispatchMultiOrderSplit({
        res, req,
        paypalOrderId, buyerEmail, shippingAddress, cartItems,
        splitResult, firstName, lastName, GELATO_API_KEY, t0,
      });
    }
    if (!splitResult.splittable && splitResult.unfulfillable.length > 0) {
      // Truly unfulfillable — refund and return. (The pre-capture probe in
      // paypal.js *should* have caught this, but defense in depth.)
      derr('split-unfulfillable', {
        paypalOrderId,
        unfulfillable: splitResult.unfulfillable.map(e => e.uid),
      });
      const refundResult = await refundOrder({ paypalOrderId, reason: 'cart_unfulfillable_at_dispatch' });
      return res.status(200).json({
        success:  true,
        manual:   !refundResult.refunded,
        refunded: !!refundResult.refunded,
        refundId: refundResult.refundId || null,
        reason:   refundResult.refunded ? 'cart_unfulfillable_refunded' : 'cart_unfulfillable_no_refund',
        gelatoError: 'No Gelato warehouse can produce all items in this cart for the shipping country.',
      });
    }
    // splittable && subCarts.length === 1 → existing single-warehouse path
    // (continue past this block — gelatoOrder construction below handles it).
  } catch (splitErr) {
    // Splitter failure → fall through to the existing single-warehouse path.
    // It has its own quote/error handling, so worst case we get the previous
    // (pre-2026-05-21) behavior.
    derr('split-probe-exception', { paypalOrderId, message: splitErr.message });
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
      // Phone — DHL/USPS need it for delivery exception calls. Was
      // missing pre-2026-05-20; orders without contact numbers got
      // bounced when couriers couldn't reach the recipient.
      phone:        shippingAddress.phone || '',
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

    // 2026-05-20 (Hila round 3): Gelato may return HTTP 200 with a body that
    // says financialStatus='canceled' + refusalReasonCode='stock' — the order
    // was accepted into their system then immediately refused at warehouse-
    // stock level. Treating this as success captures customer money with no
    // fulfillment. Detect explicit failure in the response body even on 2xx.
    const bodyCanceled = data && (
      data.financialStatus === 'canceled' ||
      data.financialStatus === 'cancelled' ||
      data.fulfillmentStatus === 'failed' ||
      !!data.refusalReasonCode
    );

    dlog('gelato-response', {
      paypalOrderId,
      httpStatus: gRes.status,
      ok: gRes.ok,
      bodyCanceled,
      financialStatus: data ? data.financialStatus : null,
      fulfillmentStatus: data ? data.fulfillmentStatus : null,
      refusalReasonCode: data ? data.refusalReasonCode : null,
      refusalReason:     data ? (data.refusalReason || '').slice(0, 200) : null,
      gelatoDurationMs: gelatoDuration,
      responseId: data && (data.id || data.orderId || data.orderReferenceId) || null,
      responseKeys: data ? Object.keys(data).slice(0, 20) : [],
    });

    if (!gRes.ok || bodyCanceled) {
      derr('gelato-api-error', {
        paypalOrderId,
        httpStatus: gRes.status,
        bodyCanceled,
        refusalReasonCode: data ? data.refusalReasonCode : null,
        errorData: data,
        productUids: gelatoOrder.items.map(i => i.productUid),
      });
      logManualOrder('GELATO API ERROR', { paypalOrderId, error: data, gelatoOrder });

      // ── AUTO-REFUND — Gelato won't fulfill, customer's money must go back ──
      // Triggers on: out-of-stock (400/422 OR 200+canceled), invalid product, any 4xx/5xx.
      // 2026-05-20 round 3: Gelato refuses by stock with HTTP 200 +
      // financialStatus='canceled' + refusalReasonCode='stock'. The bodyCanceled
      // check above catches this case.
      const refusalCode = data && data.refusalReasonCode;
      const errMsg = (data && (data.refusalReason || data.message || data.error || JSON.stringify(data))) || '';
      dlog('auto-refund-start', { paypalOrderId, gelatoHttpStatus: gRes.status, bodyCanceled, refusalCode, reason: errMsg.slice(0, 120) });
      const refundResult = await refundOrder({
        paypalOrderId,
        reason: bodyCanceled
          ? `gelato_canceled_${refusalCode || 'unknown'}`
          : `gelato_${gRes.status}_${(errMsg.match(/out of stock/i) ? 'out_of_stock' : 'api_error')}`,
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
    dlog('gelato-success-immediate', {
      paypalOrderId,
      gelatoOrderId,
      financialStatus: data.financialStatus,
      fulfillmentStatus: data.fulfillmentStatus,
    });

    // 2026-05-20 ROUND 5/6 race-condition fix: Gelato sometimes returns 200
    // with financialStatus='open' immediately, then async-validates stock
    // within 1-3 seconds and flips to 'canceled' BEFORE producing anything.
    // We saw this on Hila's 5th capture (DUBIS-81B553059Y6480844): probe
    // ok → POST 200 with open → 2 sec later Gelato refused for stock.
    // Without webhook (which is still 401, see follow-up) the customer
    // gets no refund. Solution: poll the order state for up to 4 sec
    // BEFORE returning success. If it flips canceled in that window,
    // refund inline.
    let finalFinancialStatus = data.financialStatus || 'open';
    let finalRefusalCode = null;
    let finalRefusalReason = null;
    if (gelatoOrderId && /^(open|pending|created|passed_to_production)$/i.test(finalFinancialStatus)) {
      const verifyT0 = Date.now();
      const RACE_WINDOW_MS = 4000;
      const POLL_INTERVAL_MS = 1500;
      let polls = 0;
      while (Date.now() - verifyT0 < RACE_WINDOW_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        polls++;
        try {
          const vRes = await fetch(`${GELATO_API_BASE}/v4/orders/${gelatoOrderId}`, {
            headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' },
          });
          if (vRes.ok) {
            const vData = await vRes.json().catch(() => null);
            if (vData) {
              finalFinancialStatus = vData.financialStatus || finalFinancialStatus;
              finalRefusalCode    = vData.refusalReasonCode || null;
              finalRefusalReason  = vData.refusalReason   || null;
              dlog('gelato-verify-poll', {
                paypalOrderId, gelatoOrderId, poll: polls,
                financialStatus: finalFinancialStatus,
                fulfillmentStatus: vData.fulfillmentStatus,
                refusalCode: finalRefusalCode,
              });
              if (/^(canceled|cancelled)$/i.test(finalFinancialStatus)) break;
              if (/^(passed_to_production|printed|shipped|delivered)$/i.test(finalFinancialStatus)) break;
            }
          }
        } catch (vErr) {
          dlog('gelato-verify-error', { paypalOrderId, gelatoOrderId, msg: vErr.message });
        }
      }
      dlog('gelato-verify-done', {
        paypalOrderId, gelatoOrderId,
        polls,
        durationMs: Date.now() - verifyT0,
        finalFinancialStatus,
        finalRefusalCode,
      });

      // If verification revealed an async cancellation → auto-refund.
      if (/^(canceled|cancelled)$/i.test(finalFinancialStatus)) {
        derr('gelato-async-canceled', {
          paypalOrderId, gelatoOrderId,
          refusalCode: finalRefusalCode,
          refusalReason: (finalRefusalReason || '').slice(0, 200),
        });
        const refundResult = await refundOrder({
          paypalOrderId,
          reason: `gelato_async_canceled_${finalRefusalCode || 'unknown'}`,
        });
        dlog('gelato-async-refund-done', {
          paypalOrderId,
          refunded: refundResult.refunded,
          refundId: refundResult.refundId || null,
        });
        return res.status(200).json({
          success:  true,
          manual:   !refundResult.refunded,
          refunded: !!refundResult.refunded,
          refundId: refundResult.refundId || null,
          reason:   refundResult.refunded ? 'gelato_rejected_refunded' : 'gelato_async_cancel_no_refund',
          gelatoError: `Gelato canceled order after async stock check: ${(finalRefusalReason || finalRefusalCode || 'unknown').slice(0, 200)}`,
          gelatoOrderId,
        });
      }
    }

    dlog('gelato-success', {
      paypalOrderId,
      gelatoOrderId,
      finalFinancialStatus,
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

  } catch (handlerErr) {
    // 2026-05-20 safety net. We landed here because something between
    // request-received and the Gelato try/catch threw uncaught. PayPal has
    // already captured the money (this handler is invoked from onApprove,
    // which awaits actions.order.capture() before the fetch). The contract
    // is: refund first, persist a recovery row, alert oren, return 200 with
    // a structured payload the frontend can render.
    const paypalOrderId = (req.body && req.body.paypalOrderId) || null;
    const buyerEmail    = (req.body && req.body.buyerEmail)    || null;
    const cartItems     = (req.body && req.body.cartItems)     || [];
    const shippingAddress = (req.body && req.body.shippingAddress) || null;
    derr('handler-exception', {
      paypalOrderId,
      errorMessage: handlerErr && handlerErr.message,
      errorName:    handlerErr && handlerErr.name,
      errorStack:   ((handlerErr && handlerErr.stack) || '').split('\n').slice(0, 8).join(' | '),
      durationMs:   Date.now() - t0,
    });
    logManualOrder('HANDLER EXCEPTION', {
      paypalOrderId,
      buyerEmail,
      error: handlerErr && handlerErr.message,
      stack: handlerErr && handlerErr.stack,
      cartItems,
      shippingAddress,
    });

    // ── 1. Refund the PayPal capture ──
    let refundResult = { refunded: false, reason: 'no_paypal_order_id' };
    if (paypalOrderId) {
      try {
        refundResult = await refundOrder({ paypalOrderId, reason: 'handler_exception' });
        dlog('handler-exception-refund-done', {
          paypalOrderId,
          refunded: refundResult.refunded,
          refundId: refundResult.refundId || null,
          refundReason: refundResult.reason || null,
        });
      } catch (refundErr) {
        derr('handler-exception-refund-failed', {
          paypalOrderId,
          message: refundErr && refundErr.message,
        });
        refundResult = { refunded: false, reason: 'refund_exception', details: refundErr && refundErr.message };
      }
    }

    // ── 2. Best-effort recovery row in orders table ──
    if (paypalOrderId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const sb = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const itemsTotal = (cartItems || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
        await sb.from('orders').insert({
          paypal_order_id: paypalOrderId,
          buyer_email:     buyerEmail,
          items:           cartItems,
          total_amount:    itemsTotal,
          status:          refundResult.refunded ? 'refunded' : 'pending',
          refund_id:       refundResult.refundId || null,
          refunded_at:     refundResult.refunded ? new Date().toISOString() : null,
          refund_reason:   refundResult.refunded ? 'handler_exception' : null,
        });
        dlog('handler-exception-recovery-row-saved', { paypalOrderId });
      } catch (dbErr) {
        derr('handler-exception-recovery-row-failed', {
          paypalOrderId,
          message: dbErr && dbErr.message,
        });
      }
    }

    // ── 3. Best-effort admin alert via Resend ──
    if (process.env.RESEND_API_KEY) {
      try {
        const subj = `🚨 DUBIS handler exception — ${refundResult.refunded ? 'refunded' : 'REFUND FAILED'} (${String(paypalOrderId || 'no-id').slice(0, 16)})`;
        await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    'DUBIS Alerts <orders@dubis.net>',
            to:      ['dubis.brand@gmail.com'],
            subject: subj,
            html: `
              <h2>create-gelato-order threw uncaught</h2>
              <p><strong>PayPal order:</strong> ${paypalOrderId || '(missing)'}</p>
              <p><strong>Buyer:</strong> ${buyerEmail || '(missing)'}</p>
              <p><strong>Refund:</strong> ${refundResult.refunded ? `✅ ${refundResult.refundId || ''}` : `❌ ${refundResult.reason || 'unknown'}`}</p>
              <p><strong>Error:</strong> <code>${(handlerErr && handlerErr.message) || 'unknown'}</code></p>
              <pre style="background:#f4f4f4;padding:12px;font-size:11px;line-height:1.5;overflow:auto">${((handlerErr && handlerErr.stack) || '').slice(0, 4000)}</pre>
              <p>Items: <code>${JSON.stringify(cartItems).slice(0, 600)}</code></p>
            `,
          }),
        });
        dlog('handler-exception-admin-alert-sent', { paypalOrderId });
      } catch (mailErr) {
        derr('handler-exception-admin-alert-failed', {
          paypalOrderId,
          message: mailErr && mailErr.message,
        });
      }
    }

    // ── 4. Always 200 with structured refund payload — frontend renders refund modal ──
    return res.status(200).json({
      success:      true,
      manual:       !refundResult.refunded,
      refunded:     !!refundResult.refunded,
      refundId:     refundResult.refundId || null,
      reason:       refundResult.refunded ? 'handler_exception_refunded' : 'handler_exception_no_refund',
      gelatoError:  `Order handler crashed: ${(handlerErr && handlerErr.message) || 'unknown'}`.slice(0, 200),
    });
  }
};
