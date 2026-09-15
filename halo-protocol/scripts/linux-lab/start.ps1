param([ValidateSet('whpx','tcg')][string]$Accelerator = 'whpx')
$ErrorActionPreference = 'Stop'
$labDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../work/linux-lab'))
$qemuDirectory = Join-Path $labDirectory 'qemu'
$qemuExecutable = Join-Path $qemuDirectory 'qemu-system-x86_64.exe'
$baseDisk = Join-Path $labDirectory 'assets/noble-server-cloudimg-amd64.img'
$disk = Join-Path $labDirectory 'linux.qcow2'
$seed = Join-Path $labDirectory 'private/seed.iso'
$serial = Join-Path $labDirectory 'serial.log'
if (!(Test-Path -LiteralPath $seed)) { throw 'Prepare the private seed first' }
$baseHash = (Get-FileHash -LiteralPath $baseDisk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($baseHash -ne '612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354') { throw 'Ubuntu image hash mismatch' }
if (!(Test-Path -LiteralPath $disk)) {
  & (Join-Path $qemuDirectory 'qemu-img.exe') create -f qcow2 -F qcow2 -b $baseDisk $disk 40G
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the separate overlay disk' }
}
# WHPX was verified on this host without changing Windows features. TCG is a slow fallback.
# QEMU's exclusive disk lock prevents a second writer; never delete the live disk/lock.
$qemuArguments = @('-L', $qemuDirectory, '-name', 'halo-linux-lab', '-machine', 'q35', '-cpu', 'max', '-m', '8192')
if ($Accelerator -eq 'whpx') { $qemuArguments += @('-accel', 'whpx', '-smp', '4') }
else { $qemuArguments += @('-accel', 'tcg,thread=single', '-icount', 'shift=auto,align=off,sleep=on', '-smp', '2') }
$qemuArguments += @('-drive', "file=$disk,if=virtio,format=qcow2", '-drive', "file=$seed,media=cdrom,format=raw,readonly=on", '-nic', 'user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:22240-:22', '-display', 'none', '-monitor', 'none', '-serial', "file:$serial", '-no-reboot')
& $qemuExecutable @qemuArguments
exit $LASTEXITCODE
