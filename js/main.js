// DUBIS - Main JavaScript
// Agent: CTO | Version 2.0
// Features: IP-based Hebrew detection, full i18n, color swatch preview

let cart = [];
// Declared HERE (top of script) and not next to loadProductReviews below:
// openProductModal reads `productReviews`, and the deep-link auto-open IIFE
// calls it synchronously DURING script evaluation — a `let` declared lower in
// the file is still in its temporal dead zone at that moment, so even
// `typeof productReviews` THROWS. That single ReferenceError killed EVERY
// `?p=`/`#product-` deep link (they all landed on the homepage) from Wave A
// until 2026-08-27, when Vlad's review email exposed it.
let productReviews = {};
let currentLang  = 'en';
window.currentLang = currentLang;  // initial mirror — updated by setLanguage()
let _activeFilter = 'all';
let _activeGender = 'all';

// True when every (color, size) variant of this product is OOS in the stock
// map. Used to suppress fake-urgency badges and to gate the modal.
function isProductFullyOOS(productId) {
  const map = window.__DUBIS_STOCK_MAP?.[productId];
  if (!map) return false; // no data yet → optimistic
  for (const c of Object.keys(map)) for (const s of Object.keys(map[c])) {
    if (map[c][s] !== false) return false; // anything true / undefined → not fully OOS
  }
  return true;
}

// ── Stock urgency (deterministic per product) ──
// Pure FOMO number derived from product ID — NOT real stock. But: if the
// stock map says every variant is OOS, return 0 so the UI can suppress the
// "Only X left" badge entirely (it's misleading next to a SOLD OUT button).
function getStockNum(id) {
  if (isProductFullyOOS(id)) return 0;
  const seed = (id * 7 + 3) % 19;
  return seed < 4 ? seed + 3 : seed < 10 ? seed + 2 : seed;
}

// ── Country availability badges (2026-05-21, expanded to 30 countries) ──
// `product.supportedCountries` is the result of a /v4/orders:quote probe per
// (product, country) — see scripts/probe-product-country-availability.js.
// Used to render flag emojis on cards + a "Ships to" list in the modal so a
// visitor from anywhere can see at a glance whether the product reaches them.
// NOTE: SOLO availability. A product flagged for country X can still fail at
// cart-level if mixed with another product Gelato can only produce from a
// different warehouse — the runtime stock-probe / cart-level probe handles that.
const COUNTRY_FLAG = {
  US: '🇺🇸', CA: '🇨🇦', MX: '🇲🇽',
  GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', NL: '🇳🇱',
  PL: '🇵🇱', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', BE: '🇧🇪',
  AT: '🇦🇹', CH: '🇨🇭', PT: '🇵🇹', GR: '🇬🇷', CZ: '🇨🇿',
  IL: '🇮🇱', AE: '🇦🇪', SA: '🇸🇦',
  AU: '🇦🇺', NZ: '🇳🇿',
  JP: '🇯🇵', SG: '🇸🇬', HK: '🇭🇰',
  BR: '🇧🇷', AR: '🇦🇷',
};
const COUNTRY_NAME = {
  US: { en: 'United States',  he: 'ארה״ב'     },
  CA: { en: 'Canada',         he: 'קנדה'      },
  MX: { en: 'Mexico',         he: 'מקסיקו'   },
  GB: { en: 'United Kingdom', he: 'בריטניה'  },
  DE: { en: 'Germany',        he: 'גרמניה'   },
  FR: { en: 'France',         he: 'צרפת'     },
  IT: { en: 'Italy',          he: 'איטליה'   },
  ES: { en: 'Spain',          he: 'ספרד'     },
  NL: { en: 'Netherlands',    he: 'הולנד'    },
  PL: { en: 'Poland',         he: 'פולין'    },
  SE: { en: 'Sweden',         he: 'שוודיה'   },
  NO: { en: 'Norway',         he: 'נורווגיה' },
  DK: { en: 'Denmark',        he: 'דנמרק'    },
  FI: { en: 'Finland',        he: 'פינלנד'   },
  BE: { en: 'Belgium',        he: 'בלגיה'    },
  AT: { en: 'Austria',        he: 'אוסטריה'  },
  CH: { en: 'Switzerland',    he: 'שווייץ'   },
  PT: { en: 'Portugal',       he: 'פורטוגל'  },
  GR: { en: 'Greece',         he: 'יוון'     },
  CZ: { en: 'Czech Republic', he: "צ'כיה"    },
  IL: { en: 'Israel',         he: 'ישראל'    },
  AE: { en: 'UAE',            he: 'איחוד האמירויות' },
  SA: { en: 'Saudi Arabia',   he: 'ערב הסעודית' },
  AU: { en: 'Australia',      he: 'אוסטרליה' },
  NZ: { en: 'New Zealand',    he: 'ניו זילנד' },
  JP: { en: 'Japan',          he: 'יפן'      },
  SG: { en: 'Singapore',      he: 'סינגפור'  },
  HK: { en: 'Hong Kong',      he: 'הונג קונג' },
  BR: { en: 'Brazil',         he: 'ברזיל'    },
  AR: { en: 'Argentina',      he: 'ארגנטינה' },
};
// Default if a product was created before the probe ran. NOT empty array —
// optimistic "ships to common countries" until the next probe overwrites it.
const DEFAULT_SUPPORTED = ['US','CA','GB','DE','FR','IL','AU'];

function countryFlagsForProduct(product) {
  return Array.isArray(product?.supportedCountries) ? product.supportedCountries : DEFAULT_SUPPORTED;
}

// 2026-05-23 (oren feedback on country-UX pilot): modal "Ships in ... business days"
// was hardcoded to "...to US", confusing for IL / EU / other customers. Pick the
// right range based on the customer's detected country.
//
// Estimates per Gelato Dispatch published windows (production 1–3d + DHL transit):
//   US                  → 5–7 business days  (US facility — Chicago/NJ/CA/TX)
//   IL                  → 7–10 business days (CZ facility + DHL international)
//   EU (DE/AT/NL/BE/FR/IT/ES/DK/FI/SE/PL/GR/IE/PT/CZ) → 5–7
//   GB                  → 5–7
//   Long-haul (AU/NZ/JP/SG/HK/MX/BR/CH/AR/SA + everything else) → 7–12
const _SHIP_EU = new Set(['DE','AT','NL','BE','FR','IT','ES','DK','FI','SE','PL','GR','IE','PT','CZ','SK','HU','LU']);
function shippingDaysForCountry(country) {
  const c = (country || '').toUpperCase();
  if (c === 'US')                     return { days: '5–7',  region: 'US' };
  if (c === 'IL')                     return { days: '7–10', region: 'IL' };
  if (c === 'GB' || c === 'UK')       return { days: '5–7',  region: 'GB' };
  if (_SHIP_EU.has(c))                return { days: '5–7',  region: c   };
  if (c)                              return { days: '7–12', region: c   };
  return                                     { days: '5–10', region: null }; // unknown country
}
function modalShipsTextFor(country, lang) {
  const { days, region } = shippingDaysForCountry(country);
  const cName = region ? ((COUNTRY_NAME[region] || {})[lang] || region) : null;
  if (lang === 'he') {
    return cName ? `🚚 משלוח תוך ${days} ימי עסקים ל${cName}`
                 : `🚚 משלוח תוך ${days} ימי עסקים`;
  }
  return   cName ? `🚚 Ships in ${days} business days to ${cName}`
                 : `🚚 Ships in ${days} business days`;
}

// Wave A (2026-07-24): concrete delivery window — "Expected delivery: Aug 4–8"
// beats "5–7 business days" (True Classic pattern; shipping anxiety is the #1
// stated objection). Derived from the SAME shippingDaysForCountry table, so the
// two claims can never disagree.
function _addBusinessDays(from, n) {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 5 && dow !== 6) added++; // skip Fri+Sat (covers IL weekend; close enough for US too)
  }
  return d;
}
function deliveryWindowText(country, lang) {
  const { days } = shippingDaysForCountry(country);
  const m = String(days).match(/(\d+)\D+(\d+)/);
  if (!m) return '';
  const start = _addBusinessDays(new Date(), Number(m[1]) + 1); // +1 production dispatch buffer
  const end   = _addBusinessDays(new Date(), Number(m[2]) + 2);
  const loc = lang === 'he' ? 'he-IL' : 'en-US';
  const fmt = (d) => d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
  const sameMonth = start.getMonth() === end.getMonth();
  const range = sameMonth
    ? (lang === 'he' ? `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(loc, { month: 'short' })}` : `${start.toLocaleDateString(loc, { month: 'short' })} ${start.getDate()}–${end.getDate()}`)
    : `${fmt(start)} – ${fmt(end)}`;
  return lang === 'he' ? `📅 צפי הגעה: ${range}` : `📅 Expected delivery: ${range}`;
}

// 2026-05-22: Customer's GEOGRAPHIC country — independent of UI language.
// Bug oren caught: previously inferred IL from dubis-lang='he' which is wrong
// (a US user toggling Hebrew because they're a Hebrew speaker isn't in IL).
// Country is now strictly determined by:
//   1. localStorage.dubis-country-override (manual user selection — wins everything)
//   2. live checkout address (filled in checkout modal)
//   3. localStorage.dubis-country (cached ipapi.co result, 24h TTL)
//   4. sessionStorage.dubis-country (legacy fallback, still read for backwards compat)
//   5. null = unknown — UI shows no country badge instead of guessing
// Returns ISO-2 uppercase, or null if detection hasn't completed/failed.
function detectedCustomerCountry() {
  const o = localStorage.getItem('dubis-country-override');
  if (o) return String(o).toUpperCase();
  const a = window.checkoutAddress && window.checkoutAddress.country_code;
  if (a) return String(a).toUpperCase();
  // localStorage cached geo (with TTL)
  try {
    const cached = localStorage.getItem('dubis-country');
    if (cached) {
      const obj = JSON.parse(cached);
      if (obj && obj.cc && obj.ts && (Date.now() - obj.ts < 24 * 3600 * 1000)) {
        return String(obj.cc).toUpperCase();
      }
    }
  } catch (_) {}
  const g = sessionStorage.getItem('dubis-country');
  if (g) return String(g).toUpperCase();
  return null;
}

// Trigger ipapi.co geo lookup. Independent of language preference — runs
// even when the user has manually toggled HE/EN. Result cached in
// sessionStorage.dubis-country. Re-renders cards + cart drawer if they're
// currently visible so badges update once the country is known.
let __geoCountryPromise = null;
function ensureGeoCountry() {
  // Skip remote lookup if we already have ANY signal (override, cached, or session).
  const existing = detectedCustomerCountry();
  if (existing) {
    updateCountryToggleDisplay(existing);
    return Promise.resolve(existing);
  }
  if (__geoCountryPromise) return __geoCountryPromise;
  __geoCountryPromise = (async () => {
    // 2026-05-22: PRIMARY source is our own /api/cron/morning-report?type=geo,
    // which echoes the x-vercel-ip-country header. Same-origin, no CORS, no
    // ad-blocker interception (Privacy Badger / uBlock target ipapi.co etc.
    // but not the site's own API). Fallback to ipapi.co → ipwho.is only if
    // Vercel's header is missing (preview deployment, etc.).
    const tryEndpoint = async (url, parser) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const data = await res.json();
        return parser(data);
      } catch (_) { return null; }
    };
    let cc = await tryEndpoint('/api/cron/morning-report?type=geo', d => d && d.country_code ? String(d.country_code).toUpperCase() : null);
    if (!cc) cc = await tryEndpoint('https://ipapi.co/json/', d => d && d.country_code ? String(d.country_code).toUpperCase() : null);
    if (!cc) cc = await tryEndpoint('https://ipwho.is/', d => d && d.country_code ? String(d.country_code).toUpperCase() : null);
    if (cc) {
      // Cache for 24h.
      try { localStorage.setItem('dubis-country', JSON.stringify({ cc, ts: Date.now() })); } catch (_) {}
      sessionStorage.setItem('dubis-country', cc);   // legacy compat
      console.log('[DUBIS-GEO] detected country:', cc);
      updateCountryToggleDisplay(cc);
      // Refresh any visible surfaces that depend on it.
      try { if (typeof renderProducts === 'function' && document.querySelector('.product-card')) renderProducts(); } catch (_) {}
      try { if (typeof renderCart === 'function' && document.querySelector('.cart-modal.open')) renderCart(); } catch (_) {}
      return cc;
    }
    console.warn('[DUBIS-GEO] geo lookup failed — country unknown, customer can pick manually');
    updateCountryToggleDisplay(null);
    return null;
  })();
  return __geoCountryPromise;
}

// Update the header country-toggle button to show the current detected/selected country.
// 2026-05-22 (oren feedback): when country is KNOWN, the button glows honey
// (CSS class .country-detected) so the customer sees that we know where to
// ship. When unknown, the button is dim/grey + says "Pick" to invite action.
function updateCountryToggleDisplay(cc) {
  const codeEl = document.getElementById('country-code-display');
  const btn    = document.getElementById('country-toggle');
  if (!codeEl || !btn) return;
  if (!cc) {
    codeEl.textContent = currentLang === 'he' ? 'בחר' : 'Pick';
    btn.querySelector('.country-flag-display').textContent = '🌐';
    btn.title = currentLang === 'he' ? 'בחר/י ארץ למשלוח' : 'Pick shipping country';
    btn.classList.remove('country-detected');
    btn.classList.add('country-unknown');
    return;
  }
  const flag = COUNTRY_FLAG[cc] || '🌐';
  const name = (COUNTRY_NAME[cc] || {})[currentLang] || cc;
  // 2026-05-22 (oren screenshot): on Windows the flag emoji renders as the
  // regional-indicator letters "IL" — combined with the ISO code "IL" the
  // button read "SHIP TO IL IL". Replace the ISO code with the localized
  // country NAME so we get either "SHIP TO 🇮🇱 Israel" (macOS/mobile) or
  // "SHIP TO IL Israel" (Windows) — no duplication, name always present.
  codeEl.textContent = name;
  btn.querySelector('.country-flag-display').textContent = flag;
  btn.classList.add('country-detected');
  btn.classList.remove('country-unknown');
  btn.title = (currentLang === 'he' ? 'משלוח אל ' : 'Shipping to ') + name + (currentLang === 'he' ? ' · לחיצה לשינוי' : ' · click to change');
}

// Open the country-picker modal — full grid of 30 supported countries + auto-detect indicator.
function openCountryPicker() {
  const overlay = document.getElementById('country-picker-overlay');
  const picker  = document.getElementById('country-picker');
  const grid    = document.getElementById('country-picker-grid');
  const detEl   = document.getElementById('country-picker-detected');
  if (!overlay || !picker || !grid) return;

  const current = detectedCustomerCountry();
  const supportedSet = new Set(Object.keys(COUNTRY_FLAG));
  const override = localStorage.getItem('dubis-country-override');
  let cachedAuto = null;
  try {
    const c = localStorage.getItem('dubis-country');
    if (c) { const o = JSON.parse(c); if (o && o.cc) cachedAuto = o.cc; }
  } catch (_) {}

  if (detEl) {
    if (override) {
      const ovName = (COUNTRY_NAME[override.toUpperCase()] || {})[currentLang] || override;
      detEl.innerHTML = (currentLang === 'he'
        ? `<strong>בחירה ידנית:</strong> ${COUNTRY_FLAG[override] || ''} ${ovName} · <a href="#" onclick="resetCountryOverride(event)">חזרה לזיהוי אוטומטי</a>`
        : `<strong>Manual selection:</strong> ${COUNTRY_FLAG[override] || ''} ${ovName} · <a href="#" onclick="resetCountryOverride(event)">reset to auto-detect</a>`);
    } else if (cachedAuto) {
      const autoName = (COUNTRY_NAME[cachedAuto] || {})[currentLang] || cachedAuto;
      detEl.innerHTML = (currentLang === 'he'
        ? `<strong>זוהה אוטומטית מ-IP:</strong> ${COUNTRY_FLAG[cachedAuto] || ''} ${autoName}`
        : `<strong>Auto-detected from your IP:</strong> ${COUNTRY_FLAG[cachedAuto] || ''} ${autoName}`);
    } else {
      detEl.innerHTML = currentLang === 'he'
        ? `<strong>הזיהוי האוטומטי נכשל</strong> — בחר/י מהרשימה למטה.`
        : `<strong>Auto-detect failed.</strong> Please pick from the list below.`;
    }
  }

  // Sort countries alphabetically by localized name
  const sorted = Object.keys(COUNTRY_FLAG).sort((a, b) => {
    const na = (COUNTRY_NAME[a] || {})[currentLang] || a;
    const nb = (COUNTRY_NAME[b] || {})[currentLang] || b;
    return na.localeCompare(nb);
  });
  grid.innerHTML = sorted.map(cc => {
    const name = (COUNTRY_NAME[cc] || {})[currentLang] || cc;
    const isCurrent = cc === current;
    return `<button class="country-picker-option${isCurrent ? ' current' : ''}" onclick="pickCountry('${cc}')">
      <span class="cpo-flag">${COUNTRY_FLAG[cc]}</span>
      <span class="cpo-name">${name}</span>
      <span class="cpo-code">${cc}</span>
    </button>`;
  }).join('');

  overlay.classList.add('open');
  picker.classList.add('open');
}

function closeCountryPicker() {
  document.getElementById('country-picker-overlay')?.classList.remove('open');
  document.getElementById('country-picker')?.classList.remove('open');
}

function pickCountry(cc) {
  if (!cc) return;
  localStorage.setItem('dubis-country-override', cc);
  updateCountryToggleDisplay(cc);
  closeCountryPicker();
  // Refresh anything visible
  try { if (typeof renderProducts === 'function' && document.querySelector('.product-card')) renderProducts(); } catch (_) {}
  try { if (typeof renderCart === 'function' && document.querySelector('.cart-modal.open')) renderCart(); } catch (_) {}
}

function resetCountryOverride(ev) {
  if (ev) ev.preventDefault();
  localStorage.removeItem('dubis-country-override');
  // Re-trigger geo detection
  __geoCountryPromise = null;
  ensureGeoCountry().then(() => {
    closeCountryPicker();
    try { if (typeof renderProducts === 'function' && document.querySelector('.product-card')) renderProducts(); } catch (_) {}
    try { if (typeof renderCart === 'function' && document.querySelector('.cart-modal.open')) renderCart(); } catch (_) {}
  });
}
window.openCountryPicker = openCountryPicker;
window.closeCountryPicker = closeCountryPicker;
window.pickCountry = pickCountry;
window.resetCountryOverride = resetCountryOverride;

