//! Build script -- do not delete.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Mission Control
//! @kosmos-owner   Content lane
//!
//! `--import-memory`: the Kosmos host instantiates world modules expecting linear
//! memory to be IMPORTED (WASM_006 rejects a module that defines its own).
//! `--export-table`: exports `__indirect_function_table` so a non-WAMR host can call
//! the event callbacks (RESOLVE_SPEC_v1.0 section 10.4; WASM_008 warns without it).
//! Declared here, not in `.cargo/config.toml`: SEC_002 rejects dotted directories in
//! a world package, and a cargo config is found relative to the current directory.
//! Same as net-check's build.rs (KOS-983).

fn main() {
    println!("cargo::rustc-link-arg-cdylib=--import-memory");
    println!("cargo::rustc-link-arg-cdylib=--export-table");
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=bridge-origin.txt");
}
