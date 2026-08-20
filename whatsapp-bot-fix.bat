@echo off
title DUBIS - WhatsApp bot fix
cd /d "%~dp0"
echo This starts the WhatsApp bridge + bot and makes both survive a restart.
echo The bot will start answering messages again.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0whatsapp-bot-fix.ps1" %*
echo.
pause
