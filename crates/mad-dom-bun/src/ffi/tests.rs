use super::*;
use std::ptr::{null, null_mut};

fn lock() -> std::sync::MutexGuard<'static, ()> {
    crate::DOCUMENT_TEST_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

struct Fixture {
    handle: DocumentHandle,
    owner: u32,
    generation: u32,
    root: u32,
}
impl Fixture {
    fn new() -> Self {
        let handle = DocumentHandle::new();
        let shared = handle.shared();
        let root = with_document(shared, |doc| Ok(doc.document_root())).unwrap();
        let [owner, generation] = shared.ffi.context(shared);
        let root = shared.token_for(root);
        Self {
            handle,
            owner,
            generation,
            root,
        }
    }
    fn html(&self, html: &str) {
        with_document(self.handle.shared(), |doc| {
            doc.load_html(html).map_err(BindingError::from)
        })
        .unwrap();
    }
    fn element(&self, name: &str) -> u32 {
        let id = with_document(self.handle.shared(), |doc| {
            doc.create_element(name).map_err(BindingError::from)
        })
        .unwrap();
        self.handle.shared().token_for(id)
    }
    fn query(&self, selector: &str) -> Vec<u32> {
        let mut out = vec![0; 1000];
        let mut len = 0;
        unsafe {
            assert_eq!(
                mad_dom_ffi_query_snapshot(
                    self.owner,
                    self.generation,
                    self.root,
                    selector.as_ptr(),
                    selector.len() as u32,
                    out.as_mut_ptr(),
                    out.len() as u32,
                    &mut len
                ),
                0
            );
        }
        out.truncate(len as usize);
        out
    }
    fn serialize(&self, token: u32) -> String {
        let mut out = vec![0; 10000];
        let mut len = 0;
        unsafe {
            assert_eq!(
                mad_dom_ffi_serialize(
                    self.owner,
                    self.generation,
                    token,
                    0,
                    out.as_mut_ptr(),
                    out.len() as u32,
                    &mut len
                ),
                0
            );
        }
        out.truncate(len as usize);
        String::from_utf8(out).unwrap()
    }
}

#[test]
fn versions_and_status_codes_are_frozen() {
    assert_eq!(mad_dom_ffi_abi_version(), 1);
    assert_eq!(crate::api::ABI_VERSION, 1);
    assert_eq!(mad_dom_ffi_capabilities(), 31);
    let values = [
        Status::Ok,
        Status::InvalidArgument,
        Status::BufferTooSmall,
        Status::InvalidDocument,
        Status::StaleGeneration,
        Status::Destroyed,
        Status::InvalidToken,
        Status::StaleToken,
        Status::WrongDocument,
        Status::InvalidUtf8,
        Status::Syntax,
        Status::Hierarchy,
        Status::InvalidCharacter,
        Status::IndexOutOfBounds,
        Status::Panic,
    ];
    for (n, value) in values.into_iter().enumerate() {
        assert_eq!(value as usize, n);
    }
}

#[test]
fn real_query_traversal_and_serialization_share_node_api_tokens() {
    let _guard = lock();
    let f = Fixture::new();
    f.html("<main><span id='a'>你好 &amp; 🌍</span><span class='x'>two</span><!--ok--></main>");
    let query = f.query("main > span");
    assert_eq!(query.len(), 5);
    assert_eq!(query[0], 0);
    assert_eq!(f.serialize(query[1]), "<span id=\"a\">你好 &amp; 🌍</span>");
    let main = f.query("main")[1];
    let mut out = [0; 128];
    let mut len = 0;
    unsafe {
        assert_eq!(
            mad_dom_ffi_preorder_snapshot(f.owner, 1, main, out.as_mut_ptr(), 128, &mut len),
            0
        );
        assert_eq!(len, 13); // main, span, text, span, text, comment
        assert_eq!(out[1], main);
        assert_eq!(out[3], query[1]);
        assert_eq!(out[4] & 0xffff, 1);
        assert_eq!(out[6] & 0xffff, 2);
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, main, out.as_mut_ptr(), 128, &mut len),
            0
        );
        assert_eq!(len, 7);
        assert_eq!(out[1], query[1]);
        assert_eq!(out[3], query[3]);
    }
    // Output remains independently readable after native teardown.
    f.handle.destroy_inner();
    assert_eq!(out[1], query[1]);
}

