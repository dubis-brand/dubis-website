// DUBIS - Main JavaScript
// Agent: CTO | Version 2.0
// Features: IP-based Hebrew detection, full i18n, color swatch preview

let cart = [];
let currentLang  = 'en';
let _activeFilter = 'all';
let _activeGender = 'all';

// ===== COMPREHENSIVE TRANSLATIONS =====
const translations = {
  en: {
    nav_home: 'Home', nav_shop: 'Shop', nav_people: 'Real People',
    nav_about: 'About', nav_contact: 'Contact',
    hero_tagline: 'We see you.',
    hero_desc: 'Forty years of fashion designed for someone else\'s body. We made something different.',
    hero_btn: 'Find Your Statement',
    people_title: 'This Is Us 🐻',
    people_sub: 'The DUBIS family. Real people, real bodies, real style — no apologies.',
    shop_title: 'The Collection', shop_sub: 'Wear what you mean. Mean what you wear.',
    filter_all: 'All', filter_tshirt: 'T-Shirts', filter_hoodie: 'Hoodies', filter_cap: 'Caps',
    filter_longsleeve: 'Long-Sleeves',
    gender_all: 'All', gender_men: 'Men', gender_women: 'Women',
    add_btn: '+ Add', view_details: 'View Details',
    type_tshirt: 'T-Shirt', type_hoodie: 'Hoodie', type_cap: 'Cap',
    type_ziphoodie: 'Zip Hoodie', type_longsleeve: 'Long-Sleeve',
    quality_title: 'What You See Is What You Get 🐾',
    quality_sub: 'We know the worry — ordering online and getting something that looks nothing like the photo. Here\'s our promise:',
    q1_title: 'Made Fresh For You', q2_title: 'Real Materials', q3_title: 'Quality Control', q4_title: 'Easy Returns',
    q1_text: 'Every piece is made for you, the moment you order. Not sitting in a warehouse. Not pre-printed in bulk. Made fresh — because you deserve something made for you, not someone else.',
    q2_text: '100% cotton that breathes. Heavyweight hoodies that actually keep you warm. No scratchy seams, no awkward fits. Fabrics chosen because they feel good — on your body, the one you have today.',
    q3_text: 'Every item is checked before it reaches you. Print not sharp enough? Wrong color? We reprint it. You waited for this — it better be worth the wait.',
    q4_text: '30 days. No drama. No fine print. If it doesn\'t feel like you — send it back, full refund. We\'re real people. We get it.',
    about_title: 'Who is the DUBIS bear?',
    about_p1: 'He\'s in his 40s. He built something real — a career, a family, a life he shows up for every single day.',
    about_p2: 'He went shopping. Found nothing that fit the body he actually lives in. The clothes assumed a different person — younger, thinner, apologetic.',
    about_p3: 'He stopped waiting for fashion to notice him. And built something for the rest of us.',
    about_tag: 'If you\'ve ever felt invisible in a store — you\'re not invisible here. 🐾',
    contact_title: 'Get in Touch', contact_sub: 'Questions? Ideas? Just want to say hi?',
    cart_title: 'Your Cart 🐾', cart_empty: 'Nothing here yet. The right things are one click away. 🐾',
    cart_total: 'Total', cart_checkout: 'CHECKOUT',
    modal_color: 'Color', modal_size: 'Size',
    modal_made: '🏭 Made fresh for you, the moment you order.',
    modal_material: '👕 Moves with you, not against you.',
    modal_returns: '↩️ Easy returns — no drama.',
    modal_add: 'This Is Mine 🐾',
    cookie_text: '🐾 We use cookies to improve your experience. We keep it minimal - just what\'s needed.',
    cookie_accept: 'Accept', cookie_decline: 'Decline', cookie_privacy: 'Privacy Policy',
    footer_privacy: 'Privacy Policy', footer_contact: 'Contact', footer_shop: 'Shop',
    footer_rights: '© 2026 DUBIS. All rights reserved. For the rest of us.',
    lang_btn: 'עב',
  },
  he: {
    nav_home: 'ראשי', nav_shop: 'חנות', nav_people: 'אנשים אמיתיים',
    nav_about: 'אודות', nav_contact: 'צור קשר',
    hero_tagline: 'אנחנו רואים אותך.',
    hero_desc: 'ארבעים שנה של אופנה שתוכננה לגוף של מישהו אחר. עשינו משהו אחר.',
    hero_btn: 'מצא את המסר שלך',
    people_title: 'This Is Us 🐻',
    people_sub: 'משפחת DUBIS. אנשים אמיתיים, גופים אמיתיים, סטייל אמיתי — ללא התנצלות.',
    shop_title: 'הקולקציה', shop_sub: 'לבש מה שאתה מרגיש.',
    filter_all: 'הכל', filter_tshirt: 'חולצות', filter_hoodie: 'קפוצ\'ונים', filter_cap: 'כובעים',
    filter_longsleeve: 'ארוכות שרוול',
    gender_all: 'הכל', gender_men: 'גברים', gender_women: 'נשים',
    add_btn: '+ הוסף', view_details: 'פרטים',
    type_tshirt: 'חולצה', type_hoodie: 'קפוצ\'ון', type_cap: 'כובע',
    type_ziphoodie: 'קפוצ\'ון רוכסן', type_longsleeve: 'ארוכת שרוול',
    quality_title: 'מה שרואים זה מה שמקבלים 🐾',
    quality_sub: 'אנחנו יודעים את הדאגה — להזמין אונליין ולקבל משהו שלא נראה כמו בתמונה. הנה ההבטחה שלנו:',
    q1_title: 'מיוצר טרי עבורך', q2_title: 'חומרים אמיתיים', q3_title: 'בקרת איכות', q4_title: 'החזרה קלה',
    q1_text: 'כל פריט מיוצר עבורך ברגע שהזמנת. לא מחסן. לא הדפסה מראש. טרי — כי מגיע לך משהו שנעשה עבורך, לא עבור מישהו אחר.',
    q2_text: 'כותנה 100% שנושמת. קפוצ\'ונים כבדים שמחממים באמת. ללא תפרים מגרדים, ללא חיתוכים מוזרים. בדים שנבחרו כי הם מרגישים טוב — על הגוף שלך, זה שיש לך היום.',
    q3_text: 'כל פריט נבדק לפני שמגיע אליך. ההדפסה לא חדה? צבע לא נכון? מדפיסים מחדש. חיכית לזה — כדאי שיהיה שווה.',
    q4_text: '30 יום. ללא דרמה. ללא אותיות קטנות. אם זה לא מרגיש כמוך — שלח חזרה, החזר מלא. אנחנו אנשים אמיתיים. מבינים.',
    about_title: 'מי הדובי של DUBIS?',
    about_p1: 'הוא בן 40. הוא בנה משהו אמיתי — קריירה, משפחה, חיים שהוא מגיע אליהם כל יום.',
    about_p2: 'הוא הלך לקנות. לא מצא כלום שמתאים לגוף שהוא גר בו. הבגדים הניחו אדם אחר — צעיר יותר, רזה יותר, מתנצל.',
    about_p3: 'הוא עצר לחכות שהאופנה תשים לב אליו. ובנה משהו לשאר מאיתנו.',
    about_tag: 'אם אי פעם הרגשת בלתי נראה בחנות — כאן אתה נראה. 🐾',
    contact_title: 'צור קשר', contact_sub: 'שאלות? רעיונות? פשוט רוצה להגיד שלום?',
    cart_title: 'העגלה שלך 🐾', cart_empty: 'עדיין ריק. הדברים הנכונים במרחק קליק אחד. 🐾',
    cart_total: 'סה"כ', cart_checkout: 'לתשלום',
    modal_color: 'צבע', modal_size: 'מידה',
    modal_made: '🏭 מיוצר טרי עבורך, ברגע ההזמנה.',
    modal_material: '👕 זז איתך, לא נגדך.',
    modal_returns: '↩️ החזרה קלה — ללא דרמה.',
    modal_add: 'זה שלי 🐾',
    cookie_text: '🐾 אנחנו משתמשים בעוגיות לשיפור החוויה שלך. שומרים על מינימום.',
    cookie_accept: 'אישור', cookie_decline: 'דחייה', cookie_privacy: 'מדיניות פרטיות',
    footer_privacy: 'מדיניות פרטיות', footer_contact: 'צור קשר', footer_shop: 'חנות',
    footer_rights: '© 2026 DUBIS. כל הזכויות שמורות. לשאר מאיתנו.',
    lang_btn: 'EN',
  }
};

