//! Native form-control binding (T40).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the Core form contract
//! (`mad_dom_core::dom::form`) to JavaScript: the first-batch form-control
//! surface for `input` / `button` / `select` / `option` / `textarea` and the
//! `form` element. Like the M5/M6/M7 extensions before it, it adds *new*
//! native symbols to the existing [`NodeHandle`](crate::handle::NodeHandle)
//! class through a second `#[napi] impl` block — napi merges class properties
//! registered for the same Rust type, so the class keeps its audited surface
//! with no duplicate export and no touch to the shared `handle.rs`.
//!
//! # What is native vs. facade
//!
//! Only the *stateful* form reads/writes cross this boundary: the dirty input
//! value and checkedness, the option selectedness and the select selection
//! model, the form control list and the reset algorithm. The attribute-only
//! reflections (`name` / `disabled` / `required` / `readOnly` / `multiple` /
//! `defaultChecked` / `defaultValue`, the button `type`/`value`, the form
//! `method`/`action`/`target`/...) are pure facade reads/writes over the
//! existing T25E attribute contract, exactly like the T39 reflected accessors —
//! so the arena + Core's form state stay the single authoritative form state
//! and the facade keeps no second copy.
//!
//! # Frozen native contract (consumed by the T40 facade)
//!
//! ## Input / textarea value and checkedness
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `input.type` | `inputType` | `() → String` | the computed `type` (lowercased, valid states only, `"text"` fallback) |
//! | `input.value` | `inputValue` | `() → String` | the type-dependent value (dirty value for text-like states, attribute for button-like, `"on"` fallback for checkbox/radio) |
//! | `input.value` setter | `setInputValue` | `(value: String) → ()` | type-dependent: attribute write for button-like/checkbox/radio, sanitized dirty write for text-like, empty-only for `file` |
//! | `input.checked` | `inputChecked` | `() → bool` | the dirty checkedness, else the `checked` attribute presence |
//! | `input.checked` setter | `setInputChecked` | `(checked: bool) → ()` | stores the dirty checkedness (with radio-group exclusivity) |
//! | `textarea.value` | `textareaValue` | `() → String` | the dirty value, else the text content |
//! | `textarea.value` setter | `setTextareaValue` | `(value: String) → ()` | stores the dirty value |
//!
//! ## Option / select selection
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `option.value` | `optionValue` | `() → String` | the `value` attribute, else the option text |
//! | `option.index` | `optionIndex` | `() → i64` | the option's index among its owning select's options |
//! | `option.selected` | `optionSelected` | `() → bool` | the materialized/attribute/default selection |
//! | `option.selected` setter | `setOptionSelected` | `(selected: bool) → ()` | materializes the selection (single-select exclusivity + default fallback) |
//! | `select.options` | `selectOptions` | `() → Vec<NodeHandle>` | the descendant options, in document order (live re-read) |
//! | `select.value` | `selectValue` | `() → String` | the first selected option's value, `""` when none |
//! | `select.value` setter | `setSelectValue` | `(value: String) → ()` | materializes the selection by value |
//! | `select.selectedIndex` | `selectSelectedIndex` | `() → i64` | the first selected option's index, `-1` when none |
//! | `select.selectedIndex` setter | `setSelectSelectedIndex` | `(index: i64) → ()` | selects the option at `index` |
//! | `select.selectedOptions` | `selectSelectedOptions` | `() → Vec<NodeHandle>` | the selected options, in document order (live re-read) |
//!
//! ## Form
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `control.form` | `ownerForm` | `() → NodeHandle \| null` | the nearest ancestor `<form>` element, or `null` |
//! | `form.elements` | `formElements` | `() → Vec<NodeHandle>` | the listed form-control descendants, in document order (live re-read) |
//! | `form.reset()` control half | `formReset` | `() → ()` | resets every control to its default (the `reset` event is dispatched by the facade) |
//!
//! # Single source of form state
//!
//! All state lives in Core (the arena plus the per-document `form_state` map);
//! this module forwards reads verbatim and routes writes into Core, so a change
//! through `input.value` is immediately visible to a later read and vice versa.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! a non-eligible element kind with `ERR_MAD_DOM_HIERARCHY` (e.g. `inputValue`
//! on a `div`, or a non-empty `file` value).
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T40**; there is no separate integration gate, so T40 also wires
//! the facade and the shared entry/type/ledger surfaces itself. The seam
//! metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/template-form.test.js` and the `hc-diff-form-controls`
//! differential scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `form_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "form_api",
    owner: "T40",
    gate: "T40",
    status: "implemented",
};

