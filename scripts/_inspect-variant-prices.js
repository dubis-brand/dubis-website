#!/usr/bin/env node
/**
 * _inspect-variant-prices.js  (read-only)
 *
 * Dumps per-product price variance from product_variant_stock.sell_price_usd
 * vs dubis_products.price, so we can decide how to flatten size pricing to the
 * highest price per product. NO WRITES.
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env'); process.exit(2); }

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function main() {
  // base prices — note the variant table keys on product_id_numeric
  const prodRes = await fetch(`${SUPABASE_URL}/rest/v1/dubis_products?select=id,product_id_numeric,slogan,price_usd,active`, { headers: H });
  const products = await prodRes.json();
  if (!Array.isArray(products)) { console.error('products query failed:', products); process.exit(1); }
  const baseById = {};
  for (const p of products) {
    const key = p.product_id_numeric != null ? p.product_id_numeric : p.id;
    baseById[key] = { id: p.id, phrase: p.slogan, price: p.price_usd, active: p.active };
  }

  // all variant rows
  const vRes = await fetch(`${SUPABASE_URL}/rest/v1/product_variant_stock?select=product_id_numeric,color,size,sell_price_usd,in_stock&limit=10000`, { headers: H });
  const variants = await vRes.json();
  if (!Array.isArray(variants)) { console.error('variant query failed:', variants); process.exit(1); }

  console.log(`Total variant rows: ${variants.length}`);
  console.log(`Total products: ${products.length}\n`);

  // group by product
  const byProd = {};
  for (const v of variants) {
    const pid = v.product_id_numeric;
    (byProd[pid] = byProd[pid] || []).push(v);
  }

  let productsWithVariance = 0;
  let rowsThatWouldChange = 0;
  const report = [];

  const pids = Object.keys(byProd).map(Number).sort((a,b)=>a-b);
  for (const pid of pids) {
    const rows = byProd[pid];
    const base = baseById[pid];
    const prices = rows.map(r => Number(r.sell_price_usd)).filter(n => Number.isFinite(n));
    if (!prices.length) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const distinct = [...new Set(prices)].sort((a,b)=>a-b);
    const belowMax = rows.filter(r => Number.isFinite(Number(r.sell_price_usd)) && Number(r.sell_price_usd) < max);
    if (distinct.length > 1) {
      productsWithVariance++;
      rowsThatWouldChange += belowMax.length;
      // per-size breakdown (collapse across colors): size -> set of prices
      const bySize = {};
      for (const r of rows) {
        const sp = Number(r.sell_price_usd);
        if (!Number.isFinite(sp)) continue;
        (bySize[r.size] = bySize[r.size] || new Set()).add(sp);
      }
      const sizeStr = Object.entries(bySize)
        .map(([s, set]) => `${s}:${[...set].sort((a,b)=>a-b).join('/')}`)
        .join('  ');
      report.push({
        pid,
        phrase: base ? base.phrase : '(missing in dubis_products)',
        base: base ? base.price : null,
        min, max, distinct: distinct.join(', '),
        rows: rows.length, willRaise: belowMax.length,
        sizeStr
      });
    }
  }

  console.log(`Products WITH price variance: ${productsWithVariance}`);
  console.log(`Variant rows that would be RAISED to product-max: ${rowsThatWouldChange}\n`);
  console.log('='.repeat(100));
  for (const r of report) {
    console.log(`#${r.pid}  "${r.phrase}"  base=$${r.base}`);
    console.log(`    prices: [${r.distinct}]  → flatten all to $${r.max}   (raising ${r.willRaise}/${r.rows} rows)`);
    console.log(`    by size: ${r.sizeStr}`);
    console.log('-'.repeat(100));
  }

  // also flag products where base price != max (catalog card / fallback mismatch)
  console.log('\nBASE-PRICE vs VARIANT-MAX mismatches (informational):');
  for (const pid of pids) {
    const rows = byProd[pid];
    const base = baseById[pid];
    if (!base) continue;
    const prices = rows.map(r => Number(r.sell_price_usd)).filter(Number.isFinite);
    if (!prices.length) continue;
    const max = Math.max(...prices);
    if (Number(base.price) !== max) {
      console.log(`    #${pid} "${base.phrase}": base=$${base.price}  variant-max=$${max}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
