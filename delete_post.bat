@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD
set IG_MEDIA_ID=17917536561343398

echo === Deleting bad post from Instagram ===
curl.exe -s -X DELETE "https://graph.facebook.com/v19.0/%IG_MEDIA_ID%?access_token=%TOKEN%"
echo.
echo === Done! ===
pause
