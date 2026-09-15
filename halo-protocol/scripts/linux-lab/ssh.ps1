param(
  [Parameter(Mandatory=$true)][ValidateSet('exec','put','get','tunnel','database-tunnel')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$Source,
  [string]$Destination
)
$ErrorActionPreference = 'Stop'
$labPrivate = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../work/linux-lab/private'))
$labEncrypted = [System.IO.File]::ReadAllBytes((Join-Path $labPrivate 'id_ed25519.dpapi'))
$labPlain = [System.Security.Cryptography.ProtectedData]::Unprotect($labEncrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$labNode = if ($env:HALO_NODE) { $env:HALO_NODE } else { 'C:/Users/Monster Pc/AppData/Local/hermes/node/node.exe' }
try {
  # Decrypted key crosses only an anonymous pipe; never argv, a disk file, or tool output.
  if ($Operation -eq 'exec' -or $Operation -eq 'tunnel' -or $Operation -eq 'database-tunnel') {
    [Convert]::ToBase64String($labPlain) | & $labNode (Join-Path $PSScriptRoot 'ssh.mjs') $Operation $Source
  } else {
    if (!$Destination) { throw 'Supply the transfer destination' }
    [Convert]::ToBase64String($labPlain) | & $labNode (Join-Path $PSScriptRoot 'ssh.mjs') $Operation $Source $Destination
  }
  $labExit = $LASTEXITCODE
} finally {
  [Array]::Clear($labPlain, 0, $labPlain.Length)
}
exit $labExit
