//! Native extension registry and cross-layer seam (T20A).
//!
//! # Role
//!
//! This module is the single place that declares the *module boundaries* the
//! M4 native subtasks implement after T20A archives. Each boundary is one
//! file with a unique owner; [`REGISTRY`] records the owner, the integration
//! gate that owns the shared wiring, and the current status. Nobody but the
//! owning subtask (or the gate) may write to a boundary's file. T20A created
//! these placeholder modules once; the coordinator hands each file to its
//! owner after this task archives (see `todos/README.md` "先登记、后交接").
//!
//! This registry performs no FFI, adds no public API and no second DOM state:
//! it only freezes seams so downstream tasks compile without touching the
//! shared files.
//!
//! # Ownership table
//!
//! | seam | file | owner | gate |
//! | --- | --- | --- | --- |
//! | `window_document` | `extensions/window_document.rs` | T22A | T22 |
//! | `node_api` | `extensions/node_api.rs` | T23A | T23 |
//! | `mutation_insert_api` | `extensions/mutation_insert_api.rs` | T24A | T24 |
//! | `mutation_remove_api` | `extensions/mutation_remove_api.rs` | T24B | T24 |
//! | `attributes_api` | `extensions/attributes_api.rs` | T25E | T25 |
//! | `text_api` | `extensions/text_api.rs` | T25E | T25 |
//! | `collection_api` | `extensions/collection_api.rs` | T25D | T25 |
//! | `affinity` | `affinity.rs` | T21B | T21 |
//! | `html_api` | `extensions/html_api.rs` | T29 | T29 |
//! | `query_api` | `extensions/query_api.rs` | T31 | T31 |
//! | `live_collections` | `extensions/live_collections.rs` | T32 | T32 |
//! | `character_data_api` | `extensions/character_data_api.rs` | T33 | T33 |
//! | `attribute_nodes_api` | `extensions/attribute_nodes_api.rs` | T34 | T34 |
//! | `html_element_api` | `extensions/html_element_api.rs` | T39 | T39 |
//!
//! The first eight rows are the *frozen M4 boundaries* recorded in
//! [`REGISTRY`]. `html_api` (T29, M5), `query_api` (T31, M6),
//! `live_collections` (T32, M6), `character_data_api` (T33, M7),
//! `attribute_nodes_api` (T34, M7) and `html_element_api` (T39, M7) follow the
//! same seam pattern — their own file, a `SEAM` constant and `#[napi]`
//! extensions on the existing handle classes — but are not part of the M4
//! freeze: each owns both the native module and the integration wiring (there
//! is no separate M5/M6/M7 gate), so it is declared here but deliberately
//! absent from [`REGISTRY`] and its structural tests.
//!
//! # Dependency direction
//!
//! * Extension modules may import the stable seam context from
//!   [`crate::handle`] — [`crate::handle::with_document`],
//!   [`crate::handle::SharedDocument`], [`crate::handle::SharedDocument::wrap_node`],
//!   `DocumentHandle::shared`, `NodeHandle::shared`, `NodeHandle::id` — and the
//!   error outlet from [`crate::error`] (`BindingError`, `into_napi`). They
//!   delegate every tree operation to Core and never keep a second DOM state
//!   or fabricate a [`NodeId`](mad_dom_core::arena::NodeId).
//! * Extensions must not depend on each other, must not implement affinity
//!   semantics themselves (T21B owns [`crate::affinity`]; T21 wires the guard
//!   into entries), and must not modify `handle.rs`, `lib.rs`, `api.rs`, this
//!   registry or the root entry files.
//! * Shared files — this registry, the `lib.rs` module declarations, the root
//!   entry (`index.js` / `index.d.ts`) and the compat ledger — have a single
//!   integration owner (the matching T2x gate) and are never written by a
//!   subtask.

