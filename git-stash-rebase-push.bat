@echo off
cd /d "%~dp0"
echo === GIT STASH === > git-push-log.txt 2>&1
git stash push -u -m "pre-rebase stash" supabase/functions/agents/index.ts >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT PULL --REBASE === >> git-push-log.txt
git pull --rebase origin main >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT PUSH === >> git-push-log.txt
git push origin main >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT STASH POP === >> git-push-log.txt
git stash pop >> git-push-log.txt 2>&1
echo. >> git-push-log.txt
echo === GIT LOG (last 5) === >> git-push-log.txt
git log -5 --oneline >> git-push-log.txt 2>&1
type git-push-log.txt
timeout /t 5
exit
