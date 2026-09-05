// Decode the native token snapshot descriptor without materializing a handle.
// Query snapshots and navigation share the same canonical wrapper conversion.
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SNAPSHOT_HTML_NAMES = [
  "html", "head", "body", "title", "div", "span", "p", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "table", "caption", "tr", "td", "th", "thead", "tbody", "tfoot",
  "br", "hr", "form", "input", "button", "select", "option",
  "textarea", "label", "img", "script", "style", "link", "meta",
  "blockquote", "q", "slot", "template", "section",
];

export function snapshotNodes(ctx, state, flat) {
  const epoch = state.epoch === null ? null : state.epoch[0];
  const items = new Array((flat.length - 1) / 2);
  for (let i = 1; i < flat.length; i += 2) {
    const packed = flat[i + 1];
    items[(i - 1) / 2] = snapshotWrapper(
      ctx, state, flat[i], (packed >>> 16) & 0x7fff, undefined, epoch,
      (packed & 0x80000000) !== 0,
    );
  }
  return items;
}

export function snapshotWrapper(
  ctx,
  state,
  token,
  descriptor,
  initialMemo,
  epoch,
  knownFresh,
) {
  if (descriptor >= 16) {
    const name = SNAPSHOT_HTML_NAMES[descriptor - 16];
    if (name !== undefined) {
      return ctx.wrapLazyNode(
        state.documentHandle,
        token,
        1,
        name,
        HTML_NAMESPACE,
        state,
        initialMemo,
        epoch,
        descriptor,
        knownFresh,
      );
    }
  } else if (descriptor > 0) {
    return ctx.wrapLazyNode(
      state.documentHandle,
      token,
      descriptor,
      "",
      null,
      state,
      initialMemo,
      epoch,
      undefined,
      knownFresh,
    );
  }
  // Unknown/custom/non-HTML element: retain the ordinary native
  // classification path for exact prototype and namespace semantics.
  const existing = state.getWrapperByToken(token);
  if (existing !== undefined) return existing;
  return ctx.wrap(
    state.nativeMethods.materializeNodeToken(token),
    state,
  );
}
