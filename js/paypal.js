// DUBIS - PayPal Integration
// Phase 2: Smart Buttons SDK (live)

const USE_SDK = true;
const PAYPAL_ENV = 'live';
// PAYPAL_BUSINESS_EMAIL removed 2026-05-04 - was Phase-1 legacy constant, never read.
// Frontend never needs the business email; PayPal identifies merchant via Client ID.
const PAYPAL_LIVE_CLIENT_ID   = 'AWu0oDEl16mzRrbqX8zWrqFZeqc790LptV1UC5fiz8JnR7MKbd4nPVllaoMhIskYxau9IqGUy-mAfPYw';
const PAYPAL_SANDBOX_CLIENT_ID = 'AZj2dQOOGG3j_JixU4GuhgZhgmzMp6qWO8zzyPd6E5pV66iNXWhHa9udoEbpel7ja6W_jcVZ4Ll4JpG_';
const PAYPAL_CLIENT_ID = PAYPAL_ENV === 'live' ? PAYPAL_LIVE_CLIENT_ID : PAYPAL_SANDBOX_CLIENT_ID;

const SHIPPING_FEE = 8.99;                  // legacy default (US standard)
const FREE_SHIPPING_THRESHOLD = 60;
// Country-aware shipping â Gelato standard ground varies wildly:
//   US ~$5.99 / IL ~$12.87 / EU ~$8-12 / AU ~$10-14
// We charge slightly above cost so we don't bleed money on intl test orders
// (which until launch are mostly oren+amos+family in Israel â the audit
//  on 2026-05-01 showed 100% of orders had country_code=IL and we were
//  losing ~$3.88 per order on shipping alone).
// Per-country shipping (Gelato ships to 80+ countries). Expanded 2026-05-02
// after oren confirmed the US-only block was killing intl friend-of-brand orders.
// Rates are slightly above Gelato's actual cost so we don't bleed margin on intl.
const SHIPPING_FEE_BY_COUNTRY = {
    // North America
    US: 8.99, CA: 12.99, MX: 16.99,
    // UK + Europe
    GB: 12.99, IE: 12.99, DE: 12.99, FR: 12.99, IT: 12.99, ES: 12.99, NL: 12.99,
    PL: 12.99, SE: 12.99, NO: 14.99, DK: 12.99, FI: 14.99, BE: 12.99, AT: 12.99,
    CH: 14.99, PT: 12.99, GR: 14.99, CZ: 14.99, HU: 14.99, RO: 14.99, BG: 14.99,
    // Oceania
    AU: 14.99, NZ: 14.99,
    // Middle East
    IL: 14.99, AE: 16.99, SA: 16.99, TR: 14.99,
    // Asia
    JP: 16.99, SG: 16.99, HK: 16.99, KR: 16.99, MY: 16.99, TH: 16.99, PH: 16.99,
    ID: 16.99, VN: 16.99, IN: 16.99,
    // Latin America
    BR: 19.99, AR: 19.99, CL: 19.99, CO: 19.99,
    // Africa
    ZA: 19.99,
};
const FALLBACK_INTL_SHIPPING = 19.99; // any other country Gelato accepts

// ─── Dynamic shipping rates (full Gelato passthrough) ───────────────────
// Per oren 2026-05-16: customer pays exactly what Gelato charges us — no
// subsidy, no markup. Daily sync writes the current Gelato rate to app_config
// (gelato_ship_us_usd, gelato_ship_il_usd). We override the legacy static
// table above for US + IL specifically; other countries still fall back to
// the table until we add them to the daily probe.
window.__DUBIS_LIVE_SHIP = window.__DUBIS_LIVE_SHIP || { us: null, il: null };
(async function loadLiveShipping() {
    try {
        const url  = window.DUBIS_SUPABASE_URL;
        const anon = window.DUBIS_SUPABASE_ANON;
        if (!url || !anon) return;
        const r = await fetch(`${url}/rest/v1/app_config?select=key,value&key=in.(gelato_ship_us_usd,gelato_ship_il_usd)`, {
            headers: { 'apikey': anon, 'Authorization': `Bearer ${anon}` },
        });
        if (!r.ok) return;
        const rows = await r.json();
        for (const row of rows) {
            const v = Number(row.value);
            if (Number.isFinite(v)) {
                if (row.key === 'gelato_ship_us_usd') window.__DUBIS_LIVE_SHIP.us = v;
                if (row.key === 'gelato_ship_il_usd') window.__DUBIS_LIVE_SHIP.il = v;
            }
        }
    } catch (_) { /* fail-open to static table */ }
})();

function getShippingFee(country) {
    const c = (country || 'US').toUpperCase();
    // Prefer live Gelato rate when available (synced daily by gelato-stock-check).
    const live = window.__DUBIS_LIVE_SHIP || {};
    if (c === 'US' && live.us != null) return live.us;
    if (c === 'IL' && live.il != null) return live.il;
    return SHIPPING_FEE_BY_COUNTRY[c] != null ? SHIPPING_FEE_BY_COUNTRY[c] : FALLBACK_INTL_SHIPPING;
}

// Countries that use US-style state/province codes and require them at checkout.
// Everywhere else (IL, GB, most of Europe, etc.) either has no admin_area_1 or
// treats it as optional — blocking those customers behind a required "STATE"
// field killed IL conversions until 2026-05-17.
const COUNTRIES_REQUIRING_STATE = new Set(['US','CA','AU','IN','BR','MX']);
function countryNeedsState(code) {
    return COUNTRIES_REQUIRING_STATE.has((code || 'US').toUpperCase());
}
function updateStateFieldForCountry(code) {
    const stateEl = document.getElementById('checkout-state');
    if (!stateEl) return;
    const row    = document.getElementById('checkout-state-zip-row') || stateEl.parentElement;
    const c      = (code || 'US').toUpperCase();
    const isUS   = c === 'US';
    if (countryNeedsState(c)) {
        stateEl.style.display = '';
        stateEl.required = true;
        stateEl.placeholder = isUS ? 'State (e.g. CA)' : 'State / Province';
        stateEl.maxLength = isUS ? 2 : 40;
        stateEl.style.textTransform = isUS ? 'uppercase' : 'none';
        if (row) row.style.gridTemplateColumns = '1fr 1fr';
    } else {
        // Hide + clear so a stale US value doesn't leak into PayPal/Gelato.
        stateEl.style.display = 'none';
        stateEl.required = false;
        stateEl.value = '';
        if (row) row.style.gridTemplateColumns = '1fr';
    }
}

