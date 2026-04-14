# Gelato Design File Specifications

## Minimum Sizes
| Area | Size | DPI | Format | Background |
|------|------|-----|--------|------------|
| Front | 3,600×4,200px | 300 | PNG | Transparent |
| Back | 3,000×3,600px | 300 | PNG | Transparent |
| Cap | 1,800×900px | 300 | PNG | Transparent |

## Iron Rule
File under 200KB = Gelato silently rejects. No error message, just wrong print.

## Naming Convention
- `front_logo_white.png` — white text, for dark garments
- `front_logo_dark.png` — dark text, for light garments
- `back_design_{productId}_white.png` — white text back, for dark garments
- `back_design_{productId}_dark.png` — dark text back, for light garments
- `cap_design_white.png` / `cap_design_dark.png`

## DARK_COLORS (use _white.png variant)
Black, Navy, Charcoal, Forest Green

## LIGHT_COLORS (use _dark.png variant)
White, Cream, Red

## Customer Issue → Reprint Process
1. Gelato Dashboard → Orders → find by `DUBIS-{PaypalOrderId}`
2. Report Problem → Issue with quality → Other quality issue
3. Request: reorder (free reprint)
4. Typical response: approved within hours
