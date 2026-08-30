//! Form-control state and the first form contract (T40).
//!
//! This module owns the *non-attribute* state the form-control surface needs,
//! stored per document in [`Document::form_state`]. Everything that can live in
//! the attribute storage does — `name` / `disabled` / `required` / `readOnly` /
//! `multiple` and the `selected` / `checked` default attributes are pure
//! reflections over the T25B attribute contract. What needs a separate cell is
//! the *dirty* value/checkedness a user writes and the select/option selection
//! model, which the WHATWG keeps outside the attribute list:
//!
//! - a **dirty input value** for text-like inputs ([`Document::set_input_value`])
//!   and a **dirty textarea value** ([`Document::set_textarea_value`]) — the
//!   stored string that shadows the `value` attribute / text content until
//!   reset;
//! - a **dirty checkedness** for checkbox/radio inputs
//!   ([`Document::set_input_checked`]), with the radio-group exclusivity rule;
//! - the **option selection model** ([`Document::option_selected`] /
//!   [`Document::set_option_selected`]) and the **select selection** read/write
//!   ([`Document::select_value`] / [`Document::select_selected_index`]),
//!   including the WHATWG default selection (the first non-disabled option of a
//!   single select when nothing is explicitly selected);
//! - the **form element list** ([`Document::form_elements`]) and the **reset**
//!   algorithm ([`Document::form_reset`]) behind `form.elements` and
//!   `form.reset()`.
//!
//! The facade keeps **no second copy**: every read is produced here on demand
//! and every write lands in the map below, so the arena + this map stay the
//! single authoritative form state.
//!
//! # Recorded gaps (advanced validation)
//!
//! This milestone implements the *basic* control contract. The advanced
//! validation machinery — `ValidityState`, `checkValidity` / `reportValidity`
//! constraint evaluation, `setCustomValidity`, `min`/`max`/`pattern`/
//! `maxlength` enforcement, `valueAsNumber` / `valueAsDate`, selection
//! ranges, `FileList`, the date/time sanitizers and the `form`-attribute
//! external association — is **not** implemented and must stay explicit gaps.
//! `input.value` for the date/time/color/file states stores the raw string
//! (no WHATWG value-sanitization algorithm beyond the text-like newline strip,
//! number and range clamping, email/url trimming implemented below).
//!
//! # Errors
//!
//! Every entry validates document ownership and arena liveness through the
//! shared [`Document`] navigation/attribute entries, so a foreign or stale
//! handle fails with [`CoreError::WrongDocument`] / [`CoreError::Arena`].

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

use std::collections::HashMap;

/// The WHATWG `input.type` states (HTML §4.10.5.1.1).
const INPUT_TYPE_STATES: &[&str] = &[
    "hidden",
    "text",
    "search",
    "tel",
    "url",
    "email",
    "password",
    "date",
    "month",
    "week",
    "time",
    "datetime-local",
    "number",
    "range",
    "color",
    "checkbox",
    "radio",
    "file",
    "submit",
    "image",
    "reset",
    "button",
];

/// The tags that count as *listed* form-associated elements for `form.elements`
/// (WHATWG, matching happy-dom's `getFormControlItems` selector).
const FORM_CONTROL_TAGS: &[&str] = &[
    "input", "select", "textarea", "button", "fieldset", "object", "output",
];

/// Per-document form-control state (T40, extended by T48C).
///
/// Keys are [`NodeId`]s into the owning document's arena. Every field is the
/// single authoritative cell for the state it owns; attribute-reflected state
/// never appears here.
#[derive(Debug, Default)]
pub struct FormState {
    /// Dirty text-like input / textarea values: `element -> stored value`.
    pub(crate) dirty_values: HashMap<NodeId, String>,
    /// Dirty checkbox/radio checkedness: `element -> stored checked`.
    pub(crate) dirty_checked: HashMap<NodeId, bool>,
    /// Materialized option selectedness: `option -> selected`.
    pub(crate) option_selectedness: HashMap<NodeId, bool>,
    /// Option dirtyness: `option -> dirty` (set by the `selected` setter; used
    /// by the reset algorithm to know which selections are author-set).
    pub(crate) option_dirtyness: HashMap<NodeId, bool>,
    /// Custom validation message (T48C): the `setCustomValidity` payload for
    /// `element -> message`. An empty message is not stored — setting an empty
    /// string clears the entry, so the `customError` validity flag reads this
    /// map's presence.
    pub(crate) custom_validity: HashMap<NodeId, String>,
}

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// Returns the element's tag name (local name) for an `Element` node, or
/// `None` for other node kinds.
fn element_name(doc: &Document, id: NodeId) -> Result<Option<String>, CoreError> {
    match doc.get(id)?.data() {
        crate::dom::NodeData::Element { name, .. } => Ok(Some(name.as_ref().to_string())),
        _ => Ok(None),
    }
}

