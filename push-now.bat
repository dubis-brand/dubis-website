@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding changed files ===
git add api/admin/analytics.js
git add push-now.bat

echo === Committing ===
git commit -m "fix: revert RPC, split page_views query to bypass 1000-row limit"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
