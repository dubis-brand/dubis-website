// DUBIS - Main JavaScript
// For the rest of us 🐾

let cart = [];
let currentFilter = 'all';

// ===== RENDER PRODUCTS =====
function renderProducts(filter = 'all') {
    const grid = document.getElementById('products-grid');
    const filtered = filter === 'all' ? products : products.filter(p => p.type === filter);

    grid.innerHTML = filtered.map(product => `
        <div class="product-card" data-type="${product.type}">
            <div class="product-image">
                <img src="${product.image}" alt="${product.phrase}" loading="lazy" />
                <div class="product-badge">${product.typeLabel}</div>
            </div>
            <div class="product-info">
                <div class="product-phrase">"${product.phrase}"</div>
                <div class="product-colors">
                    ${product.colors.map(c => `<span class="color-dot" title="${c}" style="background:${colorToHex(c)}"></span>`).join('')}
                </div>
                <div class="product-bottom">
                    <div class="product-price">$${product.price}</div>
                    <button class="add-to-cart" onclick="addToCart(${product.id})">Add to Cart</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ===== FILTER =====
function filterProducts(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    renderProducts(type);
}

// ===== CART =====
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    cart.push(product);
    updateCartCount();
    showCartNotification(product.phrase);
}

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
            <div class="cart-item-info">
                <div class="cart-item-name">"${item.phrase}"</div>
                <div class="cart-item-type">${item.icon} ${item.typeLabel}</div>
            </div>
            <div class="cart-item-price">$${item.price}</div>
        </div>
    `).join('');

    const total = cart.reduce((sum, item) => sum + item.price, 0);
    cartTotal.textContent = total;
}

function checkout() {
    if (cart.length === 0) return;
    alert('Checkout coming soon! 🐾\nWe\'re setting up our payment system.');
}

function showCartNotification(phrase) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        background: #2C2C2C;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 0.9rem;
        z-index: 3000;
        animation: fadeInUp 0.3s ease;
        border-left: 4px solid #C17E3A;
    `;
    notif.textContent = `🐾 Added to cart!`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
}

// ===== LANGUAGE TOGGLE =====
const translations = {
    en: {
        tagline: 'Not a model. Never wanted to be.',
        title: 'DUBIS',
        subtitle: 'For the rest of us.',
        desc: 'Real clothes for real people. No filters. No apologies. Just you, comfortably being you.',
        shopBtn: 'Shop the Collection',
        langBtn: 'עב'
    },
    he: {
        tagline: 'לא דוגמן. מעולם לא רציתי להיות.',
        title: 'DUBIS',
        subtitle: 'לשאר מאיתנו.',
        desc: 'בגדים אמיתיים לאנשים אמיתיים. בלי פילטרים. בלי התנצלויות. רק אתה, בנוח עם עצמך.',
        shopBtn: 'לחנות',
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

// ===== COLOR HELPER =====
function colorToHex(color) {
    const map = {
        'Black': '#2C2C2C',
        'White': '#F5F0E8',
        'Cream': '#E8DCC8',
        'Charcoal': '#3D3D3D',
        'Navy': '#1B2A4A',
        'Gray': '#888888',
        'Honey Brown': '#C17E3A',
    };
    return map[color] || '#999';
}

// ===== CART BUTTON =====
document.querySelector('.cart-btn').addEventListener('click', openCart);

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    renderProducts();
});
