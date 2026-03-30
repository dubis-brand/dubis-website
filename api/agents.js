// DUBIS — Agents API
// Vercel Serverless Function  /api/agents
// =====================================================
// ⚠️ CRITICAL: Vercel Hobby plan = MAX 12 Serverless Functions per deploy.
// DO NOT create new .js files in /api/ — always add routes HERE via ?type= param.
// Current API files (12/12): agents, track, checkout, gelato-hook, gelato-products,
// admin/analytics, admin/coupons, admin/gelato-sync, admin/orders, admin/users,
// _rateLimit (helper), _printful (helper).
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

// ── Hebrew text normalization: brand terminology corrections ──
// CRITICAL: DUBIS NEVER uses "הודי" — always "קפוצון"
function fixHebrew(text) {
    if (!text) return text;
    return text
        // "זיפ הודי" → "קפוצון זיפ"
        .replace(/זיפ\s+הודי/g, 'קפוצון זיפ')
        // "הודי זיפ" → "קפוצון זיפ"
        .replace(/הודי\s+זיפ/g, 'קפוצון זיפ')
        // "ההודי" → "הקפוצון"
        .replace(/ההודי/g, 'הקפוצון')
        // "הודיז" / "הודים" → "קפוצונים"
        .replace(/הודי[זם]/g, 'קפוצונים')
        // standalone "הודי" → "קפוצון"
        .replace(/הודי/g, 'קפוצון');
}

// ── Slogan Typography Map — DUBIS mixed-size print style ──
// Each slogan has a KEY POWER WORD in huge bold + smaller setup text
// Format: { small: 'setup text', big: 'POWER WORD', after: 'trailing text', layout: 'top-bottom'|'inline' }
const SLOGAN_TYPOGRAPHY = {
    "I'm not fat, I'm a limited edition":   { small: 'I am not fat, I am a', big: 'LIMITED', after: 'edition.', layout: 'top-bottom' },
    "More of me to love":                    { small: 'more of me', big: 'LOVE', after: '', layout: 'top-bottom' },
    "Napping is my cardio":                  { small: 'NAPPING IS MY', big: 'CARDIO', after: '', layout: 'top-bottom' },
    "I survived. That's enough.":            { small: '', big: 'I survived.', after: "That's enough.", layout: 'top-bottom' },
    "Low maintenance, high value":           { small: 'low maintenance', big: 'VALUE', after: 'high', layout: 'top-bottom' },
    "Not a model. Never wanted to be.":      { small: 'Not a model.', big: 'NEVER.', after: 'wanted to be.', layout: 'top-bottom' },
    "Born to nap, forced to work":           { small: '', big: 'NAP', after: 'Born to nap, forced to work', layout: 'big-top' },
    "Certified overthinker":                 { small: 'certified', big: 'OVER', after: 'thinker.', layout: 'top-bottom' },
    "Serial napper":                         { small: 'serial', big: 'NAPPER', after: '', layout: 'top-bottom' },
    "She believed she could, so she took a nap": { small: 'She believed she could,\nso she took a', big: 'NAP.', after: '', layout: 'top-bottom' },
    "I run on coffee and sarcasm":           { small: '', big: 'COFFEE', after: 'I run on coffee and sarcasm.', layout: 'big-top' },
    "Zero Motivation Club":                  { small: 'Zero Motivation', big: 'CLUB', after: '', layout: 'top-bottom' },
    "Emotionally attached to my couch":      { small: 'emotionally attached to my', big: 'COUCH', after: '', layout: 'top-bottom' },
    "DUBIS — For the rest of us":            { small: 'DUBIS — For the rest of', big: 'US', after: '', layout: 'top-bottom' }
};

