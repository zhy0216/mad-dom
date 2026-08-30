// `MutationObserver` / `MutationRecord` facade extension (T41).
//
// Installs the WHATWG `MutationObserver` surface: the `MutationObserver` class
// reached through `window.MutationObserver`, and the opaque `MutationRecord`
// objects handed to the callback and returned by `takeRecords()`. Every record
// is generated and queued by Core at the unified mutation sources
// (crates/mad-dom-core/src/dom/mutation_observer.rs); this module only shapes
// arguments, runs the option validation, and wires the microtask delivery.
//
// # Delivery: Core queues, the facade schedules the microtask
//
// Core batches records per (observer, target) listener (the happy-dom baseline
// granularity). After every mutating native entry the binding drains the
// newly-pending listeners and calls the *scheduler* registered here — a thin
// `queueMicrotask` wrapper. The microtask calls the native
// `deliverObserverRecords(observerId, observationKey)`, which drains that
// listener's queue (records accumulated in the same task are delivered in one
// callback) and invokes the wrapped callback with the raw record/observer
// handles; the wrapper converts them through the unique `ctx.wrap` entry, so
// callback arguments are facade objects with stable identity.
//
// A throwing callback propagates as an uncaught microtask error (baseline
// parity); each listener is delivered by its own microtask, so one observer's
// throw never cancels another's delivery.
//
// # Option validation (baseline parity)
//
// `observe(target, options)` mirrors the happy-dom checks exactly: an
// `attributeFilter` / `attributeOldValue` without `attributes` auto-enables
// `attributes` (and throws when `attributes` is explicitly false), a
// `characterDataOldValue` without `characterData` behaves likewise, at least
// one of `childList` / `attributes` / `characterData` must be enabled, and the
// filter names are lowercased.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes beyond the
// import and array entry.

import { loadNative } from "../../native-loader.js";

import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/mutation-observer",
  owner: "T41",
  gate: "T41",
  status: "implemented",
});

// Native handle behind each facade observer / record.
const OBSERVER_HANDLES = new WeakMap();
const RECORD_HANDLES = new WeakMap();

// Reverse map: native observer handle → the facade observer that owns it (the
// callback's second argument must be the very object the caller constructed).
const OBSERVER_OWNERS = new WeakMap();

// The `ctx` handed to `install`; captured so the wrapped callback and the
// record accessors can mint facade wrappers.
let ctx = null;

// --- Native binding (T19 / T49) ---------------------------------------------
//
// Shares the unified resolution chain and load-time ABI probe with the entry
// (js/native-loader.js): explicit `MAD_DOM_NATIVE_PATH` → npm platform package
// → repository-local dev artifact (ADR-0005 §6).

// --- handle guards -----------------------------------------------------------

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isMutationObserverHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.observe === "function" &&
    typeof handle.disconnect === "function" &&
    typeof handle.takeRecords === "function"
  );
}

