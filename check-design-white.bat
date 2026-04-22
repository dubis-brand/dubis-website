@echo off
cd /d "%~dp0"
curl.exe -sSL --max-time 30 "https://www.dubis.net/designs/back_design_8_white.png" -o design_8_white.png
curl.exe -sSL --max-time 30 "https://www.dubis.net/designs/back_design_1_white.png" -o design_1_white.png
dir design_8_white.png design_1_white.png > designs-white-check.txt 2>&1
type designs-white-check.txt
timeout /t 3
exit
