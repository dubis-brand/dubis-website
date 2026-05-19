@echo off
:: deploy-edge-only.bat — deploys ONLY the agents Edge Function to Supabase.
:: Use this when js/products.js, .github/workflows/*, or HTML/JS files have
:: already been pushed via git and you only need the Deno function update.
::
:: Required: npx supabase logged in (run once: `npx --yes supabase login`).
::
:: Created 2026-05-19 after the visual-approve sync-products fix — deploy.bat
:: still has a stale auto-commit message that would commit unrelated changes.

echo === DUBIS Edge Function Deploy (agents) ===
cd /d "%~dp0"

echo Deploying Supabase Edge Function: agents
call npx --yes supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo *** DEPLOY FAILED — exit code %ERRORLEVEL% ***
    echo If you see "not logged in", run: npx --yes supabase login
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo === Deploy complete. Verify with: ===
echo   curl -sI https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents
echo.
pause
