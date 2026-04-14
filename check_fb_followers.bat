@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD

echo === Checking DUBIS Facebook Pages ===
echo.

echo --- Pages connected to this token ---
curl.exe -s "https://graph.facebook.com/v19.0/me/accounts?fields=id,name,fan_count,followers_count,category&access_token=%TOKEN%" > fb_pages.json
type fb_pages.json
echo.

echo --- Token info (permissions check) ---
curl.exe -s "https://graph.facebook.com/v19.0/me?fields=id,name&access_token=%TOKEN%" > fb_me.json
type fb_me.json
echo.

echo === Done! ===
pause