// ===== LANGUAGE DETECTION =====
async function detectLanguage() {
  const saved = localStorage.getItem('dubis-lang');
  if (saved) { setLanguage(saved); return; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    setLanguage(data.country_code === 'IL' ? 'he' : 'en');
  } catch (e) {
    setLanguage('en');
  }
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('dubis-lang', lang);
  translateUI(lang);
}

function toggleLang() {
  setLanguage(currentLang === 'en' ? 'he' : 'en');
}

// ===== TRANSLATE ALL UI ELEMENTS =====
function translateUI(lang) {
  const t = translations[lang];
  const q = sel => document.querySelector(sel);
  const qa = sel => document.querySelectorAll(sel);

  document.body.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;

  // Nav links
  const navLinks = qa('.nav-links a');
  const navKeys = ['nav_home', 'nav_shop', 'nav_people', 'nav_about', 'nav_contact'];
  navLinks.forEach((a, i) => { if (navKeys[i]) a.textContent = t[navKeys[i]]; });

  // Hero
  const heroTagline = q('.hero-tagline');
  const heroDesc = q('.hero-desc');
  const heroBtn = q('.hero-content .btn-primary');
  if (heroTagline) heroTagline.textContent = t.hero_tagline;
  if (heroDesc) heroDesc.textContent = t.hero_desc;
  if (heroBtn) heroBtn.textContent = t.hero_btn;

  // Real People section
  const rpTitle = q('#real-people .section-header h2');
  const rpSub = q('#real-people .section-header p');
  if (rpTitle) rpTitle.textContent = t.people_title;
  if (rpSub) rpSub.textContent = t.people_sub;

  // Shop section
  const shopTitle = q('#shop .section-header h2');
  const shopSub = q('#shop .section-header p');
  if (shopTitle) shopTitle.textContent = t.shop_title;
  if (shopSub) shopSub.textContent = t.shop_sub;

  // Gender filter buttons
  const genderBtns = qa('.gender-btn');
  const genderKeys = ['gender_all', 'gender_men', 'gender_women'];
  genderBtns.forEach((btn, i) => { if (genderKeys[i]) btn.textContent = t[genderKeys[i]]; });

  // Type filter buttons
  const filterBtns = qa('.filter-btn');
  const filterKeys = ['filter_all', 'filter_tshirt', 'filter_hoodie', 'filter_cap', 'filter_longsleeve'];
  filterBtns.forEach((btn, i) => { if (filterKeys[i]) btn.textContent = t[filterKeys[i]]; });

  // Quality Promise
  const qTitle = q('.quality-promise h2');
  if (qTitle) qTitle.textContent = t.quality_title;
  const qSub = q('.promise-container > p');
  if (qSub) qSub.textContent = t.quality_sub;
  const promiseItems = qa('.promise-item');
  [['q1_title','q1_text'],['q2_title','q2_text'],['q3_title','q3_text'],['q4_title','q4_text']]
    .forEach(([tk, pk], i) => {
      if (promiseItems[i]) {
        const h3 = promiseItems[i].querySelector('h3');
        const p  = promiseItems[i].querySelector('p');
        if (h3) h3.textContent = t[tk];
        if (p)  p.textContent  = t[pk];
      }
    });

  // About
  const aboutPs = qa('#about .about-text p');
  if (q('#about h2')) q('#about h2').textContent = t.about_title;
  const aboutKeys = ['about_p1','about_p2','about_p3','about_tag'];
  aboutPs.forEach((p, i) => { if (aboutKeys[i]) p.textContent = t[aboutKeys[i]]; });

  // Contact
  if (q('#contact h2')) q('#contact h2').textContent = t.contact_title;
  if (q('#contact p'))  q('#contact p').textContent  = t.contact_sub;

  // Cart
  if (q('.cart-header h3')) q('.cart-header h3').textContent = t.cart_title;
  if (q('.cart-footer .btn-primary')) q('.cart-footer .btn-primary').textContent = t.cart_checkout;

  // Cookie banner
  if (q('.cookie-content > span')) q('.cookie-content > span').textContent = t.cookie_text;
  if (q('.btn-cookie-accept')) q('.btn-cookie-accept').textContent = t.cookie_accept;
  if (q('.btn-cookie-decline')) q('.btn-cookie-decline').textContent = t.cookie_decline;
  if (q('.cookie-link')) q('.cookie-link').textContent = t.cookie_privacy;

  // Footer
  const footerLinks = qa('.footer-links a');
  if (footerLinks[0]) footerLinks[0].textContent = t.footer_privacy;
  if (footerLinks[1]) footerLinks[1].textContent = t.footer_contact;
  if (footerLinks[2]) footerLinks[2].textContent = t.footer_shop;
  if (q('.footer > p')) q('.footer > p').textContent = t.footer_rights;

  // Lang toggle
  if (q('.lang-toggle')) q('.lang-toggle').textContent = t.lang_btn;

  // Re-render dynamic content
  renderProducts();
  if (q('.cart-modal.open')) renderCart();
}

