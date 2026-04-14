---
name: add-product
description: Add a new product to DUBIS catalog with Gelato integration
---

# Add New Product — Full Checklist

## Step 1: Design Files
- [ ] Front logo: `front_logo_white.png` / `front_logo_dark.png` — min 3,600×4,200px, PNG transparent, sRGB
- [ ] Back design: `back_design_{id}_white.png` + `back_design_{id}_dark.png` — min 3,000×3,600px
- [ ] Cap (if applicable): `cap_design_{variant}.png` — min 1,800×900px
- [ ] All files > 200KB (Gelato silently rejects smaller files)
- [ ] Files placed in `designs/` directory

## Step 2: Verify Design Accessibility
```bash
for file in front_logo_white front_logo_dark back_design_{id}_white back_design_{id}_dark; do
  curl -sI "https://www.dubis.net/designs/${file}.png" | grep -E "HTTP|Content-Length"
done
# Content-Length must be > 200000 (200KB)
```

## Step 3: Update products.js
- Add product object with: id, name, baseUid, colors[], sizes[], price, designRef (if sharing back design)
- Verify `baseUid` matches Gelato catalog format
- Verify all colors exist in `COLOR_MAP` in `create-gelato-order.js`

## Step 4: Product Images
- Generate/add images: `images/product-{id}-{Color}-front.jpg` and `images/product-{id}-{Color}-back.jpg`
- For each color variant

## Step 5: Update COLOR_MAP (if new colors)
- Edit `api/create-gelato-order.js`
- Add any new colors to `COLOR_MAP` and `DARK_COLORS` arrays

## Step 6: Deploy & Test
- Push to main (Vercel auto-deploy)
- Test: visit product page, try adding to cart
- Test: complete a test purchase through PayPal sandbox
- Verify Gelato order created with correct design files

## References
- See `references/gelato-specs.md` for detailed file specs
- See `memory/integrations/gelato.md` for troubleshooting
