<#
Makes Glasshouse start by itself, hidden, every time you log in to Windows, and starts it now.
If the hub or the helper stops, it is started again within seconds.

Run it from the Glasshouse folder in PowerShell:

  powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1

Only the helper (Max, or anyone whose hub runs on another computer):

  powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1 -HelperOnly -HubUrl https://the-hub-address

Run it again at any time to change a setting, after moving the folder, or after pulling new
code (it restarts both). To remove it: scripts\autostart\uninstall.ps1
#>
param(
  # Start only the helper. For someone who uses a hub on another computer.
  [switch]$HelperOnly,
  # Start only the hub, without your own helper.
  [switch]$HubOnly,
  # Where the helper finds the hub. Defaults to this computer's hub.
  [string]$HubUrl,
  # The hub's public name when it is reached through Tailscale or a web host (see docs/hosting.md).
  [string]$HubPublicHost,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Stop-WithMessage([string]$Message) {
  Write-Host ''
  Write-Host $Message -ForegroundColor Yellow
  exit 1
}

if ($env:OS -ne 'Windows_NT') { Stop-WithMessage 'This sets up Windows startup, so it only works on Windows.' }
if ($HelperOnly -and $HubOnly) { Stop-WithMessage 'Pick one of -HelperOnly or -HubOnly, or neither to start both.' }
$runHub = -not $HelperOnly
$runHelper = -not $HubOnly

# Settings saved last time, so running this again only changes what you ask it to change.
$previous = $null
if (Test-Path $SettingsFile) {
  try { $previous = Get-Content -Path $SettingsFile -Raw | ConvertFrom-Json } catch { $previous = $null }
}

# Node.js, found now and remembered, so the login task does not depend on PATH.
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { Stop-WithMessage 'Node.js was not found. Install version 22 or newer from nodejs.org, then run this again.' }
$node = $nodeCommand.Source
$nodeVersion = (& $node --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
  Stop-WithMessage "Node.js $nodeVersion is too old. Install version 22 or newer from nodejs.org, then run this again."
}

if ($runHub) {
  if (-not (Test-Path (Join-Path $RepoRoot 'hub-data\users.json'))) {
    Stop-WithMessage 'Nobody can log in to the hub yet. Add people first (npm run hub:add-user -- Brennan), then run this again.'
  }
  if (-not $HubPublicHost) { $HubPublicHost = $env:HUB_PUBLIC_HOST }
  if (-not $HubPublicHost -and $previous) { $HubPublicHost = $previous.hubPublicHost }
}

$protectedToken = $null
if ($runHelper) {
  if (-not $HubUrl -and $runHub) { $HubUrl = "http://localhost:$Port" }
  if (-not $HubUrl -and $previous -and $previous.hubUrl) { $HubUrl = $previous.hubUrl }
  if (-not $HubUrl) { $HubUrl = $env:HUB_URL }
  if (-not $HubUrl) { $HubUrl = Read-Host 'The hub address for your helper (for example https://workspace.something.ts.net)' }
  if (-not $HubUrl) { Stop-WithMessage 'The helper needs the hub address. Run this again with -HubUrl.' }

  # The helper token is saved locked to this Windows account on this computer (Windows' own
  # encryption), never as plain text.
  if ($env:HELPER_TOKEN) {
    $protectedToken = ConvertTo-SecureString $env:HELPER_TOKEN -AsPlainText -Force | ConvertFrom-SecureString
  } else {
    $hint = 'Paste your helper token (it will not show on screen)'
    if ($previous -and $previous.helperToken) { $hint += ', or press Enter to keep the saved one' }
    $typed = Read-Host $hint -AsSecureString
    if ($typed.Length -gt 0) {
      $protectedToken = ConvertFrom-SecureString $typed
    } elseif ($previous -and $previous.helperToken) {
      $protectedToken = $previous.helperToken
    } else {
      Stop-WithMessage 'The helper needs your helper token. It is in your private credentials file.'
    }
  }
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and $runHelper) {
  $claudeExe = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
  if (-not (Test-Path $claudeExe)) {
    Write-Host 'Note: Claude Code was not found on this computer. The helper will start, but cannot run Claude until it is installed.' -ForegroundColor Yellow
  }
}

# Stop anything already running, so new code and new settings take effect.
if (Stop-Glasshouse) { Write-Host 'Stopped the copy that was already running.' }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$settings = [ordered]@{
  node = $node
  runHub = $runHub
  runHelper = $runHelper
  port = $Port
  hubPublicHost = $(if ($runHub) { [string]$HubPublicHost } else { '' })
  hubUrl = $(if ($runHelper) { [string]$HubUrl } else { '' })
  helperToken = $(if ($runHelper) { $protectedToken } else { '' })
}
$settings | ConvertTo-Json | Set-Content -Path $SettingsFile

# The login task. Interactive: it runs as you, on your desktop, with your own GitHub and Claude
# logins, but its window is hidden. No time limit, and Windows retries it if it fails to start.
$user = "$env:USERDOMAIN\$env:USERNAME"
$launcher = Join-Path $PSScriptRoot 'start-hidden.vbs'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('//B //Nologo "{0}"' -f $launcher) -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings `
    -Description 'Starts the Glasshouse hub and helper, hidden, when you log in. Added by scripts\autostart\install.ps1.' -Force | Out-Null
} catch {
  Stop-WithMessage ("Windows would not add the login task ({0}). Open PowerShell with 'Run as administrator' and run the same command again." -f $_.Exception.Message)
}

Start-ScheduledTask -TaskName $TaskName
Write-AutostartLog 'Installed and started by install.ps1.'

Write-Host ''
Write-Host 'Glasshouse will now start by itself, hidden, each time you log in to Windows.' -ForegroundColor Green
if ($runHub) {
  $up = $false
  for ($i = 0; $i -lt 20 -and -not $up; $i++) {
    Start-Sleep -Seconds 1
    $probe = New-Object System.Net.Sockets.TcpClient
    try { $probe.Connect('127.0.0.1', $Port); $up = $true } catch { } finally { $probe.Close() }
  }
  if ($up) { Write-Host "The hub is running: http://localhost:$Port" }
  else { Write-Host "The hub has not answered yet. If it still does not, look in $LogDir\hub.log" -ForegroundColor Yellow }
}
if ($runHelper) { Write-Host "The helper connects to $HubUrl. Its log: $LogDir\helper.log" }
Write-Host "Logs are in $LogDir"
Write-Host 'To turn it off: powershell -ExecutionPolicy Bypass -File scripts\autostart\uninstall.ps1'
