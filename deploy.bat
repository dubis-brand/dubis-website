@echo off
echo === DUBIS Deploy Script ===
cd /d "%~dp0"

:: Delete stale git lock files
if exist ".git\HEAD.lock" del ".git\HEAD.lock"
if exist ".git\index.lock" del ".git\index.lock"

:: Commit changes
git add -A
git commit -m "fix: content-run uses dubis_images instead of AI generation"

:: Push to GitHub
git push origin main

:: Deploy Edge Function to Supabase
npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb

:: Trigger content pipeline immediately
echo.
echo === Triggering content pipeline ===
curl.exe -s -X POST "https://www.dubis.net/api/cron/morning-report?type=content" -H "x-vercel-cron: 1"
echo.

echo === Done! ===
pause
