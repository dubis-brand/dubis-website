@echo off
echo === DUBIS Content Pipeline Trigger ===
echo Triggering Vercel cron: morning-report?type=content
echo.
curl.exe -s -X POST "https://www.dubis.net/api/cron/morning-report?type=content" -H "x-vercel-cron: 1" --max-time 180
echo.
echo.
echo === Done! Check agent_tasks in Supabase. ===
pause
