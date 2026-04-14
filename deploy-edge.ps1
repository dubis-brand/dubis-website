Set-Location -LiteralPath $PSScriptRoot
Write-Host "=== Working directory: $PWD ===" -ForegroundColor Green
Write-Host "=== Deploying Edge Function ===" -ForegroundColor Cyan
npx --yes supabase@2.89.1 functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb 2>&1 | Tee-Object -Variable result
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
