// `Window` facade base module (T22B).
//
// The facade is a thin wrapper over the native binding
// (crates/mad-dom-bun, T19/T22A): it does argument shaping, wraps opaque
// native handles into facade objects and forwards lifecycle calls. It keeps
// **no second DOM state** — the Rust arena is the only authoritative tree and
// generation-guarded derived caches never become an independent source of
// DOM truth.
//
// # The wrapper conversion family
//
// Facade wrappers are produced by `ctx.wrap` for native handles,
// `ctx.wrapLazyNode` for general document tokens, or the creation-only
// `ctx.wrapFreshTextNode` specialization. Native handles use the original
// WeakMap cache; all node routes converge through a per-document token map, so
// lazy and materialized routes return one facade object. The document-state
// island is reachable through a weak key and does not keep an otherwise
// unreachable document alive.
//
// # Handle-type registration
//
// `WindowHandle` → `Window` and `DocumentHandle` → `Document` are registered
// here at module init. Capability extensions register their own wrapper types
// (e.g. `NodeHandle` → `Node`, T23B) during their `install(ctx)` through
// `ctx.registerHandleType`, so a later subtask adds a wrapper type purely in
// its own extension file.
//
// # The `ctx` given to extensions
//
// js/facade/window.js builds the context and hands it to the facade registry
// (extensions/index.js) exactly once at facade initialization:
//
//   - `ctx.wrap(nativeHandle)` / `ctx.wrapLazyNode(...)` /
//     `ctx.wrapFreshTextNode(...)` — the conversion family above;
//   - `ctx.defineMethod(target, name, fn, descriptor)` /
//     `ctx.defineAccessor(target, name, get, set, descriptor)` — the only
//     sanctioned property-definition helpers for extension installers;
//   - `ctx.documentContext` — frozen, read-only access to the document
//     ownership reference a wrapper carries (`handleOf(wrapper)`); the native
//     handle is opaque; optional document-scoped tokens cross as primitive
//     values, while a Core `NodeId` never leaves the binding;
//   - `ctx.registerHandleType(name, makeWrapper)` — wrapper-type registry.
//
// The `seam` metadata below is flipped to `"implemented"` by the T22 gate;
// tests/bun/seam.test.js pins that shape.

import { windowTasks } from "./window-tasks.js";
import { createBrowserSettings } from "./browser-settings.js";
import { loadNative } from "../native-loader.js";

import { Document } from "./document.js";
import {
  createFreshLazyTextWrapper,
  createLazyNodeWrapper,
  nodeHandleOf,
  nodeInternalsOf,
  releaseNodeDocumentState,
  setNodeDocumentState,
  setNodeHandle,
} from "./extensions/classes.js";
import { installExtensions } from "./extensions/index.js";

// Keep facade-private registries private even if application code later
// replaces Map/WeakMap prototype methods in the same realm.
const MapConstructor = Map;
const SetConstructor = Set;
const Int32ArrayConstructor = Int32Array;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get);
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set);
const mapClear = Function.prototype.call.bind(Map.prototype.clear);
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapHas = Function.prototype.call.bind(Map.prototype.has);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
const setAdd = Function.prototype.call.bind(Set.prototype.add);
const setClear = Function.prototype.call.bind(Set.prototype.clear);
const bindFunction = Function.prototype.call.bind(Function.prototype.bind);
const functionCall = Function.prototype.call;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectCreate = Object.create;

// Optional native performance entries are additive across platform-package
// versions. Resolve only direct prototype data methods: an application-owned
// Object.prototype property must never masquerade as a capability on an older
// binding. Tables are built once per document (and lazily once for NodeHandle)
// so the hot path does not repeat descriptor inspection.
function ownNativeMethod(prototype, name) {
  const descriptor = prototype === null
    ? undefined
    : objectGetOwnPropertyDescriptor(prototype, name);
  return descriptor !== undefined &&
      objectHasOwn(descriptor, "value") &&
      typeof descriptor.value === "function"
    ? descriptor.value
    : undefined;
}

