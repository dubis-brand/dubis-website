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
  Warn "a PAUSED file exists - the bot will stay silent until it is deleted:"
  foreach ($f in $paused) { Warn "   $($f.FullName)" }
  $ans = Read-Host "delete it and let the bot answer again? (yes/no)"
  if ($ans -eq 'yes') { if (-not $WhatIf) { $paused | Remove-Item -Force }; OK "PAUSED removed" }
  else { Warn "left in place - the bot will NOT answer" }
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

Start-Sleep -Seconds 6
Say ""
Say "=== state after fix ==="
foreach ($p in $plan) {
  $i = Get-ScheduledTask -TaskName $p.Name | Get-ScheduledTaskInfo
  Say "  $($p.Name): lastRun=$($i.LastRunTime) result=$($i.LastTaskResult)"
}
Say ""
Say "now send yourself a WhatsApp from ANOTHER phone (the bot never answers itself)."
Say "still silent? run whatsapp-bot-doctor.bat and read the VERDICT."
Say ""
