@echo off
echo === DUBIS Bugfix Deploy 2026-04-22 ===
cd /d "%~dp0"

:: Delete stale git lock files
if exist ".git\HEAD.lock" del ".git\HEAD.lock"
if exist ".git\index.lock" del ".git\index.lock"

:: Stage and commit all changes
git add -A
git commit -m "fix(checkout): auto-refund on Gelato reject, honey brown removed, shipping/total persisted, webhook secret HMAC fallback, PayPal onError non-destructive"

:: Push to GitHub (Vercel auto-deploys from main)
git push origin main

echo.
echo === Git push complete — Vercel will now auto-deploy ===
echo.

pause
