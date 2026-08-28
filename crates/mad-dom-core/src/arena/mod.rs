//! Generational slot arena for the node store.
//!
//! Every node in a document lives in a slot of an [`Arena`]. Nodes are
//! addressed through opaque, copyable [`NodeId`] handles instead of raw
//! pointers or array indices, so a stale handle can never silently alias a
//! different node that later occupies the same slot.
//!
//! # Generation overflow policy
//!
//! A slot's generation starts at `0` and is incremented every time the slot is
//! reused after a removal. The counter is capped at [`MAX_GENERATION`]
//! (`u32::MAX`). A slot whose generation has reached the cap is **retired
//! permanently**: it is never handed out again, so a handle carrying the capped
//! generation can never alias a new value. The retired slot stays allocated but
//! empty forever, which is an acceptable cost given `u32::MAX - 1` reuse cycles
//! per slot are unreachable in practice. See [`next_generation`].

mod error;
mod node_id;

pub use error::ArenaError;
pub use node_id::NodeId;

use std::fmt;

/// Maximum generation a slot can reach before it is retired permanently.
pub const MAX_GENERATION: u32 = u32::MAX;

/// Returns the next generation for a recycled slot, or `None` when the slot has
/// reached [`MAX_GENERATION`] and must be retired permanently.
fn next_generation(generation: u32) -> Option<u32> {
    if generation == MAX_GENERATION {
        None
    } else {
        Some(generation + 1)
    }
}

/// A single slot in the arena's backing storage.
struct Slot<T> {
    generation: u32,
    value: Option<T>,
}

impl<T> Slot<T> {
    /// Creates a fresh, occupied slot with generation `0`.
    fn fresh(value: T) -> Self {
        Self {
            generation: 0,
            value: Some(value),
        }
    }
}

/// Backing storage for values of type `T`, addressed by opaque [`NodeId`]
/// handles.
///
/// Removed slots are recycled through a free list and their generation is
/// bumped on reuse, so dangling handles fail validation with a structured
/// [`ArenaError`]. Capacity is not automatically shrunk on removal.
pub struct Arena<T> {
    slots: Vec<Slot<T>>,
    free: Vec<u32>,
    len: usize,
    allocated: u64,
}