function ownNativeStamp(handle, name) {
  const descriptor = objectGetOwnPropertyDescriptor(handle, name);
  return descriptor !== undefined && objectHasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function boundNativeMethod(prototype, name, receiver) {
  const method = ownNativeMethod(prototype, name);
  return method === undefined ? undefined : bindFunction(method, receiver);
}

function nativeMethodInvoker(prototype, name) {
  const method = ownNativeMethod(prototype, name);
  return method === undefined ? undefined : bindFunction(functionCall, method);
}

function documentNativeMethodsOf(handle) {
  const prototype = objectGetPrototypeOf(handle);
  return {
    epochView: boundNativeMethod(prototype, "epochView", handle),
    attributeEpochView: boundNativeMethod(prototype, "attributeEpochView", handle),
    facadeEpochView: boundNativeMethod(prototype, "facadeEpochView", handle),
    facadeAttributeEpochView: boundNativeMethod(
      prototype,
      "facadeAttributeEpochView",
      handle,
    ),
    createElementToken: boundNativeMethod(prototype, "createElementToken", handle),
    createElementTokenBatch: boundNativeMethod(
      prototype,
      "createElementTokenBatch",
      handle,
    ),
    createElementTokenRange: boundNativeMethod(
      prototype,
      "createElementTokenRange",
      handle,
    ),
    createTextToken: boundNativeMethod(prototype, "createTextToken", handle),
    matchesToken: boundNativeMethod(prototype, "matchesToken", handle),
    textContentToken: boundNativeMethod(prototype, "textContentToken", handle),
    childNodesTokens: boundNativeMethod(prototype, "childNodesTokens", handle),
    materializeNodeToken: boundNativeMethod(prototype, "materializeNodeToken", handle),
    nodeToken: boundNativeMethod(prototype, "nodeToken", handle),
    setAttributeToken: boundNativeMethod(prototype, "setAttributeToken", handle),
    setAttributeTokenLocal: boundNativeMethod(
      prototype,
      "setAttributeTokenLocal",
      handle,
    ),
    appendChildToken: boundNativeMethod(prototype, "appendChildToken", handle),
    appendChildTokenLocal: boundNativeMethod(
      prototype,
      "appendChildTokenLocal",
      handle,
    ),
    preorderTokenSnapshot: boundNativeMethod(
      prototype,
      "preorderTokenSnapshot",
      handle,
    ),
    countElementsByTagName: boundNativeMethod(
      prototype,
      "countElementsByTagName",
      handle,
    ),
    countElementsByClassName: boundNativeMethod(
      prototype,
      "countElementsByClassName",
      handle,
    ),
  };
}

function nodeNativeMethodsOf(handle) {
  const prototype = objectGetPrototypeOf(handle);
  return {
    firstChildPair: nativeMethodInvoker(prototype, "firstChildPair"),
    nextSiblingChunk: nativeMethodInvoker(prototype, "nextSiblingChunk"),
    querySelectorAllTokens: nativeMethodInvoker(prototype, "querySelectorAllTokens"),
    idAttribute: nativeMethodInvoker(prototype, "idAttribute"),
    classAttribute: nativeMethodInvoker(prototype, "classAttribute"),
    idClassAttributes: nativeMethodInvoker(prototype, "idClassAttributes"),
    countElementsByTagName: nativeMethodInvoker(prototype, "countElementsByTagName"),
    countElementsByClassName: nativeMethodInvoker(prototype, "countElementsByClassName"),
  };
}

export const seam = Object.freeze({
  id: "facade/window",
  owner: "T22B",
  gate: "T22",
  status: "implemented",
});

// --- Native binding (T19 / T49) --------------------------------------------
//
// Shares the unified resolution chain and load-time ABI probe with the entry
// (js/native-loader.js): explicit `MAD_DOM_NATIVE_PATH` → npm platform package
// → repository-local dev artifact. Loading is lazy but fail-fast on first use
// with a stable `MAD_DOM_UNSUPPORTED_PLATFORM` / `MAD_DOM_ABI_MISMATCH` /
// `MAD_DOM_NATIVE_NOT_FOUND` error (ADR-0005 §6, §8, §9).

// --- Native-handle conversion and token identity convergence --------------

// Native handle behind each facade wrapper (reverse of the wrap cache below).
// Used by `ctx.documentContext.handleOf` so extensions can read the document
// ownership reference a wrapper carries without touching private fields.
const WRAPPER_TO_HANDLE = new WeakMap();
const getWrapperHandle = WRAPPER_TO_HANDLE.get.bind(WRAPPER_TO_HANDLE);
const setWrapperHandle = WRAPPER_TO_HANDLE.set.bind(WRAPPER_TO_HANDLE);

// Facade wrapper cache: native handle → facade wrapper. Weak on the native
// handle, so a facade wrapper never keeps its document alive; identity simply
// mirrors the native per-document weak cache (T20).
const WRAP_CACHE = new WeakMap();
const getCachedWrapper = WRAP_CACHE.get.bind(WRAP_CACHE);
const setCachedWrapper = WRAP_CACHE.set.bind(WRAP_CACHE);

// Native handle type → facade wrapper factory, keyed by the native class name
// (`WindowHandle`, `DocumentHandle`, …). Extensions add entries through
// `ctx.registerHandleType`.
const HANDLE_TYPES = new Map();

// --- Per-document facade state + wrapper pinning -------------------------
//
// Each facade-wrapped document owns a state object:
//
//   epoch — an `Int32Array` over a JS-owned structural-generation buffer
//           subscribed through `DocumentHandle.epochView()`: the binding
//           updates live attached buffers after every call that changed tree
//           relations, so navigation getters can validate memoized reads with
//           a plain typed-array load — no FFI. `null` on older bindings, where
//           the memo stays off and every read crosses into native as before.
//
//   pinned — legacy-binding fallback set for wrappers whose native handles do
//           not carry document tokens. Current bindings retain canonical
//           wrappers in `wrappersByToken` below instead.
//
//   wrappersByToken — canonical facade identity for every document-scoped
//           primitive token, grouped into chunks of 256 consecutive tokens.
//           It also keeps navigation memos alive while the document is
//           reachable. A later handle materialization converges on the same
//           wrapper rather than minting a duplicate facade object.
const DOC_STATES = new WeakMap();
const getDocState = DOC_STATES.get.bind(DOC_STATES);
const setDocState = DOC_STATES.set.bind(DOC_STATES);

function docStateOf(docHandle) {
  let state = getDocState(docHandle);
  if (state === undefined) {
    const elementTokenPools = new MapConstructor();
    const wrappersByToken = new MapConstructor();
    // Tokens usually arrive consecutively during creation and hydration.
    // A chunk turns those registrations into indexed writes instead of one
    // hash insertion per wrapper, while the outer Map handles sparse global
    // tokens from interleaved documents without allocating their gaps. Null
    // prototypes keep missing numeric entries immune to application-owned
    // Object/Array prototype properties.
    let wrapperChunkIndex = -1;
    let wrapperChunk;
    function getWrapperByToken(token) {
      const index = token >>> 8;
      if (index !== wrapperChunkIndex) {
        wrapperChunk = mapGet(wrappersByToken, index);
        wrapperChunkIndex = index;
      }
      return wrapperChunk === undefined ? undefined : wrapperChunk[token & 255];
    }
    function setWrapperByToken(token, wrapper) {
      const index = token >>> 8;
      if (index !== wrapperChunkIndex) {
        wrapperChunk = mapGet(wrappersByToken, index);
        wrapperChunkIndex = index;
      }
      if (wrapperChunk === undefined) {
        wrapperChunk = objectCreate(null);
        mapSet(wrappersByToken, index, wrapperChunk);
      }
      wrapperChunk[token & 255] = wrapper;
    }
    const pinned = new SetConstructor();
    const nativeMethods = documentNativeMethodsOf(docHandle);
    let nodeNativeMethods = null;
    state = {
      documentHandle: docHandle,
      attributeEpoch: null,
      clearElementTokenPools: () => mapClear(elementTokenPools),
      clearPinned: () => setClear(pinned),
      clearWrappersByToken: () => {
        mapClear(wrappersByToken);
        wrapperChunkIndex = -1;
        wrapperChunk = undefined;
      },
      getElementTokenPool: (name) => mapGet(elementTokenPools, name),
      getWrapperByToken,
      epoch: null,
      nativeMethods,
      nodeNativeMethodsOf: (handle) => {
        nodeNativeMethods ??= nodeNativeMethodsOf(handle);
        return nodeNativeMethods;
      },
      pinLegacyWrapper: (wrapper) => setAdd(pinned, wrapper),
      // Materialization bypasses wrap(), so converge its reverse caches here
      // too. Stored native references must still resolve to this wrapper after
      // destroy clears the document's token table.
      registerMaterializedWrapper: registerWrap,
      setElementTokenPool: (name, pool) => mapSet(elementTokenPools, name, pool),
      setWrapperByToken,
      snapshotAttemptEpoch: null,
      snapshotPartitionRoots: null,
      destroyed: false,
    };
    try {
      const epochView = nativeMethods.facadeEpochView ?? nativeMethods.epochView;
      if (epochView !== undefined) {
        state.epoch = new Int32ArrayConstructor(epochView());
      }
    } catch {
      // Older native bindings without the epoch surface: the navigation memo
      // stays disabled, every read crosses into native as before.
    }
    try {
      const attributeEpochView =
        nativeMethods.facadeAttributeEpochView ?? nativeMethods.attributeEpochView;
      if (attributeEpochView !== undefined) {
        state.attributeEpoch = new Int32ArrayConstructor(
          attributeEpochView(),
        );
      }
    } catch {
      // Mixed-version fallback: attribute reads remain direct native calls.
    }
    setDocState(docHandle, state);
  }
  return state;
}

// Pins a node wrapper in its document's state (see `DOC_STATES`). `docState`
// is passed by callers that already know the wrapper's document (navigation
// getters, the custom-element mint path); resolving it from the handle costs
// an `ownerDocument()` crossing and only happens on a cold mint.
function pinWrapper(nativeHandle, wrapper, docState, resolvedToken) {
  const state = docState ?? docStateOf(nativeHandle.ownerDocument());
  const token = resolvedToken ?? ownNativeStamp(nativeHandle, "madDomToken");
  setNodeDocumentState(wrapper, state);
  const internals = nodeInternalsOf(wrapper);
  internals.validEpoch = state.epoch === null ? null : state.epoch[0];
  if (token !== undefined) {
    internals.token = token;
    state.setWrapperByToken(token, wrapper);
  } else {
    // Mixed-version fallback: an older native binding has no primitive token,
    // so retain the wrapper in the legacy set.
    state.pinLegacyWrapper(wrapper);
  }
}

function registerHandleType(constructorName, makeWrapper) {
  if (typeof constructorName !== "string" || constructorName.length === 0) {
    throw new TypeError("registerHandleType requires a non-empty constructor name");
  }
  if (typeof makeWrapper !== "function") {
    throw new TypeError("registerHandleType requires a wrapper factory function");
  }
  if (mapHas(HANDLE_TYPES, constructorName)) {
    throw new Error(`mad-dom facade: handle type "${constructorName}" is already registered`);
  }
  mapSet(HANDLE_TYPES, constructorName, makeWrapper);
}

// `docState` (optional, node wrappers only): the already-resolved per-
// document state of the wrapper's owning document; navigation getters pass
// their own so a mint never pays an extra `ownerDocument()` crossing.
// `freshNode` is reserved for native creation methods whose returned
// NodeHandle has never crossed into JavaScript before. That proof lets the
// same conversion entry skip an impossible cache hit and constructor-name
// reflection while preserving all cache registration and pinning below.
function wrap(nativeHandle, docState, freshNode = false) {
  if (nativeHandle === null || nativeHandle === undefined) return nativeHandle;
  if (!freshNode) {
    const cached = getCachedWrapper(nativeHandle);
    if (cached) return cached;
  }
  const typeName = freshNode ? "NodeHandle" : nativeHandle.constructor?.name;
  let nodeToken;
  if (typeName === "NodeHandle") {
    const state = docState ?? docStateOf(nativeHandle.ownerDocument());
    nodeToken = ownNativeStamp(nativeHandle, "madDomToken");
    // A raw NodeHandle may predate the facade's epochView call that enables
    // token stamping. Resolve that one legacy handle explicitly so snapshots,
    // later queries and the raw wrapper all converge on one facade identity.
    const nodeTokenMethod = state.nativeMethods.nodeToken;
    if (nodeToken === undefined && nodeTokenMethod !== undefined) {
      nodeToken = nodeTokenMethod(nativeHandle);
    }
    const existing = nodeToken === undefined
      ? undefined
      : state.getWrapperByToken(nodeToken);
    if (existing !== undefined) {
      setNodeHandle(existing, nativeHandle);
      nodeInternalsOf(existing).validEpoch =
        state.epoch === null ? null : state.epoch[0];
      setCachedWrapper(nativeHandle, existing);
      setWrapperHandle(existing, nativeHandle);
      return existing;
    }
    docState = state;
  }
  const makeWrapper = mapGet(HANDLE_TYPES, typeName);
  if (typeof makeWrapper !== "function") {
    throw new TypeError(
      `mad-dom facade: no wrapper registered for native handle type "${
        typeName ?? "(unknown)"
      }"`,
    );
  }
  const wrapper = makeWrapper(nativeHandle);
  setCachedWrapper(nativeHandle, wrapper);
  setWrapperHandle(wrapper, nativeHandle);
  if (typeName === "NodeHandle") {
    pinWrapper(nativeHandle, wrapper, docState, nodeToken);
  } else if (typeName === "DocumentHandle") {
    setNodeDocumentState(wrapper, docStateOf(nativeHandle));
  }
  return wrapper;
}

// Primitive-token counterpart to `wrap`. No Node-API class object exists yet:
// immutable classification arrives from the creation/snapshot call and every
// other piece of state remains in Core. A later unsupported operation
// materializes the canonical native handle via `nodeHandleOf`, while
// token-based hot operations stay allocation-free. Fresh creation calls pass
// `knownFresh`; snapshot calls may carry the equivalent native proof bit, so
// neither pays an impossible identity-map probe.
function wrapLazyNode(
  documentHandle,
  token,
  nodeType,
  name,
  namespace,
  docState,
  initialMemo,
  validEpoch,
  snapshotDescriptor,
  knownFresh = false,
) {
  const state = docState ?? docStateOf(documentHandle);
  const currentEpoch = validEpoch ?? (state.epoch === null ? null : state.epoch[0]);
  // A newly created token, or one marked fresh by the current native
  // snapshot, has never crossed into JavaScript and therefore cannot already
  // have a canonical facade wrapper; every older/pre-exposed token probes.
  const existing = knownFresh ? undefined : state.getWrapperByToken(token);
  if (existing !== undefined) {
    const internals = nodeInternalsOf(existing);
    internals.validEpoch = currentEpoch;
    if (initialMemo !== undefined) internals.memo = initialMemo;
    return existing;
  }
  const wrapper = createLazyNodeWrapper(
    nodeType,
    name,
    namespace,
    state,
    token,
    currentEpoch,
    initialMemo,
    snapshotDescriptor,
  );
  state.setWrapperByToken(token, wrapper);
  return wrapper;
}

// Creation-only specialization of the primitive-token conversion path. The
// native call proves this is a fresh Text node, so no identity probe or generic
// kind dispatch is needed; canonical registration still uses the same
// document token table consumed by `wrap` and `wrapLazyNode`.
function wrapFreshTextNode(state, token, validEpoch) {
  const wrapper = createFreshLazyTextWrapper(state, token, validEpoch);
  state.setWrapperByToken(token, wrapper);
  return wrapper;
}

// Registers a wrapper that was constructed outside `wrap` (the T48A
// `new DefinedClass()` mint path) in the same two caches, so a later `wrap`
// of the same native handle hands back that exact object. `docHandle` (the
// private mint record's native document handle) resolves the pin target
// without an extra crossing.
function registerWrap(nativeHandle, wrapper, docHandle) {
  if (nativeHandle === null || nativeHandle === undefined) return;
  setCachedWrapper(nativeHandle, wrapper);
  setWrapperHandle(wrapper, nativeHandle);
  if (docHandle !== undefined) {
    pinWrapper(nativeHandle, wrapper, docStateOf(docHandle));
  }
}

// --- Descriptor helpers ---------------------------------------------------

function defineMethod(target, name, fn, descriptor = {}) {
  Object.defineProperty(target, name, {
    value: fn,
    writable: descriptor.writable ?? false,
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
  });
}

function defineAccessor(target, name, get, set, descriptor = {}) {
  Object.defineProperty(target, name, {
    get,
    set,
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
  });
}

// --- The extension context ------------------------------------------------

const documentContext = Object.freeze({
  // Read-only access to the document ownership reference a wrapper carries.
  // The returned native handle is opaque — a Core `NodeId` never crosses this
  // seam as a primitive value (CONTRACT.md / native-window-document contract).
  handleOf(wrapper) {
    const handle = getWrapperHandle(wrapper);
    if (handle !== undefined) return handle;
    const internals = nodeInternalsOf(wrapper);
    if (internals !== undefined) {
      const state = internals.documentState;
      const token = internals.token;
      if (
        token !== undefined &&
        (state?.destroyed === true || state?.getWrapperByToken(token) === wrapper)
      ) {
        return nodeHandleOf(wrapper) ?? null;
      }
    }
    return null;
  },
  tokenOf(wrapper) {
    const internals = nodeInternalsOf(wrapper);
    if (internals === undefined) return undefined;
    const state = internals.documentState;
    const token = internals.token;
    return token !== undefined &&
      (state?.destroyed === true || state?.getWrapperByToken(token) === wrapper)
      ? token
      : undefined;
  },
  nodeDocumentOf(wrapper) {
    const internals = nodeInternalsOf(wrapper);
    if (internals === undefined) return undefined;
    const state = internals.documentState;
    const token = internals.token;
    return token !== undefined &&
      (state?.destroyed === true || state?.getWrapperByToken(token) === wrapper)
      ? state.documentHandle
      : undefined;
  },
});

const ctx = Object.freeze({
  wrap,
  wrapFreshTextNode,
  wrapLazyNode,
  defineMethod,
  defineAccessor,
  documentContext,
  registerHandleType,
  registerWrap,
  // Per-document facade state resolver (see `DOC_STATES`): mint-heavy facade
  // paths pass the result into `wrap` so a fresh wrapper is pinned without an
  // extra `ownerDocument()` crossing.
  docStateOf,
  windowFacadeOfDocument,
  windowSettings,
  windowOptions,
  setWindowViewport,
});

// --- `Window` facade -------------------------------------------------------

function isWindowHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.document === "function" &&
    typeof handle.destroy === "function"
  );
}

