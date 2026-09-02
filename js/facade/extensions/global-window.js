// `GlobalWindow` facade module (happy-dom `GlobalWindow` parity).
//
// happy-dom ships two window flavors: the sandboxed `Window`, whose scripts
// run in a per-window `node:vm` context with the window surface as the global
// object, and `GlobalWindow`, which runs scripts in the **host** global
// context. `GlobalWindow` extends `Window` and overrides two internals:
//
//   - the script evaluator becomes the host `eval` (happy-dom keeps
//     `eval = globalThis.eval` as an instance member, so every script —
//     `window.eval(code)` and the `<script>` elements a `document.write`
//     evaluates — runs as an indirect host eval: `globalThis` writes land at
//     process level and `document` / `window` resolution stays the host's);
//   - the VM-context setup is skipped, and the host intrinsics are mirrored
//     onto the window as instance members instead of the vm context's own
//     intrinsics (happy-dom copies `Array` / `Object` / `Promise` / … from
//     `globalThis`), so `globalWindow.Array === global.Array` reads `true`
//     while a sandboxed `Window` mints its own intrinsics and reads `false`.
//
// The mad-dom `Window` facade keeps its sandboxed `node:vm` evaluator on
// `Window.prototype.eval` (T47); `GlobalWindow` shadows it with the host
// `eval` exactly like the baseline, which also routes the document-write
// script path through the host global scope (the facade evaluates parsed
// `<script>` elements through `windowFacade.eval`).
//
// This module is not a facade `install(ctx)` extension — it defines the
// exported `GlobalWindow` class the package entry re-exports, the same shape
// as virtual-console.js.

import { Window } from "../window.js";

/**
 * Browser window that runs scripts in the host global context (happy-dom
 * `GlobalWindow` parity).
 *
 * Like the baseline, the host intrinsics and global functions are mirrored as
 * instance members (they shadow anything the `Window` prototype carries), the
 * `eval` member is the host `eval` itself, and `global` reads the host
 * `globalThis`. Construction accepts the same options as `Window`
 * (`new GlobalWindow()` / `new GlobalWindow(options)`).
 */
export class GlobalWindow extends Window {
  // Node.js Globals (happy-dom GlobalWindow instance members).
  Array = globalThis.Array;
  ArrayBuffer = globalThis.ArrayBuffer;
  Boolean = globalThis.Boolean;
  Buffer = globalThis.Buffer;
  DataView = globalThis.DataView;
  Date = globalThis.Date;
  Error = globalThis.Error;
  EvalError = globalThis.EvalError;
  Float32Array = globalThis.Float32Array;
  Float64Array = globalThis.Float64Array;
  Function = globalThis.Function;
  Infinity = globalThis.Infinity;
  Int16Array = globalThis.Int16Array;
  Int32Array = globalThis.Int32Array;
  Int8Array = globalThis.Int8Array;
  Intl = globalThis.Intl;
  JSON = globalThis.JSON;
  Map = globalThis.Map;
  Math = globalThis.Math;
  NaN = globalThis.NaN;
  Number = globalThis.Number;
  Object = globalThis.Object;
  Promise = globalThis.Promise;
  RangeError = globalThis.RangeError;
  ReferenceError = globalThis.ReferenceError;
  RegExp = globalThis.RegExp;
  Set = globalThis.Set;
  String = globalThis.String;
  Symbol = globalThis.Symbol;
  SyntaxError = globalThis.SyntaxError;
  TypeError = globalThis.TypeError;
  URIError = globalThis.URIError;
  Uint16Array = globalThis.Uint16Array;
  Uint32Array = globalThis.Uint32Array;
  Uint8Array = globalThis.Uint8Array;
  Uint8ClampedArray = globalThis.Uint8ClampedArray;
  WeakMap = globalThis.WeakMap;
  WeakSet = globalThis.WeakSet;
  decodeURI = globalThis.decodeURI;
  decodeURIComponent = globalThis.decodeURIComponent;
  encodeURI = globalThis.encodeURI;
  encodeURIComponent = globalThis.encodeURIComponent;
  eval = globalThis.eval;
  /**
   * @deprecated
   */
  escape = globalThis.escape;
  global = globalThis;
  isFinite = globalThis.isFinite;
  isNaN = globalThis.isNaN;
  parseFloat = globalThis.parseFloat;
  parseInt = globalThis.parseInt;
  undefined = globalThis.undefined;
  /**
   * @deprecated
   */
  unescape = globalThis.unescape;
}
