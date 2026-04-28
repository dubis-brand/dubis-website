// DUBIS — Morning Report Cron
// Vercel Cron: every day at 05:00 UTC (07:00 Israel)
// Sends daily digest to owner: pending tasks + orders + revenue + Gmail insights
// Gmail scan is handled by Cowork Email Monitor agent (06:45) — this cron only reads results from DB
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const OWNER_EMAIL  = process.env.OWNER_EMAIL || 'dubis.brand@gmail.com';
const SENDER_EMAIL = 'DUBIS Reports <orders@dubis.net>';

// ── Gmail scan helpers ───────────────────────────────────────────────────────
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE  = 'https://gmail.googleapis.com/gmail/v1/users/me';

const INSIGHT_RULES = [
    { pattern: /receipt|invoice|charged|payment|billing|billed|subscription|renewal|renew/i, tag: 'expense', emoji: '💳', priority: 'medium' },
    { pattern: /expire|expir|renew|domain|ssl|certificate|hosting/i,                         tag: 'renewal', emoji: '⚠️', priority: 'high'   },
    { pattern: /shipment|shipped|tracking|delivery|delivered|package/i,                       tag: 'shipment',emoji: '📦', priority: 'medium' },
    { pattern: /gelato|paypal|supabase|vercel|resend|google|cloudflare/i,                    tag: 'service', emoji: '🔧', priority: 'medium' },
    { pattern: /order|purchase|bought|confirmation/i,                                         tag: 'order',   emoji: '🛍️', priority: 'medium' },
];

