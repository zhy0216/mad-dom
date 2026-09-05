// `Node` facade plus node creation and navigation extension (T23B).
//
// The first capability extension to take over its T20A placeholder seam. It
// implements the frozen native node contract
// (tests/bun/fixtures/native-node-contract.json, T23A) as JavaScript surface:
//
//   - `document.createElement` / `document.createTextNode` adapt the native
//     `DocumentHandle.createElement` / `createText` creation surface (the
//     WHATWG name `createTextNode` is a facade adaptation — no native symbol
//     of that name exists);
//   - the `Node` navigation properties (`nodeType`, `nodeName`, `parentNode`,
//     `firstChild`, `lastChild`, `previousSibling`, `nextSibling`,
//     `childNodes`) read from the native `NodeHandle`; bounded first-child and
//     sibling prefetch seeds epoch-validated facade memos, and every produced
//     node uses the `ctx.wrap` / token conversion family, so wrapper identity
//     converges through document-scoped tokens (with the native per-document
//     weak cache retained for materialized handles).
//
// It deliberately does **not** implement mutation, attributes, `textContent`
// or the live `childNodes` collection — those belong to T24C / T25E / T25D and
// are explicitly out of scope here (js/facade/CONTRACT.md). The facade keeps no
// second DOM state: a `Node` wrapper holds either an opaque native `NodeHandle`
// or a document-scoped primitive token. A Core `NodeId` never crosses this
// seam and only the binding can resolve a token.
//
// Since the T25 gate, `childNodes` hands back the T25D live `NodeList`
// (`liveChildNodes`) instead of the T23B snapshot array: the collection re-reads
// the same frozen native `childNodes()` read on every access, so an existing
// `childNodes` object reflects later append/insert/move/remove/replace and
// `textContent` writes immediately. The wiring is the single place the snapshot
// facade form of `childNodes` disappears.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T23 gate
// (tests/bun/seam.test.js pins that shape).

import {
  Node,
  Element,
  DocumentFragment,
  ELEMENT_MINT_SYMBOL,
  nodeHandleOf,
  nodeDocumentStateOf,
  nodeInternalsOf,
  isRegisteredElementName,
  registerElementClass,
  setElementFallbackClasses,
  setRegisterMintedWrapper,
  createTrustedNodeWrapper,
} from "./classes.js";
import { Document } from "../document.js";
import { Window } from "../window.js";
import { snapshotWrapper } from "./snapshot-node.js";
import { liveChildNodes } from "./child-nodelist.js";
import { upgradeElementPrototype } from "./custom-elements.js";
import { domErrorName, rethrowDomError, webidlMessage } from "./dom-error.js";

export {
  Node,
  Element,
  DocumentFragment,
  ELEMENT_MINT_SYMBOL,
  registerElementClass,
  setElementFallbackClasses,
};

export const seam = Object.freeze({
  id: "facade/extensions/node",
  owner: "T23B",
  gate: "T23",
  status: "implemented",
});

// The WHATWG HTML namespace URI (mirrors crates/mad-dom-core/src/dom/node.rs):
// `nodeName` / `tagName` report the tag name uppercased only for elements in
// this namespace, matching happy-dom.
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const ELEMENT_TOKEN_BATCH_SIZE = 256;
const ArrayConstructor = Array;
const StringConstructor = String;
const WeakSetConstructor = WeakSet;
const stringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
const stringSlice = Function.prototype.call.bind(String.prototype.slice);
const stringFromCharCode = String.fromCharCode;
const weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has);


