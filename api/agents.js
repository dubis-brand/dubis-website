// DUBIS — Agents API
// Vercel Serverless Function  /api/agents
// =====================================================
// Single endpoint for the entire agent system.
// Handles: agent_tasks CRUD + agent_runs logging
//
// Routes (via ?type= query param):
//   GET  ?type=tasks [&status=] [&agent=] [&priority=]  → list tasks
//   POST ?type=tasks  body:{title,agent_id,...}          → create task
//   PATCH ?type=tasks&id=X  body:{status,...}            → update task
//   DELETE ?type=tasks&id=X                              → delete task (admin only)
//   GET  ?type=runs                                      → list runs
//   POST ?type=runs  body:{agent_id,status,...}          → log run
//
// Auth:
//   GET/PATCH/DELETE require valid admin JWT (Authorization: Bearer <token>)
//   POST tasks/runs also accept AGENT_SECRET header for agent scripts
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS, AGENT_SECRET
// =====================================================

const { createClient } = require('@supabase/supabase-js');
const rateLimit        = require('./_rateLimit');

function getAdminEmails() {
    const raw = process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function sbAdmin() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

async function verifyAdmin(req) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return null;

    // Verify with anon client (checks JWT signature)
    const sbAnon = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY || ''
    );
    const { data: { user }, error } = await sbAnon.auth.getUser(token);
    if (error || !user) return null;

    const adminEmails = getAdminEmails();
    if (!adminEmails.includes(user.email.toLowerCase())) return null;
    return user;
}

function isAgentSecret(req) {
    const secret = process.env.AGENT_SECRET || '';
    return secret && req.headers['x-agent-secret'] === secret;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.dubis.net');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-agent-secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;

    const { type, id, status, agent, priority } = req.query;
    const sb = sbAdmin();

    // ── TASKS ─────────────────────────────────────────────────────

    if (type === 'tasks') {

        // GET — list tasks (admin only)
        if (req.method === 'GET') {
            const adminUser = await verifyAdmin(req);
            if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

            let q = sb.from('agent_tasks').select('*').order('created_at', { ascending: false });
            if (status)   q = q.eq('status', status);
            if (agent)    q = q.eq('agent_id', agent);
            if (priority) q = q.eq('priority', priority);

            const { data, error } = await q;
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ tasks: data });
        }

        // POST — create task (admin or agent secret)
        if (req.method === 'POST') {
            const isAdmin = await verifyAdmin(req);
            if (!isAdmin && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

            const { title, agent_id, priority: pri, category, description, content_data, due_date, notes } = req.body || {};
            if (!title || !agent_id) return res.status(400).json({ error: 'title and agent_id required' });

            const { data, error } = await sb.from('agent_tasks').insert({
                title, agent_id,
                priority: pri || 'medium',
                status: 'backlog',
                category: category || null,
                description: description || null,
                content_data: content_data || {},
                due_date: due_date || null,
                notes: notes || null,
            }).select().single();

            if (error) return res.status(500).json({ error: error.message });
            return res.status(201).json({ task: data });
        }

        // PATCH — update task status (admin only)
        if (req.method === 'PATCH') {
            const adminUser = await verifyAdmin(req);
            if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });
            if (!id) return res.status(400).json({ error: 'id required' });

            const allowed = ['backlog','in_progress','pending_approval','approved','done','rejected'];
            const newStatus = req.body?.status;
            if (newStatus && !allowed.includes(newStatus)) return res.status(400).json({ error: 'Invalid status' });

            const update = { ...req.body, updated_at: new Date().toISOString() };
            if (newStatus === 'approved') update.approved_at = new Date().toISOString();

            const { data, error } = await sb.from('agent_tasks').update(update).eq('id', id).select().single();
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ task: data });
        }

        // DELETE — delete task (admin only)
        if (req.method === 'DELETE') {
            const adminUser = await verifyAdmin(req);
            if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });
            if (!id) return res.status(400).json({ error: 'id required' });

            const { error } = await sb.from('agent_tasks').delete().eq('id', id);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ ok: true });
        }
    }

    // ── RUNS ──────────────────────────────────────────────────────

    if (type === 'runs') {

        // GET — list runs (admin only)
        if (req.method === 'GET') {
            const adminUser = await verifyAdmin(req);
            if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

            const { data, error } = await sb.from('agent_runs')
                .select('*').order('created_at', { ascending: false }).limit(100);
            if (error) return res.status(500).json({ error: error.message });
            return res.status(200).json({ runs: data });
        }

        // POST — log a run (agent secret)
        if (req.method === 'POST') {
            if (!isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

            const { agent_id, status: runStatus, summary, tasks_created, duration_ms, error_message } = req.body || {};
            if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

            const { data, error } = await sb.from('agent_runs').insert({
                agent_id,
                status: runStatus || 'completed',
                summary: summary || null,
                tasks_created: tasks_created || 0,
                duration_ms: duration_ms || null,
                error_message: error_message || null,
            }).select().single();

            if (error) return res.status(500).json({ error: error.message });
            return res.status(201).json({ run: data });
        }
    }

    return res.status(400).json({ error: 'Invalid type parameter. Use: tasks, runs' });
};
