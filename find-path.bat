@echo off
cd /d "%~dp0"
echo CURRENT_DIR=%CD%
echo CURRENT_DIR=%CD% > "%~dp0\my-path.txt"
echo Path saved to my-path.txt
pause