// Native handle behind each Window facade (the document's ownership lives in
// the native window handle itself).
const WIN_HANDLES = new WeakMap();
const WIN_DOCUMENT_HANDLES = new WeakMap();

// Per-window viewport state (happy-dom Window constructor parity: `width` /
// `height` options (and the deprecated `innerWidth` / `innerHeight` aliases)
// take precedence over the `settings.viewport` browser setting, which itself
// falls back to the happy-dom default 1024×768 at devicePixelRatio 1). Keyed
// by the Window facade so the `innerWidth` / `outerWidth` / `devicePixelRatio`
// accessors and the media-query evaluation all read one consistent value.
const WINDOW_VIEWPORTS = new WeakMap();

// Per-window happy-dom settings kept by the Window facade for the surfaces
// that need them at runtime (`matchMedia` device settings and computed-style
// rendering toggle). Only the fields consumed by the facade are kept; the rest
// of the happy-dom settings surface is handled by the `Browser` settings when a
// window is created through a browser frame.
const WINDOW_SETTINGS = new WeakMap();

// The raw happy-dom constructor options object per window (`new Window(options)`
// hands a plain object literal; the native-handle path keeps an empty object).
// Extension surfaces resolve their constructor-time inputs lazily through
// `ctx.windowOptions` — the `console` option (window-platform.js) and the
// `settings` merged into `window.happyDOM.settings` live here, so the facade
// classes never re-read the options object themselves.
const WINDOW_OPTIONS = new WeakMap();

