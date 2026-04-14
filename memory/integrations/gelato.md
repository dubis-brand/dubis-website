# Gelato Integration — DUBIS

## Connection
- API Key: stored in Vercel env var `GELATO_API_KEY`
- Webhook Secret: `GELATO_WEBHOOK_SECRET`
- Dashboard: https://dashboard.gelato.com
- Orders: https://dashboard.gelato.com/orders
- Catalog: https://dashboard.gelato.com/catalogue

## Order Flow
1. Customer completes PayPal checkout
2. `api/orders/save.js` saves order to Supabase
3. `api/create-gelato-order.js` builds Gelato order:
   - `buildProductUid()` constructs Gelato product UID from baseUid + color + size
   - Validates all design files (HEAD request, Content-Length ≥ 200KB)
   - Sends order to Gelato API
4. `api/email/confirm-order.js` sends confirmation to customer
5. Gelato processes and ships
6. `api/webhooks/gelato.js` receives status updates (with idempotency check)
7. `api/admin/gelato-sync.js` runs nightly at 00:00 UTC for catch-up sync

## Design File Hosting
All design files at `https://www.dubis.net/designs/`
- Front: `front_logo_white.png` / `front_logo_dark.png` (shared across products)
- Back: `back_design_{productId}_{white|dark}.png` (unique per product)
- Cap: `cap_design_{white|dark}.png`

## Known Quirks
- Files under 200KB are silently rejected — no error from Gelato API
- Order reference format: `DUBIS-{PaypalOrderId}`
- Gelato sends duplicate webhooks — handled by webhook_events table
- Color mapping must be exact — mismatches cause silent failures

## Troubleshooting Checklist
1. Check design file sizes: `curl -sI https://www.dubis.net/designs/{file} | grep Content-Length`
2. Check Gelato Dashboard → Orders → find by reference ID
3. Check Vercel Runtime Logs for validation errors
4. If wrong print → file Report Problem in Gelato Dashboard → request free reprint
