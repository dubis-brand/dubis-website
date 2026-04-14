---
paths:
  - "api/create-gelato-order.js"
  - "api/admin/gelato-sync.js"
  - "api/webhooks/gelato.js"
  - "js/products.js"
  - "designs/**"
---

# Gelato Operations — DUBIS

## Design File Specifications
| Area | Min Size | DPI | Format | Background |
|------|----------|-----|--------|------------|
| Front | 3,600×4,200px | 300 | PNG | Transparent |
| Back | 3,000×3,600px | 300 | PNG | Transparent |
| Cap | 1,800×900px | 300 | PNG | Transparent |

**Iron Rule:** File under 200KB = problem. Gelato silently rejects.

## COLOR_MAP (in create-gelato-order.js)
Maps color names from products.js → Gelato color codes.
DARK_COLORS = Black, Navy, Charcoal, Forest Green → use `_white.png` designs

## Validation (Automatic)
`create-gelato-order.js` sends HEAD request to every design file before order:
- Checks HTTP 200 + Content-Length ≥ 200KB
- If fails → blocks order, returns explicit error
- Logs appear in Vercel Runtime Logs

## Key Files
- `designs/front_logo_white.png` / `front_logo_dark.png` — shared front logo
- `designs/back_design_{id}_{variant}.png` — unique back per product
- `designs/cap_design_{variant}.png` — cap designs
- Design files served at: `https://www.dubis.net/designs/`

## Order Reference Format
`DUBIS-{PaypalOrderId}` — used to find orders in Gelato Dashboard
