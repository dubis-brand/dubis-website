@echo off
cd /d "%~dp0"
echo === GIT STATUS ===
git status --short > git-status.txt 2>&1
type git-status.txt
echo.
echo === GIT ADD main.js ===
git add js/main.js >> git-status.txt 2>&1
echo === GIT COMMIT ===
git commit -m "fix: add ?p=N query param handler for IG/FB deep links (FB strips hash fragment via l.facebook.com)" >> git-status.txt 2>&1
echo === GIT PUSH ===
git push origin main >> git-status.txt 2>&1
echo === DONE ===
type git-status.txt
timeout /t 5
exit
