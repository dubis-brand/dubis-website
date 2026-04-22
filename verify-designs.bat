@echo off
cd /d "%~dp0"
echo === DUBIS Design URLs Verification %date% %time% === > verify.log
echo. >> verify.log

for %%U in (
  "https://www.dubis.net/designs/front_logo_white.png"
  "https://www.dubis.net/designs/front_logo_dark.png"
  "https://www.dubis.net/designs/back_design_1_white.png"
  "https://www.dubis.net/designs/back_design_7_white.png"
  "https://www.dubis.net/designs/back_design_7_dark.png"
  "https://www.dubis.net/designs/back_design_17_white.png"
  "https://www.dubis.net/designs/back_design_17_dark.png"
  "https://www.dubis.net/designs/back_design_18_white.png"
  "https://www.dubis.net/designs/back_design_18_dark.png"
  "https://www.dubis.net/designs/cap_design_white.png"
) do (
  curl.exe -sI -o nul -w "HTTP=%%{http_code} bytes=%%{size_download} %%U\n" %%U?v=2026042101 >> verify.log
)

echo. >> verify.log
echo === done === >> verify.log
type verify.log
timeout /t 45 /nobreak > nul
exit
