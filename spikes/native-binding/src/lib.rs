//! Isolated Bun/Node-API binding spike for [T04](../../todos/04-native-binding-spike.md).
//!
//! This crate proves the minimal FFI links evaluated in
//! `adr/0003-native-binding-spike.md`: string/number roundtrip, structured
//! error mapping, JS-GC reclamation of native objects, panic interception and
//! stable loading of a locally built artifact by the Bun test runner.
//!
//! It is deliberately excluded from the Cargo workspace and contains no DOM
//! semantics; production bindings live in `crates/mad-dom-bun` and must not
//! adopt this code directly. Handwritten code here contains no `unsafe` blocks;
//! all FFI/unsafe handling is delegated to the `napi` crate.

use std::sync::atomic::{AtomicU32, Ordering};

use napi::{bindgen_prelude::Result, Env, Error, Status};
use napi_derive::napi;

// ---------------------------------------------------------------------------
// 1. String/number roundtrip through the Node-API boundary.
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct SpikeRoundtrip {
    pub text: String,
    pub number: f64,
    pub chars: u32,
    pub negated: f64,
}

#[napi]
pub fn spike_roundtrip(text: String, number: f64) -> SpikeRoundtrip {
    let chars = text.chars().count() as u32;
    SpikeRoundtrip {
        text,
        number,
        chars,
        negated: -number,
    }
}

// ---------------------------------------------------------------------------
// 2. Structured errors: core-shaped error mapped to JS TypeError / Error.
// ---------------------------------------------------------------------------

/// Structured error shape mirroring what the future Rust DOM core would
/// return; the `#[napi]` boundary is the only place that knows about JS
/// exception classes.
pub enum SpikeError {
    InvalidArgument { code: &'static str, message: String },
    Internal { message: String },
}

impl SpikeError {
    fn into_napi_error(self, env: &Env) -> Error {
        match self {
            SpikeError::InvalidArgument { code, message } => {
                let _ = env.throw_type_error(&format!("[{code}] {message}"), Some(code));
                Error::new(Status::PendingException, message)
            }
            SpikeError::Internal { message } => {
                Error::from_reason(format!("[spike-internal] {message}"))
            }
        }
    }
}

fn divide(left: f64, right: f64) -> std::result::Result<f64, SpikeError> {
    if right == 0.0 {
        return Err(SpikeError::InvalidArgument {
            code: "ERR_SPIKE_DIV_ZERO",
            message: "right must not be 0".to_owned(),
        });
    }
    if left.is_nan() {
        return Err(SpikeError::Internal {
            message: "left must not be NaN".to_owned(),
        });
    }
    Ok(left / right)
}

#[napi]
pub fn spike_checked_div(env: Env, left: f64, right: f64) -> Result<f64> {
    divide(left, right).map_err(|err| err.into_napi_error(&env))
}

// ---------------------------------------------------------------------------
// 3. Native class instances reclaimed by the JavaScript GC.
// ---------------------------------------------------------------------------

static SPIKE_LIVE_COUNT: AtomicU32 = AtomicU32::new(0);
static SPIKE_TOTAL_COUNT: AtomicU32 = AtomicU32::new(0);

#[napi]
pub struct SpikeHandle {
    id: u32,
}

#[napi]
impl SpikeHandle {
    #[napi(constructor)]
    pub fn new(id: u32) -> Self {
        SPIKE_LIVE_COUNT.fetch_add(1, Ordering::SeqCst);
        SPIKE_TOTAL_COUNT.fetch_add(1, Ordering::SeqCst);
        Self { id }
    }

    #[napi(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }
}

impl Drop for SpikeHandle {
    fn drop(&mut self) {
        SPIKE_LIVE_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

#[napi]
pub fn spike_live_count() -> u32 {
    SPIKE_LIVE_COUNT.load(Ordering::SeqCst)
}

#[napi]
pub fn spike_total_count() -> u32 {
    SPIKE_TOTAL_COUNT.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// 4. Rust panic intercepted at the FFI boundary (opt-in `catch_unwind`).
// ---------------------------------------------------------------------------

#[napi(catch_unwind)]
pub fn spike_panic(message: String) {
    panic!("spike panic: {message}");
}
