// SINGLE SOURCE for DESIGN_VERSION.
//
// 2026-09-09: there were THREE copies and all three disagreed —
//   api/create-gelato-order.js  '2026090901'  (what a paying customer's order fetches)
//   scripts/create-gelato-drafts.js  '2026052301'  (what the Gelato DRAFT fetches)
//   scripts/download-gelato-mockups.js  '2026062101'  (what the SITE MOCKUP fetches)
// Gelato caches design files by URL, so the stale scripts kept pulling May/June
// artwork while orders pulled September artwork. That is exactly the mockup/print
// parity break checkout-guardrails.md §1b exists to prevent: the customer saw one
// thing and would have received another. It also masked the print fix — the pilot
// draft for product 54 rendered the OLD broken file because the URL was unchanged.
//
// api/create-gelato-order.js is the source of truth (it is what real orders use).
// Do NOT add a fourth literal. Import this.
const fs = require('fs');
const path = require('path');

function readDesignVersion() {
  if (process.env.DESIGN_VERSION) return process.env.DESIGN_VERSION;
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'create-gelato-order.js'), 'utf8');
  const m = src.match(/const\s+DESIGN_VERSION\s*=\s*process\.env\.DESIGN_VERSION\s*\|\|\s*'([^']+)'/);
  if (!m) throw new Error('DESIGN_VERSION not found in api/create-gelato-order.js — refusing to guess');
  return m[1];
}

module.exports = { DESIGN_VERSION: readDesignVersion() };
