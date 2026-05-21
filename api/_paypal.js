// DUBIS — PayPal server-side helpers
// Shared module (underscore prefix = NOT a Vercel function slot)
// =================================================================
// Provides OAuth token fetch + capture refund API for auto-refund flow
// when Gelato rejects an order after PayPal has already captured funds.
//
// Env vars required:
//   PAYPAL_CLIENT_ID
//   PAYPAL_SECRET  (sometimes PAYPAL_CLIENT_SECRET — we check both)
//   PAYPAL_ENV     ("live" or "sandbox", default "live")
// =================================================================

const PAYPAL_API_BASE = () =>
  (process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

function plog(stage, data = {}) {
  try { console.log(`[DUBIS-PAYPAL] ${stage} ${JSON.stringify(data)}`); }
  catch { console.log(`[DUBIS-PAYPAL] ${stage} <unserializable>`); }
}
function perr(stage, data = {}) {
  try { console.error(`[DUBIS-PAYPAL] ERROR ${stage} ${JSON.stringify(data)}`); }
  catch { console.error(`[DUBIS-PAYPAL] ERROR ${stage} <unserializable>`); }
}

/**
 * Get an OAuth access token from PayPal using client_credentials grant.
 * @returns {Promise<string|null>} access token, or null on failure
 */
async function getAccessToken() {
  // 2026-05-21 (Hila incident): accept alternate spellings/casings so a typo
  // in the Vercel UI ("Pay_Pal_clainet_Id", "Pay_Pal_Secret") still resolves.
  // Case-insensitive prefix match across env var names — defensive coding for
  // the non-technical operator setting these via the UI.
  const findEnv = (matchers) => {
    for (const k of Object.keys(process.env)) {
      const norm = k.toLowerCase().replace(/[-_]/g, '');
      if (matchers.some(m => norm === m || norm.endsWith(m))) {
        const v = process.env[k];
        if (v) return v;
      }
    }
    return null;
  };
  const clientId =
    process.env.PAYPAL_CLIENT_ID ||
    findEnv(['paypalclientid', 'paypalclainetid']);  // includes the actual typo
  const secret =
    process.env.PAYPAL_SECRET ||
    process.env.PAYPAL_CLIENT_SECRET ||
    findEnv(['paypalsecret', 'paypalclientsecret']);
  if (!clientId || !secret) {
    perr('oauth-no-credentials', { hasId: !!clientId, hasSecret: !!secret });
    return null;
  }
  try {
    const creds = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const res = await fetch(`${PAYPAL_API_BASE()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      perr('oauth-failed', { httpStatus: res.status, errorType: data.error || null });
      return null;
    }
    plog('oauth-success', { tokenType: data.token_type, expiresIn: data.expires_in });
    return data.access_token;
  } catch (err) {
    perr('oauth-exception', { message: err.message });
    return null;
  }
}

/**
 * Retrieve order details to find the capture ID for a given PayPal order ID.
 * PayPal order IDs are not capture IDs — you cannot refund directly from orderId.
 * @param {string} paypalOrderId
 * @param {string} accessToken
 * @returns {Promise<{captureId:string, amount:string, currency:string}|null>}
 */
async function getCaptureFromOrder(paypalOrderId, accessToken) {
  try {
    const res = await fetch(`${PAYPAL_API_BASE()}/v2/checkout/orders/${paypalOrderId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      perr('get-order-failed', { paypalOrderId, httpStatus: res.status });
      return null;
    }
    // Navigate: purchase_units[0].payments.captures[0]
    const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id) {
      perr('no-capture-found', { paypalOrderId, orderStatus: data.status });
      return null;
    }
    return {
      captureId: capture.id,
      amount:    capture.amount?.value || '0',
      currency:  capture.amount?.currency_code || 'USD',
    };
  } catch (err) {
    perr('get-order-exception', { paypalOrderId, message: err.message });
    return null;
  }
}

/**
 * Full refund flow: orderId → capture → refund.
 * Safe to call with empty args — returns structured result either way.
 * @param {object} opts
 * @param {string} opts.paypalOrderId  PayPal order ID (from checkout)
 * @param {string} [opts.reason]       Internal reason (logged, also sent to PayPal note)
 * @returns {Promise<{refunded:boolean, refundId?:string, reason?:string, amount?:string}>}
 */
async function refundOrder({ paypalOrderId, reason = 'gelato_rejected' } = {}) {
  if (!paypalOrderId) {
    perr('refund-no-order-id', {});
    return { refunded: false, reason: 'no_paypal_order_id' };
  }
  plog('refund-start', { paypalOrderId, reason });

  const token = await getAccessToken();
  if (!token) {
    return { refunded: false, reason: 'oauth_failed' };
  }

  const cap = await getCaptureFromOrder(paypalOrderId, token);
  if (!cap) {
    return { refunded: false, reason: 'capture_not_found' };
  }

  try {
    const res = await fetch(`${PAYPAL_API_BASE()}/v2/payments/captures/${cap.captureId}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        // PayPal idempotency: reuse same key for retries of same logical refund
        'PayPal-Request-Id': `refund-${paypalOrderId}`,
      },
      body: JSON.stringify({
        // Empty body = full refund (recommended by PayPal)
        note_to_payer: `DUBIS: order auto-refunded (${reason})`,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      perr('refund-api-failed', { paypalOrderId, httpStatus: res.status, errorType: data.name || null });
      return { refunded: false, reason: `refund_api_${res.status}`, details: data };
    }
    plog('refund-success', {
      paypalOrderId,
      refundId: data.id,
      status: data.status,
      amount: cap.amount,
      currency: cap.currency,
    });
    return {
      refunded: true,
      refundId: data.id,
      amount:   cap.amount,
      currency: cap.currency,
    };
  } catch (err) {
    perr('refund-exception', { paypalOrderId, message: err.message });
    return { refunded: false, reason: 'exception', details: err.message };
  }
}

module.exports = {
  refundOrder,
  getAccessToken,
  getCaptureFromOrder,
};