/// The frozen native form surface on [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const FORM_CONTRACT: &[&str] = &[
    "inputType",
    "inputValue",
    "setInputValue",
    "inputChecked",
    "setInputChecked",
    "textareaValue",
    "setTextareaValue",
    "optionValue",
    "optionIndex",
    "optionSelected",
    "setOptionSelected",
    "selectOptions",
    "selectValue",
    "setSelectValue",
    "selectSelectedIndex",
    "setSelectSelectedIndex",
    "selectSelectedOptions",
    "formElements",
    "formReset",
    "ownerForm",
];

/// Wraps every `NodeId` Core returned into a JS node wrapper through the
/// single per-document weak cache.
fn wrap_all(
    env: Env,
    shared: &std::sync::Arc<SharedDocument>,
    ids: Vec<NodeId>,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    ids.iter().map(|id| shared.wrap_node(env, *id)).collect()
}

#[napi]
impl NodeHandle {
    /// The computed `input.type`.
    #[napi(catch_unwind)]
    pub fn input_type(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.input_type(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The type-dependent `input.value`.
    #[napi(catch_unwind)]
    pub fn input_value(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.input_value(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `input.value` (WebIDL-shaped string from the facade).
    #[napi(catch_unwind)]
    pub fn set_input_value(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_input_value(self.id(), &value)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `input.checked` read.
    #[napi(catch_unwind)]
    pub fn input_checked(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.input_checked(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `input.checked`.
    #[napi(catch_unwind)]
    pub fn set_input_checked(&self, env: Env, checked: bool) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_input_checked(self.id(), checked)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `textarea.value` read.
    #[napi(catch_unwind)]
    pub fn textarea_value(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.textarea_value(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `textarea.value`.
    #[napi(catch_unwind)]
    pub fn set_textarea_value(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_textarea_value(self.id(), &value)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `option.value` read.
    #[napi(catch_unwind)]
    pub fn option_value(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.option_value(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `option.index` read.
    #[napi(catch_unwind)]
    pub fn option_index(&self, env: Env) -> napi::Result<i64> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.option_index(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `option.selected` read.
    #[napi(catch_unwind)]
    pub fn option_selected(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.option_selected(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `option.selected`.
    #[napi(catch_unwind)]
    pub fn set_option_selected(&self, env: Env, selected: bool) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_option_selected(self.id(), selected)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `select.options` live read.
    #[napi(catch_unwind)]
    pub fn select_options(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.select_options(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }

    /// The `select.value` read.
    #[napi(catch_unwind)]
    pub fn select_value(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.select_value(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `select.value`.
    #[napi(catch_unwind)]
    pub fn set_select_value(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_select_value(self.id(), &value)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `select.selectedIndex` read.
    #[napi(catch_unwind)]
    pub fn select_selected_index(&self, env: Env) -> napi::Result<i64> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.select_selected_index(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets `select.selectedIndex`.
    #[napi(catch_unwind)]
    pub fn set_select_selected_index(&self, env: Env, index: i64) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_select_selected_index(self.id(), index)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The `select.selectedOptions` live read.
    #[napi(catch_unwind)]
    pub fn select_selected_options(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.select_selected_options(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }

    /// The `control.form` read: the nearest ancestor `<form>` element, or
    /// `null`.
    #[napi(catch_unwind)]
    pub fn owner_form(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.owner_form(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        match id {
            None => Ok(None),
            Some(id) => self.shared().wrap_node(env, id).map(Some),
        }
    }

    /// The `form.elements` live read.
    #[napi(catch_unwind)]
    pub fn form_elements(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.form_elements(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }

    /// The control half of `form.reset()`: resets every listed control to its
    /// default value (the `reset` event is dispatched by the facade).
    #[napi(catch_unwind)]
    pub fn form_reset(&self, env: Env) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.form_reset(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native T40 form surface is exactly the entries this module
    /// adds — never a foreign seam's surface (attribute read/write, textContent
    /// and innerHTML stay in the existing T25E / T29 entries).
    #[test]
    fn frozen_form_contract_surface() {
        assert_eq!(FORM_CONTRACT.len(), 20, "the form surface is 20 entries");
        assert_eq!(FORM_CONTRACT[0], "inputType");
        assert_eq!(FORM_CONTRACT[9], "optionSelected");
        assert_eq!(FORM_CONTRACT[10], "setOptionSelected");
        assert_eq!(FORM_CONTRACT[19], "ownerForm");
    }

    /// The form surface must never drift into the reflected-attribute symbols
    /// (name/disabled/type reflection stays facade-only over the attribute
    /// contract) or the selector/text surfaces.
    #[test]
    fn form_surface_has_no_foreign_symbols() {
        for name in FORM_CONTRACT {
            assert!(
                !name.starts_with("getAttribute")
                    && !name.starts_with("setAttribute")
                    && !name.starts_with("removeAttribute")
                    && *name != "textContent"
                    && *name != "innerHTML"
                    && !name.contains("querySelector"),
                "form_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
