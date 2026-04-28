// DUBIS — Page View / Funnel Event Tracker (v2 with internal-traffic filter)
// POST /api/analytics/track
// Body: { path, referrer, event, meta, session_id, is_dev }
// No auth required — rate limited

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('../_rateLimit');

const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|monitor|wget|curl|axios|python|node-fetch|headless|phantomjs|puppeteer|playwright|googlebot|bingbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|slackbot|vercel-screenshot/i;
const ALLOWED_EVENTS = ['pageview','product_view','add_to_cart','remove_from_cart','checkout_open','checkout_start','purchase','cta_click','newsletter_signup','section_view'];

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    if (rateLimit(req, res, { max: 60, windowMs: 60_000 })) return;

    const { path, referrer, event, meta, session_id, is_dev } = req.body || {};
    if (!path || typeof path !== 'string') return res.status(400).json({ error: 'Missing path' });
    const evt = ALLOWED_EVENTS.includes(event) ? event : 'pageview';

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(200).json({ ok: false });
    }

    // ── Internal traffic detection ──
    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
    const ipHash = ip ? crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'dubis')).digest('hex').slice(0, 16) : null;
    const uaShort = ua.slice(0, 200);
    const isBot = BOT_UA.test(ua);
    const isInternal = is_dev === true || isBot ||
                       path.startsWith('/#access_token=') ||
                       (path === '/admin' || path.startsWith('/admin'));

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabase.from('page_views').insert({
        path: String(path).substring(0, 200),
        referrer: referrer ? String(referrer).substring(0, 500) : null,
        event: evt,
        meta: meta && typeof meta === 'object' ? meta : null,
        session_id: session_id ? String(session_id).slice(0, 64) : null,
        ip_hash: ipHash,
        ua_short: uaShort,
        is_internal: isInternal,
        country_code: req.headers['x-vercel-ip-country'] || null,
    });

    return res.status(200).json({ ok: true, is_internal: isInternal });
};
