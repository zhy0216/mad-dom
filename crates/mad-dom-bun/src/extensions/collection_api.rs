//! Native live child collection extension boundary (T20A seam placeholder).
//!
//! T25D implements this module after T20A archives: the live `childNodes`/
//! NodeList read path (length, index, iteration, wrapper identity) built only
//! on the frozen node/mutation contracts. No query indexes or `HTMLCollection`
//! are in scope; collection reads never cache a second authoritative tree
//! state and never touch a dangling `NodeId`.
//!
//! Owned by **T25D**; integration gate: **T25**. Do not write to this file
//! from any other task. Seam contract and dependency rules: [`crate::extensions`]
//! and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "collection_api",
    owner: "T25D",
    gate: "T25",
    status: "placeholder",
};
