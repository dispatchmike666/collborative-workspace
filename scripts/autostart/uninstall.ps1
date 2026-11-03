<#
Stops the Glasshouse hub and helper that install.ps1 set up, and stops them starting at login.
Also deletes the saved settings, including the saved helper token. Logs are kept.

  powershell -ExecutionPolicy Bypass -File scripts\autostart\uninstall.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$stopped = Stop-Glasshouse

$hadTask = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
if ($hadTask) {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  } catch {
    Write-Host ("Windows would not remove the login task ({0}). Open PowerShell with 'Run as administrator' and run this again." -f $_.Exception.Message) -ForegroundColor Yellow
    exit 1
  }
}
Remove-Item -Path $SettingsFile -Force -ErrorAction SilentlyContinue
if (Test-Path $LogDir) { Write-AutostartLog 'Removed by uninstall.ps1.' }

if ($stopped) { Write-Host 'Stopped the hub and helper that were running in the background.' }
if ($hadTask) { Write-Host 'Glasshouse will no longer start by itself when you log in.' -ForegroundColor Green }
else { Write-Host 'Glasshouse was not set to start at login, so there was nothing to remove.' }
if (Test-Path $LogDir) { Write-Host "The old logs are still in $LogDir. Delete that folder if you do not need them." }
Write-Host 'You can still start them by hand with npm run hub and npm run helper.'
