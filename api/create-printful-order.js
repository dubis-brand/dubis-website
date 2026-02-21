// DUBIS - Printful Order Creation
// Vercel Serverless Function — called after PayPal payment capture
// =================================================================
// SETUP GUIDE:
//   1. Create account at printful.com
//   2. Add your store → get PRINTFUL_API_KEY from Dashboard > Stores > API
//   3. Create products (upload DUBIS designs)
//   4. Fill in VARIANT_MAP below with the sync_variant_ids from Printful
//   5. Add env vars to Vercel: PRINTFUL_API_KEY, PRINTFUL_STORE_ID
// =================================================================

const PRINTFUL_API_BASE = 'https://api.printful.com';

// ─────────────────────────────────────────────────────────────────
// VARIANT MAP — fill in after creating products on Printful
// How to find variant IDs:
//   Printful Dashboard → Stores → Your Products → click product
//   → "Edit" → variants tab → each row has an ID
//
// Format: { 'Color_Size': sync_variant_id }
// ─────────────────────────────────────────────────────────────────
const VARIANT_MAP = {
  tshirt: {
    'Black_S':   null, 'Black_M':   null, 'Black_L':   null,
    'Black_XL':  null, 'Black_2XL': null, 'Black_3XL': null,
    'White_S':   null, 'White_M':   null, 'White_L':   null,
    'White_XL':  null, 'White_2XL': null, 'White_3XL': null,
    'Cream_S':   null, 'Cream_M':   null, 'Cream_L':   null,
    'Cream_XL':  null, 'Cream_2XL': null, 'Cream_3XL': null,
    'Gray_S':    null, 'Gray_M':    null, 'Gray_L':    null,
    'Gray_XL':   null, 'Gray_2XL':  null, 'Gray_3XL':  null,
    'Honey Brown_S': null, 'Honey Brown_M': null, 'Honey Brown_L': null,
    'Honey Brown_XL': null, 'Honey Brown_2XL': null, 'Honey Brown_3XL': null,
  },
  hoodie: {
    'Charcoal_S': null, 'Charcoal_M': null, 'Charcoal_L': null,
    'Charcoal_XL': null, 'Charcoal_2XL': null, 'Charcoal_3XL': null,
    'Cream_S': null, 'Cream_M': null, 'Cream_L': null,
    'Cream_XL': null, 'Cream_2XL': null, 'Cream_3XL': null,
    'Navy_S': null, 'Navy_M': null, 'Navy_L': null,
    'Navy_XL': null, 'Navy_2XL': null, 'Navy_3XL': null,
    'Black_S': null, 'Black_M': null, 'Black_L': null,
    'Black_XL': null, 'Black_2XL': null, 'Black_3XL': null,
  },
  cap: {
    'Charcoal_One Size': null,
    'Cream_One Size':    null,
    'Honey Brown_One Size': null,
  }
};

function getVariantId(type, color, size) {
  const map = VARIANT_MAP[type];
  if (!map) return null;
  return map[`${color}_${size}`] || null;
}

// ─────────────────────────────────────────────────────────────────
// MANUAL ORDER FALLBACK
// Until Printful is fully set up, every order is logged here.
// Vercel logs are visible at: vercel.com → your project → Logs tab
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

  // ── Case 1: Printful not configured yet ──
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
  if (!PRINTFUL_API_KEY) {
    logManualOrder('NO API KEY', { paypalOrderId, buyerEmail, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'printful_not_configured' });
  }

  // ── Case 2: Some variants not mapped yet ──
  const unmapped = cartItems.filter(
    item => !getVariantId(item.type, item.selectedColor, item.selectedSize)
  );
  if (unmapped.length > 0) {
    logManualOrder('UNMAPPED VARIANTS', { paypalOrderId, buyerEmail, unmapped, cartItems, shippingAddress });
    return res.status(200).json({ success: true, manual: true, reason: 'variants_not_mapped', unmapped });
  }

  // ── Case 3: Full Printful order ──
  const printfulOrder = {
    external_id: `DUBIS-${paypalOrderId}`,
    shipping:    'STANDARD',
    recipient: {
      name:         shippingAddress.name,
      email:        buyerEmail || '',
      address1:     shippingAddress.address_line_1,
      address2:     shippingAddress.address_line_2 || '',
      city:         shippingAddress.admin_area_2,
      state_code:   shippingAddress.admin_area_1,
      country_code: shippingAddress.country_code,
      zip:          shippingAddress.postal_code,
    },
    items: cartItems.map(item => ({
      sync_variant_id: getVariantId(item.type, item.selectedColor, item.selectedSize),
      quantity:        1,
      retail_price:    item.price.toFixed(2),
      name:            `DUBIS "${item.phrase}" — ${item.typeLabel}`,
    })),
  };

  try {
    const pfRes = await fetch(`${PRINTFUL_API_BASE}/orders`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
        'Content-Type':  'application/json',
        ...(process.env.PRINTFUL_STORE_ID
          ? { 'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID }
          : {}),
      },
      body: JSON.stringify(printfulOrder),
    });

    const data = await pfRes.json();

    if (!pfRes.ok) {
      logManualOrder('PRINTFUL API ERROR', { paypalOrderId, error: data, printfulOrder });
      // Payment already captured — return success to customer, handle manually
      return res.status(200).json({ success: true, manual: true, reason: 'printful_api_error' });
    }

    console.log(`Printful order created: #${data.result.id} for PayPal ${paypalOrderId}`);
    return res.status(200).json({
      success: true,
      manual:  false,
      printfulOrderId: data.result.id,
    });

  } catch (err) {
    logManualOrder('NETWORK ERROR', { paypalOrderId, error: err.message, printfulOrder });
    return res.status(200).json({ success: true, manual: true, reason: 'network_error' });
  }
};
