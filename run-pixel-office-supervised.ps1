$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $root 'logs'
$log = Join-Path $logsDir 'pixel-office.supervisor.log'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$env:HOST = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
$env:PORT = if ($env:PORT) { $env:PORT } else { '7823' }
$url = "http://$($env:HOST):$($env:PORT)/api/status"

function Write-SupervisorLog($message) {
  Add-Content -Path $log -Value "[$([DateTime]::UtcNow.ToString('o'))] $message"
}

while ($true) {
  $ok = $false
  try {
    $resp = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 4
    $ok = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
  } catch {}

  if (-not $ok) {
    Write-SupervisorLog "Health check failed; launching Pixel Office."
    & (Join-Path $root 'start-pixel-office-hidden.ps1') | Out-Null
  }

  Start-Sleep -Seconds 10
}