function getSloganTypographyPrompt(slogan) {
    const key = Object.keys(SLOGAN_TYPOGRAPHY).find(k => k.toLowerCase() === (slogan || '').toLowerCase());
    const t = key ? SLOGAN_TYPOGRAPHY[key] : null;
    if (!t) return `the text "${(slogan || '').toUpperCase()}" in LARGE bold white sans-serif capital letters`;
    if (t.layout === 'big-top') {
        return `the word "${t.big}" in EXTREMELY LARGE bold white condensed sans-serif capital letters at the top, with "${t.after}" in much smaller white text underneath`;
    }
    const parts = [];
    if (t.small) parts.push(`"${t.small}" in smaller white text`);
    parts.push(`"${t.big}" in EXTREMELY LARGE bold white condensed sans-serif capital letters (3-5x bigger than the other text)`);
    if (t.after) parts.push(`"${t.after}" in smaller white text below`);
    return parts.join(', then ');
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

    // ── RUN ── scan approved tasks and execute agent logic ───────────
    if (type === 'run') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

        const adminUser = await verifyAdmin(req);
        const isCron    = req.headers['x-vercel-cron'] === '1' ||
                          req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
        if (!adminUser && !isCron) return res.status(401).json({ error: 'Unauthorized' });

        // רק משימות approved שה-Owner לא אישר כבר כ-content (content_approved=true)
        const { data: allApproved, error: fetchErr } = await sb
            .from('agent_tasks')
            .select('id, title, agent_id, category, description, notes, priority, content_data')
            .eq('status', 'approved')
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true });

        // סנן החוצה משימות שה-Owner אישר את התוכן שלהן (מוכנות לפרסום, לא לעיבוד)
        const tasks = (allApproved || []).filter(t => !t.content_data?.content_approved);

        if (fetchErr) return res.status(500).json({ error: fetchErr.message });
        if (!tasks || tasks.length === 0) {
            const readyToPublish = (allApproved || []).filter(t => t.content_data?.content_approved).length;
            const msg = readyToPublish > 0
                ? `✅ ${readyToPublish} משימות מוכנות לפרסום (תוכן אושר). אין משימות חדשות לעיבוד.`
                : 'אין משימות approved הממתינות לעיבוד. הוסף משימות ב-backlog והעבר אותן ל-approved.';
            return res.status(200).json({ queued: 0, ready_to_publish: readyToPublish, summary: msg });
        }

        const byAgent = {};
        for (const t of tasks) {
            if (!byAgent[t.agent_id]) byAgent[t.agent_id] = [];
            byAgent[t.agent_id].push(t);
        }

        const now = new Date().toISOString();
        const geminiKey = process.env.GEMINI_API_KEY;
        let queued = 0;
        const summaryLines = [];

        for (const [agent_id, agentTasks] of Object.entries(byAgent)) {
            const ids = agentTasks.map(t => t.id);
            let runStatus = 'completed';
            let taskResults = [];

            // ── Content Agent ──────────────────────────────────────
            if (agent_id === 'content' && geminiKey) {
                for (const task of agentTasks) {
                    try {
                        const cd = task.content_data || {};
                        // Skip only if has captions AND a permanent Supabase image URL
                        const hasPermImg = cd.generated_image_url && cd.generated_image_url.includes('supabase.co');
                        if (cd.caption_he && hasPermImg) {
                            await sb.from('agent_tasks').update({ status: 'pending_approval', updated_at: now }).eq('id', task.id);
                            taskResults.push(`✅ ${task.title}: content קיים → pending_approval`);
                            continue;
                        }
                        // Generate captions (skip if already have caption_he)
                        let gen = {};
                        if (!cd.caption_he) {
                            const isStory = cd.format === 'story';
                            const captionPrompt = isStory
                                ? `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: Write caption_he in Hebrew ONLY. Use "קפוצון" NOT "הודי" for hoodie.
Task: "${task.title}"
Description: "${task.description || ''}"
Format: STORY — Instagram Story. Caption must be SHORT: 1-2 punchy sentences max.
Return ONLY valid JSON (no markdown):
{"caption_he":"טקסט קצר לסטורי בעברית — 1-2 משפטים","caption_en":"Short story text 1-2 lines","hashtags":"#DUBIS #ForTheRestOfUs","image_prompt":"DUBIS brand story background: minimal dark urban aesthetic, no people, no text, moody lighting"}`
                                : `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: Write caption_he in Hebrew ONLY. CRITICAL RULE: use "קפוצון" NOT "הודי" for hoodie. Use "חולצה" for t-shirt.
Task: "${task.title}"
Description: "${task.description || ''}"
Format: ${cd.format || 'feed_post'}
Existing content: "${cd.caption_en || ''}"
Return ONLY valid JSON (no markdown):
{"caption_he":"כיתוב עברית 3-4 משפטים אותנטי, קצר, ישיר","caption_en":"English caption 3-4 sentences","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 tags","image_prompt":"Specific DUBIS photo scene: people in DUBIS streetwear, authentic urban lifestyle, describe exact setting and mood. No text. No logos. Square format."}`
                            const cRes = await fetch(
                                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt }] }] }) }
                            );
                            const cData = await cRes.json();
                            const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            try { gen = JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) { gen = { caption_en: raw.substring(0,200) }; }
                            // Safety: normalize Hebrew terminology
                            if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
                        } else {
                            gen = { caption_he: cd.caption_he, caption_en: cd.caption_en, hashtags: cd.hashtags };
                        }

                        // Generate image: Pollinations → download → Supabase Storage (permanent URL)
                        let imageUrl = hasPermImg ? cd.generated_image_url : '';
                        if (!imageUrl) {
                            const imgPromptText = gen.image_prompt ||
                                (cd.format === 'quote_card'
                                    ? 'Minimalist dark textured background, urban concrete wall, suitable for text overlay. DUBIS Israeli fashion brand aesthetic. No people. No text.'
                                    : `${task.title}, authentic urban lifestyle, DUBIS Israeli clothing brand, real diverse people, dark minimal aesthetic`);
                            const prompt = encodeURIComponent(imgPromptText + '. Fashion photography. No text overlay. No watermark. Square 1:1 format. Photorealistic.');
                            const imgSeed = parseInt(task.id.replace(/-/g,'').substring(0,8), 16) % 999999 + 1;
                            const polUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&model=flux&seed=${imgSeed}`;
                            try {
                                const imgRes = await fetch(polUrl, { signal: AbortSignal.timeout(25000) });
                                if (imgRes.ok) {
                                    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                                    await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                                    const fname = `ig-${task.id}.jpg`;
                                    await sb.storage.from('ig-images').upload(fname, imgBuf, { contentType: 'image/jpeg', upsert: true });
                                    const { data: { publicUrl: imgPubUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                                    imageUrl = imgPubUrl;
                                    console.log(`🖼 Image saved: ${fname}`);
                                } else {
                                    console.log(`⚠️ Pollinations ${imgRes.status} for ${task.id}`);
                                }
                            } catch(imgErr) {
                                console.log(`⚠️ Image timeout: ${task.id} — ${imgErr.message}`);
                            }
                        }

                        await sb.from('agent_tasks').update({
                            content_data: {
                                ...cd,
                                caption_he: gen.caption_he || cd.caption_he || '',
                                caption_en: gen.caption_en || cd.caption_en || '',
                                hashtags:   gen.hashtags   || cd.hashtags   || '',
                                ...(imageUrl ? { generated_image_url: imageUrl } : {})
                            },
                            status: 'pending_approval',
                            notes: (task.notes||'') + `\n✍️ תוכן נוצר ע"י AI — ${new Date().toLocaleDateString('he-IL')}`,
                            updated_at: now,
                        }).eq('id', task.id);
                        taskResults.push(`✅ ${task.title}: תוכן${imageUrl?' + תמונה':' (ללא תמונה)'} → pending_approval`);
                    } catch(e) {
                        await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
                        taskResults.push(`❌ ${task.title}: ${e.message}`);
                        runStatus = 'completed_with_errors';
                    }
                }

            // ── Marketing Agent ────────────────────────────────────
            } else if (agent_id === 'marketing' && geminiKey) {
                const { data: orders } = await sb.from('orders').select('status, total_price, created_at')
                    .gte('created_at', new Date(Date.now()-7*24*60*60*1000).toISOString());
                const revenue7d = (orders||[]).reduce((s,o)=>s+(o.total_price||0),0);
                const orders7d  = (orders||[]).length;
                for (const task of agentTasks) {
                    try {
                        const mRes = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ contents: [{ parts: [{ text:
                                `אתה אנליסט שיווק של DUBIS — מותג בגדים ישראלי.
משימה: ${task.title}
תיאור: ${task.description||''}
נתוני 7 ימים אחרונים: ${orders7d} הזמנות, $${revenue7d.toFixed(2)} הכנסה.
ספק 3-5 המלצות שיווק מעשיות וספציפיות בעברית.`
                              }] }] }) }
                        );
                        const mData = await mRes.json();
                        const analysis = mData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        await sb.from('agent_tasks').update({ notes: analysis, status: 'pending_approval', updated_at: now }).eq('id', task.id);
                        taskResults.push(`✅ ${task.title}: ניתוח נוצר`);
                    } catch(e) {
                        await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
                        taskResults.push(`❌ ${task.title}: ${e.message}`);
                        runStatus = 'completed_with_errors';
                    }
                }

            // ── CTO Agent ──────────────────────────────────────────
            } else if (agent_id === 'cto' && geminiKey) {
                for (const task of agentTasks) {
                    try {
                        const tRes = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ contents: [{ parts: [{ text:
                                `אתה מפתח full-stack בכיר של DUBIS. Stack: Vercel (Node.js serverless), Supabase, Vanilla JS, PayPal, Gelato.
משימה טכנית: ${task.title}
תיאור: ${task.description||''}
קטגוריה: ${task.category||''}
ספק תוכנית יישום טכנית בעברית:
1. ניתוח הבעיה
2. קבצים לשינוי
3. שלבי יישום
4. איך לבדוק`
                              }] }] }) }
                        );
                        const tData = await tRes.json();
                        const plan = tData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        await sb.from('agent_tasks').update({ notes: plan, status: 'in_progress', updated_at: now }).eq('id', task.id);
                        taskResults.push(`✅ ${task.title}: תוכנית טכנית נוצרה`);
                    } catch(e) {
                        await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
                        taskResults.push(`❌ ${task.title}: ${e.message}`);
                        runStatus = 'completed_with_errors';
                    }
                }

            // ── Supply Agent ───────────────────────────────────────
            } else if (agent_id === 'supply') {
                await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).in('id', ids);
                taskResults = agentTasks.map(t => `📦 ${t.title}: בתהליך — סנכרון Gelato רץ אוטומטי בחצות`);

            // ── Default ────────────────────────────────────────────
            } else {
                await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).in('id', ids);
                taskResults = agentTasks.map(t => `⏳ ${t.title}`);
            }

            // Log run
            await sb.from('agent_runs').insert({
                agent_id, status: runStatus,
                summary: taskResults.join('\n'),
                tasks_created: agentTasks.length,
            });

            queued += agentTasks.length;
            summaryLines.push(`${agent_id}: ${agentTasks.length} tasks`);
        }

        console.log(`Agent run completed | ${queued} tasks | ${summaryLines.join(', ')}`);
        return res.status(200).json({ queued, agents: Object.keys(byAgent), summary: summaryLines.join(', ') });
    }

    // ── GENERATE-IMAGE ── generate Instagram image via Gemini Imagen ───
    if (type === 'generate-image') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

        const { task_id, prompt: customPrompt } = req.body || {};
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });

        // Build prompt from task content_data
        let imagePrompt = customPrompt;
        if (task_id && !customPrompt) {
            const { data: task } = await sb.from('agent_tasks')
                .select('title, description, content_data').eq('id', task_id).single();
            if (task) {
                const cd = task.content_data || {};
                const format = cd.format || 'feed_post';

                // ── DUBIS Brand Photography Rules ──
                // DUBIS clothing ALWAYS has English phrases printed on them.
                // The phrase IS the product identity — it MUST appear on the garment in the image.
                // Known slogans: "More of me to love", "I'm not fat, I'm a limited edition",
                //   "Certified Overthinker", "Napping is my cardio", "I survived... That's enough",
                //   "Not a model. Never wanted to be.", "Built different. That's the point."
                // Brand: small DUBIS bear logo on chest area

                // Extract product slogan — this MUST appear on the clothing
                const slogan = cd.product_slogan || '';
                const productType = cd.product_type || '';

                // Build search text for context detection
                const searchText = (task.title + ' ' + (cd.caption || '') + ' ' + (cd.caption_en || '') + ' ' + (cd.caption_he || '') + ' ' + slogan).toLowerCase();

                // Determine the exact garment and phrase
                let garmentDesc = 'oversized casual black t-shirt';
                if (productType.includes('zip') || searchText.includes('zip') || searchText.includes('זיפ')) {
                    garmentDesc = 'dark charcoal zip-up hoodie';
                } else if (productType.includes('hoodie') || searchText.includes('hoodie') || searchText.includes('קפוצון')) {
                    garmentDesc = 'oversized dark hoodie (pullover)';
                } else if (productType.includes('long') || searchText.includes('long sleeve') || searchText.includes('שרוול')) {
                    garmentDesc = 'casual long sleeve shirt';
                } else if (productType.includes('cap') || searchText.includes('cap') || searchText.includes('כובע')) {
                    garmentDesc = 'casual dark cap/hat';
                } else {
                    garmentDesc = 'oversized casual t-shirt';
                }

                // The phrase/slogan on the clothing — CRITICAL for brand identity
                let phraseOnClothing = '';
                if (slogan) {
                    phraseOnClothing = slogan;
                } else if (searchText.includes('overthinker')) {
                    phraseOnClothing = 'Certified Overthinker';
                } else if (searchText.includes('nap') || searchText.includes('cardio')) {
                    phraseOnClothing = 'Napping is my cardio';
                } else if (searchText.includes('limited edition') || searchText.includes('not fat')) {
                    phraseOnClothing = "I'm not fat, I'm a limited edition";
                } else if (searchText.includes('more of me') || searchText.includes('love')) {
                    phraseOnClothing = 'More of me to love';
                } else if (searchText.includes('survived') || searchText.includes('enough')) {
                    phraseOnClothing = "I survived... That's enough";
                } else if (searchText.includes('not a model')) {
                    phraseOnClothing = 'Not a model. Never wanted to be.';
                } else if (searchText.includes('built different')) {
                    phraseOnClothing = "Built different. That's the point.";
                }

                // Setting/mood detection
                let settingDesc = 'urban street setting, warm city background, golden hour';
                if (searchText.includes('behind') || searchText.includes('scenes') || searchText.includes('מאחורי')) {
                    settingDesc = 'clothing workshop or design studio, industrial space, authentic production atmosphere';
                } else if (searchText.includes('shipping') || searchText.includes('free') || searchText.includes('collection') || searchText.includes('קולקציה')) {
                    settingDesc = 'group of friends hanging out, urban cafe, shopping vibes';
                } else if (searchText.includes('relax') || searchText.includes('couch') || searchText.includes('home') || searchText.includes('nap') || searchText.includes('sleep')) {
                    settingDesc = 'cozy home interior, relaxing on sofa, warm ambient lighting';
                } else if (searchText.includes('weekend') || searchText.includes('שבת') || searchText.includes('friday')) {
                    settingDesc = 'relaxed weekend vibes, outdoor cafe terrace, morning light';
                } else if (searchText.includes('morning') || searchText.includes('בוקר') || searchText.includes('coffee')) {
                    settingDesc = 'morning coffee scene, kitchen or cafe, warm sunlight';
                }

                // Person description based on language
                const isHebrew = cd.language === 'he';
                const modelDesc = isHebrew
                    ? 'Israeli man or woman aged 40-50, olive skin, natural body, genuine smile'
                    : 'diverse person aged 35-55, natural body type, authentic confidence';

                const brandRules = 'Photorealistic lifestyle photo, square 1:1 format. DUBIS Israeli streetwear brand. Warm natural lighting, golden hour. NOT a professional model, NOT fitness body. Candid authentic pose.';

                if (cd.image_prompt) {
                    imagePrompt = `${cd.image_prompt}. ${brandRules}`;
                } else if (format === 'quote_card') {
                    imagePrompt = `Minimalist dark charcoal textured background, concrete wall, moody warm lighting, no people. ${brandRules}`;
                } else if (phraseOnClothing) {
                    // KEY: Use mixed-size typography matching actual DUBIS product prints
                    const typoDesc = getSloganTypographyPrompt(phraseOnClothing);
                    imagePrompt = `${modelDesc} wearing a ${garmentDesc}. FRONT: small "DUBIS™" text on left chest only. BACK of garment shows MIXED-SIZE TYPOGRAPHY: ${typoDesc}. Small "DUBIS" at bottom hem of back. ${settingDesc}. ${brandRules}. The power word in the slogan must be 3-5x larger than surrounding text. Bold condensed sans-serif font.`;
                } else {
                    imagePrompt = `${modelDesc} wearing a ${garmentDesc} with "DUBIS" small logo on chest, ${settingDesc}. ${brandRules}`;
                }
            }
        }
        if (!imagePrompt) return res.status(400).json({ error: 'prompt or task_id required' });

        // Generate image via Gemini 2.5 Flash Image Generation → upload to Supabase Storage
        // (Supabase URL is permanent & served with correct Content-Type for Instagram API)
        const fullPrompt = imagePrompt + '. Fashion photography. Square 1:1 format. No watermark. Photorealistic.';

        const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
                }),
                signal: AbortSignal.timeout(60000)
            }
        );
        if (!gRes.ok) {
            const errBody = await gRes.text().catch(() => '');
            return res.status(500).json({ error: `Gemini error ${gRes.status}: ${errBody.substring(0, 200)}` });
        }
        const gData = await gRes.json();
        const imgPart = gData.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
        if (!imgPart?.inlineData) {
            return res.status(500).json({ error: 'Gemini did not return an image. Try a different prompt.' });
        }
        const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');

        // Upload to Supabase Storage (public bucket ig-images)
        await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
        const fileName = `ig-${task_id || 'gen'}-${Date.now()}.jpg`;
        const { error: uploadError } = await sb.storage
            .from('ig-images')
            .upload(fileName, imgBuffer, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) return res.status(500).json({ error: uploadError.message });

        const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fileName);

        // Save permanent Supabase URL into task content_data
        if (task_id) {
            const { data: tsk } = await sb.from('agent_tasks').select('content_data').eq('id', task_id).single();
            const cd = tsk?.content_data || {};
            await sb.from('agent_tasks').update({
                content_data: { ...cd, generated_image_url: publicUrl },
                updated_at: new Date().toISOString()
            }).eq('id', task_id);
        }

        console.log(`🎨 Image generated via Gemini → uploaded to Supabase | ${fileName}`);
        return res.status(200).json({ image_url: publicUrl, prompt_used: imagePrompt });
    }

    // ── PRODUCT IMAGE GENERATION ── generate branded product photos ─────
    if (type === 'generate-product-image') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });

        const body = req.body || {};
        const product_id = body.product_id;
        const scene_type = body.scene_type || body.scene;
        const model_type = body.model_type || body.model;
        const color_variant = body.color_variant || body.color;
        if (!product_id) return res.status(400).json({ error: 'product_id required' });

        // Fetch product
        const { data: product } = await sb.from('dubis_products').select('*').eq('id', product_id).single();
        if (!product) return res.status(404).json({ error: 'Product not found' });

        // Scene descriptions
        const scenes = {
            street: 'Cobblestone European city street with cafes, old stone buildings, pedestrians in background, warm golden hour sunset light',
            home: 'Cozy modern living room, person on sofa or leaning on doorframe, soft natural window light, warm interior',
            studio: 'Clean minimal photo studio, light gray background, soft even professional lighting',
            nature: 'Forest trail with dappled sunlight through trees, earthy natural atmosphere, green foliage',
            cafe: 'Outdoor cafe seating area, wooden tables, urban background, warm morning light, coffee cups on table',
            urban: 'Concrete walls with subtle graffiti, industrial urban area, dramatic directional lighting, moody atmosphere'
        };

        // Model descriptions
        const models = {
            man: 'an average build male in his early 30s, light stubble, relaxed casual posture, friendly expression',
            large_man: 'a larger build confident male in his 30s-40s, full beard, comfortable in his body, warm smile',
            woman: 'an average build woman in her early 30s, natural minimal makeup, genuine warm smile, relaxed body language',
            curvy_woman: 'a curvy confident woman in her 30s, body-positive energy, natural look, radiant smile',
            couple: 'a couple walking together side by side, both wearing matching DUBIS clothing, shot from behind at slight angle',
            older_man: 'a distinguished man in his late 50s, gray hair, weathered face, dignified authentic expression'
        };

        // Pick scene, model, color (use provided or random from preferences)
        const scene = scene_type || (product.scene_preferences || ['street'])[Math.floor(Math.random() * (product.scene_preferences || ['street']).length)];
        const model = model_type || (product.model_preferences || ['man'])[Math.floor(Math.random() * (product.model_preferences || ['man']).length)];
        const colors = product.colors || ['Black'];
        const color = color_variant || colors[Math.floor(Math.random() * colors.length)];

        // Build DUBIS-style prompt with strict brand rules
        const sloganUpper = product.slogan.toUpperCase();
        const sloganTypo = getSloganTypographyPrompt(product.slogan);
        const clothingHeb = { 't-shirt': 't-shirt', 'hoodie': 'hoodie', 'zip-hoodie': 'zip-up hoodie', 'long-sleeve': 'long sleeve shirt', 'cap': 'baseball cap' };
        const clothingName = clothingHeb[product.clothing_type] || product.clothing_type;

        // Rotate between different composition styles for variety
        const compositions = [
          { name: 'diptych', prompt: `Create a photorealistic DSLR-quality diptych photograph split into two halves side by side:
LEFT HALF — FRONT VIEW: ${models[model] || models.man} wearing a ${color} ${clothingName}. On the LEFT CHEST area (heart position), there is a small text "DUBIS" in clean white sans-serif font with a tiny superscript "™". No other text on the front.
RIGHT HALF — BACK VIEW: The SAME person from behind, showing the BACK of the ${color} ${clothingName}. On the UPPER BACK, printed with MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" text at the bottom hem of the back.
SETTING: ${scenes[scene] || scenes.street}` },

          { name: 'back_hero', prompt: `Create a photorealistic DSLR-quality single photograph showing ${models[model] || models.man} from behind at a slight angle (3/4 back view), wearing a ${color} ${clothingName}. On the UPPER BACK, printed with MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" text at the bottom hem of the back. The person is looking slightly over their shoulder with a confident expression. Small "DUBIS™" logo visible on the left chest from the angle.
SETTING: ${scenes[scene] || scenes.street}. Shallow depth of field, the text is the hero of the image.` },

          { name: 'lifestyle', prompt: `Create a photorealistic DSLR-quality lifestyle photograph of ${models[model] || models.man} wearing a ${color} ${clothingName} in a natural candid moment. The person is ${['sitting on a bench laughing', 'walking confidently down the street', 'leaning against a wall with arms crossed', 'holding a coffee cup looking relaxed', 'standing with hands in pockets, genuine smile'][Math.floor(Math.random() * 5)]}. On the BACK of the ${clothingName}, the mixed-size typography text is partially visible: ${sloganTypo}. Small "DUBIS™" on the left chest.
SETTING: ${scenes[scene] || scenes.street}. Shot feels authentic and unposed, like a street photography moment.` },

          { name: 'flat_lay', prompt: `Create a photorealistic DSLR-quality flat lay photograph of a ${color} ${clothingName} neatly laid out on a ${['dark wood table', 'concrete surface', 'cream linen fabric', 'rustic wooden floor'][Math.floor(Math.random() * 4)]}. The ${clothingName} is displayed showing the BACK with MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" text at the bottom hem. Next to it: ${['a coffee mug and sunglasses', 'sneakers and a phone', 'a book and earbuds', 'keys and a wallet'][Math.floor(Math.random() * 4)]}. Top-down camera angle. Clean minimalist styling.` },

          { name: 'close_up_text', prompt: `Create a photorealistic DSLR-quality close-up photograph focusing on the BACK of a ${color} ${clothingName} being worn by ${models[model] || models.man}. The camera is focused tightly on the upper back area showing MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" text at the bottom hem. The background and person are slightly blurred (bokeh). The text is sharp and the hero of the shot.
SETTING: ${scenes[scene] || scenes.street}. Shot at 85mm lens, f/2.0 shallow depth of field.` }
        ];

        // Pick composition based on a hash of product+model+scene for consistent variety
        const compIdx = (product.slogan.length + model.length + scene.length + color.length) % compositions.length;
        const comp = compositions[compIdx];

        const prompt = comp.prompt + `

CRITICAL RULES:
- The ${clothingName} MUST be ${color} color — NOT red, NOT any other color
- The slogan uses MIXED-SIZE TYPOGRAPHY — NOT uniform text. The power word must be 3-5x larger than surrounding text
- The slogan text appears ONLY on the BACK, never on the front
- The front has ONLY the small "DUBIS™" logo on the left chest
- Small "DUBIS" text at the very bottom of the back print
- Real diverse person, NOT a fashion model, body-positive natural look
- No distorted text, all text must be spelled correctly letter by letter
- Bold condensed sans-serif font (like Impact or Helvetica Condensed)
- DSLR realism, natural shadows, warm golden light
- Photorealistic image, not illustration or cartoon`;

        console.log(`🖼 Generating product image: "${product.slogan}" | ${color} ${product.clothing_type} | ${scene} | ${model}`);

        // Generate via Gemini
        const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
                }),
                signal: AbortSignal.timeout(90000)
            }
        );
        if (!gRes.ok) {
            const errBody = await gRes.text().catch(() => '');
            return res.status(500).json({ error: `Gemini error ${gRes.status}: ${errBody.substring(0, 200)}` });
        }
        const gData = await gRes.json();
        const imgPart = gData.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
        if (!imgPart?.inlineData) {
            return res.status(500).json({ error: 'Gemini did not return an image. Try again.' });
        }
        const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');

        // Upload to Supabase Storage
        await sb.storage.createBucket('product-images', { public: true }).catch(() => {});
        const slug = product.slogan.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
        const fileName = `${slug}-${scene}-${model}-${Date.now()}.jpg`;
        const { error: uploadError } = await sb.storage
            .from('product-images')
            .upload(fileName, imgBuffer, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) return res.status(500).json({ error: uploadError.message });

        const { data: { publicUrl } } = sb.storage.from('product-images').getPublicUrl(fileName);

        // Save to dubis_images table
        const { data: imgRecord, error: dbError } = await sb.from('dubis_images').insert({
            product_id: product.id,
            image_url: publicUrl,
            storage_path: fileName,
            scene_type: scene,
            model_type: model,
            color_variant: color,
            prompt_used: prompt,
            tags: [product.category, product.clothing_type, scene, model]
        }).select().single();

        console.log(`✅ Product image saved | ${fileName} | ID: ${imgRecord?.id}`);
        return res.status(200).json({
            image_url: publicUrl,
            image_id: imgRecord?.id,
            product: product.slogan,
            scene: scene,
            model: model,
            color: color
        });
    }

    // ── PRODUCT IMAGES LIST ── get images for gallery / smart match ──────
    if (type === 'product-images') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

        if (req.method === 'GET') {
            const productId = req.query.product_id;
            const approvedParam = req.query.approved;
            let query = sb.from('dubis_images').select('*, dubis_products(slogan, clothing_type, category)').order('created_at', { ascending: false });
            if (productId) query = query.eq('product_id', productId);
            if (approvedParam === 'true') query = query.eq('approved', true);
            if (approvedParam === 'false') query = query.eq('approved', false);
            const { data, error } = await query.limit(100);
            return res.status(200).json(data || []);
        }

        if (req.method === 'PATCH') {
            // Update image: approve, rate, etc.
            const imageId = req.query.id;
            if (!imageId) return res.status(400).json({ error: 'id required' });
            const updates = {};
            const body = req.body || {};
            if (body.approved !== undefined) updates.approved = body.approved;
            if (body.quality_score !== undefined) updates.quality_score = body.quality_score;
            if (body.tags) updates.tags = body.tags;
            const { data, error } = await sb.from('dubis_images').update(updates).eq('id', imageId).select().single();
            return res.status(200).json(data || { error: error?.message });
        }

        if (req.method === 'DELETE') {
            const imageId = req.query.id;
            if (!imageId) return res.status(400).json({ error: 'id required' });
            // Get storage path first
            const { data: img } = await sb.from('dubis_images').select('storage_path').eq('id', imageId).single();
            if (img?.storage_path) {
                await sb.storage.from('product-images').remove([img.storage_path]);
            }
            await sb.from('dubis_images').delete().eq('id', imageId);
            return res.status(200).json({ deleted: true });
        }

        return res.status(200).json([]);
    }

    // ── PRODUCTS CATALOG ── list products for gallery UI ─────────────────
    if (type === 'products-catalog') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });
        const { data } = await sb.from('dubis_products').select('*').eq('active', true).order('category');
        return res.status(200).json(data || []);
    }

    // ── SMART MATCH ── recommend images for a post ──────────────────────
    if (type === 'smart-match') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser) return res.status(401).json({ error: 'Unauthorized' });

        const { caption, task_id } = req.body || {};
        const searchText = caption || '';

        // Get all approved images with product info
        const { data: images } = await sb.from('dubis_images')
            .select('*, dubis_products(slogan, clothing_type, category)')
            .eq('approved', true)
            .order('quality_score', { ascending: false });

        if (!images?.length) {
            return res.status(200).json({ matches: [], message: 'אין תמונות מאושרות בבנק. יש ליצור ולאשר תמונות קודם.' });
        }

        // Score each image by relevance to caption
        const scored = images.map(img => {
            let score = img.quality_score || 1;
            const slogan = img.dubis_products?.slogan?.toLowerCase() || '';
            const captionLower = searchText.toLowerCase();

            // Exact slogan match = huge boost
            if (captionLower.includes(slogan) || slogan.includes(captionLower.substring(0, 20))) score += 10;

            // Keyword matches
            const keywords = slogan.split(/\s+/);
            keywords.forEach(kw => {
                if (kw.length > 3 && captionLower.includes(kw)) score += 2;
            });

            // Penalize overused images
            score -= (img.times_used || 0) * 0.5;

            // Category match (humor, lazy, etc.)
            const tags = img.tags || [];
            if (captionLower.includes('nap') && tags.includes('home')) score += 3;
            if (captionLower.includes('coffee') && tags.includes('cafe')) score += 3;
            if (captionLower.includes('model') && tags.includes('urban')) score += 2;

            return { ...img, relevance_score: Math.max(0, score) };
        });

        scored.sort((a, b) => b.relevance_score - a.relevance_score);
        return res.status(200).json({ matches: scored.slice(0, 5) });
    }

    // ── PUBLISH ── multi-platform post (Instagram + Facebook + TikTok) ─
    if (type === 'publish') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

        const { caption, image_url, task_id, platforms = {} } = req.body || {};
        if (!caption || !image_url) return res.status(400).json({ error: 'caption and image_url required' });

        // Default: Instagram only when platforms not specified (backward compat)
        const doInstagram = platforms.instagram !== false && (platforms.instagram === true || !Object.keys(platforms).length);
        const doFacebook  = platforms.facebook === true;
        const doTikTok    = platforms.tiktok   === true;

        const result = { success: false, errors: [] };

        // ── Instagram ──────────────────────────────────────────────
        if (doInstagram) {
            const igToken   = process.env.INSTAGRAM_ACCESS_TOKEN;
            const igAccount = process.env.INSTAGRAM_ACCOUNT_ID;
            if (!igToken || !igAccount) {
                result.errors.push('Instagram: env vars חסרים (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID)');
            } else {
                try {
                    const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
                    const cRes = await fetch(`${igBase}/media`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image_url, caption, access_token: igToken }),
                    });
                    const container = await cRes.json();
                    if (!cRes.ok || container.error) {
                        result.errors.push('Instagram container: ' + (container.error?.message || 'failed'));
                    } else {
                        const pRes = await fetch(`${igBase}/media_publish`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ creation_id: container.id, access_token: igToken }),
                        });
                        const published = await pRes.json();
                        if (!pRes.ok || published.error) {
                            result.errors.push('Instagram publish: ' + (published.error?.message || 'failed'));
                        } else {
                            result.instagram_post_id = published.id;
                            console.log(`✅ Instagram published | ID: ${published.id}`);
                        }
                    }
                } catch(e) { result.errors.push('Instagram: ' + e.message); }
            }
        }

        // ── Facebook Page (requires pages_manage_posts + pages_read_engagement) ──
        if (doFacebook) {
            const fbPageToken = process.env.FACEBOOK_PAGE_TOKEN;
            const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
            // Build ordered list: dedicated FB token first, then IG token
            const allTokens = [
                fbPageToken ? { name: 'FACEBOOK_PAGE_TOKEN', val: fbPageToken } : null,
                igToken     ? { name: 'INSTAGRAM_ACCESS_TOKEN', val: igToken }  : null,
            ].filter(Boolean);

            if (!allTokens.length) {
                result.errors.push('Facebook: חסר FACEBOOK_PAGE_TOKEN ב-Vercel env vars');
            } else {
                let fbPublished = false;
                for (const tokenObj of allTokens) {
                    if (fbPublished) break;
                    const tryToken = tokenObj.val;
                    try {
                        // 1) Quick token validity check
                        const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${tryToken}`);
                        const meData = await meRes.json();
                        if (meData.error) {
                            const msg = meData.error.message || '';
                            if (msg.includes('expired')) {
                                console.log(`📘 FB token ${tokenObj.name} expired`);
                                if (tokenObj === allTokens[allTokens.length - 1]) {
                                    result.errors.push(`Facebook: הטוקן ${tokenObj.name} פג תוקף. יש לחדש אותו ב-Meta Business Suite → Settings → System Users`);
                                    result.facebook_manual_needed = true;
                                }
                                continue; // try next token
                            }
                        }

                        // 2) Auto-detect page from /me/accounts
                        let fbPageId = null;
                        let pageToken = tryToken;
                        try {
                            const acctRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${tryToken}`);
                            const acctData = await acctRes.json();
                            console.log(`📘 FB /me/accounts (${tokenObj.name}): ${JSON.stringify(acctData.data?.map(p => ({ id: p.id, name: p.name })) || acctData.error || 'no data')}`);
                            if (acctData.data?.length) {
                                const envId = process.env.FACEBOOK_PAGE_ID;
                                const targetPage = (envId && acctData.data.find(p => p.id === envId)) || acctData.data[0];
                                fbPageId = targetPage.id;
                                pageToken = targetPage.access_token || tryToken;
                                console.log(`📘 FB Page selected: ${targetPage.name} (${fbPageId})`);
                            } else if (acctData.error) {
                                console.log(`📘 FB /me/accounts error: ${acctData.error.message}`);
                            } else {
                                console.log(`📘 FB /me/accounts returned 0 pages — token ${tokenObj.name} lacks pages_manage_posts scope`);
                            }
                        } catch(acctErr) {
                            console.log(`📘 FB /me/accounts fetch error: ${acctErr.message}`);
                        }

                        // 3) Fallback to env var
                        if (!fbPageId) fbPageId = process.env.FACEBOOK_PAGE_ID;
                        if (!fbPageId) {
                            if (tokenObj === allTokens[allTokens.length - 1]) {
                                result.errors.push('Facebook: לא נמצא דף פייסבוק. בדוק שה-FACEBOOK_PAGE_TOKEN כולל הרשאת pages_manage_posts או הגדר FACEBOOK_PAGE_ID');
                                result.facebook_manual_needed = true;
                            }
                            continue;
                        }

                        // 4) Try /photos endpoint (image post)
                        const fbRes = await fetch(`https://graph.facebook.com/v21.0/${fbPageId}/photos`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: image_url, message: caption, published: true, access_token: pageToken }),
                        });
                        const fbData = await fbRes.json();
                        if (!fbRes.ok || fbData.error) {
                            console.log(`📘 FB /photos failed: ${fbData.error?.message}, trying /feed...`);
                            // 5) Fallback to /feed
                            const feedRes = await fetch(`https://graph.facebook.com/v21.0/${fbPageId}/feed`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ message: caption, link: image_url, published: true, access_token: pageToken }),
                            });
                            const feedData = await feedRes.json();
                            if (!feedRes.ok || feedData.error) {
                                const errMsg = feedData.error?.message || fbData.error?.message || 'publish failed';
                                console.log(`📘 FB /feed also failed: ${errMsg}`);
                                if (tokenObj === allTokens[allTokens.length - 1]) {
                                    result.errors.push('Facebook: ' + errMsg);
                                    result.facebook_manual_needed = true;
                                }
                            } else {
                                result.facebook_post_id = feedData.id;
                                fbPublished = true;
                                console.log(`✅ Facebook published via /feed | ID: ${feedData.id}`);
                            }
                        } else {
                            result.facebook_post_id = fbData.post_id || fbData.id;
                            fbPublished = true;
                            console.log(`✅ Facebook published via /photos | ID: ${result.facebook_post_id}`);
                        }
                    } catch(e) {
                        if (tokenObj === allTokens[allTokens.length - 1]) {
                            result.errors.push('Facebook: ' + e.message);
                            result.facebook_manual_needed = true;
                        }
                    }
                }
            }
        }

        // ── TikTok (placeholder) ───────────────────────────────────
        if (doTikTok) {
            const tikToken = process.env.TIKTOK_ACCESS_TOKEN;
            result.tiktok_note = tikToken
                ? 'TikTok Content API עדיין לא ממומש — בקרוב'
                : 'TikTok: חסר TIKTOK_ACCESS_TOKEN — דורש OAuth נפרד';
        }

        // Overall success
        const anyPublished = !!(result.instagram_post_id || result.facebook_post_id);
        const allFailed    = (doInstagram || doFacebook) && !anyPublished;
        if (allFailed && result.errors.length) {
            return res.status(500).json({ ...result, error: result.errors.join('; ') });
        }
        result.success = true;

        // Mark task done
        if (task_id && anyPublished) {
            const notes = [
                result.instagram_post_id ? `Instagram: ${result.instagram_post_id}` : null,
                result.facebook_post_id  ? `Facebook: ${result.facebook_post_id}`   : null,
            ].filter(Boolean).join(' | ');
            await sb.from('agent_tasks').update({
                status: 'done', notes: `Published. ${notes}`,
                updated_at: new Date().toISOString()
            }).eq('id', task_id);
        }

        return res.status(200).json(result);
    }

    // ── GEMINI-MODELS ── debug: list available Gemini models ────────────────────────
    if (type === 'gemini-models') {
        const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const token  = req.query.token || req.headers['x-agent-secret'] || '';
        if (!svcKey || token !== svcKey) return res.status(401).json({ error: 'Unauthorized' });
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return res.status(200).json({ error: 'No GEMINI_API_KEY' });
        const mRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=100`);
        const mData = await mRes.json();
        const imageModels = (mData.models || []).filter(m =>
            m.name?.toLowerCase().includes('image') ||
            m.supportedGenerationMethods?.includes('generateContent')
        ).map(m => ({ name: m.name, methods: m.supportedGenerationMethods, description: m.description?.substring(0,80) }));
        return res.status(200).json({ total: mData.models?.length, imageRelated: imageModels });
    }

    // ── CONTENT-RUN ── GET endpoint for triggering content agent (service role auth) ─
    if (type === 'content-run') {
        // Auth: service role key via query param or x-agent-secret header
        const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const token  = req.query.token || req.headers['x-agent-secret'] || '';
        if (!svcKey || token !== svcKey) return res.status(401).json({ error: 'Unauthorized' });

        // Re-use same logic as type=run but inline for content agent only
        const geminiKey = process.env.GEMINI_API_KEY;
        // Fetch both 'approved' AND 'pending_approval' tasks that are missing a permanent Supabase image
        const { data: approvedTasks } = await sb
            .from('agent_tasks')
            .select('id, title, agent_id, category, description, notes, priority, content_data')
            .eq('status', 'approved')
            .eq('agent_id', 'content')
            .order('created_at', { ascending: true });

        const { data: pendingTasks } = await sb
            .from('agent_tasks')
            .select('id, title, agent_id, category, description, notes, priority, content_data')
            .eq('status', 'pending_approval')
            .eq('agent_id', 'content')
            .order('created_at', { ascending: true });

        const allTasks = [...(approvedTasks || []), ...(pendingTasks || [])];

        // Include ALL tasks that are missing a permanent Supabase image
        const tasks = allTasks.filter(t => {
            const img = t.content_data?.generated_image_url || '';
            return !img.includes('supabase.co'); // still needs an image
        });
        if (!tasks.length) return res.status(200).json({ queued: 0, summary: 'All content tasks already have Supabase images ✅' });

        // Process 1 task per call — Pollinations can take up to 50s/image (90s Vercel limit)
        const batch = tasks.slice(0, 1);

        const now = new Date().toISOString();
        const taskResults = [];

        for (const task of batch) {
            try {
                const cd = task.content_data || {};
                const hasPermImg = cd.generated_image_url && cd.generated_image_url.includes('supabase.co');
                if (cd.caption_he && hasPermImg) {
                    await sb.from('agent_tasks').update({ status: 'pending_approval', updated_at: now }).eq('id', task.id);
                    taskResults.push(`✅ ${task.title}: content קיים → pending_approval`);
                    continue;
                }

                let gen = {};
                if (!cd.caption_he && geminiKey) {
                    const isStory2 = cd.format === 'story';
                    const captionPrompt2 = isStory2
                        ? `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: caption_he must be in Hebrew ONLY. Use "קפוצון" NOT "הודי" for hoodie.
Task: "${task.title}"
Description: "${task.description || ''}"
Notes: "${task.notes || ''}"
Format: STORY — Instagram Story. Caption must be SHORT: 1-2 punchy sentences max.
Return ONLY valid JSON:
{"caption_he":"טקסט קצר לסטורי בעברית — 1-2 משפטים","caption_en":"Short story text 1-2 lines","hashtags":"#DUBIS #ForTheRestOfUs","image_prompt":"DUBIS brand story background: minimal dark urban aesthetic, no people, no text, moody lighting"}`
                        : `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: caption_he must be in Hebrew ONLY. CRITICAL RULE: use "קפוצון" NOT "הודי" for hoodie. Use "חולצה" for t-shirt.
Task: "${task.title}"
Description: "${task.description || ''}"
Notes: "${task.notes || ''}"
Format: ${cd.format || 'feed_post'}
Generate a social media post. Return ONLY valid JSON:
{"caption_he":"כיתוב עברית 3-4 משפטים אותנטי, קצר, ישיר","caption_en":"English caption 3-4 sentences","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 tags","image_prompt":"Specific DUBIS photo scene: people in DUBIS streetwear, authentic urban lifestyle, describe exact setting and mood. No text. No logos. Square format."}`;
                    const cRes = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt2 }] }] }) }
                    );
                    const cData = await cRes.json();
                    const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    try { gen = JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) { gen = { caption_en: raw.substring(0,200) }; }
                    // Safety: normalize Hebrew terminology
                    if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
                } else {
                    gen = { caption_he: cd.caption_he, caption_en: cd.caption_en, hashtags: cd.hashtags };
                }

                let imageUrl = hasPermImg ? cd.generated_image_url : '';
                let imgError = '';
                if (!imageUrl) {
                    // Build contextual image prompt based on post format and content
                    // RULE: phrases on clothing are ALWAYS in English (as on dubis.net)
                    // RULE: all images with people must show them wearing DUBIS clothing with English phrase
                    const titleLower = task.title.toLowerCase();
                    const dubisRule = 'Israeli streetwear brand aesthetic. Real diverse body types, authentic candid look. Plain black/dark oversized clothing WITHOUT any visible text, logos, or brand names on the garments. Dark minimal urban tones with gold/beige accents. IMPORTANT: Do NOT render any text, words, letters, or logos anywhere in the image.';
                    const defaultImgPrompt = cd.format === 'quote_card'
                        ? 'Minimalist dark charcoal textured background. Moody low-key lighting. No people. No text. No logos. Suitable for text overlay. Square 1:1 format.'
                        : cd.format === 'story'
                        ? 'Clean minimal dark urban background, charcoal tones. No people. No text. No logos. Suitable for Instagram Story text overlay.'
                        : titleLower.includes('nap') || titleLower.includes('cardio') || titleLower.includes('sleep')
                        ? `Person relaxing on couch wearing oversized dark DUBIS hoodie with "NAPPING IS MY CARDIO" printed in white on front. Cozy apartment, soft warm lighting, peaceful expression. ${dubisRule}`
                        : titleLower.includes('limited') || titleLower.includes('edition')
                        ? `Confident person wearing DUBIS t-shirt with "I'M NOT FAT, I'M A LIMITED EDITION" printed on it. Urban rooftop, golden hour lighting. ${dubisRule}`
                        : titleLower.includes('more of me') || titleLower.includes('love')
                        ? `Person smiling wearing DUBIS oversized t-shirt with "MORE OF ME TO LOVE" printed on front. City street, natural light. ${dubisRule}`
                        : titleLower.includes('shipping') || titleLower.includes('free')
                        ? `Group of real people wearing DUBIS hoodies and t-shirts with English phrases, shopping bags, happy mood, urban setting. ${dubisRule}`
                        : titleLower.includes('behind') || titleLower.includes('scenes')
                        ? `Clothing workshop/studio with workers creating DUBIS garments, dark industrial space, authentic production atmosphere. ${dubisRule}`
                        : `Authentic people wearing DUBIS streetwear with English brand phrases on clothing, urban minimal setting, dark aesthetic, natural lighting, square 1:1. ${dubisRule}`;
                    const imgPromptText = gen.image_prompt || defaultImgPrompt;
                    const fullPrompt = imgPromptText + '. Fashion photography. Square 1:1. No watermark. Photorealistic.';

                    // ── Primary: Gemini 2.0 Flash Image Generation ──────────────
                    const geminiImgKey = process.env.GEMINI_API_KEY;
                    if (geminiImgKey && !imageUrl) {
                        try {
                            const gRes = await fetch(
                                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiImgKey}`,
                                {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        contents: [{ parts: [{ text: fullPrompt }] }],
                                        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
                                    }),
                                    signal: AbortSignal.timeout(55000)
                                }
                            );
                            if (gRes.ok) {
                                const gData = await gRes.json();
                                const imgPart = gData.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
                                if (imgPart?.inlineData) {
                                    const imgBuf = Buffer.from(imgPart.inlineData.data, 'base64');
                                    await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                                    const fname = `ig-${task.id}.jpg`;
                                    const { error: upErr } = await sb.storage.from('ig-images').upload(fname, imgBuf, { contentType: imgPart.inlineData.mimeType || 'image/jpeg', upsert: true });
                                    if (upErr) {
                                        imgError = `gemini_upload:${upErr.message}`;
                                        console.log(`⚠️ Gemini upload err ${task.id}: ${upErr.message}`);
                                    } else {
                                        const { data: { publicUrl: imgPubUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                                        imageUrl = imgPubUrl;
                                        console.log(`✅ Gemini image uploaded: ${imgPubUrl}`);
                                    }
                                } else {
                                    const parts = gData.candidates?.[0]?.content?.parts || [];
                                    imgError = `gemini_no_img:${JSON.stringify(parts.map(p => p.text ? 'text' : Object.keys(p))).substring(0,80)}`;
                                    console.log(`⚠️ Gemini returned no image for ${task.id}: ${imgError}`);
                                }
                            } else {
                                const errBody = await gRes.text().catch(() => '');
                                imgError = `gemini_${gRes.status}:${errBody.substring(0,80)}`;
                                console.log(`⚠️ Gemini HTTP ${gRes.status} for ${task.id}: ${errBody.substring(0,100)}`);
                            }
                        } catch(gErr) {
                            imgError = `gemini_catch:${gErr.message}`;
                            console.log(`⚠️ Gemini image error ${task.id}: ${gErr.message}`);
                        }
                    }

                    // ── Fallback: Pollinations (requires POLLINATIONS_TOKEN for server) ──
                    const polToken = process.env.POLLINATIONS_TOKEN || '';
                    if (!imageUrl && polToken) {
                        try {
                            const prompt = encodeURIComponent(fullPrompt);
                            const imgSeed = parseInt(task.id.replace(/-/g,'').substring(0,8), 16) % 999999 + 1;
                            const polUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&model=flux&seed=${imgSeed}&token=${polToken}`;
                            const imgRes = await fetch(polUrl, { signal: AbortSignal.timeout(55000) });
                            if (imgRes.ok) {
                                const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                                await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                                const fname = `ig-${task.id}.jpg`;
                                const { error: upErr } = await sb.storage.from('ig-images').upload(fname, imgBuf, { contentType: 'image/jpeg', upsert: true });
                                if (upErr) {
                                    imgError += ` pol_upload:${upErr.message}`;
                                } else {
                                    const { data: { publicUrl: imgPubUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                                    imageUrl = imgPubUrl;
                                    console.log(`✅ Pollinations image: ${imgPubUrl}`);
                                }
                            } else {
                                const errBody = await imgRes.text().catch(() => '');
                                imgError += ` pol_${imgRes.status}:${errBody.substring(0,60)}`;
                            }
                        } catch(polErr) {
                            imgError += ` pol_catch:${polErr.message}`;
                        }
                    }
                }

                const newCd = { ...cd, ...gen, generated_image_url: imageUrl || cd.generated_image_url || '' };
                await sb.from('agent_tasks').update({
                    status: 'pending_approval',
                    content_data: newCd,
                    updated_at: now
                }).eq('id', task.id);
                const imgStatus = imageUrl ? '🖼 תמונה+כיתוב' : `⚠️ כיתוב בלבד [${imgError}]`;
                taskResults.push(`✅ ${task.title}: ${imgStatus} → pending_approval`);
            } catch(e) {
                taskResults.push(`❌ ${task.title}: ${e.message}`);
            }
        }

        return res.status(200).json({ queued: taskResults.length, remaining: tasks.length - batch.length, results: taskResults });
    }

    // ── FB-DEBUG ── diagnose Facebook token & page issues ──
    if (type === 'fb-debug') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

        const diag = {
            has_fb_page_token: !!process.env.FACEBOOK_PAGE_TOKEN,
            has_ig_token: !!process.env.INSTAGRAM_ACCESS_TOKEN,
            fb_page_id_env: process.env.FACEBOOK_PAGE_ID || '(not set)',
            tokens_checked: []
        };

        const allTokens = [
            { name: 'FACEBOOK_PAGE_TOKEN', val: process.env.FACEBOOK_PAGE_TOKEN },
            { name: 'INSTAGRAM_ACCESS_TOKEN', val: process.env.INSTAGRAM_ACCESS_TOKEN }
        ].filter(t => t.val);

        for (const t of allTokens) {
            const info = { token_name: t.name, results: {} };
            try {
                // Check /me — who is this token?
                const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${t.val}`);
                info.results.me = await meRes.json();
            } catch(e) { info.results.me = { error: e.message }; }
            try {
                // Check /me/accounts — what pages does this token manage?
                const acctRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${t.val}`);
                const acctData = await acctRes.json();
                info.results.pages = acctData.data?.map(p => ({ id: p.id, name: p.name, has_page_token: !!p.access_token })) || acctData.error || 'no data';
            } catch(e) { info.results.pages = { error: e.message }; }
            try {
                // Check token debug info
                const debugRes = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${t.val}&access_token=${t.val}`);
                const debugData = await debugRes.json();
                if (debugData.data) {
                    info.results.token_info = {
                        app_id: debugData.data.app_id,
                        type: debugData.data.type,
                        is_valid: debugData.data.is_valid,
                        expires_at: debugData.data.expires_at ? new Date(debugData.data.expires_at * 1000).toISOString() : 'never',
                        scopes: debugData.data.scopes
                    };
                } else {
                    info.results.token_info = debugData.error || debugData;
                }
            } catch(e) { info.results.token_info = { error: e.message }; }
            diag.tokens_checked.push(info);
        }

        return res.json(diag);
    }

    // ── PUBLISH-READY ── auto-publish all content_approved tasks with Supabase image ──
    if (type === 'publish-ready') {
        // Auth: svcKey OR AGENT_SECRET, via query param, x-agent-secret header, or Authorization Bearer
        const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const agentSecret = process.env.AGENT_SECRET || '';
        const token = req.query.token || req.headers['x-agent-secret'] || req.headers['authorization']?.replace('Bearer ','').trim() || '';
        const isAuthed = (svcKey && token === svcKey) || (agentSecret && token === agentSecret);
        console.log(`[publish-ready] token_len=${token.length} svc_len=${svcKey.length} agent_len=${agentSecret.length} ok=${isAuthed}`);
        if (!isAuthed) return res.status(401).json({ error: 'Unauthorized', debug: { token_len: token.length, svc_len: svcKey.length, agent_len: agentSecret.length } });

        const igToken   = process.env.INSTAGRAM_ACCESS_TOKEN;
        const igAccount = process.env.INSTAGRAM_ACCOUNT_ID;
        if (!igToken || !igAccount) return res.status(503).json({ error: 'Instagram env vars חסרים' });

        // Fetch all pending_approval content tasks with content_approved=true
        const { data: candidates, error: fetchErr } = await sb
            .from('agent_tasks')
            .select('id, title, content_data')
            .eq('status', 'pending_approval')
            .eq('agent_id', 'content')
            .order('created_at', { ascending: true });

        if (fetchErr) return res.status(500).json({ error: fetchErr.message });

        // Only tasks with supabase image + content_approved — default 1 post per call
        const batch = parseInt(req.query.batch || '1', 10);
        const readyTasks = (candidates || [])
            .filter(t => {
                const img = t.content_data?.generated_image_url || '';
                return t.content_data?.content_approved && img.includes('supabase.co');
            })
            .slice(0, batch);

        if (!readyTasks.length) return res.status(200).json({ published: 0, summary: 'אין משימות מוכנות לפרסום עדיין' });

        const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
        const results = [];
        const now = new Date().toISOString();

        for (const task of readyTasks) {
            const cd = task.content_data || {};
            const caption = `${cd.caption_he || cd.caption_en || task.title}\n\n${cd.hashtags || '#DUBIS #ForTheRestOfUs'}`;
            const image_url = cd.generated_image_url;

            try {
                // Create media container
                const cRes = await fetch(`${igBase}/media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_url, caption, access_token: igToken }),
                });
                const container = await cRes.json();
                if (!cRes.ok || container.error) {
                    results.push({ id: task.id, title: task.title, status: 'error', error: container.error?.message || 'container failed' });
                    continue;
                }
                // Wait for Instagram to process the media container (required)
                await new Promise(r => setTimeout(r, 7000));
                // Publish
                const pRes = await fetch(`${igBase}/media_publish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ creation_id: container.id, access_token: igToken }),
                });
                const pub = await pRes.json();
                if (!pRes.ok || pub.error) {
                    results.push({ id: task.id, title: task.title, status: 'error', error: pub.error?.message || 'publish failed' });
                    continue;
                }
                // Mark as done
                await sb.from('agent_tasks').update({
                    status: 'done',
                    content_data: { ...cd, instagram_post_id: pub.id, published_at: now },
                    updated_at: now
                }).eq('id', task.id);
                results.push({ id: task.id, title: task.title, status: 'published', ig_id: pub.id });
            } catch (e) {
                results.push({ id: task.id, title: task.title, status: 'error', error: e.message });
            }
        }

        const published = results.filter(r => r.status === 'published').length;
        return res.status(200).json({
            published,
            total_ready: readyTasks.length,
            remaining: (candidates || []).filter(t => {
                const img = t.content_data?.generated_image_url || '';
                return t.content_data?.content_approved && img.includes('supabase.co');
            }).length - readyTasks.length,
            results
        });
    }

    // ══════════════════════════════════════════════════════════════════
    // ── HEYGEN REELS ── AI video generation via HeyGen API
    // ══════════════════════════════════════════════════════════════════

    const HEYGEN_BASE = 'https://api.heygen.com';
    const heygenKey = process.env.HEYGEN_API_KEY;

    // ── AVATARS ── list available HeyGen avatars ──
    if (type === 'avatars') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (!heygenKey) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured' });

        try {
            const r = await fetch(`${HEYGEN_BASE}/v2/avatars`, {
                headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
            });
            const data = await r.json();
            if (!r.ok || data.error) return res.status(r.status).json({ error: data.error?.message || 'Failed to list avatars' });

            // Return simplified list for the frontend
            const avatars = (data.data?.avatars || []).map(a => ({
                avatar_id: a.avatar_id,
                avatar_name: a.avatar_name,
                gender: a.gender,
                preview_image_url: a.preview_image_url,
                preview_video_url: a.preview_video_url
            }));
            return res.json({ avatars, total: avatars.length });
        } catch(e) {
            return res.status(500).json({ error: 'HeyGen avatars: ' + e.message });
        }
    }

    // ── VOICES ── list available HeyGen voices ──
    if (type === 'voices') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (!heygenKey) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured' });

        const lang = req.query.lang || ''; // optional filter: 'Hebrew', 'English'
        try {
            const r = await fetch(`${HEYGEN_BASE}/v2/voices`, {
                headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
            });
            const data = await r.json();
            if (!r.ok || data.error) return res.status(r.status).json({ error: data.error?.message || 'Failed to list voices' });

            let voices = data.data?.voices || [];
            if (lang) {
                const langLower = lang.toLowerCase();
                voices = voices.filter(v => (v.language || '').toLowerCase().includes(langLower));
            }
            const simplified = voices.map(v => ({
                voice_id: v.voice_id,
                name: v.name || v.display_name,
                language: v.language,
                gender: v.gender,
                preview_audio: v.preview_audio
            }));
            return res.json({ voices: simplified, total: simplified.length });
        } catch(e) {
            return res.status(500).json({ error: 'HeyGen voices: ' + e.message });
        }
    }

    // ── HEYGEN-STATUS ── check API key, quota, plan info ──
    if (type === 'heygen-status') {
        if (!heygenKey) return res.json({ error: 'HEYGEN_API_KEY not configured' });
        const results = {};
        // Check remaining quota
        try {
            const r1 = await fetch(`${HEYGEN_BASE}/v2/user/remaining_quota`, {
                headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
            });
            results.quota = { status: r1.status, data: await r1.json() };
        } catch(e) { results.quota = { error: e.message }; }
        // Check video generate with minimal test (dry run)
        try {
            const r2 = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
                method: 'POST',
                headers: { 'X-Api-Key': heygenKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ test: true, video_inputs: [], dimension: { width: 100, height: 100 } })
            });
            results.video_generate = { status: r2.status, data: await r2.json() };
        } catch(e) { results.video_generate = { error: e.message }; }
        // Check token info
        try {
            const r3 = await fetch(`${HEYGEN_BASE}/v1/video_list.get?limit=1`, {
                headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
            });
            results.video_list = { status: r3.status, data: await r3.json() };
        } catch(e) { results.video_list = { error: e.message }; }
        return res.json({ heygen_key_prefix: heygenKey.substring(0, 12) + '...', results });
    }

    // ── UPLOAD-REEL-PHOTO ── upload base64 image to Supabase storage, return public URL ──
    if (type === 'upload-reel-photo') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

        const { image_base64, filename } = req.body || {};
        if (!image_base64) return res.status(400).json({ error: 'image_base64 is required' });

        try {
            // Parse base64 data URL
            const matches = image_base64.match(/^data:(.+?);base64,(.+)$/);
            if (!matches) return res.status(400).json({ error: 'Invalid base64 data URL' });
            const contentType = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
            const storagePath = `reel-photos/${Date.now()}_${(filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '')}.${ext}`;

            console.log(`📸 Uploading reel photo to Supabase: ${storagePath} (${buffer.length} bytes)`);
            const sb = sbAdmin();
            const { data, error } = await sb.storage.from('ig-images').upload(storagePath, buffer, {
                contentType,
                upsert: true
            });
            if (error) throw new Error(error.message);

            const { data: urlData } = sb.storage.from('ig-images').getPublicUrl(storagePath);
            const publicUrl = urlData?.publicUrl;
            if (!publicUrl) throw new Error('Failed to get public URL');

            console.log(`📸 Reel photo uploaded: ${publicUrl}`);
            return res.json({ success: true, url: publicUrl, path: storagePath });
        } catch(e) {
            console.log(`📸 Reel photo upload error: ${e.message}`);
            return res.status(500).json({ error: 'Upload failed: ' + e.message });
        }
    }

    // ── UPLOAD-TALKING-PHOTO ── upload image to HeyGen for Talking Photo avatar ──
    if (type === 'upload-talking-photo') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (!heygenKey) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured' });

        const { image_url } = req.body || {};
        if (!image_url) return res.status(400).json({ error: 'image_url is required' });

        try {
            // Download image from URL
            console.log(`🎬 Downloading image for talking photo: ${image_url.substring(0, 80)}...`);
            const imgResponse = await fetch(image_url);
            if (!imgResponse.ok) return res.status(400).json({ error: 'Failed to download image from URL' });
            const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

            // Upload to HeyGen
            console.log(`🎬 Uploading talking photo to HeyGen (${imgBuffer.length} bytes)...`);
            const r = await fetch('https://upload.heygen.com/v1/talking_photo', {
                method: 'POST',
                headers: {
                    'X-Api-Key': heygenKey,
                    'Content-Type': contentType
                },
                body: imgBuffer
            });
            const data = await r.json();
            console.log(`🎬 HeyGen upload response: ${JSON.stringify(data).substring(0, 300)}`);

            if (data.error || !data.data?.talking_photo_id) {
                const errMsg = data.error?.message || data.message || 'Upload failed';
                return res.status(400).json({ error: errMsg });
            }

            return res.json({
                success: true,
                talking_photo_id: data.data.talking_photo_id,
                talking_photo_url: data.data.talking_photo_url || null
            });
        } catch(e) {
            console.log(`🎬 Talking photo upload error: ${e.message}`);
            return res.status(500).json({ error: 'Upload failed: ' + e.message });
        }
    }

    // ── GENERATE-REEL ── create AI video via HeyGen ──
    if (type === 'generate-reel') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) {
            const hasAuth = !!(req.headers['authorization'] || '').replace('Bearer ', '').trim();
            console.log(`🎬 generate-reel auth failed | hasAuth: ${hasAuth} | headers: ${Object.keys(req.headers).join(',')}`);
            return res.status(401).json({ error: hasAuth ? 'Token פג תוקף — רענן את הדף ונסה שוב' : 'Unauthorized — חסר token' });
        }
        if (!heygenKey) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured' });

        const { task_id, script, avatar_id, talking_photo_id, voice_id, voice_gender, language, title, motion_prompt } = req.body || {};
        if (!script) return res.status(400).json({ error: 'script is required' });

        // ── FIX #1: Clean the script — strip hashtags, links, emojis-only lines ──
        // Only the spoken dialogue should be sent to HeyGen, NOT captions/hashtags
        const cleanScript = script
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                if (!trimmed) return false;
                if (trimmed.startsWith('#')) return false;           // hashtag lines
                if (trimmed.startsWith('🔗')) return false;          // link lines
                if (trimmed.match(/^https?:\/\//)) return false;     // URL lines
                if (trimmed.match(/^[#@🔗📸🎬💛🔥✨💪👆👇]+$/)) return false; // emoji-only lines
                return true;
            })
            .join('\n')
            .replace(/#\w+/g, '')     // remove inline hashtags
            .replace(/🔗\s*קישור\s*בביו/g, '') // remove "link in bio" in Hebrew
            .replace(/\s+/g, ' ')     // normalize whitespace
            .trim();

        if (!cleanScript) return res.status(400).json({ error: 'Script is empty after cleanup — only hashtags/links found' });
        console.log(`🎬 Script cleaned: "${script.substring(0, 60)}..." → "${cleanScript.substring(0, 60)}..."`);

        const useTalkingPhoto = !!talking_photo_id;
        const chosenAvatar = avatar_id || 'Daisy-inskirt-20220818';

        // ── FIX #2: Voice gender matching — match to the character, not always female ──
        let chosenVoice = voice_id;
        const requestedGender = voice_gender || null; // 'male' | 'female' | null (auto)
        if (!chosenVoice || chosenVoice === 'default') {
            try {
                const lang = language === 'he' ? 'Hebrew' : (language || 'English');
                console.log(`🎬 Auto-resolving voice | lang: ${lang} | gender: ${requestedGender || 'auto'}`);
                const vr = await fetch(`${HEYGEN_BASE}/v2/voices`, {
                    headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
                });
                const vdata = await vr.json();
                const allVoices = vdata.data?.voices || [];
                // Filter by language
                const langVoices = allVoices.filter(v =>
                    (v.language || '').toLowerCase().includes(lang.toLowerCase())
                );
                if (langVoices.length > 0) {
                    // Match voice gender to the character (if specified), else first match
                    let genderMatch = null;
                    if (requestedGender) {
                        genderMatch = langVoices.find(v => (v.gender || '').toLowerCase() === requestedGender.toLowerCase());
                    }
                    chosenVoice = (genderMatch || langVoices[0]).voice_id;
                    console.log(`🎬 Auto-selected voice: ${chosenVoice} (${(genderMatch || langVoices[0]).name || 'unnamed'} | gender: ${(genderMatch || langVoices[0]).gender || '?'})`);
                } else if (allVoices.length > 0) {
                    const enVoices = allVoices.filter(v => (v.language || '').toLowerCase().includes('english'));
                    chosenVoice = (enVoices[0] || allVoices[0]).voice_id;
                    console.log(`🎬 No ${lang} voices found, fallback to: ${chosenVoice}`);
                } else {
                    return res.status(500).json({ error: 'No voices available from HeyGen' });
                }
            } catch(voiceErr) {
                console.log(`🎬 Voice auto-resolve error: ${voiceErr.message}`);
                return res.status(500).json({ error: 'Failed to resolve voice: ' + voiceErr.message });
            }
        }

        try {
            // Build character object — Talking Photo or Avatar
            const character = useTalkingPhoto
                ? { type: 'talking_photo', talking_photo_id: talking_photo_id }
                : { type: 'avatar', avatar_id: chosenAvatar, avatar_style: 'normal' };
            console.log(`🎬 Mode: ${useTalkingPhoto ? 'Talking Photo' : 'Avatar'} | ID: ${useTalkingPhoto ? talking_photo_id : chosenAvatar}`);

            // ── FIX #3: Motion prompt for natural movement ──
            const defaultMotion = 'The person speaks naturally with hand gestures, slight body movement, and genuine facial expressions. They occasionally look around and shift weight between feet, like a real person talking to a friend.';
            const motionText = motion_prompt || defaultMotion;

            // Build HeyGen video request — use clean script only (no hashtags/captions)
            const videoPayload = {
                video_inputs: [{
                    character: {
                        ...character,
                        ...(useTalkingPhoto ? {} : { motion_prompt: motionText })
                    },
                    voice: {
                        type: 'text',
                        input_text: cleanScript,
                        voice_id: chosenVoice,
                        speed: 1.0
                    },
                    background: {
                        type: 'color',
                        value: '#1a1a1a' // DUBIS dark aesthetic
                    }
                }],
                dimension: {
                    width: 1080,
                    height: 1920 // 9:16 vertical for Reels
                },
                callback_id: task_id || `reel_${Date.now()}`
            };

            console.log(`🎬 HeyGen generate-reel | voice: ${chosenVoice} | gender: ${requestedGender || 'auto'} | cleanScript: ${cleanScript.substring(0, 80)}...`);

            const r = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
                method: 'POST',
                headers: {
                    'X-Api-Key': heygenKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(videoPayload)
            });
            const data = await r.json();

            if (!r.ok || data.error) {
                const errMsg = data.error?.message || data.message || JSON.stringify(data.error) || JSON.stringify(data) || 'Video generation failed';
                console.log(`🎬 HeyGen error (${r.status}): ${errMsg}`);
                console.log(`🎬 HeyGen full response: ${JSON.stringify(data).substring(0, 500)}`);
                return res.status(r.status || 500).json({ error: errMsg });
            }

            const videoId = data.data?.video_id;
            console.log(`🎬 HeyGen video created | video_id: ${videoId}`);

            // If task_id provided, update the task with reel info
            if (task_id) {
                try {
                    // Get current task
                    const { data: task } = await sb.from('agent_tasks').select('content_data').eq('id', task_id).single();
                    const cd = task?.content_data || {};
                    const updated = {
                        ...cd,
                        post_type: 'reel',
                        reel_script: script,
                        reel_avatar_id: chosenAvatar,
                        reel_voice_id: chosenVoice,
                        heygen_video_id: videoId,
                        reel_status: 'processing'
                    };
                    await sb.from('agent_tasks').update({ content_data: updated }).eq('id', task_id);
                    console.log(`🎬 Task ${task_id} updated with reel info`);
                } catch(dbErr) {
                    console.log(`🎬 DB update error: ${dbErr.message}`);
                }
            }

            return res.json({
                success: true,
                video_id: videoId,
                status: 'processing',
                message: 'הסרטון בתהליך יצירה. זה לוקח 2-5 דקות.'
            });
        } catch(e) {
            console.log(`🎬 HeyGen generate error: ${e.message}`);
            return res.status(500).json({ error: 'HeyGen: ' + e.message });
        }
    }

    // ── REEL-STATUS ── check video generation status ──
    if (type === 'reel-status') {
        const adminUser = await verifyAdmin(req);
        if (!adminUser && !isAgentSecret(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (!heygenKey) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured' });

        const videoId = req.query.video_id;
        if (!videoId) return res.status(400).json({ error: 'video_id required' });

        try {
            const r = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`, {
                headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' }
            });
            const data = await r.json();
            if (!r.ok || data.error) return res.status(r.status).json({ error: data.error?.message || 'Status check failed' });

            const vd = data.data || {};
            const result = {
                video_id: vd.video_id || videoId,
                status: vd.status, // pending, processing, completed, failed
                video_url: vd.video_url || null,
                thumbnail_url: vd.thumbnail_url || null,
                duration: vd.duration || null,
                gif_url: vd.gif_url || null,
                callback_id: vd.callback_id || null
            };

            // If completed and has a task callback_id → update task
            if (result.status === 'completed' && result.video_url && result.callback_id) {
                try {
                    const taskId = result.callback_id;
                    if (taskId.match(/^[0-9a-f-]{36}$/)) { // valid UUID
                        const { data: task } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
                        if (task) {
                            const cd = task.content_data || {};
                            await sb.from('agent_tasks').update({
                                content_data: {
                                    ...cd,
                                    reel_status: 'ready',
                                    video_url: result.video_url,
                                    video_thumbnail: result.thumbnail_url
                                }
                            }).eq('id', taskId);
                            console.log(`🎬 Task ${taskId} updated: reel ready`);
                        }
                    }
                } catch(dbErr) {
                    console.log(`🎬 Status DB update error: ${dbErr.message}`);
                }
            }

            return res.json(result);
        } catch(e) {
            return res.status(500).json({ error: 'HeyGen status: ' + e.message });
        }
    }

    // ── REEL-WEBHOOK ── receive HeyGen callback when video is done ──
    if (type === 'reel-webhook') {
        // HeyGen sends OPTIONS for validation, then POST with event data
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

        const event = req.body || {};
        console.log(`🎬 HeyGen webhook received: ${JSON.stringify(event).substring(0, 500)}`);

        const eventType = event.event_type || event.event;
        const eventData = event.data || event;

        if (eventType === 'avatar_video.success' || eventData.status === 'completed') {
            const videoId = eventData.video_id;
            const videoUrl = eventData.url || eventData.video_url;
            const callbackId = eventData.callback_id;
            const thumbnailUrl = eventData.thumbnail_url;

            console.log(`🎬 Webhook: video ${videoId} completed | url: ${videoUrl} | callback: ${callbackId}`);

            // Upload video to Supabase Storage for permanent URL
            if (videoUrl && callbackId && callbackId.match(/^[0-9a-f-]{36}$/)) {
                try {
                    // Download video from HeyGen
                    const vidRes = await fetch(videoUrl);
                    if (vidRes.ok) {
                        const vidBuffer = Buffer.from(await vidRes.arrayBuffer());
                        const fname = `reel_${callbackId}_${Date.now()}.mp4`;

                        // Upload to Supabase Storage (reuse ig-images bucket or create reels bucket)
                        const { error: upErr } = await sb.storage.from('ig-images').upload(fname, vidBuffer, {
                            contentType: 'video/mp4',
                            upsert: false
                        });

                        let permanentUrl = videoUrl;
                        if (!upErr) {
                            const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                            permanentUrl = publicUrl;
                            console.log(`🎬 Video uploaded to Supabase: ${permanentUrl}`);
                        } else {
                            console.log(`🎬 Supabase upload error: ${upErr.message}, using HeyGen URL`);
                        }

                        // Update task
                        const { data: task } = await sb.from('agent_tasks').select('content_data').eq('id', callbackId).single();
                        if (task) {
                            await sb.from('agent_tasks').update({
                                content_data: {
                                    ...task.content_data,
                                    reel_status: 'ready',
                                    video_url: permanentUrl,
                                    heygen_video_url: videoUrl,
                                    video_thumbnail: thumbnailUrl
                                }
                            }).eq('id', callbackId);
                            console.log(`🎬 Task ${callbackId} updated via webhook: reel ready`);
                        }
                    }
                } catch(wbErr) {
                    console.log(`🎬 Webhook processing error: ${wbErr.message}`);
                }
            }

            return res.json({ received: true });
        }

        if (eventType === 'avatar_video.fail' || eventData.status === 'failed') {
            const callbackId = eventData.callback_id;
            console.log(`🎬 Webhook: video failed | callback: ${callbackId} | error: ${eventData.error || 'unknown'}`);

            if (callbackId && callbackId.match(/^[0-9a-f-]{36}$/)) {
                try {
                    const { data: task } = await sb.from('agent_tasks').select('content_data').eq('id', callbackId).single();
                    if (task) {
                        await sb.from('agent_tasks').update({
                            content_data: { ...task.content_data, reel_status: 'failed', reel_error: eventData.error || 'Video generation failed' }
                        }).eq('id', callbackId);
                    }
                } catch(e) { console.log(`🎬 Webhook fail update error: ${e.message}`); }
            }

            return res.json({ received: true });
        }

        return res.json({ received: true, note: 'unhandled event type' });
    }

    return res.status(400).json({ error: 'Invalid type parameter. Use: tasks, runs, run, publish, content-run, publish-ready, avatars, voices, upload-reel-photo, upload-talking-photo, generate-reel, reel-status, reel-webhook' });
};
