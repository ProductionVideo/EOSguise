# Stops cuedo and its supervisor for this install folder.
param([string]$Root=(Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$server=Join-Path $Root 'server.mjs'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($Root) -and $_.CommandLine -match '(?i)run\.ps1'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($server)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
