@echo off
echo === DUBIS Product Consistency Fix Deploy — 2026-04-23 ===
cd /d "%~dp0"

:: Delete stale git lock files
if exist ".git\HEAD.lock" del ".git\HEAD.lock"
if exist ".git\index.lock" del ".git\index.lock"

:: Commit changes
git add -A
git commit -m "fix(product): remove Honey Brown (5 products), fix duplicate color label, update mockup prompts to DUBIS(TM), forbid stray DUBIS on back"

:: Push to GitHub
git push origin main

echo.
echo === Done! Vercel auto-deploys from main branch ===
pause