function computeWindowSettings(options) {
  const given = options?.settings ?? {};
  return {
    device: {
      prefersColorScheme: given.device?.prefersColorScheme ?? "light",
      prefersReducedMotion: given.device?.prefersReducedMotion ?? "no-preference",
      mediaType: given.device?.mediaType ?? "screen",
      forcedColors: given.device?.forcedColors ?? "none",
    },
    disableComputedStyleRendering: given.disableComputedStyleRendering ?? false,
    // The fetch settings a detached window carries for the browser surface: a
    // `window.open` child navigation resolves its virtual servers against the
    // opening window's settings (happy-dom WindowPageOpenUtility parity).
    fetch: {
      virtualServers: given.fetch?.virtualServers ?? null,
    },
  };
}

// Per-window settings accessor exposed through the facade `ctx` for the
// extension installers (the happy-dom device defaults: prefers-color-scheme
// light, prefers-reduced-motion no-preference, media type screen, forced-colors
// none). Not part of the module export surface — the public `window.js` shape
// is pinned by the T22B export test.
function windowSettings(windowFacade) {
  return windowFacade.happyDOM?.settings ?? weakMapGet(WINDOW_SETTINGS, windowFacade) ?? computeWindowSettings({});
}

// Per-window constructor options accessor exposed through the facade `ctx` for
// the extension installers (the `console` / `settings` options). Returns the
// exact options object the window was constructed with, or an empty object for
// the native-handle construction path.
function windowOptions(windowFacade) {
  return weakMapGet(WINDOW_OPTIONS, windowFacade) ?? {};
}

