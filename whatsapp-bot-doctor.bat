@echo off
title DUBIS - WhatsApp bot doctor
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0whatsapp-bot-doctor.ps1" %*
echo.
pause
