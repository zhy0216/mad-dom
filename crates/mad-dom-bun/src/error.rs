//! Frozen Core-error → JavaScript-exception taxonomy (T21A).
//!
//! This module is the single, stable classification table shared by the
//! binding and the later safety-boundary integration (T21). It is *pure*: it
//! performs no FFI, contains no `unsafe` and no mutable state, and derives
//! its output solely from the input error value. T21A freezes the rules here;
//! wiring them into the FFI entry points is T21's job and must not require
//! rewriting them.
//!
//! # The four JavaScript error classes
//!
//! | JS class       | semantic bucket           | raised for                                      |
//! |----------------|---------------------------|-------------------------------------------------|
//! | `TypeError`    | argument / usage errors   | a bad argument or structurally invalid handle   |
//! | `SyntaxError`  | non-syntactic input       | parse failures (`CoreError::Syntax`)            |
//! | `DOMException` | DOM-spec errors           | tree / document / character / index violations  |
//! | `Error`        | lifecycle / internal errors | destroyed document, stale arena handles       |
//!
//! ADR-0003 fixed the mapping *shape* (usage errors → `TypeError`, internal
//! errors → plain `Error`, every error carries a stable `code`). T21A keeps
//! that shape and refines it: the DOM-spec violations that T19 lumped into
//! `TypeError` are now `DOMException`s with WHATWG names, and parse failures
//! are `SyntaxError`.
//!
//! # Classification table
//!
//! Every current [`CoreError`] / [`BindingError`] branch maps to exactly one
//! row. A row fixes the JS class ([`JsErrorKind`]), the `name` property
//! ([`error_name`]), a stable string `code` ([`error_code`]) and a message
//! template ([`error_message`]):
//!
//! | branch                 | class          | name                    | code                              | message template                                                       |
//! |------------------------|----------------|-------------------------|-----------------------------------|------------------------------------------------------------------------|
//! | `InvalidHandle`        | `TypeError`    | `TypeError`             | `ERR_MAD_DOM_INVALID_HANDLE`      | `invalid node handle {id}`                                             |
//! | `Hierarchy`            | `DOMException` | `HierarchyRequestError` | `ERR_MAD_DOM_HIERARCHY`           | `the operation would yield an incorrect document tree: {message}`      |
//! | `WrongDocument`        | `DOMException` | `WrongDocumentError`    | `ERR_MAD_DOM_WRONG_DOCUMENT`      | `the node belongs to a different document (expected document {expected_document})` |
//! | `InvalidCharacter`     | `DOMException` | `InvalidCharacterError` | `ERR_MAD_DOM_INVALID_CHARACTER`   | `invalid character in {what}`                                          |
//! | `Syntax`               | `SyntaxError`  | `SyntaxError`           | `ERR_MAD_DOM_SYNTAX`              | `syntax error: {message}`                                              |
//! | `IndexOutOfBounds`     | `DOMException` | `IndexSizeError`        | `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS` | `index {index} out of bounds (len {len})`                              |
//! | `Arena`                | `Error`        | `Error`                 | `ERR_MAD_DOM_STALE_HANDLE`        | per-variant, see [`arena_message`]                                     |
//! | `BindingError::Destroyed` | `Error`     | `Error`                 | `ERR_MAD_DOM_DOCUMENT_DESTROYED`  | `the document has been destroyed`                                      |
//!
//! The `Arena` branch covers three stale-handle conditions (out of bounds,
//! empty slot, generation mismatch) under one code, because all three are the
//! same lifecycle failure — a handle that outlived its node. The string
//! `code`s are unchanged from T19, so consumers already keyed on them keep
//! working.
//!
//! # Message stability
//!
//! Messages are built from the fixed templates above with interpolated values
//! (ids, indices, document numbers, Core-provided detail strings). No message
//! is derived from Rust `Debug` output (`{:?}`), so messages do not change
//! with the Rust toolchain. In particular `InvalidCharacter` never renders the
//! offending character's `Debug` form (the T19 `Display` used `{c:?}`).
//! The thrown message is prefixed with the stable marker `[{code}] `.
//!
//! # Mapping timing
//!
//! Classification happens exactly once, at the FFI boundary, when the
//! operation's `Result` / [`BindingError`] is unwrapped — after Core has fully
//! validated the input, and the failing call performs no partial mutation.
//! Classification is a pure, total, side-effect-free function of the error
//! value: the same error always yields the same class, name, code and message
//! regardless of how often or when it is classified (locked by the
//! determinism tests below).
//!
//! # Thrower (napi4 limitation, resolved by T21)
//!
//! [`BindingError::into_napi`] is the T19 thrower: it consumes the spec and
//! raises the pending JS exception. napi4 — the pinned feature level in this
//! crate's `Cargo.toml` — exposes `throw_error` / `throw_type_error` but no
//! `throw_syntax_error` (that needs the `napi9` feature) and no DOMException
//! constructor, so `SyntaxError` and `DOMException` kinds degrade to a
//! controlled plain `Error` that still carries the stable `code` and embeds
//! the frozen `name`. Raising real `SyntaxError` / `DOMException` objects is
//! part of T21's wiring; the classification rules in this module do not change
//! for it.

