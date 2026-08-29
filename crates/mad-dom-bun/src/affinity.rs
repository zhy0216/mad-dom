//! Isolate/thread affinity guard (T21B).
//!
//! A narrow checker that lets the T21 wiring reject a call whose
//! thread/isolate does not match the one that created the document — without
//! introducing locks, cross-thread DOM or a second copy of document state.
//! This module freezes the pure semantics; T21 inserts the checks into the
//! FFI entries and maps the stable [`AffinityError`] codes to JavaScript.
//!
//! # What an "affinity" is
//!
//! Node-API exposes no way for this binding to read the JavaScriptCore
//! isolate identity that drives a call, so the guard represents a call's
//! origin by the closest *observable* proxy: the OS thread the call runs on
//! ([`AffinityId::Observed`]). Bun drives one isolate from one dedicated JS
//! thread, which makes the proxy sound:
//!
//! * a document created and used on Bun's JS thread always observes the same
//!   thread id, so same-affinity calls pass stably;
//! * a genuinely cross-isolate call necessarily runs on another thread (a
//!   worker), its id differs, and the call is rejected;
//! * two distinct isolates sharing one thread is not a configuration Bun
//!   produces, and Node-API could not tell it apart anyway — accepted as a
//!   documented limitation, never a silent memory-sharing hazard.
//!
//! Because the true isolate identity is *not readable*, the guard never
//! claims to compare isolates; it compares the observable thread proxy and
//! **conservatively rejects** every case it cannot prove to match:
//!
//! * the observed thread differs from the token's recorded thread
//!   ([`AffinityError::Mismatch`]);
//! * the token's recorded affinity is not a real observed one (a forged or
//!   otherwise invalid token), or the current identity is unobservable
//!   ([`AffinityError::Unverifiable`]).
//!
//! # Token model
//!
//! [`AffinityToken`] is an immutable, unforgeable record created exactly once
//! per document at creation time ([`AffinityToken::create`]); the fields are
//! private, so a token can only be minted by `create`, which records the
//! *current* call's affinity. The token is cheaply cloneable (an [`Arc`]
//! inner), so a document and every handle derived from it check against the
//! same token, and it lives exactly as long as its last clone — alongside the
//! document's ownership chain, never inside it.
//!
//! # Guard rules (frozen semantics for T21)
//!
//! * Checking takes `&self`, reads immutable state and takes no lock; the
//!   guard is `Send + Sync`, so a wrong-thread call fails with a structured
//!   error instead of racing.
//! * The guard implements no locks, no cross-thread DOM and no second
//!   document state (ADR-0001 §2).
//! * A check never reads, mutates or duplicates document state, so inserting
//!   it into an existing entry does not change document ownership. T21 wires
//!   it as: mint one token in the document constructor, store it alongside
//!   `crate::handle::SharedDocument`, and call `check()` at each entry before
//!   delegating to Core.
//!
//! # Safety preconditions (this module is pure Rust, no FFI)
//!
//! * No `unsafe`, no `napi` types, no OS or runtime handles: the module
//!   builds and tests under `cargo test -p mad-dom-bun` without a JS runtime.
//! * Only `create` observes a thread id, and `std::thread::current` always
//!   succeeds, so a produced token always records a real, observable
//!   affinity.
//! * The recorded [`AffinityId`] is immutable after construction, so repeated
//!   and concurrent checks are race-free by construction.
//! * The module depends on no sibling file T21A may concurrently change
//!   (`crate::error`) and on no FFI surface, keeping it merge-safe in the
//!   T21A ∥ T21B window.
//!
//! Owned by **T21B**; integration gate: **T21**. The registry entry
//! (`crate::extensions`) stays a placeholder until T21 wires the guard.

use std::fmt;
use std::sync::Arc;

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "affinity",
    owner: "T21B",
    gate: "T21",
    status: "placeholder",
};

