$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$outLog = Join-Path $logsDir 'pixel-office.out.log'
$errLog = Join-Path $logsDir 'pixel-office.err.log'
$env:HOST = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
$env:PORT = if ($env:PORT) { $env:PORT } else { '7823' }

Set-Location $root
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  npm install
}

$alreadyRunning = $false
try {
  $resp = Invoke-WebRequest -UseBasicParsing "http://$($env:HOST):$($env:PORT)/api/status" -TimeoutSec 2
  $alreadyRunning = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
} catch {}

if ($alreadyRunning) {
  Write-Output "Pixel Office already running at http://$($env:HOST):$($env:PORT)"
  exit 0
}

Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Write-Output "Pixel Office starting at http://$($env:HOST):$($env:PORT)"