function countryFlagsHTML(product, opts = {}) {
  const arr = countryFlagsForProduct(product);
  const compact = !!opts.compact;
  if (arr.length === 0) {
    const txt = currentLang === 'he' ? 'אזל זמנית' : 'Currently unavailable';
    return `<div class="ships-to ships-to-none">⚠️ ${txt}</div>`;
  }
  const customer = detectedCustomerCountry();  // null if geo unknown
  const shipsToCustomer = customer ? arr.includes(customer) : null;  // null = unknown
  // Sort: customer's country first (when known), then alphabetical.
  const sorted = [...arr].sort((a, b) => {
    if (customer) {
      if (a === customer) return -1;
      if (b === customer) return 1;
    }
    return a.localeCompare(b);
  });

  if (compact) {
    // CARD VIEW (2026-05-23 redesign per oren feedback — make country
    // relevance OBVIOUS, not subtle):
    //   - Customer KNOWN + product ships there → green ✅ pill saying so.
    //   - Customer KNOWN + product does NOT ship there → red ❌ pill +
    //     the .product-card carries data-not-shippable="true" which CSS
    //     dims to opacity .55 + grayscale.
    //   - Customer UNKNOWN (geo lookup pending) → fall through to the
    //     compact flag row so the user still sees coverage.
    const titleAll = currentLang === 'he'
      ? `זמין ב-${arr.length} מדינות: ${arr.map(c => (COUNTRY_NAME[c]||{}).he||c).join(', ')}`
      : `Ships to ${arr.length} countries: ${arr.map(c => (COUNTRY_NAME[c]||{}).en||c).join(', ')}`;

    if (customer) {
      const cName = (COUNTRY_NAME[customer]||{})[currentLang] || customer;
      const flag  = COUNTRY_FLAG[customer] || customer;
      if (shipsToCustomer) {
        // Wave A (2026-07-24): ships-to-you is the DEFAULT — repeating a green
        // pill on every card is noise (27 identical pills on the grid). Only
        // the EXCEPTION (can't ship) earns a card-level signal; the modal
        // still shows the full coverage story.
        return '';
      } else {
        const txt = currentLang === 'he' ? `לא זמין ב${cName}` : `Not available in ${cName}`;
        return `<div class="ships-to ships-to-pill ships-no" title="${titleAll}"><span class="pill-flag">${flag}</span><span class="pill-x">✕</span> ${txt}</div>`;
      }
    }

    // Unknown country — show the compact flag row (existing behavior).
    const MAX_VISIBLE = 7;
    const visible = sorted.slice(0, MAX_VISIBLE);
    const rest    = sorted.length - visible.length;
    const otherFlags = visible
      .map(c => `<span class="ship-flag" title="${(COUNTRY_NAME[c]||{})[currentLang]||c}">${COUNTRY_FLAG[c]||c}</span>`)
      .join('');
    const moreBadge = rest > 0
      ? `<span class="ship-flag ship-more">+${rest}</span>`
      : '';
    return `<div class="ships-to ships-to-compact" title="${titleAll}">${otherFlags}${moreBadge}</div>`;
  }
  // MODAL VIEW: prominent customer-country headline (when known) + always-visible
  // flag grid. Per oren 2026-05-22: country is GEOGRAPHIC, not language-derived.
  let customerLine = '';
  if (customer) {
    customerLine = shipsToCustomer
      ? `<div class="ships-to-customer ok"><span class="big-flag">${COUNTRY_FLAG[customer] || customer}</span> ${currentLang === 'he' ? `נשלח ל${(COUNTRY_NAME[customer]||{}).he||customer}` : `Ships to ${(COUNTRY_NAME[customer]||{}).en||customer}`} <span class="ok-check">✓</span></div>`
      : `<div class="ships-to-customer no"><span class="big-flag">${COUNTRY_FLAG[customer] || customer}</span> ${currentLang === 'he' ? `לא נשלח ל${(COUNTRY_NAME[customer]||{}).he||customer}` : `Doesn't ship to ${(COUNTRY_NAME[customer]||{}).en||customer}`} <span class="no-x">✕</span></div>`;
  }
  const otherCount = arr.length - (customer && shipsToCustomer ? 1 : 0);
  const label = customer
    ? (currentLang === 'he'
        ? `<span class="ships-to-label">זמין גם ב-${otherCount} מדינות נוספות</span>`
        : `<span class="ships-to-label">Also ships to ${otherCount} other countries</span>`)
    : (currentLang === 'he'
        ? `<span class="ships-to-label">זמין ב-${arr.length} מדינות</span>`
        : `<span class="ships-to-label">Ships to ${arr.length} countries</span>`);
  const flagsList = sorted
    .filter(c => c !== customer)
    .map(c => `<span class="ship-flag" title="${(COUNTRY_NAME[c]||{})[currentLang]||c}">${COUNTRY_FLAG[c]||c}</span>`)
    .join('');
  const legendHTML = customer
    ? (currentLang === 'he'
        ? `<div class="ships-to-legend-modal"><strong>איך לקרוא:</strong> <span style="color:#2e6d2c">✓ = נשלח אליך</span> · <span style="color:#b94a48">✕ = לא נשלח אליך</span> · שאר הדגלים = מדינות נוספות שאליהן ניתן לשלוח את המוצר. הגדרת הארץ נקבעת על-פי המיקום הגאוגרפי שלך — ניתן לשנות בכפתור הדגל בראש הדף.</div>`
        : `<div class="ships-to-legend-modal"><strong>How to read this:</strong> <span style="color:#2e6d2c">✓ = ships to you</span> · <span style="color:#b94a48">✕ = doesn't ship to you</span> · The other flags = additional countries this product can be shipped to. Your country is auto-detected from your IP. You can change it via the flag button at the top of the page.</div>`)
    : (currentLang === 'he'
        ? `<div class="ships-to-legend-modal"><strong>איך לקרוא:</strong> דגלי הארצות מציגים לאן ניתן לשלוח את המוצר. לחיצה על כפתור הדגל בראש הדף תאפשר לבחור את ארץ המשלוח שלך.</div>`
        : `<div class="ships-to-legend-modal"><strong>How to read this:</strong> the flags show which countries this product can be shipped to. Click the flag button at the top of the page to pick your shipping country.</div>`);
  return `<div class="ships-to ships-to-full">${customerLine}<div class="ships-to-others">${label}<div class="ships-to-flags">${flagsList}</div></div>${legendHTML}</div>`;
}

// Deterministic 40% chance to display the BACK image as the default in the catalog grid,
// for visual variety. Stable per product id (no flicker on re-render). If the back image
// is missing, the <img onerror> strips the class so the card falls back to the front view.
function shouldShowBackDefault(id) {
  const n = ((Number(id) || 0) * 2654435761) >>> 0;
  return (n % 100) < 40;
}

// Deterministic per-product display color so the catalog looks varied instead of an
// all-black/charcoal wall. Picks from the product's own `colors` array (which mirrors
// the images that actually exist on disk), preferring non-Black/Charcoal so the grid
// has real color spread. Falls back to the first color if the product only carries
// Black/Charcoal. Uses a different multiplier from shouldShowBackDefault so the
// back/front flip and the color pick are independent streams.
function pickDisplayColor(product) {
  const all = Array.isArray(product?.colors) ? product.colors : [];
  if (all.length === 0) return null;
  const colorful = all.filter(c => c !== 'Black' && c !== 'Charcoal');
  const pool = colorful.length > 0 ? colorful : all;
  const n = ((Number(product.id) || 0) * 2246822519) >>> 0;
  return pool[n % pool.length];
}

// ── Real-time variant stock (from product_variant_stock, synced daily from Gelato) ──
// Shape: { [productId]: { [color]: { [size]: boolean } } }
// Missing key → optimistic in-stock (matches edge-function default).
window.__DUBIS_STOCK_MAP = window.__DUBIS_STOCK_MAP || null;
// Per-variant override prices: { [pid]: { [color]: { [size]: number } } }
// Populated alongside stock. Drives the modal/cart "this color costs more" UX
// because some Gelato variants (heather colors, premium SKUs, 3XL sizes) carry
// a higher wholesale cost. oren sets these manually in admin → product_variant_stock.sell_price_usd.
window.__DUBIS_PRICE_MAP = window.__DUBIS_PRICE_MAP || null;
(async function loadStockMap() {
  try {
    const url  = window.DUBIS_SUPABASE_URL;
    const anon = window.DUBIS_SUPABASE_ANON;
    if (!url || !anon) return;
    const res = await fetch(`${url}/rest/v1/product_variant_stock?select=product_id_numeric,color,size,in_stock,sell_price_usd`, {
      headers: { 'apikey': anon, 'Authorization': `Bearer ${anon}` }
    });
    if (!res.ok) return;
    const rows = await res.json();
    const stockMap = {};
    const priceMap = {};
    for (const r of rows) {
      const pid = r.product_id_numeric;
      if (!stockMap[pid]) stockMap[pid] = {};
      if (!stockMap[pid][r.color]) stockMap[pid][r.color] = {};
      stockMap[pid][r.color][r.size] = !!r.in_stock;
      if (r.sell_price_usd != null) {
        if (!priceMap[pid]) priceMap[pid] = {};
        if (!priceMap[pid][r.color]) priceMap[pid][r.color] = {};
        priceMap[pid][r.color][r.size] = Number(r.sell_price_usd);
      }
    }
    window.__DUBIS_STOCK_MAP = stockMap;
    window.__DUBIS_PRICE_MAP = priceMap;
    // Re-render catalog cards so the "From X" prefix + premium-color marker
    // appear once the variant prices land (the initial render used base price).
    if (typeof renderProducts === 'function' && document.querySelector('.product-card')) {
      try { renderProducts(); } catch (_) {}
    }
    // Re-render modal if already open so badges appear without a reopen
    const openPid = document.querySelector('#product-modal.open [id^="modal-img-"]')?.id?.replace('modal-img-', '');
    if (openPid && typeof refreshStockUi === 'function') refreshStockUi(Number(openPid));
    if (openPid && typeof refreshModalPrice === 'function') refreshModalPrice(Number(openPid));
  } catch (_) { /* fail-open: site works without stock data */ }
})();

// Returns the effective sell price for a variant. Falls back to product.price
// when no per-variant override is set (the common case — most colors share base).
function getVariantPrice(productId, color, size, basePrice) {
  const map = window.__DUBIS_PRICE_MAP;
  if (!map) return basePrice;
  const p = map[productId]; if (!p) return basePrice;
  const c = p[color];        if (!c) return basePrice;
  const v = c[size];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : basePrice;
}

// Effective sell price for every (color, size) the customer can actually pick.
// Built via getVariantPrice so the base price only counts where a variant truly
// has no override (i.e. it would really be sold at base). This is the guard
// against the bait-and-switch class of bug: when EVERY variant carries an
// explicit override (e.g. all = $35) a stale base price ($26 from a drifting
// product_prices row) must NOT leak into the catalog "From X" — no variant is
// purchasable at that base, so advertising it is a lie. By deriving from the
// same getVariantPrice() the modal/cart use, the card can never advertise a
// price below the cheapest variant a customer can select.
function effectiveVariantPrices(product) {
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const sizes  = Array.isArray(product.sizes)  ? product.sizes  : [];
  if (!colors.length || !sizes.length) return [product.price];
  const out = [];
  for (const c of colors) for (const s of sizes) {
    const v = getVariantPrice(product.id, c, s, product.price);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out.length ? out : [product.price];
}

// Returns the cheapest price the customer can actually select — the honest
// "From X" value for catalog cards.
function getCheapestVariantPrice(product) {
  return Math.min(...effectiveVariantPrices(product));
}

// True when this product has ≥ 2 distinct selectable prices — the catalog card
// should then show "From X" rather than a single flat price.
function hasPriceVariance(product) {
  return new Set(effectiveVariantPrices(product)).size > 1;
}

// "Premium color" = this color's cheapest size still costs more than the
// product's overall cheapest variant. Used to mark swatches that carry a
// color surcharge (Cream/Forest Green on hoodies, Forest Green on p8, etc.)
// before the customer opens the modal.
function isPremiumColor(productId, color) {
  const map = window.__DUBIS_PRICE_MAP?.[productId];
  if (!map || !map[color]) return false;
  const colorPrices = Object.values(map[color]).filter(v => typeof v === 'number');
  if (!colorPrices.length) return false;
  const colorMin = Math.min(...colorPrices);
  let overallMin = Infinity;
  for (const c of Object.keys(map)) for (const s of Object.keys(map[c])) {
    const v = map[c][s];
    if (typeof v === 'number' && v < overallMin) overallMin = v;
  }
  return Number.isFinite(overallMin) && colorMin > overallMin;
}

function isVariantInStock(productId, color, size) {
  const map = window.__DUBIS_STOCK_MAP;
  if (!map) return true;                                // data not loaded → optimistic
  const p = map[productId]; if (!p) return true;
  const c = p[color];        if (!c) return true;
  const v = c[size];
  return v === undefined ? true : v;                    // row missing → optimistic
}

function isColorAnyInStock(productId, color, sizes) {
  const map = window.__DUBIS_STOCK_MAP;
  if (!map) return true;
  const p = map[productId]; if (!p) return true;
  const c = p[color];        if (!c) return true;
  return (sizes || []).some(s => c[s] !== false);       // any non-explicitly-OOS = available
}

// ── Currency by language ──
// 2026-06-13: fallback lowered 3.63 → 2.9 and demoted to a genuine LAST RESORT.
// Root cause we fixed alongside this: open.er-api.com was NOT in the CSP
// connect-src, so the browser silently blocked the live fetch and EVERY
// customer saw the stale 3.63 fallback (same failure mode as the Clarity CSP
// block, 2026-06-07). With the host now whitelisted the live published rate
// loads on page load AND is re-fetched when checkout opens, so the ₪ shown is
// a representative rate for the time of purchase — not a baked-in constant.
let USD_TO_ILS = 2.9; // fallback ONLY — live rate from open.er-api.com overrides it
window.USD_TO_ILS = USD_TO_ILS;
async function fetchUsdToIlsRate() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if (r.ok) {
      const d = await r.json();
      if (d.rates && d.rates.ILS) {
        USD_TO_ILS = d.rates.ILS;
        window.USD_TO_ILS = USD_TO_ILS;
        // re-render anything already priced on screen with the fresh rate
        if (document.querySelector('.product-card')) renderProducts();
        if (document.querySelector('#paypal-modal.open') && typeof renderOrderSummary === 'function') {
          try { renderOrderSummary(); } catch (e) { /* modal not ready */ }
        }
      }
    }
  } catch(e) { /* keep fallback */ }
  return USD_TO_ILS;
}
window.fetchUsdToIlsRate = fetchUsdToIlsRate;
fetchUsdToIlsRate(); // initial fetch on load

// ── ILS charge conversion — SINGLE SOURCE OF TRUTH ──────────────────────
// 2026-06-13: Hebrew shoppers now have the PayPal transaction itself charged
// in ILS (not USD). That's the only way the ₪ we DISPLAY can equal EXACTLY
// what PayPal charges — when we charge in USD, the ILS conversion is done by
// PayPal-at-confirmation OR the buyer's card issuer (+ FX fee), neither of
// which we can read in advance, so any ₪ figure would be a guess.
// Product prices use the live REPRESENTATIVE (שער יציג) rate with no markup;
// PayPal's ~3% FX spread (on converting our received ILS back to the USD we pay
// Gelato in) is added as ONE transparent fee line at checkout, not hidden in
// the unit price. Everything is whole shekels so every surface (product cards,
// cart, checkout summary, PayPal breakdown, email) shows the identical figure
// and reconciles to the agora in the PayPal order. EVERY ₪ in the app must go
// through usdToIlsCharge() so display === charge.
// usdToIlsCharge: the REPRESENTATIVE (שער יציג) market rate, NO markup — the
// honest ₪ shown on every product card / cart line. 2026-06-13 (oren): show
// the real rate, then surface PayPal's FX cost as a SEPARATE, visible fee line
// at checkout — never a hidden markup baked into the unit price.
function usdToIlsCharge(usdPrice) {
  return Math.round((Number(usdPrice) || 0) * USD_TO_ILS);
}
// ~3% PayPal currency-conversion fee. We charge the buyer in ILS, but PayPal
// converts the ILS we receive back into the USD we pay Gelato in and takes a
// ~3% FX spread on the way. We pass it through as one transparent checkout line
// (PayPal `breakdown.handling`) so the product price stays at the שער יציג and
// the customer can see exactly what the surcharge is and why.
const ILS_PAYPAL_FEE_PCT = 0.03;
// Builds the whole-shekel ILS breakdown used IDENTICALLY by the checkout
// summary, the PayPal order and the email, so display === charge to the agora.
// Per-line amounts are rounded first, then summed; the fee is 3% of the net
// (items + shipping − discount). PayPal validates
// item_total + shipping + handling − discount === amount.value.
function buildIlsBreakdown(cartArr, shippingUsd, discountUsd) {
  const lineItems = (cartArr || []).map(i => usdToIlsCharge(i.price));
  const itemTotal = lineItems.reduce((s, v) => s + v, 0);
  const shipping  = usdToIlsCharge(shippingUsd);
  const discount  = usdToIlsCharge(discountUsd);
  const net       = Math.max(0, itemTotal + shipping - discount);
  const fee       = Math.round(net * ILS_PAYPAL_FEE_PCT);
  const total     = net + fee;
  return { lineItems, itemTotal, shipping, discount, fee, total };
}
window.usdToIlsCharge   = usdToIlsCharge;
window.buildIlsBreakdown = buildIlsBreakdown;

function formatPrice(usdPrice) {
  // 2026-05-02 (revised): Hebrew → ₪ everywhere, English → $ everywhere.
  // 2026-06-13: Hebrew prices route through usdToIlsCharge so the browse
  // price equals what PayPal actually charges in ILS at checkout (no 3% jump
  // between the product card and the payment screen).
  if (currentLang === 'he') {
    return '₪' + usdToIlsCharge(usdPrice);
  }
  return '$' + usdPrice;
}
function freeShippingThreshold() {
  return currentLang === 'he' ? '₪' + usdToIlsCharge(60) : '$60';
}
// Helpers used by cart total + shipping rows so the whole cart stays in one currency.
function formatPriceFloat(usdPrice) {
  if (currentLang === 'he') return '₪' + usdToIlsCharge(usdPrice);
  return '$' + Number(usdPrice).toFixed(2);
}
// Used inside hard-coded text to swap any "$N" or "$N.NN" into "₪M" when Hebrew.
function localizeDollarsInText(text) {
  if (currentLang !== 'he' || !text) return text;
  return String(text).replace(/\$(\d+(?:\.\d+)?)/g, (_, n) => '₪' + usdToIlsCharge(Number(n)));
}

