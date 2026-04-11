@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding changed files ===
git add admin.html
git add push-now.bat

echo === Committing ===
git commit -m "fix: zip hoodie Gelato cost $28->$32.94, per-product cost overrides"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
