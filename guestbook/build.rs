//! Build script — do not delete.
//!
//! @kosmos-system  Content (KosmosWorlds)
//! @kosmos-owner   NEW-10
//!
//! Two link arguments, and both of them are load-bearing in different ways.
//!
//! `--import-memory`
//!     The Kosmos host instantiates world modules expecting linear memory to be
//!     IMPORTED, not defined by the module. Without it the world compiles,
//!     validates against most rules, uploads — and is dead on the headset with
//!     nothing to say why. `kosmos-wp validate` independently rejects a module
//!     that defines its own memory (WASM_006), so a mistake here cannot reach
//!     the registry.
//!
//! `--export-table`
//!     Exports the indirect function table as `__indirect_function_table`
//!     (SDK-1, CEO-ruled 2026-09-04, RESOLVE_SPEC_v1.0 §10.4 MUST). Event and
//!     timer callbacks worked on the shipping client without it because WAMR
//!     reaches a module's table internally; a non-WAMR host — the in-browser
//!     TypeScript host of Wave 3 — can only call a table that is actually
//!     exported. WASM_008 WARNs about a module that subscribes to events or
//!     timers and exports no table, and this world does both.
//!     It adds an EXPORT, never an import, so the level-2 import surface below
//!     is unaffected.
//!
//! Declared here rather than in `.cargo/config.toml` for two reasons a world
//! package cannot escape: a cargo config is discovered relative to the CURRENT
//! DIRECTORY (building via `--manifest-path` from elsewhere silently loses the
//! flags), and a world package may contain no dotted directory at all — SEC_002
//! rejects `.cargo/` outright.

fn main() {
    println!("cargo::rustc-link-arg-cdylib=--import-memory");
    println!("cargo::rustc-link-arg-cdylib=--export-table");
    println!("cargo::rerun-if-changed=build.rs");
}