// ===== COMPREHENSIVE TRANSLATIONS =====
const translations = {
  en: {
    nav_home: 'Home', nav_shop: 'Shop', nav_people: 'Real People',
    nav_about: 'About', nav_contact: 'Contact',
    hero_tagline: 'Fashion that doesn\'t ask you to suck it in.',
    hero_subtitle: 'Built for the body you actually live in.',
    hero_desc: 'Real clothes, real fit, real people. No fake sizes. No apologies. Printed fresh in the USA the moment you order.',
    hero_btn: 'Shop the Drop · from $14',
    people_title: 'The DUBIS Crew 🐻',
    people_sub: 'Real bodies. Real fit. No explanations needed.',
    shop_title: 'The Collection', shop_sub: 'Wear what you mean. Mean what you wear.',
    filter_all: 'All', filter_tshirt: 'T-Shirts', filter_hoodie: 'Hoodies', filter_cap: 'Caps',
    filter_longsleeve: 'Long-Sleeves',
    gender_all: 'All', gender_men: 'Men', gender_women: 'Women',
    add_btn: '+ Add', view_details: 'View Details',
    type_tshirt: 'T-Shirt', type_hoodie: 'Hoodie', type_cap: 'Cap',
    type_ziphoodie: 'Zip Hoodie', type_longsleeve: 'Long-Sleeve',
    type_vneck: 'V-Neck', type_tanktop: 'Tank Top',
    type_mug: 'Mug', type_bottle: 'Water Bottle', type_tote: 'Tote Bag',
    quality_title: 'What You See Is What You Get 🐾',
    quality_sub: 'You know the worry. You order online and what shows up looks nothing like the photo. Here\'s our promise:',
    q1_title: 'Made Fresh For You', q2_title: 'Fabrics that live with you, not judge you.', q3_title: 'Quality Control', q4_title: 'Defective? Wrong Item? We Fix It.',
    q1_text: 'Every piece is made for you the moment you order. Not sitting in a warehouse. Not printed in bulk. Made fresh in the USA, because you deserve something made for you, not someone else.',
    q2_text: '100% breathable cotton and fits that actually fit. No itchy seams, no changing yourself to match the shirt. Put it on and get on with your day.',
    q3_text: 'Every item is checked before it reaches you. Print not sharp enough? Wrong color? We reprint it. You waited for it, so it better be worth the wait.',
    q4_text: 'Got a defect? Wrong item? Email us within 30 days of delivery with a photo and order number, and we\'ll replace or refund it. No hassle.',
    about_title: 'How DUBIS started',
    about_p1: 'A year ago my wife and I wandered into a clothing store. Just browsing. Every wall was young, chiseled models, and I turned to her: where\'s the brand for regular guys? Forty-plus, a little belly, a little less hair, nothing left to prove. Someone should build that brand, I said. Call it DUBIS. We laughed and walked out. The idea stuck around.',
    about_p2: 'Six months later I got tired of waiting for fashion to notice real bodies, so I started building the brand myself. Here\'s the thing: I\'m one guy with a day job. I couldn\'t afford a company, so I built a small team of AI agents to help me run one.',
    about_p3: 'I built the site, the catalog, the line to a print shop that ships straight to your door. Then I put the agents to work. One writes, one designs, one keeps orders moving. I make the calls.',
    about_tag: 'I know how it sounds. But this is a real business, with real products landing at real doors, run by one stubborn human and some very hardworking software. Still growing. Still getting better.',
    contact_title: 'Get in Touch', contact_sub: 'Questions? Ideas? Just want to say hi?',
    cart_title: 'Your Cart 🐾', cart_empty: 'Nothing here yet. The right things are one click away. 🐾',
    cart_total: 'Total', cart_checkout: 'CHECKOUT',
    modal_color: 'Color', modal_size: 'Size',
    modal_made: '🏭 Made fresh for you, the moment you order.',
    modal_material: '👕 Moves with you, not against you.',
    modal_returns: '↩️ Defective? Wrong item? We fix it, no hassle.',
    modal_add: 'This Is Mine 🐾',
    tab_details: 'Details', tab_size: 'Size Guide', tab_care: 'Care',
    shipping_note: '✈️ + shipping · free on $60+',
    modal_ships: '🚚 Printed in the USA · 5-7 business days to your door', modal_free_ship: 'Free shipping over $60',
    modal_dtg: 'DTG · Direct-to-Garment',
    modal_fabric: 'Fabric', modal_fit: 'Fit', modal_print: 'Print', modal_print_areas: 'Print areas',
    size_size: 'Size', size_chest: 'Chest (cm)', size_length: 'Length (cm)',
    size_vary: '*Measurements may vary ±2cm', size_cap_note: 'Adjustable strap, fits most',
    cookie_text: '🐾 We use cookies to keep the site working. Just the basics, nothing more.',
    cookie_accept: 'Accept', cookie_decline: 'Decline', cookie_privacy: 'Privacy Policy',
    footer_privacy: 'Privacy Policy', footer_terms: 'Terms', footer_returns: 'Returns', footer_contact: 'Contact', footer_shop: 'Shop',
    footer_rights: '© 2026 DUBIS. All rights reserved. Built for you.',
    lang_btn: 'עב',
    faq_title: 'Frequently Asked Questions',
    faq_subtitle: 'Everything you wanted to know, without having to search',
    faq_q1: 'What sizes do you offer?',
    faq_a1: 'Our products come in sizes S through 3XL. Everything runs comfortable and roomy. If you\'re between sizes, size down. There\'s a detailed size chart on every product page.',
    faq_q2: 'How long does shipping take?',
    faq_a2: 'Printed in the USA. At your door in 5-7 business days. Shipping is $8.99, free on orders over $60. Outside the US: up to 14 business days.',
    faq_q3: 'What is your return policy?',
    faq_a3: 'Wrong size? We\'ll exchange it. Email us within 30 days and we\'ll sort it out. Full refund for defective, wrong, or lost items. Just send a photo and your order number within 30 days.',
    faq_q4: 'Will the print peel off?',
    faq_a4: 'We use DTG (Direct-to-Garment) printing. The ink goes right into the fabric. It\'s not a sticker or an iron-on, and it survives dozens of washes.',
    faq_q5: 'Why is it priced this way?',
    faq_a5: 'Every item is printed to order, not mass-produced by the thousands. Quality DTG printing, premium materials, original designs. $16 to $47 for something you\'ll wear for years.',
    faq_q6: 'Do you have a physical store?',
    faq_a6: 'No. DUBIS is an online-only brand. That\'s how we keep prices fair.',
    faq_q7: 'How do I wash it?',
    faq_a7: 'Machine wash cold, turn it inside out, and skip the dryer. The print will be fine.',
    // Banner / trust bar (top of page)
    banner_free_ship: 'Free US shipping over $60',
    banner_returns: '30-day easy returns',
    banner_made_to_order: 'Printed fresh, made to order',
    banner_real: 'Real bodies. Real fit. Real reviews.',
    // Footer trust strip
    footer_trust_ssl: 'SSL secured checkout',
    footer_trust_pay: 'PayPal · Visa · Mastercard · Amex',
    footer_trust_data: 'Your data is never sold or shared',
    footer_tagline: 'Built for the body you actually live in.',
    // Account button + menu
    account_signin: 'Sign In',
    account_orders: 'My Orders',
    account_signout: 'Sign Out',
    account_admin: '⚙️ Admin Panel',
    // Cart modal extras
    cart_title_html: 'Your Cart',
    cart_empty_html: 'Nothing here yet. The right things are one click away.',
    cart_shipping_note_intl: '🚚 US orders: 5–7 business days · Int\'l: up to 14 days',
    cart_customs_note: 'Customs/import fees may apply outside the US',
    cart_tax_note: 'Sales tax not included where applicable. We comply with US economic nexus thresholds.',
    // PayPal modal
    paypal_modal_title: 'Complete Your Order',
    paypal_contact_title: 'Your details',
    paypal_shipping_title: 'Shipping address',
    paypal_ph_name: 'Full name',
    paypal_ph_email: 'Email',
    paypal_ph_phone: 'Phone',
    paypal_ph_addr1: 'Street address',
    paypal_ph_addr2: 'Apartment, suite, unit (optional)',
    paypal_ph_city: 'City',
    paypal_ph_state: 'State (e.g. CA)',
    paypal_ph_state_intl: 'State / Province',
    paypal_ph_zip: 'ZIP',
    paypal_continue: 'Continue to Payment →',
    paypal_pay_with: 'Pay with PayPal',
    paypal_secured: '🔒 Secured by PayPal · 30-day easy returns',
    paypal_shipping_summary: '🚚 US orders: 5–7 business days · Int\'l: up to 14 days · Import fees may apply outside US',
    paypal_tax_summary: 'Sales tax not included where applicable. We comply with US economic nexus thresholds.',
    paypal_trust_ssl: '🔒 SSL Secured',
    paypal_trust_pp: '✓ PayPal Protected',
    paypal_trust_returns: '↩ 30-Day Returns',
    coupon_placeholder: 'Coupon code',
    coupon_apply: 'Apply',
    // Success modal
    success_title: 'Order Confirmed!',
    success_text1: 'Good call. 🐾',
    success_text2: 'Your order is on its way. Real quality, made fresh for you.',
    success_sub: 'You belong here. 🐻',
    success_cta: 'Keep Exploring',
    // Auth modal
    auth_welcome: 'Welcome to DUBIS',
    auth_sub: 'Save your address for faster checkout.',
    auth_tab_login: 'Sign In',
    auth_tab_register: 'Create Account',
    auth_google: 'Continue with Google',
    auth_or_email: 'or continue with email',
    auth_email_ph: 'Email',
    auth_password_ph: 'Password',
    auth_login_btn: 'Sign In',
    auth_register_btn: 'Create Account',
    auth_switch_to_register: 'New here? Create an account →',
    auth_switch_to_login: 'Already have an account? Sign in →',
    auth_name_ph: 'Full Name *',
    auth_email_req_ph: 'Email *',
    auth_password_req_ph: 'Password (min 8 chars) *',
    auth_phone_ph: 'Phone (optional)',
    auth_note: '🔒 Your info is used only to fulfill your order. We never sell your data.',
    // Orders modal
    orders_title: 'My Orders',
    orders_loading: 'Loading…',
    // FB coupon banner
    fb_coupon_text: 'Welcome! Friend coupon: <strong class="fb-coupon-code">DUBIS15</strong> for 15% off your order',
    fb_coupon_dismiss_aria: 'Dismiss welcome offer',
    // Real People eyebrow
    real_people_eyebrow: 'Made for bodies like these — not for runway models',
    quality_eyebrow: 'Our promise to you',
    // Privacy section
    privacy_title: 'Privacy Policy',
  },
  he: {
    nav_home: 'ראשי', nav_shop: 'חנות', nav_people: 'החבר\'ה שלנו',
    nav_about: 'אודות', nav_contact: 'צור קשר',
    hero_tagline: 'אופנה שלא מבקשת ממך להכניס את הבטן.',
    hero_subtitle: 'מעוצב לגוף שאת/ה באמת חי/ה בו.',
    hero_desc: 'בגדים אמיתיים, גזרה אמיתית, אנשים אמיתיים. בלי התנצלויות. בלי מידות מזויפות. מודפס לפי הזמנה — כי מגיע לך משהו שנעשה עבורך.',
    hero_btn: 'לחנות — החל מ-₪51',
    people_title: 'החבר\'ה של DUBIS 🐻',
    people_sub: 'אנשים כמוך. בלי פוזות. בלי תירוצים.',
    shop_title: 'הקולקציה', shop_sub: 'תלבש מה שאתה מרגיש. לא מה שמצפים ממך.',
    filter_all: 'הכל', filter_tshirt: 'חולצות', filter_hoodie: 'קפוצונים', filter_cap: 'כובעים',
    filter_longsleeve: 'ארוכות שרוול',
    gender_all: 'הכל', gender_men: 'גברים', gender_women: 'נשים',
    add_btn: '+ הוסף', view_details: 'פרטים',
    type_tshirt: 'חולצה', type_hoodie: 'קפוצון', type_cap: 'כובע',
    type_ziphoodie: 'קפוצון רוכסן', type_longsleeve: 'ארוכת שרוול',
    type_vneck: 'חולצת V', type_tanktop: 'גופייה',
    type_mug: 'ספל', type_bottle: 'בקבוק מים', type_tote: 'תיק בד',
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
    shipping_note: '✈️ + משלוח · חינם מעל ₪220',
    modal_ships: '🚚 משלוח תוך 5–9 ימי עסקים', modal_free_ship: 'משלוח חינם מעל ₪220',
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
    faq_a2: 'מחיר המשלוח מחושב בקופה לפי כתובת היעד (חינם בהזמנה מעל ₪220). זמן הכנה: 3–5 ימי עסקים (מודפס לפי הזמנה). משלוח: 5–12 ימי עסקים לפי היעד.',
    faq_q3: 'מה מדיניות ההחזרות?',
    faq_a3: 'החזרות רק במקרה של פגם, מוצר שגוי, או אבדן במשלוח. שלחו מייל ל-dubis.brand@gmail.com תוך 30 יום מהמסירה עם תמונה ומספר הזמנה.',
    faq_q4: 'ההדפסה מחזיקה?',
    faq_a4: 'אנחנו עובדים עם DTG — הדפסה ישירה על הבד, לא מדבקה. ההדפסה שורדת עשרות כביסות בלי בעיה.',
    faq_q5: 'למה המחיר כזה?',
    faq_a5: 'כל פריט מיוצר בנפרד לפי הזמנה — לא קו ייצור של אלפים. DTG איכותי, בד טוב, עיצוב מקורי. ₪60–₪175 למוצר שלובשים שנים.',
    faq_q6: 'יש חנות פיזית?',
    faq_a6: 'לא. DUBIS הוא אונליין בלבד. ככה שומרים על מחירים הוגנים.',
    faq_q7: 'איך מכבסים?',
    faq_a7: 'כביסה רגילה 30°C, הפוך לפני כביסה, לא לטמבור. ההדפסה תשרוד.',
    // Banner / trust bar
    banner_free_ship: 'משלוח חינם בארה״ב מעל ₪220',
    banner_returns: 'החזרות 30 יום ללא דרמה',
    banner_made_to_order: 'מודפס לפי הזמנה',
    banner_real: 'גופים אמיתיים. גזרה אמיתית. ביקורות אמיתיות.',
    // Footer trust strip
    footer_trust_ssl: 'תשלום מאובטח SSL',
    footer_trust_pay: 'PayPal · Visa · Mastercard · Amex',
    footer_trust_data: 'המידע שלך לעולם לא נמכר או משותף',
    footer_tagline: 'מעוצב לגוף שאת/ה באמת חי/ה בו.',
    // Account button + menu
    account_signin: 'התחבר/י',
    account_orders: 'ההזמנות שלי',
    account_signout: 'התנתק/י',
    account_admin: '⚙️ ניהול אתר',
    // Cart modal extras
    cart_title_html: 'העגלה שלך',
    cart_empty_html: 'עוד ריק. הדברים הנכונים במרחק קליק.',
    cart_shipping_note_intl: '🚚 הזמנות ארה״ב: 5–7 ימי עסקים · בינ״ל: עד 14 יום',
    cart_customs_note: 'מסי מכס/יבוא עשויים לחול מחוץ לארה״ב',
    cart_tax_note: 'מע״מ ומסים מקומיים אינם כלולים. הסכום הסופי בשקלים מוצג בקופה — כולל הכל, בלי הפתעות.',
    // PayPal modal
    paypal_modal_title: 'השלמת ההזמנה',
    paypal_contact_title: 'פרטים ליצירת קשר',
    paypal_shipping_title: 'כתובת משלוח',
    paypal_ph_name: 'שם מלא',
    paypal_ph_email: 'אימייל',
    paypal_ph_phone: 'טלפון',
    paypal_ph_addr1: 'כתובת רחוב',
    paypal_ph_addr2: 'דירה / קומה (לא חובה)',
    paypal_ph_city: 'עיר',
    paypal_ph_state: 'מדינה (לארה״ב: 2 אותיות)',
    paypal_ph_state_intl: 'מחוז / מדינה',
    paypal_ph_zip: 'מיקוד',
    paypal_continue: 'המשך לתשלום ←',
    paypal_pay_with: 'תשלום ב-PayPal',
    paypal_secured: '🔒 מאובטח ע״י PayPal · החזרות 30 יום',
    paypal_shipping_summary: '🚚 משלוח לישראל: 10–14 ימי עסקים · ארה״ב: 5–7 · מסי יבוא עשויים לחול',
    paypal_tax_summary: 'מע״מ ומסים מקומיים אינם כלולים.',
    paypal_trust_ssl: '🔒 מאובטח SSL',
    paypal_trust_pp: '✓ מוגן ע״י PayPal',
    paypal_trust_returns: '↩ החזרות 30 יום',
    coupon_placeholder: 'קוד קופון',
    coupon_apply: 'החל/י',
    // Success modal
    success_title: 'ההזמנה אושרה!',
    success_text1: 'בחירה מצוינת. 🐾',
    success_text2: 'ההזמנה שלך בדרך — איכות אמיתית, נתפר במיוחד עבורך.',
    success_sub: 'אתה שייך לכאן. 🐻',
    success_cta: 'לחנות',
    // Auth modal
    auth_welcome: 'ברוכים הבאים ל-DUBIS',
    auth_sub: 'שמור/י את הכתובת לתשלום מהיר בפעמים הבאות.',
    auth_tab_login: 'התחברות',
    auth_tab_register: 'יצירת חשבון',
    auth_google: 'המשך/י עם Google',
    auth_or_email: 'או המשך/י עם אימייל',
    auth_email_ph: 'אימייל',
    auth_password_ph: 'סיסמה',
    auth_login_btn: 'התחבר/י',
    auth_register_btn: 'יצירת חשבון',
    auth_switch_to_register: 'חדש/ה כאן? צור/י חשבון ←',
    auth_switch_to_login: 'כבר יש חשבון? התחבר/י ←',
    auth_name_ph: 'שם מלא *',
    auth_email_req_ph: 'אימייל *',
    auth_password_req_ph: 'סיסמה (לפחות 8 תווים) *',
    auth_phone_ph: 'טלפון (לא חובה)',
    auth_note: '🔒 הפרטים שלך משמשים רק להשלמת ההזמנה. לעולם לא נמכור את המידע שלך.',
    // Orders modal
    orders_title: 'ההזמנות שלי',
    orders_loading: 'טוען…',
    // FB coupon banner
    fb_coupon_text: 'ברוך הבא! קוד קופון לחברים: <strong class="fb-coupon-code">DUBIS15</strong> — 15% הנחה על כל הרכישה',
    fb_coupon_dismiss_aria: 'סגירת ההצעה',
    // Real People eyebrow
    real_people_eyebrow: 'נעשה בשביל גופים כאלה — לא בשביל דוגמני מסלול',
    quality_eyebrow: 'ההבטחה שלנו',
    // Privacy section
    privacy_title: 'מדיניות פרטיות',
  }
};