function computeViewport(options) {
  const viewportSetting = options?.settings?.viewport ?? {};
  return {
    width: options?.width ?? options?.innerWidth ?? viewportSetting.width ?? 1024,
    height: options?.height ?? options?.innerHeight ?? viewportSetting.height ?? 768,
    devicePixelRatio: viewportSetting.devicePixelRatio ?? 1,
  };
}

// Document facade → owning Window facade, held as a WeakRef value. A document
// has no native back-pointer to its window, so the `document` accessor keeps
// this reverse mapping for the document-side surface (document.write, script
// evaluation) to reach `eval` / the window error dispatch. The value is a
// WeakRef so the map never forms the strong cycle
// window → native handle → document → window (which Bun's GC would fail to
// reclaim in the lifecycle test); a collected window simply derefs to
// undefined.
const DOC_TO_WINDOW = new WeakMap();

// Reverse lookup for the document-side surface (document.write, script
// evaluation). The value is a WeakRef so the map never forms the strong cycle
// window → native handle → document → window (which Bun's GC would fail to
// reclaim in the lifecycle test); a collected window simply derefs to
// undefined.
function windowFacadeOfDocument(documentFacade) {
  return weakMapGet(DOC_TO_WINDOW, documentFacade)?.deref();
}

/**
 * Facade wrapper for a native `WindowHandle`.
 *
 * T48 makes `Window` user-constructible like happy-dom: `new Window()` (or
 * `new Window(options)`) mints a fresh native window through the same lazy
 * loader `createWindow()` uses, so the happy-dom constructor shape works from
 * user code. Passing a genuine native window handle (the internal `wrap`
 * path) uses that handle directly. Anything else — `null`, a plain value, or a
 * wrong native handle such as a `DocumentHandle` — throws a `TypeError`, so
 * no facade surface can fabricate a window from a non-window.
 */
