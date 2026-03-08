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

// ─────────────────────────────────────────────────────────────────
// COLOR MAP — DUBIS display name → Gelato color code
// Verified against Gelato catalog API (March 2026)
// T-shirt: black, white, natural, charcoal, navy, sports-grey, sand
// Hoodie:  black, navy, white, dark-heather (charcoal alt), sand (cream alt)
// ─────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  tshirt: {
    'Black':       'black',
    'White':       'white',
    'Cream':       'natural',
    'Honey Brown': 'sand',
    'Charcoal':    'charcoal',
    'Navy':        'navy',
    'Gray':        'sports-grey',
  },
  hoodie: {
    'Black':       'black',
    'White':       'white',
    'Cream':       'sand',
    'Honey Brown': 'sand',
    'Charcoal':    'dark-heather',
    'Navy':        'navy',
    'Gray':        'sports-grey',
  },
  cap: {
    'Black':       'black',
    'White':       'white',
    'Cream':       'natural',
    'Honey Brown': 'sand',
    'Charcoal':    'dark-heather',
    'Navy':        'navy',
    'Gray':        'sports-grey',
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
const DARK_COLORS = new Set(['Black', 'Charcoal', 'Navy']);

// ─────────────────────────────────────────────────────────────────
// Build Gelato productUid from item type, color, size
// ─────────────────────────────────────────────────────────────────
function buildProductUid(type, gelatoColor, gelatoSize) {
  if (type === 'tshirt') {
    return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'hoodie') {
    return `apparel_product_gca_hoodie_gsc_pullover_gcu_unisex_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'cap') {
    return `apparel_product_gca_dad-hat_gsc_classic_gcu_unisex_gqa_classic_gsi_os_gco_${gelatoColor}_gpr_4-0`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Select design file URLs for an item
// dark garment → white ink design; light garment → dark ink design
// ─────────────────────────────────────────────────────────────────
function getDesignFiles(productId, color) {
  const variant = DARK_COLORS.has(color) ? 'white' : 'dark';
  return [
    { type: 'back',  url: `${DESIGN_BASE_URL}/back_design_${productId}_${variant}.png` },
    { type: 'front', url: `${DESIGN_BASE_URL}/front_logo_${variant}.png` },
  ];
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
// FALLBACK LOGGER
// ─────────────────────────────────────────────────────────────────
function logManualOrder(label, payload) {
  console.log(`\n====== DUBIS MANUAL ORDER — ${label} ======`);
  console.log(JSON.stringify(payload, null, 2));
  console.log('=============================================\n');
}

// ─────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cartItems, shippingAddress, paypalOrderId, buyerEmail } = req.body;

  if (!cartItems || !shippingAddress || !paypalOrderId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ── Case 1: Gelato not configured yet ──
  const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
  if (!GELATO_API_KEY) {
    logManualOrder('NO API KEY', { paypalOrderId, buyerEmail, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'gelato_not_configured' });
  }

  // ── Case 2: Validate all items can be mapped ──
  const unmapped = cartItems.filter(item => {
    const colorMap    = COLOR_MAP[item.type] || COLOR_MAP.tshirt;
    const gelatoColor = colorMap[item.selectedColor];
    const gelatoSize  = SIZE_MAP[item.selectedSize];
    const productUid  = gelatoColor && gelatoSize
      ? buildProductUid(item.type, gelatoColor, gelatoSize)
      : null;
    return !productUid;
  });

  if (unmapped.length > 0) {
    logManualOrder('UNMAPPED ITEMS', { paypalOrderId, buyerEmail, unmapped, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'items_not_mapped', unmapped });
  }

  // ── Case 3: Full Gelato order ──
  const { firstName, lastName } = parseName(shippingAddress.name);

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
        productUid:      buildProductUid(item.type, gelatoColor, gelatoSize),
        files:           getDesignFiles(item.id, item.selectedColor),
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
      postCode:     shippingAddress.postal_code,
    },
  };

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
      logManualOrder('GELATO API ERROR', { paypalOrderId, error: data, gelatoOrder });
      // Payment already captured — return success to customer, handle manually
      return res.status(200).json({ success: true, manual: true, reason: 'gelato_api_error', _debug: data });
    }

    const gelatoOrderId = data.id || data.orderId || data.orderReferenceId;
    console.log(`Gelato order created: ${gelatoOrderId} for PayPal ${paypalOrderId}`);
    return res.status(200).json({
      success:        true,
      manual:         false,
      gelatoOrderId:  gelatoOrderId,
      printfulOrderId: gelatoOrderId, // alias for save.js compatibility
    });

  } catch (err) {
    logManualOrder('NETWORK ERROR', { paypalOrderId, error: err.message, gelatoOrder });
    return res.status(200).json({ success: true, manual: true, reason: 'network_error' });
  }
};