// ===== LANGUAGE DETECTION =====
// IL Re-entry (2026-05-15): US + Israeli market. Default EN for non-IL,
// HE for IL visitors. Geo detected once per session via ipapi.co, cached
// in sessionStorage. Returning users keep whatever they manually chose via
// the lang-toggle ("עב") — that pick is persisted to localStorage; the
// auto-detected default is NOT persisted, so a traveler isn't locked in.
async function detectLanguage() {
  const saved = localStorage.getItem('dubis-lang');
  // 2026-05-22: ALWAYS kick off geo detection in parallel — language preference
  // and shipping country are two independent concerns. A Hebrew speaker in NY
  // shouldn't have their cart badged as "ships to IL" just because they prefer
  // the Hebrew UI. ensureGeoCountry() writes sessionStorage.dubis-country.
  const geoPromise = ensureGeoCountry();

  if (saved) {
    setLanguage(saved, false);
    await geoPromise;  // make sure country flag has the right answer
    return;
  }

  // First-time visitor: use geo to pick initial language (IL→HE, everyone else→EN).
  const country = await geoPromise;
  setLanguage(country === 'IL' ? 'he' : 'en', false);
}

function setLanguage(lang, persist = true) {
  currentLang = lang;
  // 2026-05-21: mirror to window so other scripts (paypal.js, cart drawer)
  // can localize their own UI. main.js `let currentLang` isn't on window.
  window.currentLang = lang;
  if (persist) localStorage.setItem('dubis-lang', lang);
  translateUI(lang);
}

function toggleLang() {
  setLanguage(currentLang === 'en' ? 'he' : 'en', true);
}

// ===== TRANSLATE ALL UI ELEMENTS =====
function translateUI(lang) {
  const t = translations[lang];
  const q = sel => document.querySelector(sel);
  const qa = sel => document.querySelectorAll(sel);

  document.body.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  // Brand mark must always read DUBIS™ left-to-right, regardless of page direction.
  document.querySelectorAll('.logo-text, .footer-logo, .about-mark').forEach(el => { el.setAttribute('dir', 'ltr'); });

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
  // Currency-aware hero CTA. The "from $X" anchor must reflect the actual
  // cheapest product in the catalog so the button doesn't lie when prices
  // change. Falls back to $14 only if products[] isn't loaded yet.
  if (heroBtn) {
    const cheapestUsd = Array.isArray(products) && products.length
      ? Math.min(...products.map(p => p.price).filter(n => Number.isFinite(n) && n > 0))
      : 14;
    heroBtn.textContent = lang === 'he'
      ? 'לחנות — החל מ-' + formatPrice(cheapestUsd)
      : 'Shop the Drop · from ' + formatPrice(cheapestUsd);
  }

  // Trust bar (top of page) — "Free shipping over $60" / "משלוח חינם מעל ₪X"
  // ("US" removed per oren 2026-05-16; site ships worldwide). HE threshold
  // is computed from USD_TO_ILS so it stays in sync with the daily rate.
  const trustEls = qa('.trust-text');
  trustEls.forEach(el => {
    const en = el.getAttribute('data-en');
    if (!en) return;
    if (lang === 'he') {
      if (/over \$60/i.test(en)) el.textContent = 'משלוח חינם מעל ' + freeShippingThreshold();
      else if (el.getAttribute('data-he')) el.textContent = el.getAttribute('data-he');
    } else {
      el.textContent = en;
    }
  });

  // Urgency bar
  const urgText = document.getElementById('urgency-text');
  if (urgText) urgText.textContent = lang === 'he' ? 'מהדורה מוגבלת — כשנגמר, נגמר' : 'Limited Drop. Once they\'re gone, they\'re gone.';

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

  // ── Universal: process [data-en][data-he] elements (banner / hero / FAQ / footer) ──
  // For these, the live currency-bearing text ("$60", "$8.99") is rewritten to ₪ via
  // localizeDollarsInText() when language is Hebrew. The Hebrew variant text on disk
  // already uses ₪ where appropriate.
  qa('[data-en][data-he]').forEach(el => {
    const raw = el.getAttribute(lang === 'he' ? 'data-he' : 'data-en');
    if (!raw) return;
    // Banner / nav / footer text doesn't contain HTML — safe to set textContent.
    // FAQ answers may contain commas/em-dashes; still plain text.
    el.textContent = localizeDollarsInText(raw);
  });
  // Placeholders that opt-in to translation
  qa('[data-placeholder-en][data-placeholder-he]').forEach(el => {
    const raw = el.getAttribute(lang === 'he' ? 'data-placeholder-he' : 'data-placeholder-en');
    if (raw) el.setAttribute('placeholder', raw);
  });

  // ── Account button + dropdown menu ──
  // 2026-05-22 (oren screenshot): translateUI was always resetting the
  // button to "Sign In" even when the user is logged in — overwriting the
  // user's name that _updateAuthUI() had just set in auth.js. Only reset
  // the text when the user is NOT logged in. After translation, re-run
  // _updateAuthUI() to repaint the user's name in the correct language.
  const accountBtnSpan = q('#account-btn span');
  const _hasUser = typeof window._currentUser !== 'undefined' && window._currentUser;
  if (accountBtnSpan && !_hasUser) accountBtnSpan.textContent = t.account_signin;
  try { if (typeof _updateAuthUI === 'function') _updateAuthUI(); } catch(_) {}
  const accAdmin = q('#admin-menu-link');
  if (accAdmin) accAdmin.textContent = t.account_admin;
  const accMenuLinks = qa('#account-menu a');
  // First link is admin-menu-link (already handled above), then orders, then signout
  accMenuLinks.forEach(a => {
    if (a.id === 'admin-menu-link') return;
    const onclick = a.getAttribute('onclick') || '';
    if (onclick.includes('openMyOrders')) a.textContent = t.account_orders;
    else if (onclick.includes('authLogout')) a.textContent = t.account_signout;
  });

  // ── Cart modal — translate header + shipping note + tax note + checkout button ──
  const cartH3 = q('.cart-modal .cart-header h3');
  if (cartH3) cartH3.textContent = t.cart_title_html;
  const cartShipNote = q('.cart-shipping-note');
  if (cartShipNote) {
    // HE reader = the IL market: lead with Israel's real estimate + the human
    // escape hatch (exchange promise + WhatsApp), not a generic "Int'l" line.
    cartShipNote.innerHTML =
      '🚚 ' + (lang === 'he'
        ? 'משלוח לישראל: 10–14 ימי עסקים · ארה״ב: 5–7'
        : 'US orders: 5–7 business days · Int\'l: up to 14 days') +
      (lang === 'he'
        ? '<br><span style="color:#1f7a43;font-weight:600">📏 לא קלעתם במידה? מחליפים בקלות — <a href="https://wa.me/972523662526" target="_blank" rel="noopener" style="color:#1f7a43">וואטסאפ 052-366-2526</a></span>'
        : '<br><span style="color:#1f7a43;font-weight:600">📏 Wrong size? Easy exchange. <a href="mailto:dubis.brand@gmail.com" style="color:#1f7a43">Email us</a></span>') +
      '<br><span>' + t.cart_customs_note + '</span>' +
      '<br><span style="font-size:11px;color:#888">' + t.cart_tax_note + '</span>';
  }
  const cartCheckoutBtn = q('.cart-footer .btn-primary');
  if (cartCheckoutBtn) cartCheckoutBtn.textContent = t.cart_checkout;

  // ── PayPal checkout modal ──
  const ppHeader = q('#paypal-modal .paypal-modal-header h2');
  if (ppHeader) ppHeader.textContent = t.paypal_modal_title;
  const ppContactTitles = qa('#contact-step .contact-step-title');
  if (ppContactTitles[0]) ppContactTitles[0].textContent = t.paypal_contact_title;
  if (ppContactTitles[1]) ppContactTitles[1].textContent = t.paypal_shipping_title;
  // Inputs / select inside contact-step
  const ppPh = {
    'checkout-name':  t.paypal_ph_name,
    'checkout-email': t.paypal_ph_email,
    'checkout-phone': t.paypal_ph_phone,
    'checkout-addr1': t.paypal_ph_addr1,
    'checkout-addr2': t.paypal_ph_addr2,
    'checkout-city':  t.paypal_ph_city,
    'checkout-state': t.paypal_ph_state,
    'checkout-zip':   t.paypal_ph_zip,
  };
  Object.keys(ppPh).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('placeholder', ppPh[id]);
  });
  const ppContinue = q('#btn-continue-to-payment');
  if (ppContinue) ppContinue.textContent = t.paypal_continue;
  const ppDivider = q('#payment-step .paypal-divider span');
  if (ppDivider) ppDivider.textContent = t.paypal_pay_with;
  const ppNotes = qa('#paypal-modal .paypal-note');
  if (ppNotes[0]) ppNotes[0].textContent = t.paypal_secured;
  if (ppNotes[1]) ppNotes[1].textContent = t.paypal_shipping_summary;
  if (ppNotes[2]) ppNotes[2].textContent = t.paypal_tax_summary;
  const ppTrust = qa('#paypal-modal .trust-badge');
  if (ppTrust[0]) ppTrust[0].textContent = t.paypal_trust_ssl;
  if (ppTrust[1]) ppTrust[1].textContent = t.paypal_trust_pp;
  if (ppTrust[2]) ppTrust[2].textContent = t.paypal_trust_returns;
  const couponInput = q('#coupon-input');
  if (couponInput) couponInput.setAttribute('placeholder', t.coupon_placeholder);
  const couponBtn = q('.coupon-apply-btn');
  if (couponBtn) couponBtn.textContent = t.coupon_apply;

  // ── Success modal ──
  const successH2 = q('#success-modal h2');
  if (successH2) successH2.textContent = t.success_title;
  const successPs = qa('#success-modal .success-content > p');
  if (successPs[0]) successPs[0].innerHTML = t.success_text1 + '<br>' + t.success_text2;
  if (successPs[1]) successPs[1].textContent = t.success_sub;
  const successBtn = q('#success-modal .btn-primary');
  if (successBtn) successBtn.textContent = t.success_cta;

  // ── Auth modal ──
  const authH2 = q('#auth-modal .auth-modal-header h2');
  if (authH2) authH2.textContent = t.auth_welcome;
  const authSub = q('#auth-modal .auth-sub');
  if (authSub) authSub.textContent = t.auth_sub;
  const tabLogin = q('#tab-login');
  if (tabLogin) tabLogin.textContent = t.auth_tab_login;
  const tabReg = q('#tab-register');
  if (tabReg) tabReg.textContent = t.auth_tab_register;
  qa('#auth-modal .btn-google').forEach(b => {
    // Keep the SVG, replace trailing text node
    const lastNode = [...b.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (lastNode) lastNode.textContent = ' ' + t.auth_google;
  });
  qa('#auth-modal .social-login-divider span').forEach(s => { s.textContent = t.auth_or_email; });
  const loginEmail = q('#login-email');
  if (loginEmail) loginEmail.setAttribute('placeholder', t.auth_email_ph);
  const loginPass = q('#login-password');
  if (loginPass) loginPass.setAttribute('placeholder', t.auth_password_ph);
  const btnLogin = q('#btn-login');
  if (btnLogin) btnLogin.textContent = t.auth_login_btn;
  const regName = q('#reg-name');
  if (regName) regName.setAttribute('placeholder', t.auth_name_ph);
  const regEmail = q('#reg-email');
  if (regEmail) regEmail.setAttribute('placeholder', t.auth_email_req_ph);
  const regPass = q('#reg-password');
  if (regPass) regPass.setAttribute('placeholder', t.auth_password_req_ph);
  const regPhone = q('#reg-phone');
  if (regPhone) regPhone.setAttribute('placeholder', t.auth_phone_ph);
  const btnReg = q('#btn-register');
  if (btnReg) btnReg.textContent = t.auth_register_btn;
  // Switch links between login/register
  const switchEls = qa('#auth-modal .auth-switch');
  switchEls.forEach(sw => {
    const a = sw.querySelector('a');
    if (!a) return;
    const oc = a.getAttribute('onclick') || '';
    if (oc.includes("'register'")) {
      sw.firstChild && (sw.firstChild.textContent = (lang === 'he' ? 'חדש/ה כאן? ' : 'New here? '));
      a.textContent = lang === 'he' ? 'צור/י חשבון ←' : 'Create an account →';
    } else if (oc.includes("'login'")) {
      sw.firstChild && (sw.firstChild.textContent = (lang === 'he' ? 'כבר יש חשבון? ' : 'Already have an account? '));
      a.textContent = lang === 'he' ? 'התחבר/י ←' : 'Sign in →';
    }
  });
  const authNote = q('#auth-modal .auth-note');
  if (authNote) authNote.textContent = t.auth_note;

  // ── Orders modal ──
  const ordersH2 = q('#orders-modal h2');
  if (ordersH2) ordersH2.textContent = t.orders_title;
  const ordersLoading = q('#orders-list .orders-loading');
  if (ordersLoading) ordersLoading.textContent = t.orders_loading;

  // ── FB coupon banner (language-aware so non-IL visitors see English) ──
  const fbCouponText = q('#fb-coupon-banner .fb-coupon-text');
  if (fbCouponText) {
    fbCouponText.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    fbCouponText.innerHTML = t.fb_coupon_text;
  }
  const fbCouponClose = q('#fb-coupon-banner .fb-coupon-close');
  if (fbCouponClose) fbCouponClose.setAttribute('aria-label', t.fb_coupon_dismiss_aria);

  // Re-render dynamic content
  renderProducts();
  injectProductStructuredData();
  if (q('.cart-modal.open')) renderCart();
  if (q('#paypal-modal.open') && typeof renderOrderSummary === 'function') {
    try { renderOrderSummary(); } catch (e) { /* may not be ready */ }
  }
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
  // 2026-05-16: group cap variants under the same filter — 'cap' (AS Colour DTF)
  // and 'capemb' (Flexfit embroidered) both belong in the "Caps" category.
  if (_activeFilter !== 'all') {
    filtered = filtered.filter(p =>
      p.type === _activeFilter ||
      (_activeFilter === 'cap' && p.type === 'capemb') ||
      (_activeFilter === 'hoodie' && p.type === 'ziphoodie') ||  // we sell zip-hoodies under the "Hoodies" label
      (_activeFilter === 'accessories' && (p.type === 'mug' || p.type === 'bottle' || p.type === 'tote'))
    );
  }
  if (_activeGender !== 'all') {
    filtered = filtered.filter(p => p.gender === _activeGender || p.gender === 'unisex');
  }
  const typeMap = {
    tshirt:     t.type_tshirt,
    hoodie:     t.type_hoodie,
    cap:        t.type_cap,
    capemb:     t.type_cap,  // same display label as 'cap'
    ziphoodie:  t.type_ziphoodie,
    longsleeve: t.type_longsleeve,
    vneck:      t.type_vneck,
    tanktop:    t.type_tanktop,
    mug:        t.type_mug,
    bottle:     t.type_bottle,
    tote:       t.type_tote,
  };

  // 2026-05-23 (oren UX directive): compute per-card shippability so
  // CSS can dim the cards that the detected customer cannot order.
  // Customer-unknown → don't dim (no signal to act on yet).
  const _customerCountry = detectedCustomerCountry();

  grid.innerHTML = filtered.map(product => {
    const displayColor = pickDisplayColor(product) || product.colors[0];
    const _supported = Array.isArray(product.supportedCountries) ? product.supportedCountries : DEFAULT_SUPPORTED;
    const _notShippable = _customerCountry && !_supported.includes(_customerCountry);
    // 2026-07-25 (oren, HOODIES-style shelf): cards with a real-body persona
    // photo lead with the PERSON wearing the garment; hover reveals the flat
    // mockup. Cards with a reel get an inline ▶ (cardReelPlay). Persona cards
    // skip the back-default variety class — persona IS their variety.
    const _persona = personaImgUrl(product.id);
    const _reel = reelVideoUrl(product.id);
    return `
    <div class="product-card${_persona ? ' has-persona' : (shouldShowBackDefault(product.id) ? ' show-back-default' : '')}${_notShippable ? ' not-shippable' : ''}" data-id="${product.id}" data-type="${product.type}"
         data-selected-color="${displayColor}"${_notShippable ? ' data-not-shippable="true"' : ''}
         onclick="openProductModal(${product.id})">
      <div class="product-image" id="card-img-${product.id}">
        <img class="img-view img-back"  src="${productImg(product.id, displayColor, 'back')}"  alt="${product.phrase}" loading="lazy" onerror="this.onerror=null;this.src='${product.image}';const c=this.closest('.product-card');if(c)c.classList.remove('show-back-default');" />
        <img class="img-view img-front" src="${productImg(product.id, displayColor, 'front')}" alt="${product.phrase}" loading="lazy" onerror="this.onerror=null;this.src='${product.image}'" />
        ${_persona ? `<img class="img-view img-persona" src="${_persona}" alt="${product.phrase} — ${currentLang === 'he' ? 'על גוף אמיתי' : 'on a real body'}" loading="lazy" onerror="this.onerror=null;const c=this.closest('.product-card');if(c)c.classList.remove('has-persona');this.remove();" />` : ''}
        ${_reel ? `<button class="card-play" type="button" onclick="cardReelPlay(event, ${product.id})" aria-label="${currentLang === 'he' ? 'נגן סרטון' : 'Play video'}">▶</button>` : ''}
        ${(() => {
          // NEW badge: only on products Boss pipeline added (is_new=true) within featuredUntil window.
          const isNewActive = product.isNew === true && product.featuredUntil && new Date(product.featuredUntil) > new Date();
          return isNewActive ? `<div class="product-new-badge">${currentLang === 'he' ? 'חדש' : 'NEW'}</div>` : '';
        })()}
      </div>
      <div class="product-info">
        <div class="product-phrase">"${product.phrase}"</div>
        <div class="card-rating" id="badge-${product.id}"></div>
        <div class="product-bottom">
          <div class="product-price">${(() => {
            // Always price from the cheapest SELECTABLE variant — never the raw
            // product.price, which can drift stale-low (e.g. a leftover $26 in
            // product_prices when every variant actually sells at $35). Both the
            // "From X" and the flat-price branch use the same purchasable floor,
            // so the card can never advertise a price no variant is sold at.
            const fromPrice = getCheapestVariantPrice(product);
            return hasPriceVariance(product)
              ? `<span class="price-from">${currentLang === 'he' ? 'החל מ-' : 'From '}</span>${formatPrice(fromPrice)}`
              : formatPrice(fromPrice);
          })()}</div>
          ${(() => {
            // Wave 3 (2026-06-12): in-stock cards show NO stock badge — "Only N left"
            // on print-on-demand was fake urgency, contradicting the brand's own
            // "no fake urgency" stance. Sold-out stays (real information).
            const stockN = getStockNum(product.id);
            return stockN === 0 ? `<div class="stock-badge sold-out">${currentLang === 'he' ? 'אזל מהמלאי' : 'Sold out'}</div>` : '';
          })()}
          ${countryFlagsHTML(product, { compact: true })}
        </div>
      </div>
    </div>
    `;
  }).join('');
  // Re-apply live review badges — re-renders (filter clicks) rebuild the DOM
  // and would otherwise wipe them (the pre-Wave-A bug: badges only applied once
  // at load, against markup that no longer emitted the badge element at all).
  try { applyReviewBadges(); } catch (_) {}
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

// ── Wave A (2026-07-24): real-body persona photos + reel videos on the PDP ──
// Persona hero images (character wearing the EXACT product, generated via
// try-on against the real mockups) live at images/personas-real/persona-{id}.jpg.
// Reel bank videos (same characters, front+back garment beats) live in the
// public Supabase video-assets bucket. Both lists are verified-200 at build
// time (2026-07-24); a missing asset simply hides its thumb — nothing breaks.
// 2026-08-27 (oren: "האנשים בתמונה בכלל לא מופיעים אחר כך בסרטונים — לא מקצועי"):
// a persona photo shows on a product page ONLY when that person actually appears
// in the product's reel. Frame-audit of all 16 photos vs all 22 reels found just
// these 4 true matches (the Higgsfield preset reels built FROM the persona
// heroes). The other 12 photos showed the right garment but a DIFFERENT person
// than the video — removed from PDPs; their carousel cards keep the photo but
// lost the ▶ (index.html). Full matrix: M-memory session log 2026-08-27.
const PERSONA_IMG_PIDS = new Set([30, 32, 39, 43]);
const REEL_VIDEO_PIDS  = new Set([1, 2, 3, 4, 5, 8, 10, 11, 18, 23, 25, 29, 30, 31, 32, 34, 38, 39, 40, 41, 42, 43]);
function personaImgUrl(productId) {
  return PERSONA_IMG_PIDS.has(Number(productId)) ? `images/personas-real/persona-${productId}.jpg` : null;
}
// 2026-08-23 (oren: "כשהאתר באנגלית לא יכול להיות שיש סרטונים עם עברית — זה לא
// מקצועי"): a frame sweep of all 22 bank assets found 4 with burned-in Hebrew —
// #32, #39, #43 carry Hebrew subtitles and/or a ₪ price line, #30 carries
// pseudo-Hebrew glyphs on the frame edges. Until clean English replacements land
// from the autonomous reel pipeline, these four play ONLY on the Hebrew UI.
// 2026-08-25: all four Hebrew-burned assets were REPLACED with frame-verified
// English-clean Higgsfield-preset reels (sticker-peel #32, cardboard #30,
// action-figure #39, earth-zoom #43) — the gate emptied the same day it was due.
const HE_ONLY_REEL_PIDS = new Set([]);
function reelVideoUrl(productId) {
  const pid = Number(productId);
  if (!REEL_VIDEO_PIDS.has(pid)) return null;
  if (HE_ONLY_REEL_PIDS.has(pid) && (window.currentLang || 'en') !== 'he') return null;
  return `https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object/public/video-assets/_pilot/product-${pid}-FINAL-EN.mp4`;
}

// ── Homepage persona gallery (2026-07-24, oren: personas + videos on the main
// page, not only inside a product). Cards live statically in index.html; the
// ▶ button swaps the photo for the product's reel in-place. One video at a
// time — starting a new one restores every other card.
function homePersonaRestore(card) {
  const v = card.querySelector('video');
  if (v) { try { v.pause(); } catch (_) {} v.remove(); }
  const img = card.querySelector('img');
  if (img) img.style.display = '';
  const p = card.querySelector('.persona-play');
  if (p) p.style.display = '';
}
function homePersonaPlay(ev, pid) {
  ev.stopPropagation();
  ev.preventDefault();
  const card = ev.currentTarget.closest('.avatar-card');
  if (!card || card.querySelector('video')) return;
  document.querySelectorAll('.crew-carousel-track video').forEach(v => {
    const c = v.closest('.avatar-card');
    if (c) homePersonaRestore(c);
  });
  const url = reelVideoUrl(pid);
  if (!url) return;
  const img = card.querySelector('img');
  if (img) img.style.display = 'none';
  const playBtn = card.querySelector('.persona-play');
  if (playBtn) playBtn.style.display = 'none';
  const v = document.createElement('video');
  v.src = url;
  v.controls = true; v.playsInline = true; v.preload = 'metadata';
  // 2026-08-01 honesty fix: poster = garment mockup (see cardReelPlay note).
  v.poster = productImg(pid, (products.find(p => p.id === pid)?.colors || [])[0] || '', 'front');
  v.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#111;display:block;';
  v.addEventListener('click', e => e.stopPropagation());
  v.addEventListener('ended', () => homePersonaRestore(card));
  card.appendChild(v);
  try { v.play(); } catch (_) {}
  if (window.dubisTrack) window.dubisTrack('home_video_play', { id: pid });
}
// Hide the static homepage ▶ buttons whose reel is not served in the current
// language (HE_ONLY_REEL_PIDS on the EN UI) — a play button that does nothing
// reads as broken.
document.addEventListener('DOMContentLoaded', () => {
  try {
    document.querySelectorAll('.avatar-card .persona-play').forEach(btn => {
      const m = String(btn.getAttribute('onclick') || '').match(/homePersonaPlay\(event,\s*(\d+)\)/);
      if (m && !reelVideoUrl(Number(m[1]))) btn.style.display = 'none';
    });
  } catch (_) { /* cosmetic only */ }
});
window.homePersonaPlay = homePersonaPlay;

// ── Shop-grid inline reels (2026-07-25, oren: HOODIES-style shelf — personas
// and videos INSIDE the product grid, not only in a separate gallery).
// ▶ overlays the product reel on the card image stack; ✕ or 'ended' restores.
// One playing video at a time across the whole grid.
function cardReelStop(card) {
  const v = card.querySelector('video.card-reel');
  if (v) { try { v.pause(); } catch (_) {} v.remove(); }
  const x = card.querySelector('.card-reel-close');
  if (x) x.remove();
  card.classList.remove('reel-playing');
}
function cardReelPlay(ev, pid) {
  ev.stopPropagation();
  ev.preventDefault();
  const card = ev.currentTarget.closest('.product-card');
  if (!card || card.querySelector('video.card-reel')) return;
  document.querySelectorAll('.product-card video.card-reel').forEach(v => {
    const c = v.closest('.product-card');
    if (c) cardReelStop(c);
  });
  const url = reelVideoUrl(pid);
  if (!url) return;
  const box = card.querySelector('.product-image');
  if (!box) return;
  const v = document.createElement('video');
  v.className = 'card-reel';
  v.src = url;
  v.controls = true; v.playsInline = true; v.preload = 'metadata';
  // 2026-08-01 honesty fix: poster = the garment mockup, not the persona photo
  // (the June reel bank features different people than the July persona stills).
  v.poster = productImg(pid, (products.find(p => p.id === pid)?.colors || [])[0] || '', 'front');
  v.addEventListener('click', e => e.stopPropagation());
  v.addEventListener('ended', () => cardReelStop(card));
  const x = document.createElement('button');
  x.className = 'card-reel-close';
  x.type = 'button';
  x.setAttribute('aria-label', currentLang === 'he' ? 'סגירת סרטון' : 'Close video');
  x.textContent = '✕';
  x.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); cardReelStop(card); });
  box.appendChild(v);
  box.appendChild(x);
  card.classList.add('reel-playing');
  try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  if (window.dubisTrack) window.dubisTrack('grid_video_play', { id: pid });
}
window.cardReelPlay = cardReelPlay;

