//! Additive C ABI v1, exported from the *same* cdylib as Node-API.
//!
//! `DocumentHandle.ffiContext()` supplies [owner, lifetime generation, root
//! token]. Load that exact `.node` file with bun:ffi: a second copy of the
//! library has a separate registry and cannot access these documents. The
//! registry holds only thread-local Weak references. Node-API owns lifecycle,
//! wrappers and callbacks; FFI never retains caller pointers or calls JS.
//!
//! All outputs are copies into caller-owned buffers. No native-owned (external)
//! ArrayBuffer crosses this ABI in v1. Bun exposes a native deallocator hook,
//! but copies avoid tying DOM storage or library lifetime to a GC callback. The full
//! memory protocol (ownership classes, capacity/length rules, exactly-once
//! deallocator rule and lifecycle diagnostics) is in `ffi/ABI.md`.
//!
//! See `ABI.md` for signatures, errors, packed layouts and pointer preconditions.

mod buffer;
#[cfg(test)]
mod tests;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use mad_dom_core::{arena::NodeId, dom::Document, error::CoreError};
use napi::{bindgen_prelude::Uint32Array, Env};
use napi_derive::napi;

use crate::error::BindingError;
use crate::handle::{
    check_affinity, node_snapshot_descriptor, with_document, DocumentHandle, SharedDocument,
};
use buffer::{input, utf8, Output};

pub const ABI_VERSION: u32 = 1;
pub const CAPABILITIES: u32 = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);

/// Frozen C ABI status numbers. Errors never contain pointers or Rust types.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Status {
    Ok = 0,
    InvalidArgument = 1,
    BufferTooSmall = 2,
    InvalidDocument = 3,
    StaleGeneration = 4,
    Destroyed = 5,
    InvalidToken = 6,
    StaleToken = 7,
    WrongDocument = 8,
    InvalidUtf8 = 9,
    Syntax = 10,
    Hierarchy = 11,
    InvalidCharacter = 12,
    IndexOutOfBounds = 13,
    Panic = 14,
}

type Result<T> = std::result::Result<T, Status>;

impl From<BindingError> for Status {
    fn from(value: BindingError) -> Self {
        match value {
            BindingError::Destroyed => Self::Destroyed,
            BindingError::Core(e) => e.into(),
        }
    }
}

impl From<CoreError> for Status {
    fn from(value: CoreError) -> Self {
        match value {
            CoreError::InvalidHandle(_) => Self::InvalidToken,
            CoreError::Arena(_) => Self::StaleToken,
            CoreError::WrongDocument { .. } => Self::WrongDocument,
            CoreError::Syntax { .. } => Self::Syntax,
            CoreError::Hierarchy { .. } => Self::Hierarchy,
            CoreError::InvalidCharacter { .. } => Self::InvalidCharacter,
            CoreError::IndexOutOfBounds { .. } => Self::IndexOutOfBounds,
        }
    }
}

thread_local! {
    static DOCUMENTS: RefCell<HashMap<u32, Weak<SharedDocument>>> = RefCell::default();
}
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

/// Number of documents currently registered in the *calling thread's* FFI
/// owner registry. Diagnostic only (memory-protocol task 04): a document is
/// registered lazily on its first `ffiContext()` call and unregistered when
/// its last ownership `Arc` drops (never on `destroy()` alone — destroyed
/// documents stay registered while a handle keeps them alive, so their FFI
/// entries are still owned). The registry is thread-local, so this count is a
/// deterministic, calling-thread lifecycle signal for the GC churn tests and the
/// memory benchmark: after a bounded create→context→destroy→collect churn it
/// must return to its baseline without relying on RSS measurements.
pub(crate) fn registration_count() -> usize {
    DOCUMENTS.with(|docs| docs.borrow().len())
}

pub(crate) struct Registration {
    owner: Cell<u32>,
    generation: Cell<u32>,
}

impl Default for Registration {
    fn default() -> Self {
        Self {
            owner: Cell::new(0),
            generation: Cell::new(1),
        }
    }
}

impl Registration {
    fn context(&self, shared: &Arc<SharedDocument>) -> [u32; 2] {
        let owner = match self.owner.get() {
            0 => {
                // Never wrap/reuse an owner, including across Worker threads.
                let owner = NEXT_OWNER
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                        (n <= u64::from(u32::MAX)).then_some(n + 1)
                    })
                    .expect("FFI owner space exhausted") as u32;
                DOCUMENTS.with(|docs| docs.borrow_mut().insert(owner, Arc::downgrade(shared)));
                self.owner.set(owner);
                owner
            }
            owner => owner,
        };
        [owner, self.generation.get()]
    }

    pub(crate) fn invalidate(&self) {
        // destroy is terminal and idempotent, independent of mutation epochs.
        self.generation.set(2);
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let _ = DOCUMENTS.try_with(|docs| docs.borrow_mut().remove(&self.owner.get()));
    }
}

