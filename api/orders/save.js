// DUBIS — Save order to Supabase after PayPal capture
// Vercel Serverless Function  POST /api/orders/save
// =======================================================

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limit: 10 order saves per IP per minute
    if (rateLimit(req, res, { max: 10, windowMs: 60_000 })) return;

    const {
        paypalOrderId,
        buyerEmail,
        shippingAddress,
        cartItems,
        printfulOrderId,
        couponCode,
        discountAmount
    } = req.body;

    if (!paypalOrderId || !cartItems || !shippingAddress) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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

    const totalAmount = (cartItems || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);

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
    if (discountAmount) insertData.discount_amount = Number(discountAmount);

    // Increment coupon usage count
    if (couponCode) {
        await supabase.rpc('increment_coupon_uses', { coupon_code: String(couponCode).toUpperCase() });
    }

    const { data, error } = await supabase
        .from('orders')
        .insert(insertData)
        .select('id')
        .single();

    if (error) {
        console.error('Order save error:', JSON.stringify(error));
        return res.status(200).json({ success: false, error: error.message });
    }

    console.log(`✅ Order saved: ${data.id} | PayPal: ${paypalOrderId} | User: ${userId || 'guest'}`);
    return res.status(200).json({ success: true, orderId: data.id });
};
