// DUBIS — Order-splitting helper
// =====================================================================
// 2026-05-21: solves the "Gelato can't fulfill all items from one
// warehouse" failure mode by splitting a cart into N sub-carts, each
// fulfillable from a single warehouse via /v4/orders:quote.
//
// The single-warehouse limitation is a Gelato API design choice (one
// /v4/orders POST → one warehouse → one shipment). When a customer's
// cart needs items from two warehouses, our previous code would refuse
// the whole order. This module lets us submit N separate Gelato orders
// behind a SINGLE PayPal capture so the customer sees one order /
// pays one shipping fee, but Gelato gets the orders it needs.
//
// Public surface:
//   splitCartByWarehouse({ cartItems, recipient, gelatoApiKey, fileUrl })
//     → Promise<{
//         splittable: boolean,
//         subCarts: Array<{ items: CartItem[], country: string, quoteId: string }>,
//         unfulfillable: CartItem[],   // items no warehouse can produce
//         attempts: number,
//         reason: string|null,
//       }>
//
// Algorithm: peeling. Quote the full cart → if partial-OOS, peel off the
// items the chosen warehouse couldn't produce (quote.products[i].price=0)
// into a new sub-cart, re-quote the remainder → recurse. Cap at 5 splits
// to prevent runaway loops on truly broken catalogs.
// =====================================================================

const MAX_SPLITS = 5;     // hard cap — if we can't fulfill in 5 sub-orders, give up
const QUOTE_TIMEOUT_MS = 20_000;

function olog(stage, data = {}) {
  try { console.log(`[DUBIS-SPLIT] ${stage} ${JSON.stringify(data)}`); }
  catch { console.log(`[DUBIS-SPLIT] ${stage} <unserializable>`); }
}

/**
 * Quote a single sub-cart against Gelato.
 *
 * @param {object} args
 * @param {string} args.gelatoApiKey
 * @param {object} args.recipient            (already in Gelato shape)
 * @param {Array<{uid, item, fileUrl}>} args.entries   resolved cart entries
 * @returns {Promise<{ok: boolean, country: string|null, quoteId: string|null, oosUids: string[], reason: string|null, raw: any}>}
 */
