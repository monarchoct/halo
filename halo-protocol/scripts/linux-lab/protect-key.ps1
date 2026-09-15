$ErrorActionPreference = 'Stop'
$labPrivate = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../work/linux-lab/private'))
$labKey = Join-Path $labPrivate 'id_ed25519'
if (Test-Path -LiteralPath ($labKey + '.dpapi')) { throw 'Encrypted key already exists; preserve the VM identity' }
$labBytes = [System.IO.File]::ReadAllBytes($labKey)
try {
  $labCiphertext = [System.Security.Cryptography.ProtectedData]::Protect($labBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  $labCheck = [System.Security.Cryptography.ProtectedData]::Unprotect($labCiphertext, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ([Convert]::ToBase64String($labBytes) -ne [Convert]::ToBase64String($labCheck)) { throw 'Windows credential encryption verification failed' }
  [System.IO.File]::WriteAllBytes(($labKey + '.dpapi'), $labCiphertext)
  Remove-Item -LiteralPath $labKey
  [Array]::Clear($labCheck, 0, $labCheck.Length)
  Write-Output 'VM client key protected with CurrentUser DPAPI; plaintext file removed.'
} finally {
  [Array]::Clear($labBytes, 0, $labBytes.Length)
}