export class Window {
  constructor(nativeHandle) {
    let options = null;
    if (nativeHandle === undefined) {
      options = {};
      nativeHandle = loadNative().createWindow();
    } else if (
      nativeHandle !== null &&
      typeof nativeHandle === "object" &&
      nativeHandle.constructor === Object
    ) {
      // A plain object literal is a happy-dom-style options object (native
      // handles carry a real constructor class, so a wrong native handle —
      // e.g. a DocumentHandle — never matches here and keeps throwing below).
      options = nativeHandle;
      if (options.settings) createBrowserSettings(options.settings);
      nativeHandle = loadNative().createWindow();
    }
    if (!isWindowHandle(nativeHandle)) {
      throw new TypeError(
        "Window can only be constructed from a genuine native Window handle (as returned by createWindow)",
      );
    }
    weakMapSet(WIN_HANDLES, this, nativeHandle);
    weakMapSet(WINDOW_OPTIONS, this, options ?? {});
    weakMapSet(WINDOW_VIEWPORTS, this, computeViewport(options));
    weakMapSet(WINDOW_SETTINGS, this, computeWindowSettings(options));
    // happy-dom constructor options: honor `url` by simulating the initial
    // navigation (the T45 simulated location), so `new Window({ url })`
    // matches `new Window()` plus a synchronous navigation to that URL.
    if (options !== null && typeof options.url === "string") {
      this.location.href = options.url;
    }
  }
}

