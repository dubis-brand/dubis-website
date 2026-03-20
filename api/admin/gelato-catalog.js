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

// ── Gelato base UIDs (no size/color/print) ────────────────────
function getBaseUid(type, gender) {
    const g = gender === 'women' ? 'women' : 'unisex';
    if (type === 'tshirt')     return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_${g}_gqa_classic`;
    if (type === 'hoodie')     return `apparel_product_gca_hoodie_gsc_pullover_gcu_${g}_gqa_classic`;
    if (type === 'ziphoodie')  return `apparel_product_gca_hoodie_gsc_zip_gcu_${g}_gqa_classic`;
    if (type === 'longsleeve') return `apparel_product_gca_long-sleeve_gsc_crewneck_gcu_${g}_gqa_classic`;
    if (type === 'cap')        return 'apparel_product_gca_dad-hat_gsc_classic_gcu_unisex_gqa_classic';
    return null;
}

// ── Gelato catalog URLs ────────────────────────────────────────
const GELATO_CATALOG_URLS = {
    tshirt:     'https://www.gelato.com/products/t-shirt',
    hoodie:     'https://www.gelato.com/products/hoodies',
    ziphoodie:  'https://www.gelato.com/products/hoodies',
    longsleeve: 'https://www.gelato.com/products/t-shirt',
    cap:        'https://www.gelato.com/products',
};

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

    // ── Fetch Gelato preview images if API key is available ────
    const GELATO_API_KEY = process.env.GELATO_API_KEY || process.env.GELATO;
    let previewImages = {}; // baseUid → imageUrl

    if (GELATO_API_KEY) {
        // Deduplicate base UIDs
        const uniqueUids = [...new Set(
            DUBIS_PRODUCTS.map(p => getBaseUid(p.type, p.gender)).filter(Boolean)
        )];
        // Fetch in parallel (max 8 requests)
        const results = await Promise.all(
            uniqueUids.map(async uid => ({
                uid,
                img: await fetchGelatoPreview(uid, GELATO_API_KEY)
            }))
        );
        results.forEach(({ uid, img }) => { if (img) previewImages[uid] = img; });
    }

    // ── Build response ─────────────────────────────────────────
    const products = DUBIS_PRODUCTS.map(p => {
        const baseUid = getBaseUid(p.type, p.gender);
        return {
            ...p,
            baseUid,
            gelatoUrl:    GELATO_CATALOG_URLS[p.type] || 'https://www.gelato.com',
            previewImage: previewImages[baseUid] || null,
        };
    });

    return res.status(200).json({ products });
};
