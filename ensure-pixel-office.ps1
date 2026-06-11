$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HOST = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
$env:PORT = if ($env:PORT) { $env:PORT } else { '7823' }

try {
  $resp = Invoke-WebRequest -UseBasicParsing "http://$($env:HOST):$($env:PORT)/api/status" -TimeoutSec 3
  if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
    Write-Output "Pixel Office healthy at http://$($env:HOST):$($env:PORT)"
    exit 0
  }
} catch {}

& (Join-Path $root 'start-pixel-office-hidden.ps1')