let paypalLoaded = false;
let appliedCoupon = null; // { code, discount_amount, final_total, name }

async function applyCoupon() {
    const code = (document.getElementById('coupon-input')?.value || '').trim().toUpperCase();
    const fb = document.getElementById('coupon-feedback');
    if (!code) { fb.textContent = 'Please enter a coupon code.'; fb.className = 'coupon-feedback error'; return; }
    fb.textContent = 'Checkingâ¦'; fb.className = 'coupon-feedback';
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
            fb.textContent = `Coupon applied: ${data.name} â ${discStr}. New total: $${data.final_total.toFixed(2)}`;
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

    if (window.dubisTrack) window.dubisTrack('checkout_start', { items: cart.length, total: cart.reduce((s,i)=>s+(i.price||0)*(i.quantity||1),0) });

    closeCart()
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

    // FB visitor → auto-apply the DUBIS15 welcome coupon (organic + paid). The
    // banner promises it; surface the discount before the customer eyeballs the
    // total so the FB→purchase funnel doesn't die at "wait, where's the 15%".
    if (typeof window.dubisCameFromFacebook === 'function' && window.dubisCameFromFacebook()) {
        if (cpInput) {
            cpInput.value = 'DUBIS15';
            setTimeout(() => { try { applyCoupon(); } catch(e) {} }, 80);
        }
    }

    // Show contact step + continue button, hide payment step
    const contactStep  = document.getElementById('contact-step');
    const paymentStep  = document.getElementById('payment-step');
    const continueRow  = document.getElementById('contact-continue-row');
    if (contactStep) contactStep.style.display = '';
    if (continueRow) continueRow.style.display = '';
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

    // Sync state-field visibility/required to currently-selected country.
    const ctryElInit = document.getElementById('checkout-country');
    updateStateFieldForCountry(ctryElInit?.value || 'US');
}

// ===== CONTACT STEP SUBMISSION =====
async function submitContactStep() {
    const nameEl  = document.getElementById('checkout-name');
    const emailEl = document.getElementById('checkout-email');
    const phoneEl = document.getElementById('checkout-phone');
    const addr1El = document.getElementById('checkout-addr1');
    const addr2El = document.getElementById('checkout-addr2');
    const cityEl  = document.getElementById('checkout-city');
    const stateEl = document.getElementById('checkout-state');
    const zipEl   = document.getElementById('checkout-zip');
    const ctryEl  = document.getElementById('checkout-country');
    const errEl   = document.getElementById('contact-step-error');

    const email = (emailEl?.value || '').trim();
    const phone = (phoneEl?.value || '').trim();
    const name  = (nameEl?.value  || '').trim();
    const addr1 = (addr1El?.value || '').trim();
    const addr2 = (addr2El?.value || '').trim();
    const city  = (cityEl?.value  || '').trim();
    const zip   = (zipEl?.value   || '').trim();
    const ctry  = (ctryEl?.value  || 'US').trim().toUpperCase();
    const needsState = countryNeedsState(ctry);
    const state = needsState
        ? (stateEl?.value || '').trim().toUpperCase()
        : (stateEl?.value || '').trim();

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
    if (!addr1 || addr1.length < 4) {
        errEl.textContent = 'Please enter your street address.';
        errEl.style.display = 'block';
        addr1El?.focus();
        return;
    }
    if (!city || city.length < 2) {
        errEl.textContent = 'Please enter your city.';
        errEl.style.display = 'block';
        cityEl?.focus();
        return;
    }
    if (needsState && (!state || state.length < 2)) {
        errEl.textContent = ctry === 'US'
            ? 'Please enter your state (2-letter code, e.g. CA).'
            : 'Please enter your state / province.';
        errEl.style.display = 'block';
        stateEl?.focus();
        return;
    }
    if (!zip || zip.length < 3) {
        errEl.textContent = 'Please enter your ZIP / postal code.';
        errEl.style.display = 'block';
        zipEl?.focus();
        return;
    }
    if (ctry === 'US' && !/^\d{5}(-\d{4})?$/.test(zip)) {
        errEl.textContent = 'Please enter a valid US ZIP code (5 digits).';
        errEl.style.display = 'block';
        zipEl?.focus();
        return;
    }

    // Store contact info globally for use in onApprove
    window.checkoutContact = { name, email, phone };
    // PayPal Orders v2 shipping.address shape â sent as SET_PROVIDED_ADDRESS
    // so PayPal does NOT silently use the buyer's profile address. The customer
    // sees their own address pre-filled at the PayPal step.
    window.checkoutAddress = {
        full_name:      name,
        address_line_1: addr1,
        address_line_2: addr2,
        admin_area_2:   city,        // city
        admin_area_1:   state,       // state / province
        postal_code:    zip,
        country_code:   ctry,
    };

    // Hide contact step + the continue button row, show payment step
    document.getElementById('contact-step').style.display  = 'none';
    const continueRow = document.getElementById('contact-continue-row');
    if (continueRow) continueRow.style.display = 'none';
    document.getElementById('payment-step').style.display  = '';

    // FB/IG in-app webview → skip PayPal SDK entirely (popup is blocked anyway)
    // and show the external-browser handoff directly.
    if (typeof window.dubisIsFacebookWebView === 'function' && window.dubisIsFacebookWebView()) {
        renderWebViewExternalHandoff();
        return;
    }

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
    // Do NOT use a silent direct PayPal link â orders won't be saved.
    // Show a clear error and ask user to refresh.
    document.getElementById('paypal-button-container').innerHTML = `
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;text-align:center;color:#856404">
            <strong>â ï¸ Payment system could not load.</strong><br>
            Please close this window, refresh the page, and try again.<br>
            <small>If the problem persists, contact us at <a href="mailto:dubis.brand@gmail.com" style="color:#856404">dubis.brand@gmail.com</a></small>
        </div>
    `;
}

