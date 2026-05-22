// DUBIS — Review Request Cron
// Vercel Cron: every day at 08:00 UTC (10:00 Israel)
// Sends review request emails to customers 7 days after delivery
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

const SENDER_EMAIL = 'DUBIS <dubis.brand@dubis.net>';

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

    // Find delivered orders from ~7 days ago that haven't been sent a review request
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const { data: eligibleOrders, error: queryErr } = await supabase
        .from('orders')
        .select('id, buyer_email, items, total_amount, shipped_at, updated_at, paypal_order_id')
        .eq('status', 'delivered')
        .is('review_request_sent_at', null)
        .lte('updated_at', sevenDaysAgo.toISOString())
        .gte('updated_at', tenDaysAgo.toISOString())
        .not('buyer_email', 'is', null);

    if (queryErr) {
        console.error('Review request query error:', queryErr.message);
        return res.status(500).json({ error: queryErr.message });
    }

    if (!eligibleOrders || eligibleOrders.length === 0) {
        console.log('No eligible orders for review requests');
        return res.status(200).json({ success: true, sent: 0, message: 'No eligible orders' });
    }

    // HTML escape helper
    const esc = s => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let sent = 0;
    let errors = 0;

    for (const order of eligibleOrders) {
        try {
            const items = order.items || [];
            const firstName = (order.buyer_email || '').split('@')[0] || 'there';
            const shortOrderId = (order.paypal_order_id || order.id).toString().substring(0, 8).toUpperCase();

            // Build items list for email
            const itemsList = items.map(item =>
                `<li style="margin:6px 0;color:#e8e0d5;">${esc((item.phrase || item.typeLabel || 'DUBIS Item').substring(0, 50))} — ${esc(item.typeLabel || item.type || '')}</li>`
            ).join('');

            // Review link with order context
            const reviewLink = `https://www.dubis.net/returns?review=true&order=${encodeURIComponent(shortOrderId)}`;

            const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #2e2e2e;border-radius:8px;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e1a12,#1a1a1a);padding:32px;text-align:center;border-bottom:1px solid #2e2e2e;">
          <div style="font-size:28px;font-weight:bold;color:#c8a96e;letter-spacing:2px;">DUBIS</div>
          <div style="font-size:13px;color:#9a9080;margin-top:4px;">איך היה? נשמח לשמוע</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="font-size:16px;color:#e8e0d5;margin:0 0 16px;">היי ${esc(firstName)},</p>

          <p style="font-size:14px;color:#9a9080;margin:0 0 16px;line-height:1.7;">
            ההזמנה שלך (${esc(shortOrderId)}) הגיעה! מקווים שאת/ה אוהב/ת את המוצרים.
            נשמח מאוד אם תשתף/י את הדעה שלך — זה עוזר ללקוחות אחרים לבחור, ולנו להשתפר.
          </p>

          ${itemsList ? `<ul style="padding:0 20px 0 0;margin:0 0 24px;">${itemsList}</ul>` : ''}

          <div style="text-align:center;margin:32px 0;">
            <a href="${reviewLink}"
               style="display:inline-block;background:#c8a96e;color:#0f0f0f;padding:14px 36px;
                      border-radius:4px;font-size:15px;font-weight:bold;text-decoration:none;
                      letter-spacing:0.5px;">
              כתוב ביקורת
            </a>
          </div>

          <p style="font-size:13px;color:#9a9080;margin:0;line-height:1.6;">
            לוקח פחות מדקה. פשוט דרג/י מ-1 עד 5 כוכבים ותוסיף/י כמה מילים.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 32px;border-top:1px solid #2e2e2e;text-align:center;">
          <p style="font-size:11px;color:#666;margin:0;">
            DUBIS — Wear Your Personality
            <br>
            <a href="https://www.dubis.net" style="color:#c8a96e;text-decoration:none;">dubis.net</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

            // Send via Resend
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: SENDER_EMAIL,
                    to: [order.buyer_email],
                    subject: `DUBIS — איך היו המוצרים? נשמח לביקורת שלך`,
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
            console.log(`Review request sent to ${order.buyer_email} for order ${shortOrderId}`);
        } catch (err) {
            errors++;
            console.error(`Failed to send review request for order ${order.id}:`, err.message);
        }
    }

    console.log(`Review requests: ${sent} sent, ${errors} errors, ${eligibleOrders.length} eligible`);
    return res.status(200).json({
        success: true,
        sent,
        errors,
        eligible: eligibleOrders.length,
    });
};
