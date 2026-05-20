// DUBIS — Save order to Supabase after PayPal capture
// Vercel Serverless Function  POST /api/orders/save
// =======================================================

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

// ── Defense-in-depth address smoke-test ────────────────────────────
// The primary validation lives in create-gelato-order.js; this is a
// smaller, conservative check that runs at the DB-write boundary. Goal:
// if the upstream gate is bypassed or silently fails (network blip,
// future refactor, malicious client), we still flag the order as
// pending_address_confirmation instead of letting Gelato/admin tooling
// treat it as a normal "pending" order.
//
// We DON'T duplicate the full validation here — just look for the
// catastrophic cases: missing required fields, Hebrew script in any
// address line (DHL/USPS label can't render U+0590..U+05FF). That's
// the surface area that produced real undeliverable packages in May 2026.
const _HEBREW_RE = /[֐-׿]/;
function _addressLooksUnshippable(addr) {
    if (!addr || typeof addr !== 'object') return true;
    const trim = (v) => (v == null ? '' : String(v).trim());
    const a1   = trim(addr.address_line_1);
    const city = trim(addr.admin_area_2);
    const zip  = trim(addr.postal_code);
    const ctry = trim(addr.country_code).toUpperCase();
    if (a1.length   < 3) return true;
    if (city.length < 2) return true;
    if (zip.length  < 3) return true;
    if (!/^[A-Z]{2}$/.test(ctry)) return true;
    // Hebrew in any of the printable address lines breaks the shipping label.
    if (_HEBREW_RE.test(a1)) return true;
    if (_HEBREW_RE.test(city)) return true;
    if (_HEBREW_RE.test(trim(addr.address_line_2))) return true;
    if (_HEBREW_RE.test(trim(addr.admin_area_1)))   return true;
    return false;
}

// Structured logger — single-line JSON for Vercel runtime-log grep
function olog(stage, data = {}) {
    try { console.log(`[DUBIS-ORDER] ${stage} ${JSON.stringify(data)}`); }
    catch (_) { console.log(`[DUBIS-ORDER] ${stage} <unserializable>`); }
}
function oerr(stage, data = {}) {
    try { console.error(`[DUBIS-ORDER] ERROR ${stage} ${JSON.stringify(data)}`); }
    catch (_) { console.error(`[DUBIS-ORDER] ERROR ${stage} <unserializable>`); }
}