// ===== FB / INSTAGRAM IN-APP WEBVIEW HANDOFF =====
// Replaces PayPal buttons with an "open in external browser" UI when the
// visitor is inside the FB or IG in-app browser, where PayPal popups die.
// We never want to render PayPal buttons here — the user clicks, sees nothing
// happen, and bounces. Show them how to bail out to Chrome/Safari instead.
function renderWebViewExternalHandoff() {
    const container = document.getElementById('paypal-button-container');
    if (!container) return;

    // Build the external URL with a flag so we can debug / track later.
    const cleanUrl = window.location.origin + window.location.pathname;
    const externalUrl = cleanUrl + '?ext=1#shop';
    // Android: intent:// URL forces Chrome to open the page. iOS has no equivalent
    // (Apple blocks programmatic browser handoff), so we rely on target=_blank
    // (sometimes pops out of FB) + a copy-link button as the universal fallback.
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    const intentUrl = 'intent://' + window.location.host + (window.location.pathname || '/') +
                      '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
                      encodeURIComponent(externalUrl) + ';end';

    container.innerHTML = `
        <div class="fb-webview-notice" dir="rtl">
            <h4>לתשלום מאובטח — פתח בדפדפן חיצוני</h4>
            <p>תשלום ב-PayPal / כרטיס אשראי לא עובד בדפדפן הפנימי של פייסבוק/אינסטגרם. פתח את האתר ב-Chrome או Safari כדי להשלים את ההזמנה. הקופון <strong>DUBIS15</strong> כבר מוחל בעגלה.</p>
            <div class="fb-webview-actions">
                ${isAndroid ? `<a class="fb-webview-btn" href="${intentUrl}">פתח ב-Chrome</a>` : ''}
                <a class="fb-webview-btn ${isAndroid ? 'secondary' : ''}" href="${externalUrl}" target="_blank" rel="noopener noreferrer">פתח בדפדפן ברירת מחדל</a>
                <button type="button" class="fb-webview-btn secondary" onclick="dubisCopyCheckoutLink(this)">העתק קישור לאתר</button>
            </div>
            <p class="fb-webview-hint">או: פתח את התפריט (⋯) בפינה הימנית-עליונה ובחר "Open in Safari" / "פתח ב-Chrome"</p>
        </div>
    `;
}

window.dubisCopyCheckoutLink = function(btn) {
    try {
        const url = window.location.origin + window.location.pathname + '?ext=1#shop';
        const done = (ok) => {
            if (!btn) return;
            const original = btn.textContent;
            btn.textContent = ok ? '✓ הקישור הועתק' : '⚠ העתק ידנית';
            setTimeout(() => { btn.textContent = original; }, 2500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => done(true)).catch(() => done(false));
        } else {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch(e) { ok = false; }
            document.body.removeChild(ta);
            done(ok);
        }
    } catch(e) { /* never throw — user can read the URL bar */ }
};

