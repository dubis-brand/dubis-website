@echo off
cd /d "%~dp0"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Phase 2 Autonomy — Adding all changed files ===
git add admin.html
git add vercel.json
git add api/cron/morning-report.js
git add supabase/functions/agents/index.ts
git add push-now.bat
git add docs/plans/AGENT_AUTONOMY_PLAN.html
git add .claude/rules/agents-system.md
git add .claude/rules/api-conventions.md

echo === Committing ===
git commit -m "feat: Phase 2 autonomy — agents auto-execute, budget-only approval, enhanced morning report"

echo === Push to origin ===
git push origin main

echo === Deploy Edge Function ===
npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb

echo.
echo === DONE ===
pause
