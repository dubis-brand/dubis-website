@echo off
echo === DUBIS Deploy-Only (no git) ===
cd /d "%~dp0"

:: Deploy Edge Function to Supabase — -y auto-installs supabase CLI if needed
call npx -y supabase@2.93.0 functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb

echo.
echo === Triggering content pipeline ===
curl.exe -s -X POST "https://www.dubis.net/api/cron/morning-report?type=content" -H "x-vercel-cron: 1"
echo.

echo === Done! ===
timeout /t 60