#[napi]
impl DocumentHandle {
    /// Additive, opt-in bridge. No Rust/JS address is exposed or retained.
    #[napi(catch_unwind)]
    pub fn ffi_context(&self, env: Env) -> napi::Result<Uint32Array> {
        check_affinity(self.shared(), &env)?;
        let root = with_document(self.shared(), |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        let [owner, generation] = self.shared().ffi.context(self.shared());
        Ok(vec![owner, generation, self.shared().token_for(root)].into())
    }

    /// Read-only memory/lifecycle diagnostics (memory-protocol task 04).
    ///
    /// Returns a JS number array `[liveDocuments, ffiRegistrations,
    /// wrapperCacheEntries]`. Documents and cache entries are process-wide
    /// atomics (including Workers); FFI registrations are calling-thread local.
    /// These are lifecycle counts, not allocation/byte counters. The snapshot
    /// is not atomic across fields/threads. It remains valid after destroy,
    /// on the owning thread, and never drives production correctness.
    #[napi(catch_unwind)]
    pub fn memory_diagnostics(&self, env: Env) -> napi::Result<(f64, f64, f64)> {
        check_affinity(self.shared(), &env)?;
        Ok((
            crate::handle::live_document_count() as f64,
            registration_count() as f64,
            crate::handle::live_wrapper_cache_entries() as f64,
        ))
    }
}

fn document(owner: u32, generation: u32) -> Result<Arc<SharedDocument>> {
    // An absent key also rejects cross-thread calls *before* accessing an Arc
    // or Core state. This is the same thread proxy as Node-API's affinity guard.
    let shared = DOCUMENTS
        .with(|docs| docs.borrow().get(&owner).and_then(Weak::upgrade))
        .ok_or(Status::InvalidDocument)?;
    if shared.is_destroyed() {
        return Err(Status::Destroyed);
    }
    if generation != shared.ffi.generation.get() {
        return Err(Status::StaleGeneration);
    }
    Ok(shared)
}

fn node(shared: &SharedDocument, doc: &Document, token: u32) -> Result<NodeId> {
    // The existing process-unique token registry rejects foreign tokens. Core
    // then checks NodeId's document and arena generation (including adoption).
    let id = shared.id_for_token(token).ok_or(Status::InvalidToken)?;
    doc.get(id)?;
    Ok(id)
}

fn read<T>(shared: &Arc<SharedDocument>, f: impl FnOnce(&mut Document) -> Result<T>) -> Result<T> {
    // Nest the status result to preserve FFI errors without extending Node-API's
    // frozen BindingError taxonomy. These operations cannot re-enter JS.
    with_document(shared, |doc| Ok(f(doc))).map_err(Status::from)?
}

fn boundary(f: impl FnOnce() -> Result<()>) -> i32 {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => Status::Ok as i32,
        Ok(Err(status)) => status as i32,
        Err(_) => Status::Panic as i32,
    }
}

#[no_mangle]
pub extern "C" fn mad_dom_ffi_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn mad_dom_ffi_capabilities() -> u32 {
    CAPABILITIES
}