/// Collects every descendant `Element` whose tag name equals `tag`
/// (case-insensitive), in document order.
fn descendants_named(doc: &Document, root: NodeId, tag: &str) -> Result<Vec<NodeId>, CoreError> {
    let mut out = Vec::new();
    let mut children = doc.children(root)?;
    children.reverse();
    let mut stack = children;
    while let Some(current) = stack.pop() {
        if let Some(name) = element_name(doc, current)? {
            if name.eq_ignore_ascii_case(tag) {
                out.push(current);
            }
        }
        let mut kids = doc.children(current)?;
        kids.reverse();
        stack.extend(kids);
    }
    Ok(out)
}

/// Collects every descendant `Element` whose tag name is in `tags`, in
/// document order.
fn descendants_named_in(
    doc: &Document,
    root: NodeId,
    tags: &[&str],
) -> Result<Vec<NodeId>, CoreError> {
    let mut out = Vec::new();
    let mut children = doc.children(root)?;
    children.reverse();
    let mut stack = children;
    while let Some(current) = stack.pop() {
        if let Some(name) = element_name(doc, current)? {
            if tags.iter().any(|t| name.eq_ignore_ascii_case(t)) {
                out.push(current);
            }
        }
        let mut kids = doc.children(current)?;
        kids.reverse();
        stack.extend(kids);
    }
    Ok(out)
}

/// Approximates JavaScript's `parseFloat`: the longest numeric prefix of `s`
/// (after leading whitespace), or `None` when none parses.
fn js_parse_float(s: &str) -> Option<f64> {
    let t = s.trim_start();
    if t.is_empty() {
        return None;
    }
    let bytes = t.as_bytes();
    let mut end = 0;
    if bytes[0] == b'+' || bytes[0] == b'-' {
        end = 1;
    }
    let mut saw_digit = false;
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
        saw_digit = true;
    }
    if end < bytes.len() && bytes[end] == b'.' {
        end += 1;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
            saw_digit = true;
        }
    }
    if !saw_digit {
        return None;
    }
    if end < bytes.len() && (bytes[end] == b'e' || bytes[end] == b'E') {
        let mut e = end + 1;
        if e < bytes.len() && (bytes[e] == b'+' || bytes[e] == b'-') {
            e += 1;
        }
        if e < bytes.len() && bytes[e].is_ascii_digit() {
            end = e;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
        }
    }
    t[..end].parse::<f64>().ok()
}

/// The WHATWG input value sanitization for the basic text-like states.
///
/// Advanced states (date / month / week / time / datetime-local / color)
/// are recorded gaps: their value is stored verbatim. `min` / `max` are the
/// element's `min`/`max` attributes as read by the caller (used by the
/// `range` clamp).
fn sanitize_input_value(
    input_type: &str,
    value: &str,
    multiple: bool,
    min: Option<&str>,
    max: Option<&str>,
) -> String {
    match input_type {
        "password" | "search" | "tel" | "text" => value.replace(['\n', '\r'], ""),
        "email" => {
            if multiple {
                value
                    .split(',')
                    .map(str::trim)
                    .collect::<Vec<_>>()
                    .join(",")
            } else {
                value.trim().replace(['\n', '\r'], "")
            }
        }
        "url" => value.trim().replace(['\n', '\r'], ""),
        "number" => match js_parse_float(value) {
            Some(_) => value.to_string(),
            None => String::new(),
        },
        "range" => {
            let number = js_parse_float(value);
            let min_f = min.and_then(js_parse_float).unwrap_or(0.0);
            let max_f = max.and_then(js_parse_float).unwrap_or(100.0);
            match number {
                None => {
                    if max_f < min_f {
                        format!("{}", min_f)
                    } else {
                        format!("{}", (min_f + max_f) / 2.0)
                    }
                }
                Some(n) if n < min_f => format!("{}", min_f),
                Some(n) if n > max_f => format!("{}", max_f),
                Some(_) => value.to_string(),
            }
        }
        _ => value.to_string(),
    }
}

