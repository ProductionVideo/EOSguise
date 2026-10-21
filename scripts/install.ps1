# Windows installer: copies cuedo to %LOCALAPPDATA%\cuedo, provides a checksum-verified Node runtime,
# then runs scripts\setup.mjs to configure, register at login, start and open it.
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$pkg=Split-Path $PSScriptRoot -Parent
$app=Join-Path $env:LOCALAPPDATA 'cuedo'
$nodeVersion='v22.23.1'
$nodeHash='f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed'
Write-Host "Installing cuedo to $app"

# Find earlier installs through their Startup shortcuts (EOSguise or cuedo), so they can be stopped and their settings kept.
function Find-InstallRoot([string]$file){$d=Split-Path $file -Parent;while($d){if(Test-Path -LiteralPath (Join-Path $d 'server.mjs')){return $d};$p=Split-Path $d -Parent;if($p -eq $d){break};$d=$p};return $null}
$startup=[Environment]::GetFolderPath('Startup')
$shell=New-Object -ComObject WScript.Shell
$previous=@()
foreach($name in 'cuedo.lnk','EOSguise.lnk'){
 $lnk=Join-Path $startup $name
 if(Test-Path -LiteralPath $lnk){$a=$shell.CreateShortcut($lnk).Arguments;if($a -match '-File "([^"]+)"'){$r=Find-InstallRoot $matches[1];if($r){$previous+=$r}}}
}
foreach($root in @($previous+$app|Select-Object -Unique)){
 if(Test-Path -LiteralPath (Join-Path $root 'server.mjs')){
  $server=Join-Path $root 'server.mjs'
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match '(?i)run\.ps1'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($server)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
 }
}

# Copy the application. Settings, logs and the runtime already in the install folder are kept.
New-Item -ItemType Directory -Path $app -Force | Out-Null
if((Resolve-Path $pkg).Path -ne (Resolve-Path $app).Path){
 & robocopy $pkg $app /E /NFL /NDL /NJH /NJS /NP /XF config.json config.next.json *.log *.jsonl .DS_Store /XD .git cloud tests branding runtime node_modules | Out-Null
 if($LASTEXITCODE -ge 8){throw "Copying files failed (robocopy $LASTEXITCODE)"}
 Get-ChildItem -LiteralPath $app -Filter 'test-*.mjs' | Remove-Item -Force
}
if(!(Test-Path -LiteralPath (Join-Path $app 'config.json'))){
 foreach($root in $previous){$c=Join-Path $root 'config.json';if($root -ne $app -and (Test-Path -LiteralPath $c)){Copy-Item -LiteralPath $c -Destination (Join-Path $app 'config.json');Write-Host "Kept settings from $root";break}}
}

# Node runtime: keep a verified one, use one bundled beside the installer (offline installs), or download it.
$runtime=Join-Path $app 'runtime';New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$node=Join-Path $runtime 'node.exe'
function Test-Node([string]$f){(Test-Path -LiteralPath $f) -and (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() -eq $nodeHash}
if(!(Test-Node $node)){
 $bundled=Join-Path $pkg 'runtime\node.exe'
 if(Test-Node $bundled){Copy-Item -LiteralPath $bundled -Destination $node -Force}
 else{
  $temp=Join-Path $runtime 'node.download'
  Write-Host "Downloading Node.js $nodeVersion from nodejs.org..."
  Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/win-x64/node.exe" -OutFile $temp -UseBasicParsing
  if(!(Test-Node $temp)){Remove-Item -LiteralPath $temp -Force;throw 'Node download checksum mismatch. Nothing was installed.'}
  Move-Item -LiteralPath $temp -Destination $node -Force
  Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $runtime 'LICENSE') -UseBasicParsing
 }
}

& $node (Join-Path $app 'scripts\setup.mjs')
if($LASTEXITCODE -ne 0){throw 'Setup failed.'}