function facadeNodeHandle(value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

// --- delivery scheduler -------------------------------------------------------

let schedulerRegistered = false;

/**
 * Registers the delivery scheduler with the native binding exactly once.
 *
 * Registration is deferred to the first `MutationObserver` construction (not to
 * `install`), so the facade registry can install extensions without a native
 * artifact — the structural tests drive `install` with a mock `ctx`.
 */
function ensureSchedulerRegistered() {
  if (schedulerRegistered) return;
  schedulerRegistered = true;
  loadNative().registerObserverScheduler((observerId, observationKey) => {
    queueMicrotask(() => {
      loadNative().deliverObserverRecords(observerId, observationKey);
    });
  });
}

// --- option validation --------------------------------------------------------

/**
 * Resolves a `MutationObserverInit` to the boolean option set the native
 * binding stores, mirroring the happy-dom baseline checks exactly (including
 * the error messages).
 *
 * @param {object | null | undefined} options the raw `observe` options
 * @returns {{childList: boolean, attributes: boolean, characterData: boolean,
 *            subtree: boolean, attributeOldValue: boolean,
 *            characterDataOldValue: boolean, attributeFilter: string[] | null}}
 */
function resolveObserverOptions(options) {
  const opts = options == null ? {} : options;
  let { childList, attributes, characterData, subtree, attributeOldValue, characterDataOldValue, attributeFilter } = opts;

  if (attributeFilter || attributeOldValue) {
    if (attributes === undefined) {
      attributes = true;
    }
    if (!attributes && attributeOldValue) {
      throw new TypeError(
        "Failed to execute 'observe' on 'MutationObserver': " +
          "The options object may only set 'attributeOldValue' to true when 'attributes' is true or not present.",
      );
    }
    if (!attributes && attributeFilter) {
      throw new TypeError(
        "Failed to execute 'observe' on 'MutationObserver': " +
          "The options object may only set 'attributeFilter' when 'attributes' is true or not present.",
      );
    }
  }
  if (characterDataOldValue) {
    if (characterData === undefined) {
      characterData = true;
    }
    if (!characterData && characterDataOldValue) {
      throw new TypeError(
        "Failed to execute 'observe' on 'MutationObserver': " +
          "The options object may only set 'characterDataOldValue' to true when 'characterData' is true or not present.",
      );
    }
  }
  if (!childList && !attributes && !characterData) {
    throw new TypeError(
      "Failed to execute 'observe' on 'MutationObserver': " +
        "The options object must set at least one of 'attributes', 'characterData', or 'childList' to true.",
    );
  }

  return {
    childList: Boolean(childList),
    attributes: Boolean(attributes),
    characterData: Boolean(characterData),
    subtree: Boolean(subtree),
    attributeOldValue: Boolean(attributeOldValue),
    characterDataOldValue: Boolean(characterDataOldValue),
    attributeFilter: attributeFilter
      ? attributeFilter.map((name) => name.toLowerCase())
      : null,
  };
}

// --- MutationObserver / MutationRecord classes --------------------------------

/**
 * WHATWG `MutationObserver` facade.
 *
 * Construction mints a native observer handle (storing a stable wrapper of the
 * user callback, so the native identity never sees the raw callback). The
 * facade registry's `MutationObserverHandle` factory wraps an existing native
 * handle instead, so the callback's second argument resolves back to the very
 * object the caller constructed.
 */
export class MutationObserver {
  constructor(callbackOrHandle) {
    let handle;
    if (isMutationObserverHandle(callbackOrHandle)) {
      handle = callbackOrHandle;
    } else {
      if (typeof callbackOrHandle !== "function") {
        throw new TypeError(
          "Failed to construct 'MutationObserver': parameter 1 is not of type 'Function'.",
        );
      }
      ensureSchedulerRegistered();
      const userCallback = callbackOrHandle;
      const wrapped = (records, observerHandle) => {
        userCallback(records.map((record) => ctx.wrap(record)), ctx.wrap(observerHandle));
      };
      handle = loadNative().createMutationObserver(wrapped);
      OBSERVER_OWNERS.set(handle, this);
    }
    OBSERVER_HANDLES.set(this, handle);
  }
}

/**
 * WHATWG `MutationRecord` facade: an opaque wrapper over the native record
 * handle. Every read delegates to the native record state and mints node
 * wrappers through `ctx.wrap`; this module keeps no record data of its own.
 */
export class MutationRecord {
  constructor(handle) {
    RECORD_HANDLES.set(this, handle);
  }
}

/**
 * Installs the T41 MutationObserver surface.
 *
 * Registers the two handle types, exposes `window.MutationObserver`, and
 * registers the delivery scheduler that arms the per-listener microtasks.
 */
export function install(extensionCtx) {
  ctx = extensionCtx;
  // The factory resolves a native observer handle back to the facade observer
  // that owns it (the callback's second argument is the caller's own object),
  // falling back to a fresh wrapper only for handles minted outside this
  // module.
  ctx.registerHandleType("MutationObserverHandle", (handle) => {
    return OBSERVER_OWNERS.get(handle) ?? new MutationObserver(handle);
  });
  ctx.registerHandleType("MutationRecordHandle", (handle) => new MutationRecord(handle));
  ctx.defineAccessor(Window.prototype, "MutationObserver", function getMutationObserver() {
    return MutationObserver;
  }, undefined);

  ctx.defineMethod(MutationObserver.prototype, "observe", function observe(target, options) {
    if (target == null) {
      throw new TypeError(
        "Failed to execute 'observe' on 'MutationObserver': The first parameter \"target\" should be of type \"Node\".",
      );
    }
    const targetHandle = facadeNodeHandle(target, "observe");
    const resolved = resolveObserverOptions(options);
    const handle = OBSERVER_HANDLES.get(this);
    handle.observe(
      targetHandle,
      resolved.childList,
      resolved.attributes,
      resolved.characterData,
      resolved.subtree,
      resolved.attributeOldValue,
      resolved.characterDataOldValue,
      resolved.attributeFilter,
    );
  });

  ctx.defineMethod(MutationObserver.prototype, "disconnect", function disconnect() {
    OBSERVER_HANDLES.get(this).disconnect();
  });

  ctx.defineMethod(MutationObserver.prototype, "takeRecords", function takeRecords() {
    return OBSERVER_HANDLES.get(this)
      .takeRecords()
      .map((record) => ctx.wrap(record));
  });

  // MutationRecord surface.
  ctx.defineAccessor(MutationRecord.prototype, "type", function type() {
    return RECORD_HANDLES.get(this).recordType();
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "target", function target() {
    return ctx.wrap(RECORD_HANDLES.get(this).target());
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "addedNodes", function addedNodes() {
    return RECORD_HANDLES.get(this)
      .addedNodes()
      .map((node) => ctx.wrap(node));
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "removedNodes", function removedNodes() {
    return RECORD_HANDLES.get(this)
      .removedNodes()
      .map((node) => ctx.wrap(node));
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "previousSibling", function previousSibling() {
    return ctx.wrap(RECORD_HANDLES.get(this).previousSibling());
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "nextSibling", function nextSibling() {
    return ctx.wrap(RECORD_HANDLES.get(this).nextSibling());
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "attributeName", function attributeName() {
    return RECORD_HANDLES.get(this).attributeName();
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "attributeNamespace", function attributeNamespace() {
    return RECORD_HANDLES.get(this).attributeNamespace();
  }, undefined);

  ctx.defineAccessor(MutationRecord.prototype, "oldValue", function oldValue() {
    return RECORD_HANDLES.get(this).oldValue();
  }, undefined);
}
