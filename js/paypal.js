// DUBIS - PayPal Integration
// Phase 2: Smart Buttons SDK (live)

const USE_SDK = true;
const PAYPAL_ENV = 'live';
const PAYPAL_BUSINESS_EMAIL   = 'teharlev1976@gmail.com';
const PAYPAL_LIVE_CLIENT_ID   = 'AWu0oDEl16mzRrbqX8zWrqFZeqc790LptV1UC5fiz8JnR7MKbd4nPVllaoMhIskYxau9IqGUy-mAfPYw';
const PAYPAL_SANDBOX_CLIENT_ID = 'AZj2dQOOGG3j_JixU4GuhgZhgmzMp6qWO8zzyPd6E5pV66iNXWhHa9udoEbpel7ja6W_jcVZ4Ll4JpG_';
const PAYPAL_CLIENT_ID = PAYPAL_ENV === 'live' ? PAYPAL_LIVE_CLIENT_ID : PAYPAL_SANDBOX_CLIENT_ID;

const SHIPPING_FEE = 8.99;
const FREE_SHIPPING_THRESHOLD = 60;

let paypalLoaded = false;
let appliedCoupon = null; // { code, discount_amount, final_total, name }

async function applyCoupon() {
    const code = (document.getElementById('coupon-input')?.value || '').trim().toUpperCase();
    const fb = document.getElementById('coupon-feedback');
    if (!code) { fb.textContent = 'Please enter a coupon code.'; fb.className = 'coupon-feedback error'; return; }
    fb.textContent = 'Checking…'; fb.className = 'coupon-feedback';
    const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);
    try {
        const res = await fetch('/api/admin/coupons?action=validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, cartTotal })
        });
        const data = await res.json();
        if (data.valid) {
            appliedCoupon = data;
            const discStr = data.discount_type === 'percentage'
                ? `${data.discount_value}% off`
                : `$${data.discount_value} off`;
            fb.textContent = `Coupon applied: ${data.name} — ${discStr}. New total: $${data.final_total.toFixed(2)}`;
            fb.className = 'coupon-feedback success';
            updateCartTotalDisplay(data.final_total);
        } else {
            appliedCoupon = null;
            fb.textContent = data.error || 'Invalid coupon code.';
            fb.className = 'coupon-feedback error';
        }
    } catch { fb.textContent = 'Could not validate coupon. Try again.'; fb.className = 'coupon-feedback error'; }
}

function updateCartTotalDisplay(discountedSubtotal) {
    // Re-render the full summary so the coupon row and correct grand total are shown.
    // appliedCoupon is already set before this is called.
    renderOrderSummary();
}

