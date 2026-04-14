# PayPal Integration — DUBIS

## Connection
- Client ID: Vercel env var `PAYPAL_CLIENT_ID`
- Secret: Vercel env var `PAYPAL_SECRET`
- Mode: Production (live)

## Flow
1. `js/paypal.js` renders PayPal buttons in checkout modal
2. Customer approves payment in PayPal popup
3. On success: order saved to Supabase → Gelato order created → confirmation email
4. Cart snapshot saved before clearing localStorage

## Key Files
- `js/paypal.js` — Frontend PayPal integration, checkout flow
- `api/orders/save.js` — Saves order to Supabase after payment
- `api/create-gelato-order.js` — Creates print order after payment confirmed

## Known Issues
- ⚠️ PayPal keys were in git history (commit 18d0c2d) — should be rotated