async function runGmailScan(supabase) {
    if (!process.env.GMAIL_REFRESH_TOKEN || !process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
        return { skipped: true };
    }
    try {
        // Get access token
        const tokenRes = await fetch(GMAIL_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id:     process.env.GMAIL_CLIENT_ID,
                client_secret: process.env.GMAIL_CLIENT_SECRET,
                refresh_token: process.env.GMAIL_REFRESH_TOKEN,
                grant_type:    'refresh_token',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error);
        const accessToken = tokenData.access_token;

        // Search last 24h
        const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
        const query = encodeURIComponent(`after:${since} (receipt OR invoice OR order OR shipment OR renew OR expire OR billing OR gelato OR paypal OR vercel OR supabase OR resend)`);
        const listRes = await fetch(`${GMAIL_API_BASE}/messages?q=${query}&maxResults=20`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!listRes.ok) throw new Error(`Gmail list: HTTP ${listRes.status}`);
        const list = await listRes.json();
        const messageIds = (list.messages || []).map(m => m.id);

        // Dedup against existing
        const { data: existing } = await supabase
            .from('agent_tasks').select('title')
            .eq('category', 'gmail_insight').eq('status', 'pending')
            .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString());
        const existingTitles = new Set((existing || []).map(r => r.title));

        let saved = 0;
        for (const id of messageIds) {
            const msgRes = await fetch(`${GMAIL_API_BASE}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!msgRes.ok) continue;
            const msg = await msgRes.json();
            const headers = msg.payload?.headers || [];
            const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
            const from    = headers.find(h => h.name === 'From')?.value    || '';
            const snippet = msg.snippet || '';

            const fullText = `${subject} ${snippet} ${from}`;
            let matched = null;
            for (const rule of INSIGHT_RULES) {
                if (rule.pattern.test(fullText)) { matched = rule; break; }
            }
            if (!matched) continue;

            const title = `${matched.emoji} ${subject}`.slice(0, 200);
            if (existingTitles.has(title)) continue;

            const amountMatch = snippet.match(/\$[\d,]+\.?\d{0,2}|€[\d,]+\.?\d{0,2}|₪[\d,]+\.?\d{0,2}/);
            await supabase.from('agent_tasks').insert({
                agent_id:    'cto',
                title,
                description: `From: ${from.replace(/<[^>]+>/, '').trim()}\n${snippet.slice(0, 300)}`,
                notes:       amountMatch ? `סכום שזוהה: ${amountMatch[0]}` : null,
                category:    'gmail_insight',
                status:      'pending',
                priority:    matched.priority,
            });
            saved++;
        }
        console.log(`Gmail scan: ${saved} new insights saved`);
        return { saved };
    } catch (err) {
        console.warn('Gmail scan error (non-fatal):', err.message);
        return { error: err.message };
    }
}
// ── Standalone content pipeline (called via ?type=content) ──────────────────
async function runContentPipeline(supabase, res) {
    try {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';

        // 1. Create today's content task (auto-rotate products)
        const autoRes  = await fetch(`${agentsBase}?type=auto-content`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        });
        const autoData = await autoRes.json();
        console.log('[content-cron] Auto-content:', JSON.stringify(autoData));

        // 2. ALWAYS run content-run — processes any approved tasks missing images
        // (not just newly created tasks — Cowork may create tasks without running content-run)
        const runRes  = await fetch(`${agentsBase}?type=content-run`, {
            method:  'GET',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const runData = await runRes.json();
        console.log('[content-cron] Content-run:', JSON.stringify(runData));

        // 3. ALWAYS run QA on any generated content
        const qaRes  = await fetch(`${agentsBase}?type=qa-content`, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
        });
        const qaData = await qaRes.json();
        console.log('[content-cron] QA-content:', JSON.stringify(qaData));

        // 4. Auto-publish any ready content
        const pubRes = await fetch(`${agentsBase}?type=publish-ready`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        });
        const pubData = await pubRes.json();
        console.log('[content-cron] Publish-ready:', JSON.stringify(pubData));

        return res.status(200).json({
            success: true,
            auto_content: { task_id: autoData.task_id || null, skipped: autoData.skipped || false },
            content_run: runData,
            qa: qaData,
            publish: pubData,
        });
    } catch (err) {
        console.error('[content-cron] Error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// ────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Require either Vercel cron header or CRON_SECRET
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const hasCronSecret = process.env.CRON_SECRET &&
        req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
    const hasAgentSecret = process.env.AGENT_SECRET &&
        (req.headers['x-agent-secret'] === process.env.AGENT_SECRET ||
         req.headers['authorization'] === `Bearer ${process.env.AGENT_SECRET}`);
    // Dedicated token for Supabase DB triggers / pg_net jobs (set in Supabase vault as 'dubis_pg_trigger_token')
    const PG_TRIGGER_TOKEN = 'dbsTRG_2026_05_oren_K9pX2vN7mR4qY8aJ3hL';
    const hasPgTriggerToken = req.headers['x-pg-trigger-token'] === PG_TRIGGER_TOKEN;
    if (!isVercelCron && !hasCronSecret && !hasAgentSecret && !hasPgTriggerToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const urlType = new URL(req.url, `https://${req.headers.host}`).searchParams.get('type');

    // ── Route: ?type=blind-test — send 7 Hebrew RTL feedback request emails (one-shot, 2026-04-28) ──
    // Triggered manually by Claude after deploy. Each email is personalized with first name + URL params.
    if (urlType === 'blind-test') {
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY missing' });
        const RECIPIENTS = [
            { name: 'הילה',  email: 'hilateharlev@gmail.com' },
            { name: 'שרון',  email: 'sharonshabi@gmail.com' },
            { name: 'דבורה', email: 'dvora.galitzki@gmail.com' },
            { name: 'דולב',  email: 'dolevt0407@gmail.com' },
            { name: 'ליאת',  email: 'liatamos@gmail.com' },
            { name: 'שני',   email: 'steharlev@gmail.com' },
            { name: 'יעל',   email: 'ymz.wonderland@gmail.com' },
        ];
        const results = [];
        for (const r of RECIPIENTS) {
            const fbUrl = `https://www.dubis.net/feedback.html?n=${encodeURIComponent(r.name)}&e=${encodeURIComponent(r.email)}`;
            const html = `<!DOCTYPE html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#f5f5f0;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden">
<tr><td style="background:#0d0d0d;padding:24px 32px;text-align:center">
<div style="color:#c8a96e;font-size:1.6rem;font-weight:700;letter-spacing:2px">DUBIS<sup style="font-size:.4em;vertical-align:super">™</sup></div>
<div style="color:#888;font-size:.78rem;margin-top:4px">Built for the body you actually live in.</div>
</td></tr>
<tr><td style="padding:32px;color:#222;line-height:1.7;font-size:.97rem">
<p>היי ${r.name},</p>
<p>אנחנו <strong>DUBIS</strong> — מותג בגדים אמריקאי-חדש, מיועד לאנשים <em>אמיתיים</em>. בלי דוגמנים בני 22, בלי "תרזה ב-30 ימים", בלי בטן שטוחה בפלקאט. בגדים שאנשים מעל גיל 35 רוצים ללבוש לחיים האמיתיים שלהם.</p>
<p>אנחנו בשלב מאוד מוקדם, ולפני שנשפוך תקציב פרסום על קהל אמריקאי שלא מכיר אותנו, אנחנו רוצים פיידבק כן <strong>ממך</strong> — מישהי שלא קשורה אלינו ויכולה להגיד לנו את האמת בלי לרכך.</p>
<p style="background:#fff8e1;border-right:4px solid #c8a96e;padding:14px 18px;border-radius:6px"><strong>הבקשה שלנו: שתי דקות מהזמן שלך.</strong><br>תיכנסי לאתר, תסתכלי 1-2 דקות כאילו רצית לקנות בגד היום, ותעני על 5 שאלות קצרות — בעברית. <strong>תשובה כנה &gt; תשובה מנומסת.</strong> אנחנו לא נעלב מ-"זה לא בשבילי" — אנחנו נעלב מ-"נחמד" כי זה לא עוזר לנו לתקן.</p>
<div style="text-align:center;margin:28px 0">
<a href="${fbUrl}" style="background:#c8a96e;color:#0d0d0d;padding:14px 36px;text-decoration:none;border-radius:6px;font-weight:700;display:inline-block">להתחיל ←</a>
</div>
<p style="color:#666;font-size:.85rem">אם אין לך זמן עכשיו — זה בסדר, פשוט תתעלמי. אם החלטת לעזור — תודה ענקית. הפיידבק שלך נקרא ביום שתשלחי אותו והופך לפעולות תיקון השבוע.</p>
<p style="color:#888;font-size:.78rem;margin-top:24px">DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e">dubis.net</a><br>פנייה חד-פעמית למחקר משתמשים. לא נשלח עוד אלא אם תבקשי.</p>
</td></tr></table></td></tr></table></body></html>`;
            try {
                const resp = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'DUBIS <orders@dubis.net>',
                        to: [r.email],
                        subject: `${r.name}, שתי דקות מהזמן שלך — בלי לקנות, בלי הרשמה`,
                        html,
                    }),
                });
                const data = await resp.json();
                results.push({ to: r.email, ok: resp.ok, id: data.id, error: resp.ok ? null : data });
                await new Promise(s => setTimeout(s, 600)); // throttle to avoid Resend rate limit
            } catch (e) {
                results.push({ to: r.email, ok: false, error: e.message });
            }
        }
        return res.status(200).json({ success: true, sent: results.filter(x => x.ok).length, total: results.length, results });
    }

    // ── Route: ?type=feedback-notify — fired by DB trigger when a new blind-test response arrives ──
    if (urlType === 'feedback-notify') {
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY missing' });
        const responseId = req.body?.response_id || new URL(req.url, `https://${req.headers.host}`).searchParams.get('response_id');
        if (!responseId) return res.status(400).json({ error: 'Missing response_id' });
        const { data: r, error: rErr } = await supabase.from('feedback_responses').select('*').eq('id', responseId).single();
        if (rErr || !r) return res.status(404).json({ error: 'response not found', detail: rErr?.message });
        const escape = s => String(s||'—').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const html = `<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f0;padding:24px">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
<h2 style="color:#c8a96e;margin:0 0 4px">📝 תגובת פיידבק חדשה</h2>
<div style="color:#888;font-size:.85rem;margin-bottom:18px">${escape(r.tester_name)} (${escape(r.tester_email)}) · ${new Date(r.created_at).toLocaleString('he-IL')}</div>
${[
  ['1. רושם ראשון', r.q1_first_impression],
  ['2. היית קונה?', r.q2_would_buy],
  ['3. מחיר', r.q3_price_perception],
  ['4. מה בלט', r.q4_what_stood_out],
  ['5. מתנה למישהי', r.q5_would_recommend],
  ['6. עוד משהו', r.q6_anything_else],
].map(([label, val]) => val ? `<div style="margin-bottom:14px"><div style="color:#c8a96e;font-weight:600;font-size:.85rem;margin-bottom:4px">${label}</div><div style="color:#222;line-height:1.6;white-space:pre-wrap">${escape(val)}</div></div>` : '').join('')}
<a href="https://www.dubis.net/admin#feedback" style="display:inline-block;background:#0d0d0d;color:#c8a96e;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;margin-top:12px">פתח Admin Feedback ←</a>
</div></body></html>`;
        try {
            const resp = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'DUBIS Reports <orders@dubis.net>',
                    to: ['dubis.brand@gmail.com', 'teharlev1976@gmail.com'],
                    subject: `📝 פיידבק חדש מ-${r.tester_name || r.tester_email || 'אנונימי'}`,
                    html,
                }),
            });
            const data = await resp.json();
            return res.status(200).json({ success: resp.ok, email_id: data.id, error: resp.ok ? null : data });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── Route: ?type=auto-run — Phase 2 autonomy: auto-execute all non-budget tasks ──
    // Called by Vercel cron at 06:00 + 12:00 UTC (08:00 + 14:00 Israel)
    if (urlType === 'auto-run') {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';
        try {
            const r = await fetch(`${agentsBase}?type=run`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(200).json({ success: true, auto_run: data });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    // ── Route: ?type=agents — run email-monitor + site-audit via Edge Function ──
    // Called by Vercel cron at 04:00 UTC (06:00 Israel) — replaces Cowork scheduled tasks
    if (urlType === 'agents') {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';
        const results = {};
        // 1. Email Monitor
        try {
            const r = await fetch(`${agentsBase}?type=run`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ agents: ['email_monitor'] }),
            });
            results.email_monitor = await r.json();
        } catch (e) { results.email_monitor = { error: e.message }; }
        // 2. Site Audit
        try {
            const r = await fetch(`${agentsBase}?type=run`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ agents: ['site_audit'] }),
            });
            results.site_audit = await r.json();
        } catch (e) { results.site_audit = { error: e.message }; }
        return res.status(200).json({ success: true, results });
    }

    // ── Route: ?type=content — standalone content generation ────────────
    // Called by Vercel cron at 10:00 UTC (12:00 Israel) separately from morning report
    if (urlType === 'content') {
        return runContentPipeline(supabase, res);
    }

    // ── Route: ?type=video — weekly English Reel pipeline ───────────────
    // Called by Vercel cron every Sunday 14:00 UTC
    if (urlType === 'video') {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';
        const headers = { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' };
        try {
            // 1. Pick a product slogan to rotate (simple: random from a fixed list)
            const slogans = [
                'NAPPING IS MY CARDIO','more of me to LOVE','certified OVER thinker',
                'serial NAPPER','Zero Motivation CLUB','low maintenance, high VALUE',
                'I am not fat, I am a LIMITED edition','NAP - Born to nap, forced to work'
            ];
            const slogan = slogans[Math.floor(Date.now() / 86400000) % slogans.length];

            // 2. Generate script
            const scriptR = await fetch(`${agentsBase}?type=generate-video-script`, {
                method: 'POST', headers,
                body: JSON.stringify({ language: 'en', style: 'humor', product_slogan: slogan }),
            });
            const scriptData = await scriptR.json();
            const taskId = scriptData.task_id;
            if (!taskId) return res.status(500).json({ error: 'script failed', detail: scriptData });

            // 3. Generate assets
            const assetsR = await fetch(`${agentsBase}?type=generate-video-assets`, {
                method: 'POST', headers, body: JSON.stringify({ task_id: taskId }),
            });
            const assetsData = await assetsR.json();

            // 4. Render (webhook-based, returns immediately)
            const renderR = await fetch(`${agentsBase}?type=render-video`, {
                method: 'POST', headers, body: JSON.stringify({ task_id: taskId }),
            });
            const renderData = await renderR.json();

            // Note: publishing happens later via separate cron or admin trigger
            // because rendering takes 5-7 minutes via webhooks
            return res.status(200).json({
                success: true, task_id: taskId, slogan,
                script: scriptData, assets: assetsData, render: renderData,
                next_step: 'Wait ~6min then call publish-ready with task_id',
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── Route: ?type=security — weekly security scan ──────────────────
    // Called by Vercel cron every Monday 03:00 UTC (05:00 Israel)
    if (urlType === 'security') {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';
        try {
            const r = await fetch(`${agentsBase}?type=security-scan`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(200).json({ success: true, security: data });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: 'Resend not configured' });
    }

    // ── 0. Gmail scan ────────────────────────────────────────────────────
    // ⚠️ DISABLED — Gmail scanning is now handled by the Cowork Email Monitor agent
    // (runs daily at 06:45 via Cowork Scheduler → writes to agent_tasks).
    // This cron reads the results from DB (section 3 below) — no direct Gmail call needed.
    // await runGmailScan(supabase); // <-- REMOVED to prevent duplicates

    // ── 1a. Auto-trigger approved tasks ─────────────────────────────
    // ⚠️ DISABLED — This was auto-moving approved tasks to in_progress every morning,
    // which caused tasks approved by the admin to "disappear" from the Approved column.
    // Cowork agents now handle task execution on their own schedule.
    // Tasks should stay in 'approved' until manually managed by the admin.
    //
    // const { data: allApproved } = await supabase.from('agent_tasks')...
    // REMOVED to prevent silent status changes in the Task Board.

    // ── 1b. Pending tasks awaiting approval ─────────────────────────
    const { data: pendingTasks } = await supabase
        .from('agent_tasks')
        .select('id, title, description, priority, category, created_at, notes')
        .in('status', ['pending', 'pending_approval'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

    // ── 2. Orders stats ─────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO  = today.toISOString();
    const weekAgo   = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo  = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

    const { data: todayOrders } = await supabase
        .from('orders')
        .select('id, status, total_amount, buyer_email, items, created_at')
        .neq('status', 'cancelled')
        .gte('created_at', todayISO);

    const { data: weekOrders } = await supabase
        .from('orders')
        .select('total_amount, status')
        .neq('status', 'cancelled')
        .gte('created_at', weekAgo.toISOString());

    const { data: activeOrders } = await supabase
        .from('orders')
        .select('id, status, buyer_email, items, total_amount, created_at')
        .in('status', ['pending', 'in_production', 'shipped'])
        .order('created_at', { ascending: false });

    // ── 3. Gmail insights (from agent_tasks saved by Gmail agent) ───
    const { data: gmailInsights } = await supabase
        .from('agent_tasks')
        .select('title, description, notes, created_at')
        .eq('category', 'gmail_insight')
        .eq('status', 'pending')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

    // ── 4. Agent runs in last 24h (Phase 2 autonomy report) ────────
    const { data: recentRuns } = await supabase
        .from('agent_runs')
        .select('agent_id, status, summary, tasks_created, created_at')
        .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

    // Also get tasks completed in last 24h
    const { data: recentDone } = await supabase
        .from('agent_tasks')
        .select('title, agent_id, category, notes, updated_at')
        .eq('status', 'done')
        .gte('updated_at', new Date(Date.now() - 24 * 3600000).toISOString())
        .order('updated_at', { ascending: false })
        .limit(20);

    // ── Calculate stats ─────────────────────────────────────────────
    const todayRevenue  = (todayOrders  || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const weekRevenue   = (weekOrders   || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const pendingCount  = (activeOrders || []).filter(o => o.status === 'pending').length;
    const inProdCount   = (activeOrders || []).filter(o => o.status === 'in_production').length;
    const shippedCount  = (activeOrders || []).filter(o => o.status === 'shipped').length;

    const dateStr = new Date().toLocaleDateString('he-IL', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jerusalem'
    });

    // ── Priority badge ───────────────────────────────────────────────
    const badge = p => {
        if (p === 'critical') return `<span style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">CRITICAL</span>`;
        if (p === 'high')     return `<span style="background:#e67e22;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">HIGH</span>`;
        return `<span style="background:#3498db;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${(p||'').toUpperCase()}</span>`;
    };

    // ── Build HTML ───────────────────────────────────────────────────
    const tasksHtml = (pendingTasks || []).length === 0
        ? `<p style="color:#27ae60;font-weight:600">✅ אין משימות פתוחות לאישור</p>`
        : (pendingTasks || []).map(t => `
            <div style="background:#fff;border:1px solid #e0e0e0;border-right:4px solid #c8a96e;border-radius:6px;padding:14px 16px;margin-bottom:10px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    ${badge(t.priority)}
                    <strong style="color:#2c2c2c;font-size:14px">${t.title}</strong>
                </div>
                <p style="color:#666;font-size:13px;margin:0 0 6px">${t.description || ''}</p>
                ${t.notes ? `<p style="color:#999;font-size:12px;margin:0;font-style:italic">${t.notes}</p>` : ''}
            </div>`).join('');

    const ordersHtml = (activeOrders || []).length === 0
        ? `<p style="color:#666">אין הזמנות פעילות</p>`
        : (activeOrders || []).slice(0, 5).map(o => {
            const item = (o.items || [])[0] || {};
            const statusColor = o.status === 'shipped' ? '#27ae60' : o.status === 'in_production' ? '#2980b9' : '#e67e22';
            return `<tr>
                <td style="padding:8px 4px;font-size:13px;color:#333">${new Date(o.created_at).toLocaleDateString('he-IL')}</td>
                <td style="padding:8px 4px;font-size:13px;color:#555">${o.buyer_email || ''}</td>
                <td style="padding:8px 4px;font-size:13px;color:#555">${item.typeLabel || ''} ${item.selectedSize || ''} / ${item.selectedColor || ''}</td>
                <td style="padding:8px 4px;font-size:13px;font-weight:600;color:${statusColor}">${o.status}</td>
                <td style="padding:8px 4px;font-size:13px;font-weight:600;color:#c8a96e">$${Number(o.total_amount).toFixed(2)}</td>
            </tr>`;
          }).join('');

    const gmailHtml = (gmailInsights || []).length === 0
        ? `<p style="color:#999;font-size:13px">לא נמצאו תובנות חדשות מהמייל השבוע.</p>`
        : (gmailInsights || []).map(g => `
            <div style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:6px;padding:12px 14px;margin-bottom:8px">
                <strong style="color:#b7860b;font-size:13px">📧 ${g.title}</strong>
                <p style="color:#666;font-size:12px;margin:4px 0 0">${g.description || ''}</p>
                ${g.notes ? `<p style="color:#999;font-size:11px;margin:4px 0 0">${g.notes}</p>` : ''}
            </div>`).join('');

    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 20px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="text-align:center;padding-bottom:24px">
        <span style="font-size:26px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span>
        <p style="margin:4px 0 0;color:#999;font-size:11px;letter-spacing:2px">DAILY BRIEFING</p>
        <p style="margin:8px 0 0;color:#666;font-size:13px">${dateStr}</p>
      </td></tr>

      <!-- Stats Row -->
      <tr><td style="padding-bottom:24px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:16px 8px;margin:0 4px">
              <div style="color:#c8a96e;font-size:22px;font-weight:700">$${todayRevenue.toFixed(0)}</div>
              <div style="color:#888;font-size:11px;margin-top:4px">הכנסה היום</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:16px 8px">
              <div style="color:#c8a96e;font-size:22px;font-weight:700">$${weekRevenue.toFixed(0)}</div>
              <div style="color:#888;font-size:11px;margin-top:4px">הכנסה 7 ימים</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:16px 8px">
              <div style="color:#e67e22;font-size:22px;font-weight:700">${pendingCount + inProdCount}</div>
              <div style="color:#888;font-size:11px;margin-top:4px">הזמנות פעילות</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:16px 8px">
              <div style="color:#27ae60;font-size:22px;font-weight:700">${shippedCount}</div>
              <div style="color:#888;font-size:11px;margin-top:4px">בדרך ללקוח</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Pending Tasks -->
      <tr><td style="background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:16px">
        <h2 style="margin:0 0 16px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:10px">
          ✅ משימות לאישורך (${(pendingTasks||[]).length})
        </h2>
        ${tasksHtml}
        ${(pendingTasks||[]).length > 0 ? `<p style="text-align:center;margin-top:16px"><a href="https://www.dubis.net/admin#tasks" style="background:#c8a96e;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">פתח לוח משימות →</a></p>` : ''}
      </td></tr>

      <tr><td style="height:12px"></td></tr>

      <!-- Active Orders -->
      <tr><td style="background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:16px">
        <h2 style="margin:0 0 16px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:10px">
          📦 הזמנות פעילות
        </h2>
        ${(activeOrders||[]).length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0">
          <thead>
            <tr>
              <th style="text-align:right;color:#999;font-size:11px;font-weight:500;padding:4px 4px 10px;border-bottom:1px solid #f0ebe0">תאריך</th>
              <th style="text-align:right;color:#999;font-size:11px;font-weight:500;padding:4px 4px 10px;border-bottom:1px solid #f0ebe0">לקוח</th>
              <th style="text-align:right;color:#999;font-size:11px;font-weight:500;padding:4px 4px 10px;border-bottom:1px solid #f0ebe0">פריט</th>
              <th style="text-align:right;color:#999;font-size:11px;font-weight:500;padding:4px 4px 10px;border-bottom:1px solid #f0ebe0">סטטוס</th>
              <th style="text-align:right;color:#999;font-size:11px;font-weight:500;padding:4px 4px 10px;border-bottom:1px solid #f0ebe0">סכום</th>
            </tr>
          </thead>
          <tbody>${ordersHtml}</tbody>
        </table>` : `<p style="color:#666;font-size:13px">אין הזמנות פעילות כרגע</p>`}
        <p style="text-align:center;margin-top:16px"><a href="https://www.dubis.net/admin" style="background:#2c2c2c;color:#c8a96e;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">מסך ניהול →</a></p>
      </td></tr>

      <tr><td style="height:12px"></td></tr>

      <!-- Gmail Insights -->
      <tr><td style="background:#fff;border-radius:12px;padding:24px 28px">
        <h2 style="margin:0 0 16px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:10px">
          📧 תובנות מהמייל
        </h2>
        ${gmailHtml}
      </td></tr>

      <tr><td style="height:12px"></td></tr>

      <!-- Agent Activity (Phase 2 Autonomy) -->
      <tr><td style="background:#fff;border-radius:12px;padding:24px 28px">
        <h2 style="margin:0 0 16px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:10px">
          🤖 פעולות סוכנים (24 שעות אחרונות)
        </h2>
        ${(recentRuns || []).length === 0 && (recentDone || []).length === 0
          ? `<p style="color:#999;font-size:13px">לא היו הרצות סוכנים ב-24 שעות האחרונות.</p>`
          : `
          ${(recentRuns || []).length > 0 ? `
          <div style="margin-bottom:16px">
            <strong style="color:#555;font-size:13px">📊 הרצות:</strong>
            ${(recentRuns || []).map(r => `
              <div style="background:#f8f6f0;border-radius:6px;padding:10px 14px;margin:6px 0;border-right:3px solid ${r.status === 'completed' ? '#27ae60' : '#e67e22'}">
                <strong style="color:#333;font-size:13px">${r.agent_id}</strong>
                <span style="color:#888;font-size:11px;margin-right:8px">${new Date(r.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}</span>
                <span style="color:${r.status === 'completed' ? '#27ae60' : '#e67e22'};font-size:11px;font-weight:600">${r.status}</span>
                ${r.summary ? `<p style="color:#666;font-size:12px;margin:4px 0 0;white-space:pre-line">${r.summary.substring(0, 300)}</p>` : ''}
              </div>`).join('')}
          </div>` : ''}
          ${(recentDone || []).length > 0 ? `
          <div>
            <strong style="color:#555;font-size:13px">✅ משימות שהושלמו (${(recentDone || []).length}):</strong>
            ${(recentDone || []).slice(0, 10).map(t => `
              <div style="background:#f0f8f0;border-radius:4px;padding:8px 12px;margin:4px 0">
                <strong style="color:#333;font-size:12px">${t.title}</strong>
                <span style="color:#888;font-size:11px;margin-right:6px">[${t.agent_id}]</span>
                ${t.notes ? `<p style="color:#666;font-size:11px;margin:2px 0 0;max-height:60px;overflow:hidden">${t.notes.substring(0, 200)}${t.notes.length > 200 ? '...' : ''}</p>` : ''}
              </div>`).join('')}
            ${(recentDone || []).length > 10 ? `<p style="color:#999;font-size:11px;margin-top:6px">+ עוד ${(recentDone || []).length - 10} משימות</p>` : ''}
          </div>` : ''}
          `}
      </td></tr>

      <!-- Footer -->
      <tr><td style="text-align:center;padding-top:24px">
        <p style="margin:0;color:#aaa;font-size:11px">DUBIS Daily Briefing · נשלח אוטומטית כל בוקר ב-07:00</p>
        <p style="margin:6px 0 0;color:#ccc;font-size:10px">
          <a href="https://www.dubis.net/admin" style="color:#c8a96e">Admin</a> ·
          <a href="https://dashboard.gelato.com" style="color:#c8a96e">Gelato</a> ·
          <a href="https://supabase.com/dashboard" style="color:#c8a96e">Supabase</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

    // ── Review requests (7 days post-delivery) ──────────────────────
    try {
        const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: deliveredOrders } = await supabase
            .from('orders')
            .select('id, buyer_email, shipping_address, items, paypal_order_id')
            .eq('status', 'delivered')
            .is('review_request_sent_at', null)
            .lt('updated_at', sevenDaysAgo.toISOString());

        let reviewRequestsSent = 0;
        for (const order of (deliveredOrders || [])) {
            if (!order.buyer_email) continue;
            const buyerName = order.shipping_address?.name || '';
            const item = (order.items || [])[0] || {};
            const reviewLink = `https://www.dubis.net?review=1&order=${encodeURIComponent(order.paypal_order_id || order.id)}`;
            try {
                await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from: SENDER_EMAIL,
                        to: [order.buyer_email],
                        subject: '⭐ How was your DUBIS order?',
                        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff">
                          <h2 style="color:#c8a96e;font-size:22px">How did we do? 🙏</h2>
                          <p style="color:#333">Hi ${buyerName || 'there'},</p>
                          <p style="color:#333">We hope you're loving your DUBIS order${item.typeLabel ? ` (${item.typeLabel})` : ''}!</p>
                          <p style="color:#333">Your feedback means everything to us — it helps other customers and helps us improve. Would you take 60 seconds to leave a quick review?</p>
                          <p style="text-align:center;margin:28px 0">
                            <a href="${reviewLink}" style="background:#c8a96e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Leave a Review ⭐</a>
                          </p>
                          <p style="color:#999;font-size:12px;margin-top:24px">— The DUBIS team</p>
                        </div>`,
                    }),
                });
                await supabase.from('orders').update({ review_request_sent_at: new Date().toISOString() }).eq('id', order.id);
                reviewRequestsSent++;
            } catch (revErr) {
                console.warn('Review request failed for order', order.id, revErr.message);
            }
        }
        if (reviewRequestsSent > 0) console.log(`✅ Review requests sent: ${reviewRequestsSent}`);
    } catch (reviewErr) {
        console.warn('Review request check failed (non-fatal):', reviewErr.message);
    }

    // ── Daily snapshot → daily_snapshots table ───────────────────────
    try {
        const snapshotDate = new Date().toISOString().slice(0, 10);
        const since24h     = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Fetch parallel data for snapshot
        const [
            ordersAllRes,
            orders24hRes,
            campaignsRes,
            agentRunsRes,
            pageViewsRes,
            subscribersRes,
        ] = await Promise.all([
            supabase.from('orders').select('id, status, total_amount').neq('status', 'cancelled'),
            supabase.from('orders').select('id').gte('created_at', since24h).neq('status', 'cancelled'),
            supabase.from('ad_campaigns').select('id, status, spend_to_date').eq('status', 'active'),
            supabase.from('agent_runs').select('id, status').gte('created_at', since24h),
            supabase.from('page_views').select('id', { count: 'exact', head: true }).gte('created_at', snapshotDate),
            supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true }),
        ]);

        const allOrders     = ordersAllRes.data  || [];
        const totalRevenue  = allOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
        const activeOrders_ = allOrders.filter(o => ['pending', 'in_production'].includes(o.status)).length;
        const shippedOrders = allOrders.filter(o => o.status === 'shipped').length;
        const campaigns_    = campaignsRes.data || [];
        const agentRuns_    = agentRunsRes.data  || [];
        const campaignSpend = campaigns_.reduce((s, c) => s + (parseFloat(c.spend_to_date) || 0), 0);

        const snapshotData = {
            snapshot_date:         snapshotDate,
            revenue_usd:           Math.round(totalRevenue * 100) / 100,
            orders_count:          allOrders.length,
            orders_today:          (orders24hRes.data || []).length,
            active_campaigns:      campaigns_.length,
            campaigns_spend_total: Math.round(campaignSpend * 100) / 100,
            agent_runs_yesterday:  agentRuns_.length,
            agent_runs_errors:     agentRuns_.filter(r => r.status === 'error' || r.status === 'completed_with_errors').length,
            page_views_today:      pageViewsRes.count || 0,
            subscribers_total:     subscribersRes.count || 0,
            active_orders:         activeOrders_,
            shipped_orders:        shippedOrders,
            raw_data: {
                pendingTasks:   (pendingTasks || []).length,
                todayRevenue,
                weekRevenue,
            },
        };

        await supabase
            .from('daily_snapshots')
            .upsert(snapshotData, { onConflict: 'snapshot_date' });

        console.log(`✅ Daily snapshot saved for ${snapshotDate}`);
    } catch (snapErr) {
        // Non-fatal — continue to send the email
        console.warn('Snapshot write error (non-fatal):', snapErr.message);
    }

    // ── Send via Resend ──────────────────────────────────────────────
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                from:    SENDER_EMAIL,
                to:      [OWNER_EMAIL],
                subject: `📋 DUBIS Daily — ${(pendingTasks||[]).length} משימות · $${todayRevenue.toFixed(0)} היום`,
                html,
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Send failed');

        console.log(`✅ Morning report sent | Tasks: ${(pendingTasks||[]).length} | Revenue today: $${todayRevenue}`);

        // ── Trigger daily content generation ────────────────────────
        try {
            const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
            const authToken  = process.env.CRON_SECRET || process.env.AGENT_SECRET || '';

            // 1. Create today's content task (auto-rotate products)
            const autoRes  = await fetch(`${agentsBase}?type=auto-content`, {
                method:  'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            });
            const autoData = await autoRes.json();
            console.log('Auto-content:', JSON.stringify(autoData));

            // 2. If a new task was created, immediately generate caption + image
            if (autoData.task_id && !autoData.skipped) {
                const runRes  = await fetch(`${agentsBase}?type=content-run`, {
                    method:  'GET',
                    headers: { 'Authorization': `Bearer ${authToken}` },
                });
                const runData = await runRes.json();
                console.log('Content-run:', JSON.stringify(runData));

                // 3. Run QA on the generated content before it reaches the admin
                const qaRes  = await fetch(`${agentsBase}?type=qa-content`, {
                    method:  'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                const qaData = await qaRes.json();
                console.log('QA-content:', JSON.stringify(qaData));
            }
        } catch (autoErr) {
            console.warn('Auto-content trigger failed (non-fatal):', autoErr.message);
        }

        return res.status(200).json({
            success: true,
            emailId: data.id,
            stats: { pendingTasks: (pendingTasks||[]).length, todayRevenue, weekRevenue, activeOrders: (activeOrders||[]).length }
        });
    } catch (err) {
        console.error('Morning report send error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};
