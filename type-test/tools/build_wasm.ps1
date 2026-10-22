# build_wasm.ps1 -- host tests + device-safe world.wasm for Type Test.
#
# @kosmos-system Content (KosmosWorlds) -- Type Test (temporary)
# @kosmos-owner  Type Test (pattern: more-room/tools/build_wasm.ps1)
#
# Usage (Windows PowerShell 5.1, from anywhere):
#   powershell -NoProfile -ExecutionPolicy Bypass -File type-test\tools\build_wasm.ps1
#
# Why PowerShell: Git Bash puts coreutils `link.exe` ahead of the MSVC linker, so
# build.rs and host `cargo test` are pointed at the MSVC linker explicitly.
# Wasm flags: MVP features + compressed relocations (the headset's WAMR has
# reference types OFF). The cargo target dir is OUTSIDE the world package.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # type-test/
$crate = Join-Path $root 'script'
$msvc = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "$msvc\bin\Hostx64\x64\link.exe"
$env:LIB = "$msvc\lib\x64;$sdk\um\x64;$sdk\ucrt\x64"
$env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = '-C target-cpu=mvp -C link-arg=--compress-relocations'
$env:CARGO_TARGET_DIR = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) '.build\type-test'

Push-Location $crate
try {
  cargo test --release --quiet -- --test-threads=1
  if ($LASTEXITCODE -ne 0) { throw 'host tests failed' }
  cargo build --release --target wasm32-unknown-unknown --quiet
  if ($LASTEXITCODE -ne 0) { throw 'wasm build failed' }
} finally { Pop-Location }

$src = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown\release\type_test_script.wasm'
$dst = Join-Path $root 'world\world.wasm'
Copy-Item $src $dst -Force
wasm-tools validate --features=mvp,mutable-global,sign-extension,saturating-float-to-int,bulk-memory $dst
if ($LASTEXITCODE -ne 0) { throw "world.wasm fails the device feature set" }
$size = (Get-Item $dst).Length
if ($size -gt 262144) { throw "world.wasm is $size bytes (> 256 KB)" }
"world.wasm {0,7} B -> {1}" -f $size, $dst
