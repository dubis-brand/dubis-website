@echo off
echo === Triggering DUBIS Content Pipeline ===
echo.
echo --- Running content-run (will generate + post latest approved task) ---
curl.exe -s -X POST "https://www.dubis.net/api/cron/morning-report?type=content" -H "x-vercel-cron: 1" -w "\nHTTP Status: %%{http_code}\n"
echo.
echo --- Waiting 15 seconds for pipeline to finish ---
timeout /t 15 /nobreak > nul
echo.
echo --- Checking latest agent_runs for result ---
curl.exe -s "https://www.dubis.net/api/admin/agent-status" -H "x-admin-key: dubis2024" 2>nul || echo (admin status endpoint not available)
echo.
echo === Done! ===
pause
