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
| **PayPal captured + Gelato dashboard empty** | `not_possible_to_chosen_destination` (quote/POST discrepancy) | Search Vercel logs for that string. Apply runbook §"Diagnose split-vs-single-warehouse routing for a cart". Likely fix: swap `dubis_products.gender` women→unisex per `memory/checkout-guardrails.md` §12. |
| **PayPal captured, customer saw success modal, no DB row** | `pfData` ReferenceError OR `_no_refund` reason | Check `js/paypal.js` `onApprove` for outer-scope `let pfData`. If missing → restore the hoist per `memory/checkout-guardrails.md` §11. Refund the capture manually via `?type=refund-by-id`. |
| **Cart UI lets customer click Checkout but Gelato refuses** | `handleStockProbe` returned middle state OR `addToCartFromModal` country gate missing | Check `js/main.js` `_cartProbeApply` sets `btn.disabled=true` on OOS modes. Verify `addToCartFromModal` checks `detectedCustomerCountry()` against `supportedCountries[]` before allowing add. |
| **One sub-order from a split succeeded, another failed** | Multi-warehouse split + late variant OOS | This is rule #8 partial-fulfillment territory. Cancel the orphan sibling in Gelato dashboard. Issue proportional refund. Open agent_task for Product to swap the offending variant routing per §12. |
| **Site returns 404 on root + `/designs/*.png`** | Vercel auto-detected `public/` → static export mode | Check if `dubis-website/public/` exists. Delete it. Verify `.vercelignore` contains `public/`. Re-deploy. Postmortem in `memory/troubleshooting.md` § "Hila Catastrophe Round II" round 9. |
| **Capture stuck with `refund_id IS NULL`** | Refund pipeline failed (PayPal token expired / network blip) | `curl -X POST https://www.dubis.net/api/cron/morning-report?type=refund-by-id&capture_id=XXX -H 'Authorization: Bearer $CRON_SECRET'`. Full runbook entry in `memory/runbook.md`. |

## Post-Hila II diagnostic-first questions (run before any code changes)
1. **What does `handleStockProbe` say for this cart NOW?** Curl `?action=stock-probe` with the customer's cart JSON. If `quote_ok` → Gelato regressed between when customer paid and now. If `quote_partial_oos` → the variant is genuinely OOS, refund + name the offending item in the comms.
2. **Does Gelato dashboard show ANY order for this PayPal ref?** Search `DUBIS-{paypal_order_id}`. If found → fulfillment is in flight, customer is fine. If not → POST never landed; check Vercel logs for `gelato-rejected` or `handler-exception`.
3. **Is `refund_id IS NULL` on the orders row?** If YES → capture is stuck, fire `?type=refund-by-id`. If NO → already refunded, comms to customer + close.
4. **Are there sibling rows linked via `split_group_id`?** If YES → this was a multi-warehouse split; check ALL siblings before deciding (one might be fulfilled, one might be refunded).

## References
→ `memory/checkout-guardrails.md` — all 12 protection layers, ownership matrix
→ `memory/troubleshooting.md` — "The Hila Catastrophe" + "Hila Catastrophe Round II" postmortems
→ `memory/runbook.md` — "Refund a stuck PayPal capture by capture ID", "Diagnose split-vs-single-warehouse routing", "Force-recompute supportedCountries"
→ `dubis-website/.claude/rules/gelato-operations.md` — Quote ≠ POST, multi-warehouse splitting, Gelato API truth table
