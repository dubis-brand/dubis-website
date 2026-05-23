#!/usr/bin/env node
// DUBIS — Ghost-orders audit (2026-05-23, post save.js silent-rejection)
// =====================================================================
//
// Discovers Gelato orders created in our window that are MISSING from the
// `orders` table in Supabase. Each such order = "ghost": customer paid via
// PayPal, Gelato fulfilled, but /api/orders/save 400'd silently because of
// the variant-price-validation bug (fixed 2026-05-23 commit 1a24b26).
//
// Usage:
//   node scripts/audit-ghost-orders.js                  # report only (default)
//   node scripts/audit-ghost-orders.js --recover        # also INSERT recovery rows
//   node scripts/audit-ghost-orders.js --since 2026-05-01 --until 2026-05-23
//
// Env vars (loaded from .env.local):
//   Gelato / GELATO / GELATO_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GELATO_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars. Need Gelato + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// CLI flags
const args = process.argv.slice(2);
const RECOVER = args.includes('--recover');
const sinceIdx = args.indexOf('--since');
const untilIdx = args.indexOf('--until');
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : '2026-05-01';
const UNTIL = untilIdx >= 0 ? args[untilIdx + 1] : new Date().toISOString().slice(0, 10);

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function fetchGelatoOrders() {
  // Gelato API supports pagination via offset/limit. We paginate until empty.
  const orders = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = new URL('https://order.gelatoapis.com/v4/orders');
    url.searchParams.set('offset', offset);
    url.searchParams.set('limit', limit);
    url.searchParams.set('orderTypes', 'order');  // exclude drafts
    url.searchParams.set('startDate', `${SINCE}T00:00:00Z`);
    url.searchParams.set('endDate',   `${UNTIL}T23:59:59Z`);

    const res = await fetch(url.toString(), {
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gelato API ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    const batch = json.orders || json.data || [];
    if (batch.length === 0) break;
    orders.push(...batch);
    offset += batch.length;
    if (batch.length < limit) break;
    process.stdout.write(`  ...fetched ${orders.length} so far\n`);
  }

  return orders;
}

async function fetchDubisOrderIds() {
  const { data, error } = await sb
    .from('orders')
    .select('paypal_order_id, printful_order_id')
    .gte('created_at', `${SINCE}T00:00:00Z`)
    .lte('created_at', `${UNTIL}T23:59:59Z`);
  if (error) throw new Error(`Supabase: ${error.message}`);
  const paypalIds  = new Set((data || []).map(r => r.paypal_order_id).filter(Boolean));
  const gelatoIds  = new Set((data || []).map(r => r.printful_order_id).filter(Boolean));
  return { paypalIds, gelatoIds };
}

function extractPayPalIdFromGelatoRef(gelatoOrder) {
  // We use customerReferenceId = `DUBIS-${paypal_order_id}` per
  // api/create-gelato-order.js. Splits use `-{i+1}of{N}` suffix.
  const ref = gelatoOrder.orderReferenceId || gelatoOrder.customerReferenceId || gelatoOrder.referenceId || '';
  const m = ref.match(/^DUBIS-([A-Z0-9]+?)(?:-\d+of\d+)?$/);
  return m ? m[1] : null;
}

(async () => {
  console.log(`\n🔍 DUBIS Ghost-orders audit — ${SINCE} → ${UNTIL}`);
  console.log(`   Mode: ${RECOVER ? '🛠  RECOVER (will INSERT)' : '👀 REPORT only'}\n`);

  console.log('1. Fetching Gelato orders...');
  let gelatoOrders;
  try {
    gelatoOrders = await fetchGelatoOrders();
  } catch (e) {
    console.error('Gelato fetch failed:', e.message);
    process.exit(2);
  }
  console.log(`   → ${gelatoOrders.length} orders in window\n`);

  console.log('2. Fetching DUBIS orders table...');
  const { paypalIds, gelatoIds } = await fetchDubisOrderIds();
  console.log(`   → ${paypalIds.size} paypal_order_id rows, ${gelatoIds.size} printful_order_id rows in window\n`);

  console.log('3. Filtering out drafts / mockups / smoke-tests + cross-referencing...');
  const realOrders = gelatoOrders.filter(g => {
    const fin = g.financialStatus;
    const ful = g.fulfillmentStatus;
    const ref = g.orderReferenceId || g.customerReferenceId || '';
    // Drop anything still in draft state — these are admin Gelato Tools / catalog
    // refresh / smoke-test orders, not customer-paid ones.
    if (fin === 'draft' || ful === 'draft') return false;
    // Drop our own internal naming prefixes
    if (/^DUBIS-(MOCKUP|TIMING|SMOKE|TEST|REPRINT|REGEN)/i.test(ref)) return false;
    return true;
  });
  console.log(`   → ${realOrders.length} REAL customer orders after filter (was ${gelatoOrders.length} incl. drafts/mockups)\n`);

  const ghosts = [];
  for (const g of realOrders) {
    const paypalId = extractPayPalIdFromGelatoRef(g);
    const gelatoId = g.id;
    const inDbByPaypal = paypalId && paypalIds.has(paypalId);
    const inDbByGelato = gelatoId && gelatoIds.has(gelatoId);
    if (inDbByPaypal || inDbByGelato) continue;  // matched
    ghosts.push({
      gelato_id:        gelatoId,
      reference:        g.orderReferenceId || g.customerReferenceId,
      paypal_id_guess:  paypalId,
      financial_status: g.financialStatus,
      fulfillment:      g.fulfillmentStatus,
      created_at:       g.createdAt,
      total:            g.orderedByCustomer?.totalInclVat || g.totalInclVat || null,
      currency:         g.currency,
      shipping_email:   g.shippingAddress?.email,
      shipping_country: g.shippingAddress?.country,
      items_count:      (g.items || []).length,
    });
  }

  if (ghosts.length === 0) {
    console.log(`\n✅ NO ghost orders found. ${gelatoOrders.length} Gelato orders all match the DB.\n`);
    process.exit(0);
  }

  console.log(`\n🚨 FOUND ${ghosts.length} GHOST ORDERS:\n`);
  console.table(ghosts);

  if (!RECOVER) {
    console.log(`\nTo INSERT recovery rows, re-run with: node scripts/audit-ghost-orders.js --recover --since ${SINCE} --until ${UNTIL}\n`);
    process.exit(0);
  }

  console.log(`\n4. Inserting recovery rows...`);
  let inserted = 0;
  for (const ghost of ghosts) {
    if (!ghost.paypal_id_guess) {
      console.warn(`  ⚠ skipping ${ghost.gelato_id} — no PayPal ID extractable from reference "${ghost.reference}"`);
      continue;
    }
    // Find the full Gelato order to reconstruct items
    const full = gelatoOrders.find(g => g.id === ghost.gelato_id);
    const items = (full?.items || []).map(it => ({
      type:           'recovered',
      typeLabel:      it.productName || it.productCategoryUid || 'Unknown',
      selectedColor:  it.color || '',
      selectedSize:   it.size  || '',
      quantity:       it.quantity || 1,
      price:          Number(it.price?.value) || 0,
      phrase:         '(recovered from Gelato — slogan not captured)',
      productUid:     it.productUid,
    }));
    const itemsSubtotal = items.reduce((s, i) => s + (i.price * i.quantity), 0);
    const shippingAmt   = Number(full?.shipment?.totalCost?.value || 0);
    const totalAmount   = Number(ghost.total) || (itemsSubtotal + shippingAmt);

    // Map Gelato financial+fulfillment → our orders.status enum
    let status;
    if (ghost.financial_status === 'refunded' || ghost.fulfillment === 'canceled' || ghost.fulfillment === 'failed') {
      status = 'cancelled';
    } else if (ghost.fulfillment === 'shipped' || ghost.fulfillment === 'delivered') {
      status = ghost.fulfillment;
    } else {
      status = 'in_production';
    }
    const wasRefunded = (ghost.financial_status === 'refunded' || status === 'cancelled');

    const { error } = await sb.from('orders').insert({
      paypal_order_id:   ghost.paypal_id_guess,
      printful_order_id: ghost.gelato_id,
      status,
      buyer_email:       ghost.shipping_email || '',
      shipping_address:  full?.shippingAddress || {},
      items,
      total_amount:      totalAmount,
      items_subtotal:    itemsSubtotal,
      shipping_amount:   shippingAmt,
      currency:          ghost.currency || 'USD',
      refunded_at:       wasRefunded ? ghost.created_at : null,
      refund_reason:     wasRefunded
        ? 'ghost-recovery-2026-05-23-manual-refunded-by-oren-via-paypal-dashboard'
        : 'recovered-by-ghost-audit-2026-05-23',
      created_at:        ghost.created_at,
    });
    if (error) {
      console.error(`  ❌ ${ghost.gelato_id} insert failed: ${error.message}`);
    } else {
      console.log(`  ✅ recovered ${ghost.reference} → paypal=${ghost.paypal_id_guess}`);
      inserted++;
    }
  }
  console.log(`\n✅ Recovery complete: ${inserted} / ${ghosts.length} rows inserted\n`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(99);
});
