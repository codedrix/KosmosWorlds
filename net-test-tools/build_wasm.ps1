# build_wasm.ps1 -- host tests + device-safe wasm for net-check and net-required (KOS-983, lane TW).
#
# @kosmos-system Content (KosmosWorlds) -- network test worlds
# @kosmos-owner  TW (KOS-983)
#
# Usage (Windows PowerShell 5.1, from anywhere):
#   powershell -NoProfile -ExecutionPolicy Bypass -File net-test-tools\build_wasm.ps1
#
# Why PowerShell: Git Bash puts coreutils `link.exe` ahead of the MSVC linker, so the
# build scripts (build.rs) and host `cargo test` are pointed at the MSVC linker and the
# Windows SDK libs explicitly. The wasm builds themselves use rust-lld.
# Wasm flags: MVP features + compressed relocations. Rust >= 1.82 enables
# reference-types by default, and the headset's WAMR has reference types OFF.
# The target dir is OUTSIDE the world packages: SEC_002 rejects dotted directories and
# a target/ inside a package would be measured into everything.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$msvc = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "$msvc\bin\Hostx64\x64\link.exe"
$env:LIB = "$msvc\lib\x64;$sdk\um\x64;$sdk\ucrt\x64"
$env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = '-C target-cpu=mvp -C link-arg=--compress-relocations'

foreach ($w in 'net-check', 'net-required') {
  $crate = Join-Path $repo $w
  $env:CARGO_TARGET_DIR = Join-Path (Split-Path -Parent $repo) ".build\$w"
  Push-Location $crate
  try {
    cargo test --release --quiet
    if ($LASTEXITCODE -ne 0) { throw "$w host tests failed" }
    cargo build --release --target wasm32-unknown-unknown --quiet
    if ($LASTEXITCODE -ne 0) { throw "$w wasm build failed" }
  } finally { Pop-Location }
  $name = $w.Replace('-', '_') + '_script.wasm'
  $src = Join-Path $env:CARGO_TARGET_DIR "wasm32-unknown-unknown\release\$name"
  $dst = Join-Path $crate 'world.wasm'
  Copy-Item $src $dst -Force
  # The device accepts MVP + these post-MVP features.
  wasm-tools validate --features=mvp,mutable-global,sign-extension,saturating-float-to-int,bulk-memory $dst
  if ($LASTEXITCODE -ne 0) { throw "$w world.wasm fails the device feature set" }
  $size = (Get-Item $dst).Length
  if ($size -gt 262144) { throw "$w world.wasm is $size bytes (> 256 KB)" }
  "{0,-13} {1,7} B -> {2}" -f $w, $size, $dst
}
