// DUBIS - Main JavaScript
// Agent: CTO | Version 2.0
// Features: IP-based Hebrew detection, full i18n, color swatch preview

let cart = [];
let currentLang  = 'en';
let _activeFilter = 'all';
let _activeGender = 'all';

// ── Currency by language ──
let USD_TO_ILS = 3.63; // fallback — updated daily from API
(async function fetchRate() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if (r.ok) {
      const d = await r.json();
      if (d.rates && d.rates.ILS) {
        USD_TO_ILS = d.rates.ILS;
        // re-render if products already shown
        if (document.querySelector('.product-card')) renderProducts();
      }
    }
  } catch(e) { /* keep fallback */ }
})();
function formatPrice(usdPrice) {
  if (currentLang === 'he') {
    return '₪' + Math.round(usdPrice * USD_TO_ILS);
  }
  return '$' + usdPrice;
}
function freeShippingThreshold() {
  const ilsThreshold = Math.round(60 * USD_TO_ILS);
  return currentLang === 'he' ? '₪' + ilsThreshold : '$60';
}

// ===== COMPREHENSIVE TRANSLATIONS =====
const translations = {
  en: {
    nav_home: 'Home', nav_shop: 'Shop', nav_people: 'Real People',
    nav_about: 'About', nav_contact: 'Contact',
    hero_tagline: 'Fashion that doesn\'t ask you to suck your stomach in.',
    hero_subtitle: 'Built for the body you actually live in.',
    hero_desc: 'For years, the fashion industry made clothes for someone else — younger, thinner, and constantly apologizing. DUBIS was born to break the equation. Clothes for real people who refuse to choose between looking great and feeling completely comfortable.',
    hero_btn: 'Shop the Collection',
    people_title: 'The DUBIS Crew 🐻',
    people_sub: 'Real people. Real bodies. No explanations needed.',
    shop_title: 'The Collection', shop_sub: 'Wear what you mean. Mean what you wear.',
    filter_all: 'All', filter_tshirt: 'T-Shirts', filter_hoodie: 'Hoodies', filter_cap: 'Caps',
    filter_longsleeve: 'Long-Sleeves',
    gender_all: 'All', gender_men: 'Men', gender_women: 'Women',
    add_btn: '+ Add', view_details: 'View Details',
    type_tshirt: 'T-Shirt', type_hoodie: 'Hoodie', type_cap: 'Cap',
    type_ziphoodie: 'Zip Hoodie', type_longsleeve: 'Long-Sleeve',
    quality_title: 'What You See Is What You Get 🐾',
    quality_sub: 'We know the worry — ordering online and getting something that looks nothing like the photo. Here\'s our promise:',
    q1_title: 'Made Fresh For You', q2_title: 'Fabrics that live with you, not judge you.', q3_title: 'Quality Control', q4_title: 'Defective? Wrong Item? We Fix It.',
    q1_text: 'Every piece is made for you, the moment you order. Not sitting in a warehouse. Not pre-printed in bulk. Made fresh — because you deserve something made for you, not someone else.',
    q2_text: '100% breathable cotton and fits that actually understand your body. No annoying seams, no feeling like you need to change for the shirt. Just put it on, feel at home, and step out into the world.',
    q3_text: 'Every item is checked before it reaches you. Print not sharp enough? Wrong color? We reprint it. You waited for this — it better be worth the wait.',
    q4_text: 'Got a defect? Wrong item? Email us within 30 days of delivery with a photo and order number — we\'ll replace or refund. No hassle.',
    about_title: 'Who are we at DUBIS?',
    about_p1: 'Sometime after 40, it hits you: Life is way too short for clothes that make you feel bad about your body. We\'ve been around, built lives worth waking up for, and we absolutely refuse to apologize for enjoying them.',
    about_p2: 'But when it comes to fashion? Suddenly it feels like we\'re expected to change ourselves. DUBIS was created to stop this nonsense. We stopped waiting for fashion brands to notice us — and made exactly what we were looking for.',
    about_p3: 'Clothes for real people. No fake models, just maximum comfort, fits that flatter your actual body, and cynical quotes that tell the world: "This is me, and I own it."',
    about_tag: 'If you\'re tired of choosing between looking good and feeling comfortable — welcome home. 🐾',
    contact_title: 'Get in Touch', contact_sub: 'Questions? Ideas? Just want to say hi?',
    cart_title: 'Your Cart 🐾', cart_empty: 'Nothing here yet. The right things are one click away. 🐾',
    cart_total: 'Total', cart_checkout: 'CHECKOUT',
    modal_color: 'Color', modal_size: 'Size',
    modal_made: '🏭 Made fresh for you, the moment you order.',
    modal_material: '👕 Moves with you, not against you.',
    modal_returns: '↩️ Defective? Wrong item? We fix it — no hassle.',
    modal_add: 'This Is Mine 🐾',
    tab_details: 'Details', tab_size: 'Size Guide', tab_care: 'Care',
    shipping_note: '✈️ + shipping · free on $60+',
    modal_ships: '🚚 Ships in 5–9 business days', modal_free_ship: 'Free shipping over $60',
    modal_dtg: 'DTG — Direct-to-Garment',
    modal_fabric: 'Fabric', modal_fit: 'Fit', modal_print: 'Print', modal_print_areas: 'Print areas',
    size_size: 'Size', size_chest: 'Chest (cm)', size_length: 'Length (cm)',
    size_vary: '*Measurements may vary ±2cm', size_cap_note: 'Adjustable strap, fits most',
    cookie_text: '🐾 We use cookies to improve your experience. We keep it minimal - just what\'s needed.',
    cookie_accept: 'Accept', cookie_decline: 'Decline', cookie_privacy: 'Privacy Policy',
    footer_privacy: 'Privacy Policy', footer_terms: 'Terms', footer_returns: 'Returns', footer_contact: 'Contact', footer_shop: 'Shop',
    footer_rights: '© 2026 DUBIS. All rights reserved. Built for you.',
    lang_btn: 'עב',
    faq_title: 'Frequently Asked Questions',
    faq_subtitle: 'Everything you wanted to know, without having to search',
    faq_q1: 'What sizes do you offer?',
    faq_a1: 'Our products come in sizes S through 3XL. All sizes run comfortable and roomy — if you\'re between sizes, take the smaller one. A detailed size chart is available on every product page.',
    faq_q2: 'How long does shipping take?',
    faq_a2: 'Shipping: $8.99 (free on orders over $60). Production: 3–5 business days (printed to order). Delivery: 5–12 business days. Total: 8–17 business days.',
    faq_q3: 'What is your return policy?',
    faq_a3: 'Returns only for defective, wrong, or lost items. Email dubis.brand@gmail.com within 30 days of delivery with a photo and order number.',
    faq_q4: 'Will the print peel off?',
    faq_a4: 'We use DTG (Direct-to-Garment) technology — the print goes directly into the fabric. It\'s not a sticker, not an iron-on. The print survives dozens of washes.',
    faq_q5: 'Why is it priced this way?',
    faq_a5: 'Every item is made to order — not mass-produced in a factory by the thousands. DTG quality, premium materials, original design. $28–$80 for a product you\'ll wear for years.',
    faq_q6: 'Do you have a physical store?',
    faq_a6: 'No. DUBIS is an online-only brand. That\'s how we keep prices fair.',
    faq_q7: 'How do I wash it?',
    faq_a7: 'Regular wash at 30°C, turn the garment inside out before washing, do not tumble dry. The print will survive.',
  },
  he: {
    nav_home: 'ראשי', nav_shop: 'חנות', nav_people: 'החבר\'ה שלנו',
    nav_about: 'אודות', nav_contact: 'צור קשר',
    hero_tagline: 'אופנה שלא מבקשת ממך להכניס את הבטן.',
    hero_subtitle: 'בשביל הגוף שאתה גר בו בפועל — לא זה שתכננת.',
    hero_desc: 'שנים שתעשיית האופנה תפרה בגדים למישהו אחר — צעיר יותר, רזה יותר, ועם אנרגיות של התנצלות. נמאס לנו לחכות. DUBIS הוא בגדים לאנשים שחיים את החיים בלי לבקש רשות — ולא בוחרים בין להיראות טוב לבין להרגיש בנוח.',
    hero_btn: 'לקולקציה',
    people_title: 'החבר\'ה של DUBIS 🐻',
    people_sub: 'אנשים כמוך. בלי פוזות. בלי תירוצים.',
    shop_title: 'הקולקציה', shop_sub: 'תלבש מה שאתה מרגיש. לא מה שמצפים ממך.',
    filter_all: 'הכל', filter_tshirt: 'חולצות', filter_hoodie: 'קפוצונים', filter_cap: 'כובעים',
    filter_longsleeve: 'ארוכות שרוול',
    gender_all: 'הכל', gender_men: 'גברים', gender_women: 'נשים',
    add_btn: '+ הוסף', view_details: 'פרטים',
    type_tshirt: 'חולצה', type_hoodie: 'קפוצון', type_cap: 'כובע',
    type_ziphoodie: 'קפוצון רוכסן', type_longsleeve: 'ארוכת שרוול',
    quality_title: 'מה שרואים זה מה שמקבלים 🐾',
    quality_sub: 'מזמינים אונליין ומקווים לטוב? אצלנו לא צריך לקוות. הנה מה שאנחנו מבטיחים:',
    q1_title: 'נתפר בשבילך, לא יושב במחסן', q2_title: 'בד שזז איתך, לא נגדך.', q3_title: 'עובר בדיקה לפני שיוצא', q4_title: 'פגם? מוצר שגוי? מתקנים.',
    q1_text: 'כל פריט נתפר ומודפס ברגע שהזמנת. לא סחורה מהמדף, לא מלאי ישן. הבגד הזה נעשה בדיוק בשבילך — כי ככה זה צריך לעבוד.',
    q2_text: '100% כותנה שנושמת וגזרות שמכבדות את הגוף שלך. בלי תפרים שמציקים, בלי להרגיש שאתה צריך להתאים את עצמך לבגד. פשוט לובשים ויוצאים.',
    q3_text: 'כל פריט עובר בדיקה לפני שהוא יוצא מהדלת. הדפסה לא חדה? צבע לא תקין? מייצרים מחדש. הזמנת — מגיע לך שזה יהיה מושלם.',
    q4_text: 'הגיע פגום? מוצר שגוי? שלחו מייל תוך 30 יום מהמסירה עם תמונה ומספר הזמנה — נחליף או נחזיר כסף. בלי סיבוכים.',
    about_title: 'מי אנחנו ב-DUBIS?',
    about_p1: 'יש רגע — בדרך כלל אחרי גיל 40 — שנופל לך האסימון: החיים קצרים מדי בשביל בגדים שמרגישים כאילו הם שייכים למישהו אחר. עברנו כבר כמה דברים, בנינו חיים שאנחנו מרוצים מהם, ואין לנו כוח להתנצל על זה.',
    about_p2: 'אבל כשמסתכלים על האופנה? פתאום מרגישים שמצפים מאיתנו להשתנות בשביל הבגד, לא להפך. DUBIS קם כדי לשים לזה סוף. הפסקנו לחכות שהמותגים יראו אותנו — וייצרנו את מה שתמיד חיפשנו.',
    about_p3: 'בגדים לאנשים כמונו. בלי דוגמנים מפוטושפים, בלי מידות בלתי אפשריות. רק נוחות אמיתית, גזרות שמחמיאות לגוף כמו שהוא, וביטויים שאומרים לעולם: "ככה אני, ואני עף על זה."',
    about_tag: 'אם נמאס לכם לבחור בין להיראות טוב לבין להרגיש בנוח — הגעתם הביתה. 🐾',
    contact_title: 'צור קשר', contact_sub: 'שאלות? רעיונות? רוצה להגיד שלום?',
    cart_title: 'העגלה שלך 🐾', cart_empty: 'עוד ריק. הדברים הנכונים במרחק קליק. 🐾',
    cart_total: 'סה"כ', cart_checkout: 'לתשלום',
    modal_color: 'צבע', modal_size: 'מידה',
    modal_made: '🏭 נתפר במיוחד בשבילך, ברגע ההזמנה.',
    modal_material: '👕 בד שזז איתך, לא נגדך.',
    modal_returns: '↩️ פגם? מוצר שגוי? מחזירים בלי סיבוכים.',
    modal_add: 'זה שלי 🐾',
    tab_details: 'פרטים', tab_size: 'מדריך מידות', tab_care: 'טיפול',
    shipping_note: '✈️ + משלוח · חינם מ-₪222',
    modal_ships: '🚚 משלוח תוך 5–9 ימי עסקים', modal_free_ship: 'משלוח חינם מעל ₪222',
    modal_dtg: 'DTG — הדפסה ישירה על הבד',
    modal_fabric: 'בד', modal_fit: 'גזרה', modal_print: 'הדפסה', modal_print_areas: 'אזורי הדפסה',
    size_size: 'מידה', size_chest: 'חזה (ס"מ)', size_length: 'אורך (ס"מ)',
    size_vary: '*מידות עשויות להשתנות ±2 ס"מ', size_cap_note: 'רצועה מתכווננת, מתאים לרוב הראשים',
    cookie_text: '🐾 אנחנו משתמשים בעוגיות. ממש מינימום, רק מה שצריך.',
    cookie_accept: 'אישור', cookie_decline: 'דחייה', cookie_privacy: 'מדיניות פרטיות',
    footer_privacy: 'מדיניות פרטיות', footer_terms: 'תנאי שימוש', footer_returns: 'החזרות', footer_contact: 'צור קשר', footer_shop: 'חנות',
    footer_rights: '© 2026 DUBIS. כל הזכויות שמורות.',
    lang_btn: 'EN',
    faq_title: 'שאלות נפוצות',
    faq_subtitle: 'כל מה שרצית לדעת, בלי לחפש',
    faq_q1: 'אילו מידות יש לכם?',
    faq_a1: 'S עד 3XL. כל המידות רחבות ונוחות — אם אתה בין מידות, קח את הקטנה. טבלת מידות מפורטת בכל עמוד מוצר.',
    faq_q2: 'כמה זמן לוקח המשלוח?',
    faq_a2: 'משלוח: $8.99 (חינם בהזמנה מעל $60). זמן הכנה: 3–5 ימי עסקים (מודפס לפי הזמנה). משלוח: 5–12 ימי עסקים לפי היעד. סה"כ: 8–17 ימי עסקים.',
    faq_q3: 'מה מדיניות ההחזרות?',
    faq_a3: 'החזרות רק במקרה של פגם, מוצר שגוי, או אבדן במשלוח. שלחו מייל ל-dubis.brand@gmail.com תוך 30 יום מהמסירה עם תמונה ומספר הזמנה.',
    faq_q4: 'ההדפסה מחזיקה?',
    faq_a4: 'אנחנו עובדים עם DTG — הדפסה ישירה על הבד, לא מדבקה. ההדפסה שורדת עשרות כביסות בלי בעיה.',
    faq_q5: 'למה המחיר כזה?',
    faq_a5: 'כל פריט מיוצר בנפרד לפי הזמנה — לא קו ייצור של אלפים. DTG איכותי, בד טוב, עיצוב מקורי. מוצר שלובשים שנים.',
    faq_q6: 'יש חנות פיזית?',
    faq_a6: 'לא. DUBIS הוא אונליין בלבד. ככה שומרים על מחירים הוגנים.',
    faq_q7: 'איך מכבסים?',
    faq_a7: 'כביסה רגילה 30°C, הפוך לפני כביסה, לא לטמבור. ההדפסה תשרוד.',
  }
};

