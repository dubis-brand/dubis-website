@echo off
cd /d "%~dp0"
echo === DOWNLOAD START %DATE% %TIME% === > download-log.txt
echo Working dir: %CD% >> download-log.txt

curl.exe -sSL --max-time 60 -o post_f1b34cb6.jpg "https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object/public/ig-images/ig-f1b34cb6-2a3d-4d43-8536-895e1794d8f0.jpg" 2>>download-log.txt
echo Exit code post: %ERRORLEVEL% >> download-log.txt
dir post_f1b34cb6.jpg >> download-log.txt 2>&1

curl.exe -sSL --max-time 60 -o reference_product_8.jpg "https://www.dubis.net/images/product-8-front.jpg" 2>>download-log.txt
echo Exit code ref: %ERRORLEVEL% >> download-log.txt
dir reference_product_8.jpg >> download-log.txt 2>&1

echo === DOWNLOAD END %TIME% === >> download-log.txt
exit
