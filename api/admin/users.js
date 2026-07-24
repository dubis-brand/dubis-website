// DUBIS — Admin Users API
// Vercel Serverless Function  GET/POST /api/admin/users
// =====================================================
// GET  — returns all registered users with admin status
// POST — { action: 'grant'|'revoke', email: '...' }
//
// Protected: requires a valid Supabase JWT from an admin.
// Admin = static ADMIN_EMAILS env var OR row in `admin_users` table.
//
// Supabase table required:
//   CREATE TABLE public.admin_users (
//     email       TEXT PRIMARY KEY,
//     granted_by  TEXT,
//     created_at  TIMESTAMPTZ DEFAULT NOW()
//   );
//   ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
// =====================================================

const { createClient } = require('@supabase/supabase-js');

function getStaticAdmins() {
    const raw = process.env.ADMIN_EMAILS || '';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

async function isAdminUser(email, supabaseAdmin, staticAdmins) {
    if (staticAdmins.includes(email.toLowerCase())) return true;
    const { data } = await supabaseAdmin
        .from('admin_users')
        .select('email')
        .eq('email', email.toLowerCase())
        .maybeSingle();
    return !!data;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.dubis.net');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Server config error' });
    }

    // ── Client ───────────────────────────────────────────────
    // Single service-role client — also validates the caller's JWT.
    // (SUPABASE_ANON_KEY = legacy anon JWT, dead since the 2026-06-13
    // rotation; validating through it 401'd every admin session.)
    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Authenticate caller ──────────────────────────────────
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

    const staticAdmins = getStaticAdmins();
    const callerIsAdmin = await isAdminUser(user.email, supabaseAdmin, staticAdmins);
    if (!callerIsAdmin) return res.status(403).json({ error: 'Forbidden' });

    // ── GET: list all users ──────────────────────────────────
    if (req.method === 'GET') {
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
            perPage: 1000,
        });
        if (listError) {
            console.error('Admin listUsers error:', listError.message);
            return res.status(500).json({ error: listError.message });
        }

        // Fetch current dynamic admins
        const { data: dynamicAdmins } = await supabaseAdmin
            .from('admin_users')
            .select('email');
        const dynamicSet = new Set((dynamicAdmins || []).map(a => a.email.toLowerCase()));

        const mapped = users.map(u => ({
            id:               u.id,
            email:            u.email || '',
            full_name:        u.user_metadata?.full_name || null,
            created_at:       u.created_at,
            last_sign_in_at:  u.last_sign_in_at,
            provider:         u.app_metadata?.provider || 'email',
            is_super_admin:   staticAdmins.includes((u.email || '').toLowerCase()),
            is_admin:         staticAdmins.includes((u.email || '').toLowerCase()) ||
                              dynamicSet.has((u.email || '').toLowerCase()),
        }));

        // Sort: admins first, then by join date desc
        mapped.sort((a, b) => {
            if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
            return new Date(b.created_at) - new Date(a.created_at);
        });

        return res.status(200).json({ users: mapped });
    }

    // ── POST: grant / revoke admin ───────────────────────────
    if (req.method === 'POST') {
        const { action, email } = req.body || {};
        if (!action || !email) {
            return res.status(400).json({ error: 'Missing action or email' });
        }

        const target = email.trim().toLowerCase();

        // Protect super-admins from being demoted via UI
        if (staticAdmins.includes(target)) {
            return res.status(400).json({ error: 'Cannot modify a super-admin via the UI' });
        }

        if (action === 'grant') {
            const { error } = await supabaseAdmin.from('admin_users').upsert({
                email:      target,
                granted_by: user.email,
            });
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ success: true });
        }

        if (action === 'revoke') {
            const { error } = await supabaseAdmin.from('admin_users').delete().eq('email', target);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Invalid action. Use "grant" or "revoke".' });
    }
};
