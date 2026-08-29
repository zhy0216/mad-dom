//! Native remove/replace mutation extension boundary (T20A seam placeholder).
//!
//! T24B implements this module after T20A archives: `removeChild` and
//! `replaceChild` argument conversion, return values and error propagation
//! through the T21 error/affinity wiring protocol. It must not re-implement a
//! tree rule or keep a second DOM state; failures must be atomic.
//! `appendChild`/`insertBefore` belong to T24A (`mutation_insert_api`).
//!
//! Owned by **T24B**; integration gate: **T24**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "mutation_remove_api",
    owner: "T24B",
    gate: "T24",
    status: "placeholder",
};
