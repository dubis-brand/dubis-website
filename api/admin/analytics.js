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
        supabase.from('page_views').select('path, referrer, created_at').gte('created_at', since30).order('created_at', { ascending: true }).limit(10000),
        // All orders (include buyer_email for sandbox filtering)
        supabase.from('orders').select('id, status, total_amount, currency, coupon_code, discount_amount, items, buyer_email, created_at'),
        // Recent orders (30 days)
        supabase.from('orders').select('id, status, total_amount, items, buyer_email, coupon_code, created_at').gte('created_at', since30),
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
    // Helper: filter out test/sandbox orders, reprints, and cancelled
    const isRealOrder = (o) => {
        if (o.status === 'cancelled' || o.status === 'refunded') return false;
        if (o.buyer_email && o.buyer_email.includes('example.com')) return false; // PayPal Sandbox
        if (o.coupon_code === 'GELATO-REPRINT') return false; // Reprints (not a new sale)
        return true;
    };

    const allOrdersRaw = allOrdersRes.data || [];
    const realOrders = allOrdersRaw.filter(isRealOrder);
    const totalOrders = realOrders.length;
    const totalRevenue = realOrders
        .filter(o => (parseFloat(o.total_amount) || 0) > 0)
        .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const todayOrders = realOrders.filter(o => o.created_at?.startsWith(today));
    const todayRevenue = todayOrders
        .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

    // Status breakdown (show ALL orders including cancelled for transparency)
    const ordersByStatus = {};
    allOrdersRaw.forEach(o => { ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1; });

    // Revenue per day (last 30 days) — only real orders
    const recentOrdsRaw = recentOrdersRes.data || [];
    const recentOrds = recentOrdsRaw.filter(isRealOrder);
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

    // Average order value (only real orders with revenue)
    const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

    // Best-selling products (from REAL order items only)
    const productSales = {};
    realOrders.forEach(o => {
        const items = o.items || [];
        items.forEach(item => {
            // Build readable name from item fields: typeLabel + phrase
            const typeName = item.typeLabel || item.type || '';
            const phrase = item.phrase || '';
            const name = phrase ? `${typeName} — ${phrase.substring(0, 30)}` : (typeName || item.name || item.product_name || 'Unknown');
            if (!productSales[name]) productSales[name] = { qty: 0, revenue: 0 };
            productSales[name].qty += (item.quantity || item.qty || 1);
            productSales[name].revenue += (parseFloat(item.price) || 0) * (item.quantity || item.qty || 1);
        });
    });
    const bestSellers = Object.entries(productSales)
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 10)
        .map(([name, d]) => ({ name, qty: d.qty, revenue: Math.round(d.revenue * 100) / 100 }));

    // Coupon usage in orders (count all orders for coupon tracking)
    const couponUsage = {};
    allOrdersRaw.forEach(o => {
        if (o.coupon_code) {
            if (!couponUsage[o.coupon_code]) couponUsage[o.coupon_code] = { uses: 0, discount_total: 0 };
            couponUsage[o.coupon_code].uses++;
            couponUsage[o.coupon_code].discount_total += parseFloat(o.discount_amount) || 0;
        }
    });

    // Unique visitors (approximate from page views)
    const uniqueVisitors = rows.length;
    const conversionRate = uniqueVisitors > 0 ? Math.round((totalOrders / uniqueVisitors) * 10000) / 100 : 0;

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

    // ── CAMPAIGNS & CONTENT PERFORMANCE ──
    const [campaignsRes, contentTasksRes] = await Promise.all([
        supabase.from('ad_campaigns').select('*').order('created_at', { ascending: false }),
        supabase.from('agent_tasks').select('id, title, status, agent_id, category, content_data, created_at')
            .eq('agent_id', 'content').order('created_at', { ascending: false }).limit(30),
    ]);

    const campaigns = (campaignsRes.data || []);
    const activeCampaigns = campaigns.filter(c => c.status === 'active');
    const totalAdSpend = campaigns.reduce((s, c) => s + (parseFloat(c.spend_to_date) || 0), 0);
    const totalBudget = campaigns.reduce((s, c) => s + (parseFloat(c.budget) || 0), 0);
    const roas = totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : 0;
    const roi = totalAdSpend > 0 ? Math.round(((totalRevenue - totalAdSpend) / totalAdSpend) * 10000) / 100 : 0;

    // Content performance
    const contentTasks = (contentTasksRes.data || []);
    const publishedPosts = contentTasks.filter(t => t.status === 'done' && t.content_data?.instagram_post_id);
    const pendingContent = contentTasks.filter(t => t.status === 'pending_approval');
    const approvedContent = contentTasks.filter(t => t.status === 'approved');
    const rejectedContent = contentTasks.filter(t => t.status === 'rejected');
    const avgQaScore = contentTasks
        .filter(t => t.content_data?.qa_score)
        .reduce((acc, t, _, arr) => acc + (t.content_data.qa_score / arr.length), 0);

    return res.status(200).json({
        // Page views
        totalViews: totalViewsRes.count || 0,
        todayViews: todayViewsRes.count || 0,
        viewsPerDay,
        topPages,
        topReferrers,
        viewsTrend: { current: views7, previous: views7prev },

        // Orders (real orders only — excludes sandbox, cancelled, reprints)
        totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        uniqueVisitors,
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

        // Campaigns & Ad Spend
        campaigns: campaigns.map(c => ({
            id: c.id, platform: c.platform, goal: c.goal,
            budget: parseFloat(c.budget) || 0,
            budgetCurrency: c.budget_currency || 'ILS',
            spend: parseFloat(c.spend_to_date) || 0,
            clicks: c.clicks || 0, impressions: c.impressions || 0,
            status: c.status, startDate: c.start_date, endDate: c.end_date,
            daysRemaining: c.end_date ? Math.max(0, Math.ceil((new Date(c.end_date) - new Date()) / 86400000)) : null,
            cpc: c.clicks > 0 ? Math.round((parseFloat(c.spend_to_date) || 0) / c.clicks * 100) / 100 : null,
            cpm: c.impressions > 0 ? Math.round((parseFloat(c.spend_to_date) || 0) / c.impressions * 1000 * 100) / 100 : null,
            ctr: c.impressions > 0 ? Math.round(c.clicks / c.impressions * 10000) / 100 : null,
        })),
        activeCampaigns: activeCampaigns.length,
        totalAdSpend: Math.round(totalAdSpend * 100) / 100,
        totalBudget: Math.round(totalBudget * 100) / 100,
        roas,
        roi,

        // Content Performance
        contentStats: {
            published: publishedPosts.length,
            pendingApproval: pendingContent.length,
            approved: approvedContent.length,
            rejected: rejectedContent.length,
            total: contentTasks.length,
            avgQaScore: Math.round(avgQaScore),
        },
    });
};