// ===== RENDER PRODUCTS =====
function renderProducts(filter, gender) {
  if (filter !== undefined) _activeFilter = filter;
  if (gender !== undefined) _activeGender = gender;
  const t = translations[currentLang];
  const grid = document.getElementById('products-grid');
  let filtered = products;
  if (_activeFilter !== 'all') filtered = filtered.filter(p => p.type === _activeFilter);
  if (_activeGender !== 'all') {
    filtered = filtered.filter(p => p.gender === _activeGender || p.gender === 'unisex');
  }
  const typeMap = {
    tshirt:     t.type_tshirt,
    hoodie:     t.type_hoodie,
    cap:        t.type_cap,
    ziphoodie:  t.type_ziphoodie,
    longsleeve: t.type_longsleeve,
  };

  grid.innerHTML = filtered.map(product => `
    <div class="product-card" data-id="${product.id}" data-type="${product.type}"
         data-selected-color="${product.colors[0]}"
         onclick="openProductModal(${product.id})">
      <div class="product-image" id="card-img-${product.id}">
        <img class="img-view img-back"  src="${productImg(product.id, product.colors[0], 'back')}"  alt="${product.phrase}" loading="lazy" onerror="this.onerror=null;this.src='${product.image}'" />
        <img class="img-view img-front" src="${productImg(product.id, product.colors[0], 'front')}" alt="${product.phrase}" loading="lazy" onerror="this.onerror=null;this.src='${product.image}'" />
        <div class="product-badge">${typeMap[product.type] || product.typeLabel}</div>
        <div class="product-hover-overlay"><span>${t.view_details}</span></div>
      </div>
      <div class="product-info">
        <div class="product-phrase">"${product.phrase}"</div>
        <div class="product-colors">
          ${product.colors.map((c, i) => `
            <span class="color-dot ${i === 0 ? 'active-color' : ''}"
              title="${c}"
              style="background:${colorToHex(c)}"
              onclick="event.stopPropagation(); selectCardColor(${product.id}, '${c}', this)">
            </span>
          `).join('')}
        </div>
        <div class="product-bottom">
          <div class="product-price">$${product.price}</div>
          <button class="add-to-cart"
            onclick="event.stopPropagation(); quickAddToCart(${product.id}, this)">
            ${t.add_btn}
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ===== COLOR SWATCH ON PRODUCT CARD =====
function selectCardColor(productId, color, dotEl) {
  const card = dotEl.closest('.product-card');
  card.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active-color'));
  dotEl.classList.add('active-color');
  card.dataset.selectedColor = color;

  // Swap images to selected color (with fallback if color-specific image missing)
  const imgContainer = document.getElementById(`card-img-${productId}`);
  if (imgContainer) {
    const product = products.find(p => p.id === productId);
    const fallback = product?.image || '';
    const backImg  = imgContainer.querySelector('.img-back');
    const frontImg = imgContainer.querySelector('.img-front');
    if (backImg)  { backImg.onerror  = () => { backImg.onerror  = null; backImg.src  = fallback; }; backImg.src  = productImg(productId, color, 'back'); }
    if (frontImg) { frontImg.onerror = () => { frontImg.onerror = null; frontImg.src = fallback; }; frontImg.src = productImg(productId, color, 'front'); }
  }
}

// Helper: build per-color image URL — uses imageRef if product has one (placeholder)
function productImg(productId, color, view) {
  const product = products.find(p => p.id === productId);
  const refId = product?.imageRef || productId;
  const safeColor = color.replace(/\s+/g, '-');
  return `images/product-${refId}-${safeColor}-${view}.jpg`;
}

// ===== FILTER =====
function filterProducts(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts(type, _activeGender);
}

function setGenderFilter(gender, btn) {
  document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts(_activeFilter, gender);
}

// ===== PRODUCT MODAL =====
function openProductModal(productId) {
  const product = products.find(p => p.id === productId);
  const t = translations[currentLang];
  const typeMap = {
    tshirt:     t.type_tshirt,
    hoodie:     t.type_hoodie,
    cap:        t.type_cap,
    ziphoodie:  t.type_ziphoodie,
    longsleeve: t.type_longsleeve,
  };
  const modal = document.getElementById('product-modal');
  const overlay = document.getElementById('product-modal-overlay');
  const body = document.getElementById('modal-body');

  body.innerHTML = `
    <div class="modal-left">
      <div class="modal-image" id="modal-img-${product.id}">
        <img id="modal-img-src-${product.id}"
             src="${productImg(product.id, product.colors[0], 'back')}"
             alt="${product.phrase}"
             data-color="${product.colors[0]}"
             data-view="back"
             onerror="this.onerror=null;this.src='${product.image}'" />
      </div>
      <div class="modal-view-toggle">
        <button class="view-btn" onclick="setModalView(${product.id}, 'front', this)">Front</button>
        <button class="view-btn active" onclick="setModalView(${product.id}, 'back', this)">Back</button>
      </div>
    </div>
    <div class="modal-info">
      <div class="modal-type">${typeMap[product.type] || product.typeLabel}</div>
      <h2 class="modal-phrase">"${product.phrase}"</h2>
      <div class="modal-price">$${product.price}</div>
      <div class="modal-option">
        <label>${t.modal_color}</label>
        <div class="modal-colors" id="modal-colors-${product.id}">
          ${product.colors.map((c, i) => `
            <button class="color-btn ${i === 0 ? 'selected' : ''}"
              onclick="selectColor(this, '${c}', ${product.id})"
              style="background:${colorToHex(c)}" title="${c}" data-color="${c}">
            </button>
          `).join('')}
        </div>
        <span class="selected-label" id="selected-color-${product.id}">${product.colors[0]}</span>
      </div>
      <div class="modal-option">
        <label>${t.modal_size}</label>
        <div class="modal-sizes" id="modal-sizes-${product.id}">
          ${product.sizes.map((s, i) => `
            <button class="size-btn ${i === 0 ? 'selected' : ''}"
              onclick="selectSize(this, '${s}', ${product.id})" data-size="${s}">
              ${s}
            </button>
          `).join('')}
        </div>
      </div>
      <button class="btn-primary modal-add-btn" onclick="addToCartFromModal(${product.id})">
        ${t.modal_add}
      </button>
      ${product.description ? `<p class="product-description">${product.description}</p>` : ''}
      <div class="product-tabs">
        <button class="prod-tab active" onclick="switchTab(this,'tab-details-${product.id}')">Details</button>
        <button class="prod-tab" onclick="switchTab(this,'tab-size-${product.id}')">Size Guide</button>
        <button class="prod-tab" onclick="switchTab(this,'tab-care-${product.id}')">Care</button>
      </div>
      <div class="prod-tab-content" id="tab-details-${product.id}">
        ${product.fabric ? `<p>🧵 <strong>Fabric:</strong> ${product.fabric}</p>` : ''}
        ${product.fit ? `<p>📐 <strong>Fit:</strong> ${product.fit}</p>` : ''}
        ${product.printMethod ? `<p>🖨️ <strong>Print:</strong> ${product.printMethod}</p>` : ''}
        ${product.printAreas ? `<p>📍 <strong>Print areas:</strong> ${product.printAreas.join(', ')}</p>` : ''}
      </div>
      <div class="prod-tab-content hidden" id="tab-size-${product.id}">
        ${product.sizeGuide && product.sizeGuide[0] && product.sizeGuide[0].note
          ? `<p style="font-size:0.85rem;color:#555">${product.sizeGuide[0].note}</p>`
          : `<table class="size-table">
              <tr><th>Size</th><th>Chest (cm)</th><th>Length (cm)</th></tr>
              ${(product.sizeGuide || []).map(r => `<tr><td>${r.size}</td><td>${r.chest}</td><td>${r.length}</td></tr>`).join('')}
            </table>
            <small style="color:#888">*Measurements may vary ±2cm</small>`
        }
      </div>
      <div class="prod-tab-content hidden" id="tab-care-${product.id}">
        <ul class="care-list">${(product.care || []).map(c => `<li>${c}</li>`).join('')}</ul>
      </div>
      <div class="modal-quality">
        <span>${t.modal_made}</span>
        <span>${t.modal_material}</span>
        <span>${t.modal_returns}</span>
      </div>
    </div>
  `;

  modal.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.getElementById('product-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function switchTab(btn, tabId) {
  const tabs = btn.closest('.modal-info').querySelectorAll('.prod-tab');
  const contents = btn.closest('.modal-info').querySelectorAll('.prod-tab-content');
  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.remove('hidden');
}

function selectColor(btn, color, productId) {
  document.querySelectorAll(`#modal-colors-${productId} .color-btn`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById(`selected-color-${productId}`).textContent = color;

  // Swap modal image to selected color (preserve current front/back view)
  const imgEl = document.getElementById(`modal-img-src-${productId}`);
  if (imgEl) {
    const view = imgEl.dataset.view || 'back';
    const product = products.find(p => p.id === productId);
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
    imgEl.src = productImg(productId, color, view);
    imgEl.dataset.color = color;
  }
}

function setModalView(productId, view, btn) {
  btn.closest('.modal-view-toggle').querySelectorAll('.view-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const imgEl = document.getElementById(`modal-img-src-${productId}`);
  if (imgEl) {
    const color = imgEl.dataset.color || products.find(p => p.id === productId)?.colors[0] || '';
    const product = products.find(p => p.id === productId);
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
    imgEl.src = productImg(productId, color, view);
    imgEl.dataset.view = view;
  }
}

function selectSize(btn, size, productId) {
  document.querySelectorAll(`#modal-sizes-${productId} .size-btn`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function addToCartFromModal(productId) {
  const product = products.find(p => p.id === productId);
  const selectedColor = document.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color || product.colors[0];
  const selectedSize  = document.querySelector(`#modal-sizes-${productId} .size-btn.selected`)?.dataset.size  || product.sizes[0];
  cart.push({ ...product, selectedColor, selectedSize });
  updateCartCount();
  showCartNotification(product.phrase);
  closeProductModal();
}

function quickAddToCart(productId, btnEl) {
  const product = products.find(p => p.id === productId);
  const card = document.querySelector(`.product-card[data-id="${productId}"]`);
  const selectedColor = card?.dataset.selectedColor || product.colors[0];
  cart.push({ ...product, selectedColor, selectedSize: product.sizes[2] || 'L' });
  updateCartCount();
  showCartNotification(product.phrase);
  if (btnEl) animateAddToCart(btnEl);
}

// ===== CART =====
function updateCartCount() {
  document.getElementById('cart-count').textContent = cart.length;
}

function openCart() {
  document.getElementById('cart-modal').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
  renderCart();
}

function closeCart() {
  document.getElementById('cart-modal').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}

function renderCart() {
  const t = translations[currentLang];
  const cartItems = document.getElementById('cart-items');
  const cartTotal = document.getElementById('cart-total');

  if (cart.length === 0) {
    cartItems.innerHTML = `<p class="cart-empty">${t.cart_empty}</p>`;
    cartTotal.textContent = '0';
    return;
  }

  cartItems.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.phrase}" class="cart-item-img" />
      <div class="cart-item-info">
        <div class="cart-item-name">"${item.phrase}"</div>
        <div class="cart-item-type">${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}</div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">$${item.price}</div>
        <button class="cart-item-remove" onclick="removeFromCart(${index})">✕</button>
      </div>
    </div>
  `).join('');

  cartTotal.textContent = cart.reduce((sum, item) => sum + item.price, 0);
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartCount();
  renderCart();
}

function showCartNotification(phrase) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position:fixed; bottom:2rem; left:50%; transform:translateX(-50%);
    background:#2C2C2C; color:white; padding:12px 24px; border-radius:8px;
    font-size:.9rem; z-index:9999; border-left:4px solid #C17E3A;
    box-shadow:0 4px 20px rgba(0,0,0,.3);
  `;
  notif.textContent = currentLang === 'he' ? '🐾 נוסף לסל!' : '🐾 Added to cart!';
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 2500);
}

// ===== COLOR HELPER =====
function colorToHex(color) {
  const map = {
    'Black':        '#2C2C2C',
    'White':        '#F5F0E8',
    'Cream':        '#E8DCC8',
    'Charcoal':     '#3D3D3D',
    'Navy':         '#1B2A4A',
    'Gray':         '#888888',
    'Honey Brown':  '#C17E3A',
    'Red':          '#CC2200',
    'Forest Green': '#2D6A4F',
  };
  return map[color] || '#999';
}

// ===== COOKIES & ANALYTICS CONSENT =====
function acceptCookies() {
  localStorage.setItem('dubis-cookies', 'accepted');
  document.getElementById('cookie-banner').style.display = 'none';
  // Unlock GA4 now that the user has consented
  if (typeof gtag !== 'undefined') {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('event', 'page_view'); // send the deferred page_view
  }
}
function declineCookies() {
  localStorage.setItem('dubis-cookies', 'declined');
  document.getElementById('cookie-banner').style.display = 'none';
  // analytics_storage remains 'denied' — GA4 respects this automatically
}
function checkCookieConsent() {
  if (localStorage.getItem('dubis-cookies'))
    document.getElementById('cookie-banner').style.display = 'none';
}

// ===== MOBILE MENU =====
function toggleMobileMenu() {
  const nav = document.querySelector('.nav-links');
  const btn = document.getElementById('hamburger-btn');
  nav.classList.toggle('open');
  btn.classList.toggle('active');
}

// ===== SCROLL ANIMATIONS =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.08 });
  document.querySelectorAll('.fade-in-section').forEach(el => observer.observe(el));
}

// ===== ADD-TO-CART MICRO-ANIMATION =====
function animateAddToCart(btn) {
  btn.classList.add('adding');
  setTimeout(() => btn.classList.remove('adding'), 500);
}

// ===== INIT =====
document.querySelector('.cart-btn').addEventListener('click', openCart);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeProductModal(); closeCart(); }
});
// Close mobile nav when a link is clicked
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelector('.nav-links')?.classList.remove('open');
    document.getElementById('hamburger-btn')?.classList.remove('active');
  });
});

document.addEventListener('DOMContentLoaded', () => {
  checkCookieConsent();
  detectLanguage(); // IP-based language detection → renders products after
  initScrollAnimations();
});
