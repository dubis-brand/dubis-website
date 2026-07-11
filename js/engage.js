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
    // Rebuild at show time: the popup used to be injected on load, BEFORE the async geo/lang
    // detection resolved — Hebrew visitors got an English popup. Show time = language is final.
    const stale = document.getElementById('dubis-popup-overlay');
    if (stale && stale.parentElement) stale.parentElement.remove();
    injectPopup();
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

  // ═══════════════════════════════════════════════════════════
  // 1b. COMMUNITY SLOGAN BOX — "Got a slogan idea? Share it"
  //     Direct anon PostgREST insert into slogan_candidates (pending_review).
  //     Honeypot + length + 60s localStorage throttle for minimal abuse defense.
  // ═══════════════════════════════════════════════════════════
  window.dubisSubmitSlogan = async function () {
    const ta = document.getElementById('slogan-text');
    const emailEl = document.getElementById('slogan-email');
    const hp = document.getElementById('slogan-hp');
    const btn = document.getElementById('slogan-submit');
    if (!ta || !btn) return;
    if (hp && hp.value) return;                       // honeypot tripped → silently drop (bot)
    const text = (ta.value || '').trim();
    if (text.length < 3 || text.length > 120) { ta.style.borderColor = '#e74c3c'; ta.focus(); return; }
    try { const last = +localStorage.getItem('dubis_slogan_last') || 0; if (Date.now() - last < 60000) { btn.textContent = '⏳'; return; } } catch (e) { /* ignore */ }
    const email = (emailEl && emailEl.value || '').trim().toLowerCase() || null;
    btn.disabled = true; btn.textContent = '...';
    try {
      await fetch(SUPABASE_URL + '/rest/v1/slogan_candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ text_en: text, source: 'visitor_submission', status: 'pending_review', generated_by: 'visitor', brand_voice_score: 0, submitter_email: email }),
      });
      try { localStorage.setItem('dubis_slogan_last', String(Date.now())); } catch (e) { /* ignore */ }
      const form = document.getElementById('slogan-form'); if (form) form.classList.add('hidden');
      const ok = document.getElementById('slogan-success'); if (ok) ok.classList.remove('hidden');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'שלחו';
      console.warn('Slogan submit error:', e);
    }
  };
  // char counter + bilingual placeholders (translateUI handles textContent, not placeholders)
  document.addEventListener('DOMContentLoaded', function () {
    const ta = document.getElementById('slogan-text');
    const cnt = document.getElementById('slogan-counter');
    if (ta && cnt) ta.addEventListener('input', function () { cnt.textContent = ta.value.length + '/120'; });
    function setPh() {
      const lang = window.currentLang || (function () { try { return localStorage.getItem('dubis-lang'); } catch (e) { return null; } })() || 'he';
      ['slogan-text', 'slogan-email'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) { const ph = el.getAttribute('data-' + lang + '-ph'); if (ph) el.placeholder = ph; }
      });
    }
    setPh();
    const tg = document.querySelector('.lang-toggle');
    if (tg) tg.addEventListener('click', function () { setTimeout(setPh, 50); });
  });

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