// ===== LANGUAGE DETECTION =====
function detectLanguage() {
  const saved = localStorage.getItem('dubis-lang');
  if (saved) { setLanguage(saved); return; }

  // Use browser language preference — fast, free, no external request
  const lang = navigator.language || navigator.languages?.[0] || 'en';
  setLanguage(lang.startsWith('he') ? 'he' : 'en');
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
  const heroSubtitle = q('.hero-subtitle');
  const heroDesc = q('.hero-desc');
  const heroBtn = q('.hero-content .btn-primary');
  if (heroTagline) heroTagline.textContent = t.hero_tagline;
  if (heroSubtitle && t.hero_subtitle) heroSubtitle.textContent = t.hero_subtitle;
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

  // FAQ
  if (q('#faq-title'))    q('#faq-title').textContent    = t.faq_title;
  if (q('#faq-subtitle')) q('#faq-subtitle').textContent = t.faq_subtitle;
  var faqKeys = ['faq_q1','faq_q2','faq_q3','faq_q4','faq_q5','faq_q6','faq_q7'];
  var faqAnsKeys = ['faq_a1','faq_a2','faq_a3','faq_a4','faq_a5','faq_a6','faq_a7'];
  qa('.faq-q-text').forEach(function(el, i) { if (faqKeys[i] && t[faqKeys[i]]) el.textContent = t[faqKeys[i]]; });
  qa('.faq-answer p').forEach(function(el, i) { if (faqAnsKeys[i] && t[faqAnsKeys[i]]) el.textContent = t[faqAnsKeys[i]]; });

  // Cart
  if (q('.cart-header h3')) q('.cart-header h3').textContent = t.cart_title;
  if (q('.cart-footer .btn-primary')) q('.cart-footer .btn-primary').textContent = t.cart_checkout;

  // Cookie banner
  if (q('.cookie-content > span')) q('.cookie-content > span').textContent = t.cookie_text;
  if (q('.btn-cookie-accept')) q('.btn-cookie-accept').textContent = t.cookie_accept;
  if (q('.btn-cookie-decline')) q('.btn-cookie-decline').textContent = t.cookie_decline;
  if (q('.cookie-link')) q('.cookie-link').textContent = t.cookie_privacy;

  // Footer (5 links: Privacy, Terms, Returns, Contact, Shop)
  const footerLinks = qa('.footer-links a');
  if (footerLinks[0]) footerLinks[0].textContent = t.footer_privacy;
  if (footerLinks[1]) footerLinks[1].textContent = t.footer_terms;
  if (footerLinks[2]) footerLinks[2].textContent = t.footer_returns;
  if (footerLinks[3]) footerLinks[3].textContent = t.footer_contact;
  if (footerLinks[4]) footerLinks[4].textContent = t.footer_shop;
  if (q('.footer > p')) q('.footer > p').textContent = t.footer_rights;

  // Lang toggle
  if (q('.lang-toggle')) q('.lang-toggle').textContent = t.lang_btn;

  // Re-render dynamic content
  renderProducts();
  injectProductStructuredData();
  if (q('.cart-modal.open')) renderCart();
}