// Helper: build per-color image URL — uses imageRef if product has one (placeholder)
function productImg(productId, color, view) {
  const product = products.find(p => p.id === productId);
  // 2026-05-23 — new products (23+) carry a colorImages map of Supabase
  // Storage URLs sourced from permanent_preview_urls. Legacy products fall
  // back to the flat images/product-{id}-{Color}-{view}.jpg path on disk.
  const fromMap = product?.colorImages?.[color]?.[view];
  if (fromMap) return fromMap;
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
  // Meta Pixel — ViewContent event
  if (typeof fbq === 'function' && product) {
    fbq('track', 'ViewContent', { content_name: product.phrase, content_type: 'product', value: product.price, currency: 'USD', content_ids: [String(product.id)] });
  }
  const t = translations[currentLang];
  const typeMap = {
    tshirt:     t.type_tshirt,
    hoodie:     t.type_hoodie,
    cap:        t.type_cap,
    capemb:     t.type_cap,  // embroidered cap shares the "Cap" label
    ziphoodie:  t.type_ziphoodie,
    longsleeve: t.type_longsleeve,
    vneck:      t.type_vneck,
    tanktop:    t.type_tanktop,
    mug:        t.type_mug,
    bottle:     t.type_bottle,
    tote:       t.type_tote,
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
        ${personaImgUrl(product.id) ? `
        <div class="thumb" data-view="persona" onclick="setModalThumb(event, ${product.id}, 'persona')">
          <img src="${personaImgUrl(product.id)}" alt="${currentLang === 'he' ? 'על גוף אמיתי' : 'On a real body'}" loading="lazy"
               onerror="this.onerror=null;this.closest('.thumb').style.display='none'" />
        </div>` : ''}
        ${reelVideoUrl(product.id) ? `
        <div class="thumb thumb-video" data-view="video" onclick="setModalThumb(event, ${product.id}, 'video')" title="${currentLang === 'he' ? 'לצפייה בסרטון' : 'Watch the video'}">
          <!-- 2026-08-01 (oren: "רואים כאילו סרטון מסוים אבל בדף המוצר סרטון אחר"):
               the video thumb/poster must NEVER promise a person the reel does not
               contain — the July persona photos and the June reel bank feature
               DIFFERENT people. The garment mockup is the only always-truthful
               preview for the video. Persona photos stay on the persona thumb only. -->
          <img src="${productImg(product.id, product.colors[0], 'front')}" alt="${currentLang === 'he' ? 'סרטון' : 'Video'}" loading="lazy"
               onerror="this.onerror=null;this.src='${product.image}'" />
          <span class="thumb-play" aria-hidden="true">▶</span>
        </div>` : ''}
      </div>
    </div>
    <div class="modal-info">
      <div class="modal-type">${typeMap[product.type] || product.typeLabel}</div>
      <div class="modal-limited-badge">&#128293; ${currentLang === 'he' ? 'מהדורה מוגבלת' : 'Limited Edition'}</div>
      <h2 class="modal-phrase">"${product.phrase}"</h2>
      <div class="modal-price" id="modal-price-${product.id}" data-base-price="${product.price}">${formatPrice(getVariantPrice(product.id, product.colors[0], product.sizes[0], product.price))}</div>
      ${(() => {
        // Review summary near the price — rendered ONLY from real approved
        // reviews (no seeded stars). Click jumps to the Reviews tab.
        const rev = (typeof productReviews === 'object') ? productReviews[(product.phrase || '').toLowerCase()] : null;
        if (!rev || !rev.count) return '';
        const avg = (rev.total / rev.count).toFixed(1);
        return `<div class="modal-review-summary" onclick="document.querySelector('.prod-tab[onclick*=\\'tab-reviews-${product.id}\\']')?.click()">★ ${avg} · ${rev.count} ${currentLang === 'he' ? 'ביקורות' : (rev.count === 1 ? 'review' : 'reviews')}</div>`;
      })()}
      <div class="modal-price-note" id="modal-price-note-${product.id}" style="font-size:0.78rem;color:#888;margin-top:-4px;margin-bottom:6px;display:none;">${currentLang === 'he' ? 'המחיר משתנה לפי צבע/מידה' : 'Price varies by color/size'}</div>
      <div class="modal-shipping-info">${modalShipsTextFor(detectedCustomerCountry(), currentLang)} · <span class="free-ship-badge">${t.modal_free_ship}</span></div>
      ${(() => {
        const win = deliveryWindowText(detectedCustomerCountry(), currentLang);
        const usBadge = detectedCustomerCountry() === 'US' ? `<span class="usa-print-badge">🇺🇸 Printed in the USA</span>` : '';
        return (win || usBadge) ? `<div class="modal-delivery-window">${win}${win && usBadge ? ' · ' : ''}${usBadge}</div>` : '';
      })()}
      ${countryFlagsHTML(product)}
      <div class="modal-dtg-badge">${t.modal_dtg}</div>
      <div class="modal-option">
        <label>${t.modal_color}</label>
        <div class="modal-colors" id="modal-colors-${product.id}">
          ${product.colors.map((c, i) => {
            const anyAvail = isColorAnyInStock(product.id, c, product.sizes);
            const oosCls   = anyAvail ? '' : ' oos';
            const oosAttr  = anyAvail ? '' : ' aria-disabled="true"';
            return `
            <button class="color-btn${i === 0 ? ' selected' : ''}${oosCls}"
              onclick="selectColor(this, '${c}', ${product.id})"
              style="background:${colorToHex(c)}" title="${c}${anyAvail ? '' : ' · Sold out'}" data-color="${c}"${oosAttr}>
              ${anyAvail ? '' : '<span class="oos-slash" aria-hidden="true"></span>'}
            </button>
          `;}).join('')}
        </div>
        <div class="modal-selected-color" id="modal-color-name-${product.id}">${product.colors[0]}</div>
        <div class="modal-stock-msg" id="modal-stock-msg-${product.id}" style="display:none;margin-top:0.25rem;font-size:0.8rem;color:#b94a48;"></div>
      </div>
      <div class="modal-option">
        <label>${t.modal_size} <a href="javascript:void(0)" onclick="showSizeGuideTab(${product.id})" style="font-size:0.75rem;color:#c8a96e;margin-left:0.5rem;text-decoration:underline">${currentLang === 'he' ? '📏 טבלת מידות' : '📏 Size Guide'}</a></label>
        <div class="modal-sizes" id="modal-sizes-${product.id}">
          ${product.sizes.map((s, i) => {
            const avail = isVariantInStock(product.id, product.colors[0], s);
            const cls   = avail ? '' : ' oos';
            const dis   = avail ? '' : ' disabled aria-disabled="true"';
            return `
            <button class="size-btn${i === 0 && avail ? ' selected' : ''}${cls}"
              onclick="selectSize(this, '${s}', ${product.id})" data-size="${s}"${dis}>
              ${s}
            </button>
          `;}).join('')}
        </div>
      </div>
      <div class="modal-trust-badges">
        <span>&#128274; ${currentLang === 'he' ? 'תשלום מאובטח' : 'Secure Checkout'}</span>
        <span>&#128666; ${currentLang === 'he'
          ? `חינם מעל ${freeShippingThreshold()} · משלוח מחושב בקופה`
          : `Free over ${freeShippingThreshold()} · Shipping calculated at checkout`}</span>
        <span>&#8617;&#65039; ${currentLang === 'he' ? 'החזרה על פגמים תוך 30 יום' : '30-Day Defect Returns'}</span>
      </div>
      ${(() => {
        // Wave 3 (2026-06-12): fake "Only N left" urgency removed here too —
        // POD has no real scarcity. Sold-out stays (real information).
        const stockN = getStockNum(product.id);
        if (stockN === 0) {
          return `<div class="modal-urgency sold-out">
            <span>${currentLang === 'he' ? 'המוצר אזל זמנית — חזור בקרוב' : 'Currently sold out, back soon'}</span>
          </div>`;
        }
        return '';
      })()}
      <button class="btn-primary modal-add-btn" onclick="addToCartFromModal(${product.id})">
        ${t.modal_add}
      </button>
      <div class="dubis-promise">🤝 <strong>${currentLang === 'he' ? 'ההבטחה של DUBIS' : 'The DUBIS Promise'}</strong> — ${currentLang === 'he'
        ? 'מידה לא מתאימה? מחליפים. פגם או פריט שגוי? החלפה או החזר מלא. 30 יום, בלי טפסים, בלי דרמה.'
        : 'Wrong size? We swap it. Defective or wrong item? Replaced or refunded. 30 days, no forms, no drama.'}</div>
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

  // Sync OOS affordances now that the modal is in the DOM.
  // If the default-selected color is fully OOS, auto-bump to the first in-stock color.
  try {
    const defaultColor = product.colors[0];
    if (!isColorAnyInStock(product.id, defaultColor, product.sizes)) {
      const firstAvailColor = product.colors.find(c => isColorAnyInStock(product.id, c, product.sizes));
      if (firstAvailColor && firstAvailColor !== defaultColor) {
        const btn = document.querySelector(`#modal-colors-${product.id} .color-btn[data-color="${firstAvailColor}"]`);
        if (btn) selectColor(btn, firstAvailColor, product.id);
      } else {
        refreshSizeAvailability(product.id, defaultColor);
      }
    } else {
      refreshSizeAvailability(product.id, defaultColor);
    }
  } catch (_) { /* non-fatal */ }
}