// `document` is a live accessor: each read forwards to the native handle and
// the result goes through the canonical native-handle conversion entry, so
// repeated reads hand back one and the same Document facade (native identity
// + facade cache).
defineAccessor(Window.prototype, "document", function getDocument() {
  const documentHandle = weakMapGet(WIN_HANDLES, this).document();
  weakMapSet(WIN_DOCUMENT_HANDLES, this, documentHandle);
  const documentFacade = wrap(documentHandle);
  weakMapSet(DOC_TO_WINDOW, documentFacade, new WeakRef(this));
  return documentFacade;
}, undefined);

defineAccessor(Window.prototype, "closed", function closed() {
  return windowTasks(this).closed;
}, undefined);

// Window viewport surface (happy-dom parity): the four viewport dimensions and
// the device scale factor read the per-window viewport state set from the
// constructor options (T22B viewport). `outerWidth` / `outerHeight` mirror the
// happy-dom window surface where the outer size equals the viewport size.
function windowViewport(windowFacade) {
  const viewport = weakMapGet(WINDOW_VIEWPORTS, windowFacade);
  return viewport ?? { width: 1024, height: 768, devicePixelRatio: 1 };
}

// Updates the per-window viewport state in place (happy-dom
// `BrowserPage.setViewport` parity: `Object.assign(this.viewport, viewport)`).
// The viewport dimensions, the device pixel ratio and every media-query
// evaluation read through `windowViewport`, so a single in-place mutation keeps
// the whole window surface consistent. Exposed through the facade `ctx` for
// the `window.happyDOM` detached-window API (window-platform.js); the public
// `window.js` export shape is pinned by the T22B export test.
function setWindowViewport(windowFacade, viewport) {
  let current = weakMapGet(WINDOW_VIEWPORTS, windowFacade);
  if (current === undefined) {
    current = { width: 1024, height: 768, devicePixelRatio: 1 };
    weakMapSet(WINDOW_VIEWPORTS, windowFacade, current);
  }
  Object.assign(current, viewport);
}

