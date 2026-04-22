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

// Mirror of COLOR_MAP in api/create-gelato-order.js.
// MUST stay in sync — consider promoting to a shared module next iteration.
const COLOR_MAP: Record<string, Record<string, string>> = {
  tshirt: {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Charcoal': 'charcoal',
    'Navy': 'navy', 'Gray': 'sports-grey', 'Red': 'red', 'Forest Green': 'forest',
  },
  hoodie: {
    'Black': 'black', 'White': 'white', 'Cream': 'sand', 'Charcoal': 'dark-heather',
    'Navy': 'navy', 'Gray': 'sports-grey', 'Forest Green': 'forest',
  },
  ziphoodie: {
    'Black': 'black', 'White': 'white', 'Charcoal': 'dark-heather', 'Navy': 'navy',
  },
  longsleeve: {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Navy': 'navy',
    'Forest Green': 'forest', 'Gray': 'sports-grey',
  },
  cap: {
    'Black': 'black', 'White': 'white', 'Cream': 'natural', 'Charcoal': 'dark-heather',
    'Navy': 'navy', 'Gray': 'sports-grey',
  },
};

const SIZE_MAP: Record<string, string> = {
  'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': '2xl', '3XL': '3xl', 'One Size': 'os',
};

function buildProductUid(type: string, gelatoColor: string, gelatoSize: string, gender = 'unisex'): string | null {
  const genderCode = gender === 'women' ? 'women' : 'unisex';
  if (type === 'tshirt') {
    return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'hoodie') {
    return `apparel_product_gca_hoodie_gsc_pullover_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'ziphoodie') {
    return `apparel_product_gca_hoodie_gsc_zip_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'longsleeve') {
    return `apparel_product_gca_long-sleeve_gsc_crewneck_gcu_${genderCode}_gqa_classic_gsi_${gelatoSize}_gco_${gelatoColor}_gpr_4-4`;
  }
  if (type === 'cap') {
    return `apparel_product_gca_dad-hat_gsc_classic_gcu_unisex_gqa_classic_gsi_os_gco_${gelatoColor}_gpr_4-0`;
  }
  return null;
}

type CheckResult = {
  in_stock: boolean;
  gelato_http: number;
  reason: string;
};

// Query Gelato for a single productUid's availability.
// Returns in_stock=true unless Gelato explicitly reports unavailable / 404.
async function checkVariant(productUid: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${GELATO_API_BASE}/products/${productUid}`, {
      headers: { 'X-API-KEY': GELATO_API_KEY, 'Accept': 'application/json' },
    });
    if (res.status === 404) {
      return { in_stock: false, gelato_http: 404, reason: 'not-in-catalog' };
    }
    if (!res.ok) {
      // Any non-404 non-2xx: conservative — keep previous state, mark source=unknown
      return { in_stock: true, gelato_http: res.status, reason: `http-${res.status}-keep-previous` };
    }
    const body = await res.json().catch(() => ({})) as any;
    // Gelato product endpoint historically returns productUid if it exists.
    // If the API surfaces an "availability" or "disabled" field, honor it.
    if (body?.disabled === true) {
      return { in_stock: false, gelato_http: 200, reason: 'disabled' };
    }
    if (typeof body?.availability === 'string' && /out/i.test(body.availability)) {
      return { in_stock: false, gelato_http: 200, reason: body.availability };
    }
    if (Array.isArray(body?.productVariantOptions) && body.productVariantOptions.length === 0) {
      return { in_stock: false, gelato_http: 200, reason: 'no-variants' };
    }
    // Default: variant exists and nothing flags it unavailable
    return { in_stock: true, gelato_http: 200, reason: 'ok' };
  } catch (err) {
    return { in_stock: true, gelato_http: 0, reason: `fetch-error:${(err as Error).message}` };
  }
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

  for (const product of products || []) {
    // DB stores hyphenated types ('t-shirt', 'zip-hoodie', 'long-sleeve').
    // COLOR_MAP + buildProductUid use non-hyphenated keys ('tshirt', 'ziphoodie', 'longsleeve').
    // Normalize once so we match products regardless of how they were stored.
    const rawType = product.clothing_type as string;
    const type = rawType.replace(/-/g, '');
    const colors = Array.isArray(product.colors) ? product.colors : [];
    const sizes = type === 'cap' ? CAP_SIZES : ALL_SIZES;
    const colorMap = COLOR_MAP[type as keyof typeof COLOR_MAP];
    if (!colorMap) {
      log('unknown-clothing-type', { product_id: product.product_id_numeric, raw_type: rawType, normalized: type });
      continue;
    }

    for (const color of colors) {
      const gelatoColor = colorMap[color];
      if (!gelatoColor) {
        // Site label has no Gelato mapping — should be impossible if add-product gates are honored.
        log('unmapped-color', { product_id: product.product_id_numeric, color, type });
        skippedUnmappable++;
        continue;
      }
      for (const size of sizes) {
        const gelatoSize = SIZE_MAP[size];
        if (!gelatoSize) continue;
        const productUid = buildProductUid(type, gelatoColor, gelatoSize, product.gender);
        if (!productUid) continue;

        const key = `${product.product_id_numeric}|${color}|${size}`;
        const prev = existingMap.get(key);

        // Respect manual override — never overwrite
        if (prev?.manual_override) {
          transitions.skipped_override++;
          continue;
        }

        const result = await checkVariant(productUid);
        checked++;

        const prevInStock = prev?.in_stock ?? true;  // assume in-stock if no prior row
        const newInStock = result.in_stock;

        const nowIso = new Date().toISOString();
        const updates: Record<string, unknown> = {
          product_id_numeric: product.product_id_numeric,
          clothing_type: rawType,      // preserve original hyphenated DB value
          color,
          size,
          gelato_product_uid: productUid,
          in_stock: newInStock,
          stock_source: result.gelato_http === 0 ? 'unknown' : 'gelato-api',
          last_checked_at: nowIso,
          notes: result.reason,
        };
        if (!newInStock && prevInStock) {
          updates.last_out_of_stock_at = nowIso;
          transitions.to_oos++;
        } else if (newInStock && !prevInStock) {
          updates.last_back_in_stock_at = nowIso;
          transitions.back_in_stock++;
        } else {
          transitions.unchanged++;
        }

        const { error: upErr } = await sb
          .from('product_variant_stock')
          .upsert(updates, { onConflict: 'product_id_numeric,color,size' });
        if (upErr) log('upsert-error', { key, error: upErr.message });

        results.push({ key, ...updates, prev_in_stock: prevInStock });

        // Gentle pacing — Gelato rate-limits. 150ms between calls.
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }

  // Log summary to agent_runs for observability
  await sb.from('agent_runs').insert({
    agent_id: 'gelato-stock-check',
    status: 'completed',
    started_at: new Date(t0).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    summary: `checked=${checked} to_oos=${transitions.to_oos} back_in_stock=${transitions.back_in_stock} unchanged=${transitions.unchanged} overrides=${transitions.skipped_override} unmapped=${skippedUnmappable}`,
    metadata: { transitions, skippedUnmappable },
  });

  log('done', { checked, ...transitions, skippedUnmappable, ms: Date.now() - t0 });

  return new Response(JSON.stringify({
    ok: true,
    checked,
    transitions,
    skippedUnmappable,
    duration_ms: Date.now() - t0,
    sample: results.slice(0, 5),
  }), { headers: { 'Content-Type': 'application/json' } });
});
