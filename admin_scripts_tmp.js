


  const SUPABASE_URL  = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50end2cXRwZG12dmF2Ymh1eWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2ODk1ODAsImV4cCI6MjA4NzI2NTU4MH0.EpfZAg28aU6_sOblfkVpkAwp9nDvXMTRCCNz0UJWHEc';

  let _sb        = null;
  let _allUsers  = [];
  let _allOrders = [];
  let _currentFilter = 'all';

  // ── Init ──────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', async () => {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, storageKey: 'dubis-auth' }
    });

    const { data: { session } } = await _sb.auth.getSession();
    if (session?.user) {
      await showDashboard(session.user, session.access_token);
    }

    // Handle OAuth redirect callback (Google login lands back here)
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await showDashboard(session.user, session.access_token);
      }
    });
  });

  // ── Login ─────────────────────────────────────────────────
  async function adminLogin() {
    const email    = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login');

    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = 'Sign In';

    if (error) { errEl.textContent = error.message; return; }
    await showDashboard(data.user, data.session.access_token);
  }

  // ── Google Sign-In ────────────────────────────────────────
  async function adminSignInWithGoogle() {
    const { error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://www.dubis.net/admin' }
    });
    if (error) {
      document.getElementById('login-error').textContent = error.message;
    }
  }

  // ── Dashboard ─────────────────────────────────────────────
  async function showDashboard(user, token) {
    document.getElementById('admin-user-email').textContent = user.email;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    window._supabase = _sb;
    await loadOrders(token);
  }

  async function loadOrders(token) {
    // Use the token from the current session if not passed
    if (!token) {
      const { data: { session } } = await _sb.auth.getSession();
      token = session?.access_token;
    }

    try {
      const res = await fetch('/api/admin/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.status === 403) {
        document.getElementById('table-loading').textContent =
          '⛔ Access denied. Your email is not in the admin list.';
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      _allOrders = json.orders || [];

      // Stats
      document.getElementById('stat-total').textContent      = json.stats.activeTotal ?? json.stats.total;
      document.getElementById('stat-revenue').textContent    = `$${json.stats.totalRevenue}`;
      document.getElementById('stat-today').textContent      = `$${json.stats.todayRevenue}`;
      document.getElementById('stat-pending').textContent    = json.stats.statusCounts.pending || 0;
      document.getElementById('stat-production').textContent = json.stats.statusCounts.in_production || 0;
      document.getElementById('stat-shipped').textContent    = json.stats.statusCounts.shipped || 0;

      document.getElementById('table-loading').style.display = 'none';
      renderTable();
      initCharts(json.stats.statusCounts);
      buildItemsReport();

    } catch(err) {
      document.getElementById('table-loading').textContent = 'Error loading orders: ' + err.message;
    }
  }

  // ── Filter & Render ───────────────────────────────────────
  function setFilter(filter, btn) {
    _currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTable();
  }

  function renderTable() {
    const search  = (document.getElementById('search-input').value || '').toLowerCase();
    const tbody   = document.getElementById('orders-tbody');
    const table   = document.getElementById('orders-table');
    const empty   = document.getElementById('table-empty');

    let rows = _allOrders.filter(o => {
      if (_currentFilter !== 'all' && o.status !== _currentFilter) return false;
      if (search) {
        const hay = `${o.buyer_email || ''} ${o.paypal_order_id || ''} ${o.id || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (rows.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = rows.map(o => {
      const date  = new Date(o.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
      const shortId = (o.paypal_order_id || o.id || '').toString().substring(0, 12).toUpperCase();
      const items = (Array.isArray(o.items) ? o.items : [])
        .map(i => `${i.typeLabel || i.type} ${i.selectedSize}/${i.selectedColor}`)
        .join(', ');
      const statusClass = `status-${o.status || 'pending'}`;
      const statusLabel = (o.status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const trackingLink = o.tracking_number
        ? `<a class="track-link" href="${o.tracking_url || `https://www.dhl.com/en/express/tracking.html?AWB=${o.tracking_number}&brand=DHL`}" target="_blank">${o.tracking_number}</a>`
        : '<span style="color:#555">—</span>';
      const syncBtn = o.printful_order_id
        ? `<button class="sync-btn" onclick="syncGelato('${o.id}', this)" title="Sync from Gelato">↻</button>`
        : '';

      const addr = o.shipping_address || {};
      const addrStr = [addr.name, addr.address_line_1, addr.city, addr.country_code].filter(Boolean).join(', ');
      const DARK_C = new Set(['Black','Charcoal','Navy','Forest Green']);
      const itemsList = (Array.isArray(o.items) ? o.items : [])
        .map(i => {
          const variant = DARK_C.has(i.selectedColor) ? 'white' : 'dark';
          const designId = i.designRef || i.id;
          const frontUrl = `/designs/front_logo_${variant}.png`;
          const backUrl  = `/designs/back_design_${designId}_${variant}.png`;
          const frontBg  = DARK_C.has(i.selectedColor) ? '#111' : '#eee';
          const backBg   = DARK_C.has(i.selectedColor) ? '#111' : '#eee';
          return `<div style="margin-bottom:10px">
            <div style="font-size:.82rem">${i.typeLabel || i.type} ${i.selectedSize || ''} <span style="color:#c8a96e">${i.selectedColor || ''}</span> — $${i.price}</div>
            <div class="print-files-row">
              <div class="print-file-thumb">
                <img src="${frontUrl}" style="background:${frontBg}" onerror="this.style.opacity='.2'">
                <span>Front</span>
              </div>
              <div class="print-file-thumb">
                <img src="${backUrl}" style="background:${backBg}" onerror="this.style.opacity='.2'">
                <span>Back</span>
              </div>
            </div>
          </div>`;
        }).join('');

      return `
        <tr class="order-main-row" onclick="toggleOrderDetail('${o.id}')">
          <td>${date}</td>
          <td><span class="order-id">${shortId}</span></td>
          <td class="hide-mobile" style="color:#888;font-size:.8rem">${o.buyer_email || '—'}</td>
          <td><div class="items-summary">${items || '—'}</div></td>
          <td id="status-cell-${o.id}"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td class="amount">$${Number(o.total_amount || 0).toFixed(2)}</td>
          <td class="hide-mobile" id="tracking-cell-${o.id}" onclick="event.stopPropagation()">${trackingLink} ${syncBtn}</td>
        </tr>
        <tr id="detail-${o.id}" class="order-detail-row hidden">
          <td colspan="7">
            <div class="order-detail-panel">
              <div><strong>Items + Print Files:</strong><br>${itemsList || '—'}</div>
              <div><strong>Ship to:</strong><br>${addrStr || '—'}</div>
              <div><strong>Coupon:</strong> ${o.coupon_code || '—'}${o.discount_amount ? ` (−$${o.discount_amount})` : ''}</div>
              <div><strong>Gelato ID:</strong><br><span style="font-family:monospace;font-size:.72rem;color:#666">${o.printful_order_id || '—'}</span></div>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ── Gelato Sync ──────────────────────────────────────
  async function syncGelato(orderId, btn) {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    btn.disabled = true;
    btn.textContent = '…';

    try {
      const res = await fetch('/api/admin/gelato-sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();

      if (!data.synced) {
        btn.textContent = '↻';
        btn.disabled = false;
        alert(data.reason === 'no_gelato_key' ? 'GELATO_API_KEY not set in Vercel env.' : `Sync failed: ${data.reason}`);
        return;
      }

      // Update status cell
      if (data.status) {
        const statusCell = document.getElementById(`status-cell-${orderId}`);
        const label = data.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (statusCell) statusCell.innerHTML = `<span class="status-badge status-${data.status}">${label}</span>`;
      }

      // Update tracking cell
      const trackingCell = document.getElementById(`tracking-cell-${orderId}`);
      if (trackingCell && data.tracking_number) {
        const href = data.tracking_url || `https://mydhl.express.dhl/en/en/tracking.html#/results?id=${data.tracking_number}`;
        trackingCell.innerHTML = `<a class="track-link" href="${href}" target="_blank">${data.tracking_number}</a> <button class="sync-btn" onclick="syncGelato('${orderId}', this)" title="Sync from Gelato">↻</button>`;
      } else {
        // Log debug info to console for troubleshooting
        console.log('Gelato sync — no tracking found. Debug:', data._debug, 'gelato_status:', data.gelato_status);
        btn.textContent = data.gelato_status ? `✓ (${data.gelato_status})` : '✓';
        setTimeout(() => { btn.textContent = '↻'; btn.disabled = false; }, 3000);
        return;
      }

    } catch (e) {
      console.error('Sync error:', e);
      btn.textContent = '↻';
      btn.disabled = false;
    }
  }

  // ── Section navigation ────────────────────────────────
  let _usersLoaded = false;
  let _analyticsLoaded = false;
  let _productsLoaded = false;

  let _reviewsLoaded   = false;
  let _campaignsLoaded = false;
  let _galleryLoaded   = false;

  function showSection(name, btn) {
    document.getElementById('section-orders').style.display    = name === 'orders'    ? '' : 'none';
    document.getElementById('section-users').style.display     = name === 'users'     ? '' : 'none';
    document.getElementById('section-coupons').style.display   = name === 'coupons'   ? '' : 'none';
    document.getElementById('section-analytics').style.display = name === 'analytics' ? '' : 'none';
    document.getElementById('section-products').style.display  = name === 'products'  ? '' : 'none';
    document.getElementById('section-reviews').style.display   = name === 'reviews'   ? '' : 'none';
    document.getElementById('section-tasks').style.display     = name === 'tasks'     ? '' : 'none';
    document.getElementById('section-agents').style.display    = name === 'agents'    ? '' : 'none';
    document.getElementById('section-campaigns').style.display = name === 'campaigns' ? '' : 'none';
    document.getElementById('section-gallery').style.display   = name === 'gallery'   ? '' : 'none';
    if (name === 'tasks') loadTasks();
    if (name === 'agents') loadAgentsSection();
    if (name === 'campaigns' && !_campaignsLoaded) { _campaignsLoaded = true; loadCampaigns(); }
    if (name === 'gallery' && !_galleryLoaded) { _galleryLoaded = true; loadGalleryInit(); }
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (name === 'coupons') loadCoupons();
    if (name === 'users' && !_usersLoaded) { _usersLoaded = true; loadUsers(); }
    if (name === 'analytics' && !_analyticsLoaded) { _analyticsLoaded = true; loadAnalytics(); }
    if (name === 'products' && !_productsLoaded) { _productsLoaded = true; loadProducts(); }
    if (name === 'reviews' && !_reviewsLoaded) { _reviewsLoaded = true; loadReviews(); }
  }

  // ── Users: Load ───────────────────────────────────────
  async function loadUsers() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    document.getElementById('users-loading').style.display = '';
    document.getElementById('users-table').style.display   = 'none';
    document.getElementById('users-empty').style.display   = 'none';

    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.status === 403) {
        document.getElementById('users-loading').textContent = '⛔ Access denied.';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      _allUsers = json.users || [];
      document.getElementById('users-loading').style.display = 'none';
      renderUsers();

    } catch(err) {
      document.getElementById('users-loading').textContent = 'Error: ' + err.message;
    }
  }

  // ── Users: Render ─────────────────────────────────────
  function renderUsers() {
    const search  = (document.getElementById('user-search').value || '').toLowerCase();
    const tbody   = document.getElementById('users-tbody');
    const table   = document.getElementById('users-table');
    const empty   = document.getElementById('users-empty');
    const counter = document.getElementById('users-count');

    const rows = _allUsers.filter(u => {
      if (!search) return true;
      return (u.email + ' ' + (u.full_name || '')).toLowerCase().includes(search);
    });

    counter.textContent = `${rows.length} user${rows.length !== 1 ? 's' : ''}`;

    if (rows.length === 0) {
      table.style.display = 'none';
      empty.style.display = '';
      return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    tbody.innerHTML = rows.map(u => {
      const initials = ((u.full_name || u.email || '?').charAt(0)).toUpperCase();
      const name     = u.full_name || '';
      const joined   = u.created_at
        ? new Date(u.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
        : '—';
      const lastSeen = u.last_sign_in_at
        ? new Date(u.last_sign_in_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
        : 'Never';

      const providerIcon  = u.provider === 'google' ? '🔵' : u.provider === 'azure' ? '🟦' : '📧';
      const providerLabel = { google: 'Google', azure: 'Microsoft', email: 'Email' }[u.provider] || u.provider;

      let roleBadge, actionBtn;
      if (u.is_super_admin) {
        roleBadge = `<span class="admin-badge badge-super">⭐ Super Admin</span>`;
        actionBtn = `<span style="color:#333;font-size:.75rem">Protected</span>`;
      } else if (u.is_admin) {
        roleBadge = `<span class="admin-badge badge-admin">🛡 Admin</span>`;
        actionBtn = `<button class="btn-toggle-admin btn-revoke"
                       onclick="toggleAdmin('${u.email}', false, this)">Revoke Admin</button>`;
      } else {
        roleBadge = `<span class="admin-badge badge-user">User</span>`;
        actionBtn = `<button class="btn-toggle-admin btn-grant"
                       onclick="toggleAdmin('${u.email}', true, this)">Make Admin</button>`;
      }

      return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar">${initials}</div>
              <div>
                <div class="user-name">${name || '<span style="color:#444">—</span>'}</div>
                <div class="user-email-sub">${u.email}</div>
              </div>
            </div>
          </td>
          <td class="hide-mobile" style="color:#666;font-size:.8rem">${joined}</td>
          <td class="hide-mobile" style="color:#666;font-size:.8rem">${lastSeen}</td>
          <td><span class="provider-badge">${providerIcon} ${providerLabel}</span></td>
          <td>${roleBadge}</td>
          <td>${actionBtn}</td>
        </tr>`;
    }).join('');
  }

  // ── Users: Toggle admin ───────────────────────────────
  async function toggleAdmin(email, grant, btn) {
    btn.disabled = true;
    btn.textContent = grant ? 'Granting…' : 'Revoking…';

    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;

    try {
      const res = await fetch('/api/admin/users', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ action: grant ? 'grant' : 'revoke', email }),
      });

      const json = await res.json();
      if (!res.ok) {
        alert('Error: ' + (json.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = grant ? 'Make Admin' : 'Revoke Admin';
        return;
      }

      // Update local data and re-render without full reload
      _allUsers = _allUsers.map(u => u.email === email ? { ...u, is_admin: grant } : u);
      renderUsers();

    } catch(err) {
      alert('Network error: ' + err.message);
      btn.disabled = false;
    }
  }

  // ── Logout ────────────────────────────────────────────────
  async function adminLogout() {
    await _sb.auth.signOut();
    location.reload();
  }

  // ══ COUPONS ═══════════════════════════════════════════════
  let _editingCoupon = null;

  async function loadCoupons() {
    const token = (await _sb.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/admin/coupons', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { coupons = [] } = await res.json();
    const tbody = document.getElementById('coupons-tbody');
    const empty = document.getElementById('coupons-empty');

    if (!coupons.length) {
      tbody.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = coupons.map(c => {
      const discStr = c.discount_type === 'percentage'
        ? `${c.discount_value}%`
        : `$${c.discount_value}`;
      const until = new Date(c.valid_until).toLocaleDateString('en-GB');
      const uses = c.max_uses ? `${c.current_uses}/${c.max_uses}` : `${c.current_uses}/∞`;
      const expired = new Date(c.valid_until) < new Date();
      const statusColor = !c.enabled ? '#888' : expired ? '#ef4444' : '#22c55e';
      const statusText  = !c.enabled ? 'Disabled' : expired ? 'Expired' : 'Active';
      return `<tr>
        <td><strong>${c.code}</strong></td>
        <td>${c.name}</td>
        <td>${discStr}</td>
        <td>${until}</td>
        <td>${uses}</td>
        <td style="color:${statusColor};font-weight:600">${statusText}</td>
        <td>
          <button class="btn-sm" onclick='editCoupon(${JSON.stringify(c)})' style="margin-right:4px">Edit</button>
          <button class="btn-sm" style="color:#ef4444" onclick="deleteCoupon('${c.code}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  }

  function openCouponModal(coupon) {
    _editingCoupon = coupon || null;
    document.getElementById('coupon-modal-title').textContent = coupon ? 'Edit Coupon' : 'New Coupon';
    document.getElementById('cp-code').value = coupon?.code || '';
    document.getElementById('cp-code').disabled = !!coupon;
    document.getElementById('cp-name').value = coupon?.name || '';
    document.getElementById('cp-value').value = coupon?.discount_value || '';
    document.querySelector(`input[name="cp-type"][value="${coupon?.discount_type || 'percentage'}"]`).checked = true;
    document.getElementById('cp-from').value  = coupon ? coupon.valid_from.split('T')[0] : '';
    document.getElementById('cp-until').value = coupon ? coupon.valid_until.split('T')[0] : '';
    document.getElementById('cp-maxuses').value = coupon?.max_uses || '';
    document.getElementById('cp-enabled').checked = coupon ? coupon.enabled : true;
    document.getElementById('coupon-modal-error').textContent = '';
    document.getElementById('coupon-modal').style.display = 'flex';
  }

  function editCoupon(coupon) { openCouponModal(coupon); }

  function closeCouponModal() {
    document.getElementById('coupon-modal').style.display = 'none';
    _editingCoupon = null;
  }

  async function saveCoupon() {
    const errEl = document.getElementById('coupon-modal-error');
    errEl.textContent = '';
    const payload = {
      code:          document.getElementById('cp-code').value.trim().toUpperCase(),
      name:          document.getElementById('cp-name').value.trim(),
      discount_type: document.querySelector('input[name="cp-type"]:checked').value,
      discount_value: parseFloat(document.getElementById('cp-value').value),
      valid_from:    document.getElementById('cp-from').value + 'T00:00:00Z',
      valid_until:   document.getElementById('cp-until').value + 'T23:59:59Z',
      max_uses:      parseInt(document.getElementById('cp-maxuses').value) || null,
      enabled:       document.getElementById('cp-enabled').checked
    };
    if (!payload.code || !payload.name || !payload.discount_value || !payload.valid_from || !payload.valid_until) {
      errEl.textContent = 'Please fill in all required fields.';
      return;
    }
    const token = (await _sb.auth.getSession()).data.session?.access_token;
    const method = _editingCoupon ? 'PUT' : 'POST';
    const res = await fetch('/api/admin/coupons', {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) { errEl.textContent = data.error; return; }
    closeCouponModal();
    loadCoupons();
  }

  async function deleteCoupon(code) {
    if (!confirm(`Delete coupon "${code}"?`)) return;
    const token = (await _sb.auth.getSession()).data.session?.access_token;
    await fetch(`/api/admin/coupons?code=${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    loadCoupons();
  }

  // ── Toggle expandable order detail row ────────────────
  function toggleOrderDetail(orderId) {
    const row = document.getElementById(`detail-${orderId}`);
    if (row) row.classList.toggle('hidden');
  }

  // ── Charts ────────────────────────────────────────────
  let _charts = {};

  function initCharts(statusCounts) {
    // Destroy existing charts first
    Object.values(_charts).forEach(c => c.destroy());
    _charts = {};

    const chartDefaults = {
      plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
      scales: {}
    };

    // 1. Revenue line chart — last 30 days
    const days = [];
    const revenueByDay = {};
    const countByDay   = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      days.push(d);
      revenueByDay[d] = 0;
      countByDay[d]   = 0;
    }
    _allOrders.filter(o => o.status !== 'cancelled').forEach(o => {
      const d = (o.created_at || '').slice(0, 10);
      if (revenueByDay[d] !== undefined) {
        revenueByDay[d] += Number(o.total_amount || 0);
        countByDay[d]   += 1;
      }
    });

    const shortDays = days.map(d => { const p = d.split('-'); return `${p[1]}/${p[2]}`; });

    _charts.revenue = new Chart(document.getElementById('chart-revenue'), {
      type: 'line',
      data: {
        labels: shortDays,
        datasets: [{
          label: 'Revenue ($)',
          data: days.map(d => revenueByDay[d]),
          borderColor: '#c8a96e',
          backgroundColor: 'rgba(200,169,110,.1)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        }, {
          label: 'Orders',
          data: days.map(d => countByDay[d]),
          borderColor: '#6366f1',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 2,
          tension: 0.3,
          yAxisID: 'y2'
        }]
      },
      options: {
        ...chartDefaults,
        scales: {
          x: { ticks: { color: '#555', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: '#1a1a1a' } },
          y: { ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + v }, grid: { color: '#1a1a1a' }, position: 'left' },
          y2: { ticks: { color: '#666', font: { size: 10 } }, grid: { display: false }, position: 'right' }
        }
      }
    });

    // 2. Status donut
    const statusLabels = Object.keys(statusCounts);
    const statusColors = { pending:'#f59e0b', in_production:'#3b82f6', shipped:'#8b5cf6', delivered:'#22c55e', cancelled:'#ef4444' };
    _charts.status = new Chart(document.getElementById('chart-status'), {
      type: 'doughnut',
      data: {
        labels: statusLabels.map(s => s.replace(/_/g,' ')),
        datasets: [{ data: statusLabels.map(s => statusCounts[s]), backgroundColor: statusLabels.map(s => statusColors[s] || '#555'), borderWidth: 0 }]
      },
      options: { ...chartDefaults, cutout: '65%' }
    });

    // 3. Items bar
    const itemAgg = {};
    _allOrders.filter(o => o.status !== 'cancelled').forEach(o => {
      (Array.isArray(o.items) ? o.items : []).forEach(i => {
        const key = i.typeLabel || i.type || 'Unknown';
        itemAgg[key] = (itemAgg[key] || 0) + 1;
      });
    });
    const itemEntries = Object.entries(itemAgg).sort((a,b) => b[1]-a[1]);
    _charts.items = new Chart(document.getElementById('chart-items'), {
      type: 'bar',
      data: {
        labels: itemEntries.map(e => e[0]),
        datasets: [{ label: 'Units Sold', data: itemEntries.map(e => e[1]), backgroundColor: '#c8a96e', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#555', font: { size: 10 } }, grid: { color: '#1a1a1a' } },
          y: { ticks: { color: '#888', font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }

  // ── Items Report ──────────────────────────────────────
  function buildItemsReport() {
    const agg = {}; // key → { qty, revenue }
    _allOrders.filter(o => o.status !== 'cancelled').forEach(o => {
      (Array.isArray(o.items) ? o.items : []).forEach(i => {
        const key = `${i.typeLabel||i.type}||${i.selectedSize||''}||${i.selectedColor||''}`;
        if (!agg[key]) agg[key] = { type: i.typeLabel||i.type, size: i.selectedSize||'', color: i.selectedColor||'', qty: 0, revenue: 0 };
        agg[key].qty++;
        agg[key].revenue += Number(i.price || 0);
      });
    });

    const rows = Object.values(agg).sort((a,b) => b.qty - a.qty);
    const tbody = document.getElementById('items-report-body');
    const section = document.getElementById('items-report');

    if (rows.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${r.type}</td><td style="color:#888">${r.size}</td>
        <td style="color:#888">${r.color}</td>
        <td class="qty">${r.qty}</td>
        <td style="color:#c8a96e">$${r.revenue.toFixed(2)}</td>
      </tr>`).join('');
  }

  // ══ PRODUCTS ══════════════════════════════════════════
  let _allProducts = [];
  let _productsGender = 'all';

  function _gelatoUrl(type, gender) {
    const w = gender === 'women';
    if (type === 'tshirt')     return w ? 'https://www.gelato.com/custom/womens-clothing/t-shirts/classic-womens-crewneck-t-shirt' : 'https://www.gelato.com/custom/brands/gildan/classic-unisex-crewneck-t-shirt-gildan-64000';
    if (type === 'hoodie')     return w ? 'https://www.gelato.com/custom/womens-clothing/hoodies' : 'https://www.gelato.com/custom/brands/gildan/classic-unisex-pullover-hoodie-gildan-18500';
    if (type === 'ziphoodie')  return 'https://www.gelato.com/custom/mens-clothing/hoodies/classic-unisex-zip-hoodie';
    if (type === 'longsleeve') return w ? 'https://www.gelato.com/custom/womens-clothing/long-sleeve-shirts' : 'https://www.gelato.com/custom/mens-clothing/long-sleeve-shirts';
    if (type === 'cap')        return 'https://www.gelato.com/custom/hats/dad-hats';
    return 'https://www.gelato.com/custom';
  }

  function _gelatoCost(type) {
    return { tshirt: 12.50, hoodie: 24.00, ziphoodie: 28.00, longsleeve: 15.00, cap: 12.00 }[type] || null;
  }

  async function loadProducts() {
    const loadingEl = document.getElementById('products-loading');
    const gridEl    = document.getElementById('products-grid');
    loadingEl.style.display = '';
    gridEl.innerHTML = '';

    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;

    try {
      if (typeof products === 'undefined' || !products.length) throw new Error('products.js לא נטען');
      _allProducts = products.map(p => ({ ...p, gelatoUrl: _gelatoUrl(p.type, p.gender), gelatoCost: _gelatoCost(p.type) }));
    } catch (err) {
      loadingEl.textContent = 'Error loading catalog: ' + err.message;
      return;
    }

    loadingEl.style.display = 'none';
    renderProductCards();
    renderProductsWithPrices(_allProducts);
  }

  function filterProductCards(gender, btn) {
    _productsGender = gender;
    document.querySelectorAll('.gender-filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderProductCards();
  }

  function renderProductCards() {
    const grid = document.getElementById('products-grid');
    const filtered = _productsGender === 'all'
      ? _allProducts
      : _allProducts.filter(p => p.gender === _productsGender);

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty">No products found.</div>';
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const genderClass = `gender-${p.gender}`;
      const genderLabel = { unisex: 'Unisex', men: 'Men', women: 'Women' }[p.gender] || p.gender;
      const uid = p.baseUid || '';

      // ── Color swatches + front/back toggle ──
      const _colorCss = {
        'Black':'#1a1a1a','White':'#f5f5f5','Cream':'#f5e6c8','Navy':'#1b2a4a',
        'Gray':'#9e9e9e','Red':'#c0392b','Forest Green':'#2d5a27','Charcoal':'#4a4a4a',
        'Honey Brown':'#c8853a','Sand':'#d4b896','Sports Grey':'#b0b0b0'
      };
      const _defaultColor = (p.colors && p.colors.length > 0) ? p.colors[0] : 'Black';
      const _c2f = c => c.replace(/\s+/g, '-');
      const _defaultImg = `images/product-${p.id}-${_c2f(_defaultColor)}-front.jpg`;
      const _swatches = (p.colors || []).map((c, ci) => {
        const bg  = _colorCss[c] || '#888';
        const bdr = c === 'White' ? 'border:1px solid #555;' : '';
        return `<span class="color-swatch${ci===0?' active':''}" style="background:${bg};${bdr}" title="${c}" onclick="switchProductColor(${p.id},'${c}',this)"></span>`;
      }).join('');
      const cardImgHtml = `
        <div class="product-img-wrapper" style="position:relative">
          <img id="pimg-${p.id}" src="${_defaultImg}" class="product-preview-img" alt="${p.phrase}" loading="lazy"
               onerror="this.src='images/product-${p.id}.jpg';this.onerror=null">
          <div class="fb-toggle">
            <button class="fb-btn active" onclick="switchProductSide(${p.id},'front',this)">Front</button>
            <button class="fb-btn"        onclick="switchProductSide(${p.id},'back', this)">Back</button>
          </div>
        </div>
        <div class="color-swatches">${_swatches}</div>`;

      return `
      <div class="product-admin-card" data-gender="${p.gender}">
        ${cardImgHtml}
        <div class="product-admin-info">
          <div class="product-id-row">
            <span class="product-id">#${p.id} · ${p.typeLabel}</span>
            <span class="product-gender-badge ${genderClass}">${genderLabel}</span>
          </div>
          <div class="product-phrase">"${p.phrase}"</div>
          <div class="product-meta">$${p.price} · ${p.typeLabel}</div>
          <div class="product-uid" title="${uid}">${uid.split('_gqa')[0]}</div>
          <div class="profit-grid" id="profit-grid-${p.id}">
            <div class="cost-row">
              <span>Gelato cost</span>
              <span id="gc-${p.id}" class="cost-val">loading…</span>
            </div>
            <div class="cost-row">
              <span>Shipping est.</span>
              <span>~$12.87</span>
            </div>
            <div class="cost-row profit-row">
              <span>Profit</span>
              <span id="gp-${p.id}" class="profit-val">—</span>
            </div>
          </div>
          <div class="price-edit">
            <label>Price $</label>
            <input type="number" id="sp-${p.id}" value="${p.price}" min="1" max="999" step="0.5"
                   onchange="saveProductPrice(${p.id}, +this.value, this)" />
            <span class="price-save-status" id="ps-${p.id}">✓ saved</span>
          </div>
          <div class="product-actions">
            <button class="btn-sm" onclick="copyUid('${uid}', this)" title="Copy full UID">Copy UID</button>
            <a class="btn-sm" href="https://www.dubis.net/#product-${p.id}" target="_blank" rel="noopener" style="text-decoration:none">צפה באתר →</a>
            <a class="btn-gelato" href="${p.gelatoUrl || 'https://dashboard.gelato.com'}" target="_blank" rel="noopener">Gelato →</a>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function copyUid(uid, btn) {
    navigator.clipboard?.writeText(uid).then(() => {
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy UID', 1500); }
    }).catch(() => prompt('Copy this UID:', uid));
  }

  // ── Product card image helpers ─────────────────────────
  function switchProductColor(productId, color, swatchEl) {
    const card = swatchEl.closest('.product-admin-card');
    card.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatchEl.classList.add('active');
    const activeBtn = card.querySelector('.fb-btn.active');
    const side = activeBtn ? activeBtn.textContent.trim().toLowerCase() : 'front';
    const imgEl = document.getElementById('pimg-' + productId);
    if (!imgEl) return;
    const colorFile = color.replace(/\s+/g, '-');
    imgEl.src = `images/product-${productId}-${colorFile}-${side}.jpg`;
    imgEl.onerror = () => { imgEl.src = `images/product-${productId}.jpg`; imgEl.onerror = null; };
  }

  function switchProductSide(productId, side, btnEl) {
    const card = btnEl.closest('.product-admin-card');
    card.querySelectorAll('.fb-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    const activeSwatch = card.querySelector('.color-swatch.active');
    const color = activeSwatch ? activeSwatch.title : 'Black';
    const colorFile = color.replace(/\s+/g, '-');
    const imgEl = document.getElementById('pimg-' + productId);
    if (!imgEl) return;
    imgEl.src = `images/product-${productId}-${colorFile}-${side}.jpg`;
    imgEl.onerror = () => { imgEl.src = `images/product-${productId}.jpg`; imgEl.onerror = null; };
  }

  // ── Product Profit & Price Management ─────────────────
  const SHIPPING_EST = 12.87; // Gelato actual shipping to Israel (IL)
  let currentProducts = [];

  async function renderProductsWithPrices(products) {
    currentProducts = products;
    // Load price overrides from Supabase
    let priceMap = {};
    try {
      const { data: priceRows } = await _sb.from('product_prices').select('*');
      priceMap = Object.fromEntries((priceRows || []).map(r => [r.product_id, Number(r.selling_price)]));
    } catch (e) {}

    products.forEach(p => {
      const sell   = priceMap[p.id] || p.price;
      const cost   = p.gelatoCost != null ? p.gelatoCost : null;
      const profit = cost != null ? sell - cost : null; // shipping paid by customer separately
      const pct    = profit != null ? ((profit / sell) * 100).toFixed(0) : null;

      const spEl = document.getElementById(`sp-${p.id}`);
      if (spEl) spEl.value = sell.toFixed(2);

      const gcEl = document.getElementById(`gc-${p.id}`);
      if (gcEl) gcEl.textContent = cost != null ? `$${cost.toFixed(2)}` : '—';

      const gpEl = document.getElementById(`gp-${p.id}`);
      if (gpEl && profit != null) {
        gpEl.textContent = `$${profit.toFixed(2)} (${pct}%)`;
        gpEl.className = `profit-val ${profit >= 0 ? 'profit-positive' : 'profit-negative'}`;
      }
    });
  }

  async function saveProductPrice(productId, newPrice, inputEl) {
    if (!newPrice || newPrice < 1) return;
    try {
      const { error } = await _sb.from('product_prices').upsert({
        product_id: productId,
        selling_price: newPrice,
        updated_at: new Date().toISOString()
      });
      if (!error) {
        const statusEl = document.getElementById(`ps-${productId}`);
        if (statusEl) {
          statusEl.classList.add('visible');
          setTimeout(() => statusEl.classList.remove('visible'), 2000);
        }
        // Recalculate profit display
        const p = currentProducts.find(p => p.id === productId);
        if (p && p.gelatoCost != null) {
          const profit = newPrice - p.gelatoCost; // shipping paid by customer separately
          const pct = ((profit / newPrice) * 100).toFixed(0);
          const gpEl = document.getElementById(`gp-${productId}`);
          if (gpEl) {
            gpEl.textContent = `$${profit.toFixed(2)} (${pct}%)`;
            gpEl.className = `profit-val ${profit >= 0 ? 'profit-positive' : 'profit-negative'}`;
          }
        }
      }
    } catch (e) {}
  }

  // ── Analytics (Enhanced) ──────────────────────────────
  let _pageviewsChart = null;
  let _revenueChart = null;
  let _orderStatusChart = null;
  let _subsChart = null;
  let _analyticsData = null;

  const chartDefaults = {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 10, font: { size: 10 } }, grid: { color: '#1a1a1a' } },
      y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#1a1a1a' } }
    }
  };

  function fmtDate(d) { const p = d.split('-'); return `${p[1]}/${p[2]}`; }

  async function loadAnalytics() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    try {
      const res = await fetch('/api/admin/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _analyticsData = data;

      // ── TRAFFIC ──
      document.getElementById('av-total').textContent = (data.totalViews || 0).toLocaleString();
      document.getElementById('av-today').textContent = (data.todayViews || 0).toLocaleString();
      const monthTotal = (data.viewsPerDay || []).reduce((s,d) => s + d.views, 0);
      document.getElementById('av-month').textContent = monthTotal.toLocaleString();

      // 7-day trend
      const trend = data.viewsTrend || {};
      document.getElementById('av-trend').textContent = (trend.current || 0).toLocaleString();
      if (trend.previous > 0) {
        const pct = Math.round(((trend.current - trend.previous) / trend.previous) * 100);
        const el = document.getElementById('av-trend-pct');
        el.className = pct >= 0 ? 'trend-up' : 'trend-down';
        el.textContent = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% מול שבוע קודם`;
      }

      // Page views chart
      if (_pageviewsChart) _pageviewsChart.destroy();
      const labels = (data.viewsPerDay || []).map(d => fmtDate(d.date));
      const values = (data.viewsPerDay || []).map(d => d.views);
      _pageviewsChart = new Chart(document.getElementById('chart-pageviews'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Page Views', data: values, backgroundColor: 'rgba(200,169,110,.6)', borderRadius: 3 }] },
        options: chartDefaults
      });

      // Top pages
      const maxViews = (data.topPages?.[0]?.views || 1);
      document.getElementById('top-pages-body').innerHTML = (data.topPages || []).map(p => `
        <tr>
          <td style="font-family:monospace;font-size:.8rem;color:#aaa">${p.path}</td>
          <td style="color:#c8a96e;font-weight:600">${p.views}</td>
          <td><div class="page-bar" style="width:${Math.round(p.views/maxViews*100)}%"></div></td>
        </tr>`).join('');

      // Referrers
      const maxRef = (data.topReferrers?.[0]?.count || 1);
      document.getElementById('referrers-body').innerHTML = (data.topReferrers || []).map(r => `
        <tr>
          <td style="font-size:.82rem;color:#aaa">${r.source}</td>
          <td style="color:#c8a96e;font-weight:600">${r.count}</td>
          <td><div class="page-bar" style="width:${Math.round(r.count/maxRef*100)}%"></div></td>
        </tr>`).join('');

      // ── SALES ──
      document.getElementById('av-orders').textContent = (data.totalOrders || 0).toLocaleString();
      document.getElementById('av-revenue').textContent = '$' + (data.totalRevenue || 0).toLocaleString();
      document.getElementById('av-aov').textContent = '$' + (data.avgOrderValue || 0).toFixed(2);
      document.getElementById('av-conversion').textContent = (data.conversionRate || 0) + '%';

      // Revenue chart
      if (_revenueChart) _revenueChart.destroy();
      const revLabels = (data.revenuePerDay || []).map(d => fmtDate(d.date));
      const revValues = (data.revenuePerDay || []).map(d => d.revenue);
      _revenueChart = new Chart(document.getElementById('chart-revenue-30'), {
        type: 'line',
        data: {
          labels: revLabels,
          datasets: [{
            label: 'Revenue ($)',
            data: revValues,
            borderColor: '#c8a96e',
            backgroundColor: 'rgba(200,169,110,.15)',
            fill: true,
            tension: .3,
            pointRadius: 2
          }]
        },
        options: chartDefaults
      });

      // Best sellers
      document.getElementById('bestsellers-body').innerHTML = (data.bestSellers || []).map(p => `
        <tr>
          <td style="font-size:.82rem;color:#aaa">${p.name}</td>
          <td style="color:#c8a96e;font-weight:600">${p.qty}</td>
          <td style="color:#4caf50;font-weight:600">$${p.revenue}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:#555;text-align:center;padding:1rem">אין הזמנות עדיין</td></tr>';

      // Order status doughnut
      if (_orderStatusChart) _orderStatusChart.destroy();
      const statusMap = data.ordersByStatus || {};
      const statusLabels = Object.keys(statusMap);
      const statusValues = Object.values(statusMap);
      const statusColors = { pending: '#ff9800', in_production: '#2196f3', shipped: '#9c27b0', delivered: '#4caf50', cancelled: '#e74c3c' };
      const statusHebrew = { pending: 'ממתין', in_production: 'בייצור', shipped: 'נשלח', delivered: 'נמסר', cancelled: 'בוטל' };
      _orderStatusChart = new Chart(document.getElementById('chart-order-status'), {
        type: 'doughnut',
        data: {
          labels: statusLabels.map(s => statusHebrew[s] || s.replace('_', ' ')),
          datasets: [{ data: statusValues, backgroundColor: statusLabels.map(s => statusColors[s] || '#666'), borderWidth: 0 }]
        },
        options: {
          plugins: { legend: { display: true, position: 'right', labels: { color: '#888', font: { size: 11 } } } },
          cutout: '60%'
        }
      });

      // ── MARKETING ──
      document.getElementById('av-subs').textContent = (data.totalSubscribers || 0).toLocaleString();
      document.getElementById('av-subs-recent').textContent = `+${data.recentSubscribers || 0} החודש`;
      document.getElementById('av-reviews').textContent = (data.totalReviews || 0).toLocaleString();
      document.getElementById('av-reviews-pending').textContent = `${data.pendingReviews || 0} ממתינות`;
      document.getElementById('av-avg-rating').textContent = data.avgRating > 0 ? `${'★'.repeat(Math.round(data.avgRating))} ${data.avgRating}` : 'אין ביקורות';

      // Subscribers chart
      if (_subsChart) _subsChart.destroy();
      const subLabels = (data.subscribersPerDay || []).map(d => fmtDate(d.date));
      const subValues = (data.subscribersPerDay || []).map(d => d.count);
      _subsChart = new Chart(document.getElementById('chart-subs-30'), {
        type: 'bar',
        data: { labels: subLabels, datasets: [{ label: 'New Subscribers', data: subValues, backgroundColor: 'rgba(76,175,80,.6)', borderRadius: 3 }] },
        options: chartDefaults
      });

      // Coupon stats
      document.getElementById('coupon-stats-body').innerHTML = (data.couponStats || []).map(c => `
        <tr>
          <td style="font-family:monospace;font-size:.82rem;color:#c8a96e;font-weight:600">${c.code}</td>
          <td style="color:#aaa">${c.orderUses || c.uses || 0}</td>
          <td style="color:#e74c3c">${c.discountTotal > 0 ? '-$' + c.discountTotal : '—'}</td>
          <td><span style="color:${c.enabled ? '#4caf50' : '#e74c3c'};font-size:.75rem">${c.enabled ? 'פעיל' : 'כבוי'}</span></td>
        </tr>`).join('') || '<tr><td colspan="4" style="color:#555;text-align:center;padding:1rem">אין קופונים</td></tr>';

      // ── GOALS & GROWTH ──
      loadGoalsAndSocial(data);

    } catch(e) {
      console.error('Analytics error:', e);
    }
  }

  async function loadGoalsAndSocial(analyticsData) {
    // Revenue goal tracking
    const monthlyRevenue = analyticsData.totalRevenue || 0;
    const goalTarget = 1000;
    const goalPct = Math.min(100, Math.round((monthlyRevenue / goalTarget) * 100));
    document.getElementById('goal-fill').style.width = goalPct + '%';
    document.getElementById('goal-pct-text').textContent = goalPct + '%';
    document.getElementById('goal-amt').textContent = `$${monthlyRevenue.toLocaleString()} / $${goalTarget.toLocaleString()}`;

    // Budget tracking — from ad_campaigns in DB (ILS converted to USD at 3.7)
    const adBudget    = analyticsData.adBudgetUSD    || 0;
    const adSpent     = analyticsData.adSpentUSD     || 0;
    const adRemaining = analyticsData.adRemainingUSD !== undefined ? analyticsData.adRemainingUSD : adBudget;
    const roi = adBudget > 0 ? Math.round(((monthlyRevenue - adBudget) / adBudget) * 100) : 0;
    document.getElementById('budget-total').textContent     = '$' + adBudget.toFixed(2);
    document.getElementById('budget-spent').textContent     = '$' + adSpent.toFixed(2);
    document.getElementById('budget-remaining').textContent = '$' + adRemaining.toFixed(2);
    document.getElementById('budget-roi').textContent = adBudget > 0 ? roi + '%' : '—';

    // Social media stats from agent_tasks
    try {
      const { data: tasks, error: tasksErr } = await window._supabase.from('agent_tasks').select('id,status,title,content_data,due_date,created_at').order('created_at', { ascending: false });
      if (tasksErr) console.error('agent_tasks query error:', tasksErr);
      if (tasks) {
        const published = tasks.filter(t => t.status === 'done');
        const pending = tasks.filter(t => t.status === 'pending_approval');
        const approved = tasks.filter(t => t.status === 'approved');
        const backlog = tasks.filter(t => t.status === 'backlog');

        document.getElementById('ig-posts-count').textContent = published.length;
        document.getElementById('ig-posts-pending').textContent = pending.length;
        document.getElementById('ig-posts-approved').textContent = approved.length;

        // Next post to publish — find earliest due_date among approved/pending
        const upcoming = [...approved, ...pending].filter(t => t.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
        if (upcoming.length > 0) {
          const nextDate = new Date(upcoming[0].due_date);
          const localStr = nextDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          document.getElementById('ig-next-post').textContent = localStr;
          document.getElementById('ig-next-post').style.color = '#4caf50';
        } else if (approved.length > 0) {
          document.getElementById('ig-next-post').textContent = approved.length + ' מוכנים לפרסום';
          document.getElementById('ig-next-post').style.color = '#4caf50';
        } else if (pending.length > 0) {
          document.getElementById('ig-next-post').textContent = pending.length + ' ממתינים לאישור';
          document.getElementById('ig-next-post').style.color = '#ff9800';
        } else {
          document.getElementById('ig-next-post').textContent = 'אין פוסטים מוכנים';
          document.getElementById('ig-next-post').style.color = '#e74c3c';
        }

        // Content calendar counts
        document.getElementById('cal-backlog').textContent = backlog.length;
        document.getElementById('cal-pending').textContent = pending.length;
        document.getElementById('cal-approved').textContent = approved.length;

        // Build 7-day calendar
        buildContentCalendar(tasks);
      }
    } catch(e) {
      console.error('Social stats error:', e);
    }
  }

  function buildContentCalendar(tasks) {
    const cal = document.getElementById('content-calendar');
    const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const today = new Date();
    let html = '';

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const isToday = i === 0;
      const dayName = dayNames[d.getDay()];
      const dayNum = d.getDate();

      // Find tasks scheduled for this day
      const dayTasks = tasks.filter(t => {
        if (t.due_date) return t.due_date.substring(0, 10) === dateStr;
        // Also show tasks by title pattern (e.g. "Week 8 — Tuesday")
        const dayOfWeek = d.toLocaleDateString('en', { weekday: 'long' });
        return t.title && t.title.includes(dayOfWeek) && (t.status === 'approved' || t.status === 'pending_approval');
      });

      html += `<div class="cal-day${isToday ? ' today' : ''}">
        <div class="cal-day-name">${dayName} ${dayNum}</div>`;

      if (dayTasks.length === 0) {
        html += `<div style="color:#333;font-size:.55rem;text-align:center;margin-top:.5rem">—</div>`;
      } else {
        dayTasks.slice(0, 2).forEach(t => {
          const cls = t.status === 'approved' ? 'cal-post' : 'cal-post pending-post';
          const label = (t.title || '').replace(/Instagram Week \d+ — \w+:\s*/, '').substring(0, 20);
          html += `<div class="${cls}" title="${t.title || ''}">${label || 'פוסט'}</div>`;
        });
        if (dayTasks.length > 2) {
          html += `<div style="color:#555;font-size:.5rem;text-align:center">+${dayTasks.length - 2} נוספים</div>`;
        }
      }
      html += '</div>';
    }
    cal.innerHTML = html;
  }

  // ── Reviews Management ──────────────────────────────
  let _allReviews = [];

  async function loadReviews() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    try {
      const res = await fetch('/api/admin/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _allReviews = data.reviews || [];
      renderReviews(_allReviews);
      document.getElementById('reviews-loading').style.display = 'none';
    } catch(e) {
      console.error('Reviews load error:', e);
      document.getElementById('reviews-loading').textContent = 'Error loading reviews.';
    }
  }

  function filterReviews() {
    const filter = document.getElementById('reviews-filter').value;
    let filtered = _allReviews;
    if (filter === 'pending') filtered = _allReviews.filter(r => !r.approved);
    else if (filter === 'approved') filtered = _allReviews.filter(r => r.approved);
    else if (filter === 'featured') filtered = _allReviews.filter(r => r.featured);
    renderReviews(filtered);
  }

  function renderReviews(reviews) {
    const list = document.getElementById('reviews-list');
    document.getElementById('reviews-count').textContent = `${reviews.length} ביקורות`;

    if (reviews.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:#555;padding:2rem">אין ביקורות עדיין. ביקורות מלקוחות יופיעו כאן לאישור.</div>';
      return;
    }

    list.innerHTML = reviews.map(r => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      const date = new Date(r.created_at).toLocaleDateString('en-GB');
      const statusClass = r.approved ? 'approved-review' : 'pending';
      const statusBadge = r.approved
        ? '<span style="color:#4caf50;font-size:.7rem">✓ מאושר</span>'
        : '<span style="color:#ff9800;font-size:.7rem">⏳ ממתין</span>';
      const featuredBadge = r.featured ? ' <span style="color:#1565c0;font-size:.7rem">⭐ מומלץ</span>' : '';
      const verifiedBadge = r.verified_purchase ? ' <span style="color:#9c27b0;font-size:.7rem">✓ רכישה מאומתת</span>' : '';

      return `
        <div class="review-card ${statusClass}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span class="review-stars">${stars}</span>
              ${r.title ? `<strong style="color:#e8e0d5;margin-left:.5rem">${r.title}</strong>` : ''}
            </div>
            <div>${statusBadge}${featuredBadge}${verifiedBadge}</div>
          </div>
          <div class="review-meta">${r.reviewer_name} · ${r.product_name} · ${date}${r.reviewer_email ? ` · ${r.reviewer_email}` : ''}</div>
          ${r.body ? `<div class="review-body">${r.body}</div>` : ''}
          <div class="review-actions">
            ${!r.approved ? `<button class="btn-approve-review" onclick="updateReview('${r.id}', {approved:true})">✓ אשר</button>` : `<button class="btn-reject-review" onclick="updateReview('${r.id}', {approved:false})">✕ בטל אישור</button>`}
            ${!r.featured ? `<button class="btn-feature-review" onclick="updateReview('${r.id}', {featured:true})">⭐ הדגש</button>` : `<button style="background:#555;color:#fff;font-size:.72rem;padding:.3rem .7rem;border-radius:4px;cursor:pointer;border:none" onclick="updateReview('${r.id}', {featured:false})">בטל הדגשה</button>`}
            <button style="background:#c62828;color:#fff;font-size:.72rem;padding:.3rem .7rem;border-radius:4px;cursor:pointer;border:none" onclick="deleteReview('${r.id}')">🗑 מחק</button>
          </div>
        </div>`;
    }).join('');
  }

  async function updateReview(id, updates) {
    try {
      updates.updated_at = new Date().toISOString();
      const { error } = await _sb.from('product_reviews').update(updates).eq('id', id);
      if (error) throw error;
      // Refresh
      const idx = _allReviews.findIndex(r => r.id === id);
      if (idx >= 0) Object.assign(_allReviews[idx], updates);
      filterReviews();
    } catch(e) {
      alert('שגיאה בעדכון ביקורת: ' + e.message);
    }
  }

  async function deleteReview(id) {
    if (!confirm('למחוק את הביקורת הזו לצמיתות?')) return;
    try {
      const { error } = await _sb.from('product_reviews').delete().eq('id', id);
      if (error) throw error;
      _allReviews = _allReviews.filter(r => r.id !== id);
      filterReviews();
    } catch(e) {
      alert('שגיאה במחיקת ביקורת: ' + e.message);
    }
  }


  const AGENT_LABELS = {
    boss:'👑 Boss', cto:'💻 CTO', marketing:'📢 Marketing',
    content:'✍️ Content', design:'🎨 Design', supply:'📦 Supply',
    email_monitor:'📧 Email Monitor', site_audit:'🔍 Site Audit', manual:'👤 Manual'
  };
  const PRIORITY_ICONS = { critical:'🔴', high:'🟠', medium:'🟡', low:'⚪' };
  let _publishState = { taskId: null, token: null };

  async function loadTasks() {
    if (!window._supabase) return;
    const status   = document.getElementById('tasks-filter-status')?.value   || '';
    const agent    = document.getElementById('tasks-filter-agent')?.value    || '';
    const priority = document.getElementById('tasks-filter-priority')?.value || '';
    const search   = document.getElementById('tasks-search')?.value?.trim()  || '';

    let q = window._supabase.from('agent_tasks').select('*').order('created_at', { ascending: false });
    if (status)   q = q.eq('status', status);
    if (agent)    q = q.eq('agent_id', agent);
    if (priority) q = q.eq('priority', priority);
    if (search)   q = q.ilike('title', `%${search}%`);

    const { data: tasks, error } = await q;
    if (error) { console.error('Tasks load error:', error); return; }
    renderKanban(tasks || []);
    renderTaskStats(tasks || []);
  }

  function renderKanban(tasks) {
    ['backlog','pending_approval','approved','in_progress','done'].forEach(col => {
      const el = document.getElementById(`col-${col}`);
      if (!el) return;
      const header = el.querySelector('.kanban-col-header').outerHTML;
      const colTasks = tasks.filter(t => t.status === col);
      // Set innerHTML first, then update count (otherwise the old header overwrites the count)
      el.innerHTML = header + colTasks.map(t => renderTaskCard(t)).join('');
      const countEl = document.getElementById(`count-${col}`);
      if (countEl) countEl.textContent = colTasks.length;
    });
  }

  function renderTaskCard(t) {
    const isPending    = t.status === 'pending_approval';
    const isActive     = t.status === 'in_progress';
    const isApproved   = t.status === 'approved';
    const isContent    = t.agent_id === 'content';
    const imgUrl       = t.content_data?.generated_image_url || '';
    const captionHe    = t.content_data?.caption_he || '';
    const isReadyToPublish = isApproved && t.content_data?.content_approved;
    const isWaitingAgent   = isApproved && !t.content_data?.content_approved;

    const actions = isPending
      ? `<div class="task-card-actions">
           ${isContent
             ? `<button class="btn-approve" onclick="openPostPreview('${t.id}');event.stopPropagation()">👁 צפה ואשר</button>`
             : `<button class="btn-approve" onclick="updateTaskStatus('${t.id}','approved','pending_approval');event.stopPropagation()">✓ Approve</button>`
           }
           <button class="btn-reject" onclick="updateTaskStatus('${t.id}','rejected','pending_approval');event.stopPropagation()">✕ Reject</button>
         </div>`
      : isReadyToPublish
      ? `<div class="task-card-actions">
           <button class="btn-approve" style="background:#1d4ed8" onclick="openPostPreview('${t.id}');event.stopPropagation()">📤 פרסם</button>
         </div>`
      : isWaitingAgent
      ? `<div class="task-card-actions">
           <button class="btn-approve" style="background:#1d4ed8" onclick="openPostPreview('${t.id}');event.stopPropagation()">📤 פרסם</button>
         </div>`
      : isActive
      ? `<div class="task-card-actions">
           <button class="btn-done" onclick="updateTaskStatus('${t.id}','done');event.stopPropagation()">✓ Done</button>
         </div>`
      : '';

    const imgThumb = (isContent && imgUrl)
      ? `<img class="tc-img" src="${escHtml(imgUrl)}" loading="lazy" onerror="this.style.display='none'">`
      : '';
    const captionSnip = (isContent && captionHe)
      ? `<div class="tc-caption">${escHtml(captionHe)}</div>`
      : '';

    return `
      <div class="task-card priority-${t.priority}" onclick="openTaskDetail('${t.id}')">
        ${imgThumb}
        <div class="task-card-title">${PRIORITY_ICONS[t.priority]||''} ${escHtml(t.title)}</div>
        ${captionSnip}
        <div class="task-card-meta">
          <span class="task-badge agent">${AGENT_LABELS[t.agent_id]||t.agent_id}</span>
          ${t.category?`<span class="task-badge cat">${t.category}</span>`:''}
          <span class="task-badge">${formatDate(t.created_at)}</span>
        </div>
        ${actions}
      </div>`;
  }

  function renderTaskStats(tasks) {
    const stats = [
      { label:'Backlog',          num: tasks.filter(t=>t.status==='backlog').length },
      { label:'Pending Approval', num: tasks.filter(t=>t.status==='pending_approval').length },
      { label:'✅ Approved',       num: tasks.filter(t=>t.status==='approved').length },
      { label:'In Progress',      num: tasks.filter(t=>t.status==='in_progress').length },
      { label:'Done this week',   num: tasks.filter(t=>t.status==='done'&&isThisWeek(t.updated_at)).length },
    ];
    const el = document.getElementById('tasks-stats');
    if (el) el.innerHTML = stats.map(s=>`
      <div class="tasks-stat-card">
        <div class="tasks-stat-num">${s.num}</div>
        <div class="tasks-stat-label">${s.label}</div>
      </div>`).join('');
  }

  async function updateTaskStatus(id, newStatus, fromStatus) {
    const update = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'approved') update.approved_at = new Date().toISOString();

    // אם מאשרים תוכן שסוכן יצר (pending_approval → approved),
    // מסמנים content_approved=true כדי שה-agents לא ירימו את המשימה שוב
    if (newStatus === 'approved' && fromStatus === 'pending_approval') {
      const { data: task } = await window._supabase.from('agent_tasks').select('content_data').eq('id', id).single();
      const cd = task?.content_data || {};
      update.content_data = { ...cd, content_approved: true };
    }

    const { error } = await window._supabase.from('agent_tasks').update(update).eq('id', id);
    if (error) { alert('Update failed: ' + error.message); return; }
    loadTasks();
  }

  async function openTaskDetail(id) {
    const { data, error } = await window._supabase.from('agent_tasks').select('*').eq('id', id).single();
    if (error || !data) return;
    const modal = document.getElementById('task-detail-modal');
    document.getElementById('task-detail-content').innerHTML = `
      <h3>${PRIORITY_ICONS[data.priority]||''} ${escHtml(data.title)}</h3>
      <div style="margin:.5rem 0;display:flex;gap:.4rem;flex-wrap:wrap">
        <span class="task-badge agent">${AGENT_LABELS[data.agent_id]||data.agent_id}</span>
        <span class="task-badge">${data.status}</span>
        ${data.category?`<span class="task-badge cat">${data.category}</span>`:''}
        <span class="task-badge">${PRIORITY_ICONS[data.priority]||''} ${data.priority}</span>
      </div>
      ${data.description?`<p style="font-size:.85rem;color:#bbb;margin:.8rem 0;line-height:1.6">${escHtml(data.description)}</p>`:''}
      ${data.content_data&&Object.keys(data.content_data).length
        ?`<pre style="background:#111;border-radius:6px;padding:1rem;font-size:.75rem;color:#aaa;white-space:pre-wrap;word-break:break-word;margin-top:.8rem">${JSON.stringify(data.content_data,null,2)}</pre>`:''}
      <div style="margin-top:1.2rem;display:flex;gap:.6rem;flex-wrap:wrap">
        ${data.status==='pending_approval'?`
          <button class="btn-approve" style="flex:1" onclick="updateTaskStatus('${data.id}','approved','pending_approval');closeTaskDetail()">✓ אשר תוכן</button>
          <button class="btn-reject"  style="flex:1" onclick="updateTaskStatus('${data.id}','rejected','pending_approval');closeTaskDetail()">✕ דחה</button>`:''}
        ${data.status==='approved'?`
          <button class="btn-approve" style="flex:1;background:#7c3aed" onclick="openPublishModal('${data.id}',\`${(data.description||data.title).replace(/`/g,"'")}\`)">📤 פרסם</button>
          <button class="btn-done" style="flex:1" onclick="updateTaskStatus('${data.id}','done');closeTaskDetail()">✓ סמן בוצע</button>`:''}
        ${data.status==='backlog'?`
          <button class="btn-approve" style="flex:1;background:#3b82f6" onclick="updateTaskStatus('${data.id}','in_progress');closeTaskDetail()">→ התחל</button>`:''}
        ${data.status==='in_progress'?`
          <button class="btn-approve" style="flex:1;background:#7c3aed" onclick="openPublishModal('${data.id}',\`${(data.description||data.title).replace(/`/g,"'")}\`)">📤 פרסם</button>
          <button class="btn-done" style="flex:1" onclick="updateTaskStatus('${data.id}','done');closeTaskDetail()">✓ סמן בוצע</button>`:''}
        ${data.status==='done'?`
          <button class="btn-approve" style="flex:1;background:#374151" onclick="updateTaskStatus('${data.id}','in_progress');closeTaskDetail()">↩ In Progress</button>
          <button class="btn-approve" style="flex:1;background:#1f2937" onclick="updateTaskStatus('${data.id}','backlog');closeTaskDetail()">↩ Backlog</button>`:''}
      </div>
      ${data.notes?`<p style="font-size:.75rem;color:#666;margin-top:.6rem;font-style:italic">${escHtml(data.notes)}</p>`:''}
      <p style="font-size:.7rem;color:#444;margin-top:.8rem">Created: ${formatDate(data.created_at)}</p>`;
    modal.classList.add('open');
  }

  function closeTaskDetail() {
    document.getElementById('task-detail-modal').classList.remove('open');
  }

  async function openPublishModal(taskId, captionHint) {
    const { data: { session } } = await _sb.auth.getSession();
    _publishState.token  = session?.access_token;
    _publishState.taskId = taskId;

    // Reset form
    document.getElementById('pm-image-url').value = '';
    document.getElementById('pm-caption').value   = '';
    document.getElementById('pm-error').style.display = 'none';
    document.getElementById('pm-submit-btn').disabled = false;
    document.getElementById('pm-submit-btn').textContent = '📤 פרסם';
    document.getElementById('pm-gen-btn').disabled = false;
    document.getElementById('pm-img-loading').style.display = 'none';
    updateImagePreview('');
    updateCharCount();

    // Pre-fill from task content_data
    try {
      const { data } = await window._supabase.from('agent_tasks')
        .select('content_data').eq('id', taskId).single();
      if (data?.content_data) {
        const cd = data.content_data;
        const parts = [];
        if (cd.caption_he) parts.push(cd.caption_he);
        if (cd.caption_en) parts.push(cd.caption_en);
        if (cd.hashtags)   parts.push(cd.hashtags);
        if (parts.length) {
          document.getElementById('pm-caption').value = parts.join('\n\n');
          updateCharCount();
        }
        if (cd.generated_image_url) {
          document.getElementById('pm-image-url').value = cd.generated_image_url;
          updateImagePreview(cd.generated_image_url);
        }
      }
    } catch(e) {}

    if (!document.getElementById('pm-caption').value && captionHint) {
      document.getElementById('pm-caption').value = captionHint;
      updateCharCount();
    }

    document.getElementById('publish-modal-overlay').classList.add('open');
  }

  function closePublishModal() {
    document.getElementById('publish-modal-overlay').classList.remove('open');
  }

  function updateImagePreview(url) {
    const img = document.getElementById('pm-preview-img');
    const ph  = document.getElementById('pm-placeholder');
    // Clear stale handlers first, then hide
    img.onload  = null;
    img.onerror = null;
    img.style.display = 'none';
    if (url && url.startsWith('http')) {
      ph.style.display = 'flex';
      ph.textContent = '⏳ טוען תמונה... (עד 30 שניות)';
      img.onload = () => {
        img.style.display = 'block';
        ph.style.display  = 'none';
      };
      img.onerror = () => {
        img.style.display = 'none';
        ph.textContent = '⚠️ לא ניתן לטעון — הזן URL אחר';
      };
      img.src = url;
    } else {
      img.src = '';
      ph.textContent = 'אין תמונה — לחץ ייצר או הזן URL';
      ph.style.display = 'flex';
    }
  }

  function updateCharCount() {
    const val = document.getElementById('pm-caption').value;
    const el  = document.getElementById('pm-char-count');
    el.textContent = `${val.length} / 2200`;
    el.style.color = val.length > 2100 ? '#ef4444' : '#666';
  }

  async function generatePostImage() {
    const btn     = document.getElementById('pm-gen-btn');
    const loading = document.getElementById('pm-img-loading');
    const errEl   = document.getElementById('pm-error');
    btn.disabled  = true;
    loading.style.display = 'flex';
    errEl.style.display   = 'none';
    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=generate-image', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_publishState.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: _publishState.taskId })
      });
      const data = await res.json();
      if (data.image_url) {
        document.getElementById('pm-image-url').value = data.image_url;
        updateImagePreview(data.image_url);
      } else {
        errEl.textContent = 'שגיאה ביצירת תמונה: ' + (data.error || 'Unknown');
        errEl.style.display = 'block';
      }
    } catch(e) {
      errEl.textContent = 'שגיאת רשת: ' + e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      loading.style.display = 'none';
    }
  }

  async function submitPublish() {
    const imageUrl  = document.getElementById('pm-image-url').value.trim();
    const caption   = document.getElementById('pm-caption').value.trim();
    const instagram = document.getElementById('pm-platform-instagram').checked;
    const facebook  = document.getElementById('pm-platform-facebook').checked;
    const tiktok    = document.getElementById('pm-platform-tiktok').checked;
    const errEl     = document.getElementById('pm-error');
    errEl.style.display = 'none';

    if (!imageUrl) { errEl.textContent = 'נדרש URL של תמונה'; errEl.style.display='block'; return; }
    if (!caption)  { errEl.textContent = 'נדרש כיתוב';         errEl.style.display='block'; return; }
    if (!instagram && !facebook && !tiktok) {
      errEl.textContent = 'יש לבחור לפחות פלטפורמה אחת';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('pm-submit-btn');
    btn.disabled = true;
    btn.textContent = 'מפרסם...';

    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=publish', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_publishState.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption, image_url: imageUrl,
          task_id: _publishState.taskId,
          platforms: { instagram, facebook, tiktok }
        })
      });
      const data = await res.json();
      if (data.success) {
        const parts = [];
        if (data.instagram_post_id) parts.push('Instagram ✅');
        if (data.facebook_post_id)  parts.push('Facebook ✅');
        if (data.tiktok_note)       parts.push('TikTok ⚠️ '    + data.tiktok_note);
        if (data.errors?.length)    parts.push('⚠️ ' + data.errors.join(', '));
        // If Facebook failed but Instagram worked — show manual FB option
        if (data.facebook_manual_needed && data.instagram_post_id) {
          const fbCaption = encodeURIComponent(caption);
          const fbUrl = `https://www.facebook.com/dubis.100k/?sk=publish`;
          parts.push('\n📘 פייסבוק נכשל — לחץ אישור ואז שתף ידנית בעמוד הפייסבוק');
          alert('תוצאות פרסום:\n' + parts.join('\n'));
          window.open(fbUrl, '_blank');
          // Copy caption to clipboard for easy paste
          navigator.clipboard.writeText(caption).catch(()=>{});
        } else {
          alert('פורסם!\n' + parts.join('\n'));
        }
        closePublishModal();
        closeTaskDetail();
        loadTasks();
      } else {
        errEl.textContent = data.error || 'שגיאה לא ידועה';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '📤 פרסם';
      }
    } catch(e) {
      errEl.textContent = 'שגיאת רשת: ' + e.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '📤 פרסם';
    }
  }

  // ── Post Preview Modal ──────────────────────────────────────
  let _ppState = { taskId: null, token: null };

  async function openPostPreview(taskId) {
    const { data } = await window._supabase.from('agent_tasks').select('*').eq('id', taskId).single();
    if (!data) return;
    const cd = data.content_data || {};
    const { data: { session } } = await window._supabase.auth.getSession();
    _ppState = { taskId, token: session?.access_token, imageUrl: cd.generated_image_url || '' };

    document.getElementById('pp-title').textContent = data.title;

    const imgEl = document.getElementById('pp-img');
    const phEl  = document.getElementById('pp-img-ph');
    if (cd.generated_image_url) {
      imgEl.src = cd.generated_image_url;
      imgEl.style.display = 'block';
      phEl.style.display  = 'none';
    } else {
      imgEl.style.display = 'none';
      phEl.style.display  = 'block';
    }

    document.getElementById('pp-caption-text').textContent = [cd.caption_he, cd.caption_en].filter(Boolean).join('\n\n');
    document.getElementById('pp-hashtags-text').textContent = cd.hashtags || '';
    document.getElementById('pp-error').style.display = 'none';
    document.getElementById('pp-gen-img-status').textContent = '';
    document.getElementById('pp-gen-img-btn').disabled = false;
    const btn = document.getElementById('pp-approve-btn');
    btn.disabled = false;
    btn.textContent = '✅ אשר ופרסם';
    document.getElementById('pp-overlay').classList.add('open');

    // Trigger Smart Match for image recommendations
    const captionText = [cd.caption_he, cd.caption_en].filter(Boolean).join(' ');
    loadSmartMatch(captionText);
  }

  function closePP() {
    document.getElementById('pp-overlay').classList.remove('open');
  }

  async function approveAndPublish() {
    const { taskId, token } = _ppState;
    const { data: task } = await window._supabase.from('agent_tasks').select('content_data').eq('id', taskId).single();
    const cd = task?.content_data || {};

    // Use freshly-generated image (from generatePostImage) or the stored one
    const imageUrl = _ppState.imageUrl || cd.generated_image_url;
    if (!imageUrl) {
      document.getElementById('pp-error').textContent = 'אין תמונה — לחץ על "יצור תמונה" קודם';
      document.getElementById('pp-error').style.display = 'block';
      return;
    }

    const caption = [cd.caption_he, cd.caption_en, cd.hashtags].filter(Boolean).join('\n\n');
    const instagram = document.getElementById('pp-instagram').checked;
    const facebook  = document.getElementById('pp-facebook').checked;

    const btn = document.getElementById('pp-approve-btn');
    btn.disabled = true;
    btn.textContent = '⏳ מפרסם...';

    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=publish', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, caption, task_id: taskId, platforms: { instagram, facebook } })
      });
      const data = await res.json();
      if (data.success) {
        const parts = [];
        if (data.instagram_post_id) parts.push('Instagram ✅');
        if (data.facebook_post_id)  parts.push('Facebook ✅');
        alert('פורסם בהצלחה! ' + parts.join(' | '));
        closePP();
        closeTaskDetail();
        loadTasks();
      } else {
        document.getElementById('pp-error').textContent = data.error || (data.errors||[]).join('; ') || 'שגיאה לא ידועה';
        document.getElementById('pp-error').style.display = 'block';
        btn.disabled = false;
        btn.textContent = '✅ אשר ופרסם';
      }
    } catch(e) {
      document.getElementById('pp-error').textContent = 'שגיאת רשת: ' + e.message;
      document.getElementById('pp-error').style.display = 'block';
      btn.disabled = false;
      btn.textContent = '✅ אשר ופרסם';
    }
  }

  async function rejectPost() {
    const { taskId } = _ppState;
    await window._supabase.from('agent_tasks').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', taskId);
    closePP();
    loadTasks();
  }

  async function generatePostImage() {
    const { taskId, token } = _ppState;
    const btn    = document.getElementById('pp-gen-img-btn');
    const status = document.getElementById('pp-gen-img-status');
    btn.disabled = true;
    status.textContent = '⏳ מייצר תמונה… (עד 60 שניות)';
    try {
      const r = await fetch(`https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ task_id: taskId })
      });
      const d = await r.json();
      if (!r.ok || !d.image_url) throw new Error(d.error || 'שגיאה ביצירת תמונה');
      // Update state + UI
      _ppState.imageUrl = d.image_url;
      const img = document.getElementById('pp-img');
      const ph  = document.getElementById('pp-img-ph');
      img.src = d.image_url;
      img.style.display = 'block';
      ph.style.display  = 'none';
      status.textContent = '✅ תמונה מוכנה!';
      btn.disabled = false;
    } catch(e) {
      status.textContent = `❌ ${e.message}`;
      btn.disabled = false;
    }
  }

  function useRealPhoto(path) {
    if (!path) return;
    const fullUrl = 'https://www.dubis.net/' + path;
    _ppState.imageUrl = fullUrl;
    const img = document.getElementById('pp-img');
    const ph  = document.getElementById('pp-img-ph');
    img.src = fullUrl;
    img.style.display = 'block';
    ph.style.display  = 'none';
    document.getElementById('pp-gen-img-status').textContent = '✅ תמונה אמיתית של DUBIS';
    // Also update task content_data
    if (_ppState.taskId) {
      window._supabase.from('agent_tasks').select('content_data').eq('id', _ppState.taskId).single().then(({ data }) => {
        const cd = data?.content_data || {};
        cd.generated_image_url = fullUrl;
        window._supabase.from('agent_tasks').update({ content_data: cd, updated_at: new Date().toISOString() }).eq('id', _ppState.taskId);
      });
    }
    // Reset dropdown
    document.getElementById('pp-real-photo').selectedIndex = 0;
  }

  function openAddTaskModal() {
    document.getElementById('at-title').value       = '';
    document.getElementById('at-agent').value       = 'manual';
    document.getElementById('at-priority').value    = 'medium';
    document.getElementById('at-category').value    = 'manual';
    document.getElementById('at-status').value      = 'backlog';
    document.getElementById('at-description').value = '';
    document.getElementById('at-notes').value       = '';
    document.getElementById('at-due-date').value    = '';
    document.getElementById('at-error').style.display = 'none';
    document.getElementById('btn-submit-task').disabled = false;
    document.getElementById('add-task-overlay').classList.add('open');
    setTimeout(() => document.getElementById('at-title').focus(), 50);
  }

  function closeAddTaskModal() {
    document.getElementById('add-task-overlay').classList.remove('open');
  }

  async function submitAddTask() {
    const title    = document.getElementById('at-title').value.trim();
    const agent_id = document.getElementById('at-agent').value;
    const priority = document.getElementById('at-priority').value;
    const category = document.getElementById('at-category').value;
    const status   = document.getElementById('at-status').value;
    const description = document.getElementById('at-description').value.trim();
    const notes    = document.getElementById('at-notes').value.trim();
    const due_date = document.getElementById('at-due-date').value || null;
    const errEl    = document.getElementById('at-error');

    if (!title) {
      errEl.textContent = 'כותרת המשימה חובה';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('btn-submit-task');
    btn.disabled = true;
    btn.textContent = 'שומר...';
    errEl.style.display = 'none';

    const { error } = await window._supabase.from('agent_tasks').insert({
      title, agent_id, priority, status, category,
      description: description || null,
      notes: notes || null,
      due_date,
    });

    if (error) {
      errEl.textContent = 'שגיאה: ' + error.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '+ הוסף משימה';
    } else {
      closeAddTaskModal();
      loadTasks();
    }
  }

  async function runAgentTasks() {
    const btn = document.getElementById('btn-run-agents');
    if (btn.classList.contains('running')) return;
    btn.classList.add('running');
    btn.textContent = '⏳ מריץ...';

    const { data: { session: runSession } } = await _sb.auth.getSession();
    const token = runSession?.access_token;
    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.queued > 0) {
        alert(`✅ ${data.queued} משימות הועברו לביצוע.\n${data.summary || ''}`);
      } else {
        alert('אין משימות מאושרות הממתינות להרצה.');
      }
      loadTasks();
    } catch(e) {
      alert('שגיאה: ' + e.message);
    }

    btn.classList.remove('running');
    btn.textContent = '▶ הרץ סוכנים';
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit'});
  }
  function isThisWeek(iso) {
    if (!iso) return false;
    return (new Date() - new Date(iso)) / (1000*60*60*24) <= 7;
  }

  // ══ AGENTS SECTION ══════════════════════════════════════
  async function loadAgentsSection() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    try {
      const { data: tasks } = await _sb.from('agent_tasks').select('status,agent_id,created_at');
      const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
      document.getElementById('stat-approved').textContent   = (tasks||[]).filter(t=>t.status==='approved').length;
      document.getElementById('stat-done').textContent       = (tasks||[]).filter(t=>t.status==='done'&&new Date(t.created_at)>weekAgo).length;
      document.getElementById('stat-inprogress').textContent = (tasks||[]).filter(t=>t.status==='in_progress').length;
      document.getElementById('stat-pending').textContent    = (tasks||[]).filter(t=>t.status==='pending_approval').length;
      ['content','cto','marketing','supply'].forEach(ag => {
        const el = document.getElementById('agent-status-'+ag);
        if (!el) return;
        const count = (tasks||[]).filter(t=>t.agent_id===ag&&['approved','in_progress'].includes(t.status)).length;
        el.textContent = count > 0 ? count+' פעיל' : 'אין משימות';
        el.style.color = count > 0 ? '#ff9800' : '#4caf50';
      });
    } catch(e) { console.error('agents stats',e); }
    try {
      const { data: runs } = await _sb.from('agent_runs').select('*').order('created_at',{ascending:false}).limit(20);
      const list = document.getElementById('agents-runs-list');
      if (!runs||!runs.length) { list.innerHTML='<div style="color:#666;font-size:.85rem">עדיין לא רצו סוכנים</div>'; return; }
      const emoji = {content:'✍️',cto:'🔧',marketing:'📣',supply:'📦'};
      list.innerHTML = runs.map(r=>{
        const sc = r.status==='completed'?'#4caf50':r.status==='completed_with_errors'?'#ff9800':'#2196f3';
        return `<div style="background:#1a1a1a;border-radius:6px;padding:.7rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem">
          <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
            <span>${emoji[r.agent_id]||'🤖'}</span>
            <div style="min-width:0">
              <div style="color:#e8e0d5;font-size:.85rem;font-weight:600">${r.agent_id}</div>
              <div style="color:#888;font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:350px">${r.summary||''}</div>
            </div>
          </div>
          <div style="display:flex;gap:.6rem;align-items:center;flex-shrink:0">
            <span style="color:${sc};background:#0a0a0a;padding:.2rem .5rem;border-radius:4px;font-size:.75rem">${r.status}</span>
            <span style="color:#666;font-size:.75rem">${formatDate(r.created_at)}</span>
          </div>
        </div>`;
      }).join('');
    } catch(e) { console.error('agents runs',e); }
  }

  async function runAgent(agentId) {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return alert('לא מחובר');
    const btn = document.querySelector(`[onclick="runAgent('${agentId}')"]`);
    if (btn) { btn.disabled=true; btn.textContent='⏳...'; }
    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=run', {
        method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'שגיאה');
      alert('✅ '+agentId+' הסתיים\n'+(data.summary||data.queued+' משימות'));
      loadAgentsSection();
    } catch(e) { alert('שגיאה: '+e.message); }
    finally { if (btn) { btn.disabled=false; btn.textContent='▶ הרץ'; } }
  }

  // ══ CAMPAIGNS SECTION ═══════════════════════════════════
  async function loadCampaigns() {
    const wrap = document.getElementById('campaigns-table-wrap');
    try {
      const { data: campaigns, error } = await _sb
        .from('ad_campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) throw error;
      if (!campaigns || !campaigns.length) {
        wrap.innerHTML = '<div class="empty">אין קמפיינים עדיין</div>';
        return;
      }

      // Update stats
      const active   = campaigns.filter(c => c.status === 'active').length;
      const done     = campaigns.filter(c => c.status === 'completed').length;
      const budgetIL = campaigns.reduce((s, c) => s + Number(c.budget || 0), 0);
      const spendIL  = campaigns.reduce((s, c) => s + Number(c.spend_to_date || 0), 0);
      document.getElementById('cstat-active').textContent  = active;
      document.getElementById('cstat-done').textContent    = done;
      document.getElementById('cstat-budget').textContent  = '₪' + budgetIL.toFixed(0);
      document.getElementById('cstat-spend').textContent   = '₪' + spendIL.toFixed(2);

      // Build table
      const goalLabel = { website_visits:'Website visits', reach:'Reach', engagement:'Engagement', sales:'Sales', page_likes:'Page likes' };
      const rows = campaigns.map(c => {
        const statusCls = c.status === 'active' ? 'status-in_production' : c.status === 'completed' ? 'status-delivered' : 'status-pending';
        const statusLbl = c.status === 'active' ? '🟢 פעיל' : c.status === 'completed' ? '✅ הסתיים' : '⏸ מושהה';
        const endDate   = c.end_date ? new Date(c.end_date).toLocaleDateString('he-IL') : '—';
        const startDate = c.start_date ? new Date(c.start_date).toLocaleDateString('he-IL') : '—';
        const pct       = c.budget > 0 ? Math.round((Number(c.spend_to_date || 0) / Number(c.budget)) * 100) : 0;
        return `<tr>
          <td><span class="status-badge ${statusCls}">${statusLbl}</span></td>
          <td style="color:#c8a96e;font-weight:600">${c.platform}</td>
          <td>${goalLabel[c.goal] || c.goal}</td>
          <td style="color:#e8e0d5">₪${Number(c.budget).toFixed(0)} / ${c.duration_days} ימים</td>
          <td style="font-size:.8rem;color:#888;max-width:180px">${c.audience || '—'}</td>
          <td style="font-size:.8rem">${startDate} → ${endDate}</td>
          <td>
            <div style="display:flex;align-items:center;gap:.5rem">
              <div style="flex:1;height:6px;background:#2a2a2a;border-radius:3px;min-width:60px">
                <div style="height:6px;background:#c8a96e;border-radius:3px;width:${Math.min(pct,100)}%"></div>
              </div>
              <span style="color:#c8a96e;font-size:.78rem;font-weight:600">₪${Number(c.spend_to_date||0).toFixed(0)}</span>
            </div>
          </td>
          <td style="font-size:.78rem;color:#666">${c.payment_method || '—'}</td>
          <td>
            <button class="btn-sm" onclick="openUpdateSpend('${c.id}',${c.spend_to_date||0})">עדכן</button>
            <button class="btn-sm" style="margin-top:2px" onclick="toggleCampaignStatus('${c.id}','${c.status}')">
              ${c.status === 'active' ? 'סיים' : 'הפעל'}
            </button>
          </td>
        </tr>`;
      }).join('');

      wrap.innerHTML = `<table>
        <thead><tr>
          <th>סטטוס</th>
          <th>פלטפורמה</th>
          <th>מטרה</th>
          <th>תקציב / משך</th>
          <th>קהל</th>
          <th>תאריכים</th>
          <th>עלות עד היום</th>
          <th>תשלום</th>
          <th>פעולות</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    } catch(e) {
      wrap.innerHTML = `<div class="empty" style="color:#ef4444">שגיאה: ${e.message}</div>`;
    }
  }

  function openAddCampaignModal() {
    document.getElementById('c-start').value = new Date().toISOString().slice(0,10);
    document.getElementById('campaign-modal-error').textContent = '';
    document.getElementById('campaign-modal').style.display = 'flex';
  }

  function closeCampaignModal() {
    document.getElementById('campaign-modal').style.display = 'none';
  }

  async function saveCampaign() {
    const platform = document.getElementById('c-platform').value;
    const goal     = document.getElementById('c-goal').value;
    const budget   = parseFloat(document.getElementById('c-budget').value);
    const duration = parseInt(document.getElementById('c-duration').value);
    const audience = document.getElementById('c-audience').value.trim();
    const start    = document.getElementById('c-start').value;
    const payment  = document.getElementById('c-payment').value.trim();
    const notes    = document.getElementById('c-notes').value.trim();
    const errEl    = document.getElementById('campaign-modal-error');

    if (!budget || !duration || !start) { errEl.textContent = 'נא למלא תקציב, משך ותאריך'; return; }

    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + duration);

    const { error } = await _sb.from('ad_campaigns').insert({
      platform, goal, budget, duration_days: duration, audience, status: 'active',
      start_date: start, end_date: endDate.toISOString().slice(0,10),
      payment_method: payment, notes
    });

    if (error) { errEl.textContent = 'שגיאה: ' + error.message; return; }
    closeCampaignModal();
    _campaignsLoaded = false;
    loadCampaigns();
  }

  async function openUpdateSpend(id, current) {
    const spend = prompt(`עלות עד היום (₪) — נוכחי: ₪${current}:`, current);
    if (spend === null) return;
    const val = parseFloat(spend);
    if (isNaN(val)) return alert('ערך לא תקין');
    const { error } = await _sb.from('ad_campaigns').update({ spend_to_date: val }).eq('id', id);
    if (error) return alert('שגיאה: ' + error.message);
    _campaignsLoaded = false;
    loadCampaigns();
  }

  async function toggleCampaignStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'completed' : 'active';
    const { error } = await _sb.from('ad_campaigns').update({ status: newStatus }).eq('id', id);
    if (error) return alert('שגיאה: ' + error.message);
    _campaignsLoaded = false;
    loadCampaigns();
  }

  // ── Gallery Functions ─────────────────────────────────────
  let _galProducts = [];
  let _galImages = [];

  async function loadGalleryInit() {
    // Load products for filters
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=products-catalog', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      _galProducts = await res.json();
    } catch(e) { _galProducts = []; }

    // Fill product filter dropdown
    const sel = document.getElementById('gal-filter-product');
    sel.innerHTML = '<option value="">כל המוצרים</option>';
    _galProducts.forEach(p => {
      sel.innerHTML += `<option value="${p.id}">${p.slogan}</option>`;
    });

    // Fill generate modal product dropdown
    const genSel = document.getElementById('gen-product');
    genSel.innerHTML = '';
    _galProducts.forEach(p => {
      genSel.innerHTML += `<option value="${p.id}" data-colors='${JSON.stringify(p.colors||[])}'>${p.slogan} (${p.clothing_type})</option>`;
    });
    updateGenColors();
    genSel.addEventListener('change', updateGenColors);

    loadGallery();
  }

  function updateGenColors() {
    const sel = document.getElementById('gen-product');
    const opt = sel.options[sel.selectedIndex];
    const colors = JSON.parse(opt?.getAttribute('data-colors') || '[]');
    const cSel = document.getElementById('gen-color');
    cSel.innerHTML = '';
    if (colors.length === 0) {
      cSel.innerHTML = '<option value="black">שחור</option><option value="white">לבן</option>';
    } else {
      colors.forEach(c => {
        const heb = { black:'שחור', white:'לבן', navy:'כחול כהה', gray:'אפור', olive:'זית', beige:'בז\'', charcoal:'פחם', sand:'חולי', forest_green:'ירוק יער', burgundy:'בורדו', cream:'קרם', khaki:'חאקי', light_gray:'אפור בהיר', dark_gray:'אפור כהה' };
        cSel.innerHTML += `<option value="${c}">${heb[c] || c}</option>`;
      });
    }
  }

  async function loadGallery() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    const productId = document.getElementById('gal-filter-product').value;
    const status = document.getElementById('gal-filter-status').value;

    let url = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=product-images';
    if (productId) url += '&product_id=' + productId;
    if (status === 'approved') url += '&approved=true';
    if (status === 'pending') url += '&approved=false';

    const grid = document.getElementById('gal-grid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#555">⏳ טוען...</div>';

    try {
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      _galImages = Array.isArray(data) ? data : (data.images || []);

      document.getElementById('gal-count').textContent = `${_galImages.length} תמונות`;

      if (_galImages.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#555">אין תמונות עדיין. לחץ "ייצור תמונה חדשה" להתחלה! 🎨</div>';
        return;
      }

      grid.innerHTML = _galImages.map(img => {
        const product = img.dubis_products || img.product || {};
        const isApproved = img.approved;
        const stars = Array.from({length:5}, (_, i) =>
          `<span class="gal-star ${i < (img.quality_score||0) ? 'active' : ''}" onclick="rateImage('${img.id}',${i+1})">★</span>`
        ).join('');

        return `<div class="gal-card ${isApproved ? 'approved' : 'pending-img'}">
          <span class="gal-badge ${isApproved ? 'approved' : 'pending-badge'}">${isApproved ? '✅ מאושר' : '⏳ ממתין'}</span>
          <img class="gal-thumb" src="${img.image_url}" alt="${product.slogan||''}" onclick="window.open('${img.image_url}','_blank')" loading="lazy">
          <div class="gal-card-info">
            <div class="gal-card-slogan">${escHtml(product.slogan || 'לא ידוע')}</div>
            <div class="gal-card-meta">
              <span>${img.scene_type || '—'}</span>
              <span>${img.model_type || '—'}</span>
              <span>${img.color_variant || '—'}</span>
              <span>שימושים: ${img.times_used || 0}</span>
            </div>
            <div class="gal-quality">${stars}</div>
          </div>
          <div class="gal-card-actions">
            ${!isApproved ? `<button class="gal-btn gal-btn-approve" onclick="approveImage('${img.id}')">✅ אשר</button>` : ''}
            ${isApproved ? `<button class="gal-btn gal-btn-reject" onclick="rejectImage('${img.id}')">↩ בטל אישור</button>` : ''}
            <button class="gal-btn gal-btn-use" onclick="useGalleryImage('${img.image_url}')">📋 העתק URL</button>
            <button class="gal-btn gal-btn-del" onclick="deleteImage('${img.id}')">🗑</button>
          </div>
        </div>`;
      }).join('');
    } catch(e) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#e74c3c">שגיאה בטעינה: ${e.message}</div>`;
    }
  }

  async function approveImage(id) {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=product-images&id=' + id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true })
    });
    loadGallery();
  }

  async function rejectImage(id) {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=product-images&id=' + id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false })
    });
    loadGallery();
  }

  async function rateImage(id, score) {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=product-images&id=' + id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality_score: score })
    });
    loadGallery();
  }

  async function deleteImage(id) {
    if (!confirm('למחוק את התמונה? לא ניתן לשחזר.')) return;
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=product-images&id=' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    loadGallery();
  }

  function useGalleryImage(url) {
    navigator.clipboard.writeText(url).then(() => {
      alert('✅ URL הועתק ללוח!');
    }).catch(() => {
      prompt('העתק URL:', url);
    });
  }

  function openGenerateModal() {
    const modal = document.getElementById('gen-modal');
    modal.style.display = 'flex';
    document.getElementById('gen-preview').style.display = 'none';
    document.getElementById('gen-status').textContent = '';
    document.getElementById('gen-submit-btn').disabled = false;
    document.getElementById('gen-submit-btn').textContent = '🎨 ייצור';
  }

  function closeGenerateModal() {
    document.getElementById('gen-modal').style.display = 'none';
  }

  async function submitGenerate() {
    const btn = document.getElementById('gen-submit-btn');
    const statusEl = document.getElementById('gen-status');
    btn.disabled = true;
    btn.textContent = '⏳ מייצר... (עד 90 שניות)';
    statusEl.textContent = '🎨 Gemini מייצר את התמונה, אנא המתן...';

    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;

    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=generate-product-image', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: document.getElementById('gen-product').value,
          scene: document.getElementById('gen-scene').value,
          model: document.getElementById('gen-model').value,
          color: document.getElementById('gen-color').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה ביצירה');

      // Show preview
      document.getElementById('gen-preview').style.display = 'block';
      document.getElementById('gen-preview-img').src = data.image_url;
      statusEl.innerHTML = `✅ תמונה נוצרה בהצלחה! <a href="${data.image_url}" target="_blank" style="color:#c8a96e">פתח</a>`;
      btn.textContent = '🎨 ייצור נוספת';
      btn.disabled = false;

      // Refresh gallery
      loadGallery();
    } catch(e) {
      statusEl.textContent = '❌ ' + e.message;
      btn.textContent = '🎨 נסה שוב';
      btn.disabled = false;
    }
  }

  async function batchGenerate() {
    if (!confirm('להתחיל ייצור אצווה? ייווצרו 3 תמונות לכל מוצר (42 תמונות סה"כ).\nזה יקח זמן — להמשיך?')) return;

    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    const scenes = ['street','home','studio','nature','cafe','urban'];
    const models = ['man','large_man','woman','curvy_woman','couple','older_man'];

    let success = 0, fail = 0, total = _galProducts.length * 3;
    const statusEl = document.getElementById('gal-count');

    for (const product of _galProducts) {
      const colors = product.colors || ['black'];
      for (let i = 0; i < 3; i++) {
        statusEl.textContent = `⏳ מייצר ${success+fail+1}/${total}... (✅${success} ❌${fail})`;
        try {
          const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=generate-product-image', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: product.id,
              scene: scenes[Math.floor(Math.random() * scenes.length)],
              model: models[Math.floor(Math.random() * models.length)],
              color: colors[Math.floor(Math.random() * colors.length)]
            })
          });
          if (res.ok) success++;
          else fail++;
        } catch(e) { fail++; }
      }
    }
    statusEl.textContent = `✅ ייצור אצווה הסתיים: ${success} הצליחו, ${fail} נכשלו`;
    loadGallery();
  }

  // ── Smart Match for Post Preview ────────────────────────────
  async function loadSmartMatch(caption) {
    if (!caption || caption.length < 5) return;
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;

    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=smart-match', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption })
      });
      const matches = await res.json();
      if (!Array.isArray(matches) || matches.length === 0) return;

      // Update the real photo dropdown in post preview
      const sel = document.getElementById('pp-real-photo');
      // Keep first default option, then add matches
      sel.innerHTML = '<option value="">🤖 Smart Match — תמונות מומלצות...</option>';
      matches.forEach((m, i) => {
        const label = `${m.dubis_products?.slogan || 'תמונה'} (${m.scene_type||''}) — ציון: ${m.relevance_score?.toFixed(1)||'?'}`;
        sel.innerHTML += `<option value="${m.image_url}">${i+1}. ${label}</option>`;
      });

      // Also update publish modal dropdown if exists
      const pmUrl = document.getElementById('pm-image-url');
      if (pmUrl && !pmUrl.value) {
        // Auto-suggest first match
        pmUrl.value = matches[0].image_url;
        updateImagePreview(matches[0].image_url);
      }
    } catch(e) { console.log('Smart match error:', e); }
  }

  async function runAllAgents() {
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return alert('לא מחובר');
    if (!confirm('להריץ את כל הסוכנים?')) return;
    const btn = document.querySelector('[onclick="runAllAgents()"]');
    if (btn) { btn.disabled=true; btn.textContent='⏳ מריץ...'; }
    try {
      const res = await fetch('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=run', {
        method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'שגיאה');
      alert('✅ הסוכנים סיימו!\n'+(data.summary||data.queued+' משימות'));
      loadAgentsSection();
    } catch(e) { alert('שגיאה: '+e.message); }
    finally { if (btn) { btn.disabled=false; btn.textContent='▶ הרץ כל הסוכנים'; } }
  }


