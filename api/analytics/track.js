// DUBIS — Page View Tracker
// POST /api/analytics/track
// Body: { path, referrer }
// No auth required — rate limited

const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('../_rateLimit');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    // 60 page views per IP per minute
    if (rateLimit(req, res, { max: 60, windowMs: 60_000 })) return;

    const { path, referrer } = req.body || {};
    if (!path || typeof path !== 'string') return res.status(400).json({ error: 'Missing path' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(200).json({ ok: false });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabase.from('page_views').insert({
        path: String(path).substring(0, 200),
        referrer: referrer ? String(referrer).substring(0, 500) : null,
    });

    return res.status(200).json({ ok: true });
};
