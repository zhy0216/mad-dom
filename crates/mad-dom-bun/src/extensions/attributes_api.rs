//! Native attribute extension boundary (T20A seam placeholder).
//!
//! T25E implements this module after T20A archives: attribute get/set/remove/
//! has argument conversion, return values and error propagation on top of the
//! T25A Core payload seam, with string conversion, non-Element behavior, null
//! handling and failure atomicity covered. `textContent` belongs to T25E's
//! sibling `text_api` module.
//!
//! Owned by **T25E**; integration gate: **T25**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "attributes_api",
    owner: "T25E",
    gate: "T25",
    status: "placeholder",
};