impl<T> Arena<T> {
    /// Creates an empty arena.
    pub fn new() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
            len: 0,
            allocated: 0,
        }
    }

    /// Allocates a slot for `value` and returns its opaque handle.
    ///
    /// `document_id` identifies the document that owns the arena and is
    /// embedded into every returned handle, so handles from different
    /// documents are distinguishable. A recycled slot is preferred, so
    /// removals followed by allocations reuse storage; the recycled slot's
    /// generation is incremented so any older handle becomes stale. When no
    /// slot is recyclable a fresh slot is appended.
    pub fn allocate(&mut self, document_id: u64, value: T) -> NodeId {
        while let Some(slot_idx) = self.free.pop() {
            let slot = &mut self.slots[slot_idx as usize];
            // A slot whose generation reached `MAX_GENERATION` is retired
            // permanently: the backing entry stays empty forever (see module
            // docs) and is never reused again.
            if let Some(generation) = next_generation(slot.generation) {
                slot.generation = generation;
                slot.value = Some(value);
                self.len += 1;
                self.allocated += 1;
                return NodeId::new(document_id, slot_idx, generation);
            }
        }
        let slot_idx =
            u32::try_from(self.slots.len()).expect("arena capacity exceeds u32::MAX slots");
        self.slots.push(Slot::fresh(value));
        self.len += 1;
        self.allocated += 1;
        NodeId::new(document_id, slot_idx, 0)
    }

    /// Returns a shared reference to the value for `id`.
    ///
    /// Errors with [`ArenaError::OutOfBounds`], [`ArenaError::EmptySlot`] or
    /// [`ArenaError::GenerationMismatch`] when `id` does not designate a live
    /// value.
    pub fn get(&self, id: NodeId) -> Result<&T, ArenaError> {
        let slot_idx = self.check(id)?;
        Ok(self.slots[slot_idx]
            .value
            .as_ref()
            .expect("validated slot is occupied"))
    }

    /// Returns a mutable reference to the value for `id`.
    ///
    /// See [`Arena::get`] for the error conditions.
    pub fn get_mut(&mut self, id: NodeId) -> Result<&mut T, ArenaError> {
        let slot_idx = self.check(id)?;
        Ok(self.slots[slot_idx]
            .value
            .as_mut()
            .expect("validated slot is occupied"))
    }

    /// Removes and returns the value for `id`, recycling the slot.
    ///
    /// After removal the slot is empty and any handle to it becomes invalid
    /// until the slot is reused with a bumped generation. See [`Arena::get`]
    /// for the error conditions.
    pub fn remove(&mut self, id: NodeId) -> Result<T, ArenaError> {
        let slot_idx = self.check(id)?;
        let value = self.slots[slot_idx]
            .value
            .take()
            .expect("validated slot is occupied");
        self.len -= 1;
        self.free
            .push(u32::try_from(slot_idx).expect("slot index fits in u32"));
        Ok(value)
    }

    /// Returns whether `id` designates a live value in this arena.
    pub fn contains(&self, id: NodeId) -> bool {
        self.check(id).is_ok()
    }

    /// Number of live (occupied) slots.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Whether no slot is currently live.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Total number of backing slots, including empty and retired ones.
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Total number of successful allocations since the arena was created.
    ///
    /// This is a monotonic counter; combined with [`Arena::capacity`] it shows
    /// whether removal + allocation recycles existing slots.
    pub fn allocated(&self) -> u64 {
        self.allocated
    }

    /// Validates `id` and returns its slot index.
    ///
    /// Checks, in order: bounds, whether the slot is empty, and whether the
    /// slot's generation matches the handle's.
    fn check(&self, id: NodeId) -> Result<usize, ArenaError> {
        let slot_idx = id.slot() as usize;
        let slot = self
            .slots
            .get(slot_idx)
            .ok_or(ArenaError::OutOfBounds { id })?;
        if slot.value.is_none() {
            return Err(ArenaError::EmptySlot { id });
        }
        if slot.generation != id.generation() {
            return Err(ArenaError::GenerationMismatch { id });
        }
        Ok(slot_idx)
    }
}