mod attribute_nodes_api;
mod attributes_api;
mod character_data_api;
mod collection_api;
mod events_api;
mod html_api;
mod html_element_api;
mod live_collections;
mod mutation_insert_api;
pub(crate) mod mutation_observer_api;
mod mutation_remove_api;
mod node_api;
mod query_api;
mod text_api;
mod traversal_api;
mod window_document;

/// Metadata for one registered native extension boundary.
///
/// Dormant by design: the registry is consumed by the structural test now and
/// by the integration gates as each seam is handed over, so the fields are
/// intentionally not all read in every build.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ExtensionSeam {
    /// Stable boundary id (module name).
    pub(crate) id: &'static str,
    /// Task that owns the implementation after T20A archives.
    pub(crate) owner: &'static str,
    /// Integration gate that owns the shared wiring for this boundary.
    pub(crate) gate: &'static str,
    /// Current status; `"placeholder"` until the owner archives its task.
    pub(crate) status: &'static str,
}

/// The frozen M4 native extension boundaries, each with its unique owner and
/// integration gate. Referenced by the structural test; integration gates
/// update it when a seam is wired up.
#[allow(dead_code)]
pub(crate) const REGISTRY: &[ExtensionSeam] = &[
    window_document::SEAM,
    node_api::SEAM,
    mutation_insert_api::SEAM,
    mutation_remove_api::SEAM,
    attributes_api::SEAM,
    text_api::SEAM,
    collection_api::SEAM,
    crate::affinity::SEAM,
];

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen set of M4 native boundaries, ordered by id.
    fn expected_ids() -> [&'static str; 8] {
        [
            "affinity",
            "attributes_api",
            "collection_api",
            "mutation_insert_api",
            "mutation_remove_api",
            "node_api",
            "text_api",
            "window_document",
        ]
    }

    #[test]
    fn registry_lists_exactly_the_frozen_boundaries() {
        let mut ids: Vec<&str> = REGISTRY.iter().map(|seam| seam.id).collect();
        let mut expected = expected_ids().to_vec();
        ids.sort_unstable();
        expected.sort_unstable();
        assert_eq!(
            ids, expected,
            "registry must list exactly the frozen M4 boundaries"
        );
    }

    #[test]
    fn every_registered_boundary_is_unique() {
        let mut ids: Vec<&str> = REGISTRY.iter().map(|seam| seam.id).collect();
        ids.sort_unstable();
        for window in ids.windows(2) {
            assert_ne!(
                window[0], window[1],
                "seam id must be unique: {}",
                window[0]
            );
        }
    }

    #[test]
    fn owners_and_gates_are_frozen() {
        let owners: std::collections::HashMap<&str, &str> =
            REGISTRY.iter().map(|seam| (seam.id, seam.owner)).collect();
        assert_eq!(owners["window_document"], "T22A");
        assert_eq!(owners["node_api"], "T23A");
        assert_eq!(owners["mutation_insert_api"], "T24A");
        assert_eq!(owners["mutation_remove_api"], "T24B");
        assert_eq!(owners["attributes_api"], "T25E");
        assert_eq!(owners["text_api"], "T25E");
        assert_eq!(owners["collection_api"], "T25D");
        assert_eq!(owners["affinity"], "T21B");

        let gates: std::collections::HashMap<&str, &str> =
            REGISTRY.iter().map(|seam| (seam.id, seam.gate)).collect();
        assert_eq!(gates["window_document"], "T22");
        assert_eq!(gates["node_api"], "T23");
        assert_eq!(gates["mutation_insert_api"], "T24");
        assert_eq!(gates["mutation_remove_api"], "T24");
        assert_eq!(gates["attributes_api"], "T25");
        assert_eq!(gates["text_api"], "T25");
        assert_eq!(gates["collection_api"], "T25");
        assert_eq!(gates["affinity"], "T21");
    }

    #[test]
    fn every_boundary_starts_as_a_placeholder() {
        for seam in REGISTRY {
            assert_eq!(
                seam.status, "placeholder",
                "{} must stay a placeholder until its owner archives",
                seam.id
            );
        }
    }
}
