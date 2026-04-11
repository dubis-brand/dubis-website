@echo off
cd /d "%~dp0"
echo ============================================
echo   DUBIS — Generate images for products 17+18
echo ============================================
echo.
echo === Product #17: Zip Hoodie "Experienced in EXHAUSTION" ===
echo Colors: Black, White, Navy, Charcoal (front + back)
node scripts/generate-product-images.js --product-id=17
echo.
echo === Product #18: T-Shirt "Unfashionably COMFORTABLE" ===
echo Colors: Black, White, Navy, Charcoal (front + back)
node scripts/generate-product-images.js --product-id=18
echo.
echo ============================================
echo   DONE — Check images/ folder for results
echo ============================================
pause
