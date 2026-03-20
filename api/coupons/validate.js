// DUBIS — Validate coupon code
// POST /api/coupons/validate
// Body: { code, cartTotal }
// Returns: { valid, discount_type, discount_value, discount_amount, final_total }

const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('../_rateLimit');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 20 attempts per IP per minute
    if (rateLimit(req, res, { max: 20, windowMs: 60_000 })) return;

    const { code, cartTotal } = req.body || {};

    if (!code || typeof cartTotal !== 'number') {
        return res.status(400).json({ valid: false, error: 'Missing code or cartTotal' });
    }

    const cleanCode = String(code).trim().toUpperCase();

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(200).json({ valid: false, error: 'Service unavailable' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const now = new Date().toISOString();

    const { data: coupon, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', cleanCode)
        .eq('enabled', true)
        .lte('valid_from', now)
        .gte('valid_until', now)
        .single();

    if (error || !coupon) {
        return res.status(200).json({ valid: false, error: 'Invalid or expired coupon code' });
    }

    // Check max_uses
    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
        return res.status(200).json({ valid: false, error: 'This coupon has reached its usage limit' });
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
        discountAmount = Math.round((cartTotal * coupon.discount_value / 100) * 100) / 100;
    } else {
        discountAmount = Math.min(coupon.discount_value, cartTotal);
    }

    const finalTotal = Math.max(0, Math.round((cartTotal - discountAmount) * 100) / 100);

    return res.status(200).json({
        valid: true,
        code: cleanCode,
        name: coupon.name,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        discount_amount: discountAmount,
        final_total: finalTotal
    });
};
