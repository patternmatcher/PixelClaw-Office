$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$privateIp = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and
    $_.PrefixOrigin -ne 'WellKnown'
  } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $privateIp) {
  throw 'No private LAN IPv4 address found. Use the loopback launcher instead.'
}

$env:HOST = $privateIp
$env:PORT = if ($env:PORT) { $env:PORT } else { '7823' }
if (-not $env:PIXEL_OFFICE_AUTH_TOKEN) {
  $bytes = [byte[]]::new(18)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $env:PIXEL_OFFICE_AUTH_TOKEN = ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

Write-Output "Starting Pixel Office on private LAN only: http://$($env:HOST):$($env:PORT)/?token=$($env:PIXEL_OFFICE_AUTH_TOKEN)"
& (Join-Path $root 'start-pixel-office-hidden.ps1')
