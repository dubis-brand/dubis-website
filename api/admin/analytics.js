// DUBIS — Admin Analytics API
// GET /api/admin/analytics
// Returns: page views, orders metrics, newsletter stats, coupon usage, reviews, referrers,
// monthly profit, campaigns + the US Last Run test block (Tax Nexus removed 2026-07-24 — $0 US revenue, irrelevant)

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
    // Page-views aggregation runs server-side via `admin_page_views_summary` RPC
    // (migration `admin_page_views_summary_rpc_2026_05_24`). The previous 3-chunk JS
    // aggregation hit the PostgREST db-max-rows ceiling (~1000) on the most-recent chunk:
    // on 2026-05-24 it had 3,946 rows but PostgREST truncated to ~1000, hiding all traffic
    // after 2026-05-16 from the admin chart. RPC returns ~30 rows of pre-aggregated counts.
    const [
        totalViewsRes,
        todayViewsRes,
        pageViewsSummaryRes,
        allOrdersRes,
        recentOrdersRes,
        subscribersRes,
        recentSubsRes,
        couponsRes,
        reviewsRes,
        reviewsSummaryRes
    ] = await Promise.all([
        // Page views — total (uses index-only count, no row scan)
        supabase.from('page_views').select('*', { count: 'exact', head: true }),
        // Page views — today
        supabase.from('page_views').select('*', { count: 'exact', head: true }).gte('created_at', today),
        // Page views — 30-day aggregation (per_day, top_pages, top_referrers, views_7d, views_7d_prev)
        supabase.rpc('admin_page_views_summary', { days_back: 30 }),
        // All orders (include buyer_email + shipping_address + is_test for sandbox filtering and tax nexus tracking)
        supabase.from('orders').select('id, status, total_amount, currency, coupon_code, discount_amount, items, buyer_email, shipping_address, is_test, created_at'),
        // Recent orders (30 days) — include shipping_address for tax nexus tracking + items for profit calc
        supabase.from('orders').select('id, status, total_amount, items, buyer_email, coupon_code, shipping_address, is_test, created_at').gte('created_at', since30),
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

    // ── PAGE VIEWS ── (RPC payload — defensive fallbacks on RPC failure)
    const pvSummary = (pageViewsSummaryRes && pageViewsSummaryRes.data) || {};
    const rpcPerDay = Array.isArray(pvSummary.per_day) ? pvSummary.per_day : [];
    const byDay = {};
    rpcPerDay.forEach(r => { byDay[r.day] = Number(r.views) || 0; });
    const viewsPerDay = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        viewsPerDay.push({ date: d, views: byDay[d] || 0 });
    }

    const topPages = Array.isArray(pvSummary.top_pages)
        ? pvSummary.top_pages.map(p => ({ path: p.path, views: Number(p.views) || 0 }))
        : [];
    const topReferrers = Array.isArray(pvSummary.top_referrers)
        ? pvSummary.top_referrers.map(r => ({ source: r.source, count: Number(r.count) || 0 }))
        : [];

    // 7-day trend (real counts from RPC, no row-cap artefacts)
    const views7     = Number(pvSummary.views_7d) || 0;
    const views7prev = Number(pvSummary.views_7d_prev) || 0;

    // ── ORDERS ──
    // Family/internal emails — oren placed these himself (incl. Hila, his wife).
    // Excluded from real-revenue per oren directive 2026-05-29: show TRUE stranger sales only.
    const FAMILY_EMAILS = ['hilateharlev@gmail.com', 'teharlev1976@gmail.com', 'dubis.brand@gmail.com'];
    const FAMILY_NAME_RE = /\b(hila|oren)\b.*tehar|tehar.?lev/i;
    // Helper: filter out test/sandbox orders, reprints, cancelled, AND family orders
    const isRealOrder = (o) => {
        if (o.is_test === true) return false;
        if (o.status === 'cancelled' || o.status === 'refunded') return false;
        if (o.buyer_email && o.buyer_email.includes('example.com')) return false; // PayPal Sandbox
        if (o.coupon_code === 'GELATO-REPRINT') return false; // Reprints (not a new sale)
        if (o.buyer_email && FAMILY_EMAILS.includes(o.buyer_email.toLowerCase().trim())) return false;
        const shipName = (o.shipping_address && (o.shipping_address.name || o.shipping_address.full_name)) || o.ship_name || '';
        if (shipName && FAMILY_NAME_RE.test(shipName)) return false;
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

    // ── VISITORS (REAL — excludes oren's own machine + bots, per directive 2026-05-29) ──
    // real_visitors  = DISTINCT ip_hash, is_internal NOT TRUE, non-bot UA
    // fbia_visitors  = subset trapped in Facebook In-App Browser (can't checkout — PayPal popup blocked)
    // realbrowser_visitors = subset on a real browser (CAN convert)
    // persisted_sessions = DISTINCT session_id (FBIA strips localStorage → session can't persist)
    const realVisitors = Number(pvSummary.real_visitors) || 0;
    const fbiaVisitors = Number(pvSummary.fbia_visitors) || 0;
    const realBrowserVisitors = Number(pvSummary.realbrowser_visitors) || 0;
    const persistedSessions = Number(pvSummary.persisted_sessions) || 0;
    const excludedInternal = Number(pvSummary.excluded_internal) || 0;
    const excludedBots = Number(pvSummary.excluded_bots) || 0;

    // Unique visitors = REAL distinct visitors (de-internal'd, de-bot'd). NOT raw page-view count.
    const uniqueVisitors = realVisitors;
    // Conversion rate against the visitors who CAN actually buy (real-browser, not FBIA-trapped).
    const conversionBase = realBrowserVisitors > 0 ? realBrowserVisitors : realVisitors;
    const conversionRate = conversionBase > 0 ? Math.round((totalOrders / conversionBase) * 10000) / 100 : 0;

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
    const ILS_TO_USD = 3.7;
    // Normalize all spend/budget to ILS for display (ILS is base currency)
    const toILS = (amount, currency) => currency === 'USD' ? amount * ILS_TO_USD : amount;
    const totalAdSpend = campaigns.reduce((s, c) => s + toILS(parseFloat(c.spend_to_date) || 0, c.budget_currency), 0);
    const totalBudget = campaigns.reduce((s, c) => s + toILS(parseFloat(c.budget) || 0, c.budget_currency), 0);
    // Convert total spend to USD for ROAS/ROI (revenue is in USD)
    const totalAdSpendUSD = totalAdSpend / ILS_TO_USD;
    const roas = totalAdSpendUSD > 0 ? Math.round((totalRevenue / totalAdSpendUSD) * 100) / 100 : 0;
    const roi = totalAdSpendUSD > 0 ? Math.round(((totalRevenue - totalAdSpendUSD) / totalAdSpendUSD) * 10000) / 100 : 0;

    // ── COGS lookup ──
    // Per-product Gelato cost lookup (mirrors admin.html _gelatoCost — keep in sync)
    const TYPE_COST = { tshirt: 12.50, hoodie: 24.00, ziphoodie: 28.00, longsleeve: 15.00, cap: 12.00 };
    const PRODUCT_COST_OVERRIDES = { 17: 32.94 }; // Zip Hoodie verified 10/04/2026
    const itemCost = (item) => {
        const pid = parseInt(item.product_id || item.id || item.productId, 10);
        if (PRODUCT_COST_OVERRIDES[pid] != null) return PRODUCT_COST_OVERRIDES[pid];
        const t = (item.type || item.clothingType || '').replace(/-/g, '').toLowerCase();
        return TYPE_COST[t] != null ? TYPE_COST[t] : 14.00; // 14 fallback ≈ avg
    };

    // ── US LAST RUN — the 30-day test (board decision 2026-07-22, pre-signed verdict) ──
    // Campaign 120250052467260267 runs 2026-08-01 → 2026-09-08 (through the Palram-PA trip).
    // Verdict 08-09.09: ≥10 stranger purchases = scale · 1-9 = pivot meeting · 0 = orderly
    // shutdown of the commerce arm. PALRAM15 tags friendly purchases OUT of the verdict.
    const US_TEST_START = '2026-08-01';
    const US_TEST_END   = '2026-09-08';
    const usCampaignRow = campaigns.find(c => (c.notes || '').includes('US Last Run')) || null;
    const usMetaId = usCampaignRow ? ((usCampaignRow.notes || '').match(/campaign_id:\s*(\d+)/) || [])[1] || null : null;

    const [usVisitsRes, usCartsRes, usCheckoutsRes] = await Promise.all([
        supabase.from('page_views').select('*', { count: 'exact', head: true })
            .eq('utm_campaign', 'us_last_run').not('is_internal', 'is', true),
        supabase.from('page_views').select('*', { count: 'exact', head: true })
            .eq('utm_campaign', 'us_last_run').not('is_internal', 'is', true).eq('event', 'add_to_cart'),
        supabase.from('page_views').select('*', { count: 'exact', head: true })
            .eq('utm_campaign', 'us_last_run').not('is_internal', 'is', true).eq('event', 'checkout_start'),
    ]);

    const usTestOrders = allOrdersRaw.filter(o => o.created_at >= US_TEST_START && isRealOrder(o));
    const usStrangerOrders = usTestOrders.filter(o => (o.coupon_code || '').toUpperCase() !== 'PALRAM15');
    const usFriendlyOrders = usTestOrders.filter(o => (o.coupon_code || '').toUpperCase() === 'PALRAM15');



    // ── REAL MONTHLY PROFIT (last 30 days) ──
    // Profit = revenue - sum(item.cost × qty). Ad spend is tracked separately as a budget line.
    let monthlyRevenue30d = 0;
    let monthlyCogs30d = 0;
    recentOrds.forEach(o => {
        const rev = parseFloat(o.total_amount) || 0;
        monthlyRevenue30d += rev;
        const items = o.items || [];
        items.forEach(item => {
            const qty = item.quantity || item.qty || 1;
            monthlyCogs30d += itemCost(item) * qty;
        });
    });
    const monthlyProfit30d = Math.round((monthlyRevenue30d - monthlyCogs30d) * 100) / 100;

    // Content performance
    const contentTasks = (contentTasksRes.data || []);
    const publishedPosts = contentTasks.filter(t => t.status === 'done' && t.content_data?.instagram_post_id);
    const pendingContent = contentTasks.filter(t => t.status === 'pending_approval');
    const approvedContent = contentTasks.filter(t => t.status === 'approved');
    const rejectedContent = contentTasks.filter(t => t.status === 'rejected');
    const avgQaScore = contentTasks
        .filter(t => t.content_data?.qa_score)
        .reduce((acc, t, _, arr) => acc + (t.content_data.qa_score / arr.length), 0);

    // Prevent browser/CDN caching — the 2026-05-23 chart fix was invisible to oren
    // for ~32h because Chrome served the pre-fix JSON from disk cache. Admin data is
    // user-specific and time-sensitive; never cache it.
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
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
        // Visitor segmentation (real = de-internal'd + de-bot'd; per directive 2026-05-29)
        realVisitors,
        fbiaVisitors,           // trapped in Facebook In-App Browser — cannot checkout
        realBrowserVisitors,    // on a real browser — CAN convert
        persistedSessions,      // DISTINCT session_id (FBIA strips localStorage)
        excludedInternal,       // oren's own machine, filtered out
        excludedBots,
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

        // US Last Run — the 30-day test (board decision 2026-07-22, pre-signed verdict)
        usTest: {
            start: US_TEST_START,
            end: US_TEST_END,
            campaign: usCampaignRow ? {
                status: usCampaignRow.status,
                metaCampaignId: usMetaId,
                budget: parseFloat(usCampaignRow.budget) || 0,
                budgetCurrency: usCampaignRow.budget_currency || 'ILS',
                spend: parseFloat(usCampaignRow.spend_to_date) || 0,
                clicks: usCampaignRow.clicks || 0,
                impressions: usCampaignRow.impressions || 0,
            } : null,
            visits: usVisitsRes.count || 0,
            addToCarts: usCartsRes.count || 0,
            checkoutStarts: usCheckoutsRes.count || 0,
            strangerPurchases: usStrangerOrders.length,
            strangerRevenue: Math.round(usStrangerOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0) * 100) / 100,
            friendlyPurchases: usFriendlyOrders.length, // PALRAM15 — excluded from the verdict
        },

        // Real monthly profit (last 30 days, COGS-deducted, ad spend separate)
        monthlyRevenue30d: Math.round(monthlyRevenue30d * 100) / 100,
        monthlyCogs30d: Math.round(monthlyCogs30d * 100) / 100,
        monthlyProfit30d,
    });
};
