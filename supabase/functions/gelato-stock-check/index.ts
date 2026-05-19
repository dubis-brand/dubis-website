// DUBIS — Gelato stock availability daily sync
// ───────────────────────────────────────────────────────────────────────
// Standalone edge function. Runs daily via scheduled-tasks MCP + manual trigger.
// For every active product × every color × every size:
//   1. Build the Gelato productUid (same logic as create-gelato-order.js)
//   2. GET https://product.gelatoapis.com/v3/products/{productUid}
//   3. Upsert product_variant_stock with in_stock status
//
// Rules (from memory/checkout-guardrails.md rule #7):
//   - Reads dubis_products WHERE active=true (NO hardcoded product lists)
//   - Iterates every color + every size for every product
//   - manual_override=true rows are skipped (respects oren's overrides)
//   - Logs structured [DUBIS-STOCK-CHECK] prefix
//
// Auth: POST with header `x-agent-secret: AGENT_SECRET`
//   Or `?token=SUPABASE_SERVICE_ROLE_KEY` (internal calls only)

import { createClient } from 'npm:@supabase/supabase-js@2';

const GELATO_API_BASE = 'https://product.gelatoapis.com/v3';
const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY') ?? '';
const AGENT_SECRET = Deno.env.get('AGENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ALL sizes we sell across every product type (expand as needed)
const ALL_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const CAP_SIZES = ['One Size'];

// Mirror of TEMPLATES + COLOR_MAP in api/create-gelato-order.js. Keep in sync.
// Rewritten 2026-05-15 after every womens, every long-sleeve, every cap UID was
// found to be 404 in Gelato's current catalog. See api/create-gelato-order.js
// for the canonical comments + verification notes.
type ColorEntry = string | { color: string; brand: string; sku: string };
type Template = {
  cat: string; sub: string; cut: string; qa: string; gpr: string;
  brand: string | null; sku: string | null;
};

const TEMPLATES: Record<string, Template> = {
  'tshirt-unisex':     { cat: 't-shirt', sub: 'crewneck',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '64000'  },
  'tshirt-women':      { cat: 't-shirt', sub: 'crewneck',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'bella-and-canvas', sku: '6004'   },
  'hoodie-unisex':     { cat: 'hoodie',  sub: 'pullover',        cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '18500'  },
  'hoodie-women':      { cat: 'hoodie',  sub: 'pullover',        cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: null,                sku: null    },
  'ziphoodie-unisex':  { cat: 'hoodie',  sub: 'zip',             cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: null,                sku: null    },
  'longsleeve-unisex': { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'unisex', qa: 'classic', gpr: '4-4',     brand: 'gildan',           sku: '2400'   },
  'longsleeve-women':  { cat: 't-shirt', sub: 'longsleeve-crew', cut: 'womens', qa: 'prm',     gpr: '4-4',     brand: 'sols',             sku: '02075'  },
  'cap-unisex':        { cat: 'hat',     sub: 'dad-hat',         cut: 'unisex', qa: 'classic', gpr: '4-0-dtf', brand: 'as-colour',        sku: '1114'   },
};

const COLOR_MAP: Record<string, Record<string, ColorEntry>> = {
  'tshirt-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Navy': 'navy',
    'Charcoal': 'charcoal', 'Red': 'red', 'Gray': 'rs-sport-grey',
    'Forest Green': { color: 'forest-green', brand: 'next-level', sku: '3600' },
  },
  'tshirt-women': {
    'Black': 'black', 'White': 'white', 'Cream': 'soft-cream', 'Navy': 'navy',
  },
  'hoodie-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy',
    'Charcoal': 'dark-heather', 'Forest Green': 'forest-green', 'Gray': 'sport-grey',
  },
  'hoodie-women': {
    'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Charcoal': 'charcoal',
  },
  'ziphoodie-unisex': {
    'Black': 'black', 'White': 'white', 'Navy': 'navy', 'Charcoal': 'dark-heather',
  },
  'longsleeve-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Navy': 'navy',
    'Forest Green': 'forest-green', 'Gray': 'sports-grey',
  },
  'longsleeve-women': {
    'Black': 'deep-black', 'White': 'white', 'Navy': 'french-navy',
  },
  'cap-unisex': {
    'Black': 'black', 'White': 'white', 'Cream': 'ecru', 'Navy': 'navy',
  },
};

