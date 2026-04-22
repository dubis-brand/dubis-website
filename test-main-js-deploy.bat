@echo off
cd /d "%~dp0"
echo === Test main.js has ?p=N handler === > main-js-test.txt 2>&1
echo. >> main-js-test.txt
curl.exe -sSL --max-time 30 "https://www.dubis.net/js/main.js" > main-live.js 2>> main-js-test.txt
dir main-live.js >> main-js-test.txt
echo. >> main-js-test.txt
echo === Searching for openFromQueryParam === >> main-js-test.txt
findstr /n /c:"openFromQueryParam" /c:"params.get('p')" /c:"?p=N" /c:"query-p" main-live.js >> main-js-test.txt 2>&1
echo. >> main-js-test.txt
echo === Commit ID check === >> main-js-test.txt
curl.exe -sSL --max-time 15 "https://www.dubis.net/" -I | findstr /I "etag x-vercel-id" >> main-js-test.txt 2>&1
echo. >> main-js-test.txt
echo === DONE === >> main-js-test.txt
type main-js-test.txt
timeout /t 5
exit