// ===== PHASE 2: SMART BUTTONS SDK =====
function loadPayPalSDK() {
    return new Promise((resolve, reject) => {
        if (paypalLoaded) { resolve(); return; }
        if (document.getElementById('paypal-sdk')) {
            if (typeof paypal !== 'undefined') { paypalLoaded = true; resolve(); return; }
        }
        const script    = document.createElement('script');
        script.id       = 'paypal-sdk';
        // enable-funding=card â renders separate "Debit or Credit Card" Guest Checkout button
        // components=buttons â explicit; disable-funding=credit removes "Pay Later" clutter
        script.src      = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture&enable-funding=card&disable-funding=credit&components=buttons`;
        script.onload   = () => { paypalLoaded = true; resolve(); };
        script.onerror  = () => reject(new Error('PayPal SDK unavailable'));
        document.head.appendChild(script);
    });
}

function renderPayPalButtons() {
    // FB/Instagram in-app webview short-circuit. The PayPal SDK opens its
    // login/card flow in a popup window — popups are blocked or silently
    // killed inside the FB/IG webview. Verified 2026-05-15: 88% of today's
    // traffic was FB organic, 83 product_view events, 0 purchases. Swap the
    // PayPal buttons for a "open in external browser" handoff so the customer
    // can complete checkout in Chrome / Safari. Their cart + DUBIS15 coupon
    // persist via localStorage and URL params on the handoff link.
    if (typeof window.dubisIsFacebookWebView === 'function' && window.dubisIsFacebookWebView()) {
        renderWebViewExternalHandoff();
        return;
    }

    const createOrder = async (data, actions) => {
        if (window.dubisTrack) window.dubisTrack('checkout_start', { items: cart.length, total: cart.reduce((s,i)=>s+i.price,0) });
        const itemTotal = cart.reduce((sum, i) => sum + i.price, 0);
        const ctry      = (window.checkoutAddress && window.checkoutAddress.country_code) || 'US';

        // 2026-05-20: PRE-CAPTURE STOCK PROBE — gate via Gelato /v4/orders:quote
        // (authoritative — uses the SAME routing logic as real order placement,
        // so quote success ≈ guaranteed fulfillable). Runs BEFORE order create.
        try {
            const probeRes = await fetch('/api/create-gelato-order?action=stock-probe', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    country: ctry,
                    shippingAddress: window.checkoutAddress || null,
                    cartItems: cart.map(item => ({
                        id: item.id, type: item.type, gender: item.gender || 'unisex',
                        selectedColor: item.selectedColor, selectedSize: item.selectedSize,
                        designRef: item.designRef || null,
                        typeLabel: item.typeLabel,
                    })),
                }),
            });
            const probe = await probeRes.json().catch(() => ({ ok: true, skipped: 'parse_error' }));
            if (probe.ok === false) {
                const oosLines = (probe.oosItems || []).map(o => `• ${o.label || (o.type + ' ' + o.color + ' ' + o.size)}`).join('\n');
                const reason = probe.reason || 'one or more items are out of stock for your country';
                const msg = `Sorry — ${reason}\n\n${oosLines || ''}\n\nPlease remove the affected item(s) or pick a different color/size, then try again.`;
                showPaymentError(msg);
                throw new Error('stock_probe_failed');
            }
        } catch (probeErr) {
            if (probeErr && probeErr.message === 'stock_probe_failed') throw probeErr;
            console.warn('Stock probe network error — proceeding to PayPal:', probeErr && probeErr.message);
        }

        const shipFee   = getShippingFee(ctry);
        const shipping  = itemTotal >= FREE_SHIPPING_THRESHOLD ? 0 : shipFee;
        const discountedTotal = appliedCoupon ? appliedCoupon.final_total : itemTotal;
        const total = discountedTotal + shipping;
        // Meta Pixel â InitiateCheckout event (fires when customer actually clicks PayPal/Card button)
        if (typeof fbq === 'function') {
            try {
                fbq('track', 'InitiateCheckout', {
                    value: total,
                    currency: 'USD',
                    num_items: cart.length,
                    content_ids: cart.map(i => String(i.id)),
                    content_type: 'product',
                });
            } catch (e) { /* pixel not critical */ }
        }
        // Stash for Purchase event in onApprove
        window.__dubisCheckoutTotal    = total;
        window.__dubisCheckoutIds      = cart.map(i => String(i.id));
        window.__dubisCheckoutShipping = shipping;
        window.__dubisCheckoutItemSub  = itemTotal;
        window.__dubisCheckoutDiscount = appliedCoupon ? (itemTotal - appliedCoupon.final_total) : 0;
        // PayPal Orders v2 breakdown rule (2026-04-23 fix â "snag" bug root cause):
        //   amount.value = item_total + shipping + handling + tax_total â discount
        //   item_total   = Î£(items[i].unit_amount Ã items[i].quantity)
        // Previous code DISCOUNTED item_total directly while leaving unit_amount at original
        // price â PayPal rejected with ITEM_TOTAL_MISMATCH â onError â "We hit a snag".
        // Correct approach: keep items at original prices, keep item_total = sum of items,
        // and express the coupon as breakdown.discount.
        const discountAmt = appliedCoupon ? Math.max(0, itemTotal - appliedCoupon.final_total) : 0;
        const breakdown = {
            item_total: { currency_code: 'USD', value: itemTotal.toFixed(2) },
            shipping:   { currency_code: 'USD', value: shipping.toFixed(2) }
        };
        if (discountAmt > 0) {
            breakdown.discount = { currency_code: 'USD', value: discountAmt.toFixed(2) };
        }
        // Pass the customer-entered shipping address to PayPal so the buyer
        // sees their address (no surprise) and so we don't depend on PayPal's
        // profile address â works for both PayPal-account and Guest Card flows.
        const addr = window.checkoutAddress || null;
        const purchaseUnit = {
            description: 'DUBIS Clothing Order',
            amount: {
                currency_code: 'USD',
                value: total.toFixed(2),
                breakdown: breakdown
            },
            items: cart.map(item => ({
                name:        item.phrase.substring(0, 127),
                unit_amount: { currency_code: 'USD', value: item.price.toFixed(2) },
                quantity:    '1',
                description: `${item.typeLabel} Â· ${item.selectedSize} Â· ${item.selectedColor}`
            }))
        };
        if (addr && addr.address_line_1) {
            purchaseUnit.shipping = {
                name:    { full_name: addr.full_name || (window.checkoutContact?.name || '') },
                address: {
                    address_line_1: addr.address_line_1,
                    address_line_2: addr.address_line_2 || '',
                    admin_area_2:   addr.admin_area_2,
                    admin_area_1:   addr.admin_area_1,
                    postal_code:    addr.postal_code,
                    country_code:   addr.country_code,
                },
            };
        }
        return actions.order.create({
            purchase_units: [purchaseUnit],
            application_context: {
                brand_name:          'DUBIS',
                // SET_PROVIDED_ADDRESS = PayPal must use OUR address (read-only on PayPal review screen)
                // so the buyer cannot silently swap to a different profile address mid-flow.
                shipping_preference: addr && addr.address_line_1 ? 'SET_PROVIDED_ADDRESS' : 'GET_FROM_FILE',
                // 2026-05-20 (Hila popup-stuck incident): without user_action='PAY_NOW',
                // PayPal renders "Continue" instead of "Pay Now" and DOESN'T auto-close
                // the checkoutnow window after capture — the buyer sits on
                // paypal.com/checkoutnow?... with a "תודה שהשתמשת ב-PayPal" screen
                // forever, while our onApprove already ran and showSuccessModal fired
                // on the parent tab they can't see. PAY_NOW forces the close+redirect
                // handshake — the popup/redirect closes itself and the parent tab gets focus.
                user_action: 'PAY_NOW',
                // Tell PayPal we want immediate completion, not a layered review step.
                // Combined with user_action above, this makes the Guest Card flow
                // (paypal.com/checkoutnow hosted page) close cleanly after capture.
                return_url: 'https://www.dubis.net/?paypal_return=1',
                cancel_url: 'https://www.dubis.net/?paypal_cancel=1',
            },
        });
    };

    const onApprove = async (data, actions) => {
            try {
                // 2026-05-20 round-2 PROBE — re-validate stock IMMEDIATELY before
                // capture. The createOrder probe may have run 30 sec to 2 min ago;
                // Gelato stock can change in that window. This second probe runs
                // milliseconds before actions.order.capture(), closing the race
                // window to ~1 second. If it fails, throw — no capture happens.
                try {
                    const ctry2 = (window.checkoutAddress && window.checkoutAddress.country_code) || 'US';
                    const reProbe = await fetch('/api/create-gelato-order?action=stock-probe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            country: ctry2,
                            shippingAddress: window.checkoutAddress || null,
                            cartItems: cart.map(item => ({
                                id: item.id, type: item.type, gender: item.gender || 'unisex',
                                selectedColor: item.selectedColor, selectedSize: item.selectedSize,
                                designRef: item.designRef || null,
                                typeLabel: item.typeLabel,
                            })),
                        }),
                    });
                    const reProbeData = await reProbe.json().catch(() => ({ ok: true, skipped: 'parse_error' }));
                    if (reProbeData.ok === false) {
                        const oosLines = (reProbeData.oosItems || []).map(o => `• ${o.label || (o.type + ' ' + o.color + ' ' + o.size)}`).join('\n');
                        const reason = reProbeData.reason || 'one or more items just went out of stock';
                        showPaymentError(`Sorry — ${reason}\n\n${oosLines || ''}\n\nYour card was NOT charged. Please refresh the cart and try again.`);
                        // PayPal already authorized but NOT yet captured — by throwing
                        // here, actions.order.capture() is never called, the auth
                        // expires harmlessly, and no money moves.
                        throw new Error('stock_probe_failed_pre_capture');
                    }
                } catch (probeErr) {
                    if (probeErr && probeErr.message === 'stock_probe_failed_pre_capture') throw probeErr;
                    console.warn('Pre-capture re-probe network error — proceeding to capture:', probeErr && probeErr.message);
                }

                const details  = await actions.order.capture();
                const shipping = details.purchase_units[0]?.shipping;
                if (window.dubisTrack) window.dubisTrack('purchase', { paypal_id: details.id, items: cart.length, total: cart.reduce((s,i)=>s+i.price,0) });

                // Meta Pixel â Purchase event (fixed: totalAmount was undefined)
                if (typeof fbq === 'function') {
                    try {
                        const purchaseTotal = window.__dubisCheckoutTotal
                            || cart.reduce((s,i)=>s+i.price,0);
                        fbq('track', 'Purchase', {
                            value: purchaseTotal,
                            currency: 'USD',
                            content_type: 'product',
                            num_items: cart.length,
                            content_ids: window.__dubisCheckoutIds || cart.map(i => String(i.id)),
                        });
                    } catch (e) { /* pixel not critical */ }
                }

                // Prefer the address the customer just typed into our form â it's the
                // one they expect to see on the confirmation. PayPal's profile address
                // is only a fallback (e.g. if SET_PROVIDED_ADDRESS was rejected).
                const ourAddr = window.checkoutAddress || null;
                const shippingAddress = ourAddr ? {
                    name:           ourAddr.full_name || (window.checkoutContact?.name || ''),
                    address_line_1: ourAddr.address_line_1 || '',
                    address_line_2: ourAddr.address_line_2 || '',
                    admin_area_2:   ourAddr.admin_area_2 || '',
                    admin_area_1:   ourAddr.admin_area_1 || '',
                    postal_code:    ourAddr.postal_code || '',
                    country_code:   ourAddr.country_code || 'US',
                    phone:          window.checkoutContact?.phone || '',
                } : {
                    name:           shipping?.name?.full_name || '',
                    address_line_1: shipping?.address?.address_line_1 || '',
                    address_line_2: shipping?.address?.address_line_2 || '',
                    admin_area_1:   shipping?.address?.admin_area_1 || '',
                    admin_area_2:   shipping?.address?.admin_area_2 || '',
                    country_code:   shipping?.address?.country_code || '',
                    postal_code:    shipping?.address?.postal_code || '',
                    phone:          window.checkoutContact?.phone || '',
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

                // ââ 1. Send to Gelato ââââââââââââââââââââââââââââââââ
                // If Gelato rejects (e.g. out of stock), create-gelato-order auto-refunds
                // via PayPal and returns { refunded: true, refundId }. In that case we
                // show a refund message instead of success.
                let printfulOrderId = null;
                let gelatoRefundInfo = null; // { refunded, refundId, gelatoError }
                // 2026-05-20: when create-gelato-order detects an incomplete
                // shipping address it holds the order and emails the customer
                // for confirmation. We pass that through to save.js so the DB
                // row reflects the held state instead of being misreported.
                let addressHoldInfo = null;  // { missingFields, confirmationToken }
                // 2026-05-20 (Hila $94.35 incident): server returned 500 →
                // pfRes.json() threw → fell through to showSuccessModal even
                // though no order was created and no refund issued. This flag
                // forces a clear error modal instead of a fake success.
                let gelatoDispatchFailed = false;
                let gelatoDispatchError  = '';
                try {
                    const pfRes  = await fetch('/api/create-gelato-order', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            paypalOrderId:   details.id,
                            buyerEmail:      details.payer?.email_address || window.checkoutContact?.email || '',
                            shippingAddress,
                            cartItems:       cartSnapshot,
                        }),
                    });
                    // Try JSON first; if it fails, fall back to text so we can surface it.
                    let pfData = null;
                    let pfRawText = '';
                    try {
                        pfData = await pfRes.clone().json();
                    } catch (_jsonErr) {
                        try { pfRawText = await pfRes.text(); } catch (_) {}
                        pfData = null;
                    }
                    if (!pfRes.ok || !pfData) {
                        gelatoDispatchFailed = true;
                        gelatoDispatchError  = `server returned ${pfRes.status}${pfRawText ? ': ' + pfRawText.slice(0, 200) : ''}`;
                        console.error('Gelato dispatch — bad response:', pfRes.status, pfRawText.slice(0, 300));
                    }
                    if (pfData) {
                        if (pfData.gelatoOrderId)  printfulOrderId = String(pfData.gelatoOrderId);
                        if (pfData.printfulOrderId && !printfulOrderId) printfulOrderId = String(pfData.printfulOrderId);
                        if (pfData.refunded || pfData.reason === 'gelato_rejected_refunded' || pfData.reason === 'handler_exception_refunded' || pfData.reason === 'design_invalid_refunded') {
                            gelatoRefundInfo = {
                                refunded:    true,
                                refundId:    pfData.refundId || null,
                                gelatoError: pfData.gelatoError || '',
                            };
                        }
                        if (pfData.addressMissing || pfData.reason === 'address_missing') {
                            addressHoldInfo = {
                                missingFields:     pfData.missingFields  || [],
                                hebrewFields:      pfData.hebrewFields   || [],
                                confirmationToken: pfData.confirmationToken || null,
                            };
                        }
                        // If the response has none of the success/refund/hold signals, treat as dispatch failure.
                        if (!printfulOrderId && !gelatoRefundInfo && !addressHoldInfo && !pfData.manual) {
                            gelatoDispatchFailed = true;
                            gelatoDispatchError  = pfData.gelatoError || pfData.error || pfData.message || 'incomplete response';
                        }
                    }
                } catch (err) {
                    gelatoDispatchFailed = true;
                    gelatoDispatchError  = err && err.message ? err.message : 'network error';
                    console.error('Gelato dispatch failed:', err);
                }

                // ââ 2. Save order to Supabase DB âââââââââââââââââââââ
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
                            // NEW (2026-04-22 postmortem fix): DB was storing only items subtotal.
                            shippingAmount:  Number(window.__dubisCheckoutShipping) || 0,
                            totalAmount:     Number(window.__dubisCheckoutTotal)
                                             || (Number(window.__dubisCheckoutItemSub) || 0) + (Number(window.__dubisCheckoutShipping) || 0),
                            // 2026-05-06: Attribution — first-touch UTMs from landing.
                            // Without this, ROAS is unmeasurable (the lesson from the IL/US
                            // campaign post-mortem on 2026-05-06).
                            attribution: (typeof window.dubisGetAttribution === 'function') ? window.dubisGetAttribution() : null,
                            // 2026-05-20: held for address confirmation — status='pending_address_confirmation'
                            pendingAddressConfirmation: !!addressHoldInfo,
                        }),
                    });
                    const saveData = await saveRes.json();
                    if (saveData.orderId) savedOrderId = saveData.orderId;
                } catch (err) {
                    console.error('Order save failed:', err);
                }

                // ââ 3. Send confirmation email ââââââââââââââââââââââââ
                try {
                    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
                    const itemsSubtotalEmail = cartSnapshot.reduce((s, i) => s + (Number(i.price) || 0), 0);
                    await fetch('/api/email/confirm-order', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            buyerEmail:      details.payer?.email_address || window.checkoutContact?.email || '',
                            buyerName:       user?.user_metadata?.full_name || window.checkoutContact?.name || details.payer?.name?.given_name || '',
                            orderId:         savedOrderId,
                            paypalOrderId:   details.id,
                            items:           cartSnapshot,
                            // Real money breakdown â was missing before, now lines up with checkout.
                            itemsSubtotal:   itemsSubtotalEmail,
                            shippingAmount:  Number(window.__dubisCheckoutShipping) || 0,
                            discountAmount:  Number(window.__dubisCheckoutDiscount) || 0,
                            couponCode:      appliedCoupon?.code || null,
                            totalAmount:     Number(window.__dubisCheckoutTotal) || itemsSubtotalEmail,
                            // Shipping address â so the customer can see where it's going,
                            // and so they have written proof we captured it.
                            shippingAddress: shippingAddress,
                        }),
                    });
                } catch (err) {
                    console.error('Confirmation email failed:', err);
                }
                // ââ 4. GA4 purchase event âââââââââââââââââââââââââââââ
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
                // âââââââââââââââââââââââââââââââââââââââââââââââââââââ

                closePaypalModal();
                cart = [];
                saveCart();
                updateCartCount();
                if (addressHoldInfo) {
                    showAddressHoldModal(addressHoldInfo);
                } else if (gelatoRefundInfo && gelatoRefundInfo.refunded) {
                    showRefundModal(gelatoRefundInfo);
                } else if (gelatoDispatchFailed && !printfulOrderId) {
                    // 2026-05-20 Hila incident — never silently lie about success.
                    showPaymentError(
                        'Payment captured but our system could not place the print order ('
                        + (gelatoDispatchError || 'unknown error')
                        + '). The DUBIS team has been notified and you should see a refund within 1 hour. '
                        + 'If not, email dubis.brand@gmail.com.'
                    );
                } else {
                    showSuccessModal();
                }
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
        // NOTE: PayPal's onError can fire for transient issues (network blips, SDK init
        // failures, window-resize races) â sometimes even AFTER a successful capture.
        // It is NOT a reliable signal that payment failed.  Our authoritative failure
        // path is the onApprove/capture try-catch.  Here we only show a non-blocking
        // banner that does NOT destroy the button container, so the user can retry.
        console.error('PayPal SDK error event:', err);
        showPaymentErrorBanner('We hit a snag connecting to PayPal. If the payment did not go through, please try again.');
    };

    // Messaging above the buttons â makes Guest Checkout visible to the 60%+ of US users who don't have PayPal
    const container = document.getElementById('paypal-button-container');
    if (container && !container.querySelector('.cc-messaging')) {
        const msg = document.createElement('div');
        msg.className = 'cc-messaging';
        msg.style.cssText = 'text-align:center;margin:0 0 12px;padding:10px 12px;background:#f5f1e8;border:1px solid #e2d9c4;border-radius:8px;font-size:13px;color:#2b2b2b;';
        msg.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">ð³ Pay with any credit or debit card</div>
            <div style="font-size:12px;color:#666;">No PayPal account required. We accept Visa, Mastercard, Amex, and Discover.</div>
            <div style="margin-top:8px;font-size:18px;letter-spacing:2px;color:#0f1a2e;">
                <span title="Visa">ð³</span>
                <span title="Mastercard">ð³</span>
                <span title="Amex">ð³</span>
                <span title="Discover">ð³</span>
                <span style="font-size:12px;color:#999;margin-inline-start:8px;">& PayPal</span>
            </div>
        `;
        container.parentNode.insertBefore(msg, container);
    }

    // PayPal button (for users with PayPal accounts)
    paypal.Buttons({
        fundingSource: paypal.FUNDING.PAYPAL,
        style: { color: 'black', shape: 'rect', label: 'pay', height: 50 },
        createOrder, onApprove, onError, onCancel: () => {}
    }).render('#paypal-button-container');

    // Credit/Debit card button (Guest Checkout â no PayPal account needed)
    // This is critical for US customers who don't use PayPal.
    if (paypal.FUNDING && paypal.FUNDING.CARD) {
        try {
            paypal.Buttons({
                fundingSource: paypal.FUNDING.CARD,
                style: { color: 'black', shape: 'rect', label: 'pay', height: 50 },
                createOrder, onApprove, onError, onCancel: () => {}
            }).render('#paypal-button-container');
        } catch (e) {
            console.warn('Card funding button not available:', e);
        }
    }
}

// ===== ORDER SUMMARY =====
function renderOrderSummary() {
    const itemTotal = cart.reduce((sum, item) => sum + item.price, 0);
    // Read country from the address form if it's mounted; default US.
    const ctryEl = document.getElementById('checkout-country');
    const ctry   = (ctryEl && ctryEl.value) || (window.checkoutAddress && window.checkoutAddress.country_code) || 'US';
    const shipFee   = getShippingFee(ctry);
    const shipping  = itemTotal >= FREE_SHIPPING_THRESHOLD ? 0 : shipFee;
    const couponDiscount = appliedCoupon ? (itemTotal - appliedCoupon.final_total) : 0;
    const grandTotal = itemTotal - couponDiscount + shipping;
    // Lang-aware currency display in checkout. PayPal always charges USD â
    // when customer browses in Hebrew with ILS shown, we explicitly disclose
    // the USD charge so they aren't surprised at the PayPal handoff.
    const isHe = (typeof currentLang !== 'undefined' && currentLang === 'he');
    const ils = (usd) => 'âª' + Math.round(usd * (typeof USD_TO_ILS !== 'undefined' ? USD_TO_ILS : 3.63));
    const fmt = (usd) => isHe ? ils(usd) : '$' + Number(usd).toFixed(2);
    const fmtFree = isHe ? '<span style="color:var(--honey);font-weight:600">××× × ð</span>' : '<span style="color:var(--honey);font-weight:600">FREE ð</span>';

    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - itemTotal);
    const pct = Math.min(100, (itemTotal / FREE_SHIPPING_THRESHOLD) * 100);

    document.getElementById('paypal-order-summary').innerHTML = `
        <!-- Free shipping progress bar -->
        <div class="free-ship-progress">
            <div class="free-ship-progress-label ${shipping === 0 ? 'reached' : ''}">
                ${shipping === 0
                    ? 'ð You\'ve got free shipping!'
                    : `Add <strong>$${remaining.toFixed(2)}</strong> more for free shipping`}
            </div>
            <div class="free-ship-bar-track">
                <div class="free-ship-bar-fill" style="width:${pct}%"></div>
            </div>
        </div>

        <!-- Items list -->
        <div class="order-items">
            ${cart.map(item => {
                const colorFile = (item.selectedColor || '').replace(/\s+/g, '-');
                const variantImg = colorFile ? `images/product-${item.id}-${colorFile}-front.jpg` : (item.image || '');
                return `
                <div class="order-item">
                    <img src="${variantImg}" alt="${item.phrase}" class="order-item-img" onerror="this.onerror=null;this.src='${item.image||''}'" />
                    <div class="order-item-info">
                        <div class="order-item-name">"${item.phrase}"</div>
                        <div class="order-item-details">${item.typeLabel} Â· ${item.selectedSize} Â· ${item.selectedColor}</div>
                    </div>
                    <div class="order-item-price">${fmt(item.price)}</div>
                </div>`;
            }).join('')}
        </div>

        <!-- Totals -->
        <div class="order-totals">
            <div class="order-total-row">
                <span>${isHe ? '×¡×"× ××× ×××' : 'Subtotal'}</span>
                <span>${fmt(itemTotal)}</span>
            </div>
            ${couponDiscount > 0 ? `
            <div class="order-total-row discount">
                <span>${isHe ? '×§××¤××' : 'Coupon'} (${appliedCoupon?.code})</span>
                <span>â${fmt(couponDiscount)}</span>
            </div>` : ''}
            <div class="order-total-row">
                <span>${isHe ? '××©×××' : 'Shipping'}</span>
                <span>${shipping === 0 ? fmtFree : fmt(shipping)}</span>
            </div>
            <div class="order-total-row total">
                <span>${isHe ? '×¡×"×' : 'Total'}</span>
                <span>${fmt(grandTotal)}</span>
            </div>
        </div>
        ${isHe ? `
        <div style="margin-top:10px;padding:10px 12px;background:#fef9e7;border:1px solid #f1c40f33;border-radius:6px;font-size:12px;color:#5d4e1f;line-height:1.5">
            ð³ <strong>PayPal ××××× ×××××¨××:</strong> $${grandTotal.toFixed(2)}<br>
            <span style="font-size:11px;opacity:0.8">×××¨× ××©××¢×¨×ª â ××¡××× ××¡××¤× ×××¨×××¡ ×××× ××¤× ×©×¢×¨ ××¡××¨× ×©× PayPal ×××× ×××××.</span>
        </div>` : ''}
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

// Auto-refund modal â shown when Gelato rejects the order and we've refunded PayPal.
// Uses the existing success-modal element so no DOM changes needed â just rewrites content.
function showRefundModal(info) {
    const modal = document.getElementById('success-modal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content') || modal.firstElementChild || modal;
    if (content) {
        content.innerHTML = `
            <h2 style="color:#b45309;margin:0 0 16px;font-size:22px">Order refunded â item unavailable</h2>
            <p style="margin:0 0 12px;color:#374151">We're sorry â the item you ordered just went out of stock at our fulfillment partner. Your payment has been refunded automatically.</p>
            <p style="margin:0 0 12px;color:#374151">You should see the refund on your statement in 3â5 business days.</p>
            ${info.refundId ? `<p style="margin:0 0 20px;color:#6b7280;font-size:13px">Refund reference: <code>${info.refundId}</code></p>` : ''}
            <button onclick="closeSuccessModal()" style="display:block;width:100%;padding:12px;background:#111;color:#fff;border:none;cursor:pointer;font-size:14px;border-radius:4px">Close</button>
        `;
    }
    modal.classList.add('open');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('open');
}

// Address-hold modal — payment succeeded but shipping address fields
// were missing/garbage. The customer also gets an email with a link
// to confirm-address.html, but we show them the same news on screen
// so they don't bounce thinking nothing happened.
function showAddressHoldModal(info) {
    const modal = document.getElementById('success-modal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content') || modal.firstElementChild || modal;
    const missing = Array.isArray(info?.missingFields) ? info.missingFields : [];
    const hebrew  = Array.isArray(info?.hebrewFields)  ? info.hebrewFields  : [];
    const fieldLabels = {
        name: 'name', address_line_1: 'street address', address_line_2: 'apartment',
        city: 'city', state: 'state / province',
        postal_code: 'ZIP/postal code', country: 'country',
        phone: 'phone', email: 'email',
    };
    const missingText = missing.map(f => fieldLabels[f] || f).join(', ');
    const hebrewText  = hebrew.map(f => fieldLabels[f] || f).join(', ');

    // Different lead copy depending on the failure mode. Hebrew-only is the
    // most common IL case — be explicit so the customer understands what to fix.
    let body;
    if (hebrew.length && !missing.length) {
        body = `
            <p style="margin:0 0 12px;color:#374151">Your payment went through, but the shipping address has Hebrew text in <strong>${hebrewText}</strong>. Our shipping carrier can only print Latin characters on the label, so we need to re-enter it in English.</p>`;
    } else if (hebrew.length && missing.length) {
        body = `
            <p style="margin:0 0 12px;color:#374151">Your payment went through, but the shipping address needs a fix:</p>
            <ul style="margin:0 0 12px;padding-left:20px;color:#374151;line-height:1.7">
                <li>Missing: <strong>${missingText}</strong></li>
                <li>In Hebrew (needs English): <strong>${hebrewText}</strong></li>
            </ul>`;
    } else {
        body = `
            <p style="margin:0 0 12px;color:#374151">Your payment went through, but we need to confirm your shipping address before we can send the order to print. We're missing: <strong>${missingText || 'a few address fields'}</strong>.</p>`;
    }

    if (content) {
        content.innerHTML = `
            <h2 style="color:#b45309;margin:0 0 16px;font-size:22px">Payment received — one more thing</h2>
            ${body}
            <p style="margin:0 0 12px;color:#374151">We've emailed you a link to confirm the address. If you don't see it within a few minutes, check spam or reply to <a href="mailto:hello@dubis.net" style="color:#c8a96e">hello@dubis.net</a>.</p>
            <p style="margin:0 0 20px;color:#6b7280;font-size:13px">Your money is safe — nothing ships until you confirm.</p>
            <button onclick="closeSuccessModal()" style="display:block;width:100%;padding:12px;background:#111;color:#fff;border:none;cursor:pointer;font-size:14px;border-radius:4px">Got it</button>
        `;
    }
    modal.classList.add('open');
}

