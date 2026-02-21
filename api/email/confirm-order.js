// DUBIS — Order Confirmation Email
// Vercel Serverless Function  POST /api/email/confirm-order
// Uses Resend (https://resend.com) — free tier: 3,000 emails/month
// ================================================================

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY not set — skipping confirmation email');
        return res.status(200).json({ success: false, reason: 'resend_not_configured' });
    }

    const { buyerEmail, buyerName, orderId, paypalOrderId, items, totalAmount } = req.body;

    if (!buyerEmail || !items) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // ── Build order items HTML ───────────────────────────────────
    const itemsHtml = (items || []).map(item => `
        <tr>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#e8e0d5">
                "${(item.phrase || '').substring(0, 40)}" — ${item.typeLabel || item.type}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#888;text-align:center">
                ${item.selectedSize} / ${item.selectedColor}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#e8e0d5;text-align:right">
                $${Number(item.price).toFixed(2)}
            </td>
        </tr>`).join('');

    const firstName  = (buyerName || buyerEmail || '').split(/[\s@]/)[0] || 'there';
    const displayTotal = Number(totalAmount || 0).toFixed(2);
    const shortOrderId = (orderId || paypalOrderId || '').toString().substring(0, 8).toUpperCase();

    // ── Email HTML ───────────────────────────────────────────────
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your DUBIS Order</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 20px">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

          <!-- Header -->
          <tr>
            <td style="text-align:center;padding-bottom:32px">
              <span style="font-size:28px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">
                DUBIS
              </span>
              <p style="margin:4px 0 0;color:#888;font-size:12px;letter-spacing:2px">FOR THE REST OF US</p>
            </td>
          </tr>

          <!-- Body card -->
          <tr>
            <td style="background:#1a1a1a;border-radius:12px;padding:36px 40px">

              <h1 style="margin:0 0 8px;font-size:22px;color:#e8e0d5;font-weight:600">
                Order confirmed! 🐾
              </h1>
              <p style="margin:0 0 28px;color:#888;font-size:15px">
                Hey ${firstName}, your order is in. We're already getting it made.
              </p>

              <!-- Order meta -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
                <tr>
                  <td style="color:#888;font-size:13px">Order #</td>
                  <td style="color:#c8a96e;font-size:13px;text-align:right;font-weight:600">${shortOrderId}</td>
                </tr>
              </table>

              <!-- Items -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
                <thead>
                  <tr>
                    <th style="text-align:left;color:#555;font-size:11px;font-weight:500;letter-spacing:1px;padding-bottom:8px;text-transform:uppercase">Item</th>
                    <th style="text-align:center;color:#555;font-size:11px;font-weight:500;letter-spacing:1px;padding-bottom:8px;text-transform:uppercase">Details</th>
                    <th style="text-align:right;color:#555;font-size:11px;font-weight:500;letter-spacing:1px;padding-bottom:8px;text-transform:uppercase">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>

              <!-- Total -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
                <tr>
                  <td style="color:#888;font-size:14px">Shipping</td>
                  <td style="color:#888;font-size:14px;text-align:right">Calculated at checkout</td>
                </tr>
                <tr>
                  <td style="color:#e8e0d5;font-size:16px;font-weight:700;padding-top:10px">Total</td>
                  <td style="color:#c8a96e;font-size:16px;font-weight:700;text-align:right;padding-top:10px">$${displayTotal}</td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#888;font-size:14px;line-height:1.6">
                We'll send another email when your order ships with a tracking link.<br>
                Questions? Reply to this email.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="text-align:center;padding-top:28px">
              <p style="margin:0;color:#444;font-size:12px">
                DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e;text-decoration:none">dubis.net</a>
              </p>
              <p style="margin:6px 0 0;color:#333;font-size:11px">
                Real clothes for the body you actually live in.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // ── Send via Resend ──────────────────────────────────────────
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                from:    'DUBIS Orders <orders@dubis.net>',
                to:      [buyerEmail],
                subject: `Your DUBIS order is confirmed (#${shortOrderId})`,
                html,
                reply_to: 'hello@dubis.net',
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Resend error:', JSON.stringify(data));
            return res.status(200).json({ success: false, error: data.message || 'Send failed' });
        }

        console.log(`✅ Confirmation email sent to ${buyerEmail} | Resend ID: ${data.id}`);
        return res.status(200).json({ success: true, emailId: data.id });

    } catch (err) {
        console.error('Email send error:', err.message);
        return res.status(200).json({ success: false, error: err.message });
    }
};
