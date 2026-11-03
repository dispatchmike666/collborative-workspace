# Keeps the Glasshouse hub and helper running in the background, and starts either one again
# if it stops. Started hidden at login by the "Glasshouse" task (see install.ps1).
# Safe to start by hand too: a second copy sees the first and quits.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Only one copy at a time for this Windows account.
$mutex = New-Object System.Threading.Mutex($false, 'Local\GlasshouseAutostart')
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
  Write-AutostartLog 'Glasshouse is already running in the background. This extra copy is quitting.'
  exit 0
}

if (-not (Test-Path $SettingsFile)) {
  Write-AutostartLog "No settings found at $SettingsFile. Run install.ps1 first."
  exit 1
}
$settings = Get-Content -Path $SettingsFile -Raw | ConvertFrom-Json

# If an earlier copy was ended suddenly, its hub or helper may still be running. Stop those
# first, or the new hub would find its port taken and there would be two helpers.
if (Test-Path $RunningFile) {
  try {
    $old = Get-Content -Path $RunningFile -Raw | ConvertFrom-Json
    foreach ($child in @($old.children)) {
      if (Stop-RecordedProcess $child) { Write-AutostartLog "Stopped a $($child.name) left over from last time." }
    }
  } catch { }
}

function Get-HelperToken {
  # Saved by install.ps1, locked so only this Windows account on this computer can read it.
  $secure = ConvertTo-SecureString $settings.helperToken
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$parts = @()
if ($settings.runHub) {
  $hubEnv = @{ PORT = [string]$settings.port }
  if ($settings.hubPublicHost) { $hubEnv.HUB_PUBLIC_HOST = [string]$settings.hubPublicHost }
  $parts += @{ name = 'hub'; script = 'hub\index.js'; env = $hubEnv }
}
if ($settings.runHelper) {
  try { $token = Get-HelperToken } catch {
    Write-AutostartLog 'Could not read the saved helper token (it only opens for the Windows account that saved it). Run install.ps1 again.'
    exit 1
  }
  $helperEnv = @{ HUB_URL = [string]$settings.hubUrl; HELPER_TOKEN = $token }
  $parts += @{ name = 'helper'; script = 'helper\index.js'; env = $helperEnv }
}
foreach ($part in $parts) {
  $part.process = $null
  $part.startedAt = $null
  $part.waitSeconds = 5
  $part.nextStart = Get-Date
}

function Save-Running {
  $me = Get-Process -Id $PID
  $children = @()
  foreach ($part in $parts) {
    if ($part.process -and -not $part.process.HasExited) {
      $children += @{ name = $part.name; pid = $part.process.Id; started = $part.process.StartTime.ToString('o') }
    }
  }
  $record = @{ runner = @{ pid = $PID; started = $me.StartTime.ToString('o') }; children = $children }
  $record | ConvertTo-Json -Depth 4 | Set-Content -Path $RunningFile
}

# Keeps the newest log under about 5 MB. The one before is kept as name.old.log.
function Limit-Log([string]$Path) {
  if ((Test-Path $Path) -and (Get-Item $Path).Length -gt 5MB) {
    Move-Item -Path $Path -Destination ($Path -replace '\.log$', '.old.log') -Force
  }
}

function Start-Part($part) {
  $log = Join-Path $LogDir "$($part.name).log"
  Limit-Log $log
  Add-Content -Path $log -Value ('==== Started {0} ====' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

  # cmd.exe writes everything the program prints into its log file. UseShellExecute off and
  # CreateNoWindow off mean it shares this script's hidden window, so nothing shows on screen.
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $env:ComSpec
  $info.Arguments = '/d /s /c ""{0}" "{1}" >> "{2}" 2>&1"' -f $settings.node, $part.script, $log
  $info.WorkingDirectory = $RepoRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $false
  foreach ($key in $part.env.Keys) { $info.EnvironmentVariables[$key] = $part.env[$key] }

  $part.process = [System.Diagnostics.Process]::Start($info)
  $part.startedAt = Get-Date
  Write-AutostartLog "Started the $($part.name)."
}

Write-AutostartLog "Starting Glasshouse from $RepoRoot"
while ($true) {
  $now = Get-Date
  $changed = $false
  foreach ($part in $parts) {
    if ($part.process -and $part.process.HasExited) {
      $code = $part.process.ExitCode
      $ranFor = [int]($now - $part.startedAt).TotalSeconds
      # Something that stops straight away is retried less and less often (up to every
      # 5 minutes) so a lasting problem does not spin. After a good run, retry quickly.
      if ($ranFor -ge 120) { $part.waitSeconds = 5 } else { $part.waitSeconds = [Math]::Min($part.waitSeconds * 2, 300) }
      Write-AutostartLog ("The {0} stopped (exit code {1}) after {2} seconds. Starting it again in {3} seconds. Its log: {4}" -f $part.name, $code, $ranFor, $part.waitSeconds, (Join-Path $LogDir "$($part.name).log"))
      $part.process.Dispose()
      $part.process = $null
      $part.nextStart = $now.AddSeconds($part.waitSeconds)
      $changed = $true
    }
    if (-not $part.process -and $now -ge $part.nextStart) {
      try {
        Start-Part $part
      } catch {
        Write-AutostartLog "Could not start the $($part.name): $($_.Exception.Message)"
        $part.nextStart = $now.AddSeconds(60)
      }
      $changed = $true
    }
  }
  if ($changed) {
    try { Save-Running } catch { Write-AutostartLog "Could not save the list of running programs: $($_.Exception.Message)" }
  }
  Start-Sleep -Seconds 3
}
