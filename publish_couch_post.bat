@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD
set IG_ID=17841442639622598
set TASK_ID=e0218710-7e9c-495e-86de-f6154203c7c9

echo === Publishing DUBIS Post - Couch Post (Hebrew) ===
echo Image: dubis_photo_10.jpg (curvy_woman, nature, quality 5)
echo.

echo --- Step 1: Create media container ---
curl.exe -s -X POST "https://graph.facebook.com/v19.0/%IG_ID%/media" ^
  -d "image_url=https://dubis.net/images/dubis_photo_10.jpg" ^
  -d "caption=%D7%99%D7%A9%20%D7%9E%D7%A6%D7%91%D7%99%D7%9D%20%D7%91%D7%97%D7%99%D7%99%D7%9D%2C%20%D7%91%D7%A2%D7%99%D7%A7%D7%A8%20%D7%90%D7%97%D7%A8%D7%99%20%D7%92%D7%99%D7%9C%20%D7%9E%D7%A1%D7%95%D7%99%D7%9D%2C%20%D7%A9%D7%94%D7%A1%D7%A4%D7%94%20%D7%94%D7%99%D7%90%20%D7%9C%D7%90%20%D7%A8%D7%94%D7%99%D7%98.%20%D7%94%D7%99%D7%90%20%D7%9E%D7%A7%D7%9C%D7%98.%20%D7%9E%D7%A7%D7%95%D7%9D%20%D7%9E%D7%A4%D7%9C%D7%98.%20%D7%A1%D7%95%D7%92%20%D7%A9%D7%9C%20%D7%97%D7%91%D7%A8%20%D7%95%D7%AA%D7%99%D7%A7%20%D7%A9%D7%9C%D7%90%20%D7%A9%D7%95%D7%A4%D7%98.%0A%D7%90%D7%96%20%D7%9C%D7%9E%D7%94%20%D7%9C%D7%9C%D7%91%D7%95%D7%A9%20%D7%91%D7%92%D7%93%20%D7%A9%D7%9C%D7%90%20%D7%9E%D7%91%D7%99%D7%9F%20%D7%90%D7%AA%20%D7%96%D7%94%3F%20%D7%97%D7%95%D7%9C%D7%A6%D7%95%D7%AA%20%D7%9C%D7%95%D7%A0%D7%92%D7%A1%D7%9C%D7%99%D7%91%20%D7%9B%D7%9E%D7%95%20%D7%96%D7%95%2C%20%D7%A2%D7%9D%20%D7%94%D7%9B%D7%99%D7%AA%D7%95%D7%91%20%27%D7%A7%D7%A9%D7%95%D7%A8%20%D7%A8%D7%92%D7%A9%D7%99%D7%AA%20%D7%9C%D7%A1%D7%A4%D7%94%20%D7%A9%D7%9C%D7%99%27%2C%20%D7%94%D7%9F%20%D7%9C%D7%90%20%D7%A1%D7%AA%D7%9D%20%D7%91%D7%92%D7%93.%0A%D7%94%D7%9F%20%D7%94%D7%A6%D7%94%D7%A8%D7%94.%20%D7%A9%D7%90%D7%A0%D7%97%D7%A0%D7%95%20%D7%A4%D7%94.%20%D7%A2%D7%9D%20%D7%9B%D7%9C%20%D7%94%D7%A0%D7%95%D7%97%D7%95%D7%AA.%20%D7%95%D7%9B%D7%9C%20%D7%94%D7%90%D7%9E%D7%AA.%20%D7%9C%D7%90%20%D7%9E%D7%AA%D7%9B%D7%95%D7%95%D7%A6%D7%99%D7%9D%20%D7%91%D7%A0%D7%A9%D7%9E%D7%94.%20%D7%9B%D7%99%20%D7%AA%D7%9B%D7%9C%27%D7%A1%2C%20%D7%90%D7%A0%D7%97%D7%A0%D7%95%20%D7%93%D7%95%D7%A8%D7%A9%D7%99%D7%9D%20%D7%99%D7%95%D7%AA%D7%A8%20%D7%9E%D7%91%D7%92%D7%93.%0A%D7%96%D7%94%20%D7%9C%D7%90%20%D7%91%D7%92%D7%93.%20%D7%96%D7%94%20%D7%90%D7%95%D7%A8%D7%97%20%D7%97%D7%99%D7%99%D7%9D.%0A%23DUBIS%20%23ForTheRestOfUs%20%23AntiFashion%20%23RealLife%20%23ComfortFirst%20%23QualityOverQuantity%20%23SlowFashion%20%23After40%20%23CouchLife%20%23UnapologeticallyYou" ^
  -d "access_token=%TOKEN%" > container2.json
type container2.json
echo.

echo --- Step 2: Wait 7 seconds for Instagram to process ---
timeout /t 7 /nobreak > nul

echo --- Step 3: Extract container ID and publish ---
setlocal enabledelayedexpansion
for /f "tokens=2 delims=:," %%a in ('type container2.json ^| findstr /r "\"id\":"') do (
  set CID=%%~a
  set CID=!CID: =!
  set CID=!CID:"=!
  set CID=!CID:}=!
)

echo Container ID: !CID!
curl.exe -s -X POST "https://graph.facebook.com/v19.0/%IG_ID%/media_publish" ^
  -d "creation_id=!CID!" ^
  -d "access_token=%TOKEN%" > publish2.json
type publish2.json
echo.
endlocal

echo === Done! Check Instagram @dubis.brand ===
pause