// All unsafe entry points share the same pointer preconditions and panic
// boundary. No borrowed input/output reference escapes one invocation.
macro_rules! entry {
    ($(#[$meta:meta])* fn $name:ident($($arg:ident: $ty:ty),* $(,)?) $body:block) => {
        $(#[$meta])*
        /// # Safety
        /// All nonempty buffers must be valid, aligned caller allocations of
        /// their declared lengths for this synchronous call. `written` must
        /// point to a writable u32 disjoint from output. No concurrent writes,
        /// detach/resize, or unmapping are permitted. See `ffi/ABI.md`.
        #[no_mangle]
        pub unsafe extern "C" fn $name($($arg: $ty),*) -> i32 {
            boundary(|| $body)
        }
    };
}

entry! {
    /// Query descendants; output uses Node-API's packed token snapshot layout.
    fn mad_dom_ffi_query_snapshot(owner: u32, generation: u32, scope: u32,
        selector: *const u8, selector_len: u32, out: *mut u32, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        output.validate_input(selector, selector_len)?;
        let selector = unsafe { utf8(selector, selector_len)? };
        let nodes = read(&shared, |doc| {
            let scope = node(&shared, doc, scope)?;
            doc.query_selector_all(scope, selector)?.into_iter().map(|id| {
                Ok((id, node_snapshot_descriptor(doc, id).map_err(Status::from)? << 16))
            }).collect::<Result<Vec<_>>>()
        })?;
        unsafe { output.require(nodes.len() * 2 + 1)?; }
        unsafe { output.write(&shared.token_snapshot(&nodes, None)) }
    }
}

entry! {
    /// Bounded preorder snapshot, byte-for-byte Node-API format (including continuation).
    fn mad_dom_ffi_preorder_snapshot(owner: u32, generation: u32, root: u32,
        out: *mut u32, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        let (nodes, continuation) = read(&shared, |doc| {
            let root = node(&shared, doc, root)?;
            let (mut nodes, continuation) = doc.preorder_subtree_chunk(root, u16::MAX as usize)?;
            for (id, depth) in &mut nodes {
                *depth |= node_snapshot_descriptor(doc, *id).map_err(Status::from)? << 16;
            }
            Ok((nodes, continuation))
        })?;
        unsafe { output.require(nodes.len() * 2 + 1)?; }
        unsafe { output.write(&shared.token_snapshot(&nodes, continuation)) }
    }
}

entry! {
    /// Immediate children in the same format as childNodesTokens.
    fn mad_dom_ffi_child_tokens(owner: u32, generation: u32, root: u32,
        out: *mut u32, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        let nodes = read(&shared, |doc| {
            let root = node(&shared, doc, root)?;
            doc.children(root)?.into_iter().map(|id| {
                Ok((id, node_snapshot_descriptor(doc, id).map_err(Status::from)? << 16))
            }).collect::<Result<Vec<_>>>()
        })?;
        unsafe { output.require(nodes.len() * 2 + 1)?; }
        unsafe { output.write(&shared.token_snapshot(&nodes, None)) }
    }
}

entry! {
    /// UTF-8 without a trailing NUL; mode 0 = serialize node, 1 = innerHTML.
    fn mad_dom_ffi_serialize(owner: u32, generation: u32, root: u32, mode: u32,
        out: *mut u8, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        let text = read(&shared, |doc| {
            let root = node(&shared, doc, root)?;
            match mode {
                0 => mad_dom_core::serialize::serialize_node(doc, root).map_err(Status::from),
                1 => doc.inner_html(root).map_err(Status::from),
                _ => Err(Status::InvalidArgument),
            }
        })?;
        unsafe { output.write(text.as_bytes()) }
    }
}

entry! {
    /// Detached element creation only; no mutation/callback capability is claimed.
    fn mad_dom_ffi_create_elements(owner: u32, generation: u32, name: *const u8,
        name_len: u32, count: u32, out: *mut u32, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        output.validate_input(name, name_len)?;
        let name = unsafe { utf8(name, name_len)? };
        if count > 4096 { return Err(Status::InvalidArgument); }
        // Capacity failure is side-effect free: retry cannot leak detached nodes.
        unsafe { output.require(count as usize)?; }
        if count == 0 { return Ok(()); }
        let ids = read(&shared, |doc| Ok(doc.create_elements(name, count as usize)?))?;
        unsafe { output.write(&shared.tokens_for_fresh(&ids)) }
    }
}

entry! {
    /// Batch text/attribute reads. Field 0 = textContent, 1 = id, 2 = class.
    /// Each result is a little-endian u32 byte length followed by UTF-8 bytes;
    /// u32::MAX marks null. Empty string is length 0, distinct from null.
    fn mad_dom_ffi_read_batch(owner: u32, generation: u32, tokens: *const u32,
        count: u32, field: u32, out: *mut u8, capacity: u32, written: *mut u32) {
        let shared = document(owner, generation)?;
        let output = Output::new(out, capacity, written)?;
        if field > 2 || count > 4096 { return Err(Status::InvalidArgument); }
        output.validate_input(tokens, count)?;
        let tokens = unsafe { input(tokens, count)? };
        let bytes = read(&shared, |doc| {
            let mut bytes = Vec::new();
            for &token in tokens {
                let id = node(&shared, doc, token)?;
                let value = match field {
                    0 => doc.text_content(id)?,
                    1 => doc.get_attribute(id, "id")?.map(str::to_owned),
                    _ => doc.get_attribute(id, "class")?.map(str::to_owned),
                };
                let len = match &value {
                    None => u32::MAX,
                    Some(s) => u32::try_from(s.len()).ok().filter(|&n| n != u32::MAX)
                        .ok_or(Status::InvalidArgument)?,
                };
                bytes.extend_from_slice(&len.to_le_bytes());
                if let Some(s) = value { bytes.extend_from_slice(s.as_bytes()); }
            }
            Ok(bytes)
        })?;
        unsafe { output.write(&bytes) }
    }
}
