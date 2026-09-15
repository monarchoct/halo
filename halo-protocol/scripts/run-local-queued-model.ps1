param(
  [Parameter(Mandatory=$true)][ValidatePattern('^0x[0-9a-fA-F]{40}$')][string]$Agent,
  [switch]$Watch
)
$ErrorActionPreference='Stop'
$oldDatabase=$env:HALO_TEST_DATABASE_URL
try {
  # Capture private database metadata directly from the pinned SSH channel.
  # It is never printed or written to the website/source archive.
  $raw = & (Join-Path $PSScriptRoot 'linux-lab/ssh.ps1') -Operation exec -Source 'cat /home/halo/lab/social-runtime/acceptance-database.json'
  if ($LASTEXITCODE -ne 0) { throw 'Linux database configuration could not be read.' }
  $connection=$raw | ConvertFrom-Json
  if ($connection.url -notmatch '^postgresql://[^/]+@127\.0\.0\.1:54329/halo_browser_queue_[a-f0-9]+$') { throw 'Unexpected local database identity.' }
  $env:HALO_TEST_DATABASE_URL=$connection.url.Replace(':54329/', ':54330/')
  $script=Join-Path $PSScriptRoot 'dev-model-operator.mjs'
  $node=if ($env:HALO_NODE) { $env:HALO_NODE } else { 'C:/Users/Monster Pc/AppData/Local/hermes/node/node.exe' }
  if ($Watch) { & $node $script $Agent --watch } else { & $node $script $Agent }
  $modelExit=$LASTEXITCODE
} finally {
  $env:HALO_TEST_DATABASE_URL=$oldDatabase
  $raw=$null; $connection=$null
}
exit $modelExit
