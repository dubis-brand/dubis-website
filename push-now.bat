@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Adding changed files ===
git add api/admin/analytics.js
git add push-now.bat

echo === Committing ===
git commit -m "fix: split page_views into 3 chunks (10 days each) to handle 1940 rows"

echo === Push to origin ===
git push origin main

echo.
echo === DONE ===
pause
