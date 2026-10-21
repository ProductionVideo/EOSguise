# Supervisor: keeps the cuedo server running, restarting it after an unexpected exit. One per install folder.
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($root))).Replace('-','').Substring(0,16)
$mutex=New-Object Threading.Mutex($false, ('Local\cuedo-'+$hash))
$owned=$false
try {
 try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
 if(!$owned){exit}
 $node=Join-Path $root 'runtime\node.exe'
 if(!(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
 while($true){
  $proc=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $root 'server.mjs')+'"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'server.log') -RedirectStandardError (Join-Path $root 'error.log') -PassThru
  $proc.WaitForExit()
  Start-Sleep -Seconds 3
 }
}finally{if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
