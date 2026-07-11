---
paths:
  - "api/**"
---

# API Conventions — DUBIS

## Routing Pattern
All API files use query param routing internally:
```
/api/cron/morning-report?type=content              → content pipeline
/api/cron/morning-report?type=agents               → run agents
/api/cron/morning-report?type=auto-run             → auto-execute all non-budget tasks
/api/cron/morning-report?type=security             → security scan
/api/cron/morning-report?type=weekly-marketing-plan→ Sunday weekly plan generator
/api/cron/morning-report?type=geo                  → PUBLIC. Echoes Vercel x-vercel-ip-country / region / city headers. No auth.
/api/cron/morning-report?type=refund-by-id&capture_id=XXX → POST. CRON_SECRET auth. Direct PayPal capture refund (post-2026-05-21 _no_refund recovery).
/api/cron/morning-report?type=reconcile-orders     → Background sweep. Finds orders with refund_id IS NULL but Gelato dashboard shows no order; fires emergency refund.
/api/cron/morning-report?type=feedback-notify      → pg_net trigger from feedback_responses INSERT.
/api/cron/morning-report?type=feedback-apology     → 6 personal HE reminder drafts to non-responders.
/api/cron/morning-report?type=cart-recovery        → Abandoned-cart reminder emails (2026-07-03). Reads `abandoned_carts` (captured by js/engage.js §4 at cart-modal save / #checkout-email blur / newsletter signup) + imports `fbia_pending` backlog rows with buyer_email. One email per cart, 3-48h window, dedupe per email (newest wins), skip-if-purchased. Restore link /?cart={restore_token} → `get_abandoned_cart` RPC (returns cart_items only, never the email). Also runs INLINE from ?type=auto-run and ?type=content (4 windows/day) — no new cron slot.

/api/cron/morning-report?type=notify-oren          → POST {subject, html}. Generic agent→oren email via live Resend key. Recipient HARDCODED to dubis.brand@gmail.com. Auth: same gate (CRON/AGENT secret or x-pg-trigger-token). Added 2026-07-11 (local RESEND/AGENT keys are stale post-rotation).

/api/create-gelato-order                           → POST. Fulfillment. Client SDK already captured PayPal in onApprove; this POST takes {cartItems, shippingAddress, paypalOrderId, buyerEmail} → Gelato order(s). Does NOT itself capture PayPal.
/api/create-gelato-order?action=stock-probe        → POST. Pre-flight quote-API probe. Returns mode ∈ {quote_ok, quote_split_required, quote_partial_oos, all_blocked_pre_gelato}.
/api/create-gelato-order?action=create-draft       → POST. Admin-only. Creates FREE Gelato draft order for QA (no real charge).
/api/create-gelato-order?action=create-paypal-order → POST. FBIA redirect-checkout step 1. Body {cartItems, shippingAddress, buyerEmail, discount}. Creates a PayPal Orders-v2 order (intent=CAPTURE) via api/_paypal.js createOrder(), stores the cart server-side in agent_tasks (category='fbia_pending', cart in content_data.cart_items, keyed by paypalOrderId), resolves shipping via fbiaResolveShipping(). Returns {ok:true, paypalOrderId, approveUrl}. Client then sets window.location.href = approveUrl (top-level nav — works inside FBIA where the SDK popup is blocked).
/api/create-gelato-order?action=capture-paypal-order → GET. FBIA redirect-checkout step 2 (PayPal return_url). PayPal appends ?token={orderId}&PayerID={pid}; req.query.token = PayPal order id. Captures idempotently via captureOrder() (ORDER_ALREADY_CAPTURED treated as success), re-reads the stored cart from agent_tasks, fires server-to-server POST to /api/create-gelato-order fulfillment with the stored body, then 302 redirect to /?paypal_return=1 (or /?paypal_error=... on failure).
```

## FBIA redirect-checkout (PayPal full-page redirect — the FBIA fix)
The PayPal JS-SDK popup is **blocked inside Facebook/Instagram in-app browsers (FBIA)**. The true fix is a PayPal **full-page redirect** (Orders v2 REST) flow, NOT the SDK popup. Architecture (zero refactor to the proven ~500-line money/refund path):
1. **Client (FBIA only):** `js/paypal.js` `renderWebViewExternalHandoff()` renders a redirect button. On click → POST `?action=create-paypal-order` → `window.location.href = approveUrl`.
2. **Server step 1 (`?action=create-paypal-order`):** create PayPal order (intent=CAPTURE), store cart in `agent_tasks` (`category='fbia_pending'`) keyed by the new PayPal order id. `return_url` = self (`fbiaBaseUrl(req)` from x-forwarded-host/proto) + `?action=capture-paypal-order`.
3. **Server step 2 (`?action=capture-paypal-order`, GET return):** capture idempotently, re-read the stored cart, server-to-server POST to the SAME fulfillment endpoint with the stored body, redirect to `/?paypal_return=1`.
- Cart is stored **server-side** because localStorage fails in FBIA AND the return_url lands back inside FBIA.
- Shared PayPal helper: `api/_paypal.js` exports `createOrder()` + `captureOrder()` (underscore prefix = NOT a Vercel function slot; still 12/12).
- See `.claude/skills/meta-ads/SKILL.md` §FBIA for the conversion context.

## Authentication
- **Admin endpoints:** Supabase JWT token in `Authorization: Bearer <token>` header
- **Agent endpoints:** `x-agent-secret` header matching `AGENT_SECRET` env var
- **Cron endpoints:** `Authorization: Bearer <CRON_SECRET>` or Vercel cron header

## Response Format
All endpoints return JSON:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "error_code", "message": "Human readable" }
```

## Cron Schedule (vercel.json)
| UTC | Israel | Endpoint | Task |
|-----|--------|----------|------|
| 00:00 | 02:00 | /api/admin/gelato-sync | Gelato order sync |
| 04:00 | 06:00 | /api/cron/morning-report?type=agents | Agent runs |
| 05:00 | 07:00 | /api/cron/morning-report | Morning report + boss agent |
| 06:00 | 08:00 | /api/cron/morning-report?type=auto-run | **Auto-execute tasks** |
| 08:00 | 10:00 | /api/cron/review-requests | Review request emails |
| 10:00 | 12:00 | /api/cron/morning-report?type=content | Content — HE post |
| 12:00 | 14:00 | /api/cron/morning-report?type=auto-run | **Auto-execute tasks** |
| 16:00 | 18:00 | /api/cron/morning-report?type=content | Content — EN post |
| 03:00 Mon | 05:00 Mon | /api/cron/morning-report?typ