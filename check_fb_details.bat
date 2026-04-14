@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD
set PAGE_ID=947252321814810
set IG_ID=17841442639622598

echo === DUBIS Facebook Page Deep Analysis ===
echo.

echo --- Page Access Token (needed for fan details) ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%?fields=access_token&access_token=%TOKEN%" > fb_page_token.json
type fb_page_token.json
echo.

echo --- Get page fans/followers with profile details ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/fans?fields=id,name,fan_count,followers_count,likes&access_token=%TOKEN%" > fb_fans.json
type fb_fans.json
echo.

echo --- Page insights - new followers last 28 days ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/insights/page_fan_adds_unique/day?since=2026-03-14&until=2026-04-14&access_token=%TOKEN%" > fb_fan_adds.json
type fb_fan_adds.json
echo.

echo --- Page messages/conversations ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/conversations?fields=id,snippet,unread_count,updated_time,participants&access_token=%TOKEN%" > fb_messages.json
type fb_messages.json
echo.

echo --- Token permissions ---
curl.exe -s "https://graph.facebook.com/v19.0/me/permissions?access_token=%TOKEN%" > fb_permissions.json
type fb_permissions.json
echo.

echo --- Instagram recent followers (business discovery) ---
curl.exe -s "https://graph.facebook.com/v19.0/%IG_ID%?fields=followers_count,follows_count,media_count,profile_picture_url,website&access_token=%TOKEN%" > ig_profile.json
type ig_profile.json
echo.

echo === Done! ===
pause
