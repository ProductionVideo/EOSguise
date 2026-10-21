$ErrorActionPreference='Stop'
$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-','').Substring(0,16)
$mutex=New-Object Threading.Mutex($false, ('Local\cuedo-'+$hash))
$owned=$false
try {
 try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
 if(!$owned){exit}
 $node=Join-Path $PSScriptRoot 'runtime\node.exe'
 if(!(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
 while($true){
  $proc=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $PSScriptRoot 'server.mjs')+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'error.log') -PassThru
  $proc.WaitForExit()
  Start-Sleep -Seconds 3
 }
}finally{if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
