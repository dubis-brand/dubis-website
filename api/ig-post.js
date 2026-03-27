// DUBIS — One-time Instagram Quick Publish
// Triggered via GET with a simple key.
// Uses existing Vercel env vars (INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID)

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

    // Simple key check
    const key = req.query.key;
    if (key !== 'dubis_quick_publish_2026_x9k') {
        return res.status(401).json({ error: 'Invalid key' });
    }

    const igToken   = process.env.INSTAGRAM_ACCESS_TOKEN;
    const igAccount = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!igToken || !igAccount) {
        return res.status(500).json({ error: 'Missing Instagram env vars', has_token: !!igToken, has_account: !!igAccount });
    }

    // Product image — bestseller "I'm not fat, I'm a limited edition"
    const image_url = 'https://www.dubis.net/images/product-1-White-front.jpg';

    const caption = `לא שמנים. מהדורה מוגבלת. 🐾

הבסטסלר שלנו — "I'm not fat, I'm a limited edition"
זמין ב-T-shirt, Hoodie ו-Long-sleeve. 6 צבעים. S–3XL.
משלוח חינם לכל העולם 🚚

👕 dubis.net | קוד DUBIS15 = 15% הנחה

#dubis #limitededition #bodypositivity #funnytshirt #israelifashion #בגדים #חולצות #מתנהלגבר #הומור #ישראל #ForTheRestOfUs #streetwear #tshirt`;

    const result = { success: false, errors: [] };

    try {
        const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;

        // Step 1: Create media container
        const cRes = await fetch(`${igBase}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url, caption, access_token: igToken }),
        });
        const container = await cRes.json();

        if (!cRes.ok || container.error) {
            result.errors.push('Container: ' + (container.error?.message || JSON.stringify(container)));
            return res.status(500).json(result);
        }

        // Step 2: Publish
        const pRes = await fetch(`${igBase}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: container.id, access_token: igToken }),
        });
        const published = await pRes.json();

        if (!pRes.ok || published.error) {
            result.errors.push('Publish: ' + (published.error?.message || JSON.stringify(published)));
            return res.status(500).json(result);
        }

        result.success = true;
        result.instagram_post_id = published.id;
        result.caption_preview = caption.substring(0, 100) + '...';

        // Log to Supabase
        try {
            const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
            await sb.from('agent_runs').insert({
                agent_id: 'quick-publish',
                status: 'completed',
                summary: `Instagram post published | ID: ${published.id}`,
            });
        } catch(e) { /* logging failure is non-critical */ }

        return res.status(200).json(result);

    } catch (e) {
        result.errors.push('Exception: ' + e.message);
        return res.status(500).json(result);
    }
};
