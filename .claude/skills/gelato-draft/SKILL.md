---
name: gelato-draft
description: Create FREE Gelato draft orders from the admin panel to verify mockups + production facility before real customer orders. Built 2026-04-24 after the Hila wearer's-right-chest bug.
---

# Create Gelato Draft Order

Use this BEFORE making any catalog changes go live to real customers. A draft order is FREE (no production, no billing, expires in ~30 days) and shows you exactly how Gelato will print the product.

## When to use

- After adding a new product (verify before active=true)
- After regenerating any print file (generate-designs.js)
- After bumping DESIGN_VERSION (verify Gelato fetches new files)
- Periodically to QA - every 2-4 weeks
- When Gelato API key is rotated (verify still authenticated)
- Before launching a marketing campaign that drives traffic to a specific product
- NOT for receiving a physical sample - that is a separate flow (Mode B, not built yet)

## How to create a draft (3 steps, ~30 seconds)

### Step 1: Open admin
Go to https://www.dubis.net/admin and sign in with Google (only dubis.brand@gmail.com and approved admin emails work).

### Step 2: Open Gelato Tools tab
Click the "Gelato Tools" tab in the top nav (last tab). If you see a load error, your Supabase token expired. Click logout and sign in again.

### Step 3: Fill form + create
- Product: dropdown shows all 18 active products from dubis_products table
- Color: updates dynamically based on selected product colors array
- Size: S/M/L/XL/2XL/3XL
- Ship to: pick US (Los Angeles 90210) to test US fulfillment, or IL (Ramat Yohanan) to test Israel
- Preview: live thumbnails of front+back from images/ folder - confirm you picked the right product before clicking the button
- Click "Create Draft Order (free)"

Expected response: ~3-8 seconds.

## What to check in the response

Key fields in summary:
- gelatoOrderId - Draft ID
- orderType - must be "draft"
- fulfillmentCountry - "unknown" for drafts (Gelato decides at production time)
- fulfillmentFacility - same
- totalAmount - null for drafts (no billing)
- mockupUrl - Gelato-rendered preview (may be empty for fresh drafts; fills in 1-2 min)
- dashboardUrl - direct link to Gelato dashboard

In fullResponse, verify:
- fulfillmentStatus: "draft" (not in production)
- financialStatus: "draft" (not billed)
- items[0].files[] URLs include ?v=DESIGN_VERSION matching current value

## Visual verification (in Gelato dashboard)

| Check | What to look for |
|---|---|
| Front logo position | DUBIS on wearer's LEFT chest = viewer's RIGHT in as-worn photos |
| Front logo size | ~2-3cm wide, polo-style, NOT large or centered |
| Back text | Slogan only, NO DUBIS anywhere on back |
| Back text position | Upper-center, clear of collar AND clear of hem |
| Color accuracy | Match Gelato HEX (Black #25282A, Cream #DFD1A7, etc.) |
| Print files used | URLs contain ?v=DESIGN_VERSION matching api/create-gelato-order.js |

If wrong: click "Discard order" in Gelato dashboard, fix print files (generate-designs.js), bump DESIGN_VERSION, redeploy, create new draft.

## Verifying US fulfillment (Hila question)

Drafts always show fulfillmentCountry: "unknown" because Gelato assigns facility only at production time.

To verify: real US customer order â†’ Vercel logs filtered by create-gelato-order â†’ look for fulfillmentCountry: "US" in the Gelato response. Gelato dashboard will also show production facility name (e.g. gelato-us-chicago).

Future enhancement: log fulfillmentCountry to orders.fulfillment_country on order creation.

## Architecture

POST /api/create-gelato-order?action=create-draft
- Auth: Supabase JWT (admin only - ADMIN_EMAILS or admin_users table)
- Body: { productId, color, size, type, gender, shipCountry }
- Builds Gelato productUid via buildProductUid(type, gelatoColor, gelatoSize, gender)
- Builds print file URLs (front + back, with ?v=DESIGN_VERSION)
- POSTs to https://order.gelatoapis.com/v4/orders with orderType: "draft"
- Returns summary + full response

Stays at 12/12 Vercel functions cap (uses ?action= routing).

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Button stuck on "sending to Gelato..." | Stale Supabase JWT | Sign out and sign in (Google), retry |
| Forbidden - admin only | Email not in ADMIN_EMAILS env or admin_users table | Add to env or table |
| unsupported_color | Color not in COLOR_MAP[type] of api/create-gelato-order.js | Add or rename color |
| Gelato error 400 | Bad payload | Check fullResponse.details, fix code |
| Wrong logo position in draft | Print file generated with wrong x/y | Fix LOGO_CENTER_X_RATIO in generate-designs.js, bump DESIGN_VERSION, redeploy |
| Mockup URL is null | Gelato has not rendered yet | Wait 1-2 min, refresh dashboard |

## Cost

- Each draft: $0
- Drafts auto-delete after ~30 days
- No documented quota - created 50+ in a day without throttle

Use freely for QA.

## When to escalate to a real order

For a physical sample shipped to your hands (verify fabric/print quality), use Gelato dashboard directly (dashboard.gelato.com) to create an order to your IL address - pay Gelato directly, off-PayPal.

Future Mode B will add this as a button in the same Gelato Tools tab.

## History

- Built: 2026-04-24
- First successful draft: dbb573aa-fec9-408e-b3bf-e77e3fac41df (product 4, Black, XL â†’ IL)
- Hang bug + fix (timeouts + console logs): commit 34c70f0 2026-04-25
- Original proposal: docs/plans/DUBIS_GELATO_TOOLS_ADMIN_2026-04-24.html

## References

- .claude/skills/add-product/SKILL.md - uses this skill at step 9
- api/create-gelato-order.js::handleCreateDraft - server-side
- admin.html#section-gelato-tools - UI
- memory/reference_dubis_mockup_pipeline_bplus.md - image pipeline