function createElementToken(documentHandle, documentState, localName, structureEpoch) {
  const elementTokenMethod = documentState.nativeMethods.createElementToken;
  // A pool hit performs no native call, so explicitly preserve the lifecycle
  // boundary. Name coercion has already run and may itself have destroyed the
  // document. Calling the native creation entry in the terminal case yields
  // the canonical ERR_MAD_DOM_DOCUMENT_DESTROYED exception.
  if (structureEpoch === DESTROYED_EPOCH) {
    return elementTokenMethod(localName);
  }
  if (documentState.epoch !== null) {
    let pool = documentState.getElementTokenPool(localName);
    if (
      pool === undefined &&
      localName !== "template" &&
      isRegisteredElementName(localName)
    ) {
      // Optional methods must be own data methods of the native prototype.
      // An older binding must not mistake an application-installed
      // Object.prototype property for a supported performance capability.
      const rangeMethod = documentState.nativeMethods.createElementTokenRange;
      const batchMethod = documentState.nativeMethods.createElementTokenBatch;
      if (rangeMethod !== undefined || batchMethod !== undefined) {
        // Do not allocate a large invisible reserve for a one-off tag.
        // Repeated use ramps quickly to the steady 256-node batch size.
        // Current bindings return only the first token of a contiguous
        // registered range; the array fields retain the mixed-version
        // fallback without changing token consumption order.
        documentState.setElementTokenPool(localName, {
          rangeMethod,
          batchMethod,
          rangeStart: 0,
          rangeRemaining: 0,
          tokens: [],
          next: 8,
        });
        return elementTokenMethod(localName);
      }
    }
    if (pool !== undefined) {
      if (pool.rangeMethod !== undefined) {
        if (pool.rangeRemaining === 0) {
          pool.rangeStart = pool.rangeMethod(localName, pool.next);
          pool.rangeRemaining = pool.next;
          pool.next *= 4;
          if (pool.next > ELEMENT_TOKEN_BATCH_SIZE) {
            pool.next = ELEMENT_TOKEN_BATCH_SIZE;
          }
        }
        pool.rangeRemaining -= 1;
        return pool.rangeStart + pool.rangeRemaining;
      }
      if (pool.tokens.length === 0) {
        pool.tokens = pool.batchMethod(localName, pool.next);
        pool.next *= 4;
        if (pool.next > ELEMENT_TOKEN_BATCH_SIZE) {
          pool.next = ELEMENT_TOKEN_BATCH_SIZE;
        }
      }
      const index = pool.tokens.length - 1;
      const token = pool.tokens[index];
      pool.tokens.length = index;
      return token;
    }
  }
  return elementTokenMethod(localName);
}

// Native reserves two terminal Int32 generation values. Destroy must re-enter
// native to surface its lifecycle error; cache-disabled is reached before a
// live generation could wrap and repeat, after which reads remain correct by
// bypassing every epoch cache.
const DESTROYED_EPOCH = -2147483648;
const CACHE_DISABLED_EPOCH = -1;

function asciiLowercase(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = stringCharCodeAt(value, i);
    if (code < 65 || code > 90) continue;
    let normalized = stringSlice(value, 0, i);
    for (let k = i; k < value.length; k += 1) {
      const next = stringCharCodeAt(value, k);
      normalized += next >= 65 && next <= 90
        ? stringFromCharCode(next + 32)
        : value[k];
    }
    return normalized;
  }
  return value;
}

// Returns the immutable native type stamp when this wrapper was proven live
// at the document's current structural epoch. A structural mutation (including
// cross-document adoption, the only path that stales live NodeIds) or destroy
// changes the epoch first; the miss validates through native `nodeType()` and
// refreshes the proof only after that succeeds. Older bindings without an
// epoch or classification stamp always retain the native path.
function validatedNodeType(wrapper, internals = nodeInternalsOf(wrapper)) {
  const state = internals?.documentState;
  let handle = internals?.handle;
  const stamped = internals?.nodeType;
  if (state === undefined || state.epoch === null || stamped === undefined) {
    handle ??= nodeHandleOf(wrapper);
    return handle.nodeType();
  }
  const epoch = state.epoch[0];
  if (epoch === DESTROYED_EPOCH || epoch === CACHE_DISABLED_EPOCH) {
    handle ??= nodeHandleOf(wrapper);
    return handle.nodeType();
  }
  if (internals.validEpoch === epoch) return stamped;
  handle ??= nodeHandleOf(wrapper);
  const nodeType = handle.nodeType();
  internals.validEpoch = state.epoch[0];
  return nodeType;
}