function closeProductModal() {
  // Stop any playing PDP video — the modal DOM persists after close, and a
  // hidden video would keep playing audio.
  document.querySelectorAll('#modal-body video').forEach(v => { try { v.pause(); } catch (_) {} v.remove(); });
  const skelImg = document.querySelector('#modal-body .modal-image img');
  if (skelImg) skelImg.style.visibility = '';
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

// Recomputes the visible .modal-price for the currently-selected (color, size).
// Called from selectColor + selectSize and from the loadStockMap re-render hook.
// Also flips the "Price varies" note on when this product has > 1 distinct sell_price.
function refreshModalPrice(productId) {
  const priceEl = document.getElementById(`modal-price-${productId}`);
  if (!priceEl) return;
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const basePrice = Number(priceEl.dataset.basePrice || product.price);
  const selectedColor = document.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color || product.colors[0];
  const selectedSize  = document.querySelector(`#modal-sizes-${productId} .size-btn.selected`)?.dataset.size  || product.sizes[0];
  const eff = getVariantPrice(productId, selectedColor, selectedSize, basePrice);
  priceEl.textContent = formatPrice(eff);

  const noteEl = document.getElementById(`modal-price-note-${productId}`);
  if (!noteEl) return;

  const map = window.__DUBIS_PRICE_MAP?.[productId];
  if (!map) { noteEl.style.display = 'none'; return; }

  // Build full price universe for this product (basePrice + every variant).
  const allPrices = [basePrice];
  for (const c of Object.keys(map)) for (const s of Object.keys(map[c])) allPrices.push(map[c][s]);
  const cheapest = Math.min(...allPrices);
  const hasVariance = new Set(allPrices).size > 1;

  // Decompose the surcharge so the customer sees WHY the price moved:
  //   sizeDelta  = cheapest at current size (across all colors) − cheapest overall
  //   colorDelta = current variant price − cheapest at current size
  // This attributes Gelato's real pricing correctly. For products where colors
  // differ at every size (p3, p6, p8 Forest Green at $32 vs $21), the color
  // delta is non-zero at every size — the label must say that, not blame size.
  const pricesAtCurrentSize = [];
  for (const c of Object.keys(map)) {
    const v = map[c]?.[selectedSize];
    if (typeof v === 'number') pricesAtCurrentSize.push(v);
  }
  const cheapestAtSize = pricesAtCurrentSize.length ? Math.min(...pricesAtCurrentSize) : eff;
  const sizeDelta  = Math.max(0, cheapestAtSize - cheapest);
  const colorDelta = Math.max(0, eff - cheapestAtSize);

  if (sizeDelta === 0 && colorDelta === 0) {
    if (hasVariance) {
      noteEl.textContent = (currentLang === 'he')
        ? 'המחיר משתנה לפי צבע/מידה'
        : 'Price varies by color/size';
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }
    return;
  }

  // Build a precise breakdown.
  const parts = [];
  if (currentLang === 'he') {
    if (sizeDelta  > 0) parts.push(`${formatPrice(sizeDelta)} עבור מידה ${selectedSize}`);
    if (colorDelta > 0) parts.push(`${formatPrice(colorDelta)} עבור צבע ${selectedColor}`);
    noteEl.textContent = 'תוספת ' + parts.join(' + ');
  } else {
    if (sizeDelta  > 0) parts.push(`${formatPrice(sizeDelta)} for size ${selectedSize}`);
    if (colorDelta > 0) parts.push(`${formatPrice(colorDelta)} for ${selectedColor}`);
    noteEl.textContent = '+' + parts.join(' + ');
  }
  noteEl.style.display = '';
}

function selectColor(btn, color, productId) {
  // Block clicks on OOS color swatches
  if (btn.classList.contains('oos')) {
    const msg = document.getElementById(`modal-stock-msg-${productId}`);
    if (msg) {
      msg.textContent = currentLang === 'he' ? `${color} — אזל מהמלאי` : `${color} is sold out`;
      msg.style.display = 'block';
    }
    return;
  }
  document.querySelectorAll(`#modal-colors-${productId} .color-btn`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  // Recompute per-size availability for the newly-chosen color
  refreshSizeAvailability(productId, color);

  // Per-color sell_price may differ — re-render the price tag
  refreshModalPrice(productId);

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
  if (!imgEl) return;
  const product = products.find(p => p.id === productId);
  const wrap = imgEl.closest('.modal-image');
  // Any non-video view: tear down the video element if one is playing.
  const oldVideo = wrap ? wrap.querySelector('video') : null;
  if (view !== 'video' && oldVideo) { try { oldVideo.pause(); } catch (_) {} oldVideo.remove(); imgEl.style.visibility = ''; }

  if (view === 'video') {
    // Wave A (2026-07-24): persona reel inside the PDP gallery (Hoodies/Fox
    // pattern). Click-to-play only — preload=metadata so the ~10MB mp4 never
    // loads unless asked for. The img stays in the layout as an INVISIBLE
    // skeleton (visibility, not display) — it is the only thing giving
    // .modal-image its height on mobile, where hiding it collapsed the wrap
    // to padding-only and the video rendered 0px tall.
    const url = reelVideoUrl(productId);
    if (!url || !wrap) return;
    if (oldVideo) { try { oldVideo.play(); } catch (_) {} return; }
    imgEl.style.visibility = 'hidden';
    imgEl.dataset.view = 'front'; // keep color-switch logic on a real image view
    wrap.style.position = 'relative';
    const v = document.createElement('video');
    v.src = url;
    v.controls = true; v.playsInline = true; v.preload = 'metadata';
    // 2026-08-01: poster = garment mockup, never the persona photo — the reel
    // may feature a different person than the July persona stills (honesty fix).
    v.poster = productImg(productId, imgEl.dataset.color || product?.colors[0] || '', 'front');
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#111;display:block;';
    wrap.appendChild(v);
    try { v.play(); } catch (_) {}
    if (window.dubisTrack) window.dubisTrack('pdp_video_play', { id: productId });
    return;
  }
  if (view === 'persona') {
    const url = personaImgUrl(productId);
    if (!url) return;
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
    imgEl.src = url;
    imgEl.dataset.view = 'front'; // color-switch falls back to a real view
    return;
  }
  const color = imgEl.dataset.color || product?.colors[0] || '';
  imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = product?.image || ''; };
  imgEl.src = productImg(productId, color, view);
  imgEl.dataset.view = view;
}

function selectSize(btn, size, productId) {
  if (btn.classList.contains('oos') || btn.disabled) return;  // can't pick OOS size
  document.querySelectorAll(`#modal-sizes-${productId} .size-btn`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  refreshAddToCartGuard(productId);
  // Per-size sell_price may differ (e.g. 3XL upcharge) — re-render the price tag.
  refreshModalPrice(productId);
}

// Re-mark size buttons as OOS/available given the currently selected color.
function refreshSizeAvailability(productId, color) {
  const container = document.getElementById(`modal-sizes-${productId}`);
  if (!container) return;
  const buttons = [...container.querySelectorAll('.size-btn')];
  let firstAvail = null;
  buttons.forEach(b => {
    const size = b.dataset.size;
    const avail = isVariantInStock(productId, color, size);
    b.classList.toggle('oos', !avail);
    if (avail) { b.disabled = false; b.removeAttribute('aria-disabled'); firstAvail = firstAvail || b; }
    else       { b.disabled = true;  b.setAttribute('aria-disabled','true'); b.classList.remove('selected'); }
  });
  // If the previously-selected size is now OOS, auto-select the first available size.
  if (!container.querySelector('.size-btn.selected') && firstAvail) firstAvail.classList.add('selected');
  refreshAddToCartGuard(productId);
}

// Enable/disable the Add-to-Cart button based on the current color+size combo.
function refreshAddToCartGuard(productId) {
  const modal = document.getElementById('product-modal');
  if (!modal) return;
  const btn = modal.querySelector(`button.modal-add-btn[onclick*="(${productId})"]`);
  if (!btn) return;
  const color = modal.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color;
  const size  = modal.querySelector(`#modal-sizes-${productId} .size-btn.selected`)?.dataset.size;
  const msgEl = document.getElementById(`modal-stock-msg-${productId}`);
  if (!color || !size || !isVariantInStock(productId, color, size)) {
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.dataset.oos = '1';
    const originalLabel = btn.dataset.originalLabel || btn.textContent.trim();
    btn.dataset.originalLabel = originalLabel;
    btn.textContent = currentLang === 'he' ? 'אזל מהמלאי' : 'Sold out';
    if (msgEl) {
      msgEl.textContent = currentLang === 'he'
        ? `${color || ''} ${size || ''} — אזל מהמלאי`
        : `${color || ''} ${size || ''} is sold out`;
      msgEl.style.display = 'block';
    }
  } else {
    btn.disabled = false;
    btn.classList.remove('disabled');
    delete btn.dataset.oos;
    if (btn.dataset.originalLabel) btn.textContent = btn.dataset.originalLabel;
    if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
  }
}

// Re-render stock affordances after async stock map arrives while modal is already open.
function refreshStockUi(productId) {
  const color = document.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color
             || (products.find(p => p.id === productId)?.colors?.[0]);
  if (!color) return;
  // color swatches
  const product = products.find(p => p.id === productId);
  document.querySelectorAll(`#modal-colors-${productId} .color-btn`).forEach(b => {
    const c = b.dataset.color;
    const anyAvail = isColorAnyInStock(productId, c, product?.sizes || []);
    b.classList.toggle('oos', !anyAvail);
    if (anyAvail) b.removeAttribute('aria-disabled');
    else          b.setAttribute('aria-disabled','true');
    b.title = c + (anyAvail ? '' : ' · Sold out');
  });
  refreshSizeAvailability(productId, color);
}

// 2026-08-08: double-add guard. Campaign data showed 5 identical add_to_cart
// events in ~8s from one visitor — feedback wasn't seen, so they hammered the
// button and would have hit checkout with 5 duplicate lines. Identical variant
// within the window → don't push another line, just replay the confirmation.
let __dubisLastAdd = { key: null, at: 0 };
function dubisIsDuplicateAdd(productId, color, size) {
  const key = `${productId}|${color}|${size}`;
  const now = Date.now();
  const dup = __dubisLastAdd.key === key && (now - __dubisLastAdd.at) < 1200;
  __dubisLastAdd = { key, at: now };
  return dup;
}

function addToCartFromModal(productId) {
  const product = products.find(p => p.id === productId);
  const selectedColor = document.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color || product.colors[0];
  const selectedSize  = document.querySelector(`#modal-sizes-${productId} .size-btn.selected`)?.dataset.size  || product.sizes[0];
  // Hard block: cannot add an OOS variant to cart under any circumstance
  if (!isVariantInStock(productId, selectedColor, selectedSize)) {
    const msg = document.getElementById(`modal-stock-msg-${productId}`);
    if (msg) {
      msg.textContent = currentLang === 'he'
        ? `${selectedColor} ${selectedSize} — אזל מהמלאי, בחר/י שילוב אחר`
        : `${selectedColor} ${selectedSize} is sold out, pick another combination`;
      msg.style.display = 'block';
    }
    return;
  }
  // 2026-05-22: Country-block guardrail — only blocks when we KNOW the
  // customer's country (geo lookup completed). If country is unknown we
  // optimistically allow add — the cart-level probe + checkout will catch
  // anything that truly can't ship before money changes hands.
  const supported = Array.isArray(product.supportedCountries) ? product.supportedCountries : DEFAULT_SUPPORTED;
  const customerCountry = detectedCustomerCountry();
  if (customerCountry && supported.length > 0 && !supported.includes(customerCountry)) {
    const msg = document.getElementById(`modal-stock-msg-${productId}`);
    if (msg) {
      const ctryName = (COUNTRY_NAME[customerCountry] || {})[currentLang] || customerCountry;
      msg.textContent = currentLang === 'he'
        ? `המוצר הזה לא נשלח ל${ctryName} כרגע. נסה/י מוצר אחר.`
        : `This product doesn't ship to ${ctryName} right now. Try another item.`;
      msg.style.display = 'block';
      msg.style.color = '#b94a48';
    }
    return;
  }
  // Variant-aware price: overrides product.price when oren set a per-(color,size) override
  // in admin → product_variant_stock.sell_price_usd. Frozen at add-to-cart time so subsequent
  // admin price changes don't surprise someone mid-checkout.
  const effectivePrice = getVariantPrice(productId, selectedColor, selectedSize, product.price);
  if (dubisIsDuplicateAdd(productId, selectedColor, selectedSize)) {
    updateCartCount();
    showCartNotification(product.phrase);
    closeProductModal();
    return;
  }
  cart.push({ ...product, price: effectivePrice, basePrice: product.price, selectedColor, selectedSize });
  saveCart();
  if (window.dubisTrack) window.dubisTrack('add_to_cart', { id: product.id, phrase: product.phrase, type: product.type, price: effectivePrice, color: selectedColor, size: selectedSize, source: 'modal' });
  // Meta Pixel — AddToCart event
  if (typeof fbq === 'function') {
    fbq('track', 'AddToCart', { value: effectivePrice, currency: 'USD', content_name: product.phrase, content_type: 'product' });
  }
  updateCartCount();
  showCartNotification(product.phrase);
  closeProductModal();
}

function quickAddToCart(productId, btnEl) {
  const product = products.find(p => p.id === productId);
  // 2026-05-22: Same country-block guardrail — only blocks when geo is known.
  const supported = Array.isArray(product.supportedCountries) ? product.supportedCountries : DEFAULT_SUPPORTED;
  const customerCountry = detectedCustomerCountry();
  if (customerCountry && supported.length > 0 && !supported.includes(customerCountry)) {
    const ctryName = (COUNTRY_NAME[customerCountry] || {})[currentLang] || customerCountry;
    const txt = currentLang === 'he'
      ? `המוצר לא נשלח ל${ctryName}`
      : `Doesn't ship to ${ctryName}`;
    // Light flash on the button instead of a modal so quick-add stays quick
    if (btnEl) {
      const orig = btnEl.textContent;
      btnEl.textContent = txt;
      btnEl.disabled = true;
      btnEl.style.background = '#c8514f';
      btnEl.style.color = '#fff';
      setTimeout(() => {
        btnEl.textContent = orig;
        btnEl.disabled = false;
        btnEl.style.background = '';
        btnEl.style.color = '';
      }, 2400);
    }
    return;
  }
  const card = document.querySelector(`.product-card[data-id="${productId}"]`);
  const selectedColor = card?.dataset.selectedColor || product.colors[0];
  const selectedSize  = product.sizes[2] || 'L';
  const effectivePrice = getVariantPrice(productId, selectedColor, selectedSize, product.price);
  if (dubisIsDuplicateAdd(productId, selectedColor, selectedSize)) {
    updateCartCount();
    showCartNotification(product.phrase);
    if (btnEl) animateAddToCart(btnEl);
    return;
  }
  cart.push({ ...product, price: effectivePrice, basePrice: product.price, selectedColor, selectedSize });
  saveCart();
  if (window.dubisTrack) window.dubisTrack('add_to_cart', { id: product.id, phrase: product.phrase, type: product.type, price: effectivePrice, color: selectedColor, source: 'quick' });
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
    if (!saved) return;
    const parsed = JSON.parse(saved);
    // Drop any saved item whose product no longer exists in the catalog
    // (deleted/disabled SKUs). Without this, a customer who once added a
    // since-removed product sees a "ghost" cart on every visit.
    const validIds = new Set(products.map(p => p.id));
    cart = parsed.filter(item => validIds.has(item.id));
    if (cart.length !== parsed.length) saveCart();
    updateCartCount();
  } catch(e) { cart = []; }
}

function updateCartCount() {
  document.getElementById('cart-count').textContent = cart.length;
}

// 2026-06-13: cart lines persist in localStorage with the price captured when
// they were ADDED. When the catalog price later changes (e.g. $21 → $26) the
// stale cart price lingered — the customer was UNDERCHARGED, and worse, save.js
// rejected the order (sent price ≠ current DB price → variant-mismatch 400 →
// the order was silently dropped). That is exactly what swallowed Hila's
// 2026-06-13 order: 3 lines still carried an old $21 while the catalog had
// moved to $26. Re-price every line against the CURRENT catalog so the cart,
// the PayPal charge and the server-side validation all agree on today's price.
// Returns true if anything changed (so callers can re-render).
function reconcileCartPrices() {
  if (typeof products === 'undefined' || !Array.isArray(products) || !cart.length) return false;
  let changed = false;
  for (const item of cart) {
    const prod = products.find(p => p.id === item.id);
    if (!prod) continue; // ghost SKU — loadCart() prunes these separately
    const base    = Number(prod.price);
    const current = getVariantPrice(item.id, item.selectedColor, item.selectedSize, base);
    if (Number.isFinite(current) && current > 0 && Math.abs((Number(item.price) || 0) - current) > 0.001) {
      item.price     = current;
      item.basePrice = base;
      changed = true;
    }
  }
  if (changed) saveCart();
  return changed;
}
window.reconcileCartPrices = reconcileCartPrices;

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

// 2026-05-21: cart-level warehouse-mixing probe.
// Per-item flags show SOLO availability — each product alone CAN ship to IL.
// But Gelato has to produce the whole cart from ONE warehouse, so two
// solo-IL-OK items may still conflict when shipped together. This probe
// asks the same /v4/orders:quote endpoint the checkout uses and surfaces
// the answer in the cart drawer BEFORE the customer hits checkout.
//
// Caches by hash(cart + country) so we don't hammer Gelato on every drawer
// open. Debounced 400ms to coalesce rapid changes.
const __cartProbeCache = new Map();   // hashKey → { ok, mode, oosUidSet, reason }
let __cartProbeTimer = null;
let __cartProbeAbort = null;

function _cartProbeKey(items, country) {
  const sig = items.map(i => `${i.id}|${i.selectedColor}|${i.selectedSize}`).sort().join(';');
  return `${country}::${sig}`;
}

function _cartProbeApply(result, _country) {
  const banner = document.getElementById('cart-warehouse-banner');
  const btn    = document.getElementById('cart-checkout-btn');
  if (!banner) return;
  // Clear per-item warehouse-conflict marks first (they're additive on top of
  // the static per-item supportedCountries warnings).
  document.querySelectorAll('.cart-item.cart-conflict').forEach(el => el.classList.remove('cart-conflict'));
  document.querySelectorAll('.cart-item-warn-warehouse').forEach(el => el.remove());

  if (!result) {
    banner.style.display = 'none';
    if (btn) { btn.disabled = false; btn.classList.remove('disabled'); }
    return;
  }
  if (result.ok === true) {
    // 2026-05-22: All-clear → green confirmation. Customer can proceed.
    // RESTORE original Checkout label (might've been replaced by the
    // hard-disabled "Remove blocking items" label on a prior render).
    banner.className = 'cart-warehouse-banner cart-banner-ok';
    banner.innerHTML = currentLang === 'he'
      ? '✅ <strong>הסל שלך זמין למשלוח</strong>'
      : '✅ <strong>Your cart is ready to ship!</strong>';
    banner.style.display = '';
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled');
      btn.removeAttribute('aria-disabled');
      if (btn.dataset.origLabel) btn.textContent = btn.dataset.origLabel;
    }
    return;
  }
  // 2026-05-22 (oren clarification): only HARD-BLOCK on true STOCK issues —
  // not on split-required (multi-warehouse). Split is now allowed at checkout
  // (the dispatcher handles it as N sub-orders behind one PayPal capture).
  // Modes that BLOCK:
  //   - 'all_blocked_pre_gelato' (every item OOS or unmapped)
  //   - 'quote_partial_oos'      (Gelato refused via partial-OOS signals)
  //   - 'all_unmapped'           (every variant unsupported)
  //   - 'quote_unfulfillable'    (Gelato refused outright)
  // ok===false → mark the specific cart-item rows the API flagged as OOS
  const oosByCartIndex = new Set();
  for (const o of (result.oosItems || [])) {
    if (typeof o.cartIndex === 'number') oosByCartIndex.add(o.cartIndex);
  }
  const itemNodes = document.querySelectorAll('#cart-items .cart-item');
  let i = 0;
  itemNodes.forEach((node) => {
    if (oosByCartIndex.has(i)) {
      node.classList.add('cart-conflict');
      const info = node.querySelector('.cart-item-info');
      if (info && !info.querySelector('.cart-item-warn-warehouse')) {
        const warn = document.createElement('div');
        warn.className = 'cart-item-warn cart-item-warn-warehouse';
        warn.textContent = currentLang === 'he'
          ? '⚠️ הסר/י פריט זה כדי להמשיך'
          : '⚠️ Remove this item to continue';
        info.appendChild(warn);
      }
    }
    i++;
  });
  // Banner copy — name each blocking item by its phrase + type + size + color.
  const itemBullets = (result.oosItems || [])
    .map(o => {
      const phrase = o.phrase ? `"${o.phrase}" · ` : '';
      const sizeColor = `${o.size || ''}${o.color ? (o.size ? ' · ' : '') + o.color : ''}`.trim();
      return `<li><strong>${phrase}${o.typeLabel || o.type}</strong>${sizeColor ? ' (' + sizeColor + ')' : ''}</li>`;
    })
    .join('');
  const bodyHTML = currentLang === 'he'
    ? `<strong>⚠️ לא ניתן להמשיך לתשלום — מלאי חסר</strong>
       <p>הפריטים הבאים אזלו מהמלאי כרגע ולא ניתנים לשליחה למדינה שלך. נא להסירם כדי להמשיך:</p>
       <ul>${itemBullets}</ul>
       <p class="cart-banner-action">לחצ/י על ה-✕ ליד הפריט להסירו. לאחר ההסרה הסל יהיה זמין לתשלום.</p>`
    : `<strong>⚠️ Can't continue to payment: out of stock</strong>
       <p>The items below are out of stock and can't ship to your country right now. Remove them to continue:</p>
       <ul>${itemBullets}</ul>
       <p class="cart-banner-action">Click the ✕ next to the item to remove it. Then your cart will be ready to checkout.</p>`;
  banner.className = 'cart-warehouse-banner cart-banner-warn';
  banner.innerHTML = bodyHTML;
  banner.style.display = '';
  // HARD-disable checkout — customer MUST resolve the stock issue before
  // PayPal opens. Money never moves on a cart we know can't be fulfilled.
  if (btn) {
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
    const origLabel = btn.dataset.origLabel || btn.textContent.trim();
    if (!btn.dataset.origLabel) btn.dataset.origLabel = origLabel;
    btn.textContent = currentLang === 'he' ? '🚫 נא להסיר פריטים שאזלו' : '🚫 Remove out-of-stock items first';
  }
}

