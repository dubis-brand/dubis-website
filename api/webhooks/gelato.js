// DUBIS — Gelato Webhook Handler
// Vercel Serverless Function  POST /api/webhooks/gelato
// Receives order status updates from Gelato and syncs to Supabase
// =================================================================
// Env vars: GELATO_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// =================================================================

const { createClient } = require('@supabase/supabase-js');
const crypto            = require('crypto');
const { refundOrder }  = require('../_paypal');

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
// Structured logger — single-line JSON for Vercel runtime-log grep
function wlog(stage, data = {}) {
  try { console.log(`[DUBIS-WEBHOOK] ${stage} ${JSON.stringify(data)}`); }
  catch (_) { console.log(`[DUBIS-WEBHOOK] ${stage} <unserializable>`); }
}
function werr(stage, data = {}) {
  try { console.error(`[DUBIS-WEBHOOK] ERROR ${stage} ${JSON.stringify(data)}`); }
  catch (_) { console.error(`[DUBIS-WEBHOOK] ERROR ${stage} <unserializable>`); }
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();

  // List header names (NOT values) so we can see what Gelato actually sends
  // without leaking secrets into the log stream.
  const headerNames = Object.keys(req.headers || {}).filter(h => !/cookie|authorization/i.test(h));

  wlog('request-received', {
    method: req.method,
    hasBody: !!req.body,
    headerNames,
    // Probe common secret-header variants
    has_x_gelato_webhook_secret: !!req.headers['x-gelato-webhook-secret'],
    has_x_webhook_secret:        !!req.headers['x-webhook-secret'],
    has_x_gelato_signature:      !!req.headers['x-gelato-signature'],
    has_gelato_signature:        !!req.headers['gelato-signature'],
    has_x_signature:             !!req.headers['x-signature'],
  });

  if (req.method !== 'POST') {
    werr('method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Webhook secret verification — required.  Gelato's docs are inconsistent across
  // account tiers: some plans deliver a plain secret via `x-gelato-webhook-secret`,
  // others send an HMAC-SHA256 signature via `x-gelato-signature`.  We accept both.
  const secret = process.env.GELATO_WEBHOOK_SECRET;
  if (!secret) {
    werr('no-secret-configured', {});
    console.error('GELATO_WEBHOOK_SECRET not configured — rejecting webhook');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Variant A: plain-secret header — accept several spellings Gelato uses.
  const incomingPlain = (
    req.headers['x-gelato-webhook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.headers['webhook-secret'] ||
    ''
  ).toString();

  // Variant B: HMAC-SHA256 of the raw body, compared against the header.
  const incomingSig = (
    req.headers['x-gelato-signature'] ||
    req.headers['gelato-signature'] ||
    req.headers['x-signature'] ||
    ''
  ).toString().replace(/^sha256=/i, '');

  let valid = false;
  let matchedVia = null;

  // Try plain-secret match
  if (incomingPlain && incomingPlain.length === secret.length) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(incomingPlain), Buffer.from(secret))) {
        valid = true; matchedVia = 'plain-secret';
      }
    } catch { /* fall through to HMAC check */ }
  }

  // Try HMAC signature match (computed over raw body)
  if (!valid && incomingSig) {
    try {
      const rawBody = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body || {});
      const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (incomingSig.length === computed.length &&
          crypto.timingSafeEqual(Buffer.from(incomingSig), Buffer.from(computed))) {
        valid = true; matchedVia = 'hmac-sha256';
      }
    } catch { /* stays invalid */ }
  }

  if (!valid) {
    werr('invalid-secret', {
      hasPlain: !!incomingPlain,
      plainLen: incomingPlain.length,
      hasSig:   !!incomingSig,
      sigLen:   incomingSig.length,
      expectedLen: secret.length,
    });
    console.warn('Gelato webhook: invalid secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }
  wlog('secret-valid', { matchedVia });

  const payload = req.body;
  const event   = payload?.event || payload?.type || '';

  wlog('event-parsed', {
    event,
    orderRef: payload?.order?.orderReferenceId || payload?.orderReferenceId || payload?.order?.id || null,
    gelatoOrderId: payload?.order?.id || null,
    status: payload?.order?.status || payload?.status || null,
  });

  // ── Idempotency: skip duplicate events ──────────────────────────
  const eventId = payload?.id || payload?.eventId || `${event}-${payload?.order?.id || payload?.orderReferenceId || Date.now()}`;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    const _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: insertErr } = await _sb.from('webhook_events')
      .insert({ source: 'gelato', event_id: eventId });
    if (insertErr?.code === '23505') { // unique_violation
      console.log('Gelato webhook: duplicate event', eventId, '— skipping');
      return res.status(200).json({ received: true, duplicate: true });
    }
  }

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

  let query = supabase.from('orders').select('id,buyer_email,shipping_address,status,paypal_order_id,refund_id');
  if (paypalOrderId) {
    query = query.eq('paypal_order_id', paypalOrderId);
  } else {
    query = query.eq('printful_order_id', orderRef);
  }

  const { data: orders, error: findErr } = await query;

  if (findErr || !orders?.length) {
    werr('order-not-found', { orderRef, paypalOrderId, findErr: findErr?.message || null });
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

  // Build update payload — may include refund fields if Gelato cancelled/failed
  const updatePayload = { status: newStatus, updated_at: new Date().toISOString() };

  // ── AUTO-REFUND on async Gelato cancellation/failure ──
  // If Gelato accepted the order initially but later cancels/fails (e.g. stock
  // issue caught in production, fraud block, address rejection) — we must
  // refund the customer. Safe to call: refundOrder is idempotent via
  // PayPal-Request-Id header, and we short-circuit if refund_id already stored.
  if ((newStatus === 'cancelled' || newStatus === 'failed') && !order.refund_id) {
    const payOrderId = order.paypal_order_id;
    if (payOrderId) {
      wlog('auto-refund-trigger', { orderId: order.id, paypalOrderId: payOrderId, gelatoStatus: newStatus });
      const refundResult = await refundOrder({ paypalOrderId: payOrderId, reason: `gelato_${newStatus}` });
      wlog('auto-refund-result', {
        orderId: order.id,
        refunded: refundResult.refunded,
        refundId: refundResult.refundId || null,
        refundReason: refundResult.reason || null,
      });
      if (refundResult.refunded) {
        updatePayload.status        = 'refunded';
        updatePayload.refund_id     = refundResult.refundId;
        updatePayload.refunded_at   = new Date().toISOString();
        updatePayload.refund_reason = `gelato_${newStatus}`;
      }
    } else {
      werr('auto-refund-no-paypal-id', { orderId: order.id });
    }
  }

  // Update status (+ refund fields if set above)
  const { error: updateErr } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', order.id);

  if (updateErr) {
    werr('db-update-failed', { orderId: order.id, errorMessage: updateErr.message });
    console.error('Gelato webhook: failed to update order', updateErr.message);
  } else {
    wlog('db-updated', { orderId: order.id, prevStatus: order.status, newStatus: updatePayload.status, refunded: !!updatePayload.refund_id, durationMs: Date.now() - t0 });
    console.log(`Order ${order.id} status → ${updatePayload.status}`);
  }

  // Send shipping email — only if transitioning to shipped (not already shipped)
  if (isShipped && buyerEmail && order.status !== 'shipped') {
    wlog('shipping-email-sending', { orderId: order.id, buyerEmailDomain: buyerEmail.split('@')[1] });
    await sendShippingEmail(buyerEmail, buyerName, trackingUrl, orderRef);
  }

  wlog('webhook-done', { orderId: order.id, newStatus: updatePayload.status, totalDurationMs: Date.now() - t0 });
  return res.status(200).json({ received: true, status: updatePayload.status });
};
