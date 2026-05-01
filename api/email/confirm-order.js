// DUBIS — Order Confirmation Email
// Vercel Serverless Function  POST /api/email/confirm-order
// Uses Resend (https://resend.com) — free tier: 3,000 emails/month
//
// MODES:
//   1. Order confirmation (default) — fired by paypal.js after capture,
//      builds the order receipt with items / shipping address / totals.
//   2. Admin mail — body { adminMail: true, subject, htmlBody } — sends an
//      arbitrary HTML email to oren ONLY (recipient hardcoded). No auth
//      header required because the recipient is locked, but rate-limited
//      hard so a malicious script can't spam his inbox.
// ================================================================

const rateLimit = require('../_rateLimit');

const ADMIN_MAIL_TO = 'teharlev1976@gmail.com';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY not set — skipping confirmation email');
        return res.status(200).json({ success: false, reason: 'resend_not_configured' });
    }

    // ── Admin mail mode ─────────────────────────────────────────
    // Used by Claude (and other internal tooling) to send oren ad-hoc summary
    // emails through the same Resend pipeline that sends order confirmations.
    if (req.body && req.body.adminMail === true) {
        // Hard rate-limit: 10 admin mails per hour (per IP). Recipient is locked,
        // so the worst a runaway script can do is spam oren 10× before the gate
        // closes — bad enough to notice, not bad enough to flood.
        if (rateLimit(req, res, { max: 10, windowMs: 60 * 60_000 })) return;

        const subj = String(req.body.subject || '(no subject)').slice(0, 200);
        const html = String(req.body.htmlBody || '').slice(0, 200_000);
        const text = String(req.body.textBody || '').slice(0, 50_000);
        if (!html && !text) {
            return res.status(400).json({ error: 'admin_mail_requires_body' });
        }
        try {
            const r = await fetch('https://api.resend.com/emails', {
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    from:    'DUBIS Admin <orders@dubis.net>',
                    to:      [ADMIN_MAIL_TO],
                    subject: subj,
                    html:    html || undefined,
                    text:    text || undefined,
                    reply_to: 'hello@dubis.net',
                }),
            });
            const data = await r.json();
            if (!r.ok) {
                console.error('[ADMIN-MAIL] Resend error:', JSON.stringify(data));
                return res.status(200).json({ success: false, error: data.message || 'send_failed', resendStatus: r.status });
            }
            console.log(`[ADMIN-MAIL] sent → ${ADMIN_MAIL_TO} | subject="${subj}" | resend=${data.id}`);
            return res.status(200).json({ success: true, mode: 'admin', emailId: data.id });
        } catch (err) {
            console.error('[ADMIN-MAIL] exception:', err.message);
            return res.status(200).json({ success: false, error: err.message });
        }
    }

    // Order confirmation rate limit: 5 per IP per minute
    if (rateLimit(req, res, { max: 5, windowMs: 60_000 })) return;

    const {
        buyerEmail, buyerName, orderId, paypalOrderId, items, totalAmount,
        // NEW (2026-05-01): real breakdown + shipping address so customer
        // sees where the order is going and what they paid for what.
        itemsSubtotal, shippingAmount, discountAmount, couponCode, shippingAddress,
    } = req.body;

    // HTML escape helper — prevents XSS in email body
    const esc = s => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    if (!buyerEmail || !items) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // ── Build order items HTML ───────────────────────────────────
    const itemsHtml = (items || []).map(item => `
        <tr>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#e8e0d5">
                "${esc(item.phrase).substring(0, 40)}" — ${esc(item.typeLabel || item.type)}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#888;text-align:center">
                ${esc(item.selectedSize)} / ${esc(item.selectedColor)}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #2a2a2a;color:#e8e0d5;text-align:right">
                $${Number(item.price).toFixed(2)}
            </td>
        </tr>`).join('');

    const firstName  = (buyerName || buyerEmail || '').split(/[\s@]/)[0] || 'there';
    const displayTotal = Number(totalAmount || 0).toFixed(2);
    const shortOrderId = (orderId || paypalOrderId || '').toString().substring(0, 8).toUpperCase();

    // ── Shipping address block ───────────────────────────────────
    // We always show this — it's the #1 thing customers want confirmed
    // ("did they get my address?").
    const a = shippingAddress || {};
    const addrLine1 = esc(a.address_line_1 || '');
    const addrLine2 = esc(a.address_line_2 || '');
    const addrCity  = esc(a.admin_area_2 || '');
    const addrState = esc(a.admin_area_1 || '');
    const addrZip   = esc(a.postal_code || '');
    const addrCtry  = esc(a.country_code || '');
    const addrName  = esc(a.name || buyerName || '');
    const hasAddr   = !!addrLine1;
    const addrHtml  = hasAddr ? `
              <!-- Shipping address -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px">
                <tr>
                  <td style="padding:14px 16px">
                    <div style="color:#555;font-size:11px;font-weight:500;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Shipping to</div>
                    <div style="color:#e8e0d5;font-size:14px;line-height:1.55">
                      ${addrName ? `<strong>${addrName}</strong><br>` : ''}
                      ${addrLine1}${addrLine2 ? `<br>${addrLine2}` : ''}<br>
                      ${addrCity}${addrState ? `, ${addrState}` : ''} ${addrZip}<br>
                      ${addrCtry}
                    </div>
                  </td>
                </tr>
              </table>` : '';

    // ── Money breakdown ──────────────────────────────────────────
    // Real numbers — used to show "Calculated at checkout" which spooked customers.
    const itemsSubNum = Number(itemsSubtotal != null ? itemsSubtotal : (items || []).reduce((s, i) => s + (Number(i.price) || 0), 0));
    const shipNum     = Number(shippingAmount || 0);
    const discNum     = Number(discountAmount || 0);
    const totalNum    = Number(totalAmount != null ? totalAmount : Math.max(0, itemsSubNum + shipNum - discNum));

    const moneyRow = (label, val, opts = {}) => `
                <tr>
                  <td style="color:${opts.bold ? '#e8e0d5' : '#888'};font-size:${opts.bold ? '16px' : '14px'};${opts.bold ? 'font-weight:700;padding-top:10px' : ''}">${esc(label)}</td>
                  <td style="color:${opts.bold ? '#c8a96e' : (opts.discount ? '#7fb069' : '#e8e0d5')};font-size:${opts.bold ? '16px' : '14px'};text-align:right;${opts.bold ? 'font-weight:700;padding-top:10px' : ''}">${opts.discount ? '−' : ''}$${Number(val).toFixed(2)}</td>
                </tr>`;

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

              <!-- Real money breakdown — items + shipping + (optional) discount -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
                ${moneyRow('Subtotal', itemsSubNum)}
                ${discNum > 0 ? moneyRow(`Discount${couponCode ? ' (' + couponCode + ')' : ''}`, discNum, { discount: true }) : ''}
                ${moneyRow(shipNum === 0 ? 'Shipping (FREE)' : 'Shipping', shipNum)}
                ${moneyRow('Total', totalNum, { bold: true })}
              </table>

              ${addrHtml}

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
