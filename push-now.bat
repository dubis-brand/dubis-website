@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding product images ===
git add images/product-17*.jpg
git add images/product-18*.jpg
git add push-now.bat
git add generate-images-17-18.bat

echo === Committing ===
git commit -m "add: product images for #17 zip hoodie + #18 t-shirt (all colors, front+back)"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
