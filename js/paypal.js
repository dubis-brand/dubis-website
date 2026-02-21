// DUBIS - PayPal Integration
// Agent: CTO | Replace PAYPAL_CLIENT_ID with real Live Client ID

const PAYPAL_CLIENT_ID = 'ENKtCEWzWoui6k77V01SR_XIyRIDSQznE0VJiCqqPQ5CAIQrN84eLgJJqyOMCUikgv0Nkdc2uBTwW17M';
let paypalLoaded = false;

// Load PayPal SDK dynamically
function loadPayPalSDK() {
    return new Promise((resolve, reject) => {
        if (paypalLoaded) { resolve(); return; }
        if (document.getElementById('paypal-sdk')) { resolve(); return; }

        const script = document.createElement('script');
        script.id = 'paypal-sdk';
        script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture`;
        script.onload = () => { paypalLoaded = true; resolve(); };
        script.onerror = () => reject(new Error('PayPal SDK failed to load'));
        document.head.appendChild(script);
    });
}

// Open PayPal checkout modal
async function checkout() {
    if (cart.length === 0) return;

    // Close cart first
    closeCart();

    // Render order summary
    renderOrderSummary();

    // Show PayPal modal
    document.getElementById('paypal-modal').classList.add('open');
    document.getElementById('paypal-modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    // Clear previous buttons
    document.getElementById('paypal-button-container').innerHTML = '';

    // Load PayPal and render buttons
    try {
        await loadPayPalSDK();
        renderPayPalButtons();
    } catch (err) {
        document.getElementById('paypal-button-container').innerHTML =
            '<p style="color:red; text-align:center;">Payment system unavailable. Please try again later.</p>';
    }
}

function renderOrderSummary() {
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    const summary = document.getElementById('paypal-order-summary');

    summary.innerHTML = `
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

function renderPayPalButtons() {
    const total = cart.reduce((sum, item) => sum + item.price, 0);

    paypal.Buttons({
        style: {
            color: 'black',
            shape: 'rect',
            label: 'pay',
            height: 50
        },
        createOrder: function(data, actions) {
            return actions.order.create({
                purchase_units: [{
                    description: 'DUBIS Clothing Order',
                    amount: {
                        currency_code: 'USD',
                        value: total.toFixed(2),
                        breakdown: {
                            item_total: {
                                currency_code: 'USD',
                                value: total.toFixed(2)
                            }
                        }
                    },
                    items: cart.map(item => ({
                        name: item.phrase.substring(0, 127),
                        unit_amount: {
                            currency_code: 'USD',
                            value: item.price.toFixed(2)
                        },
                        quantity: '1',
                        description: `${item.typeLabel} · Size: ${item.selectedSize} · Color: ${item.selectedColor}`
                    }))
                }],
                application_context: {
                    brand_name: 'DUBIS',
                    shipping_preference: 'GET_FROM_FILE'
                }
            });
        },
        onApprove: function(data, actions) {
            return actions.order.capture().then(function(details) {
                console.log('DUBIS Order captured:', details.id);
                closePaypalModal();
                cart = [];
                updateCartCount();
                showSuccessModal(details);
            });
        },
        onError: function(err) {
            console.error('PayPal error:', err);
            document.getElementById('paypal-button-container').innerHTML =
                '<p style="color:red; text-align:center; padding:1rem;">Payment failed. Please try again.</p>';
        },
        onCancel: function() {
            // User cancelled - modal stays open, they can try again
        }
    }).render('#paypal-button-container');
}

function closePaypalModal() {
    document.getElementById('paypal-modal').classList.remove('open');
    document.getElementById('paypal-modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

function showSuccessModal(details) {
    const modal = document.getElementById('success-modal');
    modal.classList.add('open');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('open');
}
