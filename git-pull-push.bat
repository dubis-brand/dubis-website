@echo off
cd /d "%~dp0"
echo === GIT PULL --REBASE === > git-push-log.txt 2>&1
git pull --rebase origin main >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT PUSH === >> git-push-log.txt
git push origin main >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT LOG (last 3) === >> git-push-log.txt
git log -3 --oneline >> git-push-log.txt 2>&1
type git-push-log.txt
timeout /t 5
exit