impl<T> Default for Arena<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> fmt::Debug for Arena<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Arena")
            .field("len", &self.len)
            .field("capacity", &self.capacity())
            .field("allocated", &self.allocated)
            .field("free", &self.free)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocate_and_get() {
        let mut arena = Arena::new();
        let a = arena.allocate(0, "alpha");
        let b = arena.allocate(0, "beta");
        assert_eq!(arena.get(a).unwrap(), &"alpha");
        assert_eq!(arena.get(b).unwrap(), &"beta");
    }

    #[test]
    fn get_mut_mutates_value() {
        let mut arena = Arena::new();
        let id = arena.allocate(0, 1_u32);
        *arena.get_mut(id).unwrap() = 42;
        assert_eq!(arena.get(id).unwrap(), &42);
    }

    #[test]
    fn len_and_capacity_observation() {
        let mut arena = Arena::new();
        assert!(arena.is_empty());
        assert_eq!(arena.len(), 0);
        assert_eq!(arena.capacity(), 0);
        assert_eq!(arena.allocated(), 0);

        let ids: Vec<NodeId> = (0..4).map(|i| arena.allocate(0, i)).collect();
        assert_eq!(arena.len(), 4);
        assert_eq!(arena.capacity(), 4);
        assert_eq!(arena.allocated(), 4);
        assert_eq!(arena.capacity(), ids.len());

        arena.remove(ids[1]).unwrap();
        arena.remove(ids[3]).unwrap();
        assert_eq!(arena.len(), 2);
        assert_eq!(arena.capacity(), 4);
    }

    #[test]
    fn out_of_bounds_errors() {
        let arena: Arena<u32> = Arena::new();
        let id = NodeId::new(0, u32::MAX, 0);
        assert_eq!(arena.get(id), Err(ArenaError::OutOfBounds { id }));
        assert!(!arena.contains(id));
    }

    #[test]
    fn empty_slot_errors() {
        let mut arena = Arena::new();
        let id = arena.allocate(0, 7_u32);
        arena.remove(id).unwrap();
        assert_eq!(arena.get(id), Err(ArenaError::EmptySlot { id }));
        assert_eq!(arena.get_mut(id), Err(ArenaError::EmptySlot { id }));
        assert!(!arena.contains(id));
    }

    #[test]
    fn generation_mismatch_errors() {
        let mut arena = Arena::new();
        let old = arena.allocate(0, "first");
        arena.remove(old).unwrap();
        let new = arena.allocate(0, "second");
        assert_eq!(old.slot(), new.slot());
        assert_ne!(old.generation(), new.generation());
        assert_eq!(
            arena.get(old),
            Err(ArenaError::GenerationMismatch { id: old })
        );
    }

    #[test]
    fn remove_returns_value_and_recycles_slot() {
        let mut arena = Arena::new();
        let a = arena.allocate(0, "a");
        let b = arena.allocate(0, "b");
        let removed = arena.remove(a).unwrap();
        assert_eq!(removed, "a");
        assert_eq!(arena.len(), 1);

        let c = arena.allocate(0, "c");
        assert_eq!(c.slot(), a.slot(), "removed slot is recycled");
        assert_eq!(arena.capacity(), 2, "capacity is unchanged after reuse");
        assert_eq!(arena.len(), 2);
        assert_eq!(arena.get(b).unwrap(), &"b");
        assert_eq!(arena.get(c).unwrap(), &"c");
    }

    #[test]
    fn dangling_handle_can_never_read_new_node() {
        let mut arena = Arena::new();
        let original = arena.allocate(0, "original");
        arena.remove(original).unwrap();

        for _ in 0..3 {
            let replacement = arena.allocate(0, "replacement");
            assert_eq!(replacement.slot(), original.slot());
            assert_ne!(replacement.generation(), original.generation());
            assert_eq!(
                arena.get(original),
                Err(ArenaError::GenerationMismatch { id: original }),
                "stale handle must never read the replacement"
            );
            assert_eq!(arena.get(replacement).unwrap(), &"replacement");
            arena.remove(replacement).unwrap();
        }
    }

    #[test]
    fn repeated_reuse_bumps_generation() {
        let mut arena = Arena::new();
        let first = arena.allocate(0, "first");
        arena.remove(first).unwrap();
        let second = arena.allocate(0, "second");
        arena.remove(second).unwrap();
        let third = arena.allocate(0, "third");
        assert_eq!(first.slot(), third.slot());
        assert_eq!(first.generation(), 0);
        assert_eq!(second.generation(), 1);
        assert_eq!(third.generation(), 2);
    }

    #[test]
    fn remove_returns_structured_error_for_invalid_id() {
        let mut arena = Arena::new();
        let stale = arena.allocate(0, 1_u32);
        arena.remove(stale).unwrap();
        assert_eq!(
            arena.remove(stale),
            Err(ArenaError::EmptySlot { id: stale })
        );
    }

    #[test]
    fn contains_tracks_liveness() {
        let mut arena = Arena::new();
        let id = arena.allocate(0, 1_u32);
        assert!(arena.contains(id));
        arena.remove(id).unwrap();
        assert!(!arena.contains(id));
    }

    #[test]
    fn generation_overflow_policy() {
        assert_eq!(next_generation(0), Some(1));
        assert_eq!(next_generation(u32::MAX - 1), Some(u32::MAX));
        assert_eq!(next_generation(u32::MAX), None);
    }

    #[test]
    fn retired_slot_is_never_reused() {
        let mut arena = Arena {
            slots: vec![Slot {
                generation: MAX_GENERATION,
                value: None,
            }],
            free: vec![0],
            len: 0,
            allocated: 0,
        };
        let id = arena.allocate(0, "value");
        assert_eq!(id.slot(), 1, "retired slot 0 is skipped");
        assert_eq!(id.generation(), 0);
        assert_eq!(arena.capacity(), 2);
        assert_eq!(arena.len(), 1);
        assert_eq!(arena.get(id).unwrap(), &"value");
    }
}
