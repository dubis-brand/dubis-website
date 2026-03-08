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
// VARIANT MAP — keyed by product ID (1–6), then 'Color_Size'
// sync_variant_ids retrieved from Printful API after product creation
// Color names match display names in products.js
// ─────────────────────────────────────────────────────────────────
const VARIANT_MAP = {
  // Product 1: "I'm not fat, I'm a limited edition" — T-Shirt (Black, White, Cream)
  1: {
    'Black_S':5225828142,'Black_M':5225828143,'Black_L':5225828144,'Black_XL':5225828145,'Black_2XL':5225828146,'Black_3XL':5225828147,
    'White_S':5225828148,'White_M':5225828149,'White_L':5225828150,'White_XL':5225828151,'White_2XL':5225828152,'White_3XL':5225828153,
    'Cream_S':5225828154,'Cream_M':5225828155,'Cream_L':5225828156,'Cream_XL':5225828157,'Cream_2XL':5225828158,'Cream_3XL':5225828159,
  },
  // Product 2: "More of me to love" — T-Shirt (Honey Brown, Black, Cream)
  2: {
    'Honey Brown_S':5225828161,'Honey Brown_M':5225828162,'Honey Brown_L':5225828163,'Honey Brown_XL':5225828164,'Honey Brown_2XL':5225828165,'Honey Brown_3XL':5225828166,
    'Black_S':5225828167,'Black_M':5225828168,'Black_L':5225828169,'Black_XL':5225828170,'Black_2XL':5225828171,'Black_3XL':5225828172,
    'Cream_S':5225828173,'Cream_M':5225828174,'Cream_L':5225828175,'Cream_XL':5225828176,'Cream_2XL':5225828177,'Cream_3XL':5225828178,
  },
  // Product 3: "Napping is my cardio" — Hoodie (Charcoal, Cream, Navy)
  3: {
    'Charcoal_S':5225828262,'Charcoal_M':5225828265,'Charcoal_L':5225828267,'Charcoal_XL':5225828270,'Charcoal_2XL':5225828272,'Charcoal_3XL':5225828275,
    'Cream_S':5225828278,'Cream_M':5225828282,'Cream_L':5225828285,'Cream_XL':5225828287,'Cream_2XL':5225828290,'Cream_3XL':5225828292,
    'Navy_S':5225828295,'Navy_M':5225828297,'Navy_L':5225828300,'Navy_XL':5225828306,'Navy_2XL':5225828314,'Navy_3XL':5225828320,
  },
  // Product 4: "I survived. That's enough." — T-Shirt (Black, White, Gray) — Gray missing 3XL
  4: {
    'Black_S':5225828420,'Black_M':5225828423,'Black_L':5225828427,'Black_XL':5225828430,'Black_2XL':5225828433,'Black_3XL':5225828437,
    'White_S':5225828441,'White_M':5225828444,'White_L':5225828447,'White_XL':5225828450,'White_2XL':5225828453,'White_3XL':5225828454,
    'Gray_S':5225828455,'Gray_M':5225828456,'Gray_L':5225828457,'Gray_XL':5225828458,'Gray_2XL':5225828459,
  },
  // Product 5: "Low maintenance, high value" — T-Shirt (Black, White, Cream)
  5: {
    'Black_S':5225827918,'Black_M':5225827921,'Black_L':5225827922,'Black_XL':5225827923,'Black_2XL':5225827924,'Black_3XL':5225827925,
    'White_S':5225827926,'White_M':5225827927,'White_L':5225827928,'White_XL':5225827930,'White_2XL':5225827937,'White_3XL':5225827943,
    'Cream_S':5225827950,'Cream_M':5225827957,'Cream_L':5225827965,'Cream_XL':5225827971,'Cream_2XL':5225827977,'Cream_3XL':5225827984,
  },
  // Product 6: "Not a model. Never wanted to be." — Hoodie (Charcoal, Black, Navy)
  6: {
    'Charcoal_S':5225829238,'Charcoal_M':5225829239,'Charcoal_L':5225829240,'Charcoal_XL':5225829241,'Charcoal_2XL':5225829242,'Charcoal_3XL':5225829243,
    'Black_S':5225829244,'Black_M':5225829245,'Black_L':5225829246,'Black_XL':5225829247,'Black_2XL':5225829248,'Black_3XL':5225829249,
    'Navy_S':5225829250,'Navy_M':5225829251,'Navy_L':5225829252,'Navy_XL':5225829253,'Navy_2XL':5225829254,'Navy_3XL':5225829255,
  },
  // Product 7: Cap — TODO: add after cap is created in Printful
  // 7: { 'Charcoal_One Size': null, 'Cream_One Size': null, 'Honey Brown_One Size': null },
};

function getVariantId(productId, color, size) {
  const map = VARIANT_MAP[productId];
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
    item => !getVariantId(item.id, item.selectedColor, item.selectedSize)
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
      sync_variant_id: getVariantId(item.id, item.selectedColor, item.selectedSize),
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