// ===== PRODUCT STRUCTURED DATA (JSON-LD for SEO) =====
function injectProductStructuredData() {
  const existing = document.getElementById('dubis-product-jsonld');
  if (existing) existing.remove();

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'DUBIS Collection',
    url: 'https://www.dubis.net/',
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        '@id': `https://www.dubis.net/#product-${p.id}`,
        name: p.phrase,
        description: p.description,
        image: `https://www.dubis.net/${p.image}`,
        brand: { '@type': 'Brand', name: 'DUBIS' },
        category: p.typeLabel,
        offers: {
          '@type': 'Offer',
          price: p.price,
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: `https://www.dubis.net/#product-${p.id}`,
          seller: { '@type': 'Organization', name: 'DUBIS' }
        }
      }
    }))
  };

  const script = document.createElement('script');
  script.id   = 'dubis-product-jsonld';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(itemList);
  document.head.appendChild(script);
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
        <div class="product-rating-badge" id="badge-${product.id}">${currentLang === 'he' ? 'NEW' : 'NEW'}</div>
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
          <div class="product-price">${formatPrice(product.price)}</div>
          <div class="product-shipping-note">${(translations[currentLang]||translations.en).shipping_note}</div>
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
  if (window.dubisTrack && product) window.dubisTrack('product_view', { id: product.id, phrase: product.phrase, type: product.type, price: product.price });
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
        <img id="modal-img-src-${product.id}" loading="lazy"
             src="${productImg(product.id, product.colors[0], 'front')}"
             alt="${product.phrase}"
             data-color="${product.colors[0]}"
             data-view="front"
             onerror="this.onerror=null;this.src='${product.image}'" />
      </div>
      <div class="modal-thumbnails" id="modal-thumbs-${product.id}">
        <div class="thumb active" data-view="front" onclick="setModalThumb(event, ${product.id}, 'front')">
          <img src="${productImg(product.id, product.colors[0], 'front')}" alt="Front view" loading="lazy"
               onerror="this.onerror=null;this.src='${product.image}'" />
        </div>
        <div class="thumb" data-view="back" onclick="setModalThumb(event, ${product.id}, 'back')">
          <img src="${productImg(product.id, product.colors[0], 'back')}" alt="Back view" loading="lazy"
               onerror="this.onerror=null;this.src='${product.image}'" />
        </div>
      </div>
    </div>
    <div class="modal-info">
      <div class="modal-type">${typeMap[product.type] || product.typeLabel}</div>
      <div class="modal-limited-badge">&#128293; ${currentLang === 'he' ? 'מהדורה מוגבלת' : 'Limited Edition'}</div>
      <h2 class="modal-phrase">"${product.phrase}"</h2>
      <div class="modal-recent-buyers">&#128101; ${(function(name){let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;return 8+h%13;})(product.phrase)} ${currentLang === 'he' ? 'אנשים קנו את זה ב-30 הימים האחרונים' : 'people bought this in the last 30 days'}</div>
      <div class="modal-price">${formatPrice(product.price)}</div>
      <div class="modal-shipping-info">${t.modal_ships} · <span class="free-ship-badge">${t.modal_free_ship}</span></div>
      <div class="modal-dtg-badge">${t.modal_dtg}</div>
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
        <div class="modal-selected-color" id="modal-color-name-${product.id}">${product.colors[0]}</div>
      </div>
      <div class="modal-option">
        <label>${t.modal_size} <a href="javascript:void(0)" onclick="showSizeGuideTab(${product.id})" style="font-size:0.75rem;color:#c8a96e;margin-left:0.5rem;text-decoration:underline">${currentLang === 'he' ? '📏 טבלת מידות' : '📏 Size Guide'}</a></label>
        <div class="modal-sizes" id="modal-sizes-${product.id}">
          ${product.sizes.map((s, i) => `
            <button class="size-btn ${i === 0 ? 'selected' : ''}"
              onclick="selectSize(this, '${s}', ${product.id})" data-size="${s}">
              ${s}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="modal-trust-badges">
        <span>&#128274; ${currentLang === 'he' ? 'תשלום מאובטח' : 'Secure Checkout'}</span>
        <span>&#128666; ${currentLang === 'he' ? 'משלוח $8.99 · חינם מעל $60' : '$8.99 Shipping · Free over $60'}</span>
        <span>&#8617;&#65039; ${currentLang === 'he' ? 'החזרה על פגמים תוך 30 יום' : '30-Day Defect Returns'}</span>
      </div>
      <button class="btn-primary modal-add-btn" onclick="addToCartFromModal(${product.id})">
        ${t.modal_add}
      </button>
      ${(currentLang === 'he' && product.description_he ? product.description_he : product.description) ? `<p class="product-description">${currentLang === 'he' && product.description_he ? product.description_he : product.description}</p>` : ''}
      <div class="product-tabs">
        <button class="prod-tab active" onclick="switchTab(this,'tab-details-${product.id}')">${t.tab_details}</button>
        <button class="prod-tab" onclick="switchTab(this,'tab-size-${product.id}')">${t.tab_size}</button>
        <button class="prod-tab" onclick="switchTab(this,'tab-care-${product.id}')">${t.tab_care}</button>
        <button class="prod-tab" onclick="switchTab(this,'tab-reviews-${product.id}');loadModalReviews(${product.id},'${product.phrase.replace(/'/g, "\\'")}')">⭐ ${currentLang === 'he' ? 'ביקורות' : 'Reviews'}</button>
      </div>
      <div class="prod-tab-content" id="tab-details-${product.id}">
        ${product.fabric ? `<p>🧵 <strong>${t.modal_fabric}:</strong> ${product.fabric}</p>` : ''}
        ${product.fit ? `<p>📐 <strong>${t.modal_fit}:</strong> ${product.fit}</p>` : ''}
        ${product.printMethod ? `<p>🖨️ <strong>${t.modal_print}:</strong> ${product.printMethod}</p>` : ''}
        ${product.printAreas ? `<p>📍 <strong>${t.modal_print_areas}:</strong> ${product.printAreas.join(', ')}</p>` : ''}
      </div>
      <div class="prod-tab-content hidden" id="tab-size-${product.id}">
        ${product.sizeGuide && product.sizeGuide[0] && product.sizeGuide[0].note
          ? `<p style="font-size:0.85rem;color:#555">${t.size_cap_note}</p>`
          : `<table class="size-table">
              <tr><th>${t.size_size}</th><th>${t.size_chest}</th><th>${t.size_length}</th></tr>
              ${(product.sizeGuide || []).map(r => `<tr><td>${r.size}</td><td>${r.chest}</td><td>${r.length}</td></tr>`).join('')}
            </table>
            <small style="color:#888">${t.size_vary}</small>`
        }
      </div>
      <div class="prod-tab-content hidden" id="tab-care-${product.id}">
        <ul class="care-list">${(currentLang === 'he' && product.care_he ? product.care_he : (product.care || [])).map(c => `<li>${c}</li>`).join('')}</ul>
      </div>
      <div class="prod-tab-content hidden" id="tab-reviews-${product.id}">
        <div id="reviews-container-${product.id}" style="text-align:center;color:#555;padding:1rem">Loading reviews…</div>
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

// Reviews tab loader
const _reviewsTabLoaded = {};
async function loadModalReviews(productId, productName) {
  if (_reviewsTabLoaded[productId]) return;
  _reviewsTabLoaded[productId] = true;
  const container = document.getElementById(`reviews-container-${productId}`);
  if (!container) return;
  if (window.dubisReviews) {
    container.innerHTML = await window.dubisReviews.injectTab(productId, productName);
    window.dubisReviews.initInteractions(productId, productName);
  } else {
    container.innerHTML = '<div style="color:#555;padding:1rem;text-align:center">Reviews not available</div>';
  }
}

function switchTab(btn, tabId) {
  const tabs = btn.closest('.modal-info').querySelectorAll('.prod-tab');
  const contents = btn.closest('.modal-info').querySelectorAll('.prod-tab-content');
  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.remove('hidden');
}

function showSizeGuideTab(productId) {
  const tabEl = document.getElementById(`tab-size-${productId}`);
  if (!tabEl) return;
  const tabBtns = tabEl.closest('.modal-info').querySelectorAll('.prod-tab');
  const sizeBtn = [...tabBtns].find(b => b.textContent.includes('Size') || b.textContent.includes('טבלה'));
  if (sizeBtn) { switchTab(sizeBtn, `tab-size-${productId}`); }
  tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectColor(btn, color, productId) {
  document.querySelectorAll(`#modal-colors-${productId} .color-btn`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById(`selected-color-${productId}`).textContent = color;

  // Update color name display
  const colorNameEl = document.getElementById(`modal-color-name-${productId}`);
  if (colorNameEl) colorNameEl.textContent = color;

  // Swap modal image to selected color (preserve current front/back view)
  const imgEl = document.getElementById(`modal-img-src-${productId}`);
  if (imgEl) {
    const view = imgEl.dataset.view || 'back';
    const product = products.find(p => p.id === productId);
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
    imgEl.src = productImg(productId, color, view);
    imgEl.dataset.color = color;
  }

  // Update thumbnail images to show newly selected color
  const thumbsContainer = document.getElementById(`modal-thumbs-${productId}`);
  if (thumbsContainer) {
    const product = products.find(p => p.id === productId);
    thumbsContainer.querySelectorAll('.thumb').forEach(thumb => {
      const thumbView = thumb.dataset.view;
      const thumbImg = thumb.querySelector('img');
      if (thumbImg && thumbView) {
        thumbImg.onerror = () => { thumbImg.onerror = null; thumbImg.src = product?.image || ''; };
        thumbImg.src = productImg(productId, color, thumbView);
      }
    });
  }
}

function setModalView(productId, view) {
  // Sync thumbnail active state
  const thumbsContainer = document.getElementById(`modal-thumbs-${productId}`);
  if (thumbsContainer) {
    thumbsContainer.querySelectorAll('.thumb').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });
  }

  const imgEl = document.getElementById(`modal-img-src-${productId}`);
  if (imgEl) {
    const color = imgEl.dataset.color || products.find(p => p.id === productId)?.colors[0] || '';
    const product = products.find(p => p.id === productId);
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
    imgEl.src = productImg(productId, color, view);
    imgEl.dataset.view = view;
  }
}

