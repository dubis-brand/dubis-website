@echo off
cd /d "%~dp0"
set PAGE_TOKEN=EAANDvW3YpEUBRMP3IL4IaXuxPZCzFezZAZAuP81mg5jTPOZC4j7spF2xOqs1hVXrut7o7zupzygAp69GZAzoZAZBWcFiJNoveRXfAI78pIlDvnuXK9UoN9lLhZAZCjmLZC8HUg18lkTtoCdw8Wi2mhXF1rZCR7uZAfZCm7Iqs3DRFw7mMCi3bmhTHMB1yrdWTGt9BbrOtiGbJ
set PAGE_ID=947252321814810

echo === DUBIS Facebook Inbox + Followers Analysis ===
echo.

echo --- Messenger conversations (inbox) ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/conversations?fields=id,snippet,unread_count,updated_time,participants&limit=25&access_token=%PAGE_TOKEN%" > fb_inbox.json
type fb_inbox.json
echo.
echo.

echo --- Instagram conversations (inbox) ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/conversations?platform=instagram&fields=id,snippet,unread_count,updated_time,participants&limit=25&access_token=%PAGE_TOKEN%" > ig_inbox.json
type ig_inbox.json
echo.
echo.

echo --- Page followers (with page token) ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/followers?fields=id,name&limit=50&access_token=%PAGE_TOKEN%" > fb_followers_page.json
type fb_followers_page.json
echo.
echo.

echo --- Page insights - fan adds ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/insights?metric=page_fan_adds&period=day&since=2026-03-14&until=2026-04-14&access_token=%PAGE_TOKEN%" > fb_fan_adds2.json
type fb_fan_adds2.json
echo.
echo.

echo --- Page tagged / check-ins ---
curl.exe -s "https://graph.facebook.com/v19.0/%PAGE_ID%/tagged?fields=id,from,message,created_time&limit=20&access_token=%PAGE_TOKEN%" > fb_tagged.json
type fb_tagged.json
echo.

echo === Done! ===
pause