use mad_dom_core::arena::ArenaError;
use mad_dom_core::error::CoreError;
use napi::{Env, Error as NapiError, Status};

/// Which JavaScript exception class an error maps to.
///
/// The specific `name` (a DOMException name, or the class name for the three
/// built-ins) is fixed per branch by [`error_name`]; `JsErrorKind` only picks
/// the class.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum JsErrorKind {
    /// `TypeError` — recoverable misuse of the API surface (bad argument,
    /// structurally invalid handle).
    TypeError,
    /// `SyntaxError` — input that is not syntactically valid (parse failures).
    SyntaxError,
    /// `DOMException` — a DOM-spec violation; the exact `name` comes from the
    /// frozen table (e.g. `HierarchyRequestError`, `IndexSizeError`).
    DomException,
    /// Plain `Error` — lifecycle or internal failures.
    Error,
}

/// The frozen classification of one error: JS class, `name`, stable `code`
/// and a stable template-based message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ErrorSpec {
    /// The JavaScript exception class to raise.
    pub kind: JsErrorKind,
    /// The `name` property the raised error carries (`"TypeError"`,
    /// `"SyntaxError"`, `"Error"`, or a DOMException name).
    pub name: &'static str,
    /// Stable machine-readable code attached to the raised error.
    pub code: &'static str,
    /// Message built from a stable template, independent of Rust debug
    /// formatting.
    pub message: String,
}

/// Classifies a Core error into the exception class fixed by the taxonomy.
pub(crate) fn classify(err: &CoreError) -> JsErrorKind {
    match err {
        CoreError::InvalidHandle(_) => JsErrorKind::TypeError,
        CoreError::Hierarchy { .. }
        | CoreError::WrongDocument { .. }
        | CoreError::InvalidCharacter { .. }
        | CoreError::IndexOutOfBounds { .. } => JsErrorKind::DomException,
        CoreError::Syntax { .. } => JsErrorKind::SyntaxError,
        CoreError::Arena(_) => JsErrorKind::Error,
    }
}

/// The stable `name` property of the raised JavaScript error.
pub(crate) fn error_name(err: &CoreError) -> &'static str {
    match err {
        CoreError::InvalidHandle(_) => "TypeError",
        CoreError::Hierarchy { .. } => "HierarchyRequestError",
        CoreError::WrongDocument { .. } => "WrongDocumentError",
        CoreError::InvalidCharacter { .. } => "InvalidCharacterError",
        CoreError::Syntax { .. } => "SyntaxError",
        CoreError::IndexOutOfBounds { .. } => "IndexSizeError",
        CoreError::Arena(_) => "Error",
    }
}

/// Stable machine-readable code attached to the thrown JavaScript error.
pub(crate) fn error_code(err: &CoreError) -> &'static str {
    match err {
        CoreError::InvalidHandle(_) => "ERR_MAD_DOM_INVALID_HANDLE",
        CoreError::Hierarchy { .. } => "ERR_MAD_DOM_HIERARCHY",
        CoreError::WrongDocument { .. } => "ERR_MAD_DOM_WRONG_DOCUMENT",
        CoreError::InvalidCharacter { .. } => "ERR_MAD_DOM_INVALID_CHARACTER",
        CoreError::Syntax { .. } => "ERR_MAD_DOM_SYNTAX",
        CoreError::IndexOutOfBounds { .. } => "ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS",
        CoreError::Arena(_) => "ERR_MAD_DOM_STALE_HANDLE",
    }
}

/// Stable template-based message for a Core error, independent of Rust debug
/// formatting.
pub(crate) fn error_message(err: &CoreError) -> String {
    match err {
        CoreError::InvalidHandle(id) => format!("invalid node handle {id}"),
        CoreError::Hierarchy { message } => {
            format!("the operation would yield an incorrect document tree: {message}")
        }
        CoreError::WrongDocument {
            expected_document, ..
        } => format!(
            "the node belongs to a different document (expected document {expected_document})"
        ),
        CoreError::InvalidCharacter { what, .. } => format!("invalid character in {what}"),
        CoreError::Syntax { message } => format!("syntax error: {message}"),
        CoreError::IndexOutOfBounds { index, len } => {
            format!("index {index} out of bounds (len {len})")
        }
        CoreError::Arena(inner) => arena_message(inner),
    }
}

