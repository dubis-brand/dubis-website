// DUBIS — Customer Reviews Widget
// Shows reviews on product pages + allows submission
// Agent: CTO | March 2026

(function() {
  'use strict';

  const SUPABASE_URL = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50end2cXRwZG12dmF2Ymh1eWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2ODk1ODAsImV4cCI6MjA4NzI2NTU4MH0.EpfZAg28aU6_sOblfkVpkAwp9nDvXMTRCCNz0UJWHEc';

  // Cache reviews per product
  const _reviewCache = {};

  // ── Load reviews for a product ──
  async function loadProductReviews(productId, productName) {
    if (_reviewCache[productId]) return _reviewCache[productId];

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/product_reviews?product_id=eq.${productId}&approved=eq.true&order=created_at.desc&limit=20`, {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON
        }
      });
      const reviews = await res.json();
      _reviewCache[productId] = Array.isArray(reviews) ? reviews : [];
      return _reviewCache[productId];
    } catch (e) {
      console.warn('Failed to load reviews:', e);
      return [];
    }
  }

  // ── Submit a review ──
  async function submitReview(productId, productName, data) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/product_reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          product_id: productId,
          product_name: productName,
          reviewer_name: data.name,
          reviewer_email: data.email || null,
          rating: data.rating,
          title: data.title || null,
          body: data.body || null,
          verified_purchase: false,
          approved: false
        })
      });
      return res.ok || res.status === 201;
    } catch (e) {
      console.error('Review submit error:', e);
      return false;
    }
  }

  // ── Generate stars HTML ──
  function starsHTML(rating, interactive) {
    if (interactive) {
      return [1,2,3,4,5].map(i =>
        `<span class="dubis-star ${i <= rating ? 'filled' : ''}" data-val="${i}" style="cursor:pointer;font-size:1.4rem;color:${i <= rating ? '#c8a96e' : '#333'};transition:color .15s">★</span>`
      ).join('');
    }
    return '★'.repeat(rating) + '<span style="color:#333">' + '★'.repeat(5 - rating) + '</span>';
  }

  // ── Render reviews section in product modal ──
  function renderReviewsTab(productId, productName, reviews) {
    const isHe = (typeof currentLang !== 'undefined' && currentLang === 'he');
    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : 0;

    const t = {
      title: isHe ? 'ביקורות לקוחות' : 'Customer Reviews',
      avg: isHe ? 'דירוג ממוצע' : 'Average Rating',
      noReviews: isHe ? 'אין ביקורות עדיין. היה הראשון!' : 'No reviews yet. Be the first!',
      writeReview: isHe ? 'כתוב ביקורת' : 'Write a Review',
      yourRating: isHe ? 'הדירוג שלך' : 'Your Rating',
      yourName: isHe ? 'השם שלך' : 'Your Name',
      email: isHe ? 'אימייל (לא חובה)' : 'Email (optional)',
      reviewTitle: isHe ? 'כותרת' : 'Title',
      reviewBody: isHe ? 'הביקורת שלך' : 'Your Review',
      submit: isHe ? 'שלח ביקורת' : 'Submit Review',
      thanks: isHe ? '✅ תודה! הביקורת שלך נשלחה לאישור.' : '✅ Thanks! Your review has been submitted for approval.',
      based: isHe ? 'ביקורות' : 'reviews',
      verified: isHe ? 'רכישה מאומתת' : 'Verified Purchase',
    };
    const dir = isHe ? 'rtl' : 'ltr';

    let html = `<div class="dubis-reviews-section" dir="${dir}" style="margin-top:1rem">`;

    // Summary
    if (reviews.length > 0) {
      html += `<div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem">
        <span style="font-size:2rem;font-weight:700;color:#c8a96e">${avgRating}</span>
        <div>
          <div style="color:#c8a96e;font-size:1.1rem">${starsHTML(Math.round(avgRating), false)}</div>
          <div style="font-size:.75rem;color:#666">${reviews.length} ${t.based}</div>
        </div>
      </div>`;
    }

    // Review list
    if (reviews.length > 0) {
      reviews.forEach(r => {
        const date = new Date(r.created_at).toLocaleDateString(isHe ? 'he-IL' : 'en-GB');
        html += `<div style="border-top:1px solid #222;padding:.8rem 0">
          <div style="color:#c8a96e;font-size:.85rem">${starsHTML(r.rating, false)}</div>
          ${r.title ? `<div style="font-weight:600;color:#e8e0d5;margin-top:.3rem">${r.title}</div>` : ''}
          ${r.body ? `<div style="color:#aaa;font-size:.85rem;margin-top:.3rem;line-height:1.4">${r.body}</div>` : ''}
          <div style="font-size:.72rem;color:#555;margin-top:.3rem">${r.reviewer_name} · ${date}${r.verified_purchase ? ` · <span style="color:#9c27b0">${t.verified}</span>` : ''}</div>
        </div>`;
      });
    } else {
      html += `<div style="text-align:center;color:#555;padding:1rem;font-size:.85rem">${t.noReviews}</div>`;
    }

    // Write review form
    html += `
      <div style="margin-top:1.2rem;border-top:1px solid #222;padding-top:1rem">
        <div style="font-weight:600;color:#c8a96e;margin-bottom:.8rem">${t.writeReview}</div>
        <div id="review-form-${productId}">
          <div style="margin-bottom:.6rem">
            <label style="font-size:.75rem;color:#666">${t.yourRating}</label>
            <div id="review-stars-${productId}" style="margin-top:.2rem">${starsHTML(0, true)}</div>
          </div>
          <input type="text" id="review-name-${productId}" placeholder="${t.yourName}" style="width:100%;background:#141414;border:1px solid #2a2a2a;color:#e8e0d5;padding:.5rem .7rem;border-radius:6px;font-size:.85rem;margin-bottom:.5rem" />
          <input type="email" id="review-email-${productId}" placeholder="${t.email}" style="width:100%;background:#141414;border:1px solid #2a2a2a;color:#e8e0d5;padding:.5rem .7rem;border-radius:6px;font-size:.85rem;margin-bottom:.5rem" />
          <input type="text" id="review-title-${productId}" placeholder="${t.reviewTitle}" style="width:100%;background:#141414;border:1px solid #2a2a2a;color:#e8e0d5;padding:.5rem .7rem;border-radius:6px;font-size:.85rem;margin-bottom:.5rem" />
          <textarea id="review-body-${productId}" placeholder="${t.reviewBody}" rows="3" style="width:100%;background:#141414;border:1px solid #2a2a2a;color:#e8e0d5;padding:.5rem .7rem;border-radius:6px;font-size:.85rem;margin-bottom:.6rem;resize:vertical"></textarea>
          <button id="review-submit-${productId}" style="background:#c8a96e;color:#1a1a1a;font-weight:700;border:none;padding:.6rem 1.5rem;border-radius:6px;cursor:pointer;font-size:.85rem">${t.submit}</button>
        </div>
        <div id="review-success-${productId}" style="display:none;text-align:center;color:#4caf50;padding:1rem;font-size:.9rem">${t.thanks}</div>
      </div>
    </div>`;

    return html;
  }

  // ── Attach star click handlers ──
  function initStarClicks(productId) {
    const container = document.getElementById(`review-stars-${productId}`);
    if (!container) return;
    let selectedRating = 0;
    container.querySelectorAll('.dubis-star').forEach(star => {
      star.addEventListener('click', function() {
        selectedRating = parseInt(this.dataset.val);
        container.querySelectorAll('.dubis-star').forEach(s => {
          const v = parseInt(s.dataset.val);
          s.style.color = v <= selectedRating ? '#c8a96e' : '#333';
          s.classList.toggle('filled', v <= selectedRating);
        });
      });
      star.addEventListener('mouseenter', function() {
        const hoverVal = parseInt(this.dataset.val);
        container.querySelectorAll('.dubis-star').forEach(s => {
          s.style.color = parseInt(s.dataset.val) <= hoverVal ? '#c8a96e' : '#333';
        });
      });
      star.addEventListener('mouseleave', function() {
        container.querySelectorAll('.dubis-star').forEach(s => {
          s.style.color = parseInt(s.dataset.val) <= selectedRating ? '#c8a96e' : '#333';
        });
      });
    });
    container._getSelected = () => selectedRating;
  }

  // ── Attach submit handler ──
  function initSubmitHandler(productId, productName) {
    const btn = document.getElementById(`review-submit-${productId}`);
    if (!btn) return;

    btn.addEventListener('click', async function() {
      const starsContainer = document.getElementById(`review-stars-${productId}`);
      const rating = starsContainer._getSelected ? starsContainer._getSelected() : 0;
      const name = document.getElementById(`review-name-${productId}`)?.value?.trim();
      const email = document.getElementById(`review-email-${productId}`)?.value?.trim();
      const title = document.getElementById(`review-title-${productId}`)?.value?.trim();
      const body = document.getElementById(`review-body-${productId}`)?.value?.trim();

      if (!rating || rating < 1) {
        alert(typeof currentLang !== 'undefined' && currentLang === 'he' ? 'בחר דירוג' : 'Please select a rating');
        return;
      }
      if (!name) {
        alert(typeof currentLang !== 'undefined' && currentLang === 'he' ? 'הזן את שמך' : 'Please enter your name');
        return;
      }

      btn.textContent = '...';
      btn.disabled = true;

      const ok = await submitReview(productId, productName, { name, email, rating, title, body });
      if (ok) {
        document.getElementById(`review-form-${productId}`).style.display = 'none';
        document.getElementById(`review-success-${productId}`).style.display = '';
        // Clear cache
        delete _reviewCache[productId];
      } else {
        alert('Error submitting review. Please try again.');
        btn.textContent = typeof currentLang !== 'undefined' && currentLang === 'he' ? 'שלח ביקורת' : 'Submit Review';
        btn.disabled = false;
      }
    });
  }

  // ── Public API: inject reviews tab into product modal ──
  window.dubisReviews = {
    async injectTab(productId, productName) {
      const reviews = await loadProductReviews(productId, productName);
      return renderReviewsTab(productId, productName, reviews);
    },
    initInteractions(productId, productName) {
      initStarClicks(productId);
      initSubmitHandler(productId, productName);
    }
  };

})();
