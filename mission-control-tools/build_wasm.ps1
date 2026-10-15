# build_wasm.ps1 -- host tests + device-safe world.wasm for Mission Control (DB-044).
#
# @kosmos-system Content (KosmosWorlds) -- Mission Control
# @kosmos-owner  Content lane
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
#
# Same recipe as net-test-tools\build_wasm.ps1 (KOS-983): the MSVC linker for host tests
# (Git Bash puts coreutils link.exe first), MVP features + compressed relocations for the
# headset's WAMR (reference types OFF), the target dir outside the package (SEC_002).
# This folder sits beside the world package, not in it: ASSET_006 refuses a .ps1 in a bundle.
$ErrorActionPreference = 'Stop'
$crate = Join-Path (Split-Path -Parent $PSScriptRoot) 'mission-control'
$msvc = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "$msvc\bin\Hostx64\x64\link.exe"
$env:LIB = "$msvc\lib\x64;$sdk\um\x64;$sdk\ucrt\x64"
$env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = '-C target-cpu=mvp -C link-arg=--compress-relocations'
$env:CARGO_TARGET_DIR = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.build\mission-control'

Push-Location $crate
try {
  cargo test --release --quiet -- --test-threads=1
  if ($LASTEXITCODE -ne 0) { throw 'host tests failed' }
  cargo build --release --target wasm32-unknown-unknown --quiet
  if ($LASTEXITCODE -ne 0) { throw 'wasm build failed' }
} finally { Pop-Location }
$src = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown\release\mission_control_script.wasm'
$dst = Join-Path $crate 'world.wasm'
Copy-Item $src $dst -Force
wasm-tools validate --features=mvp,mutable-global,sign-extension,saturating-float-to-int,bulk-memory $dst
if ($LASTEXITCODE -ne 0) { throw 'world.wasm fails the device feature set' }
$size = (Get-Item $dst).Length
if ($size -gt 262144) { throw "world.wasm is $size bytes (> 256 KB)" }
"mission-control {0,7} B -> {1}" -f $size, $dst
