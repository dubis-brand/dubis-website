// DUBIS — Admin Coupons CRUD
// GET    /api/admin/coupons        → list all
// POST   /api/admin/coupons        → create
// PUT    /api/admin/coupons        → update (body includes code)
// DELETE /api/admin/coupons?code=X → delete

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
    .split(',').map(e => e.trim());

// ── Public coupon validation (no auth) ───────────────────────────────────────
// Previously at /api/coupons/validate — now merged here for function-count savings
async function validateCoupon(req, res, supabase) {
    const { code, cartTotal } = req.body || {};
    if (!code || typeof cartTotal !== 'number') {
        return res.status(400).json({ valid: false, error: 'Missing code or cartTotal' });
    }
    const cleanCode = String(code).trim().toUpperCase();
    const now = new Date().toISOString();
    const { data: coupon, error } = await supabase
        .from('coupons').select('*')
        .eq('code', cleanCode).eq('enabled', true)
        .lte('valid_from', now).gte('valid_until', now).single();
    if (error || !coupon) return res.status(200).json({ valid: false, error: 'Invalid or expired coupon code' });
    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
        return res.status(200).json({ valid: false, error: 'This coupon has reached its usage limit' });
    }
    let discountAmount = coupon.discount_type === 'percentage'
        ? Math.round((cartTotal * coupon.discount_value / 100) * 100) / 100
        : Math.min(coupon.discount_value, cartTotal);
    const finalTotal = Math.max(0, Math.round((cartTotal - discountAmount) * 100) / 100);
    return res.status(200).json({ valid: true, code: cleanCode, name: coupon.name, discount_type: coupon.discount_type, discount_value: coupon.discount_value, discount_amount: discountAmount, final_total: finalTotal });
}
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
    if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

    // Public: coupon validation (no auth required) — replaces /api/coupons/validate
    if (req.method === 'POST' && req.query.action === 'validate') {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } });
        return validateCoupon(req, res, supabase);
    }

    // Verify admin JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    // Check admin access
    const isAdmin = ADMIN_EMAILS.includes(user.email);
    if (!isAdmin) {
        const { data: adminRow } = await supabase
            .from('admin_users').select('email').eq('email', user.email).single();
        if (!adminRow) return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('coupons')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ coupons: data });
    }

    if (req.method === 'POST') {
        const { code, name, discount_type, discount_value, valid_from, valid_until, max_uses, enabled } = req.body;
        if (!code || !name || !discount_type || !discount_value || !valid_from || !valid_until) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const { data, error } = await supabase.from('coupons').insert({
            code: String(code).trim().toUpperCase(),
            name,
            discount_type,
            discount_value: Number(discount_value),
            valid_from,
            valid_until,
            max_uses: max_uses ? Number(max_uses) : null,
            enabled: enabled !== false
        }).select().single();
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ coupon: data });
    }

    if (req.method === 'PUT') {
        const { code, ...updates } = req.body;
        if (!code) return res.status(400).json({ error: 'Missing code' });
        if (updates.discount_value) updates.discount_value = Number(updates.discount_value);
        if (updates.max_uses !== undefined) updates.max_uses = updates.max_uses ? Number(updates.max_uses) : null;
        const { data, error } = await supabase
            .from('coupons').update(updates).eq('code', code).select().single();
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ coupon: data });
    }

    if (req.method === 'DELETE') {
        const code = req.query.code;
        if (!code) return res.status(400).json({ error: 'Missing code' });
        const { error } = await supabase.from('coupons').delete().eq('code', code);
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
