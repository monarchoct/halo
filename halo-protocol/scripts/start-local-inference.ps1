$ErrorActionPreference = 'Stop'
$protocolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $protocolRoot '../../work/inference-assets'))
$assetLock = Get-Content -LiteralPath (Join-Path $protocolRoot 'models/proposal-qwen35-4b/assets.lock.json') -Raw | ConvertFrom-Json
foreach ($asset in @($assetLock.runtime, $assetLock.cuda, $assetLock.model)) {
  $assetPath = Join-Path $assetDirectory $asset.file
  if ((Get-Item -LiteralPath $assetPath).Length -ne $asset.size -or (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) { throw "Inference asset verification failed: $($asset.file)" }
}
$binaryDirectory = Join-Path $assetDirectory 'llama-b10809'
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Compare every executable/DLL against the verified archives, so a changed extraction is not silently executed.
foreach ($asset in @($assetLock.runtime, $assetLock.cuda)) {
  $archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $assetDirectory $asset.file))
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.Name -eq '') { continue }
      $destination = [IO.Path]::GetFullPath((Join-Path $binaryDirectory $entry.FullName))
      if (-not $destination.StartsWith($binaryDirectory + [IO.Path]::DirectorySeparatorChar)) { throw 'Archive path escapes runtime directory' }
      $stream = $entry.Open()
      $hasher = [Security.Cryptography.SHA256]::Create()
      try { $expected = [Convert]::ToHexString($hasher.ComputeHash($stream)) } finally { $stream.Dispose(); $hasher.Dispose() }
      if (-not (Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expected) { throw "Extracted runtime verification failed: $($entry.FullName)" }
    }
  } finally { $archive.Dispose() }
}
$keyPath = Join-Path $assetDirectory 'local-inference-key.txt'
if (-not (Test-Path -LiteralPath $keyPath)) { [IO.File]::WriteAllText($keyPath, [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')) }
$server = Join-Path $binaryDirectory 'llama-server.exe'
$modelPath = Join-Path $assetDirectory $assetLock.model.file
Write-Output 'Starting SHA-256 verified Qwen3.5-4B on loopback port 8080. Local inference only; no tools or wallet.'
& $server --model $modelPath --alias halo-qwen35-4b-v1 --host 127.0.0.1 --port 8080 --api-key-file $keyPath --ctx-size 16384 --parallel 1 --n-gpu-layers 99 --flash-attn on --cache-type-k f16 --cache-type-v f16 --no-context-shift --no-agent --no-webui --cors-origins http://127.0.0.1:8080
exit $LASTEXITCODE
