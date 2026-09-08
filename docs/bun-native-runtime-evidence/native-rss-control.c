#include <stdint.h>
#include <stdlib.h>

static void *blocks[64];
static uint32_t count;

uint32_t retain_native_mb(void) {
    if (count == 64) return 0;
    volatile unsigned char *p = malloc(1048576);
    if (p == NULL) return 0;
    for (uint32_t i = 0; i < 1048576; i += 4096) p[i] = 0x5a;
    p[1048575] = 0x5a;
    blocks[count++] = (void *)p;
    return count;
}

uint32_t release_native_mb(void) {
    uint32_t released = count;
    while (count) free(blocks[--count]);
    return released;
}
