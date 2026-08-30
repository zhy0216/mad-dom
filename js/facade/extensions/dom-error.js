// Facade-side DOMException reclassification (T48B).
//
// The native binding (napi4) can only raise plain `Error` objects: the frozen
// T21A DOM-spec taxonomy degrades to a controlled plain `Error` that carries
// the stable `code` and embeds the WHATWG name in the message
// (`[ERR_MAD_DOM_INVALID_CHARACTER] InvalidCharacterError: ...`). This module
// is the facade-side complement of that taxonomy: it re-raises the
// DOMException-classed violations as **real** `DOMException` objects that
// preserve the stable `code` and carry the WebIDL message happy-dom produces.
//
// Lifecycle, argument and parse failures are not DOMException-classed (plain
// `Error`, `TypeError`, `SyntaxError`) and pass through unchanged — in
// particular the `ERR_MAD_DOM_DOCUMENT_DESTROYED` lifecycle error keeps its
// exact `[ERR_MAD_DOM_DOCUMENT_DESTROYED] ...` message.
//
// This is a pure helper module consumed by the facade extension installers
// (`attributes.js`, `text-content.js`, `node.js`); it is not itself an
// extension and is not registered with the facade registry.

const DOM_EXCEPTION_NAME_BY_CODE = Object.freeze({
  ERR_MAD_DOM_HIERARCHY: "HierarchyRequestError",
  ERR_MAD_DOM_WRONG_DOCUMENT: "WrongDocumentError",
  ERR_MAD_DOM_INVALID_CHARACTER: "InvalidCharacterError",
  ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS: "IndexSizeError",
});

const DOM_EXCEPTION_CODES = new Set(Object.keys(DOM_EXCEPTION_NAME_BY_CODE));

/**
 * Whether `error` is a degraded DOMException-classed violation from the native
 * binding, identified by its frozen `ERR_MAD_DOM_*` `code`.
 */
export function isDomError(error) {
  return (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    DOM_EXCEPTION_CODES.has(error.code)
  );
}

/**
 * The WHATWG DOMException `name` of a degraded DOM-spec violation, or `null`
 * for any other error.
 */
export function domErrorName(error) {
  if (!isDomError(error)) return null;
  return DOM_EXCEPTION_NAME_BY_CODE[error.code];
}

/**
 * The native message tail without the `[CODE] Name: ` prefix, so a facade
 * message can reuse the Core detail verbatim without leaking the degraded
 * `ERR_MAD_DOM_*` marker.
 */
function nativeDetail(error) {
  const message =
    error !== null && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : String(error);
  const marker = "]: ";
  const separator = message.indexOf(marker);
  const tail = separator === -1 ? message : message.slice(separator + marker.length);
  return tail.replace(/^[A-Za-z]+Error: /, "");
}

/**
 * A WebIDL-style message in the happy-dom shape
 * `Failed to execute '<method>' on '<instance>': <detail>`, using the native
 * detail verbatim (never the degraded `[ERR_MAD_DOM_*]` prefix).
 */
export function webidlMessage(error, method, instance) {
  return `Failed to execute '${method}' on '${instance}': ${nativeDetail(error)}`;
}

/**
 * Re-raises a degraded DOM-spec violation as a real `DOMException` carrying the
 * stable `code` and the given happy-dom WebIDL `message`; any other error is
 * rethrown unchanged.
 */
export function rethrowDomError(error, message) {
  if (!isDomError(error)) throw error;
  const code = error.code;
  const domError = new DOMException(message, DOM_EXCEPTION_NAME_BY_CODE[code]);
  // Preserve the stable machine-readable code. Bun's DOMException `code` is a
  // read-only prototype accessor (it defaults to the legacy numeric code
  // derived from the name), so the frozen string is installed as an own
  // property.
  Object.defineProperty(domError, "code", {
    value: code,
    writable: true,
    configurable: true,
  });
  throw domError;
}