module.exports = async function handler(req, res) {
    const t0 = Date.now();
    olog('request-received', { method: req.method, hasBody: !!req.body });

    if (req.method !== 'POST') {
        oerr('method-not-allowed', { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limit: 10 order saves per IP per minute
    if (rateLimit(req, res, { max: 10, windowMs: 60_000 })) {
        oerr('rate-limited', { ip: req.headers['x-forwarded-for'] || '' });
        return;
    }

    const {
        paypalOrderId,
        buyerEmail,
        shippingAddress,
        cartItems,
        printfulOrderId,
        couponCode,
        discountAmount,
        shippingAmount,   // NEW — from client, so DB total reflects reality
        totalAmount:      clientTotalAmount,  // NEW — client-computed grand total
        attribution,      // 2026-05-06 — { utm_source, utm_medium, utm_campaign, utm_content, utm_term, attribution_session_id, landing_path, landing_referrer, first_touch_at }
        pendingAddressConfirmation, // 2026-05-20 — create-gelato-order detected missing address fields; hold the order
    } = req.body || {};

    if (!paypalOrderId || !cartItems || !shippingAddress) {
        oerr('missing-required-fields', {
            hasPaypal: !!paypalOrderId,
            hasCart: !!cartItems,
            hasShipping: !!shippingAddress,
        });
        return res.status(400).json({ error: 'Missing required fields' });
    }

    olog('order-input', {
        paypalOrderId,
        buyerEmailDomain: (buyerEmail || '').split('@')[1] || '',
        itemsCount: cartItems.length,
        hasGelatoId: !!printfulOrderId,
        gelatoOrderId: printfulOrderId || null,
        shippingCountry: shippingAddress.country_code,
        couponCode: couponCode || null,
    });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        oerr('supabase-not-configured', {
            hasUrl: !!process.env.SUPABASE_URL,
            hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        });
        console.error('Supabase env vars not set');
        return res.status(200).json({ success: false, reason: 'supabase_not_configured' });
    }

    // Service role bypasses RLS — safe for server-side inserts
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Resolve user from JWT if present
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) userId = user.id;
    }

    // ── Server-side price validation — reads live prices from Supabase product_prices table ──
    // Falls back to hardcoded floor prices to prevent $0 fraud
    const PRICE_FLOOR = { tshirt: 10, hoodie: 20, ziphoodie: 25, longsleeve: 15, cap: 10 };
    let priceOverrides = {};
    try {
        const { data: priceRows } = await supabase.from('product_prices').select('product_id, selling_price');
        priceOverrides = Object.fromEntries((priceRows || []).map(r => [Number(r.product_id), Number(r.selling_price)]));
    } catch (err) {
        console.warn('Could not load product_prices from Supabase:', err.message);
    }

    for (const item of cartItems) {
        const floor = PRICE_FLOOR[item.type];
        if (floor === undefined) {
            return res.status(400).json({ error: `Unknown product type: ${item.type}` });
        }
        const sentPrice = Number(item.price) || 0;
        // Check against Supabase price if available
        const supabasePrice = item.id ? priceOverrides[Number(item.id)] : null;
        if (supabasePrice != null && Math.abs(sentPrice - supabasePrice) > 0.01) {
            console.warn(`Price mismatch: id=${item.id} type=${item.type} sent=${sentPrice} expected=${supabasePrice}`);
            return res.status(400).json({ error: 'Price mismatch — please refresh and try again' });
        }
        // Always enforce floor price to prevent $0 fraud
        if (sentPrice < floor) {
            console.warn(`Price below floor: type=${item.type} sent=${sentPrice} floor=${floor}`);
            return res.status(400).json({ error: 'Invalid price — please refresh and try again' });
        }
    }

    // Items subtotal (what the customer paid before shipping & discount)
    const itemsSubtotal = (cartItems || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const shippingNum   = Number(shippingAmount) || 0;
    const discountNum   = Number(discountAmount) || 0;

    // Grand total — client sends it, but we validate against computed amount
    // so a malicious client can't silently store a fake total in DB.
    const computedTotal = Math.max(0, itemsSubtotal + shippingNum - discountNum);
    const clientTotal   = Number(clientTotalAmount);
    const totalAmount   = (Number.isFinite(clientTotal) && Math.abs(clientTotal - computedTotal) < 0.02)
        ? clientTotal
        : computedTotal;

    if (Number.isFinite(clientTotal) && Math.abs(clientTotal - computedTotal) >= 0.02) {
        oerr('total-mismatch', {
            paypalOrderId,
            clientTotal,
            computedTotal,
            itemsSubtotal,
            shippingNum,
            discountNum,
        });
    }

    // 2026-05-20: held orders with incomplete or Hebrew address get a
    // distinct status so admin tooling + Gelato sync skips them. Two
    // independent triggers — explicit flag from create-gelato-order, OR
    // a local smoke test (defense-in-depth) that catches the same red
    // flags. Either route wins.
    const localSmokeUnshippable = _addressLooksUnshippable(shippingAddress);
    const holdForAddress = pendingAddressConfirmation === true || localSmokeUnshippable;
    if (localSmokeUnshippable && pendingAddressConfirmation !== true) {
        oerr('address-smoke-flagged', {
            paypalOrderId,
            note: 'pendingAddressConfirmation flag was NOT set but address looks unshippable — forcing hold',
        });
    }

    const insertData = {
        user_id:           userId,
        paypal_order_id:   paypalOrderId,
        // Never auto-link a Gelato order id when we're holding for address —
        // create-gelato-order shouldn't have produced one anyway, but if a
        // future refactor changes that, we don't want to label a held order
        // as fulfilled.
        printful_order_id: holdForAddress ? null : (printfulOrderId || null),
        status:            holdForAddress ? 'pending_address_confirmation' : 'pending',
        buyer_email:       buyerEmail || '',
        shipping_address:  shippingAddress,
        items:             cartItems,
        total_amount:      totalAmount,
        currency:          'USD'
    };
    if (couponCode) insertData.coupon_code = String(couponCode).toUpperCase();
    if (discountNum) insertData.discount_amount = discountNum;
    if (shippingNum) insertData.shipping_amount = shippingNum;
    insertData.items_subtotal = itemsSubtotal;

    // ── Attribution (2026-05-06) — write only when client supplied non-null values
    // so we never overwrite DB-default NULLs with explicit nulls. (direct) is a
    // legitimate value meaning "no UTM" and is preserved.
    if (attribution && typeof attribution === 'object') {
        if (attribution.utm_source)             insertData.utm_source              = String(attribution.utm_source).slice(0, 80);
        if (attribution.utm_medium)             insertData.utm_medium              = String(attribution.utm_medium).slice(0, 80);
        if (attribution.utm_campaign)           insertData.utm_campaign            = String(attribution.utm_campaign).slice(0, 120);
        if (attribution.utm_content)            insertData.utm_content             = String(attribution.utm_content).slice(0, 120);
        if (attribution.utm_term)               insertData.utm_term                = String(attribution.utm_term).slice(0, 120);
        if (attribution.attribution_session_id) insertData.attribution_session_id  = String(attribution.attribution_session_id).slice(0, 64);
        if (attribution.landing_path)           insertData.landing_path            = String(attribution.landing_path).slice(0, 200);
        if (attribution.landing_referrer)       insertData.landing_referrer        = String(attribution.landing_referrer).slice(0, 500);
        if (attribution.first_touch_at) {
            const ts = new Date(attribution.first_touch_at);
            if (!isNaN(ts.getTime())) insertData.attribution_first_touch_at = ts.toISOString();
        }
        olog('attribution-attached', {
            paypalOrderId,
            utm_source:   insertData.utm_source   || null,
            utm_campaign: insertData.utm_campaign || null,
        });
    } else {
        olog('attribution-missing', { paypalOrderId, hint: 'client did not send attribution object' });
    }

    // Increment coupon usage count
    if (couponCode) {
        await supabase.rpc('increment_coupon_uses', { coupon_code: String(couponCode).toUpperCase() });
    }

    olog('db-insert-start', { paypalOrderId, totalAmount, hasCoupon: !!couponCode });

    const dbT0 = Date.now();
    const { data, error } = await supabase
        .from('orders')
        .insert(insertData)
        .select('id')
        .single();

    if (error) {
        oerr('db-insert-failed', {
            paypalOrderId,
            errorCode: error.code,
            errorMessage: error.message,
            errorHint: error.hint || '',
            dbDurationMs: Date.now() - dbT0,
        });
        console.error('Order save error:', JSON.stringify(error));
        return res.status(200).json({ success: false, error: error.message });
    }

    olog('db-insert-success', {
        orderId: data.id,
        paypalOrderId,
        userId: userId || 'guest',
        totalAmount,
        dbDurationMs: Date.now() - dbT0,
        totalDurationMs: Date.now() - t0,
    });
    console.log(`✅ Order saved: ${data.id} | PayPal: ${paypalOrderId} | User: ${userId || 'guest'}`);
    return res.status(200).json({ success: true, orderId: data.id });
};
