// DUBIS - Main JavaScript
// For the rest of us 🐾

let cart = [];

// ===== RENDER PRODUCTS =====
function renderProducts(filter = 'all') {
    const grid = document.getElementById('products-grid');
    const filtered = filter === 'all' ? products : products.filter(p => p.type === filter);

    grid.innerHTML = filtered.map(product => `
        <div class="product-card" data-type="${product.type}" onclick="openProductModal(${product.id})">
            <div class="product-image">
                <img src="${product.image}" alt="${product.phrase}" loading="lazy" />
                <div class="product-badge">${product.typeLabel}</div>
                <div class="product-hover-overlay">
                    <span>View Details</span>
                </div>
            </div>
            <div class="product-info">
                <div class="product-phrase">"${product.phrase}"</div>
                <div class="product-colors">
                    ${product.colors.map(c => `<span class="color-dot" title="${c}" style="background:${colorToHex(c)}"></span>`).join('')}
                </div>
                <div class="product-bottom">
                    <div class="product-price">$${product.price}</div>
                    <button class="add-to-cart" onclick="event.stopPropagation(); quickAddToCart(${product.id})">+ Add</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ===== FILTER =====
function filterProducts(type, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderProducts(type);
}

// ===== PRODUCT MODAL =====
function openProductModal(productId) {
    const product = products.find(p => p.id === productId);
    const modal = document.getElementById('product-modal');
    const overlay = document.getElementById('product-modal-overlay');
    const body = document.getElementById('modal-body');

    body.innerHTML = `
        <div class="modal-image">
            <img src="${product.image}" alt="${product.phrase}" />
        </div>
        <div class="modal-info">
            <div class="modal-type">${product.typeLabel}</div>
            <h2 class="modal-phrase">"${product.phrase}"</h2>
            <div class="modal-price">$${product.price}</div>

            <div class="modal-option">
                <label>Color</label>
                <div class="modal-colors" id="modal-colors-${product.id}">
                    ${product.colors.map((c, i) => `
                        <button class="color-btn ${i === 0 ? 'selected' : ''}"
                            onclick="selectColor(this, '${c}', ${product.id})"
                            style="background:${colorToHex(c)}"
                            title="${c}"
                            data-color="${c}">
                        </button>
                    `).join('')}
                </div>
                <span class="selected-label" id="selected-color-${product.id}">${product.colors[0]}</span>
            </div>

            <div class="modal-option">
                <label>Size</label>
                <div class="modal-sizes" id="modal-sizes-${product.id}">
                    ${product.sizes.map((s, i) => `
                        <button class="size-btn ${i === 0 ? 'selected' : ''}"
                            onclick="selectSize(this, '${s}', ${product.id})"
                            data-size="${s}">
                            ${s}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="modal-quality">
                <span>🏭 Made fresh via Printful</span>
                <span>👕 Premium materials</span>
                <span>↩️ Easy returns</span>
            </div>

            <button class="btn-primary modal-add-btn" onclick="addToCartFromModal(${product.id})">
                Add to Cart 🐾
            </button>
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

function selectColor(btn, color, productId) {
    document.querySelectorAll(`#modal-colors-${productId} .color-btn`).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById(`selected-color-${productId}`).textContent = color;
}

function selectSize(btn, size, productId) {
    document.querySelectorAll(`#modal-sizes-${productId} .size-btn`).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

function addToCartFromModal(productId) {
    const product = products.find(p => p.id === productId);
    const selectedColor = document.querySelector(`#modal-colors-${productId} .color-btn.selected`)?.dataset.color || product.colors[0];
    const selectedSize = document.querySelector(`#modal-sizes-${productId} .size-btn.selected`)?.dataset.size || product.sizes[0];

    cart.push({ ...product, selectedColor, selectedSize });
    updateCartCount();
    showCartNotification(product.phrase);
    closeProductModal();
}

function quickAddToCart(productId) {
    const product = products.find(p => p.id === productId);
    cart.push({ ...product, selectedColor: product.colors[0], selectedSize: product.sizes[2] || 'L' });
    updateCartCount();
    showCartNotification(product.phrase);
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
    const cartItems = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');

    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="cart-empty">Your cart is empty. Go treat yourself.</p>';
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

    const total = cart.reduce((sum, item) => sum + item.price, 0);
    cartTotal.textContent = total;
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartCount();
    renderCart();
}

function checkout() {
    if (cart.length === 0) return;
    alert('Checkout coming soon! 🐾\nPayment system is being set up.');
}

function showCartNotification(phrase) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; bottom: 2rem; left: 50%;
        transform: translateX(-50%);
        background: #2C2C2C; color: white;
        padding: 12px 24px; border-radius: 8px;
        font-size: 0.9rem; z-index: 9999;
        border-left: 4px solid #C17E3A;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    notif.textContent = `🐾 Added to cart!`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
}

// ===== COLOR HELPER =====
function colorToHex(color) {
    const map = {
        'Black': '#2C2C2C', 'White': '#F5F0E8', 'Cream': '#E8DCC8',
        'Charcoal': '#3D3D3D', 'Navy': '#1B2A4A', 'Gray': '#888888',
        'Honey Brown': '#C17E3A',
    };
    return map[color] || '#999';
}

// ===== LANGUAGE TOGGLE =====
const translations = {
    en: {
        tagline: 'Not a model. Never wanted to be.',
        subtitle: 'For the rest of us.',
        desc: 'Real clothes for real people. No filters. No apologies. Just you, comfortably being you.',
        langBtn: 'עב'
    },
    he: {
        tagline: 'לא דוגמן. מעולם לא רציתי להיות.',
        subtitle: 'לשאר מאיתנו.',
        desc: 'בגדים אמיתיים לאנשים אמיתיים. בלי פילטרים. בלי התנצלויות. רק אתה, בנוח עם עצמך.',
        langBtn: 'EN'
    }
};

let currentLang = 'en';

function toggleLang() {
    currentLang = currentLang === 'en' ? 'he' : 'en';
    const t = translations[currentLang];
    document.querySelector('.hero-tagline').textContent = t.tagline;
    document.querySelector('.hero-subtitle').textContent = t.subtitle;
    document.querySelector('.hero-desc').textContent = t.desc;
    document.querySelector('.lang-toggle').textContent = t.langBtn;
    document.body.dir = currentLang === 'he' ? 'rtl' : 'ltr';
}

// ===== COOKIES =====
function acceptCookies() {
    localStorage.setItem('dubis-cookies', 'accepted');
    document.getElementById('cookie-banner').style.display = 'none';
}

function declineCookies() {
    localStorage.setItem('dubis-cookies', 'declined');
    document.getElementById('cookie-banner').style.display = 'none';
}

function checkCookieConsent() {
    if (localStorage.getItem('dubis-cookies')) {
        document.getElementById('cookie-banner').style.display = 'none';
    }
}

// ===== INIT =====
document.querySelector('.cart-btn').addEventListener('click', openCart);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeProductModal(); closeCart(); }
});

document.addEventListener('DOMContentLoaded', () => {
    renderProducts();
    checkCookieConsent();
});