function setModalThumb(event, productId, view) {
  const thumbsContainer = document.getElementById(`modal-thumbs-${productId}`);
  if (thumbsContainer) {
    thumbsContainer.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
    event.currentTarget.classList.add('active');
  }
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
  saveCart();
  if (window.dubisTrack) window.dubisTrack('add_to_cart', { id: product.id, phrase: product.phrase, type: product.type, price: product.price, color: selectedColor, size: selectedSize, source: 'modal' });
  // Meta Pixel — AddToCart event
  if (typeof fbq === 'function') {
    fbq('track', 'AddToCart', { value: product.price, currency: 'USD', content_name: product.phrase, content_type: 'product' });
  }
  updateCartCount();
  showCartNotification(product.phrase);
  closeProductModal();
}

function quickAddToCart(productId, btnEl) {
  const product = products.find(p => p.id === productId);
  const card = document.querySelector(`.product-card[data-id="${productId}"]`);
  const selectedColor = card?.dataset.selectedColor || product.colors[0];
  cart.push({ ...product, selectedColor, selectedSize: product.sizes[2] || 'L' });
  saveCart();
  if (window.dubisTrack) window.dubisTrack('add_to_cart', { id: product.id, phrase: product.phrase, type: product.type, price: product.price, color: selectedColor, source: 'quick' });
  updateCartCount();
  showCartNotification(product.phrase);
  if (btnEl) animateAddToCart(btnEl);
}

