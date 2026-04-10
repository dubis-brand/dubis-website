@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding changed files ===
git add admin.html
git add api/admin/orders.js
git add push-now.bat

echo === Committing ===
git commit -m "fix: admin dashboard - stat-pending ID collision, campaigns currency mixing, orders sandbox filtering"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
