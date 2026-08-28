import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

// T04 spike smoke test. Covers the five minimal links required by the M0 work
// item "为原生绑定原型验证以下最小链路" and evaluated in
// adr/0003-native-binding-spike.md. Runs via `bun test spikes/` (or
// `npm run spike:test`) after `npm run spike:build`.
const require = createRequire(import.meta.url);
const spike = require("./index.node");

function allocateManyHandles(count) {
  for (let i = 0; i < count; i++) {
    // The reference never escapes this frame, so every instance is
    // unreachable (and finalizable) once the loop iteration ends.
    new spike.SpikeHandle(i % 7);
  }
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("native binding spike (T04)", () => {
  test("5. Bun test process loads the locally built artifact stably", () => {
    expect(typeof spike.spikeRoundtrip).toBe("function");
    expect(typeof spike.spikeCheckedDiv).toBe("function");
    expect(typeof spike.SpikeHandle).toBe("function");
    expect(typeof spike.spikeLiveCount).toBe("function");
    expect(typeof spike.spikePanic).toBe("function");
    // Repeated require of the same artifact resolves to the cached module
    // backed by one dlopen — no reload errors.
    expect(require("./index.node")).toBe(spike);
  });

  test("1. strings and numbers roundtrip through the native boundary", () => {
    const text = "mads \u{1F9A0} 410";
    const number = 4096.5;
    const out = spike.spikeRoundtrip(text, number);

    expect(out.text).toBe(text);
    expect(out.number).toBe(number);
    expect(out.chars).toBe(10); // Rust `char` count; the emoji is one char
    expect(out.negated).toBe(-number);
  });

  test("2. structured errors map to TypeError and Error", () => {
    let typeError;
    try {
      spike.spikeCheckedDiv(1, 0);
    } catch (error) {
      typeError = error;
    }
    expect(typeError).toBeInstanceOf(TypeError);
    expect(typeError.message).toContain("right must not be 0");
    expect(typeError.code).toBe("ERR_SPIKE_DIV_ZERO");

    let internalError;
    try {
      spike.spikeCheckedDiv(NaN, 1);
    } catch (error) {
      internalError = error;
    }
    expect(internalError).toBeInstanceOf(Error);
    expect(internalError).not.toBeInstanceOf(TypeError);
    expect(internalError.message).toContain("left must not be NaN");
  });

  test("2b. mismatched argument types are rejected before entering Rust", () => {
    let error;
    try {
      spike.spikeCheckedDiv("not-a-number", 1);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
  });

  test("3. JS GC reclaims native objects and runs finalizers", async () => {
    const totalBefore = spike.spikeTotalCount();
    const kept = [
      new spike.SpikeHandle(1),
      new spike.SpikeHandle(2),
      new spike.SpikeHandle(3),
    ];
    expect(spike.spikeLiveCount()).toBe(3);

    allocateManyHandles(20_000);
    expect(spike.spikeTotalCount() - totalBefore).toBe(20_003);

    Bun.gc(true);
    // Bun runs napi finalizer callbacks on the next event loop turn after a
    // synchronous GC, so one macrotask drain is required for the Rust Drop
    // hooks to be observed (documented in ADR-0003).
    await drainEventLoop();
    // The explicitly retained wrappers survive; the unreachable ones were
    // collected and their Rust Drop finalizers decremented the counter.
    expect(spike.spikeLiveCount()).toBe(3);

    kept.length = 0;
    Bun.gc(true);
    await drainEventLoop();
    expect(spike.spikeLiveCount()).toBe(0);
  });

  test("4. Rust panics are intercepted at the FFI boundary", () => {
    expect(() => spike.spikePanic("boom-42")).toThrow(/spike panic: boom-42/);
    // The process is still healthy: native calls keep working afterwards.
    expect(spike.spikeRoundtrip("alive", 1).text).toBe("alive");
  });

  test("6. repeated calls on the loaded artifact stay stable", () => {
    for (let i = 0; i < 1_000; i++) {
      const out = spike.spikeRoundtrip(`#${i}`, i);
      expect(out.text).toBe(`#${i}`);
      expect(out.number).toBe(i);
      expect(out.negated).toBe(-i);
    }
  });
});