#[test]
fn every_read_validates_owner_generation_token_and_destroy_before_pointers() {
    let _guard = lock();
    let f = Fixture::new();
    let foreign = Fixture::new();
    let token = foreign.element("div");
    type Read = Box<dyn Fn(u32, u32, u32) -> i32>;
    let calls: Vec<Read> = vec![
        Box::new(|o, g, t| unsafe {
            mad_dom_ffi_query_snapshot(o, g, t, b"*".as_ptr(), 1, null_mut(), 0, &mut 0)
        }),
        Box::new(|o, g, t| unsafe {
            mad_dom_ffi_preorder_snapshot(o, g, t, null_mut(), 0, &mut 0)
        }),
        Box::new(|o, g, t| unsafe { mad_dom_ffi_child_tokens(o, g, t, null_mut(), 0, &mut 0) }),
        Box::new(|o, g, t| unsafe { mad_dom_ffi_serialize(o, g, t, 0, null_mut(), 0, &mut 0) }),
        Box::new(|o, g, t| unsafe {
            mad_dom_ffi_read_batch(o, g, &t, 1, 0, null_mut(), 0, &mut 0)
        }),
    ];
    for call in &calls {
        assert_eq!(call(0, 1, f.root), Status::InvalidDocument as i32);
        assert_eq!(call(f.owner, 0, f.root), Status::StaleGeneration as i32);
        assert_eq!(call(f.owner, 1, token), Status::InvalidToken as i32);
        assert_eq!(call(f.owner, 1, u32::MAX), Status::InvalidToken as i32);
    }
    f.handle.destroy_inner();
    f.handle.destroy_inner();
    for call in calls {
        assert_eq!(call(f.owner, 1, f.root), Status::Destroyed as i32);
    }
}

#[test]
fn capacity_probe_is_exact_and_never_partially_writes_or_mints_tokens() {
    let _guard = lock();
    let f = Fixture::new();
    f.html("<div>hello</div>");
    let mut out = [0xdeadbeef; 3];
    let mut len = 0;
    unsafe {
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                b"div".as_ptr(),
                3,
                out.as_mut_ptr(),
                2,
                &mut len
            ),
            2
        );
        assert_eq!(len, 3);
        assert_eq!(out, [0xdeadbeef; 3]);
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                b"div".as_ptr(),
                3,
                out.as_mut_ptr(),
                3,
                &mut len
            ),
            0
        );
        assert_ne!(out[2] & (1 << 31), 0); // failed sizing did not consume fresh marker
        let token = out[1];
        let mut bytes = [0xa5; 1];
        assert_eq!(
            mad_dom_ffi_serialize(f.owner, 1, token, 0, bytes.as_mut_ptr(), 1, &mut len),
            2
        );
        assert_eq!(len, 16);
        assert_eq!(bytes, [0xa5]);
        assert_eq!(
            mad_dom_ffi_preorder_snapshot(f.owner, 1, token, null_mut(), 0, &mut len),
            2
        );
        assert_eq!(len, 5);
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, token, null_mut(), 0, &mut len),
            2
        );
        assert_eq!(len, 3);
        assert_eq!(
            mad_dom_ffi_read_batch(f.owner, 1, &token, 1, 0, null_mut(), 0, &mut len),
            2
        );
        assert_eq!(len, 9);
    }
}

#[test]
fn input_and_output_validation_empty_utf8_alignment_overlap_and_syntax() {
    let _guard = lock();
    let f = Fixture::new();
    let mut out = [0; 8];
    let mut len = 99;
    unsafe {
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                null(),
                0,
                out.as_mut_ptr(),
                8,
                &mut len
            ),
            Status::Syntax as i32
        );
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                null(),
                1,
                out.as_mut_ptr(),
                8,
                &mut len
            ),
            1
        );
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                [0xff].as_ptr(),
                1,
                out.as_mut_ptr(),
                8,
                &mut len
            ),
            9
        );
        assert_eq!(
            mad_dom_ffi_query_snapshot(
                f.owner,
                1,
                f.root,
                b"[".as_ptr(),
                1,
                out.as_mut_ptr(),
                8,
                &mut len
            ),
            10
        );
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, f.root, null_mut(), 1, &mut len),
            1
        );
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, f.root, out.as_mut_ptr(), 8, null_mut()),
            1
        );
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, f.root, out.as_mut_ptr(), 8, out.as_mut_ptr()),
            1
        );
        let misaligned = out.as_mut_ptr().cast::<u8>().add(1).cast::<u32>();
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, f.root, misaligned, 1, &mut len),
            1
        );
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, f.root, out.as_mut_ptr(), 8, &mut len),
            0
        );
        assert_eq!(len, 1); // empty snapshot still has its header
        assert_eq!(
            mad_dom_ffi_serialize(f.owner, 1, f.root, 0, null_mut(), 0, &mut len),
            0
        );
        assert_eq!(len, 0);
        assert_eq!(
            mad_dom_ffi_serialize(f.owner, 1, f.root, 42, null_mut(), 0, &mut len),
            1
        );
        assert_eq!(
            mad_dom_ffi_read_batch(f.owner, 1, null(), 0, 0, null_mut(), 0, &mut len),
            0
        );
        assert_eq!(len, 0);
        assert_eq!(
            mad_dom_ffi_read_batch(f.owner, 1, null(), 1, 0, null_mut(), 0, &mut len),
            1
        );
        assert_eq!(
            mad_dom_ffi_read_batch(f.owner, 1, null(), 0, 9, null_mut(), 0, &mut len),
            1
        );
    }
}

