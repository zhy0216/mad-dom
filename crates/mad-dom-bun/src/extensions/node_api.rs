//! Native node creation/navigation extension boundary (T20A seam placeholder).
//!
//! T23A implements or audits this module after T20A archives: `createElement`,
//! `createTextNode`, `parent`/`child`/`sibling`, `nodeType`, `nodeName` as a
//! frozen native contract for the facade. Existing low-level methods in
//! [`crate::handle`] are reused or relocated without duplicating symbols; the
//! T19/T20 wrapper cache, document ownership and Core delegation are reused.
//!
//! Owned by **T23A**; integration gate: **T23**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "node_api",
    owner: "T23A",
    gate: "T23",
    status: "placeholder",
};