const SIZE_MAP: Record<string, string> = {
  'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl', 'One Size': 'onesize',
};

function templateKey(type: string, gender: string | undefined | null): string {
  return `${type}-${gender === 'women' ? 'women' : 'unisex'}`;
}

function buildProductUid(type: string, dubisColor: string, dubisSize: string, gender = 'unisex'): string | null {
  const key = templateKey(type, gender);
  const t = TEMPLATES[key];
  if (!t) return null;
  const colorEntry = (COLOR_MAP[key] || {})[dubisColor];
  if (!colorEntry) return null;
  const gColor = typeof colorEntry === 'string' ? colorEntry : colorEntry.color;
  const brand  = (typeof colorEntry === 'object' && colorEntry.brand) ? colorEntry.brand : t.brand;
  const sku    = (typeof colorEntry === 'object' && colorEntry.sku)   ? colorEntry.sku   : t.sku;
  const gSize  = SIZE_MAP[dubisSize];
  if (!gSize) return null;
  const brandSuffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${brandSuffix}`;
}

type CheckResult = {
  in_stock: boolean;
  gelato_http: number;
  reason: string;
  cost_us_usd: number | null;
  cost_il_usd: number | null;
};

// Query Gelato for a single productUid's availability AND per-country wholesale cost.
// Returns in_stock=true unless Gelato explicitly reports unavailable / 404.
// Cost endpoint: GET /v3/products/{uid}/prices?country=US|IL — returns wholesale
// USD cost. Within the same SKU/size, the cost is the same across colors (the
// Gelato dashboard "$12.47 vs $16.23" discrepancy is the Gelato+ discount being
// applied differently per color, not a base-cost difference). What does vary:
//   - size (M ≈ $15.39, 3XL ≈ $19.19)
//   - country (US $15.39, IL $20.20 — IL facility carries an upcharge)
//   - SKU/brand fallback (e.g. Forest Green forces next-level_3600)
async function checkVariant(productUid: string): Promise<CheckResult> {
  const blank: CheckResult = { in_stock: true, gelato_http: 0, reason: '', cost_us_usd: null, cost_il_usd: null };
  try {
    // Parallel: existence probe + US price + IL price. Three calls fan out
    // simultaneously so total wallclock ≈ slowest single call (Gelato p50 ~150ms).
    const [existRes, priceUsRes, priceIlRes] = await Promise.all([
      fetch(`${GELATO_API_BASE}/products/${productUid}`,        { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } }),
      fetch(`${GELATO_API_BASE}/products/${productUid}/prices?country=US`, { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } }),
      fetch(`${GELATO_API_BASE}/products/${productUid}/prices?country=IL`, { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } }),
    ]);

    // Pull prices first — even if existence is 404 we may still log a hint.
    async function firstPrice(r: Response): Promise<number | null> {
      if (!r.ok) return null;
      const arr = await r.json().catch(() => null) as Array<{ price?: number; quantity?: number }> | null;
      if (!Array.isArray(arr)) return null;
      // Prefer quantity=1 entry, fallback to first
      const q1 = arr.find(p => p.quantity === 1);
      const pick = q1 || arr[0];
      const v = pick?.price;
      return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 100) / 100 : null;
    }
    let cost_us_usd = await firstPrice(priceUsRes);
    let cost_il_usd = await firstPrice(priceIlRes);

    // 2026-05-19: brand-suffix prices-API fallback.
    // For some apparel UIDs (notably longsleeve-crew/unisex/gildan_2400 — products
    // 10 + 29), the /prices endpoint returns 404 even though /products returns 200.
    // Dropping the `_brand_sku` suffix returns valid prices for the same garment.
    // Retry without the suffix when either currency call missed.
    if ((cost_us_usd == null || cost_il_usd == null) && /_[a-z][a-z-]*_[0-9a-z]+$/.test(productUid)) {
      const brandless = productUid.replace(/_[a-z][a-z-]*_[0-9a-z]+$/, '');
      try {
        const [retryUs, retryIl] = await Promise.all([
          fetch(`${GELATO_API_BASE}/products/${brandless}/prices?country=US`, { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } }),
          fetch(`${GELATO_API_BASE}/products/${brandless}/prices?country=IL`, { headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' } }),
        ]);
        if (cost_us_usd == null) cost_us_usd = await firstPrice(retryUs);
        if (cost_il_usd == null) cost_il_usd = await firstPrice(retryIl);
      } catch (_) { /* swallow — keep nulls */ }
    }

    const res = existRes;
    if (res.status === 404) {
      return { ...blank, in_stock: false, gelato_http: 404, reason: 'not-in-catalog', cost_us_usd, cost_il_usd };
    }
    if (!res.ok) {
      // Any non-404 non-2xx: conservative — keep previous state, mark source=unknown
      return { ...blank, in_stock: true, gelato_http: res.status, reason: `http-${res.status}-keep-previous`, cost_us_usd, cost_il_usd };
    }
    const body = await res.json().catch(() => ({})) as any;
    // Gelato product endpoint historically returns productUid if it exists.
    // If the API surfaces an "availability" or "disabled" field, honor it.
    if (body?.disabled === true) {
      return { ...blank, in_stock: false, gelato_http: 200, reason: 'disabled', cost_us_usd, cost_il_usd };
    }
    if (typeof body?.availability === 'string' && /out/i.test(body.availability)) {
      return { ...blank, in_stock: false, gelato_http: 200, reason: body.availability, cost_us_usd, cost_il_usd };
    }
    if (Array.isArray(body?.productVariantOptions) && body.productVariantOptions.length === 0) {
      return { ...blank, in_stock: false, gelato_http: 200, reason: 'no-variants', cost_us_usd, cost_il_usd };
    }
    // Default: variant exists and nothing flags it unavailable
    return { ...blank, in_stock: true, gelato_http: 200, reason: 'ok', cost_us_usd, cost_il_usd };
  } catch (err) {
    return { ...blank, in_stock: true, gelato_http: 0, reason: `fetch-error:${(err as Error).message}` };
  }
}

// ─── Shipping quote (US + IL) ─────────────────────────────────────────
// Per-country flat shipping rate computed ONCE per sync via Gelato Shipment API.
// Stored in app_config (gelato_ship_us_usd / gelato_ship_il_usd) and read by
// paypal.js at checkout. v1 uses one representative variant (Gildan 64000 Black M)
// to probe shipping cost — adequate because Gelato shipping for shirts/hoodies
// is fairly flat ($5-8 US, $12-15 IL, varies <$2 across SKUs).
const SHIP_PROBE_UID = 'apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_classic_gsi_m_gco_black_gpr_4-4_gildan_64000';

async function probeShippingRate(countryIsoCode: string, postCode: string): Promise<number | null> {
  // Gelato v4 orders:quote requires `recipient` (not shippingAddress), `products`
  // (not items), and a `files[]` per product. Verified shape against live API
  // 2026-05-16 — earlier attempts with shippingAddress+items returned 400.
  try {
    const r = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
      method: 'POST',
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderReferenceId: `dubis-rate-probe-${countryIsoCode}-${Date.now()}`,
        customerReferenceId: 'dubis-rate-probe',
        currency: 'USD',
        recipient: {
          firstName: 'Rate', lastName: 'Probe',
          addressLine1: '1 Probe St',
          city: countryIsoCode === 'IL' ? 'Tel Aviv' : 'Los Angeles',
          postCode,
          country: countryIsoCode,
          state: countryIsoCode === 'IL' ? '' : 'CA',
          email: 'probe@dubis.test',
        },
        products: [{
          itemReferenceId: 'probe',
          productUid: SHIP_PROBE_UID,
          quantity: 1,
          files: [{ type: 'default', url: 'https://www.dubis.net/designs/front_logo_white.png' }],
        }],
      }),
    });
    if (!r.ok) return null;
    const json = await r.json().catch(() => null) as any;
    // Response: { quotes: [{ shipmentMethods: [{ price: 4.99, name: "USPS Ground Advantage", ... }] }] }
    const methods = json?.quotes?.[0]?.shipmentMethods || json?.shipmentMethods || [];
    if (!Array.isArray(methods) || methods.length === 0) return null;
    const prices = methods
      .map((m: any) => (typeof m?.price === 'number' ? m.price : null))
      .filter((p: number | null): p is number => p != null && Number.isFinite(p));
    if (prices.length === 0) return null;
    return Math.round(Math.min(...prices) * 100) / 100;
  } catch { return null; }
}

// ─── Gelato order-status monitor (2026-05-18) ─────────────────────────
// Daily-pass companion to the inventory check. Walks every active order with
// a Gelato order id and flags:
//   - P0 critical: still pending/created/passed/draft after >3 days
//   - P0 critical: shipment exception ("Failed", "On hold", "Exception", "Returned")
//   - P1 high   : in-transit/shipped >14 days without delivery
// Each flag becomes an `agent_tasks` row (agent_id=gelato_stock,
// category=gelato_order_alert) so the morning-report picks it up. Idempotent:
// if an open alert already exists for the same order+kind, we touch updated_at
// and refresh notes instead of inserting a duplicate.
const GELATO_ORDER_API_BASE = 'https://order.gelatoapis.com';
const DAY_MS = 86_400_000;
const PENDING_THRESHOLD_DAYS = 3;
const TRANSIT_THRESHOLD_DAYS = 14;
const EXCEPTION_KEYWORDS = ['fail', 'failed attempt', 'on hold', 'on_hold', 'exception', 'returned', 'undeliverable', 'lost', 'damaged', 'rejected'];

type OrderFlag = {
  order_id: string;
  printful_order_id: string;
  buyer_email: string | null;
  total_amount: number | null;
  kind: 'pending_too_long' | 'shipment_exception' | 'transit_too_long';
  priority: 'critical' | 'high';
  gelato_status: string;
  days_since_create: number;
  detail: string;
};

async function fetchGelatoOrder(printfulOrderId: string): Promise<Record<string, unknown> | null> {
  try {
    const v4 = await fetch(`${GELATO_ORDER_API_BASE}/v4/orders/${printfulOrderId}`, {
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (v4.ok) return await v4.json();
    if (v4.status !== 404) return null;
    const v3 = await fetch(`${GELATO_ORDER_API_BASE}/v3/orders/${printfulOrderId}`, {
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (v3.ok) return await v3.json();
    return null;
  } catch {
    return null;
  }
}

function hasShipmentException(g: Record<string, unknown>): { hit: boolean; reason: string } {
  const probes: string[] = [];
  const collect = (v: unknown) => { if (typeof v === 'string') probes.push(v.toLowerCase()); };
  collect((g as { status?: string }).status);
  const shipment = (g as { shipment?: { status?: string; events?: Array<{ status?: string; description?: string }> } }).shipment;
  if (shipment) {
    collect(shipment.status);
    for (const ev of shipment.events || []) {
      collect(ev.status); collect(ev.description);
    }
  }
  const shipments = (g as { shipments?: Array<{ status?: string; events?: Array<{ status?: string; description?: string }> }> }).shipments || [];
  for (const s of shipments) {
    collect(s.status);
    for (const ev of s.events || []) { collect(ev.status); collect(ev.description); }
  }
  const fulfillments = (g as { fulfillments?: Array<{ status?: string }> }).fulfillments || [];
  for (const f of fulfillments) collect(f.status);
  for (const probe of probes) {
    for (const kw of EXCEPTION_KEYWORDS) {
      if (probe.includes(kw)) return { hit: true, reason: probe.slice(0, 120) };
    }
  }
  return { hit: false, reason: '' };
}

function isPendingStatus(status: string): boolean {
  const s = status.toLowerCase().replace(/[_-]/g, '');
  return ['created', 'passed', 'draft', 'pending'].includes(s);
}

function isInTransitStatus(status: string, dubisStatus: string): boolean {
  const s = status.toLowerCase().replace(/[_-]/g, '');
  if (['intransit', 'shipped', 'dispatched'].includes(s)) return true;
  return dubisStatus === 'shipped';
}

async function monitorGelatoOrders(sb: ReturnType<typeof createClient>): Promise<{
  scanned: number;
  with_gelato_id: number;
  gelato_unreachable: number;
  flags_created: number;
  flags_refreshed: number;
  flags: OrderFlag[];
  errors: string[];
}> {
  const errors: string[] = [];
  if (!GELATO_API_KEY) {
    return { scanned: 0, with_gelato_id: 0, gelato_unreachable: 0, flags_created: 0, flags_refreshed: 0, flags: [], errors: ['no-gelato-key'] };
  }

  const { data: orders, error: ordErr } = await sb
    .from('orders')
    .select('id, status, printful_order_id, buyer_email, total_amount, created_at, shipped_at, tracking_number, refunded_at, is_test')
    .in('status', ['pending', 'in_production', 'shipped', 'approved'])
    .not('printful_order_id', 'is', null)
    .is('refunded_at', null)
    .neq('is_test', true)
    .order('created_at', { ascending: true });
  if (ordErr) {
    errors.push(`orders-query: ${ordErr.message}`);
    return { scanned: 0, with_gelato_id: 0, gelato_unreachable: 0, flags_created: 0, flags_refreshed: 0, flags: [], errors };
  }

  const list = orders || [];
  const flags: OrderFlag[] = [];
  let gelatoUnreachable = 0;
  const now = Date.now();

  for (const o of list as Array<Record<string, unknown>>) {
    const orderId = String(o.id);
    const printfulOrderId = String(o.printful_order_id);
    const dubisStatus = String(o.status);
    const buyerEmail = (o.buyer_email as string) ?? null;
    const totalAmount = (o.total_amount as number) ?? null;
    const createdAt = new Date(o.created_at as string).getTime();
    const daysSinceCreate = Math.floor((now - createdAt) / DAY_MS);
    const shippedAt = o.shipped_at ? new Date(o.shipped_at as string).getTime() : null;
    const daysSinceShipped = shippedAt ? Math.floor((now - shippedAt) / DAY_MS) : null;

    const g = await fetchGelatoOrder(printfulOrderId);
    if (!g) {
      gelatoUnreachable++;
      // 14d+ unreachable on a pending order is itself a P0 — let the pending check below trigger.
    }
    const gStatus = String(((g as { status?: string }) || {}).status || dubisStatus);

    // Exception flag takes precedence (P0 — needs ticket regardless of age)
    if (g) {
      const ex = hasShipmentException(g);
      if (ex.hit) {
        flags.push({
          order_id: orderId,
          printful_order_id: printfulOrderId,
          buyer_email: buyerEmail,
          total_amount: totalAmount,
          kind: 'shipment_exception',
          priority: 'critical',
          gelato_status: gStatus,
          days_since_create: daysSinceCreate,
          detail: `Gelato shipment flagged: "${ex.reason}". Buyer: ${buyerEmail || 'unknown'}. Age: ${daysSinceCreate}d.`,
        });
        continue; // one flag per order per pass
      }
    }

    // Pending too long (P0)
    if (isPendingStatus(gStatus) && daysSinceCreate > PENDING_THRESHOLD_DAYS) {
      flags.push({
        order_id: orderId,
        printful_order_id: printfulOrderId,
        buyer_email: buyerEmail,
        total_amount: totalAmount,
        kind: 'pending_too_long',
        priority: 'critical',
        gelato_status: gStatus,
        days_since_create: daysSinceCreate,
        detail: `Order ${daysSinceCreate}d in "${gStatus}" at Gelato (threshold ${PENDING_THRESHOLD_DAYS}d). Buyer: ${buyerEmail || 'unknown'}. Gelato US SLA is 5-7d total — pending past day 3 means production never started.`,
      });
      continue;
    }

    // In-transit too long (P1)
    const transitDays = daysSinceShipped ?? daysSinceCreate;
    if (isInTransitStatus(gStatus, dubisStatus) && transitDays > TRANSIT_THRESHOLD_DAYS) {
      flags.push({
        order_id: orderId,
        printful_order_id: printfulOrderId,
        buyer_email: buyerEmail,
        total_amount: totalAmount,
        kind: 'transit_too_long',
        priority: 'high',
        gelato_status: gStatus,
        days_since_create: daysSinceCreate,
        detail: `In-transit ${transitDays}d without delivery confirmation (threshold ${TRANSIT_THRESHOLD_DAYS}d). Buyer: ${buyerEmail || 'unknown'}. Likely DHL/carrier delay — buyer probably already complaining.`,
      });
    }
  }

  // Persist flags as agent_tasks (idempotent per order+kind).
  let created = 0; let refreshed = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const f of flags) {
    // Look up an existing OPEN alert for the same order+kind
    const { data: existing } = await sb
      .from('agent_tasks')
      .select('id, status, content_data')
      .eq('agent_id', 'gelato_stock')
      .eq('category', 'gelato_order_alert')
      .in('status', ['pending', 'pending_approval', 'approved', 'in_progress'])
      .contains('content_data', { order_id: f.order_id, kind: f.kind })
      .limit(1);

    const title = f.kind === 'pending_too_long'
      ? `🚨 Gelato pending >${PENDING_THRESHOLD_DAYS}d — DUBIS-${(f.printful_order_id || '').slice(0, 8)} (${f.days_since_create}d)`
      : f.kind === 'shipment_exception'
        ? `🚨 Gelato shipment exception — DUBIS-${(f.printful_order_id || '').slice(0, 8)}`
        : `⚠️ In-transit >${TRANSIT_THRESHOLD_DAYS}d — DUBIS-${(f.printful_order_id || '').slice(0, 8)} (${f.days_since_create}d)`;

    const content_data: Record<string, unknown> = {
      order_id: f.order_id,
      printful_order_id: f.printful_order_id,
      buyer_email: f.buyer_email,
      total_amount: f.total_amount,
      kind: f.kind,
      gelato_status: f.gelato_status,
      days_since_create: f.days_since_create,
      flagged_at: new Date().toISOString(),
      flagged_by: 'gelato_stock_order_monitor',
    };

    if (existing && existing.length > 0) {
      const id = (existing[0] as { id: string }).id;
      const prev = ((existing[0] as { content_data?: Record<string, unknown> }).content_data) || {};
      await sb.from('agent_tasks').update({
        notes: `${f.detail}\n(refreshed ${today})`,
        content_data: { ...prev, ...content_data, last_seen: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      refreshed++;
    } else {
      const { error: insErr } = await sb.from('agent_tasks').insert({
        agent_id: 'gelato_stock',
        title,
        description: f.detail,
        status: 'pending',
        priority: f.priority,
        category: 'gelato_order_alert',
        content_data,
        notes: `Auto-flagged by gelato_stock order monitor on ${today}.`,
        requires_budget: false,
      });
      if (insErr) errors.push(`insert ${f.order_id}: ${insErr.message}`);
      else created++;
    }
  }

  return {
    scanned: list.length,
    with_gelato_id: list.length, // query already filters printful_order_id IS NOT NULL
    gelato_unreachable: gelatoUnreachable,
    flags_created: created,
    flags_refreshed: refreshed,
    flags,
    errors,
  };
}

async function authorized(req: Request): Promise<boolean> {
  const header = req.headers.get('x-agent-secret');
  if (header && AGENT_SECRET && header === AGENT_SECRET) return true;
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam && tokenParam === SERVICE_ROLE) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  const log = (event: string, fields: Record<string, unknown> = {}) =>
    console.log(`[DUBIS-STOCK-CHECK] ${event}`, JSON.stringify(fields));

  if (!await authorized(req)) return new Response('unauthorized', { status: 401 });
  if (!GELATO_API_KEY) return new Response('missing GELATO_API_KEY', { status: 500 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Universal: read all active products dynamically. Never hardcode IDs.
  const { data: products, error: pErr } = await sb
    .from('dubis_products')
    .select('id, product_id_numeric, clothing_type, gender, colors')
    .eq('active', true)
    .order('product_id_numeric', { ascending: true });
  if (pErr) {
    log('db-error', { error: pErr.message });
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }

  // Pull existing rows to detect transitions (in_stock → OOS, OOS → back)
  const { data: existing } = await sb
    .from('product_variant_stock')
    .select('product_id_numeric, color, size, in_stock, manual_override');
  const existingMap = new Map<string, { in_stock: boolean; manual_override: boolean }>();
  for (const row of (existing || [])) {
    existingMap.set(`${row.product_id_numeric}|${row.color}|${row.size}`,
      { in_stock: row.in_stock, manual_override: row.manual_override });
  }

  log('start', { active_products: products?.length ?? 0 });

  const results: Array<Record<string, unknown>> = [];
  const transitions = { to_oos: 0, back_in_stock: 0, unchanged: 0, skipped_override: 0 };
  let checked = 0;
  let skippedUnmappable = 0;

  // Flatten the (product × color × size) tree into a single work queue so we
  // can run it in parallel batches. Previous serial loop with 150ms sleep ran
  // ~116s on 387 variants — over Edge Function timeout. Parallel-6 brings it
  // to ~22s. Gelato rate limit is ~5 req/s sustained; with 3 calls per variant
  // and 6 in parallel = 18 calls/batch, plus 100ms between batches we stay
  // under their soft limit.
  type Work = { product: any; type: string; rawType: string; color: string; size: string; productUid: string; key: string };
  const queue: Work[] = [];
  for (const product of products || []) {
    const rawType = product.clothing_type as string;
    const type = rawType.replace(/-/g, '');
    const colors = Array.isArray(product.colors) ? product.colors : [];
    const sizes = type === 'cap' ? CAP_SIZES : ALL_SIZES;
    const tplKey = templateKey(type, product.gender);
    if (!TEMPLATES[tplKey]) {
      log('unknown-clothing-type', { product_id: product.product_id_numeric, raw_type: rawType, normalized: type, gender: product.gender });
      continue;
    }
    const colorMap = COLOR_MAP[tplKey] || {};
    for (const color of colors) {
      if (!colorMap[color]) {
        log('unmapped-color', { product_id: product.product_id_numeric, color, type, gender: product.gender });
        skippedUnmappable++;
        continue;
      }
      for (const size of sizes) {
        const productUid = buildProductUid(type, color, size, product.gender);
        if (!productUid) continue;
        const key = `${product.product_id_numeric}|${color}|${size}`;
        // Respect manual override — never queue
        if (existingMap.get(key)?.manual_override) {
          transitions.skipped_override++;
          continue;
        }
        queue.push({ product, type, rawType, color, size, productUid, key });
      }
    }
  }

  async function processOne(w: Work): Promise<void> {
    const result = await checkVariant(w.productUid);
    checked++;
    const prev = existingMap.get(w.key);
    const prevInStock = prev?.in_stock ?? true;
    const newInStock = result.in_stock;
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      product_id_numeric: w.product.product_id_numeric,
      clothing_type: w.rawType,
      color: w.color,
      size: w.size,
      gelato_product_uid: w.productUid,
      in_stock: newInStock,
      stock_source: result.gelato_http === 0 ? 'unknown' : 'gelato-api',
      last_checked_at: nowIso,
      notes: result.reason,
    };
    if (result.cost_us_usd != null) updates.gelato_cost_us_usd = result.cost_us_usd;
    if (result.cost_il_usd != null) updates.gelato_cost_usd    = result.cost_il_usd;  // IL fulfillment cost
    if (result.cost_us_usd != null || result.cost_il_usd != null) updates.cost_synced_at = nowIso;
    if (!newInStock && prevInStock) { updates.last_out_of_stock_at = nowIso; transitions.to_oos++; }
    else if (newInStock && !prevInStock) { updates.last_back_in_stock_at = nowIso; transitions.back_in_stock++; }
    else { transitions.unchanged++; }
    const { error: upErr } = await sb
      .from('product_variant_stock')
      .upsert(updates, { onConflict: 'product_id_numeric,color,size' });
    if (upErr) log('upsert-error', { key: w.key, error: upErr.message });
    results.push({ key: w.key, ...updates, prev_in_stock: prevInStock });
  }

  const BATCH = 6;
  log('queue-built', { variants: queue.length, batches: Math.ceil(queue.length / BATCH) });
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    await Promise.all(batch.map(processOne));
    // 100ms between batches — keeps us under Gelato's ~5 req/s soft limit (6 variants × 3 calls each = 18 calls per ~300ms batch + 100ms wait ≈ 45 calls/sec — well under burst limit but momentary).
    if (i + BATCH < queue.length) await new Promise(r => setTimeout(r, 100));
  }

  // ── Shipping rate probes (US + IL) ──
  // One quote call per country, written to app_config so paypal.js can pass through
  // to the customer at checkout time (no markup, no subsidy). Probe uses a single
  // representative variant — Gelato shipping for shirts/hoodies varies <$2 across
  // SKUs of the same weight tier.
  const shipUs = await probeShippingRate('US', '90210');
  const shipIl = await probeShippingRate('IL', '4365817');
  const nowIso = new Date().toISOString();
  if (shipUs != null) {
    await sb.from('app_config').upsert(
      { key: 'gelato_ship_us_usd', value: String(shipUs), updated_at: nowIso },
      { onConflict: 'key' },
    );
  }
  if (shipIl != null) {
    await sb.from('app_config').upsert(
      { key: 'gelato_ship_il_usd', value: String(shipIl), updated_at: nowIso },
      { onConflict: 'key' },
    );
  }
  log('ship-rates', { us: shipUs, il: shipIl });

  // ── Order-status monitor ── (P0/P1 alerts as agent_tasks)
  let orderMonitor: Awaited<ReturnType<typeof monitorGelatoOrders>> = {
    scanned: 0, with_gelato_id: 0, gelato_unreachable: 0, flags_created: 0, flags_refreshed: 0, flags: [], errors: ['skipped'],
  };
  try {
    orderMonitor = await monitorGelatoOrders(sb);
    log('orders-monitor', {
      scanned: orderMonitor.scanned,
      unreachable: orderMonitor.gelato_unreachable,
      created: orderMonitor.flags_created,
      refreshed: orderMonitor.flags_refreshed,
      errors: orderMonitor.errors.length,
    });
  } catch (err) {
    log('orders-monitor-error', { error: (err as Error).message });
    orderMonitor.errors.push(`exception: ${(err as Error).message}`);
  }

  // Log summary to agent_runs for observability
  await sb.from('agent_runs').insert({
    agent_id: 'gelato-stock-check',
    status: 'completed',
    started_at: new Date(t0).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    summary: `checked=${checked} to_oos=${transitions.to_oos} back_in_stock=${transitions.back_in_stock} unchanged=${transitions.unchanged} overrides=${transitions.skipped_override} unmapped=${skippedUnmappable} ship_us=${shipUs} ship_il=${shipIl} orders_scanned=${orderMonitor.scanned} alerts_created=${orderMonitor.flags_created} alerts_refreshed=${orderMonitor.flags_refreshed}`,
    metadata: {
      transitions,
      skippedUnmappable,
      shipping: { us: shipUs, il: shipIl },
      order_monitor: orderMonitor,
    },
  });

  log('done', { checked, ...transitions, skippedUnmappable, ship_us: shipUs, ship_il: shipIl, alerts: orderMonitor.flags_created, ms: Date.now() - t0 });

  return new Response(JSON.stringify({
    ok: true,
    checked,
    transitions,
    skippedUnmappable,
    shipping: { us: shipUs, il: shipIl },
    order_monitor: orderMonitor,
    duration_ms: Date.now() - t0,
    sample: results.slice(0, 5),
  }), { headers: { 'Content-Type': 'application/json' } });
});
