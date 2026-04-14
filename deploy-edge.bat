@echo off
cd /d "%~dp0"
echo === Deploying Edge Function to Supabase ===
echo.
npx --yes supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb
echo.
echo === DONE ===
pause