// ===== CART =====
function saveCart() {
  try { localStorage.setItem('dubis-cart', JSON.stringify(cart)); } catch(e) {}
}

function loadCart() {
  try {
    const saved = localStorage.getItem('dubis-cart');
    if (saved) { cart = JSON.parse(saved); updateCartCount(); }
  } catch(e) { cart = []; }
}

function updateCartCount() {
  document.getElementById('cart-count').textContent = cart.length;
}

function openCart() {
  document.getElementById('cart-modal').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
  renderCart();
  if (window.dubisTrack) window.dubisTrack('checkout_open', { items: cart.length, total: cart.reduce((s, i) => s + (i.price || 0), 0) });
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
        <div class="cart-item-price">${formatPrice(item.price)}</div>
        <button class="cart-item-remove" onclick="removeFromCart(${index})">✕</button>
      </div>
    </div>
  `).join('');

  cartTotal.textContent = cart.reduce((sum, item) => sum + item.price, 0);
}

function removeFromCart(index) {
  if (window.dubisTrack && cart[index]) window.dubisTrack('remove_from_cart', { id: cart[index].id, phrase: cart[index].phrase });
  cart.splice(index, 1);
  saveCart();
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
  const sections = document.querySelectorAll('.fade-in-section');

  // Fallback: if IntersectionObserver fails (e.g. in-app browsers like Facebook/Instagram),
  // force all sections visible after 1.5s so content is never hidden
  const fallbackTimer = setTimeout(() => {
    sections.forEach(el => el.classList.add('visible'));
  }, 1500);

  if ('IntersectionObserver' in window) {
    let revealed = 0;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          revealed++;
          // If all sections revealed via observer, cancel fallback
          if (revealed >= sections.length) clearTimeout(fallbackTimer);
        }
      });
    }, { threshold: 0.05 }); // lowered from 0.08 for better mobile trigger
    sections.forEach(el => observer.observe(el));
  } else {
    // No IntersectionObserver support — show everything immediately
    clearTimeout(fallbackTimer);
    sections.forEach(el => el.classList.add('visible'));
  }
}

// ===== ADD-TO-CART MICRO-ANIMATION =====
function animateAddToCart(btn) {
  btn.classList.add('adding');
  setTimeout(() => btn.classList.remove('adding'), 500);
}

// ===== PRICE OVERRIDES FROM SUPABASE =====
async function loadPriceOverrides() {
  try {
    const res = await fetch(
      `${window.DUBIS_SUPABASE_URL}/rest/v1/product_prices?select=product_id,selling_price,gelato_image_url`,
      { headers: { 'apikey': window.DUBIS_SUPABASE_ANON, 'Authorization': 'Bearer ' + window.DUBIS_SUPABASE_ANON } }
    );
    const data = res.ok ? await res.json() : null;
    if (data) {
      data.forEach(r => {
        const p = products.find(p => p.id === r.product_id);
        if (p) {
          if (r.selling_price) p.price = Number(r.selling_price);
          if (r.gelato_image_url) p.gelatoImg = r.gelato_image_url;
        }
      });
    }
  } catch (e) {
    // fallback to default prices from products.js
  }
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

// ── Load product reviews for badge display ──
let productReviews = {};
async function loadProductReviews() {
  try {
    if (!window.DUBIS_SUPABASE_URL) return;
    const res = await fetch(`${window.DUBIS_SUPABASE_URL}/rest/v1/product_reviews?approved=eq.true&select=product_name,rating`, {
      headers: { 'apikey': window.DUBIS_SUPABASE_ANON, 'Authorization': `Bearer ${window.DUBIS_SUPABASE_ANON}` }
    });
    const reviews = await res.json();
    if (!Array.isArray(reviews)) return;
    reviews.forEach(r => {
      const name = (r.product_name || '').toLowerCase();
      if (!productReviews[name]) productReviews[name] = { count: 0, total: 0 };
      productReviews[name].count++;
      productReviews[name].total += r.rating;
    });
    // Update badges on cards
    document.querySelectorAll('[id^="badge-"]').forEach(badge => {
      const id = badge.id.replace('badge-', '');
      const product = products.find(p => p.id == id);
      if (!product) return;
      const key = product.phrase.toLowerCase();
      const rev = productReviews[key];
      if (rev && rev.count > 0) {
        const avg = (rev.total / rev.count).toFixed(1);
        badge.textContent = `★ ${avg} (${rev.count})`;
        badge.classList.add('has-reviews');
      }
    });
  } catch { /* non-critical */ }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadCart();
  checkCookieConsent();
  await loadPriceOverrides();
  detectLanguage(); // IP-based language detection → renders products after
  initScrollAnimations();
  loadProductReviews(); // Load reviews for badges (non-blocking)
});
