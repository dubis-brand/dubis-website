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

    // ── RUN ── scan approved tasks and execute agent logic ───────────
    if (type === 'run') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

        const adminUser = await verifyAdmin(req);
        const isCron    = req.headers['x-vercel-cron'] === '1' ||
                          req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
        if (!adminUser && !isCron) return res.status(401).json({ error: 'Unauthorized' });

        const { data: tasks, error: fetchErr } = await sb
            .from('agent_tasks')
            .select('id, title, agent_id, category, description, notes, priority, content_data')
            .eq('status', 'approved')
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true });

        if (fetchErr) return res.status(500).json({ error: fetchErr.message });
        if (!tasks || tasks.length === 0) {
            return res.status(200).json({ queued: 0, summary: 'No approved tasks found.' });
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
                        if (cd.caption_he && cd.generated_image_url) {
                            await sb.from('agent_tasks').update({ status: 'pending_approval', updated_at: now }).eq('id', task.id);
                            taskResults.push(`✅ ${task.title}: content כבר קיים → pending_approval`);
                            continue;
                        }
                        // Generate captions
                        const cRes = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ contents: [{ parts: [{ text:
                                `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
Task: ${task.title}
Description: ${task.description || ''}
Format: ${cd.format || 'feed_post'}
Existing English: ${cd.caption_en || ''}
Return ONLY valid JSON (no markdown):
{"caption_he":"כיתוב עברית 3-4 משפטים אותנטי","caption_en":"English caption 3-4 sentences","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 tags","image_prompt":"Detailed Imagen prompt: scene mood person DUBIS clothing"}`
                              }] }] }) }
                        );
                        const cData = await cRes.json();
                        const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        let gen = {};
                        try { gen = JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) { gen = { caption_en: raw.substring(0,200) }; }

                        // Generate image
                        let imageUrl = cd.generated_image_url || '';
                        if (!imageUrl && gen.image_prompt) {
                            const iRes = await fetch(
                                `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${geminiKey}`,
                                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ instances: [{ prompt: gen.image_prompt + ' Square 1:1. No text.' }], parameters: { sampleCount: 1, aspectRatio: '1:1' } }) }
                            );
                            const iData = await iRes.json();
                            const b64 = iData.predictions?.[0]?.bytesBase64Encoded;
                            if (b64) {
                                await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                                const fn = `ig-${task.id}-${Date.now()}.jpg`;
                                const { error: upErr } = await sb.storage.from('ig-images').upload(fn, Buffer.from(b64,'base64'), { contentType:'image/jpeg', upsert:true });
                                if (!upErr) imageUrl = sb.storage.from('ig-images').getPublicUrl(fn).data.publicUrl;
                            }
                        }
                        await sb.from('agent_tasks').update({
                            content_data: { ...cd, caption_he: gen.caption_he||'', caption_en: gen.caption_en||cd.caption_en||'', hashtags: gen.hashtags||cd.hashtags||'', ...(imageUrl?{generated_image_url:imageUrl}:{}) },
                            status: 'pending_approval',
                            notes: (task.notes||'') + `\n✍️ תוכן נוצר ע"י AI — ${new Date().toLocaleDateString('he-IL')}`,
                            updated_at: now,
                        }).eq('id', task.id);
                        taskResults.push(`✅ ${task.title}: תוכן נוצר → pending_approval`);
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
                const desc = cd.caption_en || task.description || task.title || '';
                const format = cd.format || 'feed_post';
                const baseStyle = 'DUBIS Israeli clothing brand for real people, not fashion models. Urban lifestyle photography, authentic diverse people, dark minimal aesthetic, natural lighting, square 1:1 format. No text in image.';
                if (format === 'quote_card') {
                    imagePrompt = `Minimalist dark textured background, urban concrete wall, suitable for text overlay. ${baseStyle}`;
                } else if (format === 'product_post') {
                    imagePrompt = `Person wearing casual streetwear, ${desc.substring(0,100)}. ${baseStyle}`;
                } else {
                    imagePrompt = `${desc.substring(0,150)}. ${baseStyle}`;
                }
            }
        }
        if (!imagePrompt) return res.status(400).json({ error: 'prompt or task_id required' });

        // Call Gemini Imagen
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt: imagePrompt }],
                    parameters: { sampleCount: 1, aspectRatio: '1:1' }
                })
            }
        );
        const geminiData = await geminiRes.json();
        if (geminiData.error) return res.status(500).json({ error: geminiData.error.message });
        const b64 = geminiData.predictions?.[0]?.bytesBase64Encoded;
        if (!b64) return res.status(500).json({ error: 'Image generation failed — no image returned' });

        // Upload to Supabase Storage (public bucket ig-images)
        await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
        const fileName = `ig-${task_id || 'gen'}-${Date.now()}.jpg`;
        const imageBuffer = Buffer.from(b64, 'base64');
        const { error: uploadError } = await sb.storage
            .from('ig-images')
            .upload(fileName, imageBuffer, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) return res.status(500).json({ error: uploadError.message });

        const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fileName);

        // Save generated image URL into task content_data
        if (task_id) {
            const { data: tsk } = await sb.from('agent_tasks').select('content_data').eq('id', task_id).single();
            const cd = tsk?.content_data || {};
            await sb.from('agent_tasks').update({
                content_data: { ...cd, generated_image_url: publicUrl },
                updated_at: new Date().toISOString()
            }).eq('id', task_id);
        }

        console.log(`🎨 Instagram image generated | ${fileName}`);
        return res.status(200).json({ image_url: publicUrl, prompt_used: imagePrompt });
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

        // ── Facebook Page ──────────────────────────────────────────
        if (doFacebook) {
            const fbToken  = process.env.INSTAGRAM_ACCESS_TOKEN; // same long-lived page token
            const fbPageId = process.env.FACEBOOK_PAGE_ID;
            if (!fbToken || !fbPageId) {
                result.errors.push('Facebook: חסר FACEBOOK_PAGE_ID ב-Vercel env vars');
            } else {
                try {
                    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}/photos`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: image_url, caption, access_token: fbToken }),
                    });
                    const fbData = await fbRes.json();
                    if (!fbRes.ok || fbData.error) {
                        result.errors.push('Facebook: ' + (fbData.error?.message || 'publish failed'));
                    } else {
                        result.facebook_post_id = fbData.post_id || fbData.id;
                        console.log(`✅ Facebook published | ID: ${result.facebook_post_id}`);
                    }
                } catch(e) { result.errors.push('Facebook: ' + e.message); }
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

    return res.status(400).json({ error: 'Invalid type parameter. Use: tasks, runs, run, publish' });
};
