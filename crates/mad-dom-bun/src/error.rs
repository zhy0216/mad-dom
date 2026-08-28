//! Minimal Core-error → JavaScript-exception mapping (T19).
//!
//! ADR-0003 fixes the mapping *shape*: usage errors surface as `TypeError`,
//! everything else as plain `Error`, and every error carries a stable `code`
//! property so tests and the later safety-boundary audit (T21) can rely on it.
//! The full classification table is deliberately deferred to T21; this module
//! only covers the variants the minimal Core API can actually produce.
//!
//! This module performs no FFI and contains no `unsafe`: it only classifies a
//! [`CoreError`] (or a binding lifecycle failure) into an exception kind, a
//! stable code and a message, then raises the matching JavaScript exception.

use mad_dom_core::error::CoreError;
use napi::{Env, Error as NapiError, Status};

/// Which JavaScript exception class an error maps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JsErrorKind {
    /// `TypeError` — recoverable misuse of the API surface (bad argument,
    /// wrong document, hierarchy violation, ...).
    TypeError,
    /// Plain `Error` — internal, lifecycle or not-yet-classified failures.
    Error,
}

/// Classifies a Core error into the exception kind fixed by ADR-0003.
pub(crate) fn classify(err: &CoreError) -> JsErrorKind {
    match err {
        CoreError::InvalidHandle(_)
        | CoreError::Hierarchy { .. }
        | CoreError::WrongDocument { .. }
        | CoreError::InvalidCharacter { .. }
        | CoreError::IndexOutOfBounds { .. }
        | CoreError::Arena(_) => JsErrorKind::TypeError,
        CoreError::Syntax { .. } => JsErrorKind::Error,
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

impl BindingError {
    /// Throws the matching JavaScript exception (`TypeError` or `Error` with a
    /// stable `code`) and returns the napi error signalling the now-pending
    /// exception.
    pub(crate) fn into_napi(self, env: &Env) -> NapiError {
        let (kind, message, code) = match self {
            Self::Core(err) => (classify(&err), err.to_string(), error_code(&err)),
            Self::Destroyed => (
                JsErrorKind::Error,
                "the document has been destroyed".to_string(),
                "ERR_MAD_DOM_DOCUMENT_DESTROYED",
            ),
        };
        let message = format!("[{code}] {message}");
        match kind {
            JsErrorKind::TypeError => {
                let _ = env.throw_type_error(&message, Some(code));
            }
            JsErrorKind::Error => {
                let _ = env.throw_error(&message, Some(code));
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

    #[test]
    fn usage_errors_map_to_type_error() {
        let id = sample_id();
        for err in [
            CoreError::InvalidHandle(id),
            CoreError::Hierarchy {
                message: "boom".to_string(),
            },
            CoreError::WrongDocument {
                id,
                expected_document: 1,
            },
            CoreError::InvalidCharacter {
                what: "element name",
                character: Some(' '),
            },
            CoreError::IndexOutOfBounds { index: 5, len: 3 },
        ] {
            assert_eq!(classify(&err), JsErrorKind::TypeError, "{err:?}");
        }
    }

    #[test]
    fn syntax_errors_map_to_plain_error() {
        let err = CoreError::Syntax {
            message: "bad selector".to_string(),
        };
        assert_eq!(classify(&err), JsErrorKind::Error, "{err:?}");
    }

    #[test]
    fn arena_errors_are_usage_errors() {
        use mad_dom_core::arena::ArenaError;
        let arena = ArenaError::GenerationMismatch { id: sample_id() };
        let err = CoreError::Arena(arena);
        assert_eq!(classify(&err), JsErrorKind::TypeError, "{err:?}");
        assert_eq!(error_code(&err), "ERR_MAD_DOM_STALE_HANDLE");
    }

    #[test]
    fn codes_are_stable_and_distinct() {
        let id = sample_id();
        let errs = [
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
        ];
        let mut seen = std::collections::HashSet::new();
        for err in &errs {
            assert!(seen.insert(error_code(err)), "duplicate code: {err:?}");
        }
        assert_eq!(
            error_code(&errs[0]),
            "ERR_MAD_DOM_INVALID_HANDLE",
            "codes must be stable strings"
        );
    }
}