/// Stable per-variant message for an arena (stale-handle) failure.
fn arena_message(err: &ArenaError) -> String {
    match err {
        ArenaError::OutOfBounds { id } => format!("node handle {id} is out of bounds"),
        ArenaError::EmptySlot { id } => format!("slot for node handle {id} is empty"),
        ArenaError::GenerationMismatch { id } => format!("node handle {id} is stale"),
    }
}

/// The full frozen classification of a Core error.
pub(crate) fn spec_of_core(err: &CoreError) -> ErrorSpec {
    ErrorSpec {
        kind: classify(err),
        name: error_name(err),
        code: error_code(err),
        message: error_message(err),
    }
}

/// Errors raised by the binding layer itself, on top of the Core taxonomy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BindingError {
    /// A Core operation failed; the payload is the structured Core error.
    Core(CoreError),
    /// The document has been destroyed and can no longer be used.
    Destroyed,
}

impl From<CoreError> for BindingError {
    fn from(err: CoreError) -> Self {
        Self::Core(err)
    }
}

/// The full frozen classification of a binding error.
pub(crate) fn spec_of_binding(err: &BindingError) -> ErrorSpec {
    match err {
        BindingError::Core(core) => spec_of_core(core),
        BindingError::Destroyed => ErrorSpec {
            kind: JsErrorKind::Error,
            name: "Error",
            code: "ERR_MAD_DOM_DOCUMENT_DESTROYED",
            message: "the document has been destroyed".to_string(),
        },
    }
}

