//! Native `textContent` extension boundary (T20A seam placeholder).
//!
//! T25E implements this module after T20A archives: the `textContent` get/set
//! argument conversion, return values and error propagation on top of the
//! T25A Core payload seam, with string conversion, null handling and failure
//! atomicity covered. Attributes belong to T25E's sibling `attributes_api`
//! module.
//!
//! Owned by **T25E**; integration gate: **T25**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "text_api",
    owner: "T25E",
    gate: "T25",
    status: "placeholder",
};
