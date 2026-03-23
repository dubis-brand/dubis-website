// DUBIS — Admin Analytics API
// GET /api/admin/analytics
// Returns page view stats: totals, per-day, top pages

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('../_rateLimit');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
    .split(',').map(e => e.trim().toLowerCase());

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

    const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());
    if (!isAdmin) {
        const { data: adminRow } = await supabase
            .from('admin_users').select('email').eq('email', user.email).single();
        if (!adminRow) return res.status(403).json({ error: 'Forbidden' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Total views
    const { count: totalViews } = await supabase
        .from('page_views').select('*', { count: 'exact', head: true });

    // Today's views
    const { count: todayViews } = await supabase
        .from('page_views')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today);

    // Last 30 days — raw rows (for grouping by day server-side)
    const { data: recent } = await supabase
        .from('page_views')
        .select('path, created_at')
        .gte('created_at', since30)
        .order('created_at', { ascending: true });

    const rows = recent || [];

    // Group by day
    const byDay = {};
    rows.forEach(r => {
        const day = r.created_at.slice(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
    });

    // Fill last 30 days (include days with 0)
    const viewsPerDay = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        viewsPerDay.push({ date: d, views: byDay[d] || 0 });
    }

    // Top pages (last 30 days)
    const pageCounts = {};
    rows.forEach(r => { pageCounts[r.path] = (pageCounts[r.path] || 0) + 1; });
    const topPages = Object.entries(pageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, views]) => ({ path, views }));

    return res.status(200).json({
        totalViews: totalViews || 0,
        todayViews: todayViews || 0,
        viewsPerDay,
        topPages,
    });
};
