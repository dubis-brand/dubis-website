#!/usr/bin/env node
// Smoke test: split oren's failing cart {31 Navy M, 13 Navy XL, 1 White XL} → IL
// using the new _orderSplit helper.

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
const { splitCartByWarehouse } = require('../api/_orderSplit.js');

// Minimal mirror of buildProductUid + getDesignFiles inputs.
function uid({ type, gender, color, size }) {
  // Match TEMPLATES + COLOR_MAP in create-gelato-order.js for the 3 SKUs we need.
  if (type === 'tshirt' && gender === 'women' && color === 'navy') {
    return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_womens_gqa_prm_gsi_${size}_gco_navy_gpr_4-4_bella-and-canvas_6004`;
  }
  if (type === 'tshirt' && gender === 'unisex' && color === 'white') {
    return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_classic_gsi_${size}_gco_white_gpr_4-4_gildan_64000`;
  }
  if (type === 'hoodie' && gender === 'women' && color === 'navy') {
    return `apparel_product_gca_hoodie_gsc_pullover_gcu_womens_gqa_prm_gsi_${size}_gco_navy_gpr_4-4`;
  }
  throw new Error(`uid not mapped for ${type}/${gender}/${color}/${size}`);
}

const FILE_URL = 'https://www.dubis.net/designs/front_logo_white.png';

const entries = [
  { uid: uid({ type:'tshirt', gender:'women', color:'navy',  size:'m'  }), item: { id: 31, type:'tshirt', selectedColor:'Navy',  selectedSize:'M',  phrase:"You're prettier when you're comfortable" }, fileUrl: FILE_URL },
  { uid: uid({ type:'hoodie', gender:'women', color:'navy',  size:'xl' }), item: { id: 13, type:'hoodie', selectedColor:'Navy',  selectedSize:'XL', phrase:'Zero Motivation Club' },                       fileUrl: FILE_URL },
  { uid: uid({ type:'tshirt', gender:'unisex',color:'white', size:'xl' }), item: { id: 1,  type:'tshirt', selectedColor:'White', selectedSize:'XL', phrase:"I'm not fat, I'm a limited edition" },        fileUrl: FILE_URL },
];

const recipient = {
  firstName: 'Hila', lastName: 'Test',
  addressLine1: 'Rothschild 1',
  city: 'Tel Aviv', state: '', postalCode: '6688101',
  country: 'IL', email: 'probe@dubis.net', phone: '+972500000000',
};

(async () => {
  const result = await splitCartByWarehouse({
    entries,
    recipient,
    gelatoApiKey: process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato,
  });
  console.log('\n========== SPLIT RESULT ==========');
  console.log('splittable:', result.splittable);
  console.log('attempts:', result.attempts);
  console.log('reason:', result.reason);
  console.log(`\nsub-carts (${result.subCarts.length}):`);
  for (const [i, sc] of result.subCarts.entries()) {
    console.log(`  #${i+1} → warehouse=${sc.country}, items=[${sc.items.map(it => `${it.id}/${it.selectedColor}/${it.selectedSize}`).join(', ')}]`);
  }
  if (result.unfulfillable.length > 0) {
    console.log(`\nunfulfillable (${result.unfulfillable.length}):`);
    for (const e of result.unfulfillable) {
      console.log(`  - ${e.item.id}/${e.item.selectedColor}/${e.item.selectedSize}`);
    }
  }
})().catch(err => { console.error(err); process.exit(1); });
