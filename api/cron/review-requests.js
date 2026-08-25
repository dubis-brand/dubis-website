// DUBIS — Delivery Thank-You + Review Request Cron
// Vercel Cron: every day at 08:00 UTC (10:00-11:00 Israel), after gelato-sync (00:00 UTC)
// marks orders as delivered.
//
// As soon as an order flips to 'delivered', the customer gets a "glad it arrived,
// tell us what you think" email in the language of the DESTINATION country
// (IL → Hebrew, everywhere else → English), with a visible link to each product
// they bought (dubis.net/?p={id}). One email per order, guarded by
// orders.review_request_sent_at. Every run logs to agent_runs (agent_id
// 'review-requests') so the daily Boss report shows the check ran.
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SENDER_EMAIL = 'DUBIS <dubis.brand@dubis.net>';
const BRAND_INBOX = 'dubis.brand@gmail.com'; // BCC record + reply-to (email-monitor scans it)

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth: Vercel cron header or CRON_SECRET
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const hasCronSecret = process.env.CRON_SECRET &&
        req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
    if (!isVercelCron && !hasCronSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }
    if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: 'Resend not configured' });
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const startedAt = Date.now();

    // Newly delivered orders that haven't been thanked yet.
    // 30-day ceiling so a first run after downtime never mails ancient orders.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: eligibleOrders, error: queryErr } = await supabase
        .from('orders')
        .select('id, buyer_email, items, total_amount, shipping_address, shipped_at, updated_at, paypal_order_id, is_test, refund_id')
        .eq('status', 'delivered')
        .is('review_request_sent_at', null)
        .is('refund_id', null)
        .gte('updated_at', thirtyDaysAgo.toISOString())
        .not('buyer_email', 'is', null);

    if (queryErr) {
        console.error('Delivery thank-you query error:', queryErr.message);
        await logRun(supabase, 'failed', `query error: ${queryErr.message}`, startedAt);
        return res.status(500).json({ error: queryErr.message });
    }

    const orders = (eligibleOrders || []).filter(o => o.buyer_email && o.buyer_email.includes('@') && !o.is_test);

    if (orders.length === 0) {
        console.log('No newly delivered orders to thank');
        await logRun(supabase, 'completed', 'delivery check ran: 0 newly delivered orders', startedAt);
        return res.status(200).json({ success: true, sent: 0, message: 'No eligible orders' });
    }

    // HTML escape helper
    const esc = s => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // First name from the shipping name (strip bidi control chars), fallback to email prefix
    const firstNameOf = (order) => {
        const raw = ((order.shipping_address || {}).name || '')
            .replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
        const word = raw.split(/\s+/)[0] || (order.buyer_email || '').split('@')[0] || '';
        return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
    };

    const countryOf = (order) => {
        const addr = order.shipping_address || {};
        return String(addr.country_code || addr.country || '').toUpperCase();
    };

    let sent = 0, sentHe = 0, sentEn = 0, errors = 0;

    for (const order of orders) {
        try {
            const items = order.items || [];
            const isHebrew = countryOf(order) === 'IL';
            const firstName = firstNameOf(order);
            const shortOrderId = (order.paypal_order_id || order.id).toString().substring(0, 8).toUpperCase();
            const reviewLink = `https://www.dubis.net/returns?review=true&order=${encodeURIComponent(shortOrderId)}`;

            // Each purchased item, with a visible link to the exact product page
            const itemsList = items.map(item => {
                const label = esc((item.phrase || item.typeLabel || 'DUBIS Item').substring(0, 60));
                const type = esc(item.typeLabel || item.type || '');
                const productUrl = item.id ? `https://www.dubis.net/?p=${item.id}` : 'https://www.dubis.net';
                const linkText = isHebrew ? 'למוצר באתר' : 'View the product';
                return `<li style="margin:8px 0;color:#e8e0d5;">${label}${type ? ` · ${type}` : ''}
                    <br><a href="${productUrl}" style="color:#c8a96e;text-decoration:none;font-size:13px;">${linkText}: ${productUrl}</a></li>`;
            }).join('');

            const t = isHebrew ? {
                dir: 'rtl', lang: 'he',
                subject: 'ההזמנה שלך הגיעה! נשמח לשמוע מה דעתך',
                tagline: 'ההזמנה הגיעה. שמחים שהיא אצלך',
                hi: `היי ${esc(firstName)},`,
                body1: `ההזמנה שלך (${esc(shortOrderId)}) הגיעה, ואנחנו שמחים שהיא כבר אצלך.`,
                body2: 'נשמח לשמוע מה דעתך. זה לוקח דקה, עוזר לאחרים לבחור ועוזר לנו להשתפר.',
                cta: 'ספרו לנו מה דעתכם',
                after: 'אפשר גם פשוט להשיב למייל הזה, אנחנו קוראים הכל.',
                listPad: 'padding:0 20px 0 0;',
            } : {
                dir: 'ltr', lang: 'en',
                subject: 'Your DUBIS order arrived. How did we do?',
                tagline: 'Your order is home. We are glad.',
                hi: `Hi ${esc(firstName)},`,
                body1: `Your order (${esc(shortOrderId)}) just arrived, and we are glad it is with you.`,
                body2: 'We would love to hear what you think. It takes a minute, helps others choose, and helps us get better.',
                cta: 'Leave a review',
                after: 'You can also just reply to this email. We read everything.',
                listPad: 'padding:0 0 0 20px;',
            };

            const html = `
<!DOCTYPE html>
<html dir="${t.dir}" lang="${t.lang}">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" dir="${t.dir}" style="background:#1a1a1a;border:1px solid #2e2e2e;border-radius:8px;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e1a12,#1a1a1a);padding:32px;text-align:center;border-bottom:1px solid #2e2e2e;">
          <div style="font-size:28px;font-weight:bold;color:#c8a96e;letter-spacing:2px;">DUBIS</div>
          <div style="font-size:13px;color:#9a9080;margin-top:4px;">${t.tagline}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="font-size:16px;color:#e8e0d5;margin:0 0 16px;">${t.hi}</p>

          <p style="font-size:14px;color:#9a9080;margin:0 0 16px;line-height:1.7;">
            ${t.body1}
            <br>${t.body2}
          </p>

          ${itemsList ? `<ul style="${t.listPad}margin:0 0 24px;">${itemsList}</ul>` : ''}

          <div style="text-align:center;margin:32px 0;">
            <a href="${reviewLink}"
               style="display:inline-block;background:#c8a96e;color:#0f0f0f;padding:14px 36px;
                      border-radius:4px;font-size:15px;font-weight:bold;text-decoration:none;
                      letter-spacing:0.5px;">
              ${t.cta}
            </a>
          </div>

          <p style="font-size:13px;color:#9a9080;margin:0;line-height:1.6;">
            ${t.after}
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 32px;border-top:1px solid #2e2e2e;text-align:center;">
          <p style="font-size:11px;color:#666;margin:0;">
            DUBIS
            <br><span style="font-style:italic;">Built for the body you actually live in.</span>
            <br>
            <a href="https://www.dubis.net" style="color:#c8a96e;text-decoration:none;">dubis.net</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

            // Send via Resend (BCC the brand inbox for the record; replies land there too)
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: SENDER_EMAIL,
                    to: [order.buyer_email],
                    bcc: [BRAND_INBOX],
                    reply_to: BRAND_INBOX,
                    subject: t.subject,
                    html,
                }),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Send failed');

            // Mark as sent
            await supabase
                .from('orders')
                .update({ review_request_sent_at: new Date().toISOString() })
                .eq('id', order.id);

            sent++;
            if (isHebrew) sentHe++; else sentEn++;
            console.log(`Delivery thank-you (${t.lang}) sent to ${order.buyer_email} for order ${shortOrderId} (resend id: ${data.id || 'n/a'})`);
        } catch (err) {
            errors++;
            console.error(`Failed delivery thank-you for order ${order.id}:`, err.message);
        }
    }

    const summary = `delivery thank-you emails: ${sent} sent (${sentHe} HE / ${sentEn} EN), ${errors} errors, ${orders.length} newly delivered`;
    console.log(summary);
    await logRun(supabase, errors > 0 ? 'failed' : 'completed', summary, startedAt, errors > 0 ? `${errors} send failures` : null);

    return res.status(200).json({
        success: true,
        sent,
        sent_he: sentHe,
        sent_en: sentEn,
        errors,
        eligible: orders.length,
    });
};

// Log the run so the daily Boss report sees the check happened (or failed)
async function logRun(supabase, status, summary, startedAt, errorMessage) {
    try {
        await supabase.from('agent_runs').insert({
            agent_id: 'review-requests',
            run_date: new Date().toISOString().slice(0, 10),
            status,
            summary,
            duration_ms: Date.now() - startedAt,
            error_message: errorMessage || null,
        });
    } catch (e) {
        console.error('agent_runs log failed:', e.message);
    }
}
