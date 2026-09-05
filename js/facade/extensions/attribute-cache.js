// Exact facade cache for the two hottest reflected attributes. Core remains
// authoritative: the binding exposes independent structural and attribute
// generations, and a hit is served only while both still match. Structural
// validation prevents cross-document adoption from turning a stale NodeId
// into a cached read; the terminal epoch likewise preserves destroy errors.

import { nodeInternalsOf } from "./classes.js";

const DESTROYED_EPOCH = -2147483648;
const CACHE_DISABLED_EPOCH = -1;
const callFunction = Function.prototype.call.bind(Function.prototype.call);
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

export function readCachedAttribute(wrapper, handle, name) {
  if (name !== "id" && name !== "class") return handle.getAttribute(name);

  const internals = nodeInternalsOf(wrapper);
  const state = internals?.documentState;
  const attributeEpochView = state?.attributeEpoch;
  const structureEpochView = state?.epoch;
  if (
    attributeEpochView === null || attributeEpochView === undefined ||
    structureEpochView === null || structureEpochView === undefined
  ) {
    return handle.getAttribute(name);
  }

  const attributeEpoch = attributeEpochView[0];
  const structureEpoch = structureEpochView[0];
  let cache = internals.attributeCache;
  if (
    attributeEpoch !== DESTROYED_EPOCH &&
    attributeEpoch !== CACHE_DISABLED_EPOCH &&
    structureEpoch !== DESTROYED_EPOCH &&
    structureEpoch !== CACHE_DISABLED_EPOCH &&
    cache?.attributeEpoch === attributeEpoch &&
    cache.structureEpoch === structureEpoch
  ) {
    const cached = name === "id" ? cache.id : cache.classValue;
    if (cached !== undefined) return cached;
  }

  let idValue;
  let classValue;
  let filledBundle = false;
  const nativeMethods = state.nodeNativeMethodsOf(handle);
  const ownBundledRead = objectGetOwnPropertyDescriptor(handle, "idClassAttributes");
  if (typeof ownBundledRead?.value === "function") {
    [idValue, classValue] = callFunction(ownBundledRead.value, handle);
    filledBundle = true;
  } else if (nativeMethods.idClassAttributes !== undefined) {
    [idValue, classValue] = nativeMethods.idClassAttributes(handle);
    filledBundle = true;
  } else {
    const fixedRead = name === "id"
      ? nativeMethods.idAttribute
      : nativeMethods.classAttribute;
    // A present fixed reader is authoritative even when it returns null;
    // falling through on null would perform a second read for absent values.
    const value = fixedRead !== undefined
      ? fixedRead(handle)
      : handle.getAttribute(name);
    if (name === "id") idValue = value;
    else classValue = value;
  }
  const currentAttributeEpoch = attributeEpochView[0];
  const currentStructureEpoch = structureEpochView[0];
  if (cache === undefined) {
    cache = {
      attributeEpoch: currentAttributeEpoch,
      structureEpoch: currentStructureEpoch,
      id: undefined,
      classValue: undefined,
    };
    internals.attributeCache = cache;
  } else if (
    cache.attributeEpoch !== currentAttributeEpoch ||
    cache.structureEpoch !== currentStructureEpoch
  ) {
    cache.attributeEpoch = currentAttributeEpoch;
    cache.structureEpoch = currentStructureEpoch;
    cache.id = undefined;
    cache.classValue = undefined;
  }
  if (filledBundle || name === "id") cache.id = idValue;
  if (filledBundle || name === "class") cache.classValue = classValue;
  internals.validEpoch = currentStructureEpoch;
  return name === "id" ? idValue : classValue;
}
