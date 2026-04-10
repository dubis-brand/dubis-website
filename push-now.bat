@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding changed files ===
git add admin.html
git add api/admin/orders.js
git add api/admin/analytics.js
git add push-now.bat

echo === Committing ===
git commit -m "feat: dynamic exchange rate, campaigns/expenses split, is_test filter on orders"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