// ═══════════════════════════════════════════════════════════════
// 4. ABANDONED-CART EMAIL CAPTURE + RESTORE  (2026-07-03)
//    Problem: cart lives in localStorage, email only appears at
//    checkout — abandoners are unreachable. This captures an email
//    at three touchpoints (cart modal / checkout form / newsletter)
//    into `abandoned_carts`, and restores a cart from the recovery
//    email's ?cart={token} link via the get_abandoned_cart RPC.
//    Recovery email itself is sent server-side (?type=cart-recovery).
// ═══════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const SUPABASE_URL  = window.DUBIS_SUPABASE_URL;
  const SUPABASE_ANON = window.DUBIS_SUPABASE_ANON;
  const SAVED_KEY = 'dubis_cart_email_saved';

  function isHe() { return (typeof currentLang !== 'undefined' && currentLang === 'he'); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''); }

  function cartSnapshot() {
    if (typeof cart === 'undefined' || !Array.isArray(cart) || !cart.length) return null;
    return cart.map(i => ({
      id: i.id, name: i.name || '', color: i.color || '', size: i.size || '',
      quantity: i.quantity || i.qty || 1, price: Number(i.price) || 0,
    }));
  }
  function cartTotal(items) {
    try { return items.reduce((s, i) => s + i.price * i.quantity, 0); } catch { return null; }
  }
  function utmAttr() {
    try { return JSON.parse(localStorage.getItem('dubis-attr') || 'null'); } catch { return null; }
  }

  let inFlight = false;
  async function saveAbandonedCart(email, source) {
    const items = cartSnapshot();
    email = (email || '').trim().toLowerCase();
    if (!items || !validEmail(email) || inFlight) return false;
    const dedupeKey = email + '|' + items.length;
    try { if (localStorage.getItem(SAVED_KEY) === dedupeKey) return true; } catch {}
    inFlight = true;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/abandoned_carts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          email: email,
          cart_items: items,
          cart_total: cartTotal(items),
          currency: 'USD',
          lang: isHe() ? 'he' : 'en',
          source: source,
          session_id: (function() { try { return sessionStorage.getItem('dubis-session') || null; } catch { return null; } })(),
          utm: utmAttr(),
        }),
      });
      if (res.ok) {
        try { localStorage.setItem(SAVED_KEY, dedupeKey); } catch {}
        if (typeof dubisTrack === 'function') dubisTrack('cart_email_saved', { source: source });
        return true;
      }
    } catch {}
    finally { inFlight = false; }
    return false;
  }

  // ── 4a. Cart-modal capture strip (shows only when cart has items + no email saved yet) ──
  function injectCartSaver() {
    const footer = document.querySelector('#cart-modal .cart-footer');
    if (!footer || document.getElementById('dubis-cart-saver')) { refreshCartSaver(); return; }
    const wrap = document.createElement('div');
    wrap.id = 'dubis-cart-saver';
    wrap.style.cssText = 'display:none;margin:0 0 10px;padding:9px 11px;background:#F5F0E8;border:1px solid #e5ded2;border-radius:8px;font-size:.85rem;';
    wrap.innerHTML =
      '<div id="dubis-cart-saver-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
        '<span id="dubis-cart-saver-label" style="flex:1 1 100%;color:#2C2C2C;"></span>' +
        '<input type="email" id="dubis-cart-saver-email" autocomplete="email" inputmode="email" dir="ltr" ' +
          'style="flex:1 1 150px;min-width:0;padding:8px 10px;border:1px solid #cbbfa8;border-radius:6px;font-size:.85rem;" />' +
        '<button id="dubis-cart-saver-btn" type="button" ' +
          'style="padding:8px 16px;background:#C17E3A;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer;"></button>' +
      '</div>';
    footer.insertBefore(wrap, footer.firstChild);
    document.getElementById('dubis-cart-saver-btn').addEventListener('click', async function() {
      const inp = document.getElementById('dubis-cart-saver-email');
      const email = (inp.value || '').trim();
      if (!validEmail(email)) { inp.style.borderColor = '#e74c3c'; inp.focus(); return; }
      this.disabled = true; this.textContent = '…';
      const ok = await saveAbandonedCart(email, 'cart_modal');
      const row = document.getElementById('dubis-cart-saver-row');
      if (row) row.innerHTML = '<span style="color:' + (ok ? '#1e6b1e' : '#a12020') + ';font-weight:600;">' +
        (ok
          ? (isHe() ? '✓ הסל שמור. אם לא תסיים — נזכיר לך במייל.' : "✓ Saved. If you don't finish, we'll send one reminder.")
          : (isHe() ? 'משהו נתקע — נסה שוב עוד רגע.' : 'Something failed, try again in a moment.')) +
        '</span>';
    });
    refreshCartSaver();
  }

  function refreshCartSaver() {
    const wrap = document.getElementById('dubis-cart-saver');
    if (!wrap) return;
    let alreadySaved = false;
    try { alreadySaved = !!localStorage.getItem(SAVED_KEY); } catch {}
    const hasItems = (typeof cart !== 'undefined' && Array.isArray(cart) && cart.length > 0);
    wrap.style.display = (hasItems && !alreadySaved) ? 'block' : 'none';
    const label = document.getElementById('dubis-cart-saver-label');
    const input = document.getElementById('dubis-cart-saver-email');
    const btn   = document.getElementById('dubis-cart-saver-btn');
    if (label) label.textContent = isHe()
      ? '📧 שנשמור לך את הסל? השאר מייל ונזכיר לך אם לא תסיים.'
      : "📧 Save your cart? Leave an email and we'll remind you.";
    if (input) input.placeholder = isHe() ? 'המייל שלך' : 'you@email.com';
    if (btn && !btn.disabled) btn.textContent = isHe() ? 'שמור' : 'Save';
  }

  function hookOpenCart() {
    const orig = window.openCart;
    if (typeof orig === 'function') {
      window.openCart = function() {
        orig.apply(this, arguments);
        try { injectCartSaver(); } catch {}
      };
    }
  }

  // ── 4b. Checkout-form email hook — capture on blur, before PayPal ever opens ──
  function hookCheckoutEmail() {
    document.addEventListener('blur', function(e) {
      const t = e.target;
      if (!t || t.id !== 'checkout-email') return;
      const email = (t.value || '').trim();
      if (validEmail(email)) saveAbandonedCart(email, 'checkout_form');
    }, true);
  }

  // ── 4c. Newsletter popup hook — subscriber with a non-empty cart is a capture too ──
  function hookNewsletter() {
    document.addEventListener('click', function(e) {
      if (!e.target || e.target.id !== 'dubis-popup-submit') return;
      const inp = document.getElementById('dubis-popup-email');
      const email = inp && (inp.value || '').trim();
      if (validEmail(email)) setTimeout(function() { saveAbandonedCart(email, 'newsletter'); }, 1500);
    }, true);
  }

  // ── 4d. Restore a cart from the recovery email's ?cart={token} link ──
  async function restoreFromToken() {
    let token = null;
    try { token = new URLSearchParams(location.search).get('cart'); } catch {}
    if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_abandoned_cart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify({ p_token: token }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const items = data && data.cart_items;
      if (!Array.isArray(items) || !items.length) return;
      if (typeof cart === 'undefined' || !Array.isArray(cart)) return;
      // Only items that still exist in the live catalog
      const valid = items.filter(function(i) {
        return typeof products !== 'undefined' && products.find(function(p) { return p.id === i.id; });
      });
      if (!valid.length) return;
      cart.length = 0;
      valid.forEach(function(i) { cart.push(i); });
      if (typeof saveCart === 'function') saveCart();
      if (typeof updateCartCount === 'function') updateCartCount();
      if (typeof dubisTrack === 'function') dubisTrack('cart_restore', { items: valid.length });
      setTimeout(function() { if (typeof openCart === 'function') openCart(); }, 800);
    } catch {}
  }

  function initCartCapture() {
    setTimeout(function() {
      hookOpenCart();
      hookCheckoutEmail();
      hookNewsletter();
      restoreFromToken();
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCartCapture);
  } else {
    initCartCapture();
  }

})();
