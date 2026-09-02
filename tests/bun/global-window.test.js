import { afterEach, describe, expect, test } from "bun:test";
import { GlobalWindow, Window, isNativeAvailable } from "../../index.js";

// `GlobalWindow` facade tests (happy-dom `GlobalWindow` parity).
//
// happy-dom ships two window flavors: the sandboxed `Window`, whose scripts
// run in a per-window `node:vm` context with the context's own intrinsics,
// and `GlobalWindow`, which runs scripts in the host global context — the
// host intrinsics are mirrored onto the window (`globalWindow.Array ===
// global.Array`), `eval` is the host `eval`, and a `document.write` script
// writing `globalThis` lands at process level (the wiki-globalwindow /
// wiki-virtual-machine-context-2 observables).
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

const createdWindows = [];
const hostProbes = [];

function makeGlobalWindow(options) {
  const window = new GlobalWindow(options);
  createdWindows.push(window);
  return window;
}

// Scripts evaluated through a GlobalWindow write into the real host global;
// every probe key is recorded and removed after each test so the suite never
// leaks process-level state.
function hostProbe(name) {
  hostProbes.push(name);
  return name;
}

afterEach(() => {
  for (const window of createdWindows.splice(0)) {
    window.destroy();
  }
  for (const name of hostProbes.splice(0)) {
    delete globalThis[name];
  }
});

describe("GlobalWindow entry surface", () => {
  test("GlobalWindow is exported and constructs through Window", async () => {
    const mod = await import("../../index.js");
    expect(typeof mod.GlobalWindow).toBe("function");
    expect(Object.getPrototypeOf(mod.GlobalWindow)).toBe(mod.Window);
  });
});

const runtimeDescribe = nativeAvailable ? describe : describe.skip;

runtimeDescribe("GlobalWindow", () => {
  test("mirrors the host intrinsics onto the window", () => {
    const globalWindow = makeGlobalWindow();
    expect(globalWindow.Array).toBe(globalThis.Array);
    expect(globalWindow.Object).toBe(globalThis.Object);
    expect(globalWindow.Promise).toBe(globalThis.Promise);
    expect(globalWindow.JSON).toBe(globalThis.JSON);
    expect(globalWindow.Error).toBe(globalThis.Error);
    expect(globalWindow.Uint8Array).toBe(globalThis.Uint8Array);
    expect(globalWindow.eval).toBe(globalThis.eval);
    expect(globalWindow.global).toBe(globalThis);
  });

  test("a sandboxed Window keeps its own intrinsics (the vm-context contrast)", () => {
    const vmWindow = new Window();
    createdWindows.push(vmWindow);
    expect(vmWindow.Array === globalThis.Array).toBe(false);
  });

  test("eval runs against the host global scope", () => {
    const globalWindow = makeGlobalWindow();
    const probe = hostProbe("__mad_dom_global_window_eval_probe__");
    globalWindow.eval(`globalThis.${probe} = 1`);
    expect(globalThis[probe]).toBe(1);
    expect(globalWindow.eval("1 + 1")).toBe(2);
  });

  test("document.write scripts write the host global (wiki-globalwindow)", async () => {
    const globalWindow = makeGlobalWindow({
      settings: { enableJavaScriptEvaluation: true },
    });
    const probe = hostProbe("__mad_dom_global_window_write_probe__");
    globalWindow.document.write(`<script>globalThis.${probe} = 'Hello world!';</script>`);
    expect(globalThis[probe]).toBe("Hello world!");
    await globalWindow.happyDOM.close();
  });

  test("a sandboxed Window keeps document.write scripts away from the host", () => {
    const vmWindow = new Window({ settings: { enableJavaScriptEvaluation: true } });
    createdWindows.push(vmWindow);
    const probe = hostProbe("__mad_dom_vm_window_write_probe__");
    vmWindow.document.write(`<script>globalThis.${probe} = 'sandboxed';</script>`);
    expect(globalThis[probe]).toBeUndefined();
  });
});
