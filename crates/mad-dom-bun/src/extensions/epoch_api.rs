//! Native structural-epoch surface (navigation-memo invalidation).
//!
//! # Role
//!
//! The facade memoizes `Node` navigation reads (`firstChild` / `nextSibling`
//! / …) so a repeated tree walk over an unchanged tree stays in JavaScript.
//! JavaScript therefore needs to detect native mutations without making an
//! FFI call for every cached read. This module exposes one four-byte epoch
//! buffer for structural mutations and another for attribute mutations.
//!
//! Each returned `ArrayBuffer` is ordinary JavaScript-owned memory. The
//! document retains only a weak Node-API reference to it. For ordinary/raw
//! views, whenever Core's generation changes the binding briefly resolves
//! each live reference, obtains its current backing-store pointer, writes the
//! new value, and drops the pointer before returning to JavaScript. Facade-
//! local views instead receive the exact canonical generation as the return
//! value of token hot writes and publish it with a local typed-array store;
//! mutations through any other entry remain native-published. The binding
//! never shares or retains a Rust-owned allocation behind an `ArrayBuffer`.
//!
//! This also makes transfer safe by construction. Transferring a view detaches
//! the subscribed buffer; the next mutation removes that subscription. The
//! transferred buffer is merely a stale four-byte copy and has no connection
//! to native state.
//!
//! Two values are reserved: `i32::MIN` means the document was destroyed, and
//! `-1` means the live generation space was exhausted. At `-1` the document
//! remains usable, but consumers must permanently bypass generation caches;
//! the value saturates instead of repeating and creating an ABA cache hit.

use std::ffi::c_void;

use napi::bindgen_prelude::{FromNapiValue, Unknown};
use napi::{check_status, Env};
use napi_derive::napi;

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, DocumentHandle};

/// Seam metadata for the navigation-memo epoch boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "epoch_api",
    owner: "perf-navigation-memo",
    gate: "none",
    status: "implemented",
};

/// Creates an ordinary JavaScript-owned four-byte buffer initialized to
/// `value`. The backing-store pointer is used only while this call is active.
fn make_epoch_buffer(env: Env, value: i32) -> napi::Result<napi::sys::napi_value> {
    let mut data: *mut c_void = std::ptr::null_mut();
    let mut buffer = std::ptr::null_mut();
    check_status!(unsafe {
        napi::sys::napi_create_arraybuffer(
            env.raw(),
            std::mem::size_of::<i32>(),
            &mut data,
            &mut buffer,
        )
    })?;
    if data.is_null() || buffer.is_null() {
        return Err(napi::Error::new(
            napi::Status::GenericFailure,
            "Node-API returned no backing store for an epoch buffer".to_owned(),
        ));
    }
    // SAFETY: Node-API just returned a writable four-byte backing store. The
    // pointer is not retained beyond this synchronous call.
    unsafe { data.cast::<i32>().write_unaligned(value) };
    Ok(buffer)
}

/// Adds the epoch surface to the existing [`DocumentHandle`] class through a
/// second `#[napi] impl` block.
#[napi]
impl DocumentHandle {
    /// Returns a fresh JavaScript-owned structural-epoch buffer and weakly
    /// subscribes it to future structural changes in this document.
    #[napi(catch_unwind)]
    pub fn epoch_view(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(self.shared(), &env)?;
        if self.shared().is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        self.shared().enable_tokens();
        let buffer = make_epoch_buffer(env, self.shared().epoch_value())?;
        self.shared()
            .register_epoch_view(env, buffer, false, false)?;
        // SAFETY: `buffer` is the ArrayBuffer value just created on `env`.
        unsafe { Unknown::from_napi_value(env.raw(), buffer) }
    }

    /// Returns a fresh JavaScript-owned attribute-epoch buffer and weakly
    /// subscribes it to future attribute changes in this document.
    #[napi(catch_unwind)]
    pub fn attribute_epoch_view(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(self.shared(), &env)?;
        if self.shared().is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        self.shared().enable_tokens();
        let buffer = make_epoch_buffer(env, self.shared().attribute_epoch_value())?;
        self.shared()
            .register_epoch_view(env, buffer, true, false)?;
        // SAFETY: `buffer` is the ArrayBuffer value just created on `env`.
        unsafe { Unknown::from_napi_value(env.raw(), buffer) }
    }

    /// Facade-only structural view. Token mutation companions advance the
    /// canonical native epoch and return its exact value instead of resolving
    /// this buffer through Node-API; the facade writes that value locally.
    /// Ordinary [`Self::epoch_view`] subscribers remain native-published.
    #[napi(catch_unwind)]
    pub fn facade_epoch_view(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(self.shared(), &env)?;
        if self.shared().is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        self.shared().enable_tokens();
        let buffer = make_epoch_buffer(env, self.shared().epoch_value())?;
        self.shared()
            .register_epoch_view(env, buffer, false, true)?;
        // SAFETY: `buffer` is the ArrayBuffer value just created on `env`.
        unsafe { Unknown::from_napi_value(env.raw(), buffer) }
    }

    /// Facade-only counterpart to [`Self::attribute_epoch_view`].
    #[napi(catch_unwind)]
    pub fn facade_attribute_epoch_view(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(self.shared(), &env)?;
        if self.shared().is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        self.shared().enable_tokens();
        let buffer = make_epoch_buffer(env, self.shared().attribute_epoch_value())?;
        self.shared().register_epoch_view(env, buffer, true, true)?;
        // SAFETY: `buffer` is the ArrayBuffer value just created on `env`.
        unsafe { Unknown::from_napi_value(env.raw(), buffer) }
    }
}