defineAccessor(Window.prototype, "innerWidth", function innerWidth() {
  return windowViewport(this).width;
}, undefined);

defineAccessor(Window.prototype, "innerHeight", function innerHeight() {
  return windowViewport(this).height;
}, undefined);

defineAccessor(Window.prototype, "outerWidth", function outerWidth() {
  return windowViewport(this).width;
}, undefined);

defineAccessor(Window.prototype, "outerHeight", function outerHeight() {
  return windowViewport(this).height;
}, undefined);

defineAccessor(Window.prototype, "devicePixelRatio", function devicePixelRatio() {
  return windowViewport(this).devicePixelRatio;
}, undefined);

defineMethod(Window.prototype, "destroy", function destroy() {
  const windowHandle = weakMapGet(WIN_HANDLES, this);
  const documentHandle = weakMapGet(WIN_DOCUMENT_HANDLES, this);
  windowTasks(this).abort(true);
  windowHandle.destroy();
  if (documentHandle !== undefined) {
    releaseNodeDocumentState(getDocState(documentHandle));
  }
});

// --- Facade entry ----------------------------------------------------------

/**
 * Compatibility alias for `new Window()`.
 *
 * The native binding mints the window + document pair and hands back an opaque
 * `WindowHandle`; the historical MAD DOM entry routed it through `ctx.wrap`,
 * the single native handle → facade wrapper conversion entry. Since T48
 * `new Window()` / `new Window(options)` construct the same way through the
 * constructor's mint path, and since T48E the **package entry** (js/entry.js,
 * index.d.ts) no longer exports `createWindow` — happy-dom does not expose it
 * either, so the entry shapes match. This function is kept here as an internal
 * compatibility alias only, for the facade layer and its tests.
 */
export function createWindow() {
  return wrap(loadNative().createWindow());
}

// --- Facade initialization -------------------------------------------------

registerHandleType("WindowHandle", (handle) => new Window(handle));
registerHandleType("DocumentHandle", (handle) => new Document(handle));

// Wire every capability extension exactly once at facade initialization. The
// registry imports the extension files itself, so a later subtask only needs
// to add an `install` export to its own file — never to this module.
installExtensions(ctx);
