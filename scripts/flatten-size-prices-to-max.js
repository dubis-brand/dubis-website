#!/usr/bin/env node
/**
 * flatten-size-prices-to-max.js
 *
 * Per oren directive 2026-06-10: every size/color variant of a product must
 * cost the SAME — the highest price among that product's variants. No customer
 * should see a cheaper size; we level UP, never down.
 *
 * Target price per product:
 *   1. max(sell_price_usd) over the product's variants, counting only real (>0) prices.
 *   2. If the product has NO real priced variant (all $0/null), fall back to the
 *      peer max of the same clothing_type (among products that DO have real prices).
 *   3. If still none → skip + report (never invent a $0 or free price).
 *
 * Writes (only with --write):
 *   - product_variant_stock.sell_price_usd = target  (per product, one PATCH)
 *     + price_set_by / price_set_at stamped.
 *   - dubis_products.price_usd = target              (base / catalog-card price)
 *
 * SAFETY: never writes a target <= 0. Dry-run by default.
 *
 * Usage:
 *   node scripts/flatten-size-prices-to-max.js          # dry-run
 *   node scripts/flatten-size-prices-to-max.js --write  # apply
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const WRITE = process.argv.includes('--write');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env'); process.exit(2); }

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const JH = { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

async function getJSON(pathQ) {
  const r = await fetch(`${SUPABASE_URL}${pathQ}`, { headers: H });
  const j = await r.json();
  if (!r.ok) throw new Error(`GET ${pathQ} → ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function patch(pathQ, body) {
  const r = await fetch(`${SUPABASE_URL}${pathQ}`, { method: 'PATCH', headers: JH, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`PATCH ${pathQ} → ${r.status}: ${t}`); }
  return true;
}

async function main() {
  const products = await getJSON('/rest/v1/dubis_products?select=id,product_id_numeric,slogan,clothing_type,price_usd,active');
  const variants = await getJSON('/rest/v1/product_variant_stock?select=id,product_id_numeric,color,size,sell_price_usd&limit=10000');
  const overrides = await getJSON('/rest/v1/product_prices?select=product_id,selling_price');
  const overrideByPid = {};
  for (const o of overrides) overrideByPid[o.product_id] = Number(o.selling_price);

  const pidOf = (p) => (p.product_id_numeric != null ? p.product_id_numeric : p.id);

  // group variants by pid
  const byPid = {};
  for (const v of variants) (byPid[v.product_id_numeric] = byPid[v.product_id_numeric] || []).push(v);

  // real (>0) max per pid
  const realMax = {};
  for (const [pid, rows] of Object.entries(byPid)) {
    const real = rows.map(r => Number(r.sell_price_usd)).filter(n => Number.isFinite(n) && n > 0);
    if (real.length) realMax[pid] = Math.max(...real);
  }
  // type peer-max (priced only)
  const typeMax = {};
  for (const p of products) {
    const m = realMax[pidOf(p)];
    if (m > 0) typeMax[p.clothing_type] = Math.max(typeMax[p.clothing_type] || 0, m);
  }
  // Cross-type peer fallback for types that have no same-type priced sibling.
  // e.g. an embroidered cap ('cap-emb') borrows the plain cap price. (oren 2026-06-10)
  const PEER_TYPE_FALLBACK = { 'cap-emb': 'cap' };
  for (const [type, fallback] of Object.entries(PEER_TYPE_FALLBACK)) {
    if (!(typeMax[type] > 0) && typeMax[fallback] > 0) typeMax[type] = typeMax[fallback];
  }

  const plan = [];
  const skipped = [];
  for (const p of products) {
    const pid = pidOf(p);
    const rows = byPid[pid] || [];
    let target = realMax[pid];
    let source = 'own-max';
    if (!(target > 0)) { target = typeMax[p.clothing_type]; source = `peer-max(${p.clothing_type})`; }
    if (!(target > 0)) { skipped.push({ pid, slogan: p.slogan, reason: 'no own price and no peer' }); continue; }

    const variantsToChange = rows.filter(r => Number(r.sell_price_usd) !== target).length;
    const baseChange = Number(p.price_usd) !== target;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrideByPid, pid);
    const overrideChange = hasOverride && overrideByPid[pid] !== target;
    if (variantsToChange === 0 && !baseChange && !overrideChange) continue; // already uniform everywhere
    plan.push({ id: p.id, pid, slogan: p.slogan, type: p.clothing_type, active: p.active,
                oldBase: p.price_usd, oldOverride: hasOverride ? overrideByPid[pid] : null,
                target, source, variantsTotal: rows.length, variantsToChange, baseChange, overrideChange });
  }

  // report
  console.log(`\nMode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`Products needing change: ${plan.length}   |   Skipped (unpriceable): ${skipped.length}\n`);
  console.log('PID  active  type         base$  ->  target$   varRows(change/total)   src');
  console.log('-'.repeat(92));
  let totalVarWrites = 0;
  for (const x of plan) {
    totalVarWrites += x.variantsToChange;
    console.log(
      `#${String(x.pid).padEnd(3)} ${String(x.active).padEnd(6)} ${String(x.type).padEnd(12)} `
      + `${String('$'+x.oldBase).padStart(5)}  -> ${String('$'+x.target).padStart(6)}   `
      + `${String(x.variantsToChange+'/'+x.variantsTotal).padStart(8)}             ${x.source}   "${x.slogan}"`
    );
  }
  console.log('-'.repeat(92));
  console.log(`Variant rows to raise: ${totalVarWrites}   |   Base prices to update: ${plan.filter(p=>p.baseChange).length}`);
  if (skipped.length) {
    console.log('\nSKIPPED (no price anywhere — handle manually):');
    for (const s of skipped) console.log(`  #${s.pid} "${s.slogan}" — ${s.reason}`);
  }

  if (!WRITE) { console.log('\nDry-run only. Re-run with --write to apply.'); return; }

  const stamp = new Date().toISOString();
  console.log('\nApplying...');
  let ok = 0;
  for (const x of plan) {
    // one PATCH levels every variant of the product to target (idempotent).
    // Only products with an INTEGER product_id_numeric have variant rows;
    // UUID-pid legacy rows have none, so skip the (type-mismatched) variant PATCH.
    const numericPid = Number.isInteger(Number(x.pid)) && !String(x.pid).includes('-');
    if (numericPid && x.variantsTotal > 0) {
      await patch(`/rest/v1/product_variant_stock?product_id_numeric=eq.${x.pid}`,
        { sell_price_usd: x.target, price_set_by: 'flatten-to-max-2026-06-10', price_set_at: stamp });
    }
    await patch(`/rest/v1/dubis_products?id=eq.${x.id}`, { price_usd: x.target });
    // product_prices.selling_price is the LEGACY override that loadPriceOverrides()
    // applies on top of products.js at runtime — it drives the displayed card/modal
    // base price. Must be levelled too or the card shows a stale (lower) price while
    // the cart charges the higher variant price. PATCH only touches existing rows.
    if (numericPid) {
      await patch(`/rest/v1/product_prices?product_id=eq.${x.pid}`,
        { selling_price: x.target, updated_at: stamp });
    }
    ok++;
    console.log(`  ✓ #${x.pid} → $${x.target}${numericPid && x.variantsTotal ? '' : ' (base only)'}`);
  }
  console.log(`\nDone. ${ok}/${plan.length} products updated.`);
}
main().catch(e => { console.error(e); process.exit(1); });
