# DUBIS — WhatsApp bot doctor (read-only)
# Diagnoses why the WhatsApp bot stopped answering. Changes nothing.
# Usage:  powershell -ExecutionPolicy Bypass -File whatsapp-bot-doctor.ps1 [-Root C:\whatsapp-mcp]

param([string]$Root = "C:\whatsapp-mcp")

$ErrorActionPreference = "SilentlyContinue"
$findings = @()
function Say($t)  { Write-Host $t }
function OK($t)   { Write-Host "  [OK]   $t"   -ForegroundColor Green }
function Bad($t)  { Write-Host "  [FAIL] $t"   -ForegroundColor Red;    $script:findings += $t }
function Warn($t) { Write-Host "  [WARN] $t"   -ForegroundColor Yellow }
function Info($t) { Write-Host "         $t"   -ForegroundColor DarkGray }

Say ""
Say "=== DUBIS WhatsApp bot doctor ==="
Say "root: $Root    time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say ""

# ── 0. root ───────────────────────────────────────────────────────────────────
if (-not (Test-Path $Root)) {
  Bad "root folder $Root not found - pass the real path: -Root <path>"
  Say ""; Say "cannot continue without the root folder."; exit 1
}
OK "root folder exists"

# ── 1. bridge process (Go / whatsmeow) ────────────────────────────────────────
Say ""; Say "-- 1. bridge (Go) --"
$bridgeProcs = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'bridge|whatsapp' -or $_.CommandLine -match 'whatsapp-bridge' }
if ($bridgeProcs) {
  foreach ($p in $bridgeProcs) { OK "running: PID $($p.ProcessId)  $($p.Name)" ; Info $p.CommandLine }
} else {
  Bad "bridge process is NOT running - nothing is receiving WhatsApp messages"
}

# ── 2. bridge REST port ───────────────────────────────────────────────────────
Say ""; Say "-- 2. bridge REST port --"
$portFound = $false
foreach ($port in 8080,8081,3000,5000) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); if ($c.Connected) { OK "port $port is listening"; $portFound = $true } } catch {}
  finally { $c.Close() }
}
if (-not $portFound) { Bad "no local bridge port answering (8080/8081/3000/5000) - bot cannot send even if it is alive" }

# ── 3. scheduled tasks ────────────────────────────────────────────────────────
Say ""; Say "-- 3. scheduled tasks --"
$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -match 'WhatsApp' }
if ($tasks) {
  foreach ($t in $tasks) {
    $i = $t | Get-ScheduledTaskInfo
    $line = "$($t.TaskName): state=$($t.State) lastRun=$($i.LastRunTime) result=$($i.LastTaskResult)"
    if ($t.State -eq 'Disabled') { Bad $line } else { OK $line }
  }
  if (-not ($tasks.TaskName -match 'Bot')) {
    Bad "no scheduled task for the BOT itself (only the bridge) - the bot dies with the window that started it and never comes back after a restart"
  }
} else {
  Bad "no WhatsApp scheduled task at all - neither bridge nor bot restarts on login"
}

# ── 4. bot process ────────────────────────────────────────────────────────────
Say ""; Say "-- 4. bot process (bot.py) --"
$botProcs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'bot\.py' }
if ($botProcs) { foreach ($p in $botProcs) { OK "running: PID $($p.ProcessId)  $($p.Name)"; Info $p.CommandLine } }
else { Bad "bot.py is NOT running - this alone explains total silence" }

# ── 5. PAUSED kill switch ─────────────────────────────────────────────────────
Say ""; Say "-- 5. PAUSED kill switch --"
$paused = Get-ChildItem -Path $Root -Recurse -Filter "PAUSED*" -File
if ($paused) { foreach ($f in $paused) { Bad "PAUSED file present: $($f.FullName)  (written $($f.LastWriteTime)) - delete it to resume" } }
else { OK "no PAUSED file" }

# ── 6. bot config as it actually is on disk ───────────────────────────────────
Say ""; Say "-- 6. bot.py config --"
$botFile = Get-ChildItem -Path $Root -Recurse -Filter "bot.py" -File | Select-Object -First 1
if ($botFile) {
  Info "file: $($botFile.FullName)  (modified $($botFile.LastWriteTime))"
  Select-String -Path $botFile.FullName -Pattern '^\s*[A-Z_]{3,}\s*=' |
    Where-Object { $_.Line -notmatch 'KEY|TOKEN|SECRET|PASSWORD' } |
    ForEach-Object { Info ("  " + $_.Line.Trim()) }
} else { Warn "bot.py not found under $Root" }

# ── 7. API key ────────────────────────────────────────────────────────────────
Say ""; Say "-- 7. ANTHROPIC_API_KEY --"
$u = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY","User")
$m = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY","Machine")
if ($u) { OK "set for the user (length $($u.Length)) - value not printed" }
elseif ($m) { OK "set machine-wide (length $($m.Length)) - value not printed" }
else { Bad "ANTHROPIC_API_KEY is not set - the bot cannot produce a single answer" }
Info "note: a process started BEFORE setx does not see the key. after setx, restart the bot."

# ── 8. message store freshness ────────────────────────────────────────────────
Say ""; Say "-- 8. message store (SQLite) --"
$db = Get-ChildItem -Path $Root -Recurse -Include "*.db" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($db) {
  $age = [int]((Get-Date) - $db.LastWriteTime).TotalMinutes
  Info "$($db.FullName)  size=$([math]::Round($db.Length/1MB,1))MB  last write=$($db.LastWriteTime)  ($age min ago)"
  if ($age -gt 60) { Bad "store has not been written for $age minutes - the bridge is not receiving messages (send yourself a WhatsApp now and re-run)" }
  else { OK "store is fresh ($age min)" }
} else { Warn "no .db store found under $Root" }

# ── 9. logs ───────────────────────────────────────────────────────────────────
Say ""; Say "-- 9. newest logs --"
$logs = Get-ChildItem -Path $Root -Recurse -Include "*.log","*.txt" -File |
  Where-Object { $_.Length -gt 0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 3
if ($logs) {
  foreach ($l in $logs) {
    Say ""
    Info "$($l.FullName)   (last write $($l.LastWriteTime))"
    Get-Content $l.FullName -Tail 12 | ForEach-Object { Write-Host "         | $_" -ForegroundColor DarkGray }
    $trouble = Select-String -Path $l.FullName -Pattern 'logged out|client outdated|401|403|rate.?limit|credit|traceback|connection refused' |
      Select-Object -Last 5
    foreach ($t in $trouble) { Bad "log hit: $($t.Line.Trim())" }
  }
} else { Warn "no log files found - the bot may never have started under logging" }

# ── verdict ───────────────────────────────────────────────────────────────────
Say ""
Say "=== VERDICT ==="
if ($findings.Count -eq 0) {
  Write-Host "Everything the doctor can see looks healthy." -ForegroundColor Green
  Say "If it still does not answer: send a message from a DIFFERENT phone (the bot never answers itself)"
  Say "and re-run. If the store timestamp does not move, the WhatsApp pairing is dead - re-scan the QR."
} else {
  Write-Host "$($findings.Count) problem(s) found, in order:" -ForegroundColor Red
  $i = 1; foreach ($f in $findings) { Write-Host "  $i. $f" -ForegroundColor Red; $i++ }
  Say ""
  Say "Most cases are fixed by: whatsapp-bot-fix.bat  (starts bridge + bot and makes both survive a restart)"
}
Say ""