/// The observed origin of a call — the proxy for the unreadable isolate
/// identity (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum AffinityId {
    /// A real, observable origin: the OS thread a call runs on.
    Observed(std::thread::ThreadId),
    /// An origin the guard could not observe. Any check against it must be
    /// conservatively rejected: an identity that cannot be proven to match is
    /// not a match.
    ///
    /// Dormant in production builds — `current()` always observes a thread —
    /// but it exists so an unreadable identity is representable and rejected
    /// instead of assumed, and it is exercised by the pure tests.
    #[allow(dead_code)]
    Unobservable,
}

impl AffinityId {
    /// The affinity of the *current* call.
    ///
    /// `std::thread::current` cannot fail, so a real call always yields
    /// [`AffinityId::Observed`]; [`AffinityId::Unobservable`] exists so a
    /// context whose identity could not be determined is representable and is
    /// rejected rather than assumed.
    pub(crate) fn current() -> Self {
        Self::Observed(std::thread::current().id())
    }
}

/// A stable guard failure produced when a call cannot be attributed to the
/// token's recorded affinity. T21 maps the codes to JavaScript exceptions;
/// the codes are frozen here so the wiring and the tests agree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AffinityError {
    /// The observed thread differs from the recorded one — a cross-thread
    /// (hence, in Bun, cross-isolate) call.
    Mismatch {
        /// The affinity recorded on the token at creation time.
        expected: AffinityId,
        /// The affinity observed for the offending call.
        observed: AffinityId,
    },
    /// The guard could not prove the call's affinity: the token is forged or
    /// otherwise invalid, or the current identity is unobservable. The
    /// conservative rule is to refuse rather than assume a match.
    Unverifiable,
}

impl AffinityError {
    /// Stable machine-readable code for the failure; T21 maps it to a JS
    /// exception code (the mapping itself belongs to T21A/T21).
    ///
    /// Dormant until T21 wires the guard into the FFI entries; exercised by
    /// the pure tests below.
    #[allow(dead_code)]
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Mismatch { .. } => "ERR_MAD_DOM_AFFINITY_MISMATCH",
            Self::Unverifiable => "ERR_MAD_DOM_AFFINITY_UNVERIFIABLE",
        }
    }
}

impl fmt::Display for AffinityError {
    /// A stable message that does not depend on Rust's debug formatting (a
    /// `ThreadId`'s `Debug` is an implementation detail), so T21 can surface
    /// it to JavaScript verbatim.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Mismatch { .. } => {
                write!(
                    f,
                    "a document may only be used from the thread/isolate that created it"
                )
            }
            Self::Unverifiable => write!(
                f,
                "call affinity could not be verified; refusing to run on an unproven thread/isolate"
            ),
        }
    }
}

/// The immutable inner record shared by every clone of an [`AffinityToken`].
///
/// Two `create()` calls always yield distinct inner allocations, so a token
/// can never vouch for another document's checks.
#[derive(Debug)]
struct TokenInner {
    /// The affinity recorded at creation time (the creating thread's id).
    affinity: AffinityId,
}

/// Unforgeable, immutable record of the affinity a document was created under.
///
/// * Created **only** through [`AffinityToken::create`]: the fields are
///   private to this module, so no caller — including the T21 wiring — can
///   fabricate a token that claims a chosen affinity.
/// * Immutable after creation, so every check is a lock-free read of shared
///   state (the guard implements no locks).
/// * Cloneable: every clone shares the one inner record, so a document and
///   all its handles check against the same token, and the token lives
///   exactly as long as its last clone.
#[derive(Clone, Debug)]
pub(crate) struct AffinityToken(Arc<TokenInner>);

impl AffinityToken {
    /// Mints a fresh token recording the *current call's* affinity.
    ///
    /// This is the single construction point and it always records a real,
    /// observable thread id. T21 calls it exactly once per document, at
    /// creation time, and stores the token alongside the document's shared
    /// state.
    ///
    /// Dormant until T21 wires the guard into the FFI entries; exercised by
    /// the pure tests below.
    #[allow(dead_code)]
    pub(crate) fn create() -> Self {
        Self(Arc::new(TokenInner {
            affinity: AffinityId::current(),
        }))
    }

