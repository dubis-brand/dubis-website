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
        printfulOrderId
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

    const totalAmount = (cartItems || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);

    const { data, error } = await supabase
        .from('orders')
        .insert({
            user_id:           userId,
            paypal_order_id:   paypalOrderId,
            printful_order_id: printfulOrderId || null,
            status:            'pending',
            buyer_email:       buyerEmail || '',
            shipping_address:  shippingAddress,
            items:             cartItems,
            total_amount:      totalAmount,
            currency:          'USD'
        })
        .select('id')
        .single();

    if (error) {
        console.error('Order save error:', JSON.stringify(error));
        return res.status(200).json({ success: false, error: error.message });
    }

    console.log(`✅ Order saved: ${data.id} | PayPal: ${paypalOrderId} | User: ${userId || 'guest'}`);
    return res.status(200).json({ success: true, orderId: data.id });
};
