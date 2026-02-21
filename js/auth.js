// DUBIS — Authentication Module (Supabase)
// =====================================================

const SUPABASE_URL  = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50end2cXRwZG12dmF2Ymh1eWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2ODk1ODAsImV4cCI6MjA4NzI2NTU4MH0.EpfZAg28aU6_sOblfkVpkAwp9nDvXMTRCCNz0UJWHEc';

let _sb            = null;   // Supabase client
let _currentUser   = null;
let _currentSession= null;
let _pendingCheckout = false;

// ─── INIT ─────────────────────────────────────────────
function initAuth() {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, storageKey: 'dubis-auth' }
    });

    _sb.auth.getSession().then(({ data: { session } }) => {
        _currentSession = session;
        _currentUser    = session?.user || null;
        _updateAuthUI();
    });

    _sb.auth.onAuthStateChange((event, session) => {
        _currentSession = session;
        _currentUser    = session?.user || null;
        _updateAuthUI();

        if (event === 'SIGNED_IN' && _pendingCheckout) {
            _pendingCheckout = false;
            closeAuthModal();
            // Small delay so modal closes cleanly before PayPal loads
            setTimeout(() => checkout(), 200);
        }
    });
}

// ─── PUBLIC HELPERS ───────────────────────────────────
async function getAuthToken() {
    if (!_sb) return null;
    const { data: { session } } = await _sb.auth.getSession();
    return session?.access_token || null;
}

function getCurrentUser() { return _currentUser; }

/** Called by checkout() — opens login modal if not authenticated */
function requireAuthThenCheckout() {
    if (_currentUser) {
        checkout();
    } else {
        _pendingCheckout = true;
        openAuthModal('login');
    }
}

// ─── AUTH MODAL ───────────────────────────────────────
function openAuthModal(tab = 'login') {
    showAuthTab(tab);
    _clearErrors();
    document.getElementById('auth-modal').classList.add('open');
    document.getElementById('auth-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.remove('open');
    document.getElementById('auth-overlay').classList.remove('open');
    document.body.style.overflow = '';
    _pendingCheckout = false;
}

function showAuthTab(tab) {
    document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
    document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    _clearErrors();
}

function _clearErrors() {
    document.querySelectorAll('.auth-error').forEach(el => el.textContent = '');
}

function _setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
}

function _setBtnLoading(btnId, loading, defaultText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : defaultText;
}

// ─── REGISTER ─────────────────────────────────────────
async function authRegister() {
    const name     = (document.getElementById('reg-name').value    || '').trim();
    const email    = (document.getElementById('reg-email').value   || '').trim();
    const password =  document.getElementById('reg-password').value || '';
    const phone    = (document.getElementById('reg-phone').value   || '').trim();

    if (!name || !email || !password) return _setError('reg-error', 'Please fill in all required fields.');
    if (password.length < 8)         return _setError('reg-error', 'Password must be at least 8 characters.');

    _setBtnLoading('btn-register', true, 'Create Account');

    const { data, error } = await _sb.auth.signUp({
        email, password,
        options: { data: { full_name: name, phone: phone || null } }
    });

    _setBtnLoading('btn-register', false, 'Create Account');

    if (error) return _setError('reg-error', error.message);

    // Update profile row with phone
    if (phone && data.user) {
        await _sb.from('profiles').update({ phone, full_name: name }).eq('id', data.user.id);
    }

    if (data.session) {
        // Email confirmation disabled — already signed in
        closeAuthModal();
    } else {
        // Show "check your email" message
        document.getElementById('form-register').innerHTML = `
            <div class="auth-success">
                <div style="font-size:2.5rem;margin-bottom:.75rem">📬</div>
                <p>Check your email to confirm your account, then sign in.</p>
                <button class="btn-primary" onclick="showAuthTab('login')" style="margin-top:1.25rem;width:100%">
                    Go to Sign In
                </button>
            </div>`;
    }
}