    /// Verifies that the current call runs on the token's recorded affinity.
    ///
    /// Dormant until T21 wires the guard into the FFI entries; exercised by
    /// the pure tests below.
    #[allow(dead_code)]
    pub(crate) fn check(&self) -> Result<(), AffinityError> {
        self.check_with(AffinityId::current())
    }

    /// Verifies a call against an explicitly observed affinity.
    ///
    /// The identity-observing path is separate so the conservative rules are
    /// testable without a real runtime, and so a future wiring with a
    /// non-thread identity source can reuse the same checks.
    ///
    /// Dormant until T21 wires the guard into the FFI entries; exercised by
    /// the pure tests below.
    #[allow(dead_code)]
    pub(crate) fn check_with(&self, observed: AffinityId) -> Result<(), AffinityError> {
        match (self.0.affinity, observed) {
            (AffinityId::Observed(expected), AffinityId::Observed(observed)) => {
                if expected == observed {
                    Ok(())
                } else {
                    Err(AffinityError::Mismatch {
                        expected: AffinityId::Observed(expected),
                        observed: AffinityId::Observed(observed),
                    })
                }
            }
            // Either the recorded affinity is not a real observed one (forged
            // token) or the observed identity is unobservable: never match.
            _ => Err(AffinityError::Unverifiable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a token that did **not** come from [`AffinityToken::create`]: a
    /// stand-in for a forged or otherwise invalid token whose recorded
    /// affinity is not a real observed thread. Such a token must never pass a
    /// check, whatever thread it runs on.
    fn forged_token() -> AffinityToken {
        AffinityToken(Arc::new(TokenInner {
            affinity: AffinityId::Unobservable,
        }))
    }

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn same_affinity_checks_pass_stably() {
        let token = AffinityToken::create();
        for _ in 0..100 {
            assert_eq!(token.check(), Ok(()));
        }
    }

    #[test]
    fn token_is_bound_to_its_creating_thread() {
        let token = AffinityToken::create();
        assert_eq!(token.check(), Ok(()));

        // Moving the token to another thread: the same call now runs on a
        // different thread and must fail.
        let result = std::thread::spawn(move || token.check()).join().unwrap();
        assert!(matches!(result, Err(AffinityError::Mismatch { .. })));

        // And the reverse: a token minted inside a worker fails here on the
        // (main) thread.
        let foreign = std::thread::spawn(AffinityToken::create).join().unwrap();
        assert!(matches!(
            foreign.check(),
            Err(AffinityError::Mismatch { .. })
        ));
    }

    #[test]
    fn forged_token_is_always_rejected() {
        let forged = forged_token();
        // Whatever thread it runs on, the recorded affinity is not real.
        assert!(matches!(forged.check(), Err(AffinityError::Unverifiable)));
        // Even checked against a real, observable identity it still fails.
        assert!(matches!(
            forged.check_with(AffinityId::current()),
            Err(AffinityError::Unverifiable)
        ));
        // A real token never vouches for an unobservable identity either.
        let real = AffinityToken::create();
        assert!(matches!(
            real.check_with(AffinityId::Unobservable),
            Err(AffinityError::Unverifiable)
        ));
    }

    #[test]
    fn unobservable_identity_rejects_conservatively() {
        // Node-API cannot hand us an isolate identity; if a future wiring had
        // no observable proxy either, the guard must refuse rather than
        // assume a match.
        let token = AffinityToken::create();
        assert!(matches!(
            token.check_with(AffinityId::Unobservable),
            Err(AffinityError::Unverifiable)
        ));
        assert_eq!(token.check(), Ok(()), "a real observed call still passes");
    }

    #[test]
    fn errors_carry_stable_codes_and_messages() {
        let token = AffinityToken::create();
        let mismatch = std::thread::spawn(move || token.check())
            .join()
            .unwrap()
            .unwrap_err();
        assert_eq!(mismatch.code(), "ERR_MAD_DOM_AFFINITY_MISMATCH");
        assert_eq!(
            AffinityError::Unverifiable.code(),
            "ERR_MAD_DOM_AFFINITY_UNVERIFIABLE"
        );
        assert_ne!(
            mismatch.code(),
            AffinityError::Unverifiable.code(),
            "codes must be distinct"
        );

        // Messages are stable, hand-written text: they never leak Rust debug
        // formatting such as `ThreadId(...)`.
        let message = mismatch.to_string();
        assert!(!message.contains("ThreadId"), "got: {message}");
        assert!(!message.is_empty());
    }

    #[test]
    fn tokens_are_distinct_and_independent() {
        let a = AffinityToken::create();
        let b = AffinityToken::create();
        assert_ne!(
            Arc::as_ptr(&a.0),
            Arc::as_ptr(&b.0),
            "each create() mints its own token record"
        );
        // Independence: `b`'s existence never changes `a`'s result, and the
        // two never share identity.
        assert_eq!(a.check(), Ok(()));
        assert_eq!(b.check(), Ok(()));
    }

    #[test]
    fn token_lifecycle_tracks_its_clones() {
        let token = AffinityToken::create();
        assert_eq!(Arc::strong_count(&token.0), 1);

        let clone = token.clone();
        assert_eq!(Arc::strong_count(&token.0), 2);
        assert_eq!(clone.check(), Ok(()));

        drop(token);
        assert_eq!(Arc::strong_count(&clone.0), 1);
        assert_eq!(clone.check(), Ok(()), "a clone keeps the token alive");

        // No resurrection: once the last clone is gone, the token is gone.
        let weak = Arc::downgrade(&clone.0);
        drop(clone);
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn forged_tokens_are_not_real_tokens() {
        let forged = forged_token();
        let real = AffinityToken::create();
        assert_ne!(Arc::as_ptr(&forged.0), Arc::as_ptr(&real.0));
        // Dropping the forged token cannot disturb a real token's state.
        drop(forged);
        assert_eq!(real.check(), Ok(()));
    }

    #[test]
    fn concurrent_wrong_thread_checks_always_fail() {
        const WORKERS: usize = 8;
        let token = AffinityToken::create();
        let mut handles = Vec::new();
        for _ in 0..WORKERS {
            let token = token.clone();
            handles.push(std::thread::spawn(move || token.check()));
        }
        for handle in handles {
            let result = handle.join().unwrap();
            assert!(
                matches!(result, Err(AffinityError::Mismatch { .. })),
                "a worker thread must never pass a main-thread token: {result:?}"
            );
        }
        // The owning thread is unaffected by the concurrent failures.
        assert_eq!(token.check(), Ok(()));
    }

    #[test]
    fn concurrent_documents_do_not_interfere() {
        const WORKERS: usize = 4;
        const ITERATIONS: usize = 50;
        let handles: Vec<_> = (0..WORKERS)
            .map(|_| {
                std::thread::spawn(|| {
                    let token = AffinityToken::create();
                    for _ in 0..ITERATIONS {
                        assert_eq!(token.check(), Ok(()), "own thread must pass");
                    }
                    token
                })
            })
            .collect();
        let tokens: Vec<AffinityToken> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        // Every worker token is foreign to this thread: none may pass here.
        for token in &tokens {
            assert!(
                matches!(token.check(), Err(AffinityError::Mismatch { .. })),
                "a token minted on a worker must not pass on the main thread"
            );
        }
    }

    #[test]
    fn guard_is_lock_free_and_send_sync() {
        assert_send_sync::<AffinityToken>();
        assert_send_sync::<AffinityId>();
        assert_send_sync::<AffinityError>();
        assert_send_sync::<TokenInner>();
        // The inner state is immutable after creation and checks never take a
        // lock; the module contains no `Mutex`/`RwLock` (review-enforced, and
        // the lock-free concurrent tests above exercise it).
    }
}
