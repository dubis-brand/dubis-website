@echo off
cd /d "%~dp0"
curl.exe -sSL --max-time 60 -o reference_product_8_black.jpg "https://www.dubis.net/images/product-8-Black-front.jpg"
dir reference_product_8_black.jpg > ref-log.txt
exit