// ===== CHECKOUT ENTRY POINT =====
async function checkout() {
    if (cart.length === 0) return;

    closeCart();
    renderOrderSummary();

    document.getElementById('paypal-modal').classList.add('open');
    document.getElementById('paypal-modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    // Reset modal state
    document.getElementById('paypal-button-container').innerHTML = '';
    appliedCoupon = null;
    const cpInput = document.getElementById('coupon-input');
    const cpFb = document.getElementById('coupon-feedback');
    if (cpInput) cpInput.value = '';
    if (cpFb) { cpFb.textContent = ''; cpFb.className = 'coupon-feedback'; }

    // Show contact step, hide payment step
    const contactStep  = document.getElementById('contact-step');
    const paymentStep  = document.getElementById('payment-step');
    if (contactStep) contactStep.style.display = '';
    if (paymentStep) paymentStep.style.display  = 'none';

    // Pre-fill contact fields if user is logged in
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (user) {
        const nameEl  = document.getElementById('checkout-name');
        const emailEl = document.getElementById('checkout-email');
        if (nameEl  && user.user_metadata?.full_name) nameEl.value  = user.user_metadata.full_name;
        if (emailEl && user.email)                    emailEl.value = user.email;
    }

    // Clear error
    const errEl = document.getElementById('contact-step-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
}

// ===== CONTACT STEP SUBMISSION =====
async function submitContactStep() {
    const nameEl  = document.getElementById('checkout-name');
    const emailEl = document.getElementById('checkout-email');
    const phoneEl = document.getElementById('checkout-phone');
    const errEl   = document.getElementById('contact-step-error');

    const email = (emailEl?.value || '').trim();
    const phone = (phoneEl?.value || '').trim();
    const name  = (nameEl?.value  || '').trim();

    if (!name || name.length < 2) {
        errEl.textContent = 'Please enter your full name.';
        errEl.style.display = 'block';
        nameEl?.focus();
        return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = 'Please enter a valid email address.';
        errEl.style.display = 'block';
        emailEl?.focus();
        return;
    }
    if (!phone || phone.length < 7) {
        errEl.textContent = 'Please enter a valid phone number.';
        errEl.style.display = 'block';
        phoneEl?.focus();
        return;
    }

    // Store contact info globally for use in onApprove
    window.checkoutContact = { name, email, phone };

    // Hide contact step, show payment step
    document.getElementById('contact-step').style.display  = 'none';
    document.getElementById('payment-step').style.display  = '';

    // Render PayPal
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

// ===== FALLBACK: SDK failed to load =====
function renderDirectPayPalButton() {
    // Do NOT use a silent direct PayPal link — orders won't be saved.
    // Show a clear error and ask user to refresh.
    document.getElementById('paypal-button-container').innerHTML = `
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;text-align:center;color:#856404">
            <strong>⚠️ Payment system could not load.</strong><br>
            Please close this window, refresh the page, and try again.<br>
            <small>If the problem persists, contact us at <a href="mailto:dubis.brand@gmail.com" style="color:#856404">dubis.brand@gmail.com</a></small>
        </div>
    `;
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
    const createOrder = (data, actions) => {
        const itemTotal = cart.reduce((sum, i) => sum + i.price, 0);
        const shipping  = itemTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
        const discountedTotal = appliedCoupon ? appliedCoupon.final_total : itemTotal;
        const total = discountedTotal + shipping;
        return actions.order.create({
        purchase_units: [{
            description: 'DUBIS Clothing Order',
            amount: {
                currency_code: 'USD',
                value: total.toFixed(2),
                breakdown: {
                    item_total: { currency_code: 'USD', value: (appliedCoupon ? appliedCoupon.final_total : itemTotal).toFixed(2) },
                    shipping:   { currency_code: 'USD', value: shipping.toFixed(2) }
                }
            },
            items: cart.map(item => ({
                name:        item.phrase.substring(0, 127),
                unit_amount: { currency_code: 'USD', value: item.price.toFixed(2) },
                quantity:    '1',
                description: `${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}`
            }))
        }],
        application_context: { brand_name: 'DUBIS' }
    });
    };

    const onApprove = async (data, actions) => {
            try {
                const details  = await actions.order.capture();
                const shipping = details.purchase_units[0]?.shipping;

                // Meta Pixel — Purchase event
                if (typeof fbq === 'function') {
                    fbq('track', 'Purchase', {
                        value: totalAmount,
                        currency: 'USD',
                        content_type: 'product',
                        num_items: cart.length,
                    });
                }

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
                    id:            item.id,
                    type:          item.type,
                    gender:        item.gender   || 'unisex',
                    designRef:     item.designRef || null,
                    phrase:        item.phrase,
                    typeLabel:     item.typeLabel,
                    price:         item.price,
                    selectedSize:  item.selectedSize,
                    selectedColor: item.selectedColor,
                }));

                // ── 1. Send to Gelato ────────────────────────────────
                let printfulOrderId = null;
                try {
                    const pfRes  = await fetch('/api/create-gelato-order', {
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
                    if (pfData.gelatoOrderId)  printfulOrderId = String(pfData.gelatoOrderId);
                    if (pfData.printfulOrderId && !printfulOrderId) printfulOrderId = String(pfData.printfulOrderId);
                } catch (err) {
                    console.error('Gelato dispatch failed:', err);
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
                            buyerEmail:      details.payer?.email_address || window.checkoutContact?.email || '',
                            shippingAddress,
                            cartItems:       cartSnapshot,
                            printfulOrderId,
                            couponCode:      appliedCoupon?.code || null,
                            discountAmount:  appliedCoupon?.discount_amount || null,
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
                            buyerEmail:   details.payer?.email_address || window.checkoutContact?.email || '',
                            buyerName:    user?.user_metadata?.full_name || window.checkoutContact?.name || details.payer?.name?.given_name || '',
                            orderId:      savedOrderId,
                            paypalOrderId: details.id,
                            items:        cartSnapshot,
                            totalAmount:  cartSnapshot.reduce((s, i) => s + i.price, 0),
                        }),
                    });
                } catch (err) {
                    console.error('Confirmation email failed:', err);
                }
                // ── 4. GA4 purchase event ─────────────────────────────
                if (typeof gtag !== 'undefined') {
                    const orderValue = cartSnapshot.reduce((s, i) => s + (Number(i.price) || 0), 0);
                    gtag('event', 'purchase', {
                        transaction_id: details.id,
                        value:          orderValue,
                        currency:       'USD',
                        items: cartSnapshot.map((item, idx) => ({
                            item_id:       String(idx + 1),
                            item_name:     item.phrase || item.type || 'DUBIS item',
                            item_category: item.typeLabel || item.type || '',
                            price:         Number(item.price) || 0,
                            quantity:      1,
                        })),
                    });
                }
                // ─────────────────────────────────────────────────────

                closePaypalModal();
                cart = [];
                saveCart();
                updateCartCount();
                showSuccessModal();
            } catch (err) {
                console.error('PayPal capture error:', err);
                const issue = err?.details?.[0]?.issue;
                if (issue === 'INSTRUMENT_DECLINED') {
                    return actions.restart();
                }
                showPaymentError('Payment could not be completed (' + (issue || err?.message || 'unknown') + '). Please try again.');
            }
    };

    const onError = (err) => {
        console.error('PayPal error:', err);
        showPaymentError('Payment failed. Please try again or contact support.');
    };

    // PayPal button
    paypal.Buttons({
        fundingSource: paypal.FUNDING.PAYPAL,
        style: { color: 'black', shape: 'rect', label: 'pay', height: 50 },
        createOrder, onApprove, onError, onCancel: () => {}
    }).render('#paypal-button-container');

}

