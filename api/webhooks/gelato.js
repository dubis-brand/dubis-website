// DUBIS — Gelato Webhook Handler
// Vercel Serverless Function  POST /api/webhooks/gelato
// Receives order status updates from Gelato and syncs to Supabase
// =================================================================
// Env vars: GELATO_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// =================================================================

const { createClient } = require('@supabase/supabase-js');
const crypto            = require('crypto');

// ─────────────────────────────────────────────────────────────────
// Gelato status → DUBIS internal status
// ─────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  // Order lifecycle
  'created':                'confirmed',
  'passed_to_production':   'confirmed',
  'printed':                'confirmed',
  'shipped':                'shipped',
  'delivered':              'delivered',
  // Failures
  'failed':                 'failed',
  'cancelled':              'cancelled',
  'canceled':               'cancelled',
};

function mapStatus(gelatoStatus) {
  return STATUS_MAP[(gelatoStatus || '').toLowerCase()] || 'pending';
}

// ─────────────────────────────────────────────────────────────────
// Send shipping notification email via Resend
// ─────────────────────────────────────────────────────────────────
async function sendShippingEmail(buyerEmail, buyerName, trackingUrl, orderId) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY || !buyerEmail) return;

  const trackingLine = trackingUrl
    ? `<p>Track your package: <a href="${trackingUrl}">${trackingUrl}</a></p>`
    : '<p>Tracking information will be available soon.</p>';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'DUBIS <orders@dubis.net>',
      to:      [buyerEmail],
      subject: '📦 Your DUBIS order is on its way!',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#1a1a1a">Your order is shipped! 🚀</h2>
          <p>Hi ${buyerName || 'there'},</p>
          <p>Great news — your DUBIS order is on its way.</p>
          ${trackingLine}
          <p>Order reference: <strong>${orderId}</strong></p>
          <p style="margin-top:32px;color:#666">— The DUBIS team</p>
        </div>
      `,
    }),
  }).catch(err => console.error('Shipping email failed:', err.message));
}

// ─────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Webhook secret verification — required
  const secret = process.env.GELATO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GELATO_WEBHOOK_SECRET not configured — rejecting webhook');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  const incoming = req.headers['x-gelato-webhook-secret'] || req.headers['x-webhook-secret'] || '';
  // Timing-safe comparison prevents timing attacks
  let valid = false;
  try {
    valid = incoming.length === secret.length &&
            crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(secret));
  } catch { valid = false; }
  if (!valid) {
    console.warn('Gelato webhook: invalid secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const payload = req.body;
  const event   = payload?.event || payload?.type || '';

  console.log('Gelato webhook event:', event, JSON.stringify(payload).substring(0, 300));

  // ── Determine order reference and status from event ──
  let orderRef   = null;
  let newStatus  = null;
  let trackingUrl = null;
  let buyerEmail  = null;
  let buyerName   = null;
  let isShipped   = false;

  if (event === 'order_status_updated' || event === 'order.status_updated') {
    const order = payload.order || payload;
    orderRef  = order.orderReferenceId || order.id;
    newStatus = mapStatus(order.status);
  } else if (event === 'order_item_tracking_code_updated' || event === 'package_shipped') {
    // Gelato fires order_item_tracking_code_updated when a shipment tracking number is assigned
    const order    = payload.order || payload;
    const item     = (payload.orderItem || payload.items || [])[0] || {};
    orderRef    = order.orderReferenceId || order.id || payload.orderReferenceId;
    newStatus   = 'shipped';
    trackingUrl = item.trackingUrl || item.trackingCode
      ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${item.trackingCode}`
      : payload.trackingUrl || null;
    isShipped   = true;
  } else {
    // Unknown event — ack and ignore
    return res.status(200).json({ received: true });
  }

  if (!orderRef) {
    return res.status(200).json({ received: true, note: 'no order reference' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set');
    return res.status(200).json({ received: true });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find order by Gelato order ID (stored in printful_order_id column)
  // orderRef from Gelato is the orderReferenceId we set ("DUBIS-{paypalOrderId}")
  // or the Gelato internal ID stored in printful_order_id
  const paypalOrderId = orderRef.startsWith('DUBIS-') ? orderRef.slice(6) : null;

  let query = supabase.from('orders').select('id,buyer_email,shipping_address,status');
  if (paypalOrderId) {
    query = query.eq('paypal_order_id', paypalOrderId);
  } else {
    query = query.eq('printful_order_id', orderRef);
  }

  const { data: orders, error: findErr } = await query;

  if (findErr || !orders?.length) {
    console.warn('Gelato webhook: order not found for ref:', orderRef);
    return res.status(200).json({ received: true, note: 'order not found' });
  }

  const order = orders[0];
  buyerEmail = order.buyer_email;
  buyerName  = order.shipping_address?.name || '';

  // Idempotency: skip if status already matches and it's not a shipping event (to avoid re-sending tracking emails)
  if (order.status === newStatus && !isShipped) {
    console.log(`Order ${order.id} already has status ${newStatus} — skipping`);
    return res.status(200).json({ received: true, status: newStatus, skipped: true });
  }

  // Update status
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', order.id);

  if (updateErr) {
    console.error('Gelato webhook: failed to update order', updateErr.message);
  } else {
    console.log(`Order ${order.id} status → ${newStatus}`);
  }

  // Send shipping email — only if transitioning to shipped (not already shipped)
  if (isShipped && buyerEmail && order.status !== 'shipped') {
    await sendShippingEmail(buyerEmail, buyerName, trackingUrl, orderRef);
  }

  return res.status(200).json({ received: true, status: newStatus });
};
