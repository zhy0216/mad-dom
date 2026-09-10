//! Native extension modules.
//!
//! Each module owns one boundary of the native surface: it adds `#[napi]`
//! members to the existing handle classes, delegates every tree operation to
//! Core, and never keeps a second DOM state or fabricates a
//! [`NodeId`](mad_dom_core::arena::NodeId).
//!
//! Extension modules may import the stable context from [`crate::handle`] —
//! `with_document`, `SharedDocument`, `DocumentHandle::shared`,
//! `NodeHandle::shared`, `NodeHandle::id` — and the error outlet from
//! [`crate::error`] (`BindingError`, `into_napi`). Extensions must not depend on
//! each other and must not implement affinity semantics themselves.

mod attribute_nodes_api;
mod attributes_api;
mod character_data_api;
mod collection_api;
mod custom_elements_api;
mod epoch_api;
mod events_api;
mod form_api;
mod html_api;
mod html_element_api;
mod live_collections;
mod mutation_insert_api;
pub(crate) mod mutation_observer_api;
mod mutation_remove_api;
mod node_api;
mod query_api;
mod range_api;
mod shadow_dom_api;
mod template_api;
mod text_api;
mod traversal_api;
mod window_document;