#[test]
fn creation_batch_is_retryable_and_shared_with_node_api() {
    let _guard = lock();
    let f = Fixture::new();
    let mut out = [0; 3];
    let mut len = 0;
    unsafe {
        assert_eq!(
            mad_dom_ffi_create_elements(
                f.owner,
                1,
                b"span".as_ptr(),
                4,
                3,
                out.as_mut_ptr(),
                2,
                &mut len
            ),
            2
        );
        assert_eq!(len, 3);
        assert_eq!(
            mad_dom_ffi_create_elements(
                f.owner,
                1,
                b"span".as_ptr(),
                4,
                3,
                out.as_mut_ptr(),
                3,
                &mut len
            ),
            0
        );
        assert_eq!(f.serialize(out[0]), "<span></span>");
        assert_ne!(out[0], out[1]);
        assert_eq!(
            mad_dom_ffi_create_elements(f.owner, 1, null(), 0, 0, null_mut(), 0, &mut len),
            0
        );
        assert_eq!(
            mad_dom_ffi_create_elements(f.owner, 1, null(), 0, 1, out.as_mut_ptr(), 3, &mut len),
            12
        );
        assert_eq!(
            mad_dom_ffi_create_elements(
                f.owner,
                1,
                [0xff].as_ptr(),
                1,
                1,
                out.as_mut_ptr(),
                3,
                &mut len
            ),
            9
        );
        assert_eq!(
            mad_dom_ffi_create_elements(
                f.owner,
                1,
                b"div".as_ptr(),
                3,
                4097,
                null_mut(),
                0,
                &mut len
            ),
            1
        );
        assert_eq!(
            mad_dom_ffi_create_elements(f.owner, 0, null(), 0, 0, null_mut(), 0, &mut len),
            4
        );
        assert_eq!(
            mad_dom_ffi_create_elements(0, 1, null(), 0, 0, null_mut(), 0, &mut len),
            3
        );
        f.handle.destroy_inner();
        assert_eq!(
            mad_dom_ffi_create_elements(f.owner, 1, null(), 0, 0, null_mut(), 0, &mut len),
            5
        );
    }
}

#[test]
fn batch_distinguishes_null_empty_and_unicode_and_is_atomic_on_error() {
    let _guard = lock();
    let f = Fixture::new();
    f.html("<span id=''>你好</span><span class='x'>🌍</span>");
    let q = f.query("span");
    let tokens = [q[1], q[3]];
    let mut out = [0; 100];
    let mut len = 0;
    unsafe {
        assert_eq!(
            mad_dom_ffi_read_batch(
                f.owner,
                1,
                tokens.as_ptr(),
                2,
                1,
                out.as_mut_ptr(),
                100,
                &mut len
            ),
            0
        );
        assert_eq!(&out[..len as usize], &[0, 0, 0, 0, 255, 255, 255, 255]);
        assert_eq!(
            mad_dom_ffi_read_batch(
                f.owner,
                1,
                tokens.as_ptr(),
                2,
                2,
                out.as_mut_ptr(),
                100,
                &mut len
            ),
            0
        );
        assert_eq!(
            &out[..len as usize],
            &[255, 255, 255, 255, 1, 0, 0, 0, b'x']
        );
        assert_eq!(
            mad_dom_ffi_read_batch(
                f.owner,
                1,
                tokens.as_ptr(),
                2,
                0,
                out.as_mut_ptr(),
                100,
                &mut len
            ),
            0
        );
        assert_eq!(len, 18); // two lengths + 6 + 4 UTF-8 bytes
        out.fill(0xa5);
        assert_eq!(
            mad_dom_ffi_read_batch(
                f.owner,
                1,
                [tokens[0], u32::MAX].as_ptr(),
                2,
                0,
                out.as_mut_ptr(),
                100,
                &mut len
            ),
            6
        );
        assert_eq!(out, [0xa5; 100]);
    }
}

