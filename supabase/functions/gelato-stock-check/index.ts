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
    // TEMPLATES + buildProductUid use non-hyphenated keys ('tshirt', 'ziphoodie', 'longsleeve').
    // Normalize once so we match products regardless of how they were stored.
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
        // Site label has no Gelato mapping — should be impossible if add-product gates are honored.
        log('unmapped-color', { product_id: product.product_id_numeric, color, type, gender: product.gender });
        skippedUnmappable++;
        continue;
      }
      for (const size of sizes) {
        const productUid = buildProductUid(type, color, size, product.gender);
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
