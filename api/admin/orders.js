// DUBIS — Admin Orders API
// Vercel Serverless Function  GET /api/admin/orders
// =====================================================
// Returns all orders for the admin dashboard.
// Protected: requires a valid Supabase JWT from an admin email.
//
// Env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ADMIN_EMAILS  — comma-separated list of admin email addresses
//                   e.g. "dubis.brand@gmail.com,oren@palram.com"
// =====================================================

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

// Parse admin emails from env
function getAdminEmails() {
    const raw = process.env.ADMIN_EMAILS || '';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

module.exports = async function handler(req, res) {
    if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

    // CORS for same-origin fetch from admin page
    res.setHeader('Access-Control-Allow-Origin', 'https://www.dubis.net');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // ── Validate admin JWT ───────────────────────────────────────
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Server config error' });
    }

    // ── Create clients ───────────────────────────────────────────
    const supabaseAnon = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY || '',
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Service-role client (bypasses RLS)
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the JWT and get the user's email
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

    const email = (user.email || '').toLowerCase();
    const adminEmails = getAdminEmails();

    // Check static list first, then dynamic admin_users table
    let isAdmin = adminEmails.includes(email);
    if (!isAdmin) {
        const { data } = await supabase
            .from('admin_users')
            .select('email')
            .eq('email', email)
            .maybeSingle();
        isAdmin = !!data;
    }
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

    // ── Fetch all orders (service role bypasses RLS) ──────────────

    const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Admin orders fetch error:', error.message);
        return res.status(500).json({ error: 'Database error' });
    }

    // ── Compute summary stats ─────────────────────────────────────
    // Filter out sandbox/test orders and reprints for revenue stats
    const isRealOrder = (o) => {
        if (o.status === 'cancelled' || o.status === 'refunded') return false;
        if (o.buyer_email && o.buyer_email.includes('example.com')) return false;
        if (o.coupon_code === 'GELATO-REPRINT') return false;
        return true;
    };
    const activeOrders = orders.filter(isRealOrder);
    const totalRevenue  = activeOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayRevenue  = activeOrders
        .filter(o => o.created_at?.slice(0, 10) === today)
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    const statusCounts = orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {});

    return res.status(200).json({
        orders,
        stats: {
            total: orders.length,
            activeTotal: activeOrders.length,
            totalRevenue: totalRevenue.toFixed(2),
            todayRevenue: todayRevenue.toFixed(2),
            statusCounts,
        },
    });
};
