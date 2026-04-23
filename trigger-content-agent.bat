@echo off
echo === Trigger Content Agent (Task #40 verification) ===
curl.exe -s -X POST "https://www.dubis.net/api/cron/morning-report?type=content" -H "x-vercel-cron: 1"
echo.
echo === Waiting 90s for Gemini image gen to settle ===
timeout /t 90
echo.
echo === Done ===
timeout /t 5
