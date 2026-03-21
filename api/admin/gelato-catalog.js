// DUBIS — Admin: Gelato Catalog
// GET /api/admin/gelato-catalog
// Returns all 14 DUBIS products with Gelato UIDs, catalog links, and preview images
// Admin auth required

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
    .split(',').map(e => e.trim().toLowerCase());

// ── All 14 DUBIS products ──────────────────────────────────────
const DUBIS_PRODUCTS = [
    { id: 1,  phrase: "I'm not fat, I'm a limited edition", typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'unisex', price: 45 },
    { id: 2,  phrase: 'More of me to love',                  typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'unisex', price: 45 },
    { id: 3,  phrase: 'Napping is my cardio',                typeLabel: 'Hoodie',     type: 'hoodie',    gender: 'unisex', price: 75 },
    { id: 4,  phrase: 'I survived. That\'s enough.',         typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'unisex', price: 45 },
    { id: 5,  phrase: 'Low maintenance, high value',         typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'unisex', price: 45 },
    { id: 6,  phrase: 'Not a model. Never wanted to be.',    typeLabel: 'Hoodie',     type: 'hoodie',    gender: 'unisex', price: 75 },
    { id: 7,  phrase: 'DUBIS — For the rest of us',          typeLabel: 'Cap',        type: 'cap',       gender: 'unisex', price: 35 },
    { id: 8,  phrase: 'Born to nap, forced to work',         typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'men',    price: 45 },
    { id: 9,  phrase: 'Certified overthinker',               typeLabel: 'Zip Hoodie', type: 'ziphoodie', gender: 'men',    price: 80 },
    { id: 10, phrase: 'Serial napper',                       typeLabel: 'Long-Sleeve',type: 'longsleeve',gender: 'men',    price: 55 },
    { id: 11, phrase: 'She believed she could, so she took a nap', typeLabel: 'T-Shirt', type: 'tshirt', gender: 'women', price: 45 },
    { id: 12, phrase: 'I run on coffee and sarcasm',          typeLabel: 'T-Shirt',    type: 'tshirt',    gender: 'women',  price: 45 },
    { id: 13, phrase: 'Zero Motivation Club',                 typeLabel: 'Hoodie',     type: 'hoodie',    gender: 'women',  price: 75 },
    { id: 14, phrase: 'Emotionally attached to my couch',    typeLabel: 'Long-Sleeve',type: 'longsleeve',gender: 'women',  price: 55 },
];

// ── Gelato base UIDs (no size/color/print) — for catalog grouping ─────────
function getBaseUid(type, gender) {
    const g = gender === 'women' ? 'women' : 'unisex';
    if (type === 'tshirt')     return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_${g}_gqa_classic`;
    if (type === 'hoodie')     return `apparel_product_gca_hoodie_gsc_pullover_gcu_${g}_gqa_classic`;
    if (type === 'ziphoodie')  return `apparel_product_gca_hoodie_gsc_zip_gcu_${g}_gqa_classic`;
    if (type === 'longsleeve') return `apparel_product_gca_long-sleeve_gsc_crewneck_gcu_${g}_gqa_classic`;
    if (type === 'cap')        return 'apparel_product_gca_dad-hat_gsc_classic_gcu_unisex_gqa_classic';
    return null;
}

// ── Full UIDs for prices API (requires size+color+print) ───────────────────
function getPriceUid(type, gender) {
    const base = getBaseUid(type, gender);
    if (!base) return null;
    if (type === 'cap') return base + '_gsi_os_gco_black_gpr_4-0';
    return base + '_gsi_m_gco_black_gpr_4-4';
}

// ── Gelato catalog URLs — direct links to specific product pages ────────────
function getGelatoUrl(type, gender) {
    const w = gender === 'women';
    if (type === 'tshirt')     return w
        ? 'https://www.gelato.com/custom/womens-clothing/t-shirts/classic-womens-crewneck-t-shirt'
        : 'https://www.gelato.com/custom/brands/gildan/classic-unisex-crewneck-t-shirt-gildan-64000';
    if (type === 'hoodie')     return w
        ? 'https://www.gelato.com/custom/womens-clothing/hoodies'
        : 'https://www.gelato.com/custom/brands/gildan/classic-unisex-pullover-hoodie-gildan-18500';
    if (type === 'ziphoodie')  return 'https://www.gelato.com/custom/mens-clothing/hoodies/classic-unisex-zip-hoodie';
    if (type === 'longsleeve') return w
        ? 'https://www.gelato.com/custom/womens-clothing/long-sleeve-shirts'
        : 'https://www.gelato.com/custom/mens-clothing/long-sleeve-shirts';
    if (type === 'cap')        return 'https://www.gelato.com/custom/hats/dad-hats';
    return 'https://www.gelato.com/custom';
}

// ── Fetch one Gelato product for preview image ─────────────────
async function fetchGelatoPreview(uid, apiKey) {
    try {
        const res = await fetch(`https://product.gelatoapis.com/v3/products/${uid}`, {
            headers: { 'X-API-KEY': apiKey }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.previewUrl || data?.images?.[0]?.url || null;
    } catch {
        return null;
    }
}

