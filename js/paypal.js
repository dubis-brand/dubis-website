// DUBIS - PayPal Integration
// Phase 2: Smart Buttons SDK (live)

const USE_SDK = true;
const PAYPAL_ENV = 'live';
const PAYPAL_BUSINESS_EMAIL   = 'teharlev1976@gmail.com';
const PAYPAL_LIVE_CLIENT_ID   = 'AQI2SvXkD1gCvVQNvpQ0WJKWJyrOkuMCHge1QjsIVnDyfSmayRwGT4ZAzyTnAGBnqrGGYt795G85BY1r';
const PAYPAL_SANDBOX_CLIENT_ID = 'AZj2dQOOGG3j_JixU4GuhgZhgmzMp6qWO8zzyPd6E5pV66iNXWhHa9udoEbpel7ja6W_jcVZ4Ll4JpG_';
const PAYPAL_CLIENT_ID = PAYPAL_ENV === 'live' ? PAYPAL_LIVE_CLIENT_ID : PAYPAL_SANDBOX_CLIENT_ID;

let paypalLoaded = false;

// ===== CHECKOUT ENTRY POINT =====
async function checkout() {
    if (cart.length === 0) return;

    // ── Auth gate (PRD F3: no guest checkout) ──
    const token = await getAuthToken();
    if (!token) {
        closeCart();
        requireAuthThenCheckout();
        return;
    }

    closeCart();
    renderOrderSummary();

    document.getElementById('paypal-modal').classList.add('open');
    document.getElementById('paypal-modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    document.getElementById('paypal-button-container').innerHTML = '';

    if (USE_SDK) {
        try {
            await loadPayPalSDK();
            renderPayPalButtons();
        } catch (err) {
            renderDirectPayPalButton();
        }
    } else {
        renderDirectPayPalButton();
    }
}

// ===== PHASE 1: DIRECT PAYPAL LINK =====
function renderDirectPayPalButton() {
    const total     = cart.reduce((sum, item) => sum + item.price, 0);
    const itemNames = cart.map(i => `${i.phrase.substring(0, 40)} (${i.selectedSize}/${i.selectedColor})`).join(', ');
    const itemCount = cart.length;
    const paypalUrl = buildPayPalUrl(total, itemNames, itemCount);

    document.getElementById('paypal-button-container').innerHTML = `
        <a href="${paypalUrl}" target="_blank" class="paypal-direct-btn" onclick="handlePayPalClick()">
            <img src="https://www.paypalobjects.com/webstatic/en_US/i/buttons/PP_logo_h_100x26.png"
                 alt="PayPal" style="height:20px; vertical-align:middle; margin-right:8px;" />
            Pay with PayPal
        </a>
        <p class="paypal-direct-note">
            You'll be redirected to PayPal to complete your payment securely.<br>
            After paying, return here to continue shopping 🐻
        </p>
    `;
}

function buildPayPalUrl(total, itemNames, itemCount) {
    const base = PAYPAL_ENV === 'live'
        ? 'https://www.paypal.com/cgi-bin/webscr'
        : 'https://www.sandbox.paypal.com/cgi-bin/webscr';

    const params = new URLSearchParams({
        cmd:           '_xclick',
        business:      PAYPAL_BUSINESS_EMAIL,
        item_name:     `DUBIS Order (${itemCount} item${itemCount > 1 ? 's' : ''})`,
        item_number:   `DUBIS-${Date.now()}`,
        amount:        total.toFixed(2),
        currency_code: 'USD',
        shipping:      '0',
        no_shipping:   '0',
        return:        'https://www.dubis.net/?order=success',
        cancel_return: 'https://www.dubis.net/?order=cancelled',
        custom:        itemNames.substring(0, 255)
    });

    return `${base}?${params.toString()}`;
}

function handlePayPalClick() {
    setTimeout(() => {
        closePaypalModal();
        cart = [];
        updateCartCount();
        showSuccessModal();
    }, 2000);
}

// ===== PHASE 2: SMART BUTTONS SDK =====
function loadPayPalSDK() {
    return new Promise((resolve, reject) => {
        if (paypalLoaded) { resolve(); return; }
        if (document.getElementById('paypal-sdk')) {
            if (typeof paypal !== 'undefined') { paypalLoaded = true; resolve(); return; }
        }
        const script    = document.createElement('script');
        script.id       = 'paypal-sdk';
        script.src      = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture`;
        script.onload   = () => { paypalLoaded = true; resolve(); };
        script.onerror  = () => reject(new Error('PayPal SDK unavailable'));
        document.head.appendChild(script);
    });
}

function renderPayPalButtons() {
    const total = cart.reduce((sum, item) => sum + item.price, 0);

    paypal.Buttons({
        style: { color: 'black', shape: 'rect', label: 'pay', height: 50 },

        createOrder: (data, actions) => actions.order.create({
            purchase_units: [{
                description: 'DUBIS Clothing Order',
                amount: {
                    currency_code: 'USD',
                    value: total.toFixed(2),
                    breakdown: { item_total: { currency_code: 'USD', value: total.toFixed(2) } }
                },
                items: cart.map(item => ({
                    name:        item.phrase.substring(0, 127),
                    unit_amount: { currency_code: 'USD', value: item.price.toFixed(2) },
                    quantity:    '1',
                    description: `${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}`
                }))
            }],
            application_context: { brand_name: 'DUBIS', shipping_preference: 'GET_FROM_FILE' }
        }),

        onApprove: async (data, actions) => {
            const details  = await actions.order.capture();
            const shipping = details.purchase_units[0]?.shipping;

            const shippingAddress = {
                name:           shipping?.name?.full_name || '',
                address_line_1: shipping?.address?.address_line_1 || '',
                address_line_2: shipping?.address?.address_line_2 || '',
                admin_area_1:   shipping?.address?.admin_area_1 || '',
                admin_area_2:   shipping?.address?.admin_area_2 || '',
                country_code:   shipping?.address?.country_code || '',
                postal_code:    shipping?.address?.postal_code || '',
            };

            const cartSnapshot = cart.map(item => ({
                type:          item.type,
                phrase:        item.phrase,
                typeLabel:     item.typeLabel,
                price:         item.price,
                selectedSize:  item.selectedSize,
                selectedColor: item.selectedColor,
            }));

            // ── 1. Send to Printful ──────────────────────────────
            let printfulOrderId = null;
            try {
                const pfRes  = await fetch('/api/create-printful-order', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        paypalOrderId:   details.id,
                        buyerEmail:      details.payer?.email_address || '',
                        shippingAddress,
                        cartItems:       cartSnapshot,
                    }),
                });
                const pfData = await pfRes.json();
                if (pfData.printfulOrderId) printfulOrderId = String(pfData.printfulOrderId);
            } catch (err) {
                console.error('Printful dispatch failed:', err);
            }

            // ── 2. Save order to Supabase DB ─────────────────────
            let savedOrderId = null;
            try {
                const token = await getAuthToken();
                const saveRes = await fetch('/api/orders/save', {
                    method:  'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                        paypalOrderId:   details.id,
                        buyerEmail:      details.payer?.email_address || '',
                        shippingAddress,
                        cartItems:       cartSnapshot,
                        printfulOrderId,
                    }),
                });
                const saveData = await saveRes.json();
                if (saveData.orderId) savedOrderId = saveData.orderId;
            } catch (err) {
                console.error('Order save failed:', err);
            }

            // ── 3. Send confirmation email ────────────────────────
            try {
                const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
                await fetch('/api/email/confirm-order', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        buyerEmail:   details.payer?.email_address || '',
                        buyerName:    user?.user_metadata?.full_name || details.payer?.name?.given_name || '',
                        orderId:      savedOrderId,
                        paypalOrderId: details.id,
                        items:        cartSnapshot,
                        totalAmount:  cartSnapshot.reduce((s, i) => s + i.price, 0),
                    }),
                });
            } catch (err) {
                console.error('Confirmation email failed:', err);
            }
            // ─────────────────────────────────────────────────────

            closePaypalModal();
            cart = [];
            updateCartCount();
            showSuccessModal();
        },

        onError:  () => renderDirectPayPalButton(),
        onCancel: () => {}

    }).render('#paypal-button-container');
}

// ===== ORDER SUMMARY =====
function renderOrderSummary() {
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    document.getElementById('paypal-order-summary').innerHTML = `
        <div class="order-items">
            ${cart.map(item => `
                <div class="order-item">
                    <img src="${item.image}" alt="${item.phrase}" class="order-item-img" />
                    <div class="order-item-info">
                        <div class="order-item-name">"${item.phrase}"</div>
                        <div class="order-item-details">${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}</div>
                    </div>
                    <div class="order-item-price">$${item.price}</div>
                </div>
            `).join('')}
        </div>
        <div class="order-total-row">
            <span>Shipping</span>
            <span class="shipping-note">Calculated at PayPal</span>
        </div>
        <div class="order-total-row total">
            <span>Total</span>
            <span>$${total}</span>
        </div>
    `;
}

// ===== MODALS =====
function closePaypalModal() {
    document.getElementById('paypal-modal').classList.remove('open');
    document.getElementById('paypal-modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

function showSuccessModal() {
    document.getElementById('success-modal').classList.add('open');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('open');
}

// Handle return from PayPal direct link
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('order') === 'success') {
        cart = [];
        updateCartCount();
        showSuccessModal();
        window.history.replaceState({}, '', '/');
    }
});
