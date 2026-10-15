# build_wasm.ps1 -- host tests + device-safe world.wasm for More Room (VR and MR share it).
#
# @kosmos-system Content (KosmosWorlds) -- More Room
# @kosmos-owner  More Room v1 (pattern: net-test-tools/build_wasm.ps1, KOS-983)
#
# Usage (Windows PowerShell 5.1, from anywhere):
#   powershell -NoProfile -ExecutionPolicy Bypass -File more-room\tools\build_wasm.ps1
#
# Why PowerShell: Git Bash puts coreutils `link.exe` ahead of the MSVC linker, so
# build.rs and host `cargo test` are pointed at the MSVC linker explicitly.
# Wasm flags: MVP features + compressed relocations (the headset's WAMR has
# reference types OFF). The cargo target dir is OUTSIDE the world packages.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # more-room/
$crate = Join-Path $root 'script'
$msvc = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "$msvc\bin\Hostx64\x64\link.exe"
$env:LIB = "$msvc\lib\x64;$sdk\um\x64;$sdk\ucrt\x64"
$env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = '-C target-cpu=mvp -C link-arg=--compress-relocations'
$env:CARGO_TARGET_DIR = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) '.build\more-room'

Push-Location $crate
try {
  cargo test --release --quiet
  if ($LASTEXITCODE -ne 0) { throw 'host tests failed' }
  cargo build --release --target wasm32-unknown-unknown --quiet
  if ($LASTEXITCODE -ne 0) { throw 'wasm build failed' }
} finally { Pop-Location }

$src = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown\release\more_room_script.wasm'
foreach ($v in 'world-vr', 'world-mr') {
  $dst = Join-Path $root "$v\world.wasm"
  Copy-Item $src $dst -Force
  wasm-tools validate --features=mvp,mutable-global,sign-extension,saturating-float-to-int,bulk-memory $dst
  if ($LASTEXITCODE -ne 0) { throw "$v world.wasm fails the device feature set" }
  $size = (Get-Item $dst).Length
  if ($size -gt 262144) { throw "$v world.wasm is $size bytes (> 256 KB)" }
  "{0,-9} {1,7} B -> {2}" -f $v, $size, $dst
}
