// Loaded ONLY by an explicitly diagnostic worker; never imported in formal timing.
// These are JS constructor/copy/call counts, not a Rust allocator or total-byte ledger.
export function installDiagnostics(native, loader) {
  let active = false, counts = {};
  function hit(key, n = 1) { if (active) counts[key] = (counts[key] ?? 0) + n; }
  for (const name of ["Uint8Array", "Uint32Array", "TextEncoder", "TextDecoder"]) {
    const Original = globalThis[name];
    globalThis[name] = new Proxy(Original, {
      construct(target, args) {
        const value = Reflect.construct(target, args, target);
        hit(`${name}.construct`);
        if (name.endsWith("Array")) {
          hit(`${name}.${args[0] instanceof ArrayBuffer ? "viewBytes" : "ownedBytes"}`, value.byteLength);
        }
        return value;
      },
    });
  }
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const slice = typed.slice;
  typed.slice = function (...args) {
    const result = Reflect.apply(slice, this, args);
    hit("TypedArray.slice.calls"); hit("TypedArray.slice.copiedBytes", result.byteLength);
    return result;
  };
  for (const [proto, name] of [[TextEncoder.prototype, "encode"], [TextDecoder.prototype, "decode"]]) {
    const fn = proto[name];
    proto[name] = function (...args) {
      const result = Reflect.apply(fn, this, args);
      hit(`${name}.calls`); hit(`${name}.utf8Bytes`, name === "encode" ? result.byteLength : args[0]?.byteLength ?? 0);
      return result;
    };
  }
  function wrap(object, name, prefix) {
    const fn = object[name];
    if (typeof fn !== "function") return;
    object[name] = function (...args) {
      hit(`${prefix}.${name}`);
      const value = Reflect.apply(fn, this, args);
      if (prefix === "adapter" && value === undefined) hit(`fallback.${name}`);
      return value;
    };
  }
  const adapter = loader.loadNativeFfi().adapter;
  if (adapter) for (const name of ["querySnapshot", "childSnapshot", "preorderSnapshot", "serialize", "createElements", "readBatch"]) wrap(adapter, name, "adapter");
  for (const name of ["createElementToken", "createElementTokenRange", "createElementTokenBatch", "childNodesTokens", "preorderTokenSnapshot", "materializeNodeToken"]) wrap(native.DocumentHandle.prototype, name, "NodeAPI");
  for (const name of ["querySelectorAllTokens", "querySelectorAll", "innerHTML", "outerHTML"]) wrap(native.NodeHandle.prototype, name, "NodeAPI");
  return {
    start() { counts = {}; active = true; },
    stop() { active = false; return { ...counts }; },
    raw(symbols) { for (const name of Object.keys(symbols)) wrap(symbols, name, "raw"); },
  };
}
