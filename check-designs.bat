@echo off
cd /d "%~dp0"
echo === Checking design_back PNG files on dubis.net === > designs-check.txt 2>&1
echo. >> designs-check.txt
for %%N in (1 2 3 4 5 6 8 9 10 11 12 13 14 15 16) do (
  echo --- product %%N dark --- >> designs-check.txt
  curl.exe -sSI --max-time 15 "https://www.dubis.net/designs/back_design_%%N_dark.png" | findstr /I "HTTP/ content-type content-length" >> designs-check.txt
  echo --- product %%N white --- >> designs-check.txt
  curl.exe -sSI --max-time 15 "https://www.dubis.net/designs/back_design_%%N_white.png" | findstr /I "HTTP/ content-type content-length" >> designs-check.txt
)
echo. >> designs-check.txt
echo === Downloading product 1 dark for inspection === >> designs-check.txt
curl.exe -sSL --max-time 30 "https://www.dubis.net/designs/back_design_1_dark.png" -o design_1_dark.png
dir design_1_dark.png >> designs-check.txt
echo. >> designs-check.txt
echo === Downloading product 8 dark (today's post product) for inspection === >> designs-check.txt
curl.exe -sSL --max-time 30 "https://www.dubis.net/designs/back_design_8_dark.png" -o design_8_dark.png
dir design_8_dark.png >> designs-check.txt
echo. >> designs-check.txt
echo === DONE === >> designs-check.txt
type designs-check.txt
timeout /t 5
exit
