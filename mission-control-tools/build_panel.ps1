# build_panel.ps1 -- build Mission Control's nodes (mc_assembly.glb) and the review renders.
#
# @kosmos-system Content (KosmosWorlds) -- Mission Control
# @kosmos-owner  Content lane
#
# Two Blender runs, both headless and both with --python-exit-code 1:
#   1. The negative control (MC_AUDIT_NEGATIVE=1, --no-render): build_panel.py restores the
#      round-4 floor decal and need halo, which stack three translucent layers (correctness
#      review 4, MEDIUM-2). Its pre-export two-layer audit must refuse it: the run must exit
#      non-zero, report sightlines through three layers ending in McFloorRing, and leave
#      mc_assembly.glb untouched. If it passes, the audit has gone blind and this script stops.
#   2. The real build, with any arguments given here passed through to build_panel.py
#      (for example: -- --no-render, or -- --only arc,arc_floor). The contract check and the
#      audit run before the export, so a failure exits non-zero and writes no GLB.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_panel.ps1 [-- <args>]
#
# Exit code: 0 only when the negative control failed as it must AND the real build passed.

$ErrorActionPreference = 'Stop'
$blender = 'E:\Blender\blender-5.1\Blender Foundation\Blender 5.1\blender.exe'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'mission-control\blender\build_panel.py'
$glb = Join-Path $root 'mission-control\mc_assembly.glb'
$logDir = Join-Path ([IO.Path]::GetTempPath()) 'mission-control-build'
New-Item -ItemType Directory -Force $logDir | Out-Null

function Get-Stamp([string]$path) {
  if (Test-Path $path) { return (Get-FileHash $path).Hash + ':' + (Get-Item $path).LastWriteTimeUtc.Ticks }
  return 'absent'
}

function Invoke-Blender([string[]]$extra, [string]$log) {
  $argv = @('-b', '--python-exit-code', '1', '-P', $script, '--') + $extra
  $p = Start-Process -FilePath $blender -ArgumentList $argv -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError ($log + '.err')
  return $p.ExitCode
}

# 1. The negative control.
$before = Get-Stamp $glb
$negLog = Join-Path $logDir 'negative.log'
$env:MC_AUDIT_NEGATIVE = '1'
try { $code = Invoke-Blender @('--no-render') $negLog } finally { Remove-Item Env:MC_AUDIT_NEGATIVE -ErrorAction SilentlyContinue }
$text = Get-Content $negLog -Raw
$tripped = $text -match 'sightlines cross three or more translucent layers' -and $text -match 'McFloorRing'
if ($code -eq 0 -or -not $tripped) {
  Write-Output "NEGATIVE CONTROL DID NOT FAIL AS IT MUST (exit $code, audit tripped: $tripped); log: $negLog"
  exit 1
}
if ((Get-Stamp $glb) -ne $before) {
  Write-Output "NEGATIVE CONTROL WROTE mc_assembly.glb; log: $negLog"
  exit 1
}
($text -split "`n" | Where-Object { $_ -match 'layer audit \(arc open' }) | ForEach-Object { Write-Output ("negative control, as it must: " + $_.Trim()) }
Write-Output "negative control: refused (exit $code), mc_assembly.glb untouched"

# 2. The real build.
$realLog = Join-Path $logDir 'build.log'
$pass = @()
$i = [Array]::IndexOf($args, '--')
if ($i -ge 0) { if ($i -lt $args.Length - 1) { $pass = $args[($i + 1)..($args.Length - 1)] } }
else { $pass = @($args) }  # powershell.exe -File may swallow the '--' itself
$code = Invoke-Blender $pass $realLog
Get-Content $realLog | Where-Object { $_ -match '^\[mission-control\]' } | ForEach-Object { Write-Output $_ }
if ($code -ne 0) {
  Write-Output "BUILD FAILED (exit $code); log: $realLog"
  exit $code
}
Write-Output "build passed; log: $realLog"
exit 0
