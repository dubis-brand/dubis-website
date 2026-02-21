// DUBIS — Printful Webhook Handler
// Vercel Serverless Function  POST /api/webhooks/printful
// =======================================================
// Receives Printful events and syncs order status to Supabase DB.
//
// Setup in Printful:
//   Dashboard → Stores → [your store] → Webhooks
//   → Add webhook URL: https://www.dubis.net/api/webhooks/printful
//   → Enable events: shipment_sent, order_updated, order_failed, order_canceled
//
// Env var required: PRINTFUL_WEBHOOK_SECRET (set in Vercel + Printful webhook settings)
// =======================================================

const { createClient } = require('@supabase/supabase-js');

// Printful status → our DB status mapping
const STATUS_MAP = {
    draft:      'pending',
    pending:    'pending',
    inprocess:  'in_production',
    onhold:     'pending',
    fulfilled:  'shipped',
    archived:   'delivered',
    canceled:   'cancelled',
    failed:     'cancelled',
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Optional secret verification ────────────────────────────
    // Printful sends the secret you configure in webhook settings
    const secret = process.env.PRINTFUL_WEBHOOK_SECRET;
    if (secret) {
        const receivedSecret = req.headers['x-printful-hook-secret']
            || req.body?.secret
            || '';
        if (receivedSecret !== secret) {
            console.warn('Printful webhook: invalid secret');
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const { type, data } = req.body || {};
    if (!type || !data) {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    console.log(`Printful webhook: ${type}`);

    // ── Init Supabase (service role) ─────────────────────────────
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Supabase env vars not set');
        return res.status(200).json({ received: true }); // ACK to Printful
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Extract order info ───────────────────────────────────────
    const order      = data.order || {};
    const shipment   = data.shipment || {};
    const externalId = order.external_id || ''; // "DUBIS-<paypalOrderId>"
    const pfOrderId  = order.id ? String(order.id) : null;
    const pfStatus   = order.status || '';

    // Look up by printful_order_id OR paypal_order_id via external_id
    let lookupField, lookupValue;
    if (pfOrderId) {
        lookupField  = 'printful_order_id';
        lookupValue  = pfOrderId;
    } else if (externalId.startsWith('DUBIS-')) {
        lookupField  = 'paypal_order_id';
        lookupValue  = externalId.replace('DUBIS-', '');
    } else {
        console.warn('No identifiable order in webhook payload', { type, externalId });
        return res.status(200).json({ received: true });
    }

    // ── Handle each event type ───────────────────────────────────
    try {
        switch (type) {

            case 'shipment_sent': {
                const trackingNumber = shipment.tracking_number || null;
                const trackingUrl    = shipment.tracking_url    || null;
                const shippedAt      = shipment.ship_date
                    ? new Date(shipment.ship_date).toISOString()
                    : new Date().toISOString();

                const updates = {
                    status:           'shipped',
                    tracking_number:  trackingNumber,
                    tracking_url:     trackingUrl,
                    shipped_at:       shippedAt,
                    updated_at:       new Date().toISOString(),
                };

                const { error } = await supabase
                    .from('orders')
                    .update(updates)
                    .eq(lookupField, lookupValue);

                if (error) throw error;

                console.log(`✅ Order ${lookupValue} marked shipped | tracking: ${trackingNumber}`);

                // Also send shipping notification email if we have buyer email
                await sendShippingEmail(supabase, lookupField, lookupValue, trackingNumber, trackingUrl);
                break;
            }

            case 'order_updated': {
                const newStatus = STATUS_MAP[pfStatus] || null;
                if (!newStatus) {
                    console.log(`Unknown Printful status "${pfStatus}" — skipping`);
                    break;
                }

                const { error } = await supabase
                    .from('orders')
                    .update({ status: newStatus, updated_at: new Date().toISOString() })
                    .eq(lookupField, lookupValue);

                if (error) throw error;
                console.log(`✅ Order ${lookupValue} status → ${newStatus}`);
                break;
            }

            case 'order_failed':
            case 'order_canceled': {
                const { error } = await supabase
                    .from('orders')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq(lookupField, lookupValue);

                if (error) throw error;
                console.log(`✅ Order ${lookupValue} marked cancelled`);
                break;
            }

            default:
                console.log(`Unhandled Printful event: ${type}`);
        }
    } catch (err) {
        console.error('Webhook processing error:', err.message);
        // Still return 200 to prevent Printful retrying endlessly
    }

    return res.status(200).json({ received: true });
};

// ── Shipping notification email ──────────────────────────────────
async function sendShippingEmail(supabase, field, value, trackingNumber, trackingUrl) {
    if (!process.env.RESEND_API_KEY || !trackingNumber) return;

    try {
        // Fetch order + buyer email from DB
        const { data: order } = await supabase
            .from('orders')
            .select('buyer_email, items, total_amount')
            .eq(field, value)
            .single();

        if (!order?.buyer_email) return;

        const trackLink = trackingUrl || `https://track.aftership.com/${trackingNumber}`;
        const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="560" style="max-width:560px">
        <tr><td style="text-align:center;padding-bottom:32px">
          <span style="font-size:28px;font-weight:700;letter-spacing:4px;color:#c8a96e;font-family:Georgia,serif">DUBIS</span>
          <p style="margin:4px 0 0;color:#888;font-size:12px;letter-spacing:2px">FOR THE REST OF US</p>
        </td></tr>
        <tr><td style="background:#1a1a1a;border-radius:12px;padding:36px 40px">
          <h1 style="margin:0 0 8px;font-size:22px;color:#e8e0d5;font-weight:600">Your order is on the way! 🚚</h1>
          <p style="margin:0 0 28px;color:#888;font-size:15px">Your DUBIS order has shipped.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;background:#111;border-radius:8px;padding:20px">
            <tr>
              <td style="color:#888;font-size:13px">Tracking number</td>
              <td style="color:#c8a96e;font-size:13px;text-align:right;font-weight:600">${trackingNumber}</td>
            </tr>
          </table>
          <a href="${trackLink}" style="display:block;text-align:center;background:#c8a96e;color:#0d0d0d;font-weight:700;font-size:14px;letter-spacing:1px;padding:14px 24px;border-radius:6px;text-decoration:none;margin-bottom:24px">
            TRACK YOUR ORDER →
          </a>
          <p style="margin:0;color:#888;font-size:13px;line-height:1.6">
            Questions? Reply to this email anytime.
          </p>
        </td></tr>
        <tr><td style="text-align:center;padding-top:28px">
          <p style="margin:0;color:#444;font-size:12px">
            DUBIS · <a href="https://www.dubis.net" style="color:#c8a96e;text-decoration:none">dubis.net</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                from:     'DUBIS Orders <orders@dubis.net>',
                to:       [order.buyer_email],
                subject:  `Your DUBIS order has shipped! Tracking: ${trackingNumber}`,
                html,
                reply_to: 'hello@dubis.net',
            }),
        });

        console.log(`✅ Shipping email sent to ${order.buyer_email}`);
    } catch (err) {
        console.error('Shipping email failed:', err.message);
    }
}