async function quoteSubCart({ gelatoApiKey, recipient, entries, label }) {
  if (entries.length === 0) return { ok: true, country: null, quoteId: null, oosUids: [], reason: 'empty_subcart', raw: null };

  const body = {
    orderReferenceId: `dubis-split-${label}-${Date.now()}`,
    currency: 'USD',
    recipient,
    products: entries.map((e, i) => ({
      itemReferenceId: `i${i}`,
      productUid: e.uid,
      quantity: 1,
      fileUrl: e.fileUrl,
    })),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUOTE_TIMEOUT_MS);
  let res, data;
  try {
    res = await fetch('https://order.gelatoapis.com/v4/orders:quote', {
      method:  'POST',
      headers: { 'X-API-KEY': gelatoApiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
    data = await res.json().catch(() => null);
  } catch (err) {
    return { ok: false, country: null, quoteId: null, oosUids: [], reason: `fetch_${err.message || 'error'}`, raw: null };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return { ok: false, country: null, quoteId: null, oosUids: [], reason: `http_${res.status}`, raw: data };
  }
  if (data && data.refusalReasonCode) {
    return { ok: false, country: null, quoteId: null, oosUids: [], reason: `refused_${data.refusalReasonCode}`, raw: data };
  }
  const quotes = (data && Array.isArray(data.quotes)) ? data.quotes : [];
  if (quotes.length === 0) {
    return { ok: false, country: null, quoteId: null, oosUids: [], reason: 'no_quotes', raw: data };
  }
  const q = quotes[0];

  // Detect partial-OOS via the TWO Gelato signals (see checkout-guardrails.md rule 2c):
  //   1. quote.shipmentMethods[].shipmentMethodUid === 'api_out_of_stock_for_part_order'
  //   2. quote.products[i].price === 0
  const partialFlag = (q.shipmentMethods || []).some(s => s.shipmentMethodUid === 'api_out_of_stock_for_part_order');
  const zeroProducts = (q.products || []).filter(p => typeof p.price === 'number' && p.price === 0);

  if (partialFlag || zeroProducts.length > 0) {
    // Map back from quote.products[i].productUid to our cart-entry uids
    // so the caller knows WHICH items to peel off into the next sub-cart.
    const oosUids = zeroProducts.map(p => p.productUid).filter(Boolean);
    // If we have a partial flag but NO price=0 items (rare — some catalogs only
    // signal at the shipment level), we can't narrow down. The caller will need
    // to fall back to solo-probing each item.
    return {
      ok: false,
      country: q.fulfillmentCountry || null,
      quoteId: q.id || null,
      oosUids,
      reason: oosUids.length > 0 ? 'partial_oos' : 'partial_oos_unidentified',
      raw: data,
    };
  }
  // All clear.
  return {
    ok: true,
    country: q.fulfillmentCountry || null,
    quoteId: q.id || null,
    oosUids: [],
    reason: null,
    raw: data,
  };
}

/**
 * Split a cart into N sub-carts each fulfillable from a single Gelato warehouse.
 *
 * @param {object} args
 * @param {Array<object>} args.entries     Pre-resolved cart entries [{uid, item, fileUrl}]
 *                                         (caller resolves the productUid via buildProductUid
 *                                         and picks the design fileUrl beforehand)
 * @param {object} args.recipient          Gelato-shaped recipient
 * @param {string} args.gelatoApiKey
 * @returns {Promise<object>}
 */
async function splitCartByWarehouse({ entries, recipient, gelatoApiKey }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { splittable: true, subCarts: [], unfulfillable: [], attempts: 0, reason: 'empty_cart' };
  }
  if (!gelatoApiKey) {
    return { splittable: false, subCarts: [], unfulfillable: [], attempts: 0, reason: 'no_api_key' };
  }

  // working set of remaining-to-fulfill entries
  let remaining = [...entries];
  const subCarts = [];
  const unfulfillable = [];
  let attempts = 0;

  while (remaining.length > 0 && attempts < MAX_SPLITS) {
    attempts++;
    const label = `try${attempts}`;
    olog('quote-subcart', { attempt: attempts, size: remaining.length, uids: remaining.map(e => e.uid) });
    const result = await quoteSubCart({ gelatoApiKey, recipient, entries: remaining, label });

    if (result.ok) {
      // This sub-cart ships clean → add it to the plan, done.
      subCarts.push({
        items: remaining.map(e => e.item),
        entries: remaining,
        country: result.country,
        quoteId: result.quoteId,
      });
      olog('subcart-clean', { attempt: attempts, country: result.country, size: remaining.length });
      remaining = [];
      break;
    }

    // 2026-05-21: `partial_oos_unidentified` — Gelato signaled at the shipment
    // level only (no per-product price=0). Fall back to solo-probes to discover
    // each item's natural warehouse, then group by country. Items routing to a
    // DIFFERENT country than the chosen combined-cart country are the minority.
    if (result.reason === 'partial_oos_unidentified' && remaining.length > 1) {
      olog('solo-probe-fallback', { attempt: attempts, size: remaining.length });
      const chosenCountry = result.country;
      const soloResults = await Promise.all(remaining.map(async (e) => {
        const r = await quoteSubCart({ gelatoApiKey, recipient, entries: [e], label: `solo-${attempts}` });
        return { entry: e, country: r.country, ok: r.ok, reason: r.reason };
      }));
      // Group entries by their solo fulfillmentCountry. The largest group is
      // the "natural" warehouse for this cart; smaller groups are minorities.
      const byCountry = new Map();
      const trulyUnfulfillable = [];
      for (const sr of soloResults) {
        if (!sr.ok) { trulyUnfulfillable.push(sr.entry); continue; }
        const k = sr.country || 'unknown';
        if (!byCountry.has(k)) byCountry.set(k, []);
        byCountry.get(k).push(sr.entry);
      }
      if (trulyUnfulfillable.length > 0) {
        unfulfillable.push(...trulyUnfulfillable);
      }
      // If everyone routes to the same country, the original quote was wrong.
      // Try the original cart one more time below — unlikely path but bail safe.
      if (byCountry.size === 0) {
        olog('solo-probe-no-groups', { attempt: attempts });
        remaining = [];
        break;
      }
      // Confirm each group with a real multi-item quote (solo-probe success
      // doesn't guarantee the group together still ships from the same warehouse,
      // though it's nearly always the case).
      const groups = Array.from(byCountry.values());
      olog('solo-probe-groups', { attempt: attempts, groups: groups.map(g => g.length) });
      let allGroupsClean = true;
      for (const g of groups) {
        if (g.length === 1) {
          // Single-item groups already confirmed via solo probe.
          subCarts.push({ items: g.map(e => e.item), entries: g, country: byCountry.size === 1 ? chosenCountry : (soloResults.find(sr => sr.entry === g[0])?.country), quoteId: null });
          continue;
        }
        const groupRes = await quoteSubCart({ gelatoApiKey, recipient, entries: g, label: `group-${attempts}` });
        if (groupRes.ok) {
          subCarts.push({ items: g.map(e => e.item), entries: g, country: groupRes.country, quoteId: groupRes.quoteId });
        } else {
          // Even the group together fails → peel the items individually.
          allGroupsClean = false;
          for (const e of g) subCarts.push({ items: [e.item], entries: [e], country: null, quoteId: null });
        }
      }
      remaining = [];   // we either grouped them or marked unfulfillable
      olog('solo-probe-done', { attempt: attempts, subCarts: subCarts.length, unfulfillable: unfulfillable.length });
      break;
    }

    if (result.reason === 'partial_oos' && result.oosUids.length > 0) {
      // Peel: keep the items the chosen warehouse CAN make in a sub-cart,
      // push the OOS items back into the queue for the next iteration.
      const oosSet = new Set(result.oosUids);
      const fulfillable = remaining.filter(e => !oosSet.has(e.uid));
      const peeled      = remaining.filter(e =>  oosSet.has(e.uid));
      if (fulfillable.length === 0) {
        // The chosen warehouse can't make ANY of the remaining items → these
        // items aren't fulfillable as a group. Mark unfulfillable, stop.
        unfulfillable.push(...remaining);
        olog('peel-empty-fulfillable', { attempt: attempts, peeled: peeled.length });
        remaining = [];
        break;
      }
      // Quote the fulfillable subset alone to LOCK IN that sub-order's warehouse
      // (Gelato re-routes per quote — we need a clean quote for THIS subset only
      // before we commit to splitting).
      const reQuote = await quoteSubCart({ gelatoApiKey, recipient, entries: fulfillable, label: `${label}-confirm` });
      if (!reQuote.ok) {
        // Even the "fulfillable" subset failed standalone — fall back to peeling
        // one more layer using the new oosUids. Stash these for next iteration.
        olog('subset-requote-failed', { attempt: attempts, reason: reQuote.reason });
        remaining = [...fulfillable, ...peeled];
        // Bail to avoid loops if nothing improved
        if (attempts >= MAX_SPLITS - 1) {
          unfulfillable.push(...remaining);
          remaining = [];
          break;
        }
        continue;
      }
      subCarts.push({
        items: fulfillable.map(e => e.item),
        entries: fulfillable,
        country: reQuote.country,
        quoteId: reQuote.quoteId,
      });
      remaining = peeled;
      olog('peeled', { attempt: attempts, kept: fulfillable.length, peeled: peeled.length, warehouse: reQuote.country });
      continue;
    }

    // Other refusal codes (refused_*, no_quotes, http_*, partial_oos_unidentified)
    // → mark everything remaining as unfulfillable.
    unfulfillable.push(...remaining);
    olog('hard-refusal', { attempt: attempts, reason: result.reason });
    remaining = [];
    break;
  }

  // If we exhausted attempts but still have remainder, mark unfulfillable.
  if (remaining.length > 0) {
    unfulfillable.push(...remaining);
  }

  return {
    splittable: subCarts.length > 0 && unfulfillable.length === 0,
    subCarts,
    unfulfillable,
    attempts,
    reason: unfulfillable.length > 0 ? 'some_items_unfulfillable' : null,
  };
}

module.exports = {
  splitCartByWarehouse,
  quoteSubCart,
};
