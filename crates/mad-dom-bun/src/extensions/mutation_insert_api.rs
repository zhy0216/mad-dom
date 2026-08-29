//! Native append/insert mutation extension boundary (T20A seam placeholder).
//!
//! T24A implements this module after T20A archives: `appendChild` and
//! `insertBefore` argument conversion, return values and error propagation
//! through the T21 error/affinity wiring protocol. It must not re-implement a
//! tree rule or keep a second DOM state; failures must not modify the tree.
//! `removeChild`/`replaceChild` belong to T24B (`mutation_remove_api`).
//!
//! Owned by **T24A**; integration gate: **T24**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "mutation_insert_api",
    owner: "T24A",
    gate: "T24",
    status: "placeholder",
};