function runCartLevelProbe() {
  const banner = document.getElementById('cart-warehouse-banner');
  if (banner) banner.style.display = 'none';
  if (cart.length === 0) return;
  if (__cartProbeTimer) clearTimeout(__cartProbeTimer);
  if (__cartProbeAbort) try { __cartProbeAbort.abort(); } catch(_) {}
  __cartProbeTimer = setTimeout(async () => {
    // 2026-05-22: GEOGRAPHIC country only. If unknown, kick off the geo
    // lookup and skip this probe — it'll auto-fire again when geo lands
    // (ensureGeoCountry re-renders the cart on success).
    const country = detectedCustomerCountry();
    if (!country) {
      ensureGeoCountry();
      if (banner) banner.style.display = 'none';
      return;
    }
    const key = _cartProbeKey(cart, country);
    if (__cartProbeCache.has(key)) {
      _cartProbeApply(__cartProbeCache.get(key), country);
      return;
    }
    // Light "checking" hint so the customer doesn't see stale state mid-fetch.
    if (banner) {
      banner.style.display = '';
      banner.className = 'cart-warehouse-banner cart-banner-checking';
      banner.textContent = currentLang === 'he'
        ? '⏳ בודק זמינות עבור המדינה שלך…'
        : '⏳ Checking availability for your country…';
    }
    try {
      __cartProbeAbort = new AbortController();
      const res = await fetch('/api/create-gelato-order?action=stock-probe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  __cartProbeAbort.signal,
        body: JSON.stringify({
          country,
          shippingAddress: window.checkoutAddress || { country_code: country },
          cartItems: cart.map(item => ({
            id: item.id, type: item.type, gender: item.gender || 'unisex',
            selectedColor: item.selectedColor, selectedSize: item.selectedSize,
            designRef: item.designRef || null, typeLabel: item.typeLabel,
          })),
        }),
      });
      const probe = await res.json().catch(() => null);
      __cartProbeCache.set(key, probe);
      _cartProbeApply(probe, country);
    } catch (err) {
      // Network/abort failure → hide banner (don't block checkout); the real
      // checkout will probe again.
      if (banner) banner.style.display = 'none';
    }
  }, 400);
}
window.runCartLevelProbe = runCartLevelProbe;

