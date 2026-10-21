# Starts cuedo in the background if it is not already running. Used by the Startup shortcut and the installer.
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$config=Join-Path $root 'config.json'
if(!(Test-Path -LiteralPath $config)){Copy-Item -LiteralPath (Join-Path $root 'config.example.json') -Destination $config}
$cfg=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
try {$state=Invoke-RestMethod "http://127.0.0.1:$($cfg.port)/api/state" -TimeoutSec 2} catch {$state=$null}
# 'eosguise' is accepted so an instance started before the rename is recognised.
if($state){if($state.app -in @('cuedo','eosguise')){exit 0};throw "Port $($cfg.port) is already in use"}
$runner=Join-Path $PSScriptRoot 'run.ps1'
if(!(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($runner)})){
 $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 Start-Process -FilePath $ps -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$runner+'"') -WorkingDirectory $root -WindowStyle Hidden
}
for($i=0;$i -lt 40;$i++) {Start-Sleep -Milliseconds 250;try{$state=Invoke-RestMethod "http://127.0.0.1:$($cfg.port)/api/state" -TimeoutSec 1;if($state.app -in @('cuedo','eosguise')){exit 0}}catch{}}
throw 'cuedo did not start. See error.log.'
