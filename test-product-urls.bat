@echo off
cd /d "%~dp0"
echo === URL TEST %TIME% === > url-test.txt

for %%U in (
  "https://www.dubis.net/images/product-8-front.jpg"
  "https://www.dubis.net/images/product-8-Black-front.jpg"
  "https://www.dubis.net/images/product-8-Charcoal-front.jpg"
  "https://www.dubis.net/images/product-8-Navy-front.jpg"
  "https://www.dubis.net/images/product-8-Red-front.jpg"
  "https://www.dubis.net/images/product-8-Forest-Green-front.jpg"
) do (
  echo. >> url-test.txt
  echo URL: %%~U >> url-test.txt
  curl.exe -sI -o nul -w "HTTP %%{http_code}  size=%%{size_download}" --max-time 15 %%U >> url-test.txt
  echo. >> url-test.txt
)

echo. >> url-test.txt
echo === END %TIME% === >> url-test.txt
exit
