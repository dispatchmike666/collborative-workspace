# Shared by install.ps1, uninstall.ps1 and run-glasshouse.ps1. Not run on its own.
# Everything here is plain ASCII on purpose: Windows PowerShell 5.1 misreads other characters
# in files saved without a byte-order mark.

$TaskName = 'Glasshouse'

# The Glasshouse folder is found from where this script sits (scripts\autostart), never a fixed
# path, so the folder can be moved. After a move, run install.ps1 again to point the task at it.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Private, per-person files: settings (with the helper token locked to this Windows account),
# the list of running programs, and the logs. Kept outside the Glasshouse folder so they are
# never committed to GitHub.
$DataDir = Join-Path $env:LOCALAPPDATA 'Glasshouse'
$LogDir = Join-Path $DataDir 'logs'
$SettingsFile = Join-Path $DataDir 'autostart.json'
$RunningFile = Join-Path $DataDir 'running.json'

function Write-AutostartLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path (Join-Path $LogDir 'autostart.log') -Value $line
}

# Stops one program and every program it started (taskkill /T), but only if it is still the
# same program that was recorded: Windows reuses process numbers, so the start time is checked.
function Stop-RecordedProcess($Entry) {
  if (-not $Entry -or -not $Entry.pid) { return $false }
  $process = Get-Process -Id ([int]$Entry.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  try { $started = $process.StartTime.ToString('o') } catch { return $false }
  if ($started -ne $Entry.started) { return $false }
  & taskkill.exe /PID ([int]$Entry.pid) /T /F 2>&1 | Out-Null
  return $true
}

# Stops the background runner, the hub and the helper if they are running. Safe to call when
# nothing is running.
function Stop-Glasshouse {
  $stopped = $false
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  if (Test-Path $RunningFile) {
    try {
      $running = Get-Content -Path $RunningFile -Raw | ConvertFrom-Json
      if (Stop-RecordedProcess $running.runner) { $stopped = $true }
      foreach ($child in @($running.children)) {
        if (Stop-RecordedProcess $child) { $stopped = $true }
      }
    } catch {
      # A damaged file only means there is nothing we can safely stop.
    }
    Remove-Item -Path $RunningFile -Force -ErrorAction SilentlyContinue
  }
  if ($stopped) { Start-Sleep -Seconds 1 }
  return $stopped
}
