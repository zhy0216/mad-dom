//! The only raw-memory operations in the C ABI; no retained pointers.
use std::mem::{align_of, size_of, MaybeUninit};
use std::{ptr, slice, str};

use super::{Result, Status};

fn range<T>(pointer: *const T, count: u32) -> Result<(usize, usize)> {
    if count == 0 {
        return Ok((0, 0));
    }
    let start = pointer as usize;
    let bytes = (count as usize)
        .checked_mul(size_of::<T>())
        .ok_or(Status::InvalidArgument)?;
    if pointer.is_null() || !start.is_multiple_of(align_of::<T>()) || bytes > isize::MAX as usize {
        return Err(Status::InvalidArgument);
    }
    Ok((
        start,
        start.checked_add(bytes).ok_or(Status::InvalidArgument)?,
    ))
}

impl Output<u32> {
    /// Borrow only the checked required prefix, for this callback. C output
    /// need not be initialized: a `&mut [u32]` would incorrectly require it.
    /// No reference or arbitrary lifetime is returned to the caller.
    pub(super) unsafe fn fill(
        &mut self,
        len: usize,
        fill: impl FnOnce(&mut [MaybeUninit<u32>]),
    ) -> Result<()> {
        unsafe { self.require(len)? };
        let words = if len == 0 {
            &mut []
        } else {
            // SAFETY: new checked alignment, arithmetic and written overlap;
            // require checked len <= the real caller-declared capacity. The
            // entry validates input disjointness before calling fill. The C
            // caller owns a writable, call-long exclusive allocation; using
            // MaybeUninit permits uninitialized storage without reading it.
            unsafe { slice::from_raw_parts_mut(self.pointer.cast::<MaybeUninit<u32>>(), len) }
        };
        fill(words);
        Ok(())
    }
}

pub(super) unsafe fn input<'a, T>(pointer: *const T, count: u32) -> Result<&'a [T]> {
    range(pointer, count)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: range validated alignment, null and overflow. Allocation validity,
    // initialization and call-long immutability are the C caller's obligation.
    Ok(unsafe { slice::from_raw_parts(pointer, count as usize) })
}

pub(super) unsafe fn utf8<'a>(pointer: *const u8, len: u32) -> Result<&'a str> {
    str::from_utf8(unsafe { input(pointer, len)? }).map_err(|_| Status::InvalidUtf8)
}

pub(super) struct Output<T> {
    pointer: *mut T,
    capacity: u32,
    written: *mut u32,
}

impl<T: Copy> Output<T> {
    // Validate before creating any Rust borrow. In particular, create_elements
    // writes `written` while its borrowed UTF-8 name is still in use.
    pub(super) fn validate_input<U>(&self, pointer: *const U, count: u32) -> Result<()> {
        let (start, end) = range(pointer, count)?;
        for (other_start, other_end) in
            [range(self.pointer, self.capacity)?, range(self.written, 1)?]
        {
            if start < other_end && other_start < end {
                return Err(Status::InvalidArgument);
            }
        }
        Ok(())
    }

    pub(super) fn new(pointer: *mut T, capacity: u32, written: *mut u32) -> Result<Self> {
        let (start, end) = range(pointer, capacity)?;
        let (len_start, len_end) = range(written, 1)?;
        if start < len_end && len_start < end {
            return Err(Status::InvalidArgument);
        }
        Ok(Self {
            pointer,
            capacity,
            written,
        })
    }

    pub(super) unsafe fn require(&self, len: usize) -> Result<()> {
        let len = u32::try_from(len).map_err(|_| Status::InvalidArgument)?;
        // SAFETY: caller provides a writable, aligned u32, checked by new.
        unsafe { ptr::write(self.written, len) };
        if self.capacity < len {
            Err(Status::BufferTooSmall)
        } else {
            Ok(())
        }
    }

    pub(super) unsafe fn write(&self, values: &[T]) -> Result<()> {
        unsafe {
            self.require(values.len())?;
        }
        if !values.is_empty() {
            // SAFETY: capacity checked above. The source is native-owned data,
            // disjoint from caller output. Zero-length null is never dereferenced.
            unsafe { ptr::copy_nonoverlapping(values.as_ptr(), self.pointer, values.len()) };
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::{mad_dom_ffi_query_snapshot, Registration};
    use crate::handle::{with_document, DocumentHandle};

    #[test]
    fn snapshot_initializes_only_the_required_prefix_of_uninitialized_caller_storage() {
        let _guard = crate::DOCUMENT_TEST_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let doc = DocumentHandle::new();
        let shared = doc.shared();
        let root = with_document(shared, |doc| {
            doc.load_html("<span>你好</span><span></span>")?;
            Ok(doc.document_root())
        })
        .unwrap();
        let [owner, generation] = Registration::context(&shared.ffi, shared);
        let root = shared.token_for(root);
        let mut storage = [MaybeUninit::<u32>::uninit(); 7];
        storage[6].write(0xa5a5a5a5);
        let mut written = 0;
        // SAFETY: declared storage and written are live, aligned and disjoint.
        // Its first six words intentionally have never been initialized.
        let status = unsafe {
            mad_dom_ffi_query_snapshot(
                owner,
                generation,
                root,
                b"span".as_ptr(),
                4,
                storage.as_mut_ptr().cast(),
                7,
                &mut written,
            )
        };
        assert_eq!(status, Status::Ok as i32);
        assert_eq!(written, 5);
        // SAFETY: success promises every word of the written prefix is initialized.
        let values: Vec<u32> = storage[..5]
            .iter()
            .map(|word| unsafe { word.assume_init() })
            .collect();
        assert_eq!(values[0], 0);
        assert_ne!(values[1], values[3]);
        assert_eq!(values[2] >> 31, 1);
        assert_eq!(values[4] >> 31, 1);
        // SAFETY: this canary was explicitly initialized before the call. The
        // unused word at index 5 is never assumed initialized or read.
        assert_eq!(unsafe { storage[6].assume_init() }, 0xa5a5a5a5);
    }

    #[test]
    fn fill_never_invokes_callback_on_capacity_or_length_failure() {
        let mut storage = [0xa5; 2];
        let mut written = 99;
        let mut output = Output::new(storage.as_mut_ptr(), 2, &mut written).unwrap();
        unsafe {
            assert_eq!(
                output.fill(3, |_| panic!("must not fill")),
                Err(Status::BufferTooSmall)
            );
            assert_eq!(
                output.fill(usize::MAX, |_| panic!("must not fill")),
                Err(Status::InvalidArgument)
            );
        }
        assert_eq!(storage, [0xa5; 2]);
        assert_eq!(written, 3);
        let mut empty = Output::new(ptr::null_mut(), 0, &mut written).unwrap();
        unsafe { empty.fill(0, |words| assert!(words.is_empty())).unwrap() };
        assert_eq!(written, 0);
    }
}
