//! Native live child collection extension boundary (T25D).
//!
//! # Role
//!
//! This module is the M4 native extension that takes over its T20A seam for the
//! **live `childNodes` / `NodeList`** collection. Exactly like
//! [`crate::extensions::node_api`] (T23A) and the mutation contracts
//! (T24A/T24B) before it, it **audits** the already-delivered low-level surface
//! in [`crate::handle`] and pins it here as the frozen collection contract. It
//! adds **no** new `#[napi]` export: the existing `childNodes` read is the
//! single native source the live collection re-reads on every access, so
//! re-exporting it under the same name is forbidden by the T20A seam rules (see
//! [`crate::extensions`] and the acceptance "既有低层导出没有重复符号").
//!
//! # Frozen native contract (consumed by the T25D facade)
//!
//! The contract is expressed entirely through the stable seam in
//! [`crate::handle`]; the module defines no class of its own and adds no native
//! surface. The *method name, parameters and return value* below are the frozen
//! contract the live `NodeList` facade depends on.
//!
//! ## Collection read (on the native `NodeHandle` from [`crate::handle`])
//!
//! | native method | params → returns | behavior |
//! | --- | --- | --- |
//! | `childNodes` | `() → Vec<Reference<NodeHandle>>` | ordered children of the parent, in Core document order; an empty array for a leaf node |
//!
//! Every access of the live `NodeList` facade re-invokes this read and funnels
//! each produced handle through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so:
//!
//! * **No second authoritative tree state** — the facade never caches a list of
//!   children; length, index and iteration all re-read Core through this method.
//! * **No dangling `NodeId`** — the `NodeList` holds a live [`NodeHandle`],
//!   never a raw id; the id is extracted and validated only by Core on every
//!   call, so a stale id can never be dereferenced.
//! * **Stable wrapper identity** — produced nodes route through the same
//!   per-document weak cache as every other wrapper-producing read (T20).
//!
//! # Snapshot vs live boundary
//!
//! `NodeHandle::child_nodes` is a single *read*: it returns the current ordered
//! children. T23B froze the *snapshot* facade form of `childNodes` (a plain
//! array captured at read time) in `js/facade/extensions/node.js`; T25D owns the
//! *live* collection facade in `js/facade/extensions/child-nodelist.js`, which
//! re-reads this same method on every access so an existing collection reflects
//! mutations immediately. This task implements **no query index** and **no
//! `HTMLCollection`**: the only collection surface is the live
//! `childNodes`/`NodeList` built on this read.
//!
//! # Mutation interaction
//!
//! Mutations are the frozen T24A/T24B surface on
//! [`DocumentHandle`](crate::handle::DocumentHandle) (`appendChild`,
//! `insertBefore`, `removeChild`, `replaceChild`). The live collection holds no
//! mutation state of its own — after any mutation it simply observes the
//! updated Core child list on the next read.
//!
//! # Error semantics (unchanged from the audited surface)
//!
//! Every read through the underlying `childNodes` propagates the frozen error
//! table: a destroyed document fails with `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a
//! foreign handle with `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with
//! `ERR_MAD_DOM_STALE_HANDLE`, and a call from a foreign thread/isolate with
//! `ERR_MAD_DOM_AFFINITY_*` (T21B guard).
//!
//! # Safety preconditions
//!
//! The audited entries in [`crate::handle`] are all marked `#[napi(catch_unwind)]`
//! and check the T21B affinity guard before touching Core state, matching the
//! crate safety model. This module adds no FFI of its own; `unsafe` stays
//! inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T25D**; integration gate: **T25**. Do not write to this file from
//! any other task. Registry wiring and the `status` flip to `"implemented"`
//! belong to the T25 gate; the seam metadata below stays `"placeholder"` until
//! then. The constant in this module is the Rust-side pin of the frozen
//! surface; `tests/bun/nodelist-live.test.js` and
//! `tests/compat/scenarios/dom/dom-child-nodelist.js` carry the end-to-end
//! evidence.

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "collection_api",
    owner: "T25D",
    gate: "T25",
    status: "placeholder",
};

/// The frozen native collection read on [`NodeHandle`](crate::handle::NodeHandle).
///
/// Exactly the audited T19/T20 low-level method — no renamed or added symbol —
/// and the single native source the live `NodeList` facade re-reads on every
/// access. No query index or `HTMLCollection` symbol is part of this contract.
#[allow(dead_code)]
pub(crate) const COLLECTION_READ_CONTRACT: &[&str] = &["childNodes"];

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen contract surface is exactly the audited `handle.rs` surface:
    /// collection_api adds no symbol and renames none, so there is no duplicate
    /// export and the ABI stays byte-for-byte the T19/T20 shape. This is the
    /// Rust-side regression pin; `tests/bun/nodelist-live.test.js` re-checks the
    /// live behavior end to end.
    #[test]
    fn frozen_collection_read_is_the_audited_handle_surface() {
        assert_eq!(
            COLLECTION_READ_CONTRACT,
            &["childNodes"],
            "native collection contract must stay exactly the T19/T20 handle surface"
        );
    }

    /// The collection contract owns only the ordered-children read: it must
    /// never grow into a query-index or `HTMLCollection` surface, and the T24
    /// mutation symbols stay with their own seams.
    #[test]
    fn collection_contract_has_no_index_or_html_collection_surface() {
        for name in COLLECTION_READ_CONTRACT {
            assert!(
                !name.contains("query")
                    && !name.contains("getElements")
                    && !name.contains("HTMLCollection"),
                "collection_api must not declare any query index or HTMLCollection symbol"
            );
        }
    }

    /// The live collection reads only the frozen child list: append/insert/
    /// remove/replace belong to T24A/T24B and never leak into this contract.
    #[test]
    fn collection_contract_does_not_own_mutation_symbols() {
        for name in COLLECTION_READ_CONTRACT {
            assert!(
                !name.starts_with("append")
                    && !name.starts_with("insert")
                    && !name.starts_with("remove")
                    && !name.starts_with("replace"),
                "the T24 mutation surface must never leak into the collection contract"
            );
        }
    }

    /// The seam split pins `childNodes` as T25D's single read source; the
    /// collection reads one and only one native method, so there is no second
    /// authority to keep in sync.
    #[test]
    fn live_collection_reads_only_child_nodes() {
        assert_eq!(COLLECTION_READ_CONTRACT.len(), 1);
        assert_eq!(COLLECTION_READ_CONTRACT[0], "childNodes");
    }
}
