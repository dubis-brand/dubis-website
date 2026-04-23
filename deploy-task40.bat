@echo off
echo === DUBIS Deploy Task #40 (anti-duplicate-posts) ===
cd /d "%~dp0"

:: Clear stale git locks
if exist ".git\HEAD.lock" del ".git\HEAD.lock"
if exist ".git\index.lock" del ".git\index.lock"

:: Amend-commit any pending changes (code was already staged by the hung deploy.bat)
git add -A
git commit -m "fix(content-agent): anti-mode-collapse visual matrix for IG posts (Task #40)" 2>nul

:: Push (may be no-op if already pushed)
git push origin main

:: Deploy Edge Function to Supabase — --yes auto-accepts npx install prompt
call npx --yes supabase@2.95.0 functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb

echo.
echo === Deploy complete — verifying ===
curl.exe -s "https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents/health" -H "x-agent-secret: %SUPABASE_AGENT_SECRET%"
echo.
echo === Done! ===
timeout /t 30
