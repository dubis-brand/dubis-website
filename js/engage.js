// DUBIS — Engagement: Newsletter Popup + Abandoned Cart Recovery
// Agent: CTO | March 2026

(function() {
  'use strict';

  const SUPABASE_URL  = window.DUBIS_SUPABASE_URL;
  const SUPABASE_ANON = window.DUBIS_SUPABASE_ANON;

  // ═══════════════════════════════════════════════════════════
  // 1. NEWSLETTER POPUP  —  "Get 15% off your first order"
  // ═══════════════════════════════════════════════════════════

  const POPUP_DELAY_MS   = 12000;  // Show after 12s on site
  const POPUP_SCROLL_PCT = 35;     // …or after scrolling 35%
  const POPUP_DISMISS_KEY = 'dubis_popup_dismissed';
  const POPUP_SUB_KEY     = 'dubis_subscribed';

  function hasSeenPopup() {
    try {
      return localStorage.getItem(POPUP_DISMISS_KEY) === '1' ||
             localStorage.getItem(POPUP_SUB_KEY)     === '1';
    } catch { return false; }
  }

  function markPopupDismissed() {
    try { localStorage.setItem(POPUP_DISMISS_KEY, '1'); } catch {}
  }

  function markSubscribed() {
    try { localStorage.setItem(POPUP_SUB_KEY, '1'); } catch {}
  }

  function createPopupHTML() {
    const isHe = (typeof currentLang !== 'undefined' && currentLang === 'he');
    const dir = isHe ? 'rtl' : 'ltr';

    const title    = isHe ? '🐾 קבל 15% הנחה' : '🐾 Get 15% Off';
    const subtitle = isHe ? 'הצטרף למשפחת DUBIS וקבל קוד הנחה על ההזמנה הראשונה שלך.' : 'Join the DUBIS fam and get a discount code for your first order.';
    const placeholder = isHe ? 'הכנס אימייל' : 'Enter your email';
    const btnText  = isHe ? 'שלח לי את הקוד!' : 'Send me the code!';
    const noThanks = isHe ? 'לא תודה' : 'No thanks';
    const successMsg = isHe ? '✅ בדוק את המייל! הקוד שלך: DUBIS15' : '✅ Check your email! Your code: DUBIS15';

    return `
    <div class="dubis-popup-overlay" id="dubis-popup-overlay">
      <div class="dubis-popup" dir="${dir}">
        <button class="dubis-popup-close" id="dubis-popup-close" aria-label="Close">&times;</button>
        <div class="dubis-popup-body">
          <h3 class="dubis-popup-title">${title}</h3>
          <p class="dubis-popup-sub">${subtitle}</p>
          <div class="dubis-popup-form" id="dubis-popup-form">
            <input type="email" id="dubis-popup-email" class="dubis-popup-input" placeholder="${placeholder}" autocomplete="email" />
            <button id="dubis-popup-submit" class="dubis-popup-btn">${btnText}</button>
          </div>
          <div class="dubis-popup-success hidden" id="dubis-popup-success">${successMsg}</div>
          <button class="dubis-popup-dismiss" id="dubis-popup-dismiss">${noThanks}</button>
        </div>
      </div>
    </div>`;
  }

  function injectPopup() {
    if (hasSeenPopup()) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = createPopupHTML();
    document.body.appendChild(wrapper);

    // Bind events
    document.getElementById('dubis-popup-close').addEventListener('click', dismissPopup);
    document.getElementById('dubis-popup-dismiss').addEventListener('click', dismissPopup);
    document.getElementById('dubis-popup-overlay').addEventListener('click', function(e) {
      if (e.target === this) dismissPopup();
    });
    document.getElementById('dubis-popup-submit').addEventListener('click', submitPopup);
    document.getElementById('dubis-popup-email').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submitPopup();
    });
  }

  function showPopup() {
    if (hasSeenPopup()) return;
    const overlay = document.getElementById('dubis-popup-overlay');
    if (!overlay) { injectPopup(); }
    const el = document.getElementById('dubis-popup-overlay');
    if (el) el.classList.add('visible');
  }

  function dismissPopup() {
    const el = document.getElementById('dubis-popup-overlay');
    if (el) el.classList.remove('visible');
    markPopupDismissed();
  }

  async function submitPopup() {
    const input = document.getElementById('dubis-popup-email');
    const email = (input.value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      input.style.borderColor = '#e74c3c';
      input.focus();
      return;
    }

    const btn = document.getElementById('dubis-popup-submit');
    btn.textContent = '...';
    btn.disabled = true;

    // Save to Supabase newsletter_subscribers table
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/newsletter_subscribers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          email: email,
          source: 'popup',
          coupon_sent: 'DUBIS15',
          subscribed_at: new Date().toISOString()
        })
      });
      // 201 Created or 409 Conflict (duplicate) — both are fine
    } catch (e) {
      console.warn('Newsletter signup error:', e);
    }

    // Show success
    document.getElementById('dubis-popup-form').classList.add('hidden');
    document.getElementById('dubis-popup-success').classList.remove('hidden');
    document.getElementById('dubis-popup-dismiss').classList.add('hidden');
    markSubscribed();

    // Auto-close after 4s
    setTimeout(dismissPopup, 4000);
  }

  // Trigger: time-based OR scroll-based
  function initPopup() {
    if (hasSeenPopup()) return;
    injectPopup();

    // Time trigger
    setTimeout(showPopup, POPUP_DELAY_MS);

    // Scroll trigger
    let scrollTriggered = false;
    window.addEventListener('scroll', function() {
      if (scrollTriggered || hasSeenPopup()) return;
      const scrollPct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
      if (scrollPct >= POPUP_SCROLL_PCT) {
        scrollTriggered = true;
        showPopup();
      }
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════════
  // 2. ABANDONED CART RECOVERY
  // ═══════════════════════════════════════════════════════════

  const CART_STORAGE_KEY  = 'dubis_cart';
  const CART_TIME_KEY     = 'dubis_cart_time';
  const CART_SHOWN_KEY    = 'dubis_cart_recovery_shown';
  const CART_MIN_AGE_MS   = 30 * 60 * 1000;  // 30 minutes

  // Save cart to localStorage whenever it changes
  function persistCart() {
    try {
      if (typeof cart !== 'undefined' && cart.length > 0) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        localStorage.setItem(CART_TIME_KEY, Date.now().toString());
      } else {
        localStorage.removeItem(CART_STORAGE_KEY);
        localStorage.removeItem(CART_TIME_KEY);
      }
    } catch {}
  }

  // Restore cart on page load if returning visitor
  function restoreCart() {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (!saved) return;
      const savedCart = JSON.parse(saved);
      if (!Array.isArray(savedCart) || savedCart.length === 0) return;

      // Only restore if current cart is empty
      if (typeof cart !== 'undefined' && cart.length === 0) {
        // Validate items still exist in products
        const validItems = savedCart.filter(item => {
          return typeof products !== 'undefined' && products.find(p => p.id === item.id);
        });
        if (validItems.length > 0) {
          // Restore cart items
          validItems.forEach(item => cart.push(item));
          if (typeof updateCartCount === 'function') updateCartCount();
          showCartRecoveryBanner(validItems.length);
        }
      }
    } catch {}
  }

  function showCartRecoveryBanner(itemCount) {
    try {
      if (localStorage.getItem(CART_SHOWN_KEY) === '1') return;
    } catch {}

    const isHe = (typeof currentLang !== 'undefined' && currentLang === 'he');
    const msg = isHe
      ? `🛒 שכחת משהו? יש לך ${itemCount} פריטים בעגלה!`
      : `🛒 Forgot something? You have ${itemCount} item${itemCount > 1 ? 's' : ''} in your cart!`;
    const btnText = isHe ? 'צפה בעגלה' : 'View Cart';
    const dismissText = isHe ? 'התעלם' : 'Dismiss';

    const banner = document.createElement('div');
    banner.className = 'dubis-cart-recovery';
    banner.innerHTML = `
      <div class="cart-recovery-inner">
        <span class="cart-recovery-msg">${msg}</span>
        <div class="cart-recovery-actions">
          <button class="cart-recovery-btn" id="cart-recovery-view">${btnText}</button>
          <button class="cart-recovery-dismiss" id="cart-recovery-dismiss">${dismissText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => banner.classList.add('visible'));

    document.getElementById('cart-recovery-view').addEventListener('click', function() {
      banner.remove();
      if (typeof openCart === 'function') openCart();
      try { localStorage.setItem(CART_SHOWN_KEY, '1'); } catch {}
    });

    document.getElementById('cart-recovery-dismiss').addEventListener('click', function() {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 400);
      try { localStorage.setItem(CART_SHOWN_KEY, '1'); } catch {}
    });

    // Auto-dismiss after 15s
    setTimeout(() => {
      if (document.body.contains(banner)) {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 400);
      }
    }, 15000);
  }

  // Hook into cart modifications to persist
  function hookCartPersistence() {
    // Override addToCartFromModal
    const origAdd = window.addToCartFromModal;
    if (origAdd) {
      window.addToCartFromModal = function() {
        origAdd.apply(this, arguments);
        persistCart();
        // Clear recovery shown flag so future recovery works
        try { localStorage.removeItem(CART_SHOWN_KEY); } catch {}
      };
    }

    // Override quickAddToCart
    const origQuick = window.quickAddToCart;
    if (origQuick) {
      window.quickAddToCart = function() {
        origQuick.apply(this, arguments);
        persistCart();
        try { localStorage.removeItem(CART_SHOWN_KEY); } catch {}
      };
    }

    // Override removeFromCart
    const origRemove = window.removeFromCart;
    if (origRemove) {
      window.removeFromCart = function() {
        origRemove.apply(this, arguments);
        persistCart();
      };
    }

    // Clear cart storage after successful order
    // Hook into the success modal display
    const origSuccessModal = window.showSuccessModal || window.openSuccessModal;
    if (origSuccessModal) {
      const fnName = window.showSuccessModal ? 'showSuccessModal' : 'openSuccessModal';
      window[fnName] = function() {
        origSuccessModal.apply(this, arguments);
        try {
          localStorage.removeItem(CART_STORAGE_KEY);
          localStorage.removeItem(CART_TIME_KEY);
          localStorage.removeItem(CART_SHOWN_KEY);
        } catch {}
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. EXIT-INTENT DETECTION (Desktop only)
  // ═══════════════════════════════════════════════════════════

  function initExitIntent() {
    if ('ontouchstart' in window) return; // Skip on mobile

    let exitShown = false;
    document.addEventListener('mouseout', function(e) {
      if (exitShown) return;
      if (e.clientY <= 5 && typeof cart !== 'undefined' && cart.length > 0) {
        exitShown = true;
        showExitIntentBanner();
      }
    });
  }

  function showExitIntentBanner() {
    const isHe = (typeof currentLang !== 'undefined' && currentLang === 'he');
    const msg = isHe ? '⏳ רגע! יש לך פריטים בעגלה — קוד DUBIS15 = 15% הנחה!' : '⏳ Wait! Items in your cart — use DUBIS15 for 15% off!';

    const bar = document.createElement('div');
    bar.className = 'dubis-exit-bar';
    bar.innerHTML = `
      <span>${msg}</span>
      <button onclick="this.parentElement.remove(); if(typeof openCart==='function') openCart();">
        ${isHe ? 'חזור לעגלה' : 'Back to Cart'} →
      </button>
      <button class="exit-bar-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('visible'));

    // Auto-remove after 10s
    setTimeout(() => { if (document.body.contains(bar)) bar.remove(); }, 10000);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT — runs after DOMContentLoaded + products loaded
  // ═══════════════════════════════════════════════════════════

  function initEngage() {
    // Wait a tick for main.js to finish loading cart and products
    setTimeout(() => {
      hookCartPersistence();
      restoreCart();
      initPopup();
      initExitIntent();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEngage);
  } else {
    initEngage();
  }

})();
