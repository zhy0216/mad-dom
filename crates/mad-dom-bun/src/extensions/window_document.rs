//! Native `Window`/`Document` extension boundary (T20A seam placeholder).
//!
//! T22A implements this module after T20A archives: document creation and
//! destruction, the `Window → Document` strong-ownership link, and the frozen
//! `DocumentContext` the facade contract builds on. It reuses the T19/T20
//! wrapper cache, lifecycle and Core delegation and must not implement node
//! navigation or mutation (T23A / T24A / T24B own those).
//!
//! Owned by **T22A**; integration gate: **T22**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "window_document",
    owner: "T22A",
    gate: "T22",
    status: "placeholder",
};