// ===== PAYMENT STATE HELPERS =====
function showPaymentProcessing() {
    const container = document.getElementById('paypal-button-container');
    if (container) container.innerHTML = '<div style="text-align:center;padding:32px;color:#666">Processing paymentâ¦</div>';
}

// Hard failure â payment definitively did not go through (capture threw, etc.)
// Replaces the container so user can't click again on a broken state.
function showPaymentError(msg) {
    const container = document.getElementById('paypal-button-container');
    if (container) container.innerHTML = `
        <p style="color:#c00;text-align:center;padding:16px;margin:0">${msg}</p>
        <button onclick="closePaypalModal()" style="display:block;width:100%;margin-top:8px;padding:12px;background:#111;color:#fff;border:none;cursor:pointer;font-size:14px">Close</button>
    `;
}

// Soft warning â transient PayPal SDK error.  Does NOT destroy the buttons,
// so the user can retry without reopening the modal. Banner auto-dismisses
// after 10s or on next successful interaction.
function showPaymentErrorBanner(msg) {
    const container = document.getElementById('paypal-button-container');
    if (!container) return;
    // Remove any previous banner
    const prev = container.querySelector('.pp-err-banner');
    if (prev) prev.remove();
    const banner = document.createElement('div');
    banner.className = 'pp-err-banner';
    banner.style.cssText = 'background:#fff4e5;border:1px solid #ffb366;color:#8a3b00;padding:10px 12px;margin:0 0 12px;border-radius:8px;font-size:13px;text-align:center;';
    banner.textContent = msg;
    container.insertBefore(banner, container.firstChild);
    setTimeout(() => banner.remove(), 10_000);
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

    // Re-render the order summary when the customer picks a different country â
    // shipping is country-aware (US: $8.99, IL/intl: up to $14.99) so the total
    // must update on the fly. Without this, the customer sees a US price and
    // the real charge happens at PayPal capture, breaking trust.
    const ctryEl = document.getElementById('checkout-country');
    if (ctryEl) {
        ctryEl.addEventListener('change', () => {
            try { updateStateFieldForCountry(ctryEl.value); } catch (e) { /* DOM not ready */ }
            try { renderOrderSummary(); } catch (e) { /* modal not open yet */ }
        });
    }
});
