// Test-only external-buffer lease prototype. Never linked into mad-dom.
// Metadata is a bounded static tombstone table: callbacks never dereference a
// freed context, and slots are never reused. A production allocator would need
// a separate reclamation protocol for these records and its dlopen handle.
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MAX_LEASES 2048
struct lease {
    void *bytes;
    uint32_t owner, generation, length, capacity, offset;
    pthread_t creator;
    atomic_uint released, destroyed, callbacks, callback_offset;
};
static struct lease leases[MAX_LEASES];
static atomic_uint next_lease = 1, plain_lease;
static atomic_uint allocations, frees, callbacks, duplicate_releases;
static atomic_uint invalid_callbacks, live_bytes, foreign_thread_callbacks;

uint32_t spike_allocate(uint32_t owner, uint32_t generation, uint32_t length,
                        uint32_t capacity, uint32_t offset) {
    if (!owner || !generation || !capacity || capacity > 1048576 ||
        offset > capacity || length > capacity - offset || atomic_load(&next_lease) == MAX_LEASES) return 0;
    void *bytes = malloc(capacity);
    if (!bytes) return 0;
    memset(bytes, 0xa5, capacity);
    uint32_t id = atomic_load(&next_lease);
    struct lease *lease = &leases[id];
    lease->bytes = bytes;
    lease->owner = owner;
    lease->generation = generation;
    lease->length = length;
    lease->capacity = capacity;
    lease->offset = offset;
    lease->creator = pthread_self();
    atomic_store(&next_lease, id + 1);
    atomic_fetch_add(&allocations, 1);
    atomic_fetch_add(&live_bytes, capacity);
    return id;
}

void *spike_bytes(uint32_t id) { return leases[id].bytes; }
void *spike_context(uint32_t id) { return &leases[id]; }
uint32_t spike_released(uint32_t id) { return atomic_load(&leases[id].released); }
uint32_t spike_callbacks(uint32_t id) { return atomic_load(&leases[id].callbacks); }
uint32_t spike_callback_offset(uint32_t id) { return atomic_load(&leases[id].callback_offset); }

uint32_t spike_validate(uint32_t id, uint32_t owner, uint32_t generation,
                        uint32_t length, uint32_t capacity) {
    if (!id || id >= atomic_load(&next_lease)) return 1;
    struct lease *lease = &leases[id];
    if (lease->owner != owner) return 3;
    if (atomic_load(&lease->destroyed)) return 5;
    if (lease->generation != generation) return 4;
    if (length > capacity || length != lease->length || capacity != lease->capacity) return 1;
    return atomic_load(&lease->released) ? 6 : 0;
}

// Destroy invalidates access credentials, but MUST NOT free a live JS view.
void spike_destroy(uint32_t id) { atomic_store(&leases[id].destroyed, 1); }

static void release(struct lease *lease) {
    if (atomic_exchange(&lease->released, 1)) {
        atomic_fetch_add(&duplicate_releases, 1);
        return;
    }
    // Free by immutable allocation metadata, even after document destruction.
    // Checking the current document generation here would leak stale leases.
    free(lease->bytes);
    atomic_fetch_sub(&live_bytes, lease->capacity);
    atomic_fetch_add(&frees, 1);
}

static void deallocate(void *bytes, void *context) {
    struct lease *lease = context;
    atomic_fetch_add(&callbacks, 1);
    // Only table entries are allowed as callback contexts. No arbitrary pointer
    // is dereferenced; the JS probe supplies the pointer returned above.
    uint32_t i;
    for (i = 1; i < atomic_load(&next_lease); i++) if (lease == &leases[i]) break;
    if (i == atomic_load(&next_lease)) { atomic_fetch_add(&invalid_callbacks, 1); return; }
    uintptr_t offset = (uintptr_t)bytes - (uintptr_t)lease->bytes;
    if (offset != 0 && offset != lease->offset) {
        atomic_fetch_add(&invalid_callbacks, 1);
        return;
    }
    atomic_store(&lease->callback_offset, (uint32_t)offset);
    atomic_fetch_add(&lease->callbacks, 1);
    if (!pthread_equal(lease->creator, pthread_self())) atomic_fetch_add(&foreign_thread_callbacks, 1);
    release(lease);
}

static void deallocate_without_context(void *bytes, void *context) {
    if (context != NULL) { atomic_fetch_add(&invalid_callbacks, 1); return; }
    deallocate(bytes, &leases[atomic_load(&plain_lease)]);
}

void *spike_deallocator(uint32_t without_context) {
    if (without_context) atomic_store(&plain_lease, atomic_load(&next_lease) - 1);
    return without_context ? (void *)deallocate_without_context : (void *)deallocate;
}
// Only invoked AFTER all JS aliases die and Bun's callback has run. This
// exercises duplicate-release protection without ever reading freed bytes.
void spike_repeat_release(uint32_t id) { release(&leases[id]); }

uint32_t spike_metric(uint32_t field) {
    switch (field) {
        case 0: return atomic_load(&allocations);
        case 1: return atomic_load(&frees);
        case 2: return atomic_load(&callbacks);
        case 3: return atomic_load(&duplicate_releases);
        case 4: return atomic_load(&invalid_callbacks);
        case 5: return atomic_load(&live_bytes);
        case 6: return atomic_load(&foreign_thread_callbacks);
        default: return UINT32_MAX;
    }
}

// Symbol discovery only: never fabricate a JSContextRef or invoke private JSC.
uint32_t spike_jsc_symbol(const char *name) { return dlsym(RTLD_DEFAULT, name) != NULL; }

// Fault injection for the JS loader's output protocol. This separate test
// image never reaches a real DOM. It reports bad lengths without bad writes.
static uint32_t fault_mode, fault_calls;
uint32_t mad_dom_ffi_abi_version(void) { return 1; }
uint32_t mad_dom_ffi_capabilities(void) { return 12; }
void spike_set_fault(uint32_t mode) { fault_mode = mode; fault_calls = 0; }
uint32_t spike_fault_calls(void) { return fault_calls; }
int32_t mad_dom_ffi_create_elements(uint32_t owner, uint32_t generation,
    const uint8_t *name, uint32_t name_len, uint32_t count,
    uint32_t *out, uint32_t capacity, uint32_t *written) {
    (void)owner; (void)generation; (void)name; (void)name_len;
    fault_calls++;
    if (fault_mode < 2) { *written = fault_mode ? count + 1 : count - 1; return 0; }
    if (count != 3000 || capacity != count) return 1;
    for (uint32_t i = 0; i < count; i++) out[i] = 7;
    *written = count;
    return 0;
}
int32_t mad_dom_ffi_serialize(uint32_t owner, uint32_t generation,
    uint32_t root, uint32_t mode, uint8_t *out, uint32_t capacity, uint32_t *written) {
    (void)owner; (void)generation; (void)root; (void)mode; (void)out;
    fault_calls++;
    *written = fault_mode == 2 ? capacity + 1 : fault_mode == 3 ? capacity : 64000001;
    return fault_mode == 2 ? 0 : 2;
}
