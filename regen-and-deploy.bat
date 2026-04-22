@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================
echo  DUBIS Regenerate Designs + Deploy
echo  Triggered autonomously 2026-04-21
echo ============================================

echo.
echo [1/5] Running generate-designs.js...
call node scripts/generate-designs.js > regen.log 2>&1
if errorlevel 1 (
  echo DESIGN GENERATION FAILED - see regen.log
  type regen.log
  pause
  exit /b 1
)
echo    Done. Log tail:
powershell -Command "Get-Content regen.log -Tail 8"

echo.
echo [2/5] Git cleanup lock files...
if exist ".git\HEAD.lock"  del ".git\HEAD.lock"
if exist ".git\index.lock" del ".git\index.lock"

echo.
echo [3/5] Git add/commit/push...
git add designs/
git add scripts/generate-designs.js
git add api/create-gelato-order.js
git add js/products.js
git commit -m "designs: regenerate 900px DUBIS(TM) front + add products 17,18 + validator + price sync [autonomy-2026-04-21]"
git pull --rebase origin main
git push origin main
if errorlevel 1 (
  echo GIT PUSH FAILED
  pause
  exit /b 2
)

echo.
echo [4/5] Vercel auto-deploy will run on push. Waiting 20 seconds...
timeout /t 20 /nobreak > nul

echo.
echo [5/5] Smoke test — fetch production design URL...
curl.exe -s -o nul -w "front_logo_white.png HTTP=%%{http_code} size=%%{size_download}\n" "https://www.dubis.net/designs/front_logo_white.png?v=2026042101"
curl.exe -s -o nul -w "back_design_1_white.png HTTP=%%{http_code} size=%%{size_download}\n" "https://www.dubis.net/designs/back_design_1_white.png?v=2026042101"
curl.exe -s -o nul -w "back_design_17_white.png HTTP=%%{http_code} size=%%{size_download}\n" "https://www.dubis.net/designs/back_design_17_white.png?v=2026042101"
curl.exe -s -o nul -w "back_design_18_white.png HTTP=%%{http_code} size=%%{size_download}\n" "https://www.dubis.net/designs/back_design_18_white.png?v=2026042101"

echo.
echo ============================================
echo  DONE
echo ============================================
echo Closes in 30 seconds...
timeout /t 30 /nobreak > nul
exit