/// Returns the nearest ancestor `<form>` element of `node`, if any.
fn owning_form(doc: &Document, node: NodeId) -> Result<Option<NodeId>, CoreError> {
    let mut cursor = doc.get(node)?.parent();
    while let Some(parent) = cursor {
        if let Some(name) = element_name(doc, parent)? {
            if name.eq_ignore_ascii_case("form") {
                return Ok(Some(parent));
            }
        }
        cursor = doc.get(parent)?.parent();
    }
    Ok(None)
}

/// Returns the owning `<select>` element of `option`: the nearest ancestor
/// `<select>` element, or `None`.
fn owning_select(doc: &Document, option: NodeId) -> Result<Option<NodeId>, CoreError> {
    let mut cursor = doc.get(option)?.parent();
    while let Some(parent) = cursor {
        if let Some(name) = element_name(doc, parent)? {
            if name.eq_ignore_ascii_case("select") {
                return Ok(Some(parent));
            }
        }
        cursor = doc.get(parent)?.parent();
    }
    Ok(None)
}

impl Document {
    /// Returns the WHATWG `input.type`: the lowercased `type` attribute when it
    /// is one of the input type states, otherwise `"text"`.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn input_type(&self, id: NodeId) -> Result<String, CoreError> {
        let raw = self
            .get_attribute(id, "type")?
            .map(|v| v.to_lowercase())
            .unwrap_or_default();
        Ok(if INPUT_TYPE_STATES.contains(&raw.as_str()) {
            raw
        } else {
            "text".to_string()
        })
    }

    /// Returns the WHATWG `input.value` for the node for `id`.
    ///
    /// `hidden`/`submit`/`image`/`reset`/`button` read the `value` attribute
    /// (`""` when absent); `checkbox`/`radio` read it with an `"on"` fallback;
    /// the text-like states read the dirty value when one was stored, else the
    /// attribute (`""` when absent); `file` reads `""` (no `FileList` — the
    /// `file` surface is a recorded gap).
    pub fn input_value(&self, id: NodeId) -> Result<String, CoreError> {
        let t = self.input_type(id)?;
        let attribute = self.get_attribute(id, "value")?;
        match t.as_str() {
            "hidden" | "submit" | "image" | "reset" | "button" => {
                Ok(attribute.unwrap_or_default().to_string())
            }
            "checkbox" | "radio" => Ok(attribute.unwrap_or("on").to_string()),
            "file" => Ok(String::new()),
            _ => match self.form_state.dirty_values.get(&id) {
                Some(dirty) => Ok(dirty.clone()),
                None => Ok(attribute.unwrap_or_default().to_string()),
            },
        }
    }

    /// Sets the WHATWG `input.value`: `hidden`/`submit`/`image`/`reset`/
    /// `button`/`checkbox`/`radio` store the string into the `value` attribute;
    /// `file` rejects a non-empty value ([`CoreError::Hierarchy`] — the happy
    /// DOM `InvalidStateError`); the text-like states store the *sanitized*
    /// dirty value. `value` must already be the string form (the facade does
    /// the WebIDL `DOMString` conversion).
    pub fn set_input_value(&mut self, id: NodeId, value: &str) -> Result<(), CoreError> {
        let t = self.input_type(id)?;
        match t.as_str() {
            "hidden" | "submit" | "image" | "reset" | "button" | "checkbox" | "radio" => {
                self.set_attribute(id, "value", value)
            }
            "file" => {
                if value.is_empty() {
                    self.form_state.dirty_values.remove(&id);
                    Ok(())
                } else {
                    Err(hierarchy(
                        "input elements of type file may only be set to the empty string",
                    ))
                }
            }
            _ => {
                let multiple = self.get_attribute(id, "multiple")?.is_some();
                let min = self.get_attribute(id, "min")?;
                let max = self.get_attribute(id, "max")?;
                let sanitized = sanitize_input_value(&t, value, multiple, min, max);
                self.form_state.dirty_values.insert(id, sanitized);
                Ok(())
            }
        }
    }

    /// Returns the WHATWG `input.defaultValue`: the `value` attribute, `""`
    /// when absent.
    pub fn input_default_value(&self, id: NodeId) -> Result<String, CoreError> {
        Ok(self
            .get_attribute(id, "value")?
            .unwrap_or_default()
            .to_string())
    }

    /// Returns the WHATWG `input.checked`: the dirty checkedness when stored,
    /// else whether the `checked` attribute is present.
    pub fn input_checked(&self, id: NodeId) -> Result<bool, CoreError> {
        if let Some(&checked) = self.form_state.dirty_checked.get(&id) {
            return Ok(checked);
        }
        Ok(self.get_attribute(id, "checked")?.is_some())
    }

    /// Sets the WHATWG `input.checked`, storing the dirty checkedness. When
    /// `checked` is true and the input is a radio with a `name`, every other
    /// radio of the same group (same name, same form or document scope) is
    /// unchecked — the WHATWG radio-group exclusivity rule.
    pub fn set_input_checked(&mut self, id: NodeId, checked: bool) -> Result<(), CoreError> {
        self.form_state.dirty_checked.insert(id, checked);
        if checked && self.input_type(id)? == "radio" {
            let name = self.get_attribute(id, "name")?.map(str::to_string);
            if let Some(name) = name {
                if !name.is_empty() {
                    let scope = owning_form(self, id)?;
                    let group = match scope {
                        Some(form) => descendants_named_in(self, form, &["input"])?,
                        None => {
                            if let Some(root) = self.cached_document_root() {
                                descendants_named_in(self, root, &["input"])?
                            } else {
                                Vec::new()
                            }
                        }
                    };
                    for candidate in group {
                        if candidate == id {
                            continue;
                        }
                        let is_radio = self.input_type(candidate)? == "radio";
                        let candidate_name = self.get_attribute(candidate, "name")?;
                        if is_radio && candidate_name == Some(name.as_str()) {
                            self.form_state.dirty_checked.insert(candidate, false);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Returns the WHATWG `input.defaultChecked`: whether the `checked`
    /// attribute is present.
    pub fn input_default_checked(&self, id: NodeId) -> Result<bool, CoreError> {
        Ok(self.get_attribute(id, "checked")?.is_some())
    }

    /// Returns the WHATWG `textarea.value`: the dirty value when stored, else
    /// the element's text content.
    pub fn textarea_value(&self, id: NodeId) -> Result<String, CoreError> {
        if let Some(dirty) = self.form_state.dirty_values.get(&id) {
            return Ok(dirty.clone());
        }
        Ok(self.text_content(id)?.unwrap_or_default())
    }

    /// Sets the WHATWG `textarea.value`, storing the dirty value.
    pub fn set_textarea_value(&mut self, id: NodeId, value: &str) -> Result<(), CoreError> {
        self.form_state.dirty_values.insert(id, value.to_string());
        Ok(())
    }

    /// Returns every descendant `<option>` element of the `<select>` for `id`,
    /// in document order (the `select.options` live collection source).
    pub fn select_options(&self, id: NodeId) -> Result<Vec<NodeId>, CoreError> {
        self.get(id)?;
        descendants_named(self, id, "option")
    }

    /// Returns whether `option` is disabled — its own `disabled` attribute, or
    /// an ancestor `optgroup` with a `disabled` attribute (the WHATWG rule).
    fn option_is_disabled(&self, option: NodeId) -> Result<bool, CoreError> {
        if self.get_attribute(option, "disabled")?.is_some() {
            return Ok(true);
        }
        let mut cursor = self.get(option)?.parent();
        while let Some(parent) = cursor {
            match element_name(self, parent)? {
                Some(name) if name.eq_ignore_ascii_case("optgroup") => {
                    return Ok(self.get_attribute(parent, "disabled")?.is_some());
                }
                Some(name) if name.eq_ignore_ascii_case("select") => return Ok(false),
                _ => {}
            }
            cursor = self.get(parent)?.parent();
        }
        Ok(false)
    }

    /// Returns whether the node for `id` is a single-select (`multiple`
    /// attribute absent).
    fn select_is_single(&self, id: NodeId) -> Result<bool, CoreError> {
        Ok(self.get_attribute(id, "multiple")?.is_none())
    }

    /// Whether any option of `select` carries a `selected` attribute (used to
    /// decide whether the default selection applies).
    fn any_option_has_selected_attr(&self, select: NodeId) -> Result<bool, CoreError> {
        for option in self.select_options(select)? {
            if self.get_attribute(option, "selected")?.is_some() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// The first non-disabled option of `select`, or `None`.
    fn first_non_disabled_option(&self, select: NodeId) -> Result<Option<NodeId>, CoreError> {
        for option in self.select_options(select)? {
            if !self.option_is_disabled(option)? {
                return Ok(Some(option));
            }
        }
        Ok(None)
    }

    /// Returns whether `option` is selected within its owning `<select>`
    /// (the `option.selected` read).
    ///
    /// Selection is the materialized dirty state when present; otherwise the
    /// `selected` attribute; otherwise — for a single select that was never
    /// explicitly touched — the WHATWG default (the first non-disabled option).
    pub fn option_selected(&self, option: NodeId) -> Result<bool, CoreError> {
        if let Some(&selected) = self.form_state.option_selectedness.get(&option) {
            return Ok(selected);
        }
        if self.get_attribute(option, "selected")?.is_some() {
            return Ok(true);
        }
        let Some(select) = owning_select(self, option)? else {
            return Ok(false);
        };
        if !self.select_is_single(select)? {
            return Ok(false);
        }
        if self.any_option_has_selected_attr(select)? {
            return Ok(false);
        }
        Ok(self.first_non_disabled_option(select)? == Some(option))
    }

    /// Returns the index of the first selected option of the `<select>` for
    /// `id`, or `-1` when nothing is selected (`select.selectedIndex`).
    pub fn select_selected_index(&self, id: NodeId) -> Result<i64, CoreError> {
        let options = self.select_options(id)?;
        for (index, option) in options.iter().enumerate() {
            if self.option_selected(*option)? {
                return Ok(index as i64);
            }
        }
        Ok(-1)
    }

    /// Returns the WHATWG `select.value`: the value of the first selected
    /// option, or `""` when none is selected.
    pub fn select_value(&self, id: NodeId) -> Result<String, CoreError> {
        let options = self.select_options(id)?;
        for option in options {
            if self.option_selected(option)? {
                return self.option_value(option);
            }
        }
        Ok(String::new())
    }

    /// Returns every selected descendant `<option>` of the `<select>` for `id`
    /// (the `select.selectedOptions` live collection source).
    pub fn select_selected_options(&self, id: NodeId) -> Result<Vec<NodeId>, CoreError> {
        let mut out = Vec::new();
        for option in self.select_options(id)? {
            if self.option_selected(option)? {
                out.push(option);
            }
        }
        Ok(out)
    }

    /// Sets the WHATWG `select.value`, materializing the selection: the option
    /// whose value equals `value` becomes selected, every other option
    /// unselected (a `value` matching nothing selects nothing).
    pub fn set_select_value(&mut self, id: NodeId, value: &str) -> Result<(), CoreError> {
        let options = self.select_options(id)?;
        let mut matched = false;
        for option in options {
            let selected = self.option_value(option)? == value;
            self.form_state.option_selectedness.insert(option, selected);
            self.form_state.option_dirtyness.insert(option, selected);
            if selected {
                matched = true;
            }
        }
        if !matched {
            for option in self.select_options(id)? {
                self.form_state.option_selectedness.insert(option, false);
            }
        }
        Ok(())
    }

    /// Sets the WHATWG `select.selectedIndex`, selecting the option at
    /// `index` and unselecting every other. An out-of-range index selects
    /// nothing. `index` must already be the coerced number (the facade handles
    /// the `Number` conversion and the `NaN` early return).
    pub fn set_select_selected_index(&mut self, id: NodeId, index: i64) -> Result<(), CoreError> {
        let options = self.select_options(id)?;
        for (i, option) in options.iter().enumerate() {
            let selected = i as i64 == index;
            self.form_state
                .option_selectedness
                .insert(*option, selected);
            self.form_state.option_dirtyness.insert(*option, selected);
        }
        Ok(())
    }

    /// Returns the WHATWG `option.value`: the `value` attribute, or the
    /// option's text content when the attribute is absent.
    pub fn option_value(&self, option: NodeId) -> Result<String, CoreError> {
        match self.get_attribute(option, "value")? {
            Some(value) => Ok(value.to_string()),
            None => Ok(self.text_content(option)?.unwrap_or_default()),
        }
    }

    /// Returns the WHATWG `option.index`: the option's index among the
    /// descendant options of its owning `<select>` (0 when the option has no
    /// owning select).
    pub fn option_index(&self, option: NodeId) -> Result<i64, CoreError> {
        let Some(select) = owning_select(self, option)? else {
            return Ok(0);
        };
        for (index, candidate) in self.select_options(select)?.iter().enumerate() {
            if *candidate == option {
                return Ok(index as i64);
            }
        }
        Ok(0)
    }

    /// Sets the WHATWG `option.selected`, materializing the selection: for a
    /// single select, selecting an option unselects every other and
    /// unselecting the last selected option falls back to the default
    /// selection (the first non-disabled option), mirroring happy-dom's
    /// `updateSelectedness`.
    pub fn set_option_selected(&mut self, option: NodeId, selected: bool) -> Result<(), CoreError> {
        self.form_state.option_dirtyness.insert(option, selected);
        self.form_state.option_selectedness.insert(option, selected);
        let Some(select) = owning_select(self, option)? else {
            return Ok(());
        };
        if !self.select_is_single(select)? {
            return Ok(());
        }
        if selected {
            for other in self.select_options(select)? {
                self.form_state
                    .option_selectedness
                    .insert(other, other == option);
            }
        } else {
            let has_selected = self
                .select_options(select)?
                .iter()
                .any(|o| self.form_state.option_selectedness.get(o) == Some(&true));
            if !has_selected {
                if let Some(first) = self.first_non_disabled_option(select)? {
                    self.form_state.option_selectedness.insert(first, true);
                }
            }
        }
        Ok(())
    }

    /// Returns the nearest ancestor `<form>` element of the node for `id` (the
    /// `control.form` read), or `None` when the node has no form ancestor.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn owner_form(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        owning_form(self, id)
    }

    /// Returns the custom validation message of the node for `id` (T48C): the
    /// message set by `setCustomValidity`, or `""` when none is set.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn custom_validity(&self, id: NodeId) -> Result<String, CoreError> {
        self.get(id)?;
        Ok(self
            .form_state
            .custom_validity
            .get(&id)
            .cloned()
            .unwrap_or_default())
    }

    /// Stores the custom validation message of the node for `id` (T48C): the
    /// WHATWG `setCustomValidity` payload. An empty message clears the entry
    /// (setting an empty string removes the `customError` constraint).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn set_custom_validity(&mut self, id: NodeId, message: &str) -> Result<(), CoreError> {
        self.get(id)?;
        if message.is_empty() {
            self.form_state.custom_validity.remove(&id);
        } else {
            self.form_state
                .custom_validity
                .insert(id, message.to_string());
        }
        Ok(())
    }

    /// Returns every listed form-control descendant of the `<form>` for `id`
    /// (`form.elements`), in document order.
    pub fn form_elements(&self, id: NodeId) -> Result<Vec<NodeId>, CoreError> {
        self.get(id)?;
        descendants_named_in(self, id, FORM_CONTROL_TAGS)
    }

    /// Resets every listed form control to its default value (`form.reset()`'s
    /// control half): text-like inputs and textareas clear the dirty value,
    /// checkbox/radio inputs clear the dirty checkedness, and selects re-select
    /// the option carrying the `selected` attribute (or the first option).
    pub fn form_reset(&mut self, id: NodeId) -> Result<(), CoreError> {
        for element in self.form_elements(id)? {
            match element_name(self, element)?.as_deref() {
                Some("textarea") => {
                    self.form_state.dirty_values.remove(&element);
                }
                Some("input") => {
                    self.form_state.dirty_values.remove(&element);
                    self.form_state.dirty_checked.remove(&element);
                }
                Some("select") => {
                    let options = self.select_options(element)?;
                    let mut selected_attr = None;
                    for option in &options {
                        if self.get_attribute(*option, "selected")?.is_some() {
                            selected_attr = Some(*option);
                            break;
                        }
                    }
                    if let Some(option) = selected_attr {
                        self.set_option_selected(option, true)?;
                    } else if let Some(&first) = options.first() {
                        self.set_option_selected(first, true)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

/// Returns the owning `<select>` of `option`: the nearest ancestor `<select>`
/// element, or `None`. (Distinct from [`owning_form`] — a select is a form
/// control but owns its options.)
#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::NodeType;

    fn connect(body: &mut crate::dom::Document) -> crate::arena::NodeId {
        let root = body.document_root();
        let html = body.create_element("html").unwrap();
        let body_el = body.create_element("body").unwrap();
        body.append_child_for_test(root, html);
        body.append_child_for_test(html, body_el);
        body_el
    }

    /// Parses a fragment into `document.body.innerHTML` and returns the body.
    fn set_body(doc: &mut crate::dom::Document, html: &str) -> crate::arena::NodeId {
        let body = connect(doc);
        doc.set_inner_html(body, html).unwrap();
        body
    }

    fn find_first(
        doc: &crate::dom::Document,
        root: crate::arena::NodeId,
        tag: &str,
    ) -> crate::arena::NodeId {
        let mut stack: Vec<crate::arena::NodeId> =
            doc.children(root).unwrap().into_iter().rev().collect();
        while let Some(current) = stack.pop() {
            if doc.node_name(current).unwrap() == tag {
                return current;
            }
            let mut kids: Vec<crate::arena::NodeId> = doc.children(current).unwrap();
            kids.reverse();
            stack.extend(kids);
        }
        panic!("tag {tag} not found");
    }

    #[test]
    fn input_value_defaults_and_dirty() {
        let mut doc = Document::new();
        let body = set_body(&mut doc, "<input id=\"a\" value=\"v\"><input id=\"b\">");
        let a = find_first(&doc, body, "input");
        assert_eq!(doc.input_value(a).unwrap(), "v");
        assert_eq!(doc.input_default_value(a).unwrap(), "v");

        doc.set_input_value(a, "dirty").unwrap();
        assert_eq!(doc.input_value(a).unwrap(), "dirty");
        assert_eq!(
            doc.get_attribute(a, "value").unwrap(),
            Some("v"),
            "a dirty text value does not touch the attribute"
        );

        doc.form_reset(body).unwrap();
        assert_eq!(doc.input_value(a).unwrap(), "v");
    }

    #[test]
    fn input_value_is_type_dependent() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<input id=\"c\" type=\"checkbox\"><input id=\"s\" type=\"submit\" value=\"go\">",
        );
        let checkbox = find_first(&doc, body, "input");
        let submit = doc
            .children(body)
            .unwrap()
            .iter()
            .find(|&&c| doc.get_attribute(c, "type").unwrap() == Some("submit"))
            .copied()
            .unwrap();
        assert_eq!(doc.input_value(checkbox).unwrap(), "on");
        assert_eq!(doc.input_value(submit).unwrap(), "go");
        doc.set_input_value(checkbox, "x").unwrap();
        assert_eq!(doc.get_attribute(checkbox, "value").unwrap(), Some("x"));
        assert_eq!(doc.input_value(checkbox).unwrap(), "x");
    }

    #[test]
    fn input_type_falls_back_to_text_and_lowercases() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<input id=\"a\" type=\"CHECKBOX\"><input id=\"b\"><input id=\"c\" type=\"bogus\">",
        );
        let mut by_id = std::collections::HashMap::new();
        for c in doc.children(body).unwrap() {
            let id = doc.get_attribute(c, "id").unwrap().unwrap();
            by_id.insert(id, c);
        }
        assert_eq!(doc.input_type(by_id["a"]).unwrap(), "checkbox");
        assert_eq!(doc.input_type(by_id["b"]).unwrap(), "text");
        assert_eq!(doc.input_type(by_id["c"]).unwrap(), "text");
    }

    #[test]
    fn checked_dirty_and_radio_group_exclusivity() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<input type=\"radio\" name=\"g\" id=\"r1\" checked><input type=\"radio\" name=\"g\" id=\"r2\">",
        );
        let r1 = find_first(&doc, body, "input");
        let r2 = doc
            .children(body)
            .unwrap()
            .iter()
            .find(|&&c| doc.get_attribute(c, "id").unwrap() == Some("r2"))
            .copied()
            .unwrap();
        assert!(doc.input_checked(r1).unwrap());
        assert!(!doc.input_checked(r2).unwrap());

        doc.set_input_checked(r2, true).unwrap();
        assert!(!doc.input_checked(r1).unwrap());
        assert!(doc.input_checked(r2).unwrap());

        doc.form_reset(body).unwrap();
        assert!(doc.input_checked(r1).unwrap());
        assert!(!doc.input_checked(r2).unwrap());
    }

    #[test]
    fn select_default_selection_and_value() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<select id=\"s\"><option value=\"a\">A</option><option value=\"b\" selected>B</option></select>",
        );
        let select = find_first(&doc, body, "select");
        let options = doc.select_options(select).unwrap();
        eprintln!(
            "DBG opt0={:?} opt1={:?}",
            doc.get(options[0]).unwrap().data().element_attributes(),
            doc.get(options[1]).unwrap().data().element_attributes()
        );
        assert_eq!(doc.select_value(select).unwrap(), "b");
        assert!(doc.option_selected(options[1]).unwrap());
        assert!(!doc.option_selected(options[0]).unwrap());
        assert_eq!(doc.option_value(options[0]).unwrap(), "a");
        assert_eq!(doc.option_value(options[1]).unwrap(), "b");
        assert_eq!(doc.option_index(options[1]).unwrap(), 1);
    }

    #[test]
    fn select_defaults_to_first_non_disabled() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<select id=\"s\"><option value=\"a\" disabled>A</option><option value=\"b\">B</option><option value=\"c\">C</option></select>",
        );
        let select = find_first(&doc, body, "select");
        assert_eq!(doc.select_value(select).unwrap(), "b");
        assert_eq!(doc.select_selected_index(select).unwrap(), 1);
    }

    #[test]
    fn select_value_setter_materializes_selection() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<select id=\"s\"><option value=\"a\">A</option><option value=\"b\">B</option></select>",
        );
        let select = find_first(&doc, body, "select");
        doc.set_select_value(select, "a").unwrap();
        assert_eq!(doc.select_value(select).unwrap(), "a");
        assert_eq!(doc.select_selected_index(select).unwrap(), 0);

        doc.set_select_value(select, "missing").unwrap();
        assert_eq!(doc.select_value(select).unwrap(), "");
        assert_eq!(doc.select_selected_index(select).unwrap(), -1);
    }

    #[test]
    fn option_selected_setter_unselects_single_select_siblings() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<select id=\"s\"><option value=\"a\">A</option><option value=\"b\">B</option></select>",
        );
        let select = find_first(&doc, body, "select");
        let options = doc.select_options(select).unwrap();
        doc.set_option_selected(options[1], true).unwrap();
        assert!(doc.option_selected(options[1]).unwrap());
        assert!(!doc.option_selected(options[0]).unwrap());
        assert_eq!(doc.select_selected_index(select).unwrap(), 1);
    }

    #[test]
    fn textarea_value_and_reset() {
        let mut doc = Document::new();
        let body = set_body(&mut doc, "<textarea id=\"t\">default</textarea>");
        let textarea = find_first(&doc, body, "textarea");
        assert_eq!(doc.textarea_value(textarea).unwrap(), "default");
        doc.set_textarea_value(textarea, "typed").unwrap();
        assert_eq!(doc.textarea_value(textarea).unwrap(), "typed");
        assert_eq!(
            doc.text_content(textarea).unwrap().as_deref(),
            Some("default"),
            "a dirty textarea value does not touch the text content"
        );
        doc.form_reset(body).unwrap();
        assert_eq!(doc.textarea_value(textarea).unwrap(), "default");
    }

    #[test]
    fn form_elements_lists_controls_in_document_order() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<form id=\"f\"><input><select></select><button></button><div><textarea></textarea></div></form><input>",
        );
        let form = find_first(&doc, body, "form");
        let elements = doc.form_elements(form).unwrap();
        let names: Vec<String> = elements
            .iter()
            .map(|&e| doc.node_name(e).unwrap().to_string())
            .collect();
        assert_eq!(names, ["input", "select", "button", "textarea"]);
        assert_eq!(elements.len(), 4);
        assert_eq!(doc.node_type(form).unwrap(), NodeType::Element);
    }

    #[test]
    fn sanitize_number_and_text_strip_newlines() {
        let mut doc = Document::new();
        let body = set_body(
            &mut doc,
            "<input id=\"t\" type=\"text\"><input id=\"n\" type=\"number\">",
        );
        let text = find_first(&doc, body, "input");
        let number = doc
            .children(body)
            .unwrap()
            .iter()
            .find(|&&c| doc.get_attribute(c, "type").unwrap() == Some("number"))
            .copied()
            .unwrap();
        doc.set_input_value(text, "a\nb").unwrap();
        assert_eq!(doc.input_value(text).unwrap(), "ab");
        doc.set_input_value(number, "12.5").unwrap();
        assert_eq!(doc.input_value(number).unwrap(), "12.5");
        doc.set_input_value(number, "abc").unwrap();
        assert_eq!(doc.input_value(number).unwrap(), "");
    }

    #[test]
    fn custom_validity_roundtrip_and_clear() {
        let mut doc = Document::new();
        let body = set_body(&mut doc, "<input id=\"a\"><input id=\"b\">");
        let a = find_first(&doc, body, "input");
        let b = doc
            .children(body)
            .unwrap()
            .iter()
            .find(|&&c| doc.get_attribute(c, "id").unwrap() == Some("b"))
            .copied()
            .unwrap();
        assert_eq!(doc.custom_validity(a).unwrap(), "");
        doc.set_custom_validity(a, "custom message").unwrap();
        assert_eq!(doc.custom_validity(a).unwrap(), "custom message");
        assert_eq!(doc.custom_validity(b).unwrap(), "");
        doc.set_custom_validity(a, "").unwrap();
        assert_eq!(doc.custom_validity(a).unwrap(), "");
        assert!(
            !doc.form_state.custom_validity.contains_key(&a),
            "an empty message must clear the stored entry"
        );
    }

    #[test]
    fn form_reset_keeps_custom_validity() {
        let mut doc = Document::new();
        let body = set_body(&mut doc, "<input id=\"a\" value=\"v\">");
        let a = find_first(&doc, body, "input");
        doc.set_custom_validity(a, "kept").unwrap();
        doc.form_reset(body).unwrap();
        assert_eq!(doc.custom_validity(a).unwrap(), "kept");
    }
}
