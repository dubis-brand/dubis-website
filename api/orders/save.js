// DUBIS — Save order to Supabase after PayPal capture
// Vercel Serverless Function  POST /api/orders/save
// =======================================================

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

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

    const insertData = {
        user_id:           userId,
        paypal_order_id:   paypalOrderId,
        printful_order_id: printfulOrderId || null,
        status:            'pending',
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
