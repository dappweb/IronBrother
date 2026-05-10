param(
  [ValidateSet("bsc", "bscTestnet")]
  [string]$Network = "bsc",

  [int]$BatchSize = 50,

  [int]$MaxBatches = 10000,

  [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,

  [string]$LogDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Import-DotEnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $separator = $line.IndexOf("=")
    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if ($key -and -not [Environment]::GetEnvironmentVariable($key, "Process")) {
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

function Require-Env {
  param([string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }
}

Set-Location -LiteralPath $ProjectRoot

Import-DotEnvFile (Join-Path $ProjectRoot ".env.local")
Import-DotEnvFile (Join-Path $ProjectRoot ".env")

$deploymentFileName = if ($Network -eq "bsc") { "bsc.json" } else { "bsc-testnet.json" }
$deploymentPath = Join-Path $ProjectRoot (Join-Path "deployments" $deploymentFileName)
if (-not (Test-Path -LiteralPath $deploymentPath)) {
  throw "Deployment file not found: $deploymentPath"
}

$deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
$proxyAddress = $deployment.ironBrotherProxy
if ([string]::IsNullOrWhiteSpace($proxyAddress)) {
  throw "Missing ironBrotherProxy in $deploymentPath"
}

Require-Env "PRIVATE_KEY"
if ($Network -eq "bsc") {
  Require-Env "BSC_RPC_URL"
  $npmScript = "bot:dynamic:settle:bsc"
} else {
  Require-Env "BSC_TESTNET_RPC_URL"
  $npmScript = "bot:dynamic:settle:testnet"
}

$previousProxy = [Environment]::GetEnvironmentVariable("IRONBROTHER_PROXY", "Process")
$previousBatchSize = [Environment]::GetEnvironmentVariable("DYNAMIC_SETTLEMENT_BATCH_SIZE", "Process")
$previousMaxBatches = [Environment]::GetEnvironmentVariable("DYNAMIC_SETTLEMENT_MAX_BATCHES", "Process")

if ([string]::IsNullOrWhiteSpace($LogDir)) {
  $LogDir = Join-Path $ProjectRoot "logs\settlement"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogDir "$Network-dynamic-settlement-$timestamp.log"

try {
  [Environment]::SetEnvironmentVariable("IRONBROTHER_PROXY", $proxyAddress, "Process")
  [Environment]::SetEnvironmentVariable("DYNAMIC_SETTLEMENT_BATCH_SIZE", $BatchSize.ToString(), "Process")
  [Environment]::SetEnvironmentVariable("DYNAMIC_SETTLEMENT_MAX_BATCHES", $MaxBatches.ToString(), "Process")

  Write-Output "Daily dynamic settlement started"
  Write-Output "Network: $Network"
  Write-Output "Proxy: $proxyAddress"
  Write-Output "Batch size: $BatchSize"
  Write-Output "Max batches: $MaxBatches"
  Write-Output "Log: $logPath"

  & npm run $npmScript *>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -ne 0) {
    throw "Settlement command failed with exit code $LASTEXITCODE"
  }
} finally {
  [Environment]::SetEnvironmentVariable("IRONBROTHER_PROXY", $previousProxy, "Process")
  [Environment]::SetEnvironmentVariable("DYNAMIC_SETTLEMENT_BATCH_SIZE", $previousBatchSize, "Process")
  [Environment]::SetEnvironmentVariable("DYNAMIC_SETTLEMENT_MAX_BATCHES", $previousMaxBatches, "Process")
}
