param(
  [ValidateSet("bsc")]
  [string]$Network = "bsc",

  [string]$TaskName = "",

  [string]$At = "00:05",

  [int]$BatchSize = 50,

  [int]$MaxBatches = 10000,

  [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,

  [string]$LogDir = "",

  [switch]$RunElevated
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($TaskName)) {
  $TaskName = "IronBrother Daily Dynamic Settlement"
}

$runnerPath = Join-Path $ProjectRoot "scripts\run-daily-dynamic-settlement.ps1"
if (-not (Test-Path -LiteralPath $runnerPath)) {
  throw "Runner script not found: $runnerPath"
}

$time = [datetime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$powerShellPath = Join-Path $PSHOME "powershell.exe"

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$runnerPath`"",
  "-Network", $Network,
  "-BatchSize", $BatchSize.ToString(),
  "-MaxBatches", $MaxBatches.ToString(),
  "-ProjectRoot", "`"$ProjectRoot`""
)

if (-not [string]::IsNullOrWhiteSpace($LogDir)) {
  $argumentParts += @("-LogDir", "`"$LogDir`"")
}

$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument ($argumentParts -join " ") -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($RunElevated) {
  $principal = New-ScheduledTaskPrincipal -UserId $currentIdentity -LogonType Interactive -RunLevel Highest
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $currentIdentity -LogonType Interactive
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Runs IronBrother daily dynamic reward settlement after the UTC+8 local day closes." `
  -Force | Out-Null

Write-Output "Scheduled task installed"
Write-Output "Task: $TaskName"
Write-Output "Network: $Network"
Write-Output "Daily time: $At"
Write-Output "Runner: $runnerPath"
Write-Output "Account: $currentIdentity"
Write-Output "Next run: $((Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime)"