// ─── LOGIN ────────────────────────────────────────────
async function authLogin() {
    const email    = (document.getElementById('login-email').value    || '').trim();
    const password =  document.getElementById('login-password').value || '';

    if (!email || !password) return _setError('login-error', 'Please enter your email and password.');

    _setBtnLoading('btn-login', true, 'Sign In');

    const { error } = await _sb.auth.signInWithPassword({ email, password });

    _setBtnLoading('btn-login', false, 'Sign In');

    if (error) return _setError('login-error', error.message);
    // onAuthStateChange handles the rest (close modal, proceed to checkout if pending)
}

// Allow Enter key in login form
function authLoginOnEnter(e) {
    if (e.key === 'Enter') authLogin();
}
function authRegisterOnEnter(e) {
    if (e.key === 'Enter') authRegister();
}

// ─── LOGOUT ───────────────────────────────────────────
async function authLogout() {
    await _sb.auth.signOut();
    _currentUser    = null;
    _currentSession = null;
    closeAccountMenu();
    _updateAuthUI();
}

// ─── NAVBAR UI ────────────────────────────────────────
function _updateAuthUI() {
    const btn = document.getElementById('account-btn');
    if (!btn) return;

    const t = (typeof currentLang !== 'undefined' && translations)
        ? translations[currentLang] : {};

    if (_currentUser) {
        const name = _currentUser.user_metadata?.full_name || _currentUser.email || '';
        const firstName = name.split(/[\s@]/)[0];
        btn.innerHTML = `👤 <span>${firstName}</span>`;
        btn.onclick = toggleAccountMenu;

        const menuName = document.getElementById('account-menu-name');
        if (menuName) menuName.textContent = name || _currentUser.email;
    } else {
        btn.innerHTML = `👤 <span>${t.sign_in || 'Sign In'}</span>`;
        btn.onclick = () => openAuthModal('login');
    }
}

function toggleAccountMenu() {
    document.getElementById('account-menu')?.classList.toggle('open');
}
function closeAccountMenu() {
    document.getElementById('account-menu')?.classList.remove('open');
}

// Close account menu on outside click
document.addEventListener('click', e => {
    if (!e.target.closest('.account-wrapper')) closeAccountMenu();
});

// ─── MY ORDERS MODAL ──────────────────────────────────
async function openMyOrders() {
    closeAccountMenu();
    if (!_currentUser) { openAuthModal('login'); return; }

    document.getElementById('orders-modal').classList.add('open');
    document.getElementById('orders-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    const container = document.getElementById('orders-list');
    container.innerHTML = '<p class="orders-loading">Loading your orders… 🐾</p>';

    const { data: orders, error } = await _sb
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        container.innerHTML = '<p class="orders-empty">Could not load orders. Please try again.</p>';
        return;
    }
    if (!orders || orders.length === 0) {
        container.innerHTML = '<p class="orders-empty">No orders yet — go find your fit! 🐾</p>';
        return;
    }

    const STATUS_COLORS = {
        pending:       '#f59e0b',
        in_production: '#3b82f6',
        shipped:       '#8b5cf6',
        delivered:     '#22c55e',
        cancelled:     '#ef4444'
    };

    container.innerHTML = orders.map(o => {
        const date   = new Date(o.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
        const status = (o.status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const items  = Array.isArray(o.items) ? o.items : [];
        const color  = STATUS_COLORS[o.status] || '#888';
        return `
        <div class="order-card">
            <div class="order-card-header">
                <span class="order-date">${date}</span>
                <span class="order-status" style="color:${color}">${status}</span>
            </div>
            <div class="order-items-list">
                ${items.map(item => `
                    <div class="order-line">
                        <span class="order-line-name">${item.typeLabel || item.type} — "${(item.phrase || '').substring(0, 28)}…"</span>
                        <span class="order-line-variant">${item.selectedSize} · ${item.selectedColor}</span>
                        <span class="order-line-price">$${item.price}</span>
                    </div>`).join('')}
            </div>
            <div class="order-card-footer">
                <span>Total: <strong>$${Number(o.total_amount).toFixed(2)}</strong></span>
                ${o.tracking_number ? `<a class="order-tracking" href="https://track.aftership.com/${o.tracking_number}" target="_blank">Track shipment →</a>` : ''}
            </div>
        </div>`;
    }).join('');
}

function closeMyOrders() {
    document.getElementById('orders-modal').classList.remove('open');
    document.getElementById('orders-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

// ─── BOOT ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);
