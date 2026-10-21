$startup=[Environment]::GetFolderPath('Startup')
$shell=New-Object -ComObject WScript.Shell
# Replace the shortcut created before the rename.
$old=Join-Path $startup 'EOSguise.lnk';if(Test-Path -LiteralPath $old){Remove-Item -LiteralPath $old}
$link=$shell.CreateShortcut((Join-Path $startup 'cuedo.lnk'))
$link.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$link.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'Start.ps1')+'"'
$link.WorkingDirectory=$PSScriptRoot
$link.WindowStyle=7
$link.Save()
