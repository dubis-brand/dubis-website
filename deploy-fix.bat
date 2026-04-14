@echo off
echo ========================================
echo   DUBIS - Deploy Mobile Fix
echo ========================================
echo.

cd /d "%~dp0"

echo Removing git lock files...
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul
del /f /q ".git\index.lock.bak" 2>nul
del /f /q ".git\HEAD.lock.bak" 2>nul

echo Staging changes...
git add css/style.css js/main.js
if %errorlevel% neq 0 (
    echo ERROR: git add failed
    pause
    exit /b 1
)

echo Committing...
git commit -m "fix: sections invisible on mobile in-app browsers (Facebook/Instagram)"
if %errorlevel% neq 0 (
    echo ERROR: git commit failed
    pause
    exit /b 1
)

echo Pushing to GitHub...
git push
if %errorlevel% neq 0 (
    echo ERROR: git push failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo   SUCCESS! Vercel will auto-deploy.
echo   Wait 1-2 minutes, then check dubis.net
echo ========================================
echo.
pause