/**
 * Installs the node creation and navigation surface onto the facade.
 *
 * Called exactly once by the facade registry with the `ctx` that
 * js/facade/window.js builds: `registerHandleType` and the sanctioned
 * property-definition helpers are the only mechanism used here. Native
 * handles cross through `ctx.wrap`; lazy tokens use the matching token
 * conversion entries and converge on the same identity table.
 */
export function install(ctx) {
  // `ctx.wrap` has already identified the native class, so use the trusted
  // factory and avoid repeating Node's public authenticity probe per mint.
  ctx.registerHandleType("NodeHandle", createTrustedNodeWrapper);
  // Recording-only installer contexts have no wrapper registry. They must
  // leave the active facade's constructor registration hook intact.
  if (typeof ctx.registerWrap === "function") setRegisterMintedWrapper(ctx.registerWrap);

  // `window.Node` / `window.Element` / `window.DocumentFragment` — the WHATWG
  // constructor accessors (T48A), matching the happy-dom window surface.
  ctx.defineAccessor(Window.prototype, "Node", function getNode() {
    return Node;
  }, undefined);
  ctx.defineAccessor(Window.prototype, "Element", function getElement() {
    return Element;
  }, undefined);
  ctx.defineAccessor(Window.prototype, "DocumentFragment", function getDocumentFragment() {
    return DocumentFragment;
  }, undefined);

  // `document.createElement` / `document.createTextNode` (WHATWG names).
  //
  // The native `DocumentHandle` carries the `createElement` / `createText`
  // symbols (frozen by T23A); the WHATWG `createTextNode` name is adapted
  // here, so no native duplicate exists. Current bindings return a document-
  // scoped token and materialize a NodeHandle only for an operation outside
  // the token fast path. Older bindings retain eager `ctx.wrap` conversion.
  ctx.defineMethod(Document.prototype, "createElement", function createElement(name) {
    // Canonical Document facades already carry their document state. Reuse
    // its handle instead of paying a second private-registry lookup on every
    // create; manually constructed/non-canonical facades retain the audited
    // documentContext fallback and its existing error behaviour.
    let documentState = nodeDocumentStateOf(this);
    const documentHandle = documentState === undefined
      ? ctx.documentContext.handleOf(this)
      : documentState.documentHandle;
    documentState ??= ctx.docStateOf(documentHandle);
    const suppliedName = typeof name === "string" ? name : StringConstructor(name);
    const localName = asciiLowercase(suppliedName);
    // Name coercion is the only user-code re-entry before creation. Read the
    // canonical generation afterwards, then reuse that proof for the pool's
    // destroy guard and the freshly minted wrapper.
    const structureEpoch = documentState.epoch === null
      ? null
      : documentState.epoch[0];
    let element;
    try {
      const elementTokenMethod = documentState.nativeMethods.createElementToken;
      const materializeNodeToken = documentState.nativeMethods.materializeNodeToken;
      element =
        elementTokenMethod !== undefined && materializeNodeToken !== undefined
          ? ctx.wrapLazyNode(
              documentHandle,
              createElementToken(
                documentHandle,
                documentState,
                localName,
                structureEpoch,
              ),
              1,
              localName,
              HTML_NAMESPACE,
              documentState,
              undefined,
              structureEpoch,
              undefined,
              true,
            )
          : ctx.wrap(documentHandle.createElement(localName), documentState, true);
    } catch (error) {
      // T48B: re-raise the invalid-element-name violation as a real
      // DOMException with the stable `code`, keeping the WHATWG name visible in
      // the WebIDL message (the frozen T21A name embedded in the native message
      // is part of the contract consumers key on).
      const message =
        domErrorName(error) === "InvalidCharacterError"
          ? `Uncaught InvalidCharacterError: Failed to execute 'createElement' on 'Document': '${suppliedName}' is not a valid element name.`
          : webidlMessage(error, "createElement", "Document");
      rethrowDomError(error, message);
    }
    // T42: an element created with a defined custom name is an upgraded custom
    // element — Core marked it custom at creation, so the wrapper's prototype
    // is re-parented onto the user class (the in-place single-class upgrade).
    upgradeElementPrototype(ctx, element, documentHandle);
    return element;
  });

  ctx.defineMethod(Document.prototype, "createTextNode", function createTextNode(data) {
    let documentState = nodeDocumentStateOf(this);
    const documentHandle = documentState === undefined
      ? ctx.documentContext.handleOf(this)
      : documentState.documentHandle;
    documentState ??= ctx.docStateOf(documentHandle);
    const text = typeof data === "string" ? data : StringConstructor(data);
    const structureEpoch = documentState.epoch === null
      ? null
      : documentState.epoch[0];
    const textTokenMethod = documentState.nativeMethods.createTextToken;
    const materializeNodeToken = documentState.nativeMethods.materializeNodeToken;
    if (textTokenMethod !== undefined && materializeNodeToken !== undefined) {
      return ctx.wrapFreshTextNode(
        documentState,
        textTokenMethod(text),
        structureEpoch,
      );
    }
    return ctx.wrap(
      documentHandle.createText(text),
      documentState,
      true,
    );
  });

  // `Node` navigation properties (WHATWG read-only attributes).
  //
  // Native misses route node results through `ctx.wrap`; generation-valid
  // metadata/navigation memos and subtree snapshots can answer without a
  // crossing. Every route converges on one facade object per document token.
  ctx.defineAccessor(Node.prototype, "nodeType", function nodeType() {
    return validatedNodeType(this);
  }, undefined);

  // WHATWG nodeName: an element in the HTML namespace reports its tag name in
  // uppercase ("DIV"), matching happy-dom; SVG/MathML and every other node kind
  // report the Core value verbatim (`#text`, `#document-fragment`, the SVG
  // lowercased tag, ...). Fresh native wrappers carry immutable name/namespace
  // stamps for the facade's class selection. Reuse them while the wrapper's
  // validity epoch matches; on a miss `validatedNodeType` first proves through
  // native that adoption/destruction did not stale the handle. Older bindings
  // without stamps retain the original native-read path. The serializers and
  // selectors keep using the Core lowercased local name, so this case change
  // is only the observable accessor.
  ctx.defineAccessor(Node.prototype, "nodeName", function nodeName() {
    const internals = nodeInternalsOf(this);
    const nodeType = validatedNodeType(this, internals);
    if (nodeType !== 1) return nodeHandleOf(this)?.nodeName();
    const handle = internals?.handle;
    const stampedName = internals?.nodeName;
    const stampedNamespace = internals?.nodeNamespace;
    const name = typeof stampedName === "string" ? stampedName : handle.nodeName();
    const namespace =
      typeof stampedNamespace === "string" ? stampedNamespace : handle.namespaceUri();
    if (namespace === HTML_NAMESPACE) {
      return name.toUpperCase();
    }
    return name;
  }, undefined);

  // WHATWG Element.localName: the lowercased local tag name for an element
  // (the Core `nodeName`), `undefined` on non-element nodes like happy-dom. On
  // `Element.prototype` (T48A): Text / Comment are plain `Node`s and read
  // `undefined`.
  ctx.defineAccessor(Element.prototype, "localName", function localName() {
    const internals = nodeInternalsOf(this);
    if (validatedNodeType(this, internals) !== 1) return undefined;
    const handle = internals?.handle;
    const stampedName = internals?.nodeName;
    return typeof stampedName === "string" ? stampedName : handle.nodeName();
  }, undefined);

  // WHATWG Element.tagName: equal to `nodeName` for elements (uppercase for
  // HTML namespace elements), `undefined` on non-element nodes like happy-dom.
  ctx.defineAccessor(Element.prototype, "tagName", function tagName() {
    const internals = nodeInternalsOf(this);
    if (validatedNodeType(this, internals) !== 1) return undefined;
    const handle = internals?.handle;
    const stampedName = internals?.nodeName;
    const stampedNamespace = internals?.nodeNamespace;
    const name = typeof stampedName === "string" ? stampedName : handle.nodeName();
    const namespace =
      typeof stampedNamespace === "string" ? stampedNamespace : handle.namespaceUri();
    if (namespace === HTML_NAMESPACE) {
      return name.toUpperCase();
    }
    return name;
  }, undefined);

  // `Node` navigation getters with an epoch-guarded memo.
  //
  // A tree walk over an unchanged document is otherwise 2 FFI crossings per
  // edge (plus a wrapper mint per node after any GC), which leaves a native-
  // backed DOM structurally slower than a pure-JS DOM on the most common DOM
  // workload. The memo caches each read in the wrapper's private state record
  // and validates it against the document's structural epoch in a JS-owned
  // 4-byte view.
  // Native/raw calls publish through a weak subscription; facade token writes
  // publish the canonical generation returned by the binding directly
  // (crates/mad-dom-bun `epoch_api` / `with_document`). While the epoch is
  // unchanged the cached answer is
  // exact: navigation results only change with the relations. The wrappers
  // stay memoizable across garbage collection because the per-document token
  // map retains them while the document is reachable (`window.js` DOC_STATES).
  //
  // Without an epoch (older native binding) the read falls through to the
  // plain native delegation, exactly the pre-memo behaviour.
  const UNSET = {};

  function freshMemo(epoch) {
    return {
      e: epoch, fc: UNSET, lc: UNSET, ns: UNSET, ps: UNSET, pn: UNSET,
    };
  }

  function memoOf(wrapper) {
    return nodeInternalsOf(wrapper)?.memo;
  }

  function memoFor(wrapper, epoch, internals = nodeInternalsOf(wrapper)) {
    const memo = internals?.memo;
    if (memo !== undefined) {
      if (memo.e !== epoch) {
        memo.e = epoch;
        memo.fc = memo.lc = memo.ns = memo.ps = memo.pn = UNSET;
      }
      return memo;
    }
    const created = freshMemo(epoch);
    internals.memo = created;
    return created;
  }

  function navRead(wrapper, field, nativeName, childAxis = false) {
    const internals = nodeInternalsOf(wrapper);
    const state = internals?.documentState;
    if (state === undefined || state.epoch === null) {
      return ctx.wrap(nodeHandleOf(wrapper)[nativeName]());
    }
    const epoch = state.epoch[0];
    if (epoch === DESTROYED_EPOCH || epoch === CACHE_DISABLED_EPOCH) {
      return ctx.wrap(nodeHandleOf(wrapper)[nativeName](), state);
    }
    const memo = internals.memo;
    if (memo !== undefined && memo.e === epoch) {
      const value = memo[field];
      if (value !== UNSET) return value;
    }
    let handle = internals.handle;
    const stampedType =
      childAxis && internals.validEpoch === epoch
        ? internals.nodeType
        : undefined;
    // Character-data, processing-instruction and doctype nodes can never
    // acquire children. A freshly returned wrapper is already proven live at
    // this epoch (`pinWrapper` records that proof), so their cold first/last
    // child miss can be answered without crossing native. If adoption,
    // mutation or destroy changed the epoch, the proof misses and the normal
    // native read preserves the stale/lifecycle error contract.
    const childless =
      childAxis &&
      (stampedType === 3 || stampedType === 4 || stampedType === 7 ||
        stampedType === 8 || stampedType === 10);
    if (!childless) handle ??= nodeHandleOf(wrapper);
    const result = childless ? null : ctx.wrap(handle[nativeName](), state);
    const current = state.epoch[0];
    if (!childless) internals.validEpoch = current;
    const live = memoFor(wrapper, current, internals);
    live[field] = result;
    if (result !== null && result !== undefined) {
      const related = memoFor(result, current);
      if (field === "fc") {
        related.pn = wrapper;
        related.ps = null;
      } else if (field === "lc") {
        related.pn = wrapper;
        related.ns = null;
      } else if (field === "ns") {
        related.ps = wrapper;
        if (live.pn !== UNSET) related.pn = live.pn;
      } else if (field === "ps") {
        related.ns = wrapper;
        if (live.pn !== UNSET) related.pn = live.pn;
      }
    }
    return result;
  }


  // Hydrates a bounded subtree prefix and seeds every relation memo whose
  // terminal link is proven by that prefix. Current bindings prefix the pairs
  // with a continuation depth (`0` means complete); older bindings returned
  // complete pairs directly.
  // Pre-order + depth is enough to reconstruct parent, sibling and first/last-
  // child links without carrying per-node JS record objects.
  function hydrateSubtreeSnapshot(flat, state, epoch, rootWrapper) {
    const hasHeader = flat.length % 2 === 1;
    const pairStart = hasHeader ? 1 : 0;
    const continuationDepth = hasHeader && flat[0] !== 0 ? flat[0] - 1 : null;
    const count = (flat.length - pairStart) / 2;
    const stack = [rootWrapper];
    const memoStack = [];
    for (let i = 0; i < count; i++) {
      const offset = pairStart + i * 2;
      const token = flat[offset];
      const packed = flat[offset + 1];
      // Native reserves the top bit as proof that the token was assigned in
      // this snapshot. Mask it away before decoding the compact kind; older
      // bindings never set it and retain the ordinary identity lookup.
      const knownFresh = packed >>> 31 === 1;
      const descriptor = (packed >>> 16) & 0x7fff;
      const preparedMemo = i !== 0 && descriptor !== 0
        ? freshMemo(epoch)
        : undefined;
      const wrapper = i === 0
        ? rootWrapper
        : snapshotWrapper(
            ctx,
            state,
            token,
            descriptor,
            preparedMemo,
            epoch,
            knownFresh,
          );
      let memo = preparedMemo;
      if (memo === undefined) {
        const internals = nodeInternalsOf(wrapper);
        if (internals.validEpoch !== epoch) internals.validEpoch = epoch;
        memo = memoFor(wrapper, epoch, internals);
      }
      memo.fc = null;
      memo.lc = null;
      if (i === 0) {
        memoStack[0] = memo;
        continue;
      }
      memo.pn = null;
      memo.ps = null;
      memo.ns = null;
      const depth = packed & 0xffff;
      const parent = stack[depth - 1];
      // Pre-order guarantees every parent was initialized earlier in this
      // same pass. Keep the parallel memo stack so relation linking performs
      // no repeated symbol/WeakMap lookup per node.
      const parentMemo = memoStack[depth - 1];
      const previous = parentMemo.lc;
      memo.pn = parent;
      memo.ps = previous;
      if (previous === null) {
        parentMemo.fc = wrapper;
      } else {
        memoStack[depth].ns = wrapper;
      }
      parentMemo.lc = wrapper;
      stack[depth] = wrapper;
      stack.length = depth + 1;
      memoStack[depth] = memo;
      memoStack.length = depth + 1;
    }

    if (continuationDepth !== null) {
      // The ancestors shared with the not-yet-returned next pre-order node do
      // not have a proven last child yet. Undo only those terminal nulls;
      // completed sibling subtrees retain their exact memos.
      for (let depth = 0; depth < continuationDepth; depth += 1) {
        const ancestor = stack[depth];
        if (ancestor === undefined) break;
        const ancestorMemo = memoStack[depth];
        const lastIncludedChild = ancestorMemo.lc;
        if (lastIncludedChild === null) {
          ancestorMemo.fc = UNSET;
        } else if (lastIncludedChild !== UNSET) {
          memoStack[depth + 1].ns = UNSET;
        }
        ancestorMemo.lc = UNSET;
      }
      return { stack, depth: continuationDepth };
    }
    return null;
  }

  function firstChildAxisRead(wrapper) {
    const internals = nodeInternalsOf(wrapper);
    const state = internals?.documentState;
    if (state === undefined || state.epoch === null) {
      return navRead(wrapper, "fc", "firstChild", true);
    }
    const epoch = state.epoch[0];
    if (epoch === DESTROYED_EPOCH || epoch === CACHE_DISABLED_EPOCH) {
      return navRead(wrapper, "fc", "firstChild", true);
    }
    const memo = internals.memo;
    if (memo !== undefined && memo.e === epoch && memo.fc !== UNSET) {
      return memo.fc;
    }

    let handle = internals.handle;
    const stampedType =
      internals.validEpoch === epoch
        ? internals.nodeType
        : undefined;
    const childless =
      stampedType === 3 || stampedType === 4 || stampedType === 7 ||
      stampedType === 8 || stampedType === 10;
    if (childless) return navRead(wrapper, "fc", "firstChild", true);

    // Attempt one bounded preorder chunk per document generation. A current
    // binding returns up to 65,535 nodes plus the next node's depth; relation
    // memos at that boundary stay unset, and traversal can snapshot a marked
    // descendant partition or resume through bounded sibling navigation.
    // This avoids a scale cliff without making one isolated `firstChild` read
    // materialize an unbounded tree.
    const token = ctx.documentContext.tokenOf(wrapper);
    const documentHandle = state.documentHandle;
    const primarySnapshot = state.snapshotAttemptEpoch !== epoch;
    const partitionRoots = primarySnapshot ? null : state.snapshotPartitionRoots;
    const wrapperMemo = memoOf(wrapper);
    const partitionChild =
      partitionRoots !== null &&
      (weakSetHas(partitionRoots, wrapper) ||
        (wrapperMemo !== undefined &&
          wrapperMemo.e === epoch &&
          weakSetHas(partitionRoots, wrapperMemo.pn)));
    if (
      (primarySnapshot || partitionChild) &&
      token !== undefined &&
      state.nativeMethods.preorderTokenSnapshot !== undefined &&
      state.nativeMethods.materializeNodeToken !== undefined
    ) {
      if (primarySnapshot) {
        state.snapshotAttemptEpoch = epoch;
        state.snapshotPartitionRoots = null;
      }
      const flat = state.nativeMethods.preorderTokenSnapshot(token);
      if (flat.length !== 0) {
        const continuation = hydrateSubtreeSnapshot(
          flat,
          state,
          state.epoch[0],
          wrapper,
        );
        if (continuation !== null) {
          state.snapshotPartitionRoots ??= new WeakSetConstructor();
          for (let depth = 0; depth < continuation.depth; depth += 1) {
            weakSetAdd(
              state.snapshotPartitionRoots,
              continuation.stack[depth],
            );
          }
        }
        return memoOf(wrapper).fc;
      }
      if (primarySnapshot) {
        state.snapshotPartitionRoots = new WeakSetConstructor();
        weakSetAdd(state.snapshotPartitionRoots, wrapper);
      }
    }

    handle ??= nodeHandleOf(wrapper);
    const firstChildPair = state.nodeNativeMethodsOf(handle).firstChildPair;
    if (firstChildPair === undefined) {
      return navRead(wrapper, "fc", "firstChild", true);
    }

    // Most DOM parents have one or two children. Fetch that bounded prefix in
    // one crossing and seed both directions of the relation memo. At most one
    // sibling beyond the requested first child is speculatively wrapped.
    const nativePair = firstChildPair(handle);
    const reachedEnd = nativePair[nativePair.length - 1] === null;
    const length = nativePair.length - (reachedEnd ? 1 : 0);
    const children = new ArrayConstructor(length);
    for (let i = 0; i < length; i += 1) {
      children[i] = ctx.wrap(nativePair[i], state);
    }

    const current = state.epoch[0];
    internals.validEpoch = current;
    const parentMemo = memoFor(wrapper, current, internals);
    if (children.length === 0) {
      parentMemo.fc = null;
      if (reachedEnd) parentMemo.lc = null;
      return null;
    }

    parentMemo.fc = children[0];
    let previous = null;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const childInternals = nodeInternalsOf(child);
      childInternals.validEpoch = current;
      const childMemo = memoFor(child, current, childInternals);
      childMemo.pn = wrapper;
      childMemo.ps = previous;
      if (previous !== null) memoFor(previous, current).ns = child;
      previous = child;
    }
    if (reachedEnd) {
      memoFor(previous, current).ns = null;
      parentMemo.lc = previous;
    }
    return children[0];
  }

  function siblingAxisRead(wrapper) {
    const internals = nodeInternalsOf(wrapper);
    const state = internals?.documentState;
    if (state === undefined || state.epoch === null) {
      return navRead(wrapper, "ns", "nextSibling");
    }
    const epoch = state.epoch[0];
    if (epoch === DESTROYED_EPOCH || epoch === CACHE_DISABLED_EPOCH) {
      return navRead(wrapper, "ns", "nextSibling");
    }
    const memo = internals.memo;
    if (memo !== undefined && memo.e === epoch && memo.ns !== UNSET) {
      return memo.ns;
    }

    // Once a caller has already followed two links in the same sibling chain,
    // it is probably traversing the axis rather than making an isolated
    // `nextSibling` read. Fetch a bounded native window (at most 32 following
    // nodes) and seed its epoch-guarded relation memos. The bound is important:
    // reading four children of an ultra-wide parent must not eagerly wrap and
    // pin the complete sibling axis. Older native bindings have no chunk read
    // and retain the lazy single-node path.
    const previous = memo?.e === epoch ? memo.ps : UNSET;
    const previousMemo = previous === null || previous === UNSET
      ? undefined
      : memoOf(previous);
    const parent = memo?.e === epoch ? memo.pn : UNSET;
    if (
      previous === UNSET || previous === null ||
      previousMemo === undefined || previousMemo.e !== epoch ||
      previousMemo.ps === UNSET || previousMemo.ps === null ||
      parent === UNSET || parent === null
    ) {
      return navRead(wrapper, "ns", "nextSibling");
    }

    const handle = nodeHandleOf(wrapper);
    const readChunk = state.nodeNativeMethodsOf(handle).nextSiblingChunk;
    if (readChunk === undefined) {
      return navRead(wrapper, "ns", "nextSibling");
    }

    const nativeChunk = readChunk(handle);
    const reachedEnd = nativeChunk[nativeChunk.length - 1] === null;
    const length = nativeChunk.length - (reachedEnd ? 1 : 0);
    const children = new ArrayConstructor(length);
    for (let i = 0; i < length; i += 1) {
      children[i] = ctx.wrap(nativeChunk[i], state);
    }
    const current = state.epoch[0];
    internals.validEpoch = current;
    const parentMemo = memoFor(parent, current);
    let preceding = wrapper;
    for (let i = 0; i < children.length; i += 1) {
      const childMemo = memoFor(children[i], current);
      childMemo.pn = parent;
      childMemo.ps = preceding;
      nodeInternalsOf(children[i]).validEpoch = current;
      memoFor(preceding, current).ns = children[i];
      preceding = children[i];
    }
    // A short final chunk carries an explicit native end marker. Only then is
    // it correct to cache `null`; a full chunk deliberately leaves the last
    // node's next-sibling memo unset so the following read fetches one more
    // bounded window.
    if (reachedEnd) {
      memoFor(preceding, current).ns = null;
      parentMemo.lc = preceding;
    }
    const refreshed = memoFor(wrapper, current);
    if (refreshed.ns !== UNSET) return refreshed.ns;
    return navRead(wrapper, "ns", "nextSibling");
  }

  ctx.defineAccessor(Node.prototype, "parentNode", function parentNode() {
    return navRead(this, "pn", "parentNode");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "firstChild", function firstChild() {
    return firstChildAxisRead(this);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "lastChild", function lastChild() {
    return navRead(this, "lc", "lastChild", true);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "previousSibling", function previousSibling() {
    return navRead(this, "ps", "previousSibling");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "nextSibling", function nextSibling() {
    return siblingAxisRead(this);
  }, undefined);

  // Ordered children as the T25D *live* `NodeList` bound to this parent. Every
  // access re-reads the native child list through
  // `liveChildNodes`, so an existing collection reflects later tree or
  // `textContent` changes immediately and one and the same `NodeList` object is
  // handed back per parent (stable identity), matching happy-dom. The T23B
  // snapshot-array form was replaced by the T25 gate; an empty `NodeList`
  // stands for a leaf node.
  ctx.defineAccessor(Node.prototype, "childNodes", function childNodes() {
    return liveChildNodes(nodeInternalsOf(this)?.documentState === undefined ? nodeHandleOf(this) : this);
  }, undefined);
}
