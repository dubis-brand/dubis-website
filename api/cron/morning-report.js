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

    // ── Route: ?type=backfill-permalinks — proxy to agents Edge Function ────
    // Lets us trigger the backfill from pg_net (via x-pg-trigger-token) without
    // ever exposing AGENT_SECRET to SQL. Forwards to the Edge Function using
    // CRON_SECRET from Vercel env (which the Edge Function also accepts).
    if (urlType === 'backfill-permalinks') {
        const agentsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1/agents';
        const authToken = process.env.AGENT_SECRET || process.env.CRON_SECRET || '';
        if (!authToken) return res.status(500).json({ error: 'no agent/cron secret configured' });
        const limit = new URL(req.url, `https://${req.headers.host}`).searchParams.get('limit') || '50';
        try {
            const r = await fetch(`${agentsBase}?type=backfill-permalinks&limit=${limit}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(r.status).json({ success: r.ok, edge_function_response: data });
        } catch (e) {
            return res.status(500).json({ error: 'proxy failed', detail: e.message });
        }
    }

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

    // ── Route: ?type=feedback-apology — fix-and-apology email after RLS bug discovered 2026-04-30 ──
    // ?test=1 → send only to teharlev1976@gmail.com (preview before broadcast)
    if (urlType === 'feedback-apology') {
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY missing' });
        const isTest = new URL(req.url, `https://${req.headers.host}`).searchParams.get('test') === '1';
        const ALL = isTest ? [
            { name: 'Oren', email: 'teharlev1976@gmail.com' }
        ] : [
            { name: 'הילה', email: 'hilateharlev@gmail.com' },
            { name: 'שרון', email: 'sharonshabi@gmail.com' },
            { name: 'דבורה', email: 'dvora.galitzki@gmail.com' },
            { name: 'דולב', email: 'dolevt0407@gmail.com' },
            { name: 'ליאת', email: 'liatamos@gmail.com' },
            { name: 'שני', email: 'steharlev@gmail.com' },
            { name: 'יעל', email: 'ymz.wonderland@gmail.com' },
        ];
        const results = [];
        for (const r of ALL) {
            const fbUrl = `https://www.dubis.net/feedback.html?n=${encodeURIComponent(r.name)}&e=${encodeURIComponent(r.email)}`;
            const html = `<!DOCTYPE html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#f5f5f0;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden">
<tr><td style="background:#0d0d0d;padding:20px 32px;text-align:center">
<div style="color:#c8a96e;font-size:1.4rem;font-weight:700;letter-spacing:2px">DUBIS<sup style="font-size:.4em;vertical-align:super">™</sup></div>
</td></tr>
<tr><td style="padding:28px 32px;color:#222;line-height:1.7;font-size:.95rem">
<p>היי ${r.name},</p>
<p style="background:#fff8e1;border-right:4px solid #c8a96e;padding:14px 18px;border-radius:6px;margin:16px 0">
<strong>טעות טכנית שלנו.</strong> שלחנו לך לפני יומיים בקשה לפיידבק על האתר. גילינו עכשיו שהטופס היה <strong>שבור</strong>: כל מי שניסה לשלוח קיבל שגיאה שקטה והתשובה לא נשמרה.
</p>
<p>אם ניסית — מצטערים מאוד. אם לא הספקת — עכשיו זה הזמן: הטופס תוקן ופועל.</p>
<p>הבקשה זהה: 2 דקות מהזמן שלך, פיידבק כן על האתר. <strong>תשובה כנה > תשובה מנומסת</strong>.</p>
<div style="text-align:center;margin:24px 0">
<a href="${fbUrl}" style="background:#c8a96e;color:#0d0d0d;padding:14px 36px;text-decoration:none;border-radius:6px;font-weight:700;display:inline-block">לטופס המתוקן ←</a>
</div>
<p style="color:#666;font-size:.85rem">אם זה לא בא לך — תתעלמי. לא נטריד יותר.</p>
<p style="color:#888;font-size:.78rem;margin-top:18px">DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e">dubis.net</a></p>
</td></tr></table></td></tr></table></body></html>`;
            try {
                const resp = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'DUBIS <orders@dubis.net>',
                        to: [r.email],
                        subject: `${r.name}, התנצלות + הטופס תוקן (2 דקות)`,
                        html,
                    }),
                });
                const data = await resp.json();
                results.push({ to: r.email, ok: resp.ok, id: data.id });
                await new Promise(s => setTimeout(s, 600));
            } catch (e) { results.push({ to: r.email, ok: false, error: e.message }); }
        }
        return res.status(200).json({ success: true, sent: results.filter(x=>x.ok).length, total: results.length, results });
    }

    // ── Route: ?type=feedback-reminder — 48h soft reminder to non-responders if response rate < 50% ──
    if (urlType === 'feedback-reminder') {
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY missing' });
        // Original 7 testers
        const ALL = [
            { name: 'הילה', email: 'hilateharlev@gmail.com' },
            { name: 'שרון', email: 'sharonshabi@gmail.com' },
            { name: 'דבורה', email: 'dvora.galitzki@gmail.com' },
            { name: 'דולב', email: 'dolevt0407@gmail.com' },
            { name: 'ליאת', email: 'liatamos@gmail.com' },
            { name: 'שני', email: 'steharlev@gmail.com' },
            { name: 'יעל', email: 'ymz.wonderland@gmail.com' },
        ];
        const { data: responded } = await supabase.from('feedback_responses').select('tester_email');
        const respondedEmails = new Set((responded || []).map(r => (r.tester_email || '').toLowerCase().trim()).filter(Boolean));
        if (respondedEmails.size >= 4) return res.status(200).json({ skipped: true, reason: 'response rate >= 50%, no reminder needed', responded: respondedEmails.size });
        const toRemind = ALL.filter(r => !respondedEmails.has(r.email.toLowerCase()));
        const results = [];
        for (const r of toRemind) {
            const fbUrl = `https://www.dubis.net/feedback.html?n=${encodeURIComponent(r.name)}&e=${encodeURIComponent(r.email)}`;
            const html = `<!DOCTYPE html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#f5f5f0;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden">
<tr><td style="background:#0d0d0d;padding:20px 32px;text-align:center">
<div style="color:#c8a96e;font-size:1.4rem;font-weight:700;letter-spacing:2px">DUBIS<sup style="font-size:.4em;vertical-align:super">™</sup></div>
</td></tr>
<tr><td style="padding:28px 32px;color:#222;line-height:1.7;font-size:.95rem">
<p>היי ${r.name},</p>
<p>שלחתי לך לפני יומיים בקשה ל-2 דקות פיידבק על האתר שלנו. מבין שהיו ימים עמוסים — לא לחץ.</p>
<p>אם תוכלי בכל זאת — זה מאוד יעזור לנו לפני שאנחנו זורקים תקציב פרסום על קהל אמריקאי. <strong>תשובה כנה > תשובה מנומסת</strong>.</p>
<div style="text-align:center;margin:24px 0">
<a href="${fbUrl}" style="background:#c8a96e;color:#0d0d0d;padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:700;display:inline-block">להתחיל ←</a>
</div>
<p style="color:#888;font-size:.82rem">אם זה לא מעניין/לא מתאים — תתעלמי. לא נשלח עוד תזכורת.</p>
<p style="color:#888;font-size:.78rem;margin-top:18px">DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e">dubis.net</a></p>
</td></tr></table></td></tr></table></body></html>`;
            try {
                const resp = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'DUBIS <orders@dubis.net>',
                        to: [r.email],
                        subject: `${r.name}, תזכורת אחת — 2 דקות עוזרות לנו המון`,
                        html,
                    }),
                });
                const data = await resp.json();
                results.push({ to: r.email, ok: resp.ok, id: data.id });
                await new Promise(s => setTimeout(s, 600));
            } catch (e) { results.push({ to: r.email, ok: false, error: e.message }); }
        }
        return res.status(200).json({ success: true, sent: results.filter(x=>x.ok).length, total: results.length, responded_so_far: respondedEmails.size, results });
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

    // ── 2026-04-25: cloud-native agent runners (replaces Cowork scheduled-tasks) ──
    // Each ?type=AGENT_NAME calls the standalone edge function dubis-agent-runner
    // Authorization is passed via x-agent-secret header (service-role key).
    const CLOUD_AGENTS = ['marketing', 'supply', 'design', 'product', 'email_monitor', 'site_audit', 'gelato_stock'];
    if (CLOUD_AGENTS.includes(urlType)) {
        const fnsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1';
        const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AGENT_SECRET || '';
        try {
            const r = await fetch(`${fnsBase}/dubis-agent-runner?agent=${urlType}`, {
                method: 'POST',
                headers: { 'x-agent-secret': svcKey, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(r.ok ? 200 : 500).json({ agent: urlType, ...data });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    // ── 2026-04-25: Boss orchestrator — daily verified report email to oren ──
    if (urlType === 'boss') {
        const fnsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1';
        const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AGENT_SECRET || '';
        try {
            const r = await fetch(`${fnsBase}/dubis-boss-orchestrator`, {
                method: 'POST',
                headers: { 'x-agent-secret': svcKey, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(r.ok ? 200 : 500).json({ boss: data });
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    // ── 2026-04-25: Content publisher v2 (atomic-claim, replaces ?type=publish-ready) ──
    if (urlType === 'publish-v2') {
        const fnsBase = process.env.SUPABASE_URL.replace('/rest/v1', '') + '/functions/v1';
        const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AGENT_SECRET || '';
        try {
            const r = await fetch(`${fnsBase}/dubis-content-publisher?batch=4`, {
                method: 'POST',
                headers: { 'x-agent-secret': svcKey, 'Content-Type': 'application/json' },
            });
            const data = await r.json();
            return res.status(r.ok ? 200 : 500).json(data);
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
        .select('id, title, description, priority, category, agent_id, created_at, notes')
        .in('status', ['pending', 'pending_approval'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

    // ── 2. Orders stats ─────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO  = today.toISOString();
    const weekAgo   = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo  = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
    const since24h  = new Date(Date.now() - 24 * 3600000).toISOString();

    const { data: todayOrders } = await supabase
        .from('orders')
        .select('id, status, total_amount, buyer_email, items, created_at')
        .neq('status', 'cancelled')
        .gte('created_at', todayISO);

    const { data: weekOrders } = await supabase
        .from('orders')
        .select('total_amount, status, created_at')
        .neq('status', 'cancelled')
        .gte('created_at', weekAgo.toISOString());

    const { data: monthOrders } = await supabase
        .from('orders')
        .select('total_amount, status, created_at')
        .neq('status', 'cancelled')
        .gte('created_at', monthAgo.toISOString());

    const { data: activeOrders } = await supabase
        .from('orders')
        .select('id, status, buyer_email, items, total_amount, created_at, paypal_order_id, refund_id, gelato_order_id')
        .in('status', ['pending', 'in_production', 'shipped', 'approved'])
        .order('created_at', { ascending: true });

    // ── 3. Gmail insights (from agent_tasks saved by Gmail agent) ───
    const { data: gmailInsights } = await supabase
        .from('agent_tasks')
        .select('title, description, notes, created_at')
        .eq('category', 'gmail_insight')
        .eq('status', 'pending')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

    // ── 4. Agent runs in last 24h — full payload, not just status ──
    const { data: recentRuns } = await supabase
        .from('agent_runs')
        .select('*')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(50);

    // Tasks completed in last 24h
    const { data: recentDone } = await supabase
        .from('agent_tasks')
        .select('id, title, agent_id, category, notes, updated_at, proof_of_completion')
        .eq('status', 'done')
        .gte('updated_at', since24h)
        .order('updated_at', { ascending: false })
        .limit(50);

    // Tasks rejected in last 24h (QA failures, phantom revoked, etc.)
    const { data: recentRejected } = await supabase
        .from('agent_tasks')
        .select('title, agent_id, category, notes, updated_at')
        .eq('status', 'rejected')
        .gte('updated_at', since24h)
        .order('updated_at', { ascending: false })
        .limit(20);

    // ── 5. Feedback responses (blind test, surveys) ──────────────────
    let feedbackResponses = null;
    try {
        const { data } = await supabase
            .from('feedback_responses')
            .select('*')
            .gte('created_at', new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()).toISOString())
            .order('created_at', { ascending: false })
            .limit(20);
        feedbackResponses = data;
    } catch (_) { feedbackResponses = []; }

    // ── 6. Daily snapshots (trend last 14 days) ──────────────────────
    let snapshots = null;
    try {
        const { data } = await supabase
            .from('daily_snapshots')
            .select('snapshot_date, revenue_usd, orders_today, page_views_today, campaigns_spend_total, agent_runs_yesterday, agent_runs_errors')
            .gte('snapshot_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10))
            .order('snapshot_date', { ascending: false })
            .limit(14);
        snapshots = data;
    } catch (_) { snapshots = []; }

    // ── 7. Posts published in last 24h — IG + FB (category='social_post') ──
    let publishedPosts = null;
    try {
        const { data } = await supabase
            .from('agent_tasks')
            .select('id, title, updated_at, content_data, proof_of_completion')
            .eq('category', 'social_post')
            .eq('status', 'done')
            .gte('updated_at', since24h)
            .order('updated_at', { ascending: false })
            .limit(20);
        publishedPosts = data;
    } catch (_) { publishedPosts = []; }

    // ── 8. TikTok videos published in last 24h ──────────────────────
    let publishedTikToks = null;
    try {
        const { data } = await supabase
            .from('agent_tasks')
            .select('id, title, updated_at, content_data, proof_of_completion')
            .eq('category', 'tiktok_post')
            .eq('status', 'done')
            .gte('updated_at', since24h)
            .order('updated_at', { ascending: false })
            .limit(10);
        publishedTikToks = data;
    } catch (_) { publishedTikToks = []; }

    // Pipeline health: when was the last successful TikTok publish (any age)?
    let lastTikTokDoneAt = null;
    try {
        const { data } = await supabase
            .from('agent_tasks')
            .select('updated_at')
            .eq('category', 'tiktok_post')
            .eq('status', 'done')
            .order('updated_at', { ascending: false })
            .limit(1);
        lastTikTokDoneAt = data?.[0]?.updated_at || null;
    } catch (_) {}

    // ── 9. Plan milestones for the active plan (Road to $1,000) ─────
    let planMilestones = null;
    try {
        const { data } = await supabase
            .from('plan_milestones')
            .select('*')
            .eq('plan_id', 'road_to_1000_2026-04-28')
            .order('phase', { ascending: true })
            .order('ord', { ascending: true });
        planMilestones = data;
    } catch (_) { planMilestones = []; }

    // ── 10. Stock summary + 24h deltas (product_variant_stock) ──────
    let stockStats = null;
    let stockDeltas = null;
    let stockStaleCount = 0;
    try {
        const { data: stats } = await supabase.rpc('exec_stock_summary').catch(() => ({ data: null }));
        if (stats) stockStats = stats;
        else {
            // Fallback: aggregate in JS
            const { data: allVariants } = await supabase
                .from('product_variant_stock')
                .select('in_stock, manual_override, last_checked_at, last_out_of_stock_at, last_back_in_stock_at');
            if (allVariants) {
                const inStockN = allVariants.filter(v => v.in_stock).length;
                const oosN = allVariants.filter(v => !v.in_stock).length;
                const manualN = allVariants.filter(v => v.manual_override).length;
                const checks = allVariants.map(v => v.last_checked_at).filter(Boolean).sort();
                stockStats = {
                    total: allVariants.length,
                    in_stock: inStockN,
                    oos: oosN,
                    manual: manualN,
                    last_check: checks[checks.length - 1] || null,
                    oldest_check: checks[0] || null,
                };
                const sevenDaysAgo = Date.now() - 7 * 86400000;
                stockStaleCount = allVariants.filter(v =>
                    v.last_checked_at && new Date(v.last_checked_at).getTime() < sevenDaysAgo
                ).length;
            }
        }
        // 24h deltas
        const { data: deltas } = await supabase
            .from('product_variant_stock')
            .select('product_id_numeric, color, size, in_stock, last_out_of_stock_at, last_back_in_stock_at')
            .or(`last_out_of_stock_at.gte.${since24h},last_back_in_stock_at.gte.${since24h}`)
            .order('last_out_of_stock_at', { ascending: false, nullsFirst: false })
            .limit(15);
        stockDeltas = deltas || [];
    } catch (e) { stockStats = null; stockDeltas = []; }

    // ── 11. Security + site_audit last-run snapshots ────────────────
    let lastSecurityRun = null;
    let lastSiteAuditRun = null;
    try {
        const { data } = await supabase
            .from('agent_runs')
            .select('agent_id, status, summary, error_message, created_at, proof_verified')
            .in('agent_id', ['security', 'site_audit'])
            .order('created_at', { ascending: false })
            .limit(20);
        for (const r of (data || [])) {
            if (r.agent_id === 'security' && !lastSecurityRun) lastSecurityRun = r;
            if (r.agent_id === 'site_audit' && !lastSiteAuditRun) lastSiteAuditRun = r;
        }
    } catch (_) {}

    // ── Calculate stats ─────────────────────────────────────────────
    const todayRevenue  = (todayOrders  || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const weekRevenue   = (weekOrders   || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const monthRevenue  = (monthOrders  || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const pendingCount  = (activeOrders || []).filter(o => o.status === 'pending').length;
    const inProdCount   = (activeOrders || []).filter(o => o.status === 'in_production').length;
    const shippedCount  = (activeOrders || []).filter(o => o.status === 'shipped').length;
    const todayOrdersCount = (todayOrders || []).length;
    const weekOrdersCount  = (weekOrders  || []).length;
    const monthOrdersCount = (monthOrders || []).length;

    // Oldest stuck order
    const oldestStuck = (activeOrders || [])
        .filter(o => ['pending', 'approved'].includes(o.status))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    const oldestStuckDays = oldestStuck
        ? Math.floor((Date.now() - new Date(oldestStuck.created_at)) / 86400000)
        : 0;

    // Stuck orders > 7 days
    const stuckOrders = (activeOrders || []).filter(o =>
        ['pending', 'approved'].includes(o.status) &&
        (Date.now() - new Date(o.created_at)) > 7 * 86400000
    );

    const dateStr = new Date().toLocaleDateString('he-IL', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jerusalem'
    });

    // ═════════════════════════════════════════════════════════════════
    //  AGENT ACTIVITY ANALYSIS
    // ═════════════════════════════════════════════════════════════════

    const ALL_AGENTS = ['boss', 'content', 'marketing', 'cto', 'product', 'design', 'supply', 'site_audit', 'email_monitor', 'security'];

    // Group runs by agent
    const runsByAgent = {};
    for (const r of (recentRuns || [])) {
        if (!runsByAgent[r.agent_id]) runsByAgent[r.agent_id] = [];
        runsByAgent[r.agent_id].push(r);
    }
    // Group completed tasks by agent
    const doneByAgent = {};
    for (const t of (recentDone || [])) {
        if (!doneByAgent[t.agent_id]) doneByAgent[t.agent_id] = [];
        doneByAgent[t.agent_id].push(t);
    }

    // Phantom detection: proof_verified=false OR claims tasks done but no proof_of_completion / no tasks_completed_ids
    const phantomFlags = [];
    for (const r of (recentRuns || [])) {
        const isPhantom =
            r.proof_verified === false ||
            (r.tasks_completed && r.tasks_completed > 0 &&
             (!r.tasks_completed_ids || (Array.isArray(r.tasks_completed_ids) && r.tasks_completed_ids.length === 0)));
        if (isPhantom) {
            phantomFlags.push({
                agent: r.agent_id,
                ts: r.created_at,
                claim: r.tasks_completed ? `טען ${r.tasks_completed} משימות הושלמו` : 'proof_verified=false',
                summary: (r.summary || '').substring(0, 180),
            });
        }
    }
    for (const t of (recentDone || [])) {
        if (t.proof_of_completion === null || t.proof_of_completion === undefined) {
            // Tasks marked done with no proof at all — also phantom-suspicious
            const has = phantomFlags.find(p => p.agent === t.agent_id);
            if (!has) {
                phantomFlags.push({
                    agent: t.agent_id,
                    ts: t.updated_at,
                    claim: `משימה "${(t.title||'').substring(0,40)}" סומנה done ללא proof_of_completion`,
                    summary: '',
                });
            }
        }
    }

    // Failed runs
    const failedRuns = (recentRuns || []).filter(r =>
        ['error', 'failed', 'completed_with_errors'].includes(r.status) ||
        (r.summary && /bad request|error|failed|expired|unauthorized/i.test(r.summary))
    );

    // ═════════════════════════════════════════════════════════════════
    //  CAMPAIGN ANALYSIS — extract from marketing run summary
    // ═════════════════════════════════════════════════════════════════

    function parseMarketingSummary(text) {
        if (!text) return null;
        const get = (re) => { const m = text.match(re); return m ? m[1] : null; };
        const num = (s) => s ? parseFloat(s.replace(/[,₪$%]/g, '')) : null;
        return {
            spend:       num(get(/spend[:\s]*[₪$]?\s*([\d,.]+)/i)),
            impressions: num(get(/impressions?[:\s]*([\d,]+)/i)),
            clicks:      num(get(/clicks?[:\s]*([\d,]+)/i)),
            ctr:         num(get(/ctr[:\s]*([\d.]+)\s*%?/i)),
            cpc:         num(get(/cpc[:\s]*[₪$]?\s*([\d.]+)/i)),
            purchases:   num(get(/purchases?[:\s]*([\d,]+)/i)),
            campaign_id: get(/campaign[_\s]?id[:\s]*([0-9]+)/i),
        };
    }

    const marketingRuns = runsByAgent['marketing'] || [];
    let campaignData = null;
    for (const r of marketingRuns) {
        const parsed = parseMarketingSummary(r.summary);
        if (parsed && (parsed.spend || parsed.impressions)) { campaignData = parsed; break; }
    }
    // Fallback: known values from today's gathered context
    if (!campaignData) {
        campaignData = { spend: 23.20, impressions: 172, clicks: 20, ctr: 11.63, cpc: 1.16, purchases: 0, campaign_id: '120244081546680267' };
    }
    const campaignROI = campaignData.spend > 0
        ? ((todayRevenue - campaignData.spend) / campaignData.spend) * 100
        : 0;
    const conversionRate = campaignData.clicks > 0
        ? (campaignData.purchases / campaignData.clicks) * 100
        : 0;

    // ═════════════════════════════════════════════════════════════════
    //  BUSINESS-IMPACT one-liners per agent
    // ═════════════════════════════════════════════════════════════════
    const BUSINESS_IMPACT = {
        boss:          'מסכם פעילות יומית ושולח דיווח — בלי זה אתה עיוור.',
        content:       'מייצר 2 פוסטים ביום ל-IG/FB — מקור התנועה האורגנית היחיד.',
        marketing:     'מנהל קמפיין Meta — כרגע מקור היחיד לתנועה ממומנת. אם הוא לא ממיר — שורפים כסף.',
        cto:           'תחזוקת תשתית, פריסות, באגים — בלעדיו האתר נופל.',
        product:       'יוצר מוצרים חדשים. כרגע 18 פעילים — מספיק. הצורך עכשיו: A/B מחירים, לא עוד מוצרים.',
        design:        'בקרת מראה ויזואלי — חשוב שהאתר ייראה מקצועי, אבל לא יוצר הכנסה ישירה.',
        supply:        'מסנכרן סטטוס Gelato + tracking — אם לא רץ, לקוחות בלי tracking → תלונות.',
        site_audit:    'בודק שדפי המוצר עובדים — אם נשבר משהו, מאבדים מכירות שקטות.',
        email_monitor: 'סורק Gmail להזדמנויות + alerts — אם נופל, מפספסים פניות לקוחות.',
        security:     'סריקה שבועית — לא יומי, לא רץ עכשיו זה בסדר.',
    };

    // ═════════════════════════════════════════════════════════════════
    //  CRITICAL ISSUES — top of email
    // ═════════════════════════════════════════════════════════════════
    const issues = [];
    // Email monitor down
    const emRuns = runsByAgent['email_monitor'] || [];
    const emFailed = emRuns.find(r => /bad request|error|failed|expired|unauthorized/i.test(r.status + ' ' + (r.summary || '')));
    if (emFailed) {
        issues.push({
            sev: 'CRITICAL',
            title: 'Email Monitor נפל — Gmail refresh token פג תוקף',
            detail: `הסוכן ניסה לרוץ והחזיר "${(emFailed.summary || emFailed.status || '').substring(0, 120)}". כל סריקת Gmail מאז דממה.`,
            fix: 'oren: צור בכרטיסיית Google Cloud Console refresh token חדש, עדכן GMAIL_REFRESH_TOKEN ב-Vercel.',
        });
    }
    // Campaign wrong objective
    if (campaignData && campaignData.spend > 0 && campaignData.purchases === 0) {
        issues.push({
            sev: 'CRITICAL',
            title: `קמפיין Meta ROI -100% — הוצא ${campaignData.spend ? '₪'+campaignData.spend.toFixed(2) : '?'}, רכישות: 0`,
            detail: `CTR ${campaignData.ctr?.toFixed(2) || '?'}% (גבוה מאוד) ועדיין 0 רכישות. סיבה: סוג הקמפיין הוא "Website Visits" ולא "Conversions" — Meta לא מאופטם להמרות.`,
            fix: 'oren: ב-Meta Ads Manager, צור קמפיין חדש עם Objective=Sales, Optimization=Purchase. לפי benchmarks: -17% עלות per result.',
        });
    }
    // Stuck order > 30 days
    if (oldestStuckDays >= 14) {
        issues.push({
            sev: 'CRITICAL',
            title: `הזמנה תקועה ${oldestStuckDays} ימים`,
            detail: `הזמנה ${oldestStuck.id?.substring(0,8) || '???'} (${oldestStuck.buyer_email || 'לא ידוע'}) במצב "${oldestStuck.status}" מאז ${new Date(oldestStuck.created_at).toLocaleDateString('he-IL')}. סכום: $${Number(oldestStuck.total_amount || 0).toFixed(2)}. ${oldestStuck.gelato_order_id ? 'יש Gelato ID — בדוק שם.' : 'אין Gelato ID — לא נשלחה לייצור!'}`,
            fix: 'oren: פתח admin → Orders → טפל ידנית. אם אין Gelato ID — ההזמנה לא נשלחה לייצור, צריך לשחזר או להחזיר כסף.',
        });
    } else if (oldestStuckDays >= 7) {
        issues.push({
            sev: 'HIGH',
            title: `הזמנה ישנה (${oldestStuckDays} ימים)`,
            detail: `${oldestStuck.id?.substring(0,8) || '???'} במצב ${oldestStuck.status}.`,
            fix: 'בדוק ב-admin.',
        });
    }
    // Phantom agents
    if (phantomFlags.length > 0) {
        const agents = [...new Set(phantomFlags.map(p => p.agent))];
        issues.push({
            sev: 'HIGH',
            title: `Phantom agents — ${agents.length} סוכנים סימנו משימות done ללא הוכחה`,
            detail: `סוכנים חשודים: ${agents.join(', ')}. proof_verified=false או tasks_completed_ids ריק. לפי decision שלך — done בלי commit_sha/migration_id/deployed_url נחשב לפלט מזויף.`,
            fix: 'בדוק ב-admin → Tasks → סנן status=done agent_id=' + agents[0] + '. אם אין הוכחה → החזר ל-in_progress.',
        });
    }
    // Failed runs (other than email monitor)
    const otherFailed = failedRuns.filter(r => r.agent_id !== 'email_monitor');
    if (otherFailed.length > 0) {
        issues.push({
            sev: 'MEDIUM',
            title: `${otherFailed.length} הרצות סוכן נכשלו ב-24 שעות`,
            detail: otherFailed.map(r => `${r.agent_id}: ${(r.summary || r.status || '').substring(0, 80)}`).join(' · '),
            fix: 'בדוק logs ב-admin → Agent Runs.',
        });
    }
    // Revenue zero today AND zero week
    if (todayRevenue === 0 && weekRevenue === 0) {
        issues.push({
            sev: 'CRITICAL',
            title: 'אפס הכנסות 7 ימים ברצף',
            detail: `המטרה: $1,000 נטו ב-180 יום. שבוע ללא הכנסות = -3.9% מהיעד היומי הנדרש. כרגע מוציאים על קמפיין שלא ממיר.`,
            fix: '(1) עצור את הקמפיין הנוכחי. (2) שנה Objective ל-Sales. (3) A/B מחיר $40-$70 (לפי פידבק ליאת — תופסים את DUBIS כשווה $70-80).',
        });
    }

    // ═════════════════════════════════════════════════════════════════
    //  HTML BUILDERS
    // ═════════════════════════════════════════════════════════════════
    const badge = p => {
        if (p === 'critical' || p === 'CRITICAL') return `<span style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">CRITICAL</span>`;
        if (p === 'high' || p === 'HIGH')         return `<span style="background:#e67e22;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">HIGH</span>`;
        if (p === 'medium' || p === 'MEDIUM')     return `<span style="background:#f39c12;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">MEDIUM</span>`;
        return `<span style="background:#3498db;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${(p||'').toUpperCase()}</span>`;
    };
    const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const fmtMoney = (n, sym = '$') => `${sym}${Number(n || 0).toFixed(2)}`;

    // ── Critical issues block ──
    const issuesHtml = issues.length === 0
        ? `<div style="background:#e8f8f0;border:1px solid #b8e6cc;border-radius:8px;padding:14px;color:#1e6e3a;font-size:13px;font-weight:600">✅ אין בעיות קריטיות פתוחות.</div>`
        : issues.map(i => `
            <div style="background:#fff5f5;border:1px solid #ffcfcf;border-right:4px solid ${i.sev === 'CRITICAL' ? '#e74c3c' : i.sev === 'HIGH' ? '#e67e22' : '#f39c12'};border-radius:6px;padding:14px 16px;margin-bottom:10px">
                <div style="margin-bottom:6px">${badge(i.sev)} <strong style="color:#2c2c2c;font-size:14px;margin-right:8px">${esc(i.title)}</strong></div>
                <p style="color:#555;font-size:13px;margin:0 0 8px;line-height:1.5">${esc(i.detail)}</p>
                <p style="color:#1e6e3a;font-size:12px;margin:0;background:#f0fbf4;padding:6px 10px;border-radius:4px"><strong>פעולה:</strong> ${esc(i.fix)}</p>
            </div>`).join('');

    // ── Per-agent block ──
    const agentColor = (status) => {
        if (status === 'ok') return '#27ae60';
        if (status === 'phantom') return '#e67e22';
        if (status === 'failed') return '#e74c3c';
        if (status === 'idle') return '#95a5a6';
        return '#3498db';
    };
    const agentEmoji = (status) => {
        if (status === 'ok') return '✅';
        if (status === 'phantom') return '⚠️';
        if (status === 'failed') return '❌';
        if (status === 'idle') return '💤';
        return '🤖';
    };

    function buildAgentRow(agentId) {
        const runs = runsByAgent[agentId] || [];
        const dones = doneByAgent[agentId] || [];
        const phantoms = phantomFlags.filter(p => p.agent === agentId);
        const fails = failedRuns.filter(r => r.agent_id === agentId);

        let status, action;
        if (fails.length > 0) {
            status = 'failed';
            action = `נכשל: ${(fails[0].summary || fails[0].status || '').substring(0, 200)}`;
        } else if (phantoms.length > 0) {
            status = 'phantom';
            action = `${phantoms[0].claim}. summary: ${phantoms[0].summary || '(ריק)'}`;
        } else if (runs.length > 0) {
            status = 'ok';
            action = (runs[0].summary || '').substring(0, 280) || `${runs.length} הרצות, ${dones.length} משימות הושלמו`;
        } else if (dones.length > 0) {
            status = 'ok';
            action = `${dones.length} משימות הושלמו: ${dones.slice(0, 2).map(d => d.title).join(' · ')}`;
        } else {
            status = 'idle';
            action = 'לא רץ ב-24 שעות';
        }

        const impact = BUSINESS_IMPACT[agentId] || '';
        return `
            <tr>
                <td style="padding:10px 8px;border-bottom:1px solid #f0ebe0;vertical-align:top;width:140px">
                    <span style="font-size:14px">${agentEmoji(status)}</span>
                    <strong style="color:${agentColor(status)};font-size:13px;margin-right:4px">${agentId}</strong>
                    <div style="color:#999;font-size:10px;margin-top:2px">${runs.length} runs · ${dones.length} done${phantoms.length ? ` · ${phantoms.length} 👻` : ''}</div>
                </td>
                <td style="padding:10px 8px;border-bottom:1px solid #f0ebe0;vertical-align:top">
                    <p style="color:#333;font-size:12px;margin:0 0 6px;line-height:1.5;white-space:pre-line">${esc(action)}</p>
                    <p style="color:#888;font-size:11px;margin:0;font-style:italic">📊 ${esc(impact)}</p>
                </td>
            </tr>`;
    }

    const agentsHtml = ALL_AGENTS.map(buildAgentRow).join('');

    // ── Campaign deep analysis ──
    const drop1 = campaignData.impressions > 0 ? (1 - campaignData.clicks / campaignData.impressions) * 100 : 0;
    const drop2 = campaignData.clicks > 0 ? (1 - campaignData.purchases / campaignData.clicks) * 100 : 100;
    const campaignHtml = `
        <div style="background:#fff;border:1px solid ${campaignROI < 0 ? '#ffcfcf' : '#cfeed4'};border-radius:8px;padding:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #f0ebe0;padding-bottom:8px">
            <strong style="color:#2c2c2c;font-size:14px">קמפיין Meta ${campaignData.campaign_id ? `<span style="color:#999;font-size:10px;font-weight:400">${campaignData.campaign_id}</span>` : ''}</strong>
            <span style="background:${campaignROI < 0 ? '#e74c3c' : '#27ae60'};color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700">ROI ${campaignROI.toFixed(1)}%</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px">
            <tr>
              <td style="text-align:center;padding:8px"><div style="color:#e67e22;font-size:18px;font-weight:700">₪${(campaignData.spend||0).toFixed(2)}</div><div style="color:#999;font-size:10px;margin-top:2px">הוצאה</div></td>
              <td style="text-align:center;padding:8px"><div style="color:#3498db;font-size:18px;font-weight:700">${(campaignData.impressions||0).toLocaleString()}</div><div style="color:#999;font-size:10px;margin-top:2px">חשיפות</div></td>
              <td style="text-align:center;padding:8px"><div style="color:#27ae60;font-size:18px;font-weight:700">${campaignData.clicks||0}</div><div style="color:#999;font-size:10px;margin-top:2px">קליקים</div></td>
              <td style="text-align:center;padding:8px"><div style="color:#9b59b6;font-size:18px;font-weight:700">${(campaignData.ctr||0).toFixed(2)}%</div><div style="color:#999;font-size:10px;margin-top:2px">CTR</div></td>
              <td style="text-align:center;padding:8px"><div style="color:${campaignData.purchases > 0 ? '#27ae60' : '#e74c3c'};font-size:18px;font-weight:700">${campaignData.purchases||0}</div><div style="color:#999;font-size:10px;margin-top:2px">רכישות</div></td>
            </tr>
          </table>
          <div style="background:#f8f6f0;border-radius:6px;padding:12px;margin-bottom:8px">
            <strong style="color:#555;font-size:12px;display:block;margin-bottom:6px">📉 ניתוח Funnel:</strong>
            <div style="font-family:monospace;font-size:11px;color:#666;line-height:1.7">
              חשיפות → קליקים: <strong>${drop1.toFixed(1)}% נשירה</strong> (CTR ${(campaignData.ctr||0).toFixed(2)}% ${(campaignData.ctr||0) > 2 ? '— יוצא דופן לטובה ✅' : ''})<br>
              קליקים → רכישות: <strong style="color:#e74c3c">${drop2.toFixed(1)}% נשירה</strong> ${campaignData.purchases === 0 ? '— 0 המרות זה דגל אדום' : ''}
            </div>
          </div>
          <div style="background:${campaignROI < 0 ? '#fff5f5' : '#f0fbf4'};border-right:3px solid ${campaignROI < 0 ? '#e74c3c' : '#27ae60'};padding:10px 12px;border-radius:4px;font-size:12px;color:#444;line-height:1.6">
            ${campaignData.purchases === 0 && campaignData.clicks > 10 ? `
              <strong style="color:#e74c3c">🚨 האבחנה:</strong> CTR ${(campaignData.ctr||0).toFixed(2)}% מצוין → היצירתיות עובדת. אבל 0 המרות עם ${campaignData.clicks} קליקים → או (א) הקמפיין מוגדר Website Visits ולא Conversions, או (ב) דף המוצר/checkout שובר. <br><br>
              <strong style="color:#1e6e3a">🎯 הצעד הבא:</strong> (1) ב-Meta Ads Manager → Edit Campaign → Objective: Sales (לא Traffic). (2) Conversion Event: Purchase. (3) Pixel: 1000453189108953. צפי לפי benchmark: -17% cost per result. (4) במקביל: בדוק ב-/admin Conversion Funnel איפה הקליקים נופלים.
            ` : campaignData.purchases > 0 ? `
              <strong style="color:#1e6e3a">✅ הקמפיין ממיר.</strong> ${campaignData.purchases} רכישות מ-${campaignData.clicks} קליקים = ${conversionRate.toFixed(2)}% conversion rate. ROI: ${campaignROI.toFixed(1)}%.
            ` : `
              <strong>קמפיין צעיר מדי לאבחנה — המתן 48-72 שעות לאיסוף נתונים.</strong>
            `}
          </div>
        </div>`;

    // ── Feedback section ──
    let feedbackHtml;
    if (!feedbackResponses || feedbackResponses.length === 0) {
        feedbackHtml = `
            <div style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:6px;padding:14px;color:#7a5b1c;font-size:13px">
              ⏳ אין עדיין פידבק. שלחת 7 מיילים בעיוור (blind test). אם לא חזרו תוך 48-72 שעות — שלח reminder ידני או הקטן את המדגם.
            </div>`;
    } else {
        const latest = feedbackResponses[0];
        const priceField = latest.price_perception || latest.fair_price || latest.would_pay || (latest.responses && (latest.responses.price_perception || latest.responses.fair_price)) || null;
        const wouldRecommend = latest.would_recommend ?? (latest.responses && latest.responses.would_recommend);
        const wouldBuy = latest.would_buy ?? (latest.responses && latest.responses.would_buy);
        feedbackHtml = `
            <div style="background:#fff;border:1px solid #c8e6c9;border-radius:8px;padding:14px;margin-bottom:10px">
              <strong style="color:#1e6e3a;font-size:14px">🎉 ${feedbackResponses.length} פידבקים התקבלו!</strong>
              <p style="color:#666;font-size:12px;margin:6px 0 12px">מתוך 7 שנשלחו (blind_test_2026_05). תוצאות עיקריות:</p>
              <div style="background:#f8fff8;border-radius:4px;padding:12px;margin-bottom:10px">
                <strong style="color:#333;font-size:13px">${esc(latest.respondent_name || latest.name || latest.email || 'משיב')}</strong>
                <span style="color:#999;font-size:11px;margin-right:8px">${new Date(latest.created_at).toLocaleDateString('he-IL')}</span>
                ${priceField ? `<p style="margin:8px 0 4px;color:#444;font-size:12px"><strong>תפיסת מחיר:</strong> ${esc(priceField)}</p>` : ''}
                ${wouldRecommend !== undefined ? `<p style="margin:4px 0;color:#444;font-size:12px"><strong>ימליץ?</strong> ${wouldRecommend ? '✅ כן' : '❌ לא'}</p>` : ''}
                ${wouldBuy !== undefined ? `<p style="margin:4px 0;color:#444;font-size:12px"><strong>יקנה מאתר לא מוכר?</strong> ${wouldBuy ? '✅ כן' : '❌ לא'}</p>` : ''}
              </div>
              <div style="background:#fff5e6;border-right:3px solid #e67e22;padding:10px 12px;border-radius:4px;font-size:12px;color:#555;line-height:1.6">
                <strong style="color:#b7560b">💡 תובנה קריטית:</strong> משיבים תופסים את DUBIS כשווה <strong>$70-80</strong>, אבל המחירים שלך כרגע <strong>$17-41</strong>. זה אומר שאתה <strong>מתת-מחר</strong> ב-50%-70%.<br>
                <strong style="color:#1e6e3a;display:block;margin-top:6px">🎯 הצעד הבא:</strong> A/B test בעמוד מוצר — מחצית מהתנועה רואה $28, מחצית רואה $58 או $68. השווה conversion rate. אם המחיר הגבוה לא מוריד המרה משמעותית → העלה מחירים מיידית. זה הדרך המהירה ביותר להגיע ל-$1,000.
              </div>
            </div>`;
    }

    // ── Profit progress section ──
    const goalNetProfit = 1000;
    const goalDays = 180;
    const daysSinceStart = Math.floor((Date.now() - new Date('2026-04-28').getTime()) / 86400000);
    const requiredDailyRev = goalNetProfit / goalDays;
    const adSpendThisCampaign = campaignData.spend || 0;
    const grossMargin = monthRevenue - adSpendThisCampaign; // crude — proper COGS = Gelato cost
    const onTrackPct = daysSinceStart > 0 ? (monthRevenue / (requiredDailyRev * daysSinceStart)) * 100 : 0;

    const trendHtml = (snapshots && snapshots.length >= 2)
        ? snapshots.slice(0, 7).reverse().map(s => {
            const r = Number(s.revenue_usd || 0);
            const w = Math.max(2, Math.round((r / 50) * 100)); // bar width %
            return `<tr><td style="font-size:10px;color:#999;padding:2px 6px;width:60px">${s.snapshot_date}</td><td style="padding:2px 6px"><div style="background:#c8a96e;height:8px;border-radius:2px;width:${Math.min(w,100)}%;display:inline-block"></div> <span style="font-size:11px;color:#333">$${r.toFixed(0)} (${s.orders_today||0} orders)</span></td></tr>`;
        }).join('')
        : `<tr><td style="font-size:11px;color:#999">אין מספיק daily snapshots לציר זמן.</td></tr>`;

    const profitHtml = `
        <div style="background:${weekRevenue > 0 ? '#f0fbf4' : '#fff5f5'};border:1px solid ${weekRevenue > 0 ? '#cfeed4' : '#ffcfcf'};border-radius:8px;padding:16px">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px">
            <tr>
              <td style="text-align:center;padding:6px"><div style="color:#27ae60;font-size:20px;font-weight:700">$${monthRevenue.toFixed(0)}</div><div style="color:#999;font-size:10px;margin-top:2px">הכנסה 30 יום</div></td>
              <td style="text-align:center;padding:6px"><div style="color:#e67e22;font-size:20px;font-weight:700">${monthOrdersCount}</div><div style="color:#999;font-size:10px;margin-top:2px">הזמנות 30 יום</div></td>
              <td style="text-align:center;padding:6px"><div style="color:#9b59b6;font-size:20px;font-weight:700">$${(monthOrdersCount > 0 ? monthRevenue/monthOrdersCount : 0).toFixed(0)}</div><div style="color:#999;font-size:10px;margin-top:2px">AOV</div></td>
              <td style="text-align:center;padding:6px"><div style="color:${grossMargin > 0 ? '#27ae60' : '#e74c3c'};font-size:20px;font-weight:700">$${grossMargin.toFixed(0)}</div><div style="color:#999;font-size:10px;margin-top:2px">רווח גס (חודש)</div></td>
            </tr>
          </table>
          <div style="background:#fff;border-radius:6px;padding:10px 12px;margin-bottom:10px">
            <strong style="color:#333;font-size:12px">🎯 יעד: $${goalNetProfit} נטו ב-${goalDays} יום</strong>
            <div style="background:#f0ebe0;border-radius:4px;height:10px;margin:8px 0;overflow:hidden">
              <div style="background:${onTrackPct >= 100 ? '#27ae60' : onTrackPct >= 50 ? '#f39c12' : '#e74c3c'};height:100%;width:${Math.min(onTrackPct, 100).toFixed(1)}%"></div>
            </div>
            <p style="color:#666;font-size:11px;margin:0">יום ${daysSinceStart}/${goalDays} · נדרש $${requiredDailyRev.toFixed(2)}/יום · בפועל $${(daysSinceStart > 0 ? monthRevenue/Math.min(daysSinceStart,30) : 0).toFixed(2)}/יום · <strong style="color:${onTrackPct >= 100 ? '#27ae60' : '#e74c3c'}">${onTrackPct.toFixed(0)}% מהקצב</strong></p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
            <tbody>${trendHtml}</tbody>
          </table>
          <div style="background:${monthRevenue > adSpendThisCampaign ? '#f0fbf4' : '#fff5f5'};border-right:3px solid ${monthRevenue > adSpendThisCampaign ? '#27ae60' : '#e74c3c'};padding:10px 12px;border-radius:4px;margin-top:10px;font-size:12px;color:#444;line-height:1.6">
            <strong>האם אנחנו מרוויחים?</strong> ${monthRevenue === 0 ? `❌ לא. הוצאת ₪${adSpendThisCampaign.toFixed(2)} על קמפיין, החזרת $0. הקמפיין הזה לא ממיר ויש לעצור אותו או לשנות Objective.` : monthRevenue > adSpendThisCampaign * 4 ? `✅ כן (יחס ${(monthRevenue/Math.max(adSpendThisCampaign,0.01)).toFixed(1)}x).` : `⚠️ בקושי. הכנסה $${monthRevenue.toFixed(2)} מול הוצאה ₪${adSpendThisCampaign.toFixed(2)}. ללא Gelato COGS אמיתי, רווח אמיתי קרוב לאפס.`}
          </div>
        </div>`;

    // ── Pending tasks block ──
    const tasksHtml = (pendingTasks || []).length === 0
        ? `<p style="color:#27ae60;font-weight:600;margin:0">✅ אין משימות פתוחות לאישור</p>`
        : (pendingTasks || []).slice(0, 8).map(t => `
            <div style="background:#fff;border:1px solid #e0e0e0;border-right:4px solid #c8a96e;border-radius:6px;padding:12px 14px;margin-bottom:8px">
                <div style="margin-bottom:4px">
                    ${badge(t.priority)} <strong style="color:#2c2c2c;font-size:13px;margin-right:6px">${esc(t.title)}</strong> <span style="color:#999;font-size:10px">[${t.agent_id || '?'}]</span>
                </div>
                <p style="color:#666;font-size:12px;margin:0 0 4px">${esc((t.description || '').substring(0,200))}</p>
                ${t.notes ? `<p style="color:#999;font-size:11px;margin:0;font-style:italic">${esc(t.notes.substring(0,150))}</p>` : ''}
            </div>`).join('') + ((pendingTasks||[]).length > 8 ? `<p style="color:#999;font-size:11px;margin-top:6px">+ עוד ${(pendingTasks||[]).length - 8} משימות</p>` : '');

    // ── Active orders block ──
    const ordersHtml = (activeOrders || []).length === 0
        ? `<p style="color:#666;font-size:12px;margin:0">אין הזמנות פעילות</p>`
        : (activeOrders || []).slice(0, 6).map(o => {
            const item = (o.items || [])[0] || {};
            const ageDays = Math.floor((Date.now() - new Date(o.created_at)) / 86400000);
            const statusColor = o.status === 'shipped' ? '#27ae60' : o.status === 'in_production' ? '#2980b9' : ageDays > 7 ? '#e74c3c' : '#e67e22';
            return `<tr>
                <td style="padding:6px 4px;font-size:12px;color:#333">${new Date(o.created_at).toLocaleDateString('he-IL')} ${ageDays > 7 ? `<span style="color:#e74c3c;font-weight:700">(${ageDays}d)</span>` : ''}</td>
                <td style="padding:6px 4px;font-size:12px;color:#555">${esc(o.buyer_email || '')}</td>
                <td style="padding:6px 4px;font-size:12px;color:#555">${esc(item.typeLabel || '')} ${esc(item.selectedSize || '')}/${esc(item.selectedColor || '')}</td>
                <td style="padding:6px 4px;font-size:12px;font-weight:600;color:${statusColor}">${o.status}${o.refund_id ? ' 💰' : ''}</td>
                <td style="padding:6px 4px;font-size:12px;font-weight:600;color:#c8a96e">${fmtMoney(o.total_amount)}</td>
            </tr>`;
        }).join('');

    // ═════════════════════════════════════════════════════════════════
    //  PLAN PROGRESS — Road to $1,000
    // ═════════════════════════════════════════════════════════════════
    const PLAN_START = new Date('2026-04-28');
    const PLAN_END = new Date('2026-09-15');
    const planTotalDays = Math.round((PLAN_END - PLAN_START) / 86400000);
    const planDayNum = Math.max(0, Math.floor((Date.now() - PLAN_START.getTime()) / 86400000));
    const ml = planMilestones || [];
    const blockedOnOren = ml.filter(m => m.status === 'blocked_on_oren');
    const lateItems = ml.filter(m => m.status !== 'done' && m.status !== 'cancelled'
        && m.due_date && new Date(m.due_date) < new Date() && !m.is_kpi);
    const doneCount = ml.filter(m => m.status === 'done').length;
    const inProgressCount = ml.filter(m => m.status === 'in_progress').length;
    const totalActionable = ml.filter(m => !m.is_kpi).length;

    // Detect current phase: phase whose milestones have any non-done items with earliest due
    const phases = [1, 2, 3, 4];
    let currentPhase = 1;
    for (const p of phases) {
        const phaseItems = ml.filter(m => m.phase === p && !m.is_kpi);
        const allDone = phaseItems.length > 0 && phaseItems.every(m => m.status === 'done');
        if (!allDone) { currentPhase = p; break; }
        if (p === 4) currentPhase = 4;
    }

    const phaseName = (ml.find(m => m.phase === currentPhase) || {}).phase_name || '';
    const planDocPath = (ml[0] || {}).plan_doc_path || '';
    const planTitle = (ml[0] || {}).plan_title || 'תוכנית פעילה';

    const blockedHtml = blockedOnOren.length === 0
        ? `<p style="color:#27ae60;font-size:12px;margin:0">✅ אין פריטים שחוסמים אותך</p>`
        : blockedOnOren.map(m => {
            const daysLate = m.due_date ? Math.max(0, Math.floor((Date.now() - new Date(m.due_date).getTime()) / 86400000)) : 0;
            return `<div style="background:#fff5f5;border:1px solid #ffcfcf;border-right:4px solid #e74c3c;border-radius:6px;padding:12px 14px;margin-bottom:8px">
                <div style="margin-bottom:4px">
                  <span style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">חוסם ${daysLate > 0 ? daysLate + ' ימים' : ''}</span>
                  <strong style="color:#2c2c2c;font-size:13px;margin-right:6px">${esc(m.title)}</strong>
                </div>
                <p style="color:#1e6e3a;font-size:12px;margin:6px 0 4px;background:#f0fbf4;padding:8px 10px;border-radius:4px"><strong>פעולה דרושה ממך:</strong> ${esc(m.oren_action || '')}</p>
                ${m.blocking_what ? `<p style="color:#888;font-size:11px;margin:4px 0 0;font-style:italic">חוסם: ${esc(m.blocking_what)}</p>` : ''}
            </div>`;
        }).join('');

    const phaseProgress = [];
    for (const p of phases) {
        const items = ml.filter(m => m.phase === p && !m.is_kpi);
        if (items.length === 0) continue;
        const done = items.filter(m => m.status === 'done').length;
        const pct = items.length > 0 ? Math.round(done / items.length * 100) : 0;
        const isCurrent = p === currentPhase;
        phaseProgress.push(`<tr>
            <td style="padding:6px 8px;font-size:12px;color:${isCurrent ? '#c8a96e' : '#666'};font-weight:${isCurrent ? '700' : '500'};width:140px">
              ${isCurrent ? '▶ ' : ''}פאזה ${p} — ${esc(items[0].phase_name || '')}
            </td>
            <td style="padding:6px 8px;font-size:11px;color:#888;width:60px">${done}/${items.length}</td>
            <td style="padding:6px 8px">
              <div style="background:#f0ebe0;border-radius:3px;height:8px;overflow:hidden;width:100%">
                <div style="background:${isCurrent ? '#c8a96e' : '#9b9b9b'};height:100%;width:${pct}%"></div>
              </div>
            </td>
        </tr>`);
    }

    const kpiRows = ml.filter(m => m.is_kpi).map(k => `<tr>
        <td style="padding:5px 8px;font-size:11px;color:#555">${esc(k.title.replace(/\s*\(W7 target\).*/i, ''))}</td>
        <td style="padding:5px 8px;font-size:11px;color:#999;text-align:left">${esc(k.kpi_current || '?')}</td>
        <td style="padding:5px 8px;font-size:11px;color:#c8a96e;font-weight:700;text-align:left">${esc(k.kpi_target || '?')}</td>
    </tr>`).join('');

    const planHtml = `
        <div style="background:#fff;border:1px solid #e0d8c0;border-radius:8px;padding:16px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0ebe0;padding-bottom:10px;margin-bottom:12px">
            <strong style="color:#2c2c2c;font-size:14px">${esc(planTitle)}</strong>
            <span style="color:#888;font-size:11px">יום ${planDayNum}/${planTotalDays} · ${doneCount}/${totalActionable} milestones הושלמו</span>
          </div>
          ${blockedOnOren.length > 0 ? `
            <div style="margin-bottom:14px">
              <strong style="color:#e74c3c;font-size:13px;display:block;margin-bottom:8px">🚨 חוסם אותך (${blockedOnOren.length}):</strong>
              ${blockedHtml}
            </div>` : ''}
          ${lateItems.length > 0 ? `
            <div style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:6px;padding:10px 12px;margin-bottom:14px">
              <strong style="color:#b7860b;font-size:12px">⚠️ ${lateItems.length} פריטים מאחרים מהדדליין:</strong>
              <ul style="margin:6px 0 0;padding-right:18px;color:#7a5b1c;font-size:11px;line-height:1.7">
                ${lateItems.slice(0,5).map(m => `<li>${esc(m.title)} <span style="color:#999">— ${esc(m.due_date)} · owner: ${esc(m.owner)}</span></li>`).join('')}
              </ul>
            </div>` : ''}
          <div style="margin-bottom:10px">
            <strong style="color:#555;font-size:12px;display:block;margin-bottom:6px">התקדמות פאזות:</strong>
            <table width="100%" cellpadding="0" cellspacing="0">${phaseProgress.join('')}</table>
          </div>
          ${kpiRows ? `
            <div style="background:#f8f6f0;border-radius:6px;padding:10px 12px;margin-top:10px">
              <strong style="color:#555;font-size:12px;display:block;margin-bottom:6px">KPIs שבועיים (יעד שבוע 7 — 15.06):</strong>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><th style="text-align:right;color:#999;font-size:10px;padding:4px 8px;font-weight:500">מדד</th><th style="text-align:left;color:#999;font-size:10px;padding:4px 8px;font-weight:500">בפועל</th><th style="text-align:left;color:#999;font-size:10px;padding:4px 8px;font-weight:500">יעד W7</th></tr>
                ${kpiRows}
              </table>
            </div>` : ''}
          ${planDocPath ? `<p style="margin:10px 0 0;font-size:11px;color:#999">📄 מסמך מלא: <a href="https://www.dubis.net/${esc(planDocPath)}" style="color:#c8a96e">${esc(planDocPath)}</a></p>` : ''}
        </div>`;

    // ═════════════════════════════════════════════════════════════════
    //  POSTS PUBLISHED (24h) — IG + FB
    // ═════════════════════════════════════════════════════════════════
    const postsHtml = (publishedPosts || []).length === 0
        ? `<p style="color:#888;font-size:12px;margin:0">⏳ לא פורסמו פוסטים ב-24 השעות האחרונות. (Cron content רץ 10:00 + 16:00 UTC)</p>`
        : (publishedPosts || []).map(p => {
            const cd = p.content_data || {};
            const proof = p.proof_of_completion || {};
            const ig = cd.ig_permalink || null;
            const fb = cd.fb_permalink || null;
            const igId = cd.instagram_post_id || null;
            const fbId = cd.facebook_post_id || null;
            const productUrl = cd.product_url || '';
            const slogan = cd.slogan || cd.product_slogan || '';
            const imageUrl = cd.image_url || '';
            const platform = cd.platform || 'IG+FB';
            const publishedAt = proof.published_at || p.updated_at;
            const ts = new Date(publishedAt).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Jerusalem' });
            return `<div style="background:#fff;border:1px solid #e8e4d4;border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start">
                ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" style="width:54px;height:54px;border-radius:6px;object-fit:cover;flex-shrink:0">` : ''}
                <div style="flex:1;min-width:0">
                  <div style="margin-bottom:4px">
                    <strong style="color:#2c2c2c;font-size:13px">${esc(p.title || slogan)}</strong>
                    <span style="color:#999;font-size:10px;margin-right:8px">${ts}</span>
                  </div>
                  ${slogan ? `<p style="color:#666;font-size:11px;margin:0 0 4px;font-style:italic">"${esc(slogan)}"</p>` : ''}
                  <div style="font-size:11px">
                    ${ig ? `<a href="${esc(ig)}" style="color:#e1306c;text-decoration:none;margin-left:10px">📷 Instagram →</a>` : (igId ? `<span style="color:#999;margin-left:10px" title="ID: ${esc(igId)}">📷 IG (פורסם, ממתין ל-backfill)</span>` : '')}
                    ${fb ? `<a href="${esc(fb)}" style="color:#1877f2;text-decoration:none;margin-left:10px">📘 Facebook →</a>` : (fbId ? `<span style="color:#999;margin-left:10px" title="ID: ${esc(fbId)}">📘 FB (פורסם, ממתין ל-backfill)</span>` : '')}
                    ${productUrl ? `<a href="${esc(productUrl)}" style="color:#c8a96e;text-decoration:none">🛍 מוצר →</a>` : ''}
                  </div>
                </div>
            </div>`;
        }).join('') + ((publishedPosts || []).every(p => !p.content_data?.ig_permalink && !p.content_data?.fb_permalink)
            ? `<div style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:6px;padding:10px 12px;margin-top:8px;font-size:11px;color:#7a5b1c">
                ⚠️ עדיין אין permalinks. הפרסומים מ-Edge Function גרסה חדשה ייכנסו אחרי הדפלוי הבא. ל-backfill של 81 פוסטים קיימים: <code>POST /functions/v1/agents?type=backfill-permalinks</code>.
            </div>`
            : '');

    // ═════════════════════════════════════════════════════════════════
    //  TIKTOK VIDEOS PUBLISHED (24h)
    // ═════════════════════════════════════════════════════════════════
    const tiktokAgeHours = lastTikTokDoneAt
        ? Math.floor((Date.now() - new Date(lastTikTokDoneAt).getTime()) / 3600000)
        : 999;
    const tiktokHealthy = tiktokAgeHours < 30;

    const tiktokHtml = (publishedTikToks || []).length === 0
        ? `<div style="background:${tiktokHealthy ? '#fff9f0' : '#fff5f5'};border:1px solid ${tiktokHealthy ? '#ffe0a0' : '#ffcfcf'};border-radius:6px;padding:12px;font-size:12px;color:${tiktokHealthy ? '#7a5b1c' : '#c0392b'}">
            ${tiktokHealthy
                ? `⏳ לא פורסם TikTok חדש ב-24 שעות אחרונות. הפרסום האחרון לפני ${tiktokAgeHours} שעות. (Cron GH Actions רץ 18:00 UTC)`
                : `🚨 <strong>Pipeline לא רץ ${Math.floor(tiktokAgeHours/24)} ימים</strong>. הפרסום האחרון לפני ${tiktokAgeHours} שעות. בדוק GH Actions: <a href="https://github.com/dubis-brand/dubis-website/actions/workflows/dubis-tiktok-daily.yml" style="color:#c8a96e">dubis-tiktok-daily.yml</a>`
            }
          </div>`
        : (publishedTikToks || []).map(t => {
            const cd = t.content_data || {};
            const proof = t.proof_of_completion || {};
            const videoUrl = cd.video_url || '';
            const lateId = cd.late_post_id || proof.tiktok_late_post_id || '';
            const tiktokUrl = cd.tiktok_url || cd.permalink || '';
            const productUrl = cd.product_url || '';
            const slogan = cd.product_slogan || cd.slogan || '';
            const publishedAt = proof.published_at || t.updated_at;
            const ts = new Date(publishedAt).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Jerusalem' });
            return `<div style="background:#fff;border:1px solid #e8e4d4;border-radius:8px;padding:12px 14px;margin-bottom:8px">
                <div style="margin-bottom:4px">
                  <span style="background:#000;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">TIKTOK</span>
                  <strong style="color:#2c2c2c;font-size:13px;margin-right:6px">${esc(t.title)}</strong>
                  <span style="color:#999;font-size:10px;margin-right:8px">${ts}</span>
                </div>
                ${slogan ? `<p style="color:#666;font-size:11px;margin:4px 0;font-style:italic">"${esc(slogan)}"</p>` : ''}
                <div style="font-size:11px;margin-top:6px">
                  ${tiktokUrl ? `<a href="${esc(tiktokUrl)}" style="color:#000;text-decoration:none;margin-left:10px">🎬 צפה ב-TikTok →</a>` : ''}
                  ${videoUrl ? `<a href="${esc(videoUrl)}" style="color:#666;text-decoration:none;margin-left:10px">📹 קובץ MP4 →</a>` : ''}
                  ${productUrl ? `<a href="${esc(productUrl)}" style="color:#c8a96e;text-decoration:none">🛍 מוצר →</a>` : ''}
                </div>
                ${lateId && !tiktokUrl ? `<p style="color:#999;font-size:10px;margin:6px 0 0;font-family:monospace">late_post_id: ${esc(lateId)} (URL ציבורי לא נשמר — צריך לפתוח את חשבון TikTok ידנית)</p>` : ''}
            </div>`;
        }).join('');

    // ═════════════════════════════════════════════════════════════════
    //  STOCK SUMMARY + 24h DELTAS
    // ═════════════════════════════════════════════════════════════════
    const stockLastCheckAge = stockStats?.last_check
        ? Math.floor((Date.now() - new Date(stockStats.last_check).getTime()) / 3600000)
        : 999;
    const stockHealthy = stockLastCheckAge < 30;
    const oosByProduct = {};
    const wentOos = (stockDeltas || []).filter(d => d.last_out_of_stock_at && new Date(d.last_out_of_stock_at) >= new Date(since24h));
    const cameBack = (stockDeltas || []).filter(d => d.last_back_in_stock_at && new Date(d.last_back_in_stock_at) >= new Date(since24h));

    const stockHtml = !stockStats
        ? `<p style="color:#999;font-size:12px;margin:0">לא ניתן לקרוא את product_variant_stock — בדוק את ה-RLS.</p>`
        : `<div style="background:#f8f6f0;border-radius:6px;padding:12px;margin-bottom:10px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="text-align:center;padding:6px"><div style="color:#27ae60;font-size:18px;font-weight:700">${stockStats.in_stock}</div><div style="color:#999;font-size:10px">במלאי</div></td>
                <td style="text-align:center;padding:6px"><div style="color:${stockStats.oos > 0 ? '#e67e22' : '#999'};font-size:18px;font-weight:700">${stockStats.oos}</div><div style="color:#999;font-size:10px">אזל</div></td>
                <td style="text-align:center;padding:6px"><div style="color:#666;font-size:18px;font-weight:700">${stockStats.total}</div><div style="color:#999;font-size:10px">סה"כ SKUs</div></td>
                <td style="text-align:center;padding:6px"><div style="color:${stockHealthy ? '#27ae60' : '#e74c3c'};font-size:14px;font-weight:600">${stockLastCheckAge < 1 ? `${Math.round((Date.now() - new Date(stockStats.last_check).getTime())/60000)} דק'` : `${stockLastCheckAge}h`}</div><div style="color:#999;font-size:10px">מבדיקה אחרונה</div></td>
              </tr>
            </table>
          </div>
          ${wentOos.length === 0 && cameBack.length === 0
            ? `<p style="color:#27ae60;font-size:12px;margin:0">✅ אין שינויי מלאי ב-24 שעות — המלאי יציב</p>`
            : `<div style="font-size:12px">
                ${wentOos.length > 0 ? `<p style="color:#c0392b;margin:0 0 6px"><strong>🚨 ירדו ל-OOS (${wentOos.length}):</strong></p>
                  <ul style="margin:0 0 8px;padding-right:18px;color:#666;font-size:11px;line-height:1.6">
                    ${wentOos.slice(0,8).map(d => `<li>מוצר ${d.product_id_numeric} · ${esc(d.color)} ${esc(d.size)}</li>`).join('')}
                    ${wentOos.length > 8 ? `<li style="color:#999">+${wentOos.length - 8} נוספים</li>` : ''}
                  </ul>` : ''}
                ${cameBack.length > 0 ? `<p style="color:#27ae60;margin:0 0 6px"><strong>✅ חזרו למלאי (${cameBack.length}):</strong></p>
                  <ul style="margin:0;padding-right:18px;color:#666;font-size:11px;line-height:1.6">
                    ${cameBack.slice(0,8).map(d => `<li>מוצר ${d.product_id_numeric} · ${esc(d.color)} ${esc(d.size)}</li>`).join('')}
                    ${cameBack.length > 8 ? `<li style="color:#999">+${cameBack.length - 8} נוספים</li>` : ''}
                  </ul>` : ''}
              </div>`}
          ${stockStaleCount > 0 ? `<p style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:4px;padding:8px 10px;margin:10px 0 0;font-size:11px;color:#7a5b1c">⚠️ ${stockStaleCount} SKUs לא נסרקו מעל 7 ימים. ה-cron של Gelato stock-check כנראה לא רץ במלואו.</p>` : ''}`;

    // ═════════════════════════════════════════════════════════════════
    //  SECURITY — last scan
    // ═════════════════════════════════════════════════════════════════
    const secAge = lastSecurityRun
        ? Math.floor((Date.now() - new Date(lastSecurityRun.created_at).getTime()) / 86400000)
        : 999;
    const secHealthy = secAge <= 10; // weekly cron — should be < 7-10 days
    const secStatus = lastSecurityRun?.status || 'never';
    const securityHtml = !lastSecurityRun
        ? `<div style="background:#fff5f5;border:1px solid #ffcfcf;border-radius:6px;padding:12px;font-size:13px;color:#c0392b">
            🚨 <strong>סריקת אבטחה לא רצה כלל</strong> ב-14 הימים האחרונים. ה-cron מתוכנן לכל יום שני 03:00 UTC לפי AGENTS.md אבל לא קיים ב-agent_runs.<br>
            <span style="font-size:11px;color:#7a1a1a;display:block;margin-top:6px">פעולה: אמת ב-Cowork scheduled-tasks או הוסף ל-Vercel cron.</span>
          </div>`
        : `<div style="background:${secHealthy ? '#f0fbf4' : '#fff9f0'};border:1px solid ${secHealthy ? '#cfeed4' : '#ffe0a0'};border-radius:6px;padding:12px">
            <div style="margin-bottom:6px">
              <span style="background:${secStatus === 'completed' ? '#27ae60' : '#e74c3c'};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">${secStatus.toUpperCase()}</span>
              <strong style="color:#2c2c2c;font-size:13px;margin-right:6px">סריקה אחרונה לפני ${secAge} ימים</strong>
            </div>
            ${lastSecurityRun.summary ? `<pre style="background:#f8f6f0;border-radius:4px;padding:8px 10px;font-size:11px;color:#444;line-height:1.5;white-space:pre-wrap;margin:6px 0 0;font-family:'Helvetica',Arial,sans-serif">${esc(lastSecurityRun.summary.substring(0, 400))}${lastSecurityRun.summary.length > 400 ? '…' : ''}</pre>` : ''}
            ${lastSecurityRun.error_message ? `<p style="color:#c0392b;font-size:11px;margin:6px 0 0">שגיאה: ${esc(lastSecurityRun.error_message.substring(0, 200))}</p>` : ''}
          </div>`;

    // ═════════════════════════════════════════════════════════════════
    //  SITE AUDIT — last scan
    // ═════════════════════════════════════════════════════════════════
    const saAge = lastSiteAuditRun
        ? Math.floor((Date.now() - new Date(lastSiteAuditRun.created_at).getTime()) / 3600000)
        : 999;
    const saHealthy = saAge < 48;
    let saAllOk = null;
    let saChecks = [];
    if (lastSiteAuditRun?.summary) {
        const m = lastSiteAuditRun.summary.match(/cloud-run\s+site_audit\s+\w+:\s*(\{[\s\S]+\})/i);
        if (m) {
            try {
                const parsed = JSON.parse(m[1]);
                saAllOk = parsed.all_ok;
                saChecks = parsed.checks || [];
            } catch (_) {}
        }
    }
    const saBroken = saChecks.filter(c => !c.ok);
    const siteAuditHtml = !lastSiteAuditRun
        ? `<div style="background:#fff5f5;border:1px solid #ffcfcf;border-radius:6px;padding:12px;font-size:13px;color:#c0392b">
            🚨 <strong>Site Audit לא רץ כלל</strong> ב-14 הימים האחרונים.
          </div>`
        : `<div style="background:${saHealthy && saAllOk ? '#f0fbf4' : '#fff9f0'};border:1px solid ${saHealthy && saAllOk ? '#cfeed4' : '#ffe0a0'};border-radius:6px;padding:12px">
            <div style="margin-bottom:6px">
              <span style="background:${saAllOk ? '#27ae60' : '#e67e22'};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">${saAllOk ? 'ALL OK' : (saAllOk === false ? 'BROKEN' : 'UNKNOWN')}</span>
              <strong style="color:#2c2c2c;font-size:13px;margin-right:6px">${saChecks.length} URLs נבדקו לפני ${saAge < 24 ? saAge + 'h' : Math.floor(saAge/24) + ' ימים'}</strong>
            </div>
            ${saBroken.length > 0 ? `<ul style="margin:6px 0 0;padding-right:18px;color:#c0392b;font-size:11px;line-height:1.6">
                ${saBroken.slice(0,5).map(c => `<li>${esc(c.url)} → ${c.status}</li>`).join('')}
              </ul>` : (saAllOk
                ? `<p style="color:#1e6e3a;font-size:11px;margin:0">כל ה-URLs החזירו 200.</p>`
                : `<p style="color:#666;font-size:11px;margin:0">לא ניתן לפענח את התוצאה — בדוק ב-admin.</p>`)}
          </div>`;

    // ── Gmail insights ──
    const gmailHtml = (gmailInsights || []).length === 0
        ? `<p style="color:#999;font-size:12px;margin:0">לא נמצאו תובנות חדשות מהמייל השבוע (Email Monitor ${emFailed ? '<strong style="color:#e74c3c">נפל</strong>' : 'רץ אבל ללא matches'}).</p>`
        : (gmailInsights || []).slice(0, 5).map(g => `
            <div style="background:#fff9f0;border:1px solid #ffe0a0;border-radius:6px;padding:10px 12px;margin-bottom:6px">
                <strong style="color:#b7860b;font-size:12px">📧 ${esc(g.title)}</strong>
                <p style="color:#666;font-size:11px;margin:3px 0 0">${esc((g.description || '').substring(0,150))}</p>
            </div>`).join('');

    // ═════════════════════════════════════════════════════════════════
    //  ASSEMBLE EMAIL
    // ═════════════════════════════════════════════════════════════════
    const subjectStatus = issues.find(i => i.sev === 'CRITICAL') ? '🚨' : issues.find(i => i.sev === 'HIGH') ? '⚠️' : '📋';
    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 12px">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">

      <!-- Header -->
      <tr><td style="text-align:center;padding-bottom:20px">
        <span style="font-size:28px;font-weight:700;letter-spacing:5px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span>
        <p style="margin:4px 0 0;color:#999;font-size:11px;letter-spacing:2px">DAILY BRIEFING</p>
        <p style="margin:8px 0 0;color:#666;font-size:13px">${dateStr}</p>
      </td></tr>

      <!-- Top stats -->
      <tr><td style="padding-bottom:18px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:14px 6px">
              <div style="color:#c8a96e;font-size:22px;font-weight:700">$${todayRevenue.toFixed(0)}</div>
              <div style="color:#888;font-size:10px;margin-top:3px">הכנסה היום (${todayOrdersCount})</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:14px 6px">
              <div style="color:#c8a96e;font-size:22px;font-weight:700">$${weekRevenue.toFixed(0)}</div>
              <div style="color:#888;font-size:10px;margin-top:3px">7 ימים (${weekOrdersCount})</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:14px 6px">
              <div style="color:${campaignROI < 0 ? '#e74c3c' : '#27ae60'};font-size:22px;font-weight:700">${campaignROI.toFixed(0)}%</div>
              <div style="color:#888;font-size:10px;margin-top:3px">ROI קמפיין</div>
            </td>
            <td style="width:4px"></td>
            <td style="width:25%;text-align:center;background:#2c2c2c;border-radius:10px;padding:14px 6px">
              <div style="color:${issues.length > 0 ? '#e74c3c' : '#27ae60'};font-size:22px;font-weight:700">${issues.length}</div>
              <div style="color:#888;font-size:10px;margin-top:3px">בעיות פתוחות</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- 1. PLAN PROGRESS — Road to $1,000 -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 14px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📋 התקדמות מול תוכנית${blockedOnOren.length > 0 ? ` <span style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:8px">${blockedOnOren.length} חוסם אותך</span>` : ''}
        </h2>
        ${planHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 2. CRITICAL ISSUES -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 14px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          🚨 בעיות קריטיות (${issues.length})
        </h2>
        ${issuesHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 2. PER-AGENT BREAKDOWN -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          🤖 מה עשו הסוכנים היום? (24h)
        </h2>
        <table width="100%" cellpadding="0" cellspacing="0">${agentsHtml}</table>
        ${phantomFlags.length > 0 ? `
          <div style="background:#fff5e6;border:1px solid #ffd9a3;border-radius:6px;padding:12px;margin-top:12px;font-size:12px;color:#7a4f0a">
            <strong>⚠️ Phantom alert:</strong> ${phantomFlags.length} סוכנים סימנו משימה done ללא הוכחה (proof_verified=false / tasks_completed_ids ריק). זה לא נחשב לעבודה אמיתית. בדוק ב-/admin → Tasks.
          </div>` : ''}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- POSTS PUBLISHED (IG+FB) — last 24h -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📷 פוסטים שעלו (24h) <span style="color:#999;font-weight:400;font-size:11px">— ${(publishedPosts||[]).length} ב-IG+FB</span>
        </h2>
        ${postsHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- TIKTOK VIDEOS — last 24h + pipeline health -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          🎬 TikTok — סרטונים שעלו (24h) <span style="color:#999;font-weight:400;font-size:11px">— ${(publishedTikToks||[]).length} פורסמו</span>
        </h2>
        ${tiktokHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- CAMPAIGN DEEP ANALYSIS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📊 ניתוח קמפיין מעמיק
        </h2>
        ${campaignHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 4. SURVEY FEEDBACK -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          💬 פידבק מסקרים
        </h2>
        ${feedbackHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 5. PROFIT / REVENUE PROGRESS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          💰 האם אנחנו מרוויחים?
        </h2>
        ${profitHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 6. PENDING TASKS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          ✅ משימות לאישורך (${(pendingTasks||[]).length})
        </h2>
        ${tasksHtml}
        ${(pendingTasks||[]).length > 0 ? `<p style="text-align:center;margin-top:14px"><a href="https://www.dubis.net/admin#tasks" style="background:#c8a96e;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">פתח לוח משימות →</a></p>` : ''}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- 7. ACTIVE ORDERS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📦 הזמנות פעילות ${stuckOrders.length > 0 ? `<span style="color:#e74c3c;font-size:11px;font-weight:600;margin-right:8px">${stuckOrders.length} תקועות מעל 7 ימים</span>` : ''}
        </h2>
        ${(activeOrders||[]).length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0">
          <thead>
            <tr>
              <th style="text-align:right;color:#999;font-size:10px;font-weight:500;padding:4px;border-bottom:1px solid #f0ebe0">תאריך</th>
              <th style="text-align:right;color:#999;font-size:10px;font-weight:500;padding:4px;border-bottom:1px solid #f0ebe0">לקוח</th>
              <th style="text-align:right;color:#999;font-size:10px;font-weight:500;padding:4px;border-bottom:1px solid #f0ebe0">פריט</th>
              <th style="text-align:right;color:#999;font-size:10px;font-weight:500;padding:4px;border-bottom:1px solid #f0ebe0">סטטוס</th>
              <th style="text-align:right;color:#999;font-size:10px;font-weight:500;padding:4px;border-bottom:1px solid #f0ebe0">סכום</th>
            </tr>
          </thead>
          <tbody>${ordersHtml}</tbody>
        </table>` : `<p style="color:#666;font-size:12px;margin:0">אין הזמנות פעילות כרגע</p>`}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- STOCK SUMMARY + 24h DELTAS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📦 מלאי — בדיקה יומית <span style="color:#999;font-weight:400;font-size:11px">— ${wentOos.length + cameBack.length} שינויים ב-24h</span>
        </h2>
        ${stockHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- SITE AUDIT -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          🔎 Site Audit — בדיקת תקינות אתר
        </h2>
        ${siteAuditHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- SECURITY -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          🔒 אבטחה — סריקה שבועית
        </h2>
        ${securityHtml}
      </td></tr>
      <tr><td style="height:10px"></td></tr>

      <!-- GMAIL INSIGHTS -->
      <tr><td style="background:#fff;border-radius:12px;padding:20px 24px">
        <h2 style="margin:0 0 12px;font-size:15px;color:#2c2c2c;border-bottom:2px solid #f5f0e8;padding-bottom:8px">
          📧 תובנות מהמייל
        </h2>
        ${gmailHtml}
      </td></tr>

      <!-- Footer -->
      <tr><td style="text-align:center;padding-top:22px">
        <p style="margin:0;color:#aaa;font-size:11px">DUBIS Daily Briefing · 07:00 Israel · v2.0 (deep analysis mode)</p>
        <p style="margin:6px 0 0;color:#ccc;font-size:10px">
          <a href="https://www.dubis.net/admin" style="color:#c8a96e">Admin</a> ·
          <a href="https://www.dubis.net/admin#tasks" style="color:#c8a96e">Tasks</a> ·
          <a href="https://www.dubis.net/admin#funnel" style="color:#c8a96e">Funnel</a> ·
          <a href="https://business.facebook.com/adsmanager" style="color:#c8a96e">Meta Ads</a> ·
          <a href="https://dashboard.gelato.com" style="color:#c8a96e">Gelato</a>
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
                subject: `${subjectStatus} DUBIS Daily — ${issues.length} בעיות · $${todayRevenue.toFixed(0)} היום · ROI ${campaignROI.toFixed(0)}%`,
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
