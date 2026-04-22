@echo off
cd /d "%~dp0"
py -3 analyze_png.py design_1_dark.png design_1_white.png design_8_dark.png design_8_white.png > png-analysis.txt 2>&1
type png-analysis.txt
timeout /t 5
exit
