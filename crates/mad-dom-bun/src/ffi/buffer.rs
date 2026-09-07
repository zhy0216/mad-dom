//! The only raw-memory operations in the C ABI; no retained pointers.
use std::mem::{align_of, size_of};
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
