@echo off
cd /d "%~dp0"
echo === DUBIS logging deploy %date% %time% === > deploy-logs.log

echo [1/5] Cleaning stale git locks... >> deploy-logs.log
if exist ".git\index.lock" del /Q ".git\index.lock" 2>> deploy-logs.log
if exist ".git\refs\heads\main.lock" del /Q ".git\refs\heads\main.lock" 2>> deploy-logs.log

echo [2/5] git add... >> deploy-logs.log
git add api/create-gelato-order.js api/orders/save.js api/webhooks/gelato.js deploy-logs.bat >> deploy-logs.log 2>&1

echo [3/5] git commit... >> deploy-logs.log
git commit -m "feat(logs): structured [DUBIS-GELATO]/[DUBIS-ORDER]/[DUBIS-WEBHOOK] logs for runtime observability" >> deploy-logs.log 2>&1

echo [4/5] git pull --rebase + push... >> deploy-logs.log
git pull --rebase origin main >> deploy-logs.log 2>&1
git push origin main >> deploy-logs.log 2>&1

echo [5/5] waiting 25s for Vercel... >> deploy-logs.log
timeout /t 25 /nobreak > nul

echo. >> deploy-logs.log
echo === DONE === >> deploy-logs.log
type deploy-logs.log
timeout /t 60 /nobreak > nul
exit
