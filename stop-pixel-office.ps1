$matches = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match '(?i)node(\.exe)?\s+server\.js' -and $_.CommandLine -match 'Pixel Office|server\.js'
}

if (-not $matches) {
  Write-Output 'No Pixel Office node process found.'
  exit 0
}

$matches | ForEach-Object {
  try {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    Write-Output "Stopped Pixel Office process $($_.ProcessId)."
  } catch {
    Write-Warning "Could not stop process $($_.ProcessId): $($_.Exception.Message)"
  }
}