function renderCart() {
  const t = translations[currentLang];
  // Re-price against the current catalog before anything is shown/summed, so a
  // stale localStorage price can never reach the total, PayPal or save.js.
  try { reconcileCartPrices(); } catch (_) {}
  const cartItems  = document.getElementById('cart-items');
  // Rebuild the total row every render so the #cart-total span is always live.
  // Previously: setting parent.textContent destroyed the span, so the NEXT
  // render's getElementById returned null and the empty-cart total update
  // was silently skipped (oren bug 2026-05-16: emptied cart kept showing ₪254).
  const totalRow = document.querySelector('.cart-footer .cart-total');
  const labelText = currentLang === 'he' ? 'סה"כ: ' : 'Total: ';
  const total = cart.reduce((sum, item) => sum + (item.price || 0), 0);
  if (totalRow) {
    totalRow.innerHTML = labelText + '<span id="cart-total">' + formatPrice(total) + '</span>';
  }

  // Wave A (2026-07-24): free-shipping progress bar. The $60 threshold existed
  // for months and never sold anything — now it asks for the next item.
  try {
    const fsEl = document.getElementById('cart-freeship');
    if (fsEl) {
      if (cart.length === 0) {
        fsEl.style.display = 'none';
      } else {
        const THRESH = 60; // USD — single source: same threshold as freeShippingThreshold()
        const pct = Math.min(100, Math.round((total / THRESH) * 100));
        const remaining = Math.max(0, THRESH - total);
        const msg = remaining <= 0
          ? (currentLang === 'he' ? '🎉 יש לך משלוח חינם' : '🎉 You\'ve got free shipping')
          : (currentLang === 'he'
              ? `עוד ${formatPrice(remaining)} למשלוח חינם`
              : `${formatPrice(remaining)} away from free shipping`);
        fsEl.innerHTML = `<div class="freeship-msg${remaining <= 0 ? ' done' : ''}">${msg}</div>` +
                         `<div class="freeship-track"><div class="freeship-fill" style="width:${pct}%"></div></div>`;
        fsEl.style.display = '';
      }
    }
  } catch (_) { /* non-fatal */ }

  if (cart.length === 0) {
    cartItems.innerHTML = '<p class="cart-empty">' + t.cart_empty + '</p>';
    return;
  }

  // 2026-05-22: GEOGRAPHIC country only — independent of UI language.
  // detectedCustomerCountry() may return null if geo lookup hasn't completed —
  // in that case we DON'T mark anything as un-shippable (don't guess).
  const detectedCountry = detectedCustomerCountry();

  cartItems.innerHTML = cart.map((item, index) => {
    // Color-specific cart thumbnail. Customer who bought Navy/White must SEE the
    // colored item, not the default black photo (oren bug 2026-05-02).
    const colorFile = (item.selectedColor || '').replace(/\s+/g, '-');
    const variantImg = colorFile ? `images/product-${item.id}-${colorFile}-front.jpg` : item.image;

    // 2026-05-22: cart-item country indicator — minimalist. Per oren feedback,
    // showing the full list of 30 country codes was visual garbage that broke
    // the cart layout. Replaced with a single compact badge showing ONLY the
    // customer's detected country:
    //   - shipsToCustomer=true  → faint green ✓ 🇮🇱 (reassurance, low signal)
    //   - shipsToCustomer=false → red 🇮🇱 ✕ (impossible to miss) + existing
    //                              .cart-item-warn block underneath
    //   - supported_countries=[] → orange ⚠️ (currently unavailable globally)
    const catalogProduct = (typeof products !== 'undefined') ? products.find(p => p.id === item.id) : null;
    const itemSupported = (catalogProduct && Array.isArray(catalogProduct.supportedCountries))
      ? catalogProduct.supportedCountries
      : DEFAULT_SUPPORTED;
    // shipsToCustomerCountry is TRUE / FALSE / null (unknown — geo not ready).
    // null is treated optimistically: no badge, no warning, no red border.
    const knowCountry = !!detectedCountry;
    const shipsToCustomerCountry = knowCountry ? itemSupported.includes(detectedCountry) : null;
    const ctryFlag = detectedCountry ? (COUNTRY_FLAG[detectedCountry] || detectedCountry) : '';
    const ctryName = detectedCountry ? ((COUNTRY_NAME[detectedCountry] || {})[currentLang] || detectedCountry) : '';

    let badgeHTML = '';
    if (itemSupported.length === 0) {
      badgeHTML = `<span class="cart-item-flag warn" title="${currentLang === 'he' ? 'אזל זמנית' : 'Currently unavailable'}">⚠️</span>`;
    } else if (knowCountry && shipsToCustomerCountry) {
      badgeHTML = `<span class="cart-item-flag ok" title="${currentLang === 'he' ? 'זמין לשליחה אליך' : 'Ships to your country'}">${ctryFlag}<span class="flag-check">✓</span></span>`;
    } else if (knowCountry && !shipsToCustomerCountry) {
      badgeHTML = `<span class="cart-item-flag no" title="${currentLang === 'he' ? `לא נשלח ל${ctryName}` : `Doesn't ship to ${ctryName}`}">${ctryFlag}<span class="flag-x-cart">✕</span></span>`;
    }
    // knowCountry=false && supported>0 → no badge (we don't know yet)

    const warnHTML = (knowCountry && !shipsToCustomerCountry && itemSupported.length > 0)
      ? `<div class="cart-item-warn">${
          currentLang === 'he'
            ? `⚠️ לא ניתן לשלוח ל${ctryName}`
            : `⚠️ Won't ship to ${ctryName}`
        }</div>`
      : '';
    const unavailHTML = (itemSupported.length === 0)
      ? `<div class="cart-item-warn">${
          currentLang === 'he' ? '⚠️ אזל זמנית' : '⚠️ Currently unavailable'
        }</div>`
      : '';
    const unshippableCls = (itemSupported.length === 0) || (knowCountry && !shipsToCustomerCountry)
      ? ' cart-item-unshippable'
      : '';

    return `
    <div class="cart-item${unshippableCls}">
      <img src="${variantImg}" alt="${item.phrase}" class="cart-item-img" onerror="this.onerror=null;this.src='${item.image}'" />
      <div class="cart-item-info">
        <div class="cart-item-name">"${item.phrase}" ${badgeHTML}</div>
        <div class="cart-item-type">${item.typeLabel} · ${item.selectedSize} · ${item.selectedColor}</div>
        ${warnHTML}${unavailHTML}
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">${formatPrice(item.price)}</div>
        <button class="cart-item-remove" onclick="removeFromCart(${index})">✕</button>
      </div>
    </div>
  `;
  }).join('');

  // 2026-05-21: kick off the cart-level Gelato warehouse-mixing check.
  // Debounced 400ms inside runCartLevelProbe so back-to-back renderCart()
  // calls (cart edit + country change) coalesce into one API request.
  try { runCartLevelProbe(); } catch (_) {}
}

function removeFromCart(index) {
  if (window.dubisTrack && cart[index]) window.dubisTrack('remove_from_cart', { id: cart[index].id, phrase: cart[index].phrase });
  cart.splice(index, 1);
  saveCart();
  updateCartCount();
  renderCart();
}

// 2026-08-08: rebuilt after us_last_run campaign data showed a visitor pressing
// add-to-cart 5x in a minute inside the FB in-app browser — the old small toast
// was easy to miss on mobile. Now: one persistent element (no stacking), product
// name + live count, a "view cart" CTA, and a bump on the cart icon.
let __dubisToastTimer = null;
function showCartNotification(phrase) {
  let notif = document.getElementById('dubis-atc-toast');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'dubis-atc-toast';
    notif.className = 'dubis-atc-toast';
    notif.addEventListener('click', () => { notif.classList.remove('show'); openCart(); });
    document.body.appendChild(notif);
  }
  const isHe = currentLang === 'he';
  const count = cart.length;
  const countTxt = isHe
    ? (count === 1 ? 'פריט אחד בסל' : `${count} פריטים בסל`)
    : (count === 1 ? '1 item in cart' : `${count} items in cart`);
  notif.innerHTML =
    `<span class="atc-check">✓</span>` +
    `<span class="atc-text"><strong>${isHe ? 'נוסף לסל!' : 'Added to cart!'}</strong>` +
    `<small>${(phrase || '').slice(0, 40)}${phrase && phrase.length > 40 ? '…' : ''} · ${countTxt}</small></span>` +
    `<span class="atc-cta">${isHe ? 'לסל ←' : 'View cart →'}</span>`;
  notif.dir = isHe ? 'rtl' : 'ltr';
  // Restart the entrance animation on every add so repeat clicks visibly react
  notif.classList.remove('show');
  void notif.offsetWidth;
  notif.classList.add('show');
  clearTimeout(__dubisToastTimer);
  __dubisToastTimer = setTimeout(() => notif.classList.remove('show'), 3500);
  // Bump the cart icon in the navbar
  const cartBtn = document.querySelector('.cart-btn');
  if (cartBtn) {
    cartBtn.classList.remove('cart-bump');
    void cartBtn.offsetWidth;
    cartBtn.classList.add('cart-bump');
  }
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

// ===== CLIENT-SIDE ANALYTICS TRACKER =====
// POSTs to /api/analytics/track. Respects cookie consent + flags internal traffic.
(function initDubisDevFlag(){
  // ?dev=1 in URL once → permanently flagged as internal traffic
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') {
      localStorage.setItem('dubis-internal', '1');
      console.log('[DUBIS] internal traffic flag set — your visits will not count in conversion stats');
    }
    if (params.get('dev') === '0') localStorage.removeItem('dubis-internal');
  } catch(e) {}
})();
// 2026-08-08: FB/IG in-app WebView (Android) runs storage in a quota-0 /
// incognito-like mode — getItem works but setItem THROWS. Result during the
// us_last_run campaign: every real ad visitor had session_id NULL and utm_*
// NULL while bots (which do persist storage) looked like the whole campaign.
// Fix: in-memory fallbacks that survive the SPA page-lifetime, used everywhere
// storage writes can fail.
window.__dubisMemSid  = null;
window.__dubisMemAttr = { first: null, last: null };

window.dubisGetSid = function() {
  try {
    const stored = sessionStorage.getItem('dubis-sid');
    if (stored) return stored;
  } catch(e) {}
  return window.__dubisMemSid;
};

(function initDubisSession(){
  let sid = null;
  try { sid = sessionStorage.getItem('dubis-sid'); } catch(e) {}
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('dubis-sid', sid); } catch(e) {}
  }
  window.__dubisMemSid = sid;
})();

// ===== ATTRIBUTION CAPTURE (UTMs + landing data) =====
// First-touch: stored in localStorage 'dubis-attr' for 30d — survives sessions, this
// is what we credit an order to (an ad clicked Wed → cart abandoned → returned Fri
// direct → purchase Sat still credits Wed's ad).
// Last-touch: stored in sessionStorage 'dubis-attr-last' — informational only,
// useful for click attribution debug.
// FB injects fbclid; Google injects gclid — we promote them to utm_source so we
// always know an ad-click happened even if a partner stripped utms.
(function captureDubisAttribution(){
  try {
    const params = new URLSearchParams(window.location.search || '');
    const fbclid = params.get('fbclid');
    const gclid  = params.get('gclid');
    const ttclid = params.get('ttclid');
    const has = (k) => params.has(k) && params.get(k);
    // 2026-08-08: referrer promotion. During us_last_run virtually every real ad
    // click arrived via l.facebook.com with NO utm and NO fbclid (the in-app
    // browser strips both), so the whole campaign read as unattributed. When
    // nothing explicit survived, fall back to the referrer domain. Medium is
    // 'inapp' inside the FB/IG WebView and 'referral' otherwise — NOT 'paid',
    // because a bare referrer can't prove an ad click (organic FB shares look
    // identical). Campaign-level credit still requires utms on the ad URL.
    const ref = (document.referrer || '').toLowerCase();
    const refSource =
      /facebook\.com|\bfb\.com|fb\.watch/.test(ref) ? 'facebook'  :
      /instagram\.com/.test(ref)                    ? 'instagram' :
      /tiktok\.com/.test(ref)                       ? 'tiktok'    :
      /\bgoogle\./.test(ref)                        ? 'google'    : null;
    // UA test inlined — dubisIsFacebookWebView() is defined further down, after this IIFE runs.
    // Android FB app WebView has no FB_IAB marker on some builds — '; wv)' is the generic
    // Android WebView token and FB/IG are the only in-app browsers that reach us via these referrers.
    const inApp = /\b(FBAN|FBAV|FB_IAB|FB4A|FBIOS|Instagram)\b/i.test(navigator.userAgent || '') ||
                  (refSource && /; wv\)/.test(navigator.userAgent || ''));
    const incoming = {
      utm_source:   has('utm_source')   || (fbclid ? 'facebook' : null) || (gclid ? 'google' : null) || (ttclid ? 'tiktok' : null) || refSource || null,
      utm_medium:   has('utm_medium')   || ((fbclid || gclid || ttclid) ? 'paid' : null) || (refSource ? (inApp ? 'inapp' : 'referral') : null) || null,
      utm_campaign: has('utm_campaign') || null,
      utm_content:  has('utm_content')  || null,
      utm_term:     has('utm_term')     || null,
      session_id:   window.dubisGetSid ? window.dubisGetSid() : null,
      landing_path: (window.location.pathname || '/') + (window.location.hash || ''),
      landing_referrer: (document.referrer || '').slice(0, 500),
      first_touch_at: new Date().toISOString(),
    };
    const hasUtm = !!(incoming.utm_source || incoming.utm_medium || incoming.utm_campaign || incoming.utm_content);

    // Last-touch — always overwrite this session so debug is honest.
    // setItem throws in the FB in-app WebView → memory fallback keeps it alive.
    if (hasUtm) {
      window.__dubisMemAttr.last = incoming;
      try { sessionStorage.setItem('dubis-attr-last', JSON.stringify(incoming)); } catch(e) {}
    }

    // First-touch — only set if empty or expired (30d), so the original ad gets credit
    let existing = null;
    try { existing = JSON.parse(localStorage.getItem('dubis-attr') || 'null'); } catch(e) {}
    if (!existing) existing = window.__dubisMemAttr.first;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const isExpired = !existing || !existing.first_touch_at ||
                      (Date.now() - new Date(existing.first_touch_at).getTime() > THIRTY_DAYS_MS);

    if (hasUtm && (isExpired || !existing.utm_source)) {
      window.__dubisMemAttr.first = incoming;
      try { localStorage.setItem('dubis-attr', JSON.stringify(incoming)); } catch(e) {}
    } else if (!existing && !hasUtm) {
      // Direct visitor — still record the first touch so we can attribute "direct" properly
      const direct = {
        utm_source:'(direct)', utm_medium:'(none)', utm_campaign:null, utm_content:null, utm_term:null,
        session_id: incoming.session_id,
        landing_path: incoming.landing_path,
        landing_referrer: incoming.landing_referrer,
        first_touch_at: incoming.first_touch_at,
      };
      window.__dubisMemAttr.first = direct;
      try { localStorage.setItem('dubis-attr', JSON.stringify(direct)); } catch(e) {}
    }
  } catch(e) { /* never throw — attribution is best-effort */ }
})();

// ===== FACEBOOK VISITOR HELPERS =====
// 2026-05-15: 88% of today's traffic = FB organic with 0 purchases on 83 product
// views. Root cause: PayPal popups die inside FB's in-app browser. Two helpers
// here serve two different UX needs:
//   - dubisCameFromFacebook(): VISITOR arrived from FB (referrer / fbclid / utm).
//     Used to show the welcome coupon banner and auto-apply DUBIS15.
//   - dubisIsFacebookWebView(): visitor is CURRENTLY inside the FB or IG in-app
//     browser (user agent). Used in paypal.js to swap PayPal buttons for an
//     "open in external browser" handoff, because popups are blocked.
window.dubisCameFromFacebook = function() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.has('fbclid')) return true;
        if ((params.get('utm_source') || '').toLowerCase() === 'facebook') return true;
        const ref = (document.referrer || '').toLowerCase();
        if (ref.includes('facebook.com') || ref.includes('fb.com') || ref.includes('l.facebook.com') || ref.includes('m.facebook.com')) return true;
        const attr = (typeof window.dubisGetAttribution === 'function') ? window.dubisGetAttribution() : null;
        if (attr && (attr.utm_source || '').toLowerCase() === 'facebook') return true;
        return false;
    } catch(e) { return false; }
};

window.dubisIsFacebookWebView = function() {
    try {
        const ua = navigator.userAgent || '';

        // (1) Named in-app browsers — the original 2026-05-24 set.
        // FBAN/FBAV — iOS Facebook app · FB_IAB/FB4A — Android Facebook app · FBIOS — older
        // Instagram in-app browser has the same PayPal-popup issue, so include it.
        if (/\b(FBAN|FBAV|FB_IAB|FB4A|FBIOS|Instagram|Messenger|Line|MicroMessenger|TikTok|Snapchat|Pinterest)\b/i.test(ua)) return true;

        // (2) 2026-08-19 — THE BLIND SPOT. Meta's Android in-app browser stopped
        // emitting FB_IAB/FB4A, so rule (1) matched ZERO of the last 7 days'
        // traffic while 67% of it (1,171 of 1,749 rows) was in fact an Android
        // WebView — including ALL 10 add-to-cart events and all 8 checkout
        // attempts, every one of them US. Those visitors got the normal PayPal
        // buttons, whose popup silently dies in a WebView: 0 purchases.
        //
        // What survives the UA scrubbing is the WebView signature itself:
        //   • a literal "; wv" in the platform block
        //   • "Version/4.0" next to a Chrome/ token
        // Chrome for Android sends NEITHER, so there is no false-positive path
        // for a real browser. And the host app does not matter — every WebView
        // blocks the PayPal popup, so the redirect handoff is the right answer
        // in all of them.
        if (/;\s*wv[;)\s]/i.test(ua)) return true;
        if (/\bVersion\/4\.0\b/.test(ua) && /\bChrome\//.test(ua) && /\bAndroid\b/.test(ua)) return true;

        // (3) iOS in-app WebViews (WKWebView) carry AppleWebKit + Mobile but no
        // "Safari/" token. Real Safari always sends Safari/, Chrome sends CriOS,
        // Firefox sends FxiOS — so requiring the absence of all three is safe.
        if (/\b(iPhone|iPad|iPod)\b/.test(ua) && /AppleWebKit/.test(ua)
            && !/\bSafari\//.test(ua) && !/\bCriOS\b/.test(ua) && !/\bFxiOS\b/.test(ua)) return true;

        return false;
    } catch(e) { return false; }
};
// Truthful alias — the check is no longer Facebook-specific. New code should use
// this name; dubisIsFacebookWebView stays as the compatibility entry point for
// the four existing call sites in main.js + paypal.js.
window.dubisIsInAppWebView = window.dubisIsFacebookWebView;

// ===== FB COUPON BANNER (DUBIS15) =====
// Auto-shown to FB-arriving visitors. Dismissible; dismiss state lives in
// sessionStorage so it doesn't nag during the same visit but re-shows on
// future visits (FB drops attribution between sessions anyway).
function dubisShowFbCouponBanner() {
    try {
        if (!window.dubisCameFromFacebook()) return;
        if (sessionStorage.getItem('dubis-fb-banner-dismissed') === '1') return;
        // 2026-05-24 — FBIA handoff banner takes priority. Stacking both is too
        // much vertical clutter on mobile + the coupon is moot if the visitor
        // can't checkout from FBIA anyway.
        if (window.dubisIsFacebookWebView && window.dubisIsFacebookWebView()) return;
        const banner = document.getElementById('fb-coupon-banner');
        if (!banner) return;
        banner.classList.add('visible');
        document.body.classList.add('fb-banner-active');
    } catch(e) {}
}

window.dubisDismissFbCouponBanner = function() {
    try {
        sessionStorage.setItem('dubis-fb-banner-dismissed', '1');
        const banner = document.getElementById('fb-coupon-banner');
        if (banner) banner.classList.remove('visible');
        document.body.classList.remove('fb-banner-active');
    } catch(e) {}
};

window.addEventListener('DOMContentLoaded', dubisShowFbCouponBanner);

// ===== FBIA HANDOFF BANNER (open in Chrome) =====
// Fires only for visitors currently inside Facebook / Instagram / Messenger
// In-App Browser. The PayPal popup does NOT load in those WebViews, so a
// banner that hands the visitor off to Chrome BEFORE they try to check out
// is the single highest-impact fix for the IL paid funnel (88% of clicks
// land here per the 2026-05-24 audit — 0 purchases over 16 days).
// Bilingual hook: HE copy is the default for the IL campaign. To switch to
// EN for a future campaign, swap based on currentLang — the data-he /
// data-en attributes on the text + button nodes are already in place.
function dubisShowFbiaBanner() {
    try {
        if (!window.dubisIsFacebookWebView || !window.dubisIsFacebookWebView()) return;
        if (sessionStorage.getItem('dubis-fbia-dismissed') === '1') return;
        const banner = document.getElementById('fbia-handoff-banner');
        if (!banner) return;
        banner.classList.add('visible');
        document.body.classList.add('fbia-active');
        if (window.dubisTrack) {
            try { window.dubisTrack('fbia_banner_shown', { ua: (navigator.userAgent || '').slice(0, 120) }); } catch(_) {}
        }
    } catch(e) {}
}

window.dubisFbiaDismiss = function() {
    try {
        sessionStorage.setItem('dubis-fbia-dismissed', '1');
        const b = document.getElementById('fbia-handoff-banner');
        if (b) b.classList.remove('visible');
        document.body.classList.remove('fbia-active');
        if (window.dubisTrack) {
            try { window.dubisTrack('fbia_banner_dismiss'); } catch(_) {}
        }
    } catch(e) {}
};

// Handoff: opens the current URL outside FBIA.
// Android: intent:// hands the page to Chrome directly (falls back to the
//   default browser chooser if Chrome isn't installed).
// iOS: FB IAB on iOS cannot programmatically open Safari (Apple sandbox).
//   Copy URL to clipboard + flip button label so the user knows what to do.
// Other: defensive — window.open in a new tab.
window.dubisFbiaHandoff = function(btnEl) {
    try {
        const ua = navigator.userAgent || '';
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const fullUrl = window.location.href;
        const platform = isAndroid ? 'android' : (isIOS ? 'ios' : 'other');

        if (window.dubisTrack) {
            try { window.dubisTrack('fbia_handoff_click', { platform: platform }); } catch(_) {}
        }

        if (isAndroid) {
            const urlSansScheme = fullUrl.replace(/^https?:\/\//, '');
            window.location.href = 'intent://' + urlSansScheme + '#Intent;scheme=https;package=com.android.chrome;end';
        } else if (isIOS) {
            const showCopied = () => {
                if (!btnEl) return;
                const origText = btnEl.textContent;
                btnEl.classList.add('copied');
                btnEl.textContent = '✓ הקישור הועתק — פתח Safari';
                setTimeout(() => {
                    btnEl.classList.remove('copied');
                    btnEl.textContent = origText;
                }, 4500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(fullUrl).then(showCopied).catch(() => _dubisFbiaFallbackCopy(fullUrl, showCopied));
            } else {
                _dubisFbiaFallbackCopy(fullUrl, showCopied);
            }
        } else {
            window.open(fullUrl, '_blank');
        }
    } catch(e) {}
};

function _dubisFbiaFallbackCopy(text, onDone) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        try { document.execCommand('copy'); } catch(_) {}
        document.body.removeChild(ta);
        if (onDone) onDone();
    } catch(_) {}
}

window.addEventListener('DOMContentLoaded', dubisShowFbiaBanner);

// Helper for checkout / orders.save — returns the first-touch attribution object,
// or null if storage is unavailable. Always inspect both localStorage (long-lived)
// and sessionStorage (current session) so we never accidentally credit (direct).
window.dubisGetAttribution = function() {
  try {
    let first = null, last = null;
    try { first = JSON.parse(localStorage.getItem('dubis-attr') || 'null'); } catch(e) {}
    try { last  = JSON.parse(sessionStorage.getItem('dubis-attr-last') || 'null'); } catch(e) {}
    // FB in-app WebView: storage writes fail → fall back to the in-memory copy
    if (!first) first = window.__dubisMemAttr && window.__dubisMemAttr.first;
    if (!last)  last  = window.__dubisMemAttr && window.__dubisMemAttr.last;
    if (!first && !last) return null;
    return {
      utm_source:   (first && first.utm_source)   || (last && last.utm_source)   || '(direct)',
      utm_medium:   (first && first.utm_medium)   || (last && last.utm_medium)   || '(none)',
      utm_campaign: (first && first.utm_campaign) || (last && last.utm_campaign) || null,
      utm_content:  (first && first.utm_content)  || (last && last.utm_content)  || null,
      utm_term:     (first && first.utm_term)     || (last && last.utm_term)     || null,
      attribution_session_id: (first && first.session_id) || (last && last.session_id) || null,
      landing_path:     (first && first.landing_path) || null,
      landing_referrer: (first && first.landing_referrer) || null,
      first_touch_at:   (first && first.first_touch_at) || null,
    };
  } catch(e) { return null; }
};

window.dubisTrack = function(event, meta) {
  try {
    // Guarded separately: if localStorage access itself throws (locked-down WebView),
    // we must NOT lose the event — absence of consent state ≠ declined.
    try { if (localStorage.getItem('dubis-cookies') === 'declined') return; } catch(e) {}
    const attr = (typeof window.dubisGetAttribution === 'function') ? window.dubisGetAttribution() : null;
    const body = JSON.stringify({
      path: (window.location.pathname || '/') + (window.location.hash || ''),
      referrer: document.referrer || '',
      event: event,
      meta: meta || null,
      session_id: (function(){ try { return window.dubisGetSid ? window.dubisGetSid() : sessionStorage.getItem('dubis-sid'); } catch(e) { return null; }})(),
      is_dev: (function(){ try { return localStorage.getItem('dubis-internal') === '1'; } catch(e) { return false; }})(),
      utm_source:   attr ? attr.utm_source   : null,
      utm_medium:   attr ? attr.utm_medium   : null,
      utm_campaign: attr ? attr.utm_campaign : null,
      utm_content:  attr ? attr.utm_content  : null,
      utm_term:     attr ? attr.utm_term     : null,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/track', blob);
    } else {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (e) { /* non-critical, never throw */ }
};

// ===== SPA NAVIGATION TRACKING + DEEP-LINK ROUTING =====
// Site uses #product-{id} hash routing — track as pageviews + product_view events
// AND auto-open the product modal when landing on or navigating to such a hash.
// (Historically this only fired tracking; the modal never opened, so Instagram/Facebook
//  deep links landed on the homepage instead of the product. Fixed 2026-04-21.)
(function initSpaTracking() {
  let __dubisLastHash = window.location.hash || '';

  // Helper — open product modal from a hash, safely (waits for modal code to load)
  function openFromHash(hash, context) {
    const m = (hash || '').match(/^#product-(\d+)/);
    if (!m) return;
    const pid = Number(m[1]);
    // Tracking
    window.dubisTrack('product_view', { product_id: pid, hash: hash, src: context || 'hashchange' });
    if (typeof fbq !== 'undefined') {
      try { fbq('track', 'ViewContent', { content_ids: [String(pid)], content_type: 'product' }); } catch(e) {}
    }
    // Modal — retry while products[] / openProductModal are still loading
    let attempts = 0;
    const tryOpen = () => {
      attempts++;
      if (typeof window.openProductModal === 'function' &&
          typeof products !== 'undefined' &&
          Array.isArray(products) &&
          products.length > 0) {
        // A throw here means a dependency wasn't ready yet (the 2026-08-27 TDZ
        // bug proved it) — keep retrying instead of giving up on first failure.
        try { window.openProductModal(pid); return; }
        catch(e) { console.error('openProductModal failed (will retry):', e); }
      }
      if (attempts < 40) setTimeout(tryOpen, 150); // up to 6s total
    };
    tryOpen();
  }

  // Query-param deep link: `?p=N` — used for Instagram captions where `#product-N`
  // gets parsed as an IG hashtag. If present, normalize to hash so openFromHash works
  // and the URL also looks clean (replaceState so the back button isn't polluted).
  function openFromQueryParam() {
    try {
      // Clean-path deep link `/p/N` (2026-08-27) — used in transactional EMAILS,
      // where Gmail's google.com/url wrapper choked on the `?p=` query form and
      // showed customers a scary redirect-notice page. Social captions keep the
      // established `?p=N` (IG-safe). Both normalize to #product-N.
      const pm = window.location.pathname.match(/^\/p\/(\d+)\/?$/);
      if (pm) {
        const pid = Number(pm[1]);
        window.history.replaceState({}, '', '/#product-' + pid);
        __dubisLastHash = '#product-' + pid;
        openFromHash(__dubisLastHash, 'path-p');
        return true;
      }
      const params = new URLSearchParams(window.location.search);
      const p = params.get('p');
      if (p && /^\d+$/.test(p)) {
        const pid = Number(p);
        const newUrl = window.location.pathname + '#product-' + pid;
        window.history.replaceState({}, '', newUrl);
        __dubisLastHash = '#product-' + pid;
        openFromHash(__dubisLastHash, 'query-p');
        return true;
      }
    } catch (e) { console.error('openFromQueryParam failed:', e); }
    return false;
  }

  // Initial pageview — fires immediately (attribution capture above is a synchronous
  // IIFE that already ran, so there is nothing to wait for). Previously this was
  // delayed 500ms "for products.js", which meant any visitor who bounced within
  // 500ms of landing was invisible to /api/analytics/track entirely — a real gap
  // measured 2026-08-13: Meta/Clarity saw far more campaign-tagged sessions than
  // we recorded. The deep-link modal-open logic below has its own retry loop
  // (tryOpen, up to 6s) so it never actually needed this delay either.
  window.dubisTrack('pageview', { initial: true, hash: __dubisLastHash });
  // `?p=N` takes precedence over hash (IG-safe URL format)
  if (!openFromQueryParam()) {
    openFromHash(__dubisLastHash, 'initial');
  }

  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash || '';
    if (newHash !== __dubisLastHash) {
      window.dubisTrack('pageview', { from: __dubisLastHash, to: newHash });
      openFromHash(newHash, 'hashchange');
      __dubisLastHash = newHash;
    }
  });
})();

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
// (`productReviews` itself is declared at the top of the file — see the
//  deep-link TDZ note there. Do NOT re-declare it here.)
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
    applyReviewBadges();
  } catch { /* non-critical */ }
}

// Paints ★ avg (count) badges onto the catalog cards. Safe to call any time —
// re-invoked from renderProducts so filter-clicks don't wipe the badges.
// Renders NOTHING for products with zero approved reviews (no fake stars).
function applyReviewBadges() {
  document.querySelectorAll('[id^="badge-"]').forEach(badge => {
    const id = badge.id.replace('badge-', '');
    const product = products.find(p => p.id == id);
    if (!product) return;
    const rev = productReviews[(product.phrase || '').toLowerCase()];
    if (rev && rev.count > 0) {
      const avg = (rev.total / rev.count).toFixed(1);
      badge.textContent = `★ ${avg} (${rev.count})`;
      badge.classList.add('has-reviews');
    }
  });
}

// 2026-05-23: PREVIEW banner — auto-appears on any host that isn't the
// production domain. Visual signal so oren (and anyone else) knows they're
// looking at a Vercel Preview deployment and that any test purchase here
// hits Sandbox PayPal + Gelato draft mode (when env wiring is configured).
function _dubisShowPreviewBannerIfNeeded() {
  try {
    const host = (window.location.hostname || '').toLowerCase();
    const isProduction = host === 'www.dubis.net' || host === 'dubis.net';
    if (isProduction) return;
    if (document.getElementById('dubis-preview-banner')) return;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    const env = isLocal ? 'LOCAL DEV' : 'VERCEL PREVIEW';
    const banner = document.createElement('div');
    banner.id = 'dubis-preview-banner';
    banner.innerHTML = `🧪 ${env}: not the live site. Test purchases only. <code>${host}</code>`;
    document.body.appendChild(banner);
    document.body.classList.add('has-preview-banner');
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', async () => {
  _dubisShowPreviewBannerIfNeeded();
  loadCart();
  checkCookieConsent();
  // Wait for DB catalog (if products.js kicked off loadFromDB() async) BEFORE
  // overriding prices and rendering — otherwise the hero CTA's Math.min runs
  // against the stale static seed instead of the live catalog.
  if (window.dubisProductsReady && typeof window.dubisProductsReady.then === 'function') {
    try { await window.dubisProductsReady; } catch (e) { /* fall back to static */ }
  }
  await loadPriceOverrides();
  // Catalog prices are now live — reconcile any stale localStorage cart lines
  // so a returning customer's cart reflects today's price (not the price from
  // the session they added it in).
  try { if (reconcileCartPrices()) updateCartCount(); } catch (_) {}
  await detectLanguage(); // IP-based geo (IL→HE, else EN); falls back to EN within 3s on failure
  // Belt-and-suspenders: re-run translateUI on the next tick in case loadFromDB
  // resolved late and mutated products[] after detectLanguage finished.
  setTimeout(() => { try { translateUI(currentLang); } catch(e) {} }, 0);
  // 2026-05-22: paint the header country-toggle with whatever we have so far
  // (override / cached / null), then kick another lookup in case the cache
  // expired. ensureGeoCountry is idempotent + cached.
  try { updateCountryToggleDisplay(detectedCustomerCountry()); } catch(_) {}
  try { ensureGeoCountry(); } catch(_) {}
  initScrollAnimations();
  loadProductReviews(); // Load reviews for badges (non-blocking)
});