// DUBIS — Admin Analytics API (Enhanced)
// GET /api/admin/analytics
// Returns: page views, orders metrics, newsletter stats, coupon usage, reviews, referrers

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
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // ── Run all queries in parallel for speed ──
    const [
        totalViewsRes,
        todayViewsRes,
        recentViewsRes,
        allOrdersRes,
        recentOrdersRes,
        subscribersRes,
        recentSubsRes,
        couponsRes,
        reviewsRes,
        reviewsSummaryRes
    ] = await Promise.all([
        // Page views — total
        supabase.from('page_views').select('*', { count: 'exact', head: true }),
        // Page views — today
        supabase.from('page_views').select('*', { count: 'exact', head: true }).gte('created_at', today),
        // Page views — last 30 days raw
        supabase.from('page_views').select('path, referrer, created_at').gte('created_at', since30).order('created_at', { ascending: true }),
        // All orders
        supabase.from('orders').select('id, status, total_amount, currency, coupon_code, discount_amount, items, created_at'),
        // Recent orders (30 days)
        supabase.from('orders').select('id, total_amount, items, created_at').gte('created_at', since30),
        // Newsletter — total subscribers
        supabase.from('newsletter_subscribers').select('*', { count: 'exact', head: true }),
        // Newsletter — recent (30 days)
        supabase.from('newsletter_subscribers').select('email, source, subscribed_at').gte('subscribed_at', since30),
        // Coupon usage
        supabase.from('coupons').select('code, name, current_uses, max_uses, enabled'),
        // Reviews — all (for admin)
        supabase.from('product_reviews').select('*').order('created_at', { ascending: false }).limit(50),
        // Reviews summary
        supabase.from('product_reviews').select('*', { count: 'exact', head: true }),
    ]);

    // ── PAGE VIEWS ──
    const rows = recentViewsRes.data || [];
    const byDay = {};
    rows.forEach(r => {
        const day = r.created_at.slice(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
    });
    const viewsPerDay = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        viewsPerDay.push({ date: d, views: byDay[d] || 0 });
    }

    // Top pages
    const pageCounts = {};
    rows.forEach(r => { pageCounts[r.path] = (pageCounts[r.path] || 0) + 1; });
    const topPages = Object.entries(pageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, views]) => ({ path, views }));

    // Top referrers
    const refCounts = {};
    rows.forEach(r => {
        const ref = r.referrer || 'Direct';
        let source = 'Direct';
        if (ref !== 'Direct') {
            try {
                const u = new URL(ref);
                source = u.hostname.replace('www.', '');
            } catch { source = ref.slice(0, 40); }
        }
        refCounts[source] = (refCounts[source] || 0) + 1;
    });
    const topReferrers = Object.entries(refCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([source, count]) => ({ source, count }));

    // Views last 7 days vs previous 7 days for trend
    const views7 = rows.filter(r => r.created_at >= since7).length;
    const prev7Start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const views7prev = rows.filter(r => r.created_at >= prev7Start && r.created_at < since7).length;

    // ── ORDERS ──
    const allOrders = allOrdersRes.data || [];
    const totalOrders = allOrders.length;
    const totalRevenue = allOrders
        .filter(o => o.status !== 'cancelled' && o.status !== 'refunded' && (parseFloat(o.total_amount) || 0) > 0)
        .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const todayOrders = allOrders.filter(o => o.created_at?.startsWith(today));
    const todayRevenue = todayOrders
        .filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
        .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

    const ordersByStatus = {};
    allOrders.forEach(o => { ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1; });

    // Revenue per day (last 30 days)
    const recentOrds = recentOrdersRes.data || [];
    const revByDay = {};
    recentOrds.forEach(o => {
        const day = o.created_at?.slice(0, 10);
        if (day) revByDay[day] = (revByDay[day] || 0) + (parseFloat(o.total_amount) || 0);
    });
    const revenuePerDay = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        revenuePerDay.push({ date: d, revenue: Math.round((revByDay[d] || 0) * 100) / 100 });
    }

    // Average order value
    const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

    // Best-selling products (from order items)
    const productSales = {};
    allOrders.forEach(o => {
        const items = o.items || [];
        items.forEach(item => {
            const name = item.name || item.product_name || 'Unknown';
            if (!productSales[name]) productSales[name] = { qty: 0, revenue: 0 };
            productSales[name].qty += (item.quantity || item.qty || 1);
            productSales[name].revenue += (parseFloat(item.price) || 0) * (item.quantity || item.qty || 1);
        });
    });
    const bestSellers = Object.entries(productSales)
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 10)
        .map(([name, d]) => ({ name, qty: d.qty, revenue: Math.round(d.revenue * 100) / 100 }));

    // Coupon usage in orders
    const couponUsage = {};
    allOrders.forEach(o => {
        if (o.coupon_code) {
            if (!couponUsage[o.coupon_code]) couponUsage[o.coupon_code] = { uses: 0, discount_total: 0 };
            couponUsage[o.coupon_code].uses++;
            couponUsage[o.coupon_code].discount_total += parseFloat(o.discount_amount) || 0;
        }
    });

    // Conversion rate (orders / unique visitor days, rough estimate)
    const uniqueDays = Object.keys(byDay).length || 1;
    const monthViews = rows.length;
    const monthOrders = recentOrds.length;
    const conversionRate = monthViews > 0 ? Math.round((monthOrders / monthViews) * 10000) / 100 : 0;

    // ── NEWSLETTER ──
    const totalSubscribers = subscribersRes.count || 0;
    const recentSubs = recentSubsRes.data || [];
    const subsByDay = {};
    recentSubs.forEach(s => {
        const day = (s.subscribed_at || '').slice(0, 10);
        if (day) subsByDay[day] = (subsByDay[day] || 0) + 1;
    });
    const subscribersPerDay = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        subscribersPerDay.push({ date: d, count: subsByDay[d] || 0 });
    }

    // ── COUPONS ──
    const coupons = (couponsRes.data || []).map(c => ({
        code: c.code,
        name: c.name,
        uses: c.current_uses || 0,
        max: c.max_uses,
        enabled: c.enabled,
        orderUses: couponUsage[c.code]?.uses || 0,
        discountTotal: Math.round((couponUsage[c.code]?.discount_total || 0) * 100) / 100
    }));

    // ── REVIEWS ──
    const reviews = reviewsRes.data || [];
    const totalReviews = reviewsSummaryRes.count || 0;
    const pendingReviews = reviews.filter(r => !r.approved).length;
    const approvedReviews = reviews.filter(r => r.approved).length;
    const avgRating = reviews.length > 0
        ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10
        : 0;

    return res.status(200).json({
        // Page views
        totalViews: totalViewsRes.count || 0,
        todayViews: todayViewsRes.count || 0,
        viewsPerDay,
        topPages,
        topReferrers,
        viewsTrend: { current: views7, previous: views7prev },

        // Orders
        totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        todayOrders: todayOrders.length,
        todayRevenue: Math.round(todayRevenue * 100) / 100,
        avgOrderValue,
        ordersByStatus,
        revenuePerDay,
        bestSellers,
        conversionRate,

        // Newsletter
        totalSubscribers,
        recentSubscribers: recentSubs.length,
        subscribersPerDay,

        // Coupons
        couponStats: coupons,

        // Reviews
        reviews,
        totalReviews,
        pendingReviews,
        approvedReviews,
        avgRating,
    });
};
