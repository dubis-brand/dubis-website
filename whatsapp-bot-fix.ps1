# DUBIS - WhatsApp bot fix / autostart
# Starts the bridge + the bot, and registers BOTH as logon scheduled tasks so they
# survive a restart and are not killed by the Job Object of whatever window started them.
# Usage: powershell -ExecutionPolicy Bypass -File whatsapp-bot-fix.ps1 [-Root C:\whatsapp-mcp] [-WhatIf]

param([string]$Root = "C:\whatsapp-mcp", [switch]$WhatIf)

$ErrorActionPreference = "Stop"
function Say($t)  { Write-Host $t }
function OK($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Bad($t)  { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function Warn($t) { Write-Host "  [WARN] $t" -ForegroundColor Yellow }

Say ""
Say "=== DUBIS WhatsApp bot fix ==="
Say "root: $Root"
if ($WhatIf) { Warn "-WhatIf: showing what would happen, changing nothing" }
Say ""

if (-not (Test-Path $Root)) { Bad "root folder $Root not found - pass -Root <path>"; exit 1 }

# ── locate the pieces ─────────────────────────────────────────────────────────
$bridgeExe = Get-ChildItem -Path $Root -Recurse -Filter "*.exe" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'bridge|whatsapp' -or $_.DirectoryName -match 'bridge' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$botFile = Get-ChildItem -Path $Root -Recurse -Filter "bot.py" -File -ErrorAction SilentlyContinue | Select-Object -First 1
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source

if (-not $bridgeExe) { Bad "no bridge .exe found under $Root - build it first (go build in the bridge folder)"; exit 1 }
if (-not $botFile)   { Bad "bot.py not found under $Root"; exit 1 }
if (-not $uv)        { Warn "uv not on PATH - falling back to python"; $uv = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $uv)        { Bad "neither uv nor python found on PATH"; exit 1 }

OK "bridge: $($bridgeExe.FullName)"
OK "bot:    $($botFile.FullName)"
OK "runner: $uv"

# ── the kill switch wins over everything ──────────────────────────────────────
$paused = Get-ChildItem -Path $Root -Recurse -Filter "PAUSED*" -File -ErrorAction SilentlyContinue
if ($paused) {
  Say ""
  Warn "PAUSED kill-switch found - THIS ALONE keeps the bot silent. removing it:"
  foreach ($f in $paused) {
    Warn "   $($f.FullName)  (written $($f.LastWriteTime))"
    if (-not $WhatIf) { Remove-Item $f.FullName -Force }
  }
  OK "PAUSED removed - the bot is allowed to answer again"
  Say "   (to silence it again later: create an empty file named PAUSED in the bot folder)"
}

# ── ANTHROPIC_API_KEY ─────────────────────────────────────────────────────────
$key = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY","User")
if (-not $key) { $key = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY","Machine") }
if (-not $key) {
  Say ""
  Bad "ANTHROPIC_API_KEY is not set. set it yourself in a normal terminal (never paste it into a chat):"
  Say '      setx ANTHROPIC_API_KEY "sk-ant-..."'
  Say "   then run this script again."
  exit 1
}
OK "ANTHROPIC_API_KEY is set (length $($key.Length))"

# ── register both as logon tasks ──────────────────────────────────────────────
$argRunner = if ($uv -match 'uv(\.exe)?$') { "run `"$($botFile.FullName)`"" } else { "`"$($botFile.FullName)`"" }

$plan = @(
  @{ Name = "DUBIS-WhatsApp-Bridge"; Exe = $bridgeExe.FullName; Args = "";         Dir = $bridgeExe.DirectoryName },
  @{ Name = "DUBIS-WhatsApp-Bot";    Exe = $uv;                 Args = $argRunner; Dir = $botFile.DirectoryName   }
)

foreach ($p in $plan) {
  Say ""
  Say "-- $($p.Name) --"
  $existing = Get-ScheduledTask -TaskName $p.Name -ErrorAction SilentlyContinue
  if ($existing) { OK "task already exists - re-registering with current paths" }
  if ($WhatIf) { Warn "would register: $($p.Exe) $($p.Args)   (working dir $($p.Dir))"; continue }

  if ([string]::IsNullOrWhiteSpace($p.Args)) {
    $action = New-ScheduledTaskAction -Execute $p.Exe -WorkingDirectory $p.Dir
  } else {
    $action = New-ScheduledTaskAction -Execute $p.Exe -Argument $p.Args -WorkingDirectory $p.Dir
  }
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 2) -RestartCount 30 `
                -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $p.Name -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Limited -Force | Out-Null
  OK "registered (at logon, auto-restart every 2 min if it dies, no time limit)"

  Stop-ScheduledTask -TaskName $p.Name -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $p.Name
  OK "started now"
}

if ($WhatIf) { Say ""; Warn "-WhatIf: nothing was changed."; exit 0 }

Say ""
Say "waiting 10s for both to come up..."
Start-Sleep -Seconds 10

Say ""
Say "=== state after fix ==="
foreach ($p in $plan) {
  $i = Get-ScheduledTask -TaskName $p.Name | Get-ScheduledTaskInfo
  Say "  $($p.Name): lastRun=$($i.LastRunTime) result=$($i.LastTaskResult)"
}

$alive = $true

$bridgeUp = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match [regex]::Escape($bridgeExe.FullName) }
if ($bridgeUp) { OK "bridge process is alive (PID $($bridgeUp.ProcessId -join ','))" }
else { Bad "bridge did NOT come up"; $alive = $false }

$botUp = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'bot\.py' }
if ($botUp) { OK "bot.py is alive (PID $($botUp.ProcessId -join ','))" }
else { Bad "bot.py did NOT come up"; $alive = $false }

$portUp = $false
foreach ($port in 8080,8081,3000,5000) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); if ($c.Connected) { OK "bridge REST is answering on port $port"; $portUp = $true } } catch {}
  finally { $c.Close() }
}
if (-not $portUp) { Bad "no bridge port is answering - it may be waiting for a QR scan (WhatsApp logged the device out)"; $alive = $false }

Say ""
if ($alive) {
  Write-Host "=== LIVE. both survive a restart from now on. ===" -ForegroundColor Green
  Say "send a WhatsApp from ANOTHER phone to test - the bot never answers itself."
} else {
  Write-Host "=== NOT fully up - run whatsapp-bot-doctor.bat and read the VERDICT ===" -ForegroundColor Red
  Say "the most common cause at this point is a dead WhatsApp pairing: run the bridge in a"
  Say "visible window, scan the QR from the phone, then run this script again."
}
Say ""