#[test]
fn stale_arena_generation_after_adoption_cannot_alias_a_reused_slot() {
    let _guard = lock();
    let f = Fixture::new();
    let token = f.element("old");
    let mut target = Document::new();
    with_document(f.handle.shared(), |doc| {
        let id = f.handle.shared().id_for_token(token).unwrap();
        target.adopt_node(doc, id)?;
        doc.create_element("new")?;
        Ok(())
    })
    .unwrap();
    unsafe {
        assert_eq!(
            mad_dom_ffi_serialize(f.owner, 1, token, 0, null_mut(), 0, &mut 0),
            7
        );
        assert_eq!(
            mad_dom_ffi_query_snapshot(f.owner, 1, token, b"*".as_ptr(), 1, null_mut(), 0, &mut 0),
            7
        );
        assert_eq!(
            mad_dom_ffi_preorder_snapshot(f.owner, 1, token, null_mut(), 0, &mut 0),
            7
        );
        assert_eq!(
            mad_dom_ffi_child_tokens(f.owner, 1, token, null_mut(), 0, &mut 0),
            7
        );
        assert_eq!(
            mad_dom_ffi_read_batch(f.owner, 1, &token, 1, 0, null_mut(), 0, &mut 0),
            7
        );
    }
}

#[test]
fn registry_does_not_pin_documents_and_rejects_other_threads() {
    let _guard = lock();
    let f = Fixture::new();
    let (owner, root) = (f.owner, f.root);
    assert_eq!(
        std::thread::spawn(move || unsafe {
            mad_dom_ffi_child_tokens(owner, 1, root, null_mut(), 0, &mut 0)
        })
        .join()
        .unwrap(),
        3
    );
    let weak = Arc::downgrade(f.handle.shared());
    drop(f);
    assert!(weak.upgrade().is_none());
    assert!(!DOCUMENTS.with(|docs| docs.borrow().contains_key(&owner)));
    unsafe {
        assert_eq!(
            mad_dom_ffi_child_tokens(owner, 1, root, null_mut(), 0, &mut 0),
            3
        );
    }
}

#[test]
fn registration_count_tracks_lazy_owner_lifecycle() {
    let _guard = lock();
    // The test lock serializes with the other registry tests, so this thread
    // starts with a clean, deterministic count regardless of test order.
    let baseline = registration_count();
    {
        // No owner is minted until the first ffiContext request, so merely
        // creating a document never grows the FFI registry.
        let doc = DocumentHandle::new();
        assert_eq!(registration_count(), baseline);
        let shared = doc.shared().clone();
        // The first context() mints and registers exactly one owner...
        let [first, generation] = shared.ffi.context(&shared);
        assert_eq!(registration_count(), baseline + 1);
        // ...and later context reads reuse it instead of leaking a second
        // registration per call (the FFI context is a per-document credential,
        // not a per-call lease).
        let [second, same_generation] = shared.ffi.context(&shared);
        assert_eq!(first, second);
        assert_eq!(generation, same_generation);
        assert_eq!(registration_count(), baseline + 1);
        // destroy alone keeps the registration: destroyed documents stay owned
        // by the handle, so a stale FFI call still resolves to Destroyed
        // instead of an ambiguous registry miss.
        doc.destroy_inner();
        assert_eq!(registration_count(), baseline + 1);
    }
    // Dropping the last ownership Arc unregisters the owner deterministically
    // (no GC involved): the registry holds only Weak references and never pins
    // a document.
    assert_eq!(registration_count(), baseline);
}

#[test]
fn wrapper_cache_counter_returns_to_baseline_after_destroy() {
    let _guard = lock();
    // Without a JS runtime no wrapper can be minted (WeakReference needs an
    // Env), so the strong invariant tested here is the pure destroy side: a
    // destroy of an empty cache must never drive the process-wide counter
    // negative, and a freshly created document contributes nothing.
    let baseline = crate::handle::live_wrapper_cache_entries();
    let doc = DocumentHandle::new();
    doc.destroy_inner();
    assert_eq!(crate::handle::live_wrapper_cache_entries(), baseline);
    drop(doc);
    assert_eq!(crate::handle::live_wrapper_cache_entries(), baseline);
}

#[test]
fn panic_boundary_contains_unwind_and_poisoned_document_recovers() {
    let _guard = lock();
    let f = Fixture::new();
    assert_eq!(
        boundary(|| {
            read(&f.handle.shared().clone(), |_| -> Result<()> {
                panic!("FFI containment test")
            })
        }),
        14
    );
    assert_eq!(f.serialize(f.root), "");
}
