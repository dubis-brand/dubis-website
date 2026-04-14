---
name: debug-order
description: Debug a DUBIS order issue — from payment to print to delivery
---

# Debug Order Issue

Investigate and resolve order problems across the full pipeline.

## Step 1: Identify the Order
- Get order reference: `DUBIS-{PaypalOrderId}`
- Check Supabase: `SELECT * FROM orders WHERE paypal_order_id = '{id}'`
- Check order status, amounts, items

## Step 2: Check Payment (PayPal)
- Was payment captured? Check `payment_status` in orders table
- If payment issue → check PayPal dashboard

## Step 3: Check Print (Gelato)
- Was Gelato order created? Check `gelato_order_id` in orders table
- If missing → check Vercel logs for `create-gelato-order.js` errors
- Common issue: design file validation failed (under 200KB)
- Verify designs: `curl -sI https://www.dubis.net/designs/{file}.png | grep Content-Length`

## Step 4: Check Delivery Status
- Gelato Dashboard → Orders → search by reference
- Check webhook_events table for latest status update
- If webhook not received → check `api/webhooks/gelato.js` logs

## Step 5: Check Email
- Was confirmation sent? Check Vercel logs for `email/confirm-order.js`
- Was review request sent? Check `review_request_sent_at` in orders table

## Common Issues
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Wrong print | Design file <200KB | Regenerate at 3600×4200px |
| No Gelato order | COLOR_MAP mismatch | Add color to COLOR_MAP |
| Duplicate processing | Missing idempotency | Check webhook_events table |
| No confirmation email | Resend API error | Check RESEND_API_KEY |

## References
→ memory/troubleshooting.md for past resolved issues
→ memory/integrations/gelato.md for Gelato specifics
