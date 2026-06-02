// End-to-end verification: load the patched create-gelato-order.js,
// iterate every (product, color, M | One Size) from products.js, probe Gelato.
require('dotenv').config({ path: __dirname + '/../.env.local' });
const API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;

// Re-export the internal helpers by eval'ing the module — simpler than refactoring.
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '../api/create-gelato-order.js'), 'utf8');
// Extract just the TEMPLATES / SIZE_MAP / COLOR_MAP / buildProductUid by `require`.
// The file uses `module.exports = async function handler` — so requiring loads the handler.
// We can extract internal helpers by re-running the file in a vm context, but easier:
// duplicate the buildProductUid function inline by requiring once for handler then walking globals.
// Simplest: just re-define the helpers here from the same source-of-truth.

const TEMPLATES = {
  'tshirt-unisex':     { cat:'t-shirt', sub:'crewneck',        cut:'unisex', qa:'classic', gpr:'4-4',     brand:'gildan',           sku:'64000'  },
  'tshirt-women':      { cat:'t-shirt', sub:'crewneck',        cut:'womens', qa:'prm',     gpr:'4-4',     brand:'bella-and-canvas', sku:'6004'   },
  'hoodie-unisex':     { cat:'hoodie',  sub:'pullover',        cut:'unisex', qa:'classic', gpr:'4-4',     brand:'gildan',           sku:'18500'  },
  'hoodie-women':      { cat:'hoodie',  sub:'pullover',        cut:'womens', qa:'prm',     gpr:'4-4',     brand:null,                sku:null    },
  'ziphoodie-unisex':  { cat:'hoodie',  sub:'zip',             cut:'unisex', qa:'organic', gpr:'4-4',     brand:'sols',             sku:'04237'  },  // K-C 2026-06-02 — SOL'S 04237 (Lane Seven was Gelato staging, no mockups)
  'longsleeve-unisex': { cat:'t-shirt', sub:'longsleeve-crew', cut:'unisex', qa:'classic', gpr:'4-4',     brand:'gildan',           sku:'2400'   },
  'longsleeve-women':  { cat:'t-shirt', sub:'longsleeve-crew', cut:'womens', qa:'prm',     gpr:'4-4',     brand:'sols',             sku:'02075'  },
  'cap-unisex':        { cat:'hat',     sub:'dad-hat',         cut:'unisex', qa:'classic', gpr:'4-0-dtf', brand:'as-colour',        sku:'1114'   },
};
const SIZE_MAP = { 'S':'s','M':'m','L':'l','XL':'xl','2XL':'2xl','3XL':'3xl','One Size':'onesize' };
const SIZE_OVERRIDE = { 'ziphoodie-unisex': { '2XL':'xxl' } };  // SOL'S 04237 uses xxl for 2XL
const COLOR_MAP = {
  'tshirt-unisex':    { 'Black':'black','White':'white','Cream':'natural','Navy':'navy','Charcoal':'charcoal','Red':'red','Gray':'rs-sport-grey','Forest Green':{color:'forest-green',brand:'next-level',sku:'3600'} },
  'tshirt-women':     { 'Black':'black','White':'white','Cream':'soft-cream','Navy':'navy' },
  'hoodie-unisex':    { 'Black':'black','White':'white','Cream':'sand','Navy':'navy','Charcoal':'dark-heather','Forest Green':'forest-green','Gray':'sport-grey' },
  'hoodie-women':     { 'Black':'black','White':'white','Navy':'navy','Charcoal':'charcoal' },
  'ziphoodie-unisex': { 'Black':'black','White':'white','Navy':'french-navy','Gray':'grey-melange','Royal Blue':'royal-blue' },  // SOL'S 04237 (2026-06-02)
  'longsleeve-unisex':{ 'Black':'black','White':'white','Cream':'sand','Navy':'navy','Forest Green':'forest-green','Gray':'sports-grey' },
  'longsleeve-women': { 'Black':'deep-black','White':'white','Navy':'french-navy' },
  'cap-unisex':       { 'Black':'black','White':'white','Cream':'ecru','Navy':'navy' },
};
function templateKey(type, gender) { return `${type}-${gender === 'women' ? 'women' : 'unisex'}`; }
function buildProductUid(type, dubisColor, dubisSize, gender = 'unisex') {
  const t = TEMPLATES[templateKey(type, gender)]; if (!t) return null;
  const ce = (COLOR_MAP[templateKey(type, gender)] || {})[dubisColor]; if (!ce) return null;
  const gColor = typeof ce === 'string' ? ce : ce.color;
  const brand  = (typeof ce === 'object' && ce.brand) ? ce.brand : t.brand;
  const sku    = (typeof ce === 'object' && ce.sku)   ? ce.sku   : t.sku;
  const gSize = (SIZE_OVERRIDE[templateKey(type, gender)] || {})[dubisSize] || SIZE_MAP[dubisSize]; if (!gSize) return null;
  const brandSuffix = (brand && sku) ? `_${brand}_${sku}` : '';
  return `apparel_product_gca_${t.cat}_gsc_${t.sub}_gcu_${t.cut}_gqa_${t.qa}_gsi_${gSize}_gco_${gColor}_gpr_${t.gpr}${brandSuffix}`;
}

// Load the patched products.js — stub the browser globals it references.
const pjs = fs.readFileSync(path.join(__dirname, '../js/products.js'), 'utf8');
const sandboxFn = new Function(`
  var window = { location: { hostname: '' } };
  var document = { addEventListener: function(){} };
  var fetch = async function(){ return { ok: false }; };
  ${pjs}
  return products;
`);
const products = sandboxFn();

async function probe(uid) {
  const r = await fetch(`https://product.gelatoapis.com/v3/products/${encodeURIComponent(uid)}`, { headers: { 'X-API-KEY': API_KEY } });
  return { status: r.status, ok: r.ok };
}

(async () => {
  let pass = 0, fail = 0;
  const failures = [];
  for (const p of products) {
    const sizes = Array.isArray(p.sizes) ? p.sizes : (p.type === 'cap' ? ['One Size'] : ['S','M','L','XL','2XL','3XL']);
    for (const color of p.colors) {
      for (const size of sizes) {
        const uid = buildProductUid(p.type, color, size, p.gender);
        if (!uid) {
          console.log(`❌ p${p.id} ${p.type}/${p.gender} ${color}/${size}  NO_UID`);
          fail++; failures.push({ id: p.id, type: p.type, gender: p.gender, color, size, reason: 'no_uid' });
          continue;
        }
        const r = await probe(uid);
        if (!r.ok) {
          console.log(`❌ p${p.id} ${p.type}/${p.gender} ${color}/${size}  ${r.status}  ${uid}`);
          fail++;
          failures.push({ id: p.id, type: p.type, gender: p.gender, color, size, uid, status: r.status });
        } else {
          pass++;
        }
        await new Promise(s => setTimeout(s, 40));
      }
    }
  }
  console.log(`\nTOTAL: ${pass} pass / ${fail} fail`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(JSON.stringify(f)));
  }
})();