impl BindingError {
    /// Throws the matching JavaScript exception (carrying the frozen `code`)
    /// and returns the napi error signalling the now-pending exception.
    ///
    /// This is the T19 thrower. The classification rules live in
    /// [`spec_of_binding`]; see the module docs for the napi4 degradation of
    /// `SyntaxError` / `DOMException` kinds (raised as a controlled plain
    /// `Error`, with the frozen `name` embedded), which T21 replaces with real
    /// JS classes when it integrates the taxonomy.
    pub(crate) fn into_napi(self, env: &Env) -> NapiError {
        let spec = spec_of_binding(&self);
        let code = spec.code;
        let message = format!("[{code}] {}", spec.message);
        match spec.kind {
            JsErrorKind::TypeError => {
                let _ = env.throw_type_error(&message, Some(code));
            }
            JsErrorKind::Error => {
                let _ = env.throw_error(&message, Some(code));
            }
            // napi4 has no `throw_syntax_error` (napi9) and no DOMException
            // constructor, so these kinds degrade to a controlled plain `Error`
            // that keeps the stable `code` and embeds the frozen `name`.
            JsErrorKind::SyntaxError | JsErrorKind::DomException => {
                let fallback = format!("[{code}] {}: {}", spec.name, spec.message);
                let _ = env.throw_error(&fallback, Some(code));
            }
        }
        NapiError::new(Status::PendingException, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mad_dom_core::dom::Document;

    /// Builds a real handle through Core so the binding never fabricates one.
    fn sample_id() -> mad_dom_core::arena::NodeId {
        Document::new().create_element("div").unwrap()
    }

    /// One representative sample per branch/variant, in a fixed order (used
    /// by the table-driven tests below).
    fn all_core_samples(id: mad_dom_core::arena::NodeId) -> Vec<CoreError> {
        vec![
            CoreError::InvalidHandle(id),
            CoreError::Hierarchy {
                message: "parent cannot be its own descendant".to_string(),
            },
            CoreError::WrongDocument {
                id,
                expected_document: 7,
            },
            CoreError::InvalidCharacter {
                what: "element name",
                character: Some(' '),
            },
            CoreError::InvalidCharacter {
                what: "element name",
                character: None,
            },
            CoreError::Syntax {
                message: "unexpected token".to_string(),
            },
            CoreError::IndexOutOfBounds { index: 5, len: 3 },
            CoreError::Arena(ArenaError::OutOfBounds { id }),
            CoreError::Arena(ArenaError::EmptySlot { id }),
            CoreError::Arena(ArenaError::GenerationMismatch { id }),
        ]
    }

    #[test]
    fn invalid_handle_is_an_argument_error() {
        let id = sample_id();
        let err = CoreError::InvalidHandle(id);
        let spec = spec_of_core(&err);
        assert_eq!(spec.kind, JsErrorKind::TypeError, "{err:?}");
        assert_eq!(spec.name, "TypeError");
        assert_eq!(spec.code, "ERR_MAD_DOM_INVALID_HANDLE");
        assert_eq!(spec.message, format!("invalid node handle {id}"));
    }

    #[test]
    fn syntax_errors_map_to_syntax_error() {
        let err = CoreError::Syntax {
            message: "bad selector".to_string(),
        };
        let spec = spec_of_core(&err);
        assert_eq!(spec.kind, JsErrorKind::SyntaxError, "{err:?}");
        assert_eq!(spec.name, "SyntaxError");
        assert_eq!(spec.code, "ERR_MAD_DOM_SYNTAX");
        assert_eq!(spec.message, "syntax error: bad selector");
    }

    #[test]
    fn dom_exception_names_match_their_core_branches() {
        let id = sample_id();
        let cases = [
            (
                CoreError::Hierarchy {
                    message: "hierarchy".to_string(),
                },
                "HierarchyRequestError",
                "ERR_MAD_DOM_HIERARCHY",
            ),
            (
                CoreError::WrongDocument {
                    id,
                    expected_document: 1,
                },
                "WrongDocumentError",
                "ERR_MAD_DOM_WRONG_DOCUMENT",
            ),
            (
                CoreError::InvalidCharacter {
                    what: "element name",
                    character: None,
                },
                "InvalidCharacterError",
                "ERR_MAD_DOM_INVALID_CHARACTER",
            ),
            (
                CoreError::IndexOutOfBounds { index: 3, len: 1 },
                "IndexSizeError",
                "ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS",
            ),
        ];
        for (err, name, code) in cases {
            assert_eq!(classify(&err), JsErrorKind::DomException, "{err:?}");
            assert_eq!(error_name(&err), name, "{err:?}");
            assert_eq!(error_code(&err), code, "{err:?}");
        }
    }

    #[test]
    fn arena_failures_are_internal_errors() {
        let id = sample_id();
        for (arena, expected_message) in [
            (
                ArenaError::OutOfBounds { id },
                format!("node handle {id} is out of bounds"),
            ),
            (
                ArenaError::EmptySlot { id },
                format!("slot for node handle {id} is empty"),
            ),
            (
                ArenaError::GenerationMismatch { id },
                format!("node handle {id} is stale"),
            ),
        ] {
            let err = CoreError::Arena(arena);
            let spec = spec_of_core(&err);
            assert_eq!(spec.kind, JsErrorKind::Error, "{err:?}");
            assert_eq!(spec.name, "Error", "{err:?}");
            assert_eq!(spec.code, "ERR_MAD_DOM_STALE_HANDLE", "{err:?}");
            assert_eq!(spec.message, expected_message, "{err:?}");
        }
    }

    #[test]
    fn destroyed_document_is_a_lifecycle_error() {
        let spec = spec_of_binding(&BindingError::Destroyed);
        assert_eq!(spec.kind, JsErrorKind::Error);
        assert_eq!(spec.name, "Error");
        assert_eq!(spec.code, "ERR_MAD_DOM_DOCUMENT_DESTROYED");
        assert_eq!(spec.message, "the document has been destroyed");
    }

    #[test]
    fn binding_core_delegates_to_the_core_spec() {
        let err = CoreError::Syntax {
            message: "delegated".to_string(),
        };
        let via_binding = spec_of_binding(&BindingError::Core(err.clone()));
        assert_eq!(via_binding, spec_of_core(&err));
    }

    #[test]
    fn codes_are_unique_and_stable() {
        let id = sample_id();
        let distinct_branches = [
            CoreError::InvalidHandle(id),
            CoreError::Hierarchy {
                message: "h".to_string(),
            },
            CoreError::WrongDocument {
                id,
                expected_document: 1,
            },
            CoreError::InvalidCharacter {
                what: "element name",
                character: None,
            },
            CoreError::Syntax {
                message: "s".to_string(),
            },
            CoreError::IndexOutOfBounds { index: 0, len: 1 },
            CoreError::Arena(ArenaError::GenerationMismatch { id }),
        ];
        let mut seen = std::collections::HashSet::new();
        for err in &distinct_branches {
            assert!(seen.insert(error_code(err)), "duplicate code: {err:?}");
        }
        assert_eq!(seen.len(), distinct_branches.len());
        // Plus the binding-level code; all eight are distinct.
        assert!(seen.insert(spec_of_binding(&BindingError::Destroyed).code));
        assert_eq!(seen.len(), distinct_branches.len() + 1);

        // Pin the exact stable strings (they must never drift).
        let expected = [
            "ERR_MAD_DOM_INVALID_HANDLE",
            "ERR_MAD_DOM_HIERARCHY",
            "ERR_MAD_DOM_WRONG_DOCUMENT",
            "ERR_MAD_DOM_INVALID_CHARACTER",
            "ERR_MAD_DOM_SYNTAX",
            "ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS",
            "ERR_MAD_DOM_STALE_HANDLE",
        ];
        for (err, code) in distinct_branches.iter().zip(expected) {
            assert_eq!(error_code(err), code, "{err:?}");
        }
        assert_eq!(
            spec_of_binding(&BindingError::Destroyed).code,
            "ERR_MAD_DOM_DOCUMENT_DESTROYED"
        );
    }

    #[test]
    fn every_branch_has_a_unique_classification() {
        let id = sample_id();
        // One representative per distinct branch (the two InvalidCharacter
        // samples in `all_core_samples` share one branch/classification).
        let distinct_branches = [
            CoreError::InvalidHandle(id),
            CoreError::Hierarchy {
                message: "h".to_string(),
            },
            CoreError::WrongDocument {
                id,
                expected_document: 1,
            },
            CoreError::InvalidCharacter {
                what: "element name",
                character: Some(' '),
            },
            CoreError::Syntax {
                message: "s".to_string(),
            },
            CoreError::IndexOutOfBounds { index: 0, len: 1 },
            CoreError::Arena(ArenaError::GenerationMismatch { id }),
        ];
        let mut combos = std::collections::HashSet::new();
        for err in &distinct_branches {
            let spec = spec_of_core(err);
            assert!(!spec.code.is_empty());
            assert!(!spec.message.is_empty());
            assert!(
                combos.insert((spec.kind, spec.name, spec.code)),
                "duplicate classification: {err:?}"
            );
        }
        assert!(combos.insert((
            spec_of_binding(&BindingError::Destroyed).kind,
            spec_of_binding(&BindingError::Destroyed).name,
            spec_of_binding(&BindingError::Destroyed).code,
        )));
        assert_eq!(combos.len(), distinct_branches.len() + 1);

        // Totality: every sample — including the other InvalidCharacter /
        // Arena variants — classifies to a fully populated spec.
        let expected_names = [
            "TypeError",
            "HierarchyRequestError",
            "WrongDocumentError",
            "InvalidCharacterError",
            "InvalidCharacterError",
            "SyntaxError",
            "IndexSizeError",
            "Error",
            "Error",
            "Error",
        ];
        for (err, expected_name) in all_core_samples(id).iter().zip(expected_names) {
            let spec = spec_of_core(err);
            assert!(!spec.code.is_empty());
            assert!(!spec.message.is_empty());
            assert_eq!(spec.name, expected_name, "{err:?}");
        }
    }

    #[test]
    fn message_prefix_is_stable() {
        let id = sample_id();
        for err in all_core_samples(id) {
            let spec = spec_of_core(&err);
            let thrown = format!("[{}] {}", spec.code, spec.message);
            assert!(
                thrown.starts_with(&format!("[{}] ", spec.code)),
                "message prefix drifted for {err:?}: {thrown:?}"
            );
        }
        let destroyed = spec_of_binding(&BindingError::Destroyed);
        assert!(format!("[{}] {}", destroyed.code, destroyed.message)
            .starts_with(&format!("[{}] ", destroyed.code)));
    }

    #[test]
    fn messages_do_not_depend_on_rust_debug_formatting() {
        let id = sample_id();
        // InvalidCharacter must never render the offending character's `Debug`
        // form (T19 used `{c:?}`, which yielded `' '` and varies with the
        // toolchain's debug rendering).
        let err = CoreError::InvalidCharacter {
            what: "element name",
            character: Some(' '),
        };
        assert_eq!(
            spec_of_core(&err).message,
            "invalid character in element name"
        );
        // No branch leaks Rust `Debug`-style quoting or option rendering.
        for err in all_core_samples(id) {
            let message = spec_of_core(&err).message;
            assert!(
                !message.contains('\''),
                "debug char quoting leaked: {message}"
            );
            assert!(!message.contains("Some("), "debug option leaked: {message}");
            assert!(!message.contains("Err("), "debug result leaked: {message}");
        }
    }

    #[test]
    fn classification_is_pure_and_deterministic() {
        let id = sample_id();
        for err in all_core_samples(id) {
            let first = spec_of_core(&err);
            let second = spec_of_core(&err);
            assert_eq!(
                first, second,
                "classification must be reproducible: {err:?}"
            );
        }
        let destroyed = BindingError::Destroyed;
        assert_eq!(spec_of_binding(&destroyed), spec_of_binding(&destroyed));
    }
}
