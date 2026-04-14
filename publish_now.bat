@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD
set IG_ID=17841442639622598
set TASK_ID=f9f59540-c7fe-46a1-8d15-93c8183ffed5

echo === Publishing DUBIS Post to Instagram ===
echo Post: more of me to LOVE (Hebrew)
echo Image: dubis_photo_04.jpg
echo.

echo --- Step 1: Create media container ---
curl.exe -s -X POST "https://graph.facebook.com/v19.0/%IG_ID%/media" ^
  -d "image_url=https://dubis.net/images/dubis_photo_04.jpg" ^
  -d "caption=כשאתה מחויב לספה שלך, אתה תכל'ס מחויב לעצמך. 'יותר ממני לאהוב' זו לא רק חולצה, זו הצהרה. #DUBIS #ForTheRestOfUs #CouchLife #NapGoals #JustBe #NoFilterFashion #RealComfort #UnapologeticallyYou #After40Style" ^
  -d "access_token=%TOKEN%" > container_result.json
type container_result.json
echo.

echo --- Step 2: Wait for container to process ---
timeout /t 5 /nobreak > nul

echo --- Step 3: Publish container ---
for /f "tokens=2 delims=:," %%a in ('type container_result.json ^| findstr "id"') do (
  set CONTAINER_ID=%%~a
  set CONTAINER_ID=!CONTAINER_ID: =!
  set CONTAINER_ID=!CONTAINER_ID:"=!
)

setlocal enabledelayedexpansion
for /f "tokens=2 delims=:," %%a in ('type container_result.json ^| findstr /r "\"id\":"') do (
  set CID=%%~a
  set CID=!CID: =!
  set CID=!CID:"=!
  set CID=!CID:}=!
)

echo Container ID: !CID!
curl.exe -s -X POST "https://graph.facebook.com/v19.0/%IG_ID%/media_publish" ^
  -d "creation_id=!CID!" ^
  -d "access_token=%TOKEN%" > publish_result.json
type publish_result.json
echo.
endlocal

echo === Done! ===
pause