// ── Fetch Gelato product cost (production price in USD) ────────
async function fetchGelatoCost(uid, apiKey) {
    try {
        const res = await fetch(
            `https://product.gelatoapis.com/v3/products/${uid}/prices?country=US&currency=USD`,
            { headers: { 'X-API-KEY': apiKey } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        // Response: [{productUid, country, quantity, price (=total for qty), currency}]
        const tiers = Array.isArray(data) ? data : [];
        if (!tiers.length) return null;
        // Prefer quantity=1 tier; otherwise divide total price by smallest quantity
        const qty1 = tiers.find(p => p.quantity === 1);
        if (qty1) return Math.round(qty1.price * 100) / 100;
        const minTier = tiers.reduce((a, b) => b.quantity < a.quantity ? b : a);
        return Math.round((minTier.price / minTier.quantity) * 100) / 100;
    } catch {
        return null;
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // ── Admin auth ─────────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

    const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());
    if (!isAdmin) {
        const { data: adminRow } = await supabase
            .from('admin_users').select('email').eq('email', user.email).single();
        if (!adminRow) return res.status(403).json({ error: 'Forbidden' });
    }

    // ── Fetch Gelato data if API key is available ──────────────
    const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
    let previewImages = {}; // baseUid → imageUrl
    let gelatoCosts   = {}; // baseUid → cost in USD

    if (GELATO_API_KEY) {
        // Deduplicate by baseUid, fetch preview (base) + cost (full UID) in parallel
        const uniqueTypes = [...new Map(
            DUBIS_PRODUCTS.map(p => [getBaseUid(p.type, p.gender), p])
        ).values()];

        const results = await Promise.all(
            uniqueTypes.map(async p => ({
                baseUid:  getBaseUid(p.type, p.gender),
                priceUid: getPriceUid(p.type, p.gender),
                img:  await fetchGelatoPreview(getBaseUid(p.type, p.gender), GELATO_API_KEY),
                cost: await fetchGelatoCost(getPriceUid(p.type, p.gender), GELATO_API_KEY),
            }))
        );
        results.forEach(({ baseUid, img, cost }) => {
            if (img)  previewImages[baseUid] = img;
            if (cost) gelatoCosts[baseUid]   = cost;
        });
    }

    // ── Build response ─────────────────────────────────────────
    const products = DUBIS_PRODUCTS.map(p => {
        const baseUid = getBaseUid(p.type, p.gender);
        return {
            ...p,
            baseUid,
            gelatoUrl:    getGelatoUrl(p.type, p.gender),
            previewImage: previewImages[baseUid] || null,
            gelatoCost:   gelatoCosts[baseUid]   || null,
        };
    });

    return res.status(200).json({ products });
};