// ===== ORDER SUMMARY =====
function renderOrderSummary() {
    const itemTotal = cart.reduce((sum, item) => sum + item.price, 0);
    const shipping  = itemTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
    const couponDiscount = appliedCoupon ? (itemTotal - appliedCoupon.final_total) : 0;
    const grandTotal = itemTotal - couponDiscount + shipping;

    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - itemTotal);
    const pct = Math.min(100, (itemTotal / FREE_SHIPPING_THRESHOLD) * 100);

    document.getElementById('paypal-order-summary').innerHTML = `
        <!-- Free shipping progress bar -->
        <div class="free-ship-progress">
            <div class="free-ship-progress-label ${shipping === 0 ? 'reached' : ''}">
                ${shipping === 0
                    ? '🎉 You\'ve got free shipping!'
                    : `Add <strong>$${remaining.toFixed(2)}</strong> more for free shipping`}
            </div>
            <div class="free-ship-bar-track">
                <div class="free-ship-bar-fill" style="width:${pct}%"></div>
            </div>
        </div>

        <!-- Items list -->
        <div class="order-items">
            ${cart.map(item => `
                <div class="order-item">
                    <img src="${item.image}" alt="${item.phrase}" class="order-item-img" onerror="this.style.display='none'" />
                    <div class="order-item-info">
                        <div class="order-item-name">"${item.phrase}"</div>
                        <div class="order-item-details">${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}</div>
                    </div>
                    <div class="order-item-price">$${item.price.toFixed(2)}</div>
                </div>
            `).join('')}
        </div>

        <!-- Totals -->
        <div class="order-totals">
            <div class="order-total-row">
                <span>Subtotal</span>
                <span>$${itemTotal.toFixed(2)}</span>
            </div>
            ${couponDiscount > 0 ? `
            <div class="order-total-row discount">
                <span>Coupon (${appliedCoupon?.code})</span>
                <span>−$${couponDiscount.toFixed(2)}</span>
            </div>` : ''}
            <div class="order-total-row">
                <span>Shipping</span>
                <span>${shipping === 0 ? '<span style="color:var(--honey);font-weight:600">FREE 🎉</span>' : '$' + shipping.toFixed(2)}</span>
            </div>
            <div class="order-total-row total">
                <span>Total</span>
                <span>$${grandTotal.toFixed(2)}</span>
            </div>
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

// ===== PAYMENT STATE HELPERS =====
function showPaymentProcessing() {
    const container = document.getElementById('paypal-button-container');
    if (container) container.innerHTML = '<div style="text-align:center;padding:32px;color:#666">Processing payment…</div>';
}

function showPaymentError(msg) {
    const container = document.getElementById('paypal-button-container');
    if (container) container.innerHTML = `
        <p style="color:#c00;text-align:center;padding:16px;margin:0">${msg}</p>
        <button onclick="closePaypalModal()" style="display:block;width:100%;margin-top:8px;padding:12px;background:#111;color:#fff;border:none;cursor:pointer;font-size:14px">Close</button>
    `;
}

// Handle return from PayPal direct link
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('order') === 'success') {
        cart = [];
        saveCart();
        updateCartCount();
        showSuccessModal();
        window.history.replaceState({}, '', '/');
    }
});
