---
paths:
  - "api/**"
  - "vercel.json"
---

# Vercel Constraints — CRITICAL

## Function Limit: 12/12 — NO MORE SLOTS
Vercel Hobby plan allows MAX 12 Serverless Functions per deployment.
**We are AT the limit. NEVER create new .js files in /api/.**

## Current API Files (12/12)
| # | File | Purpose |
|---|------|---------|
| 1 | `api/analytics/track.js` | Page view tracking |
| 2 | `api/create-gelato-order.js` | Gelato order creation |
| 3 | `api/cron/morning-report.js` | Morning cron + content pipeline (?type=content) |
| 4 | `api/cron/review-requests.js` | Review request emails (7d post-delivery) |
| 5 | `api/email/confirm-order.js` | Order confirmation email |
| 6 | `api/orders/save.js` | Save order to Supabase |
| 7 | `api/webhooks/gelato.js` | Gelato webhook |
| 8 | `api/admin/analytics.js` | Admin analytics dashboard |
| 9 | `api/admin/coupons.js` | Coupon management |
| 10 | `api/admin/gelato-sync.js` | Gelato sync |
| 11 | `api/admin/orders.js` | Order management |
| 12 | `api/admin/users.js` | User management |

## Note: `api/_rateLimit.js` does NOT count — underscore prefix excludes from Serverless Functions.

## To Add New Functionality
Add routes inside existing API files using query params:
`?type=newroute` in the appropriate existing file.
