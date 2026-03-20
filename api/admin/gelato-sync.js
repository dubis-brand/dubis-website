// DUBIS — Sync order status from Gelato
// POST /api/admin/gelato-sync
// Body: { orderId }  (Supabase order UUID)
// Fetches Gelato status, updates Supabase, returns latest data

const { createClient } = require('@supabase/supabase-js');

const GELATO_API_BASE = 'https://order.gelatoapis.com';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dubis.brand@gmail.com')
    .split(',').map(e => e.trim());

// Map Gelato order status → DUBIS status (handles both hyphens and underscores)
const GELATO_STATUS_MAP = {
    created:      'pending',
    passed:       'pending',
    draft:        'pending',
    pending:      'pending',
    // production
    'in-progress':  'in_production',
    in_progress:    'in_production',
    printed:        'in_production',
    packaged:       'in_production',
    finished:       'in_production',
    // shipped
    'in-transit':   'shipped',
    in_transit:     'shipped',
    shipped:        'shipped',
    dispatched:     'shipped',
    // delivered
    delivered:      'delivered',
    // cancelled
    canceled:       'cancelled',
    cancelled:      'cancelled',
    failed:         'cancelled',
    returned:       'cancelled',
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Verify admin JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

    const isAdmin = ADMIN_EMAILS.includes(user.email);
    if (!isAdmin) {
        const { data: adminRow } = await supabase
            .from('admin_users').select('email').eq('email', user.email).single();
        if (!adminRow) return res.status(403).json({ error: 'Forbidden' });
    }

    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    // Fetch the DUBIS order from Supabase
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, printful_order_id, status, tracking_number')
        .eq('id', orderId)
        .single();

    if (orderError || !order) return res.status(404).json({ error: 'Order not found' });
    if (!order.printful_order_id) return res.status(200).json({ synced: false, reason: 'no_gelato_id' });

    const gelatoKey = process.env.GELATO_API_KEY || process.env.GELATO || process.env.Gelato;
    if (!gelatoKey) return res.status(200).json({ synced: false, reason: 'no_gelato_key' });

    // Fetch from Gelato
    const gelatoRes = await fetch(`${GELATO_API_BASE}/v3/orders/${order.printful_order_id}`, {
        headers: {
            'X-API-KEY': gelatoKey,
            'Content-Type': 'application/json'
        }
    });

    if (!gelatoRes.ok) {
        const txt = await gelatoRes.text();
        console.error('Gelato fetch error:', gelatoRes.status, txt);
        return res.status(200).json({ synced: false, reason: 'gelato_error', status: gelatoRes.status });
    }

    const gelatoOrder = await gelatoRes.json();
    console.log('Gelato order response:', JSON.stringify(gelatoOrder).substring(0, 1000));

    // Extract tracking — try all possible Gelato API field paths
    let trackingNumber = null;
    let trackingUrl    = null;

    // v3: order.shipment.packages[0].trackingCode
    const pkg = gelatoOrder.shipment?.packages?.[0];
    if (pkg) {
        trackingNumber = pkg.trackingCode || pkg.tracking_code || null;
        trackingUrl    = pkg.trackingUrl  || pkg.tracking_url  || null;
    }

    // v3: order.shipment.trackingCode
    if (!trackingNumber && gelatoOrder.shipment) {
        const s = gelatoOrder.shipment;
        trackingNumber = s.trackingCode || s.tracking_code || null;
        trackingUrl    = s.trackingUrl  || s.tracking_url  || null;
    }

    // v4: order.shipments[] array
    if (!trackingNumber) {
        const shipments = gelatoOrder.shipments || [];
        if (shipments.length > 0) {
            const s = shipments[0];
            trackingNumber = s.trackingCode || s.tracking_code || null;
            trackingUrl    = s.trackingUrl  || s.tracking_url  || null;
            // also try packages within shipment
            if (!trackingNumber && s.packages?.length > 0) {
                trackingNumber = s.packages[0].trackingCode || s.packages[0].tracking_code || null;
                trackingUrl    = s.packages[0].trackingUrl  || s.packages[0].tracking_url  || null;
            }
        }
    }

    // fulfillments array (some Gelato versions)
    if (!trackingNumber) {
        const fulfillments = gelatoOrder.fulfillments || [];
        if (fulfillments.length > 0) {
            const f = fulfillments[0];
            trackingNumber = f.trackingCode || f.tracking_code || null;
            trackingUrl    = f.trackingUrl  || f.tracking_url  || null;
        }
    }

    // Build DHL tracking URL if we have a number but no URL
    if (trackingNumber && !trackingUrl) {
        trackingUrl = `https://mydhl.express.dhl/en/en/tracking.html#/results?id=${trackingNumber}`;
    }

    let newStatus = GELATO_STATUS_MAP[gelatoOrder.status] || order.status;

    // If there's a tracking number, the order is definitely shipped (override)
    if (trackingNumber && newStatus === 'pending') {
        newStatus = 'shipped';
    }

    // Update Supabase if something changed
    const updates = {};
    if (newStatus !== order.status) updates.status = newStatus;
    if (trackingNumber && trackingNumber !== order.tracking_number) {
        updates.tracking_number = trackingNumber;
        if (trackingUrl) updates.tracking_url = trackingUrl;
        if (newStatus === 'shipped' && !order.shipped_at) {
            updates.shipped_at = new Date().toISOString();
        }
    }

    if (Object.keys(updates).length > 0) {
        await supabase.from('orders').update(updates).eq('id', orderId);
    }

    return res.status(200).json({
        synced: true,
        gelato_status: gelatoOrder.status,
        status: newStatus,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        updated: Object.keys(updates).length > 0,
        // debug fields — help identify Gelato's actual response structure
        _debug: {
            has_shipment: !!gelatoOrder.shipment,
            shipment_keys: gelatoOrder.shipment ? Object.keys(gelatoOrder.shipment) : [],
            has_shipments: !!(gelatoOrder.shipments?.length),
            has_fulfillments: !!(gelatoOrder.fulfillments?.length),
            top_keys: Object.keys(gelatoOrder)
        }
    });
};
