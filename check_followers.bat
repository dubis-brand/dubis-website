@echo off
cd /d "%~dp0"
set TOKEN=EAANDvW3YpEUBRPardkZC8ENSCsX3h717HsVFFptJKAS5bBy0Tmyip3zkPAqxunRZBNpznbc4ZCXs3Gcbe18N6Ql2omp8g6ItD0m8gZAGOgQTIZAvcc07qG02W1XZC5gI0iItSLgdslM8p8cHUadiL0mHAD7izuJe35oObqCWadK04bxEY7k84EPpnL6oxoogZDZD
set IG_ID=17841442639622598

echo === Checking DUBIS Instagram Followers ===
echo.

echo --- Follower count + basic stats ---
curl.exe -s "https://graph.facebook.com/v19.0/%IG_ID%?fields=username,followers_count,follows_count,media_count&access_token=%TOKEN%" > followers_stats.json
type followers_stats.json
echo.

echo --- Follower count trend (last 30 days) ---
curl.exe -s "https://graph.facebook.com/v19.0/%IG_ID%/insights?metric=follower_count&period=day&since=2026-03-15&until=2026-04-14&access_token=%TOKEN%" > follower_trend.json
type follower_trend.json
echo.

echo --- Recent followers (individual profiles) ---
curl.exe -s "https://graph.facebook.com/v19.0/%IG_ID%/followers?fields=id,username,profile_picture_url,followers_count,follows_count,media_count,biography&limit=50&access_token=%TOKEN%" > recent_followers.json
type recent_followers.json
echo.

echo === Done! See followers_stats.json / follower_trend.json / recent_followers.json ===
pause
