// Real differential scenario (T43): the public Shadow DOM surface.
//
// Records the T43 slice: `attachShadow` (open/closed mode), the
// `ShadowRoot` wrapper (`host` / `mode` / `nodeType` / `instanceof`), the
// structural query / navigation / serialization boundary (a host's light DOM,
// queries and outerHTML never pierce into the shadow tree, and a shadow
// root's own tree is reachable through the root), the shadow-including
// `isConnected`, the composed vs non-composed propagation order across the
// boundary (listeners on the host and beyond fire only for `composed` events,
// `event.target` stays the leaf — the baseline performs no retargeting) and
// the basic named slot assignment (`assignedNodes` / `assignedElements`).
//
// The scenario deliberately stays on the behaviors the single-class facade
// matches: no `nodeName` reads (the frozen T23A casing gap and the shadow
// root's empty `nodeName` in happy-dom), no `composedPath` of a *composed*
// event (happy-dom includes the document→window hop, which lands with T45),
// no `attachShadow` error shape (the T21A napi4 error degradation), and no
// `instanceof Node`/`HTMLElement` reads on the root (the single-class
// prototype chain). The composed *path* is pinned by the non-composed
// `composedPath` (both report the target followed by the shadow root) and the
// composed listener order.
export const id = "dom-shadow-dom";
export const description = "real differential: attachShadow open/closed, ShadowRoot host/mode, structural query/navigation/serialization boundary, shadow-including isConnected, composed vs non-composed propagation order, and basic named slot assignment";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    // --- attachShadow basics: open root, wrapper shape, identity ------------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      api.record.value("mode", root.mode);
      api.record.value("host-equals", root.host === host);
      api.record.value("shadowRoot-equals", host.shadowRoot === root);
      api.record.value("root-nodeType", root.nodeType);
      api.record.value("root-instanceof-shadowroot", root instanceof window.ShadowRoot);
      api.record.identity("shadowRoot-host-reciprocal", host.shadowRoot, root);
    }

    // --- structural boundary: navigation, queries, serialization -----------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      inner.textContent = "x";
      root.appendChild(inner);
      const light = document.createElement("em");
      host.appendChild(light);

      api.record.value("host-childNodes-length", host.childNodes.length);
      api.record.value("root-childNodes-length", root.childNodes.length);
      api.record.value("inner-parent-is-root", inner.parentNode === root);
      api.record.value("root-parent-is-null", root.parentNode === null);
      api.record.value("host-query-pierces", host.querySelector("span"));
      api.record.value("root-query-finds-inner", root.querySelector("span") === inner);
      api.record.value("host-innerHTML", host.innerHTML);
      api.record.value("root-innerHTML", root.innerHTML);
      api.record.value("host-outerHTML", host.outerHTML);
    }

    // --- shadow-including isConnected ---------------------------------------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      root.appendChild(inner);
      api.record.value("detached-inner-isConnected", inner.isConnected);
      document.body.appendChild(host);
      api.record.value("connected-inner-isConnected", inner.isConnected);
      api.record.value("connected-root-isConnected", root.isConnected);
      document.body.removeChild(host);
      api.record.value("removed-inner-isConnected", inner.isConnected);
    }

    // --- closed roots never leak through the public surface -----------------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "closed" });
      api.record.value("closed-host-shadowRoot", host.shadowRoot);
      api.record.value("closed-root-mode", root.mode);
      api.record.value("closed-root-host", root.host === host);
      api.record.value("closed-root-instanceof-shadowroot", root instanceof window.ShadowRoot);
    }

    // --- propagation order: composed vs non-composed across the boundary -----
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      root.appendChild(inner);
      document.body.appendChild(host);

      const on = (node, capture) => (event) =>
        api.record.event("evt", { node: node === host ? "host" : node === root ? "root" : "inner", phase: event.eventPhase, targetIsInner: event.target === inner });
      host.addEventListener("evt", on(host, true), { capture: true });
      root.addEventListener("evt", on(root, true), { capture: true });
      inner.addEventListener("evt", on(inner, true), { capture: true });
      inner.addEventListener("evt", on(inner, false));
      root.addEventListener("evt", on(root, false));
      host.addEventListener("evt", on(host, false));

      inner.dispatchEvent(new window.Event("evt", { bubbles: true, composed: false }));
      api.record.event("evt", { role: "non-composed-done" });
      inner.dispatchEvent(new window.Event("evt", { bubbles: true, composed: true }));
      api.record.event("evt", { role: "composed-done" });
    }

    // --- composedPath of a non-composed event stops at the shadow root -------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      root.appendChild(inner);
      document.body.appendChild(host);
      const event = new window.Event("evt", { bubbles: true, composed: false });
      inner.dispatchEvent(event);
      api.record.value("non-composed-path-nodeTypes", event.composedPath().map((n) => n.nodeType));
      api.record.value("non-composed-path-target", event.composedPath()[0] === inner);
    }

    // --- basic named slot assignment ----------------------------------------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const named = document.createElement("slot");
      named.setAttribute("name", "one");
      const fallback = document.createElement("slot");
      root.appendChild(named);
      root.appendChild(fallback);
      const a = document.createElement("span");
      a.setAttribute("slot", "one");
      a.textContent = "A";
      const b = document.createElement("span");
      b.textContent = "B";
      host.appendChild(a);
      host.appendChild(b);

      api.record.value("slot-a", a.slot);
      api.record.value("slot-b", b.slot);
      api.record.value("named-assignedNodes", named.assignedNodes().map((n) => n.textContent));
      api.record.value("named-assignedElements", named.assignedElements().map((n) => n.textContent));
      api.record.value("fallback-assignedNodes", fallback.assignedNodes().map((n) => n.textContent));
      api.record.value("flatten-assignedNodes", named.assignedNodes({ flatten: true }).map((n) => n.textContent));
    }

    // --- clone / serialization baseline -------------------------------------
    {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      const inner = document.createElement("span");
      root.appendChild(inner);
      host.appendChild(document.createElement("i"));
      const clone = host.cloneNode(true);
      api.record.value("clone-shadowRoot", clone.shadowRoot);
      api.record.value("clone-childNodes-length", clone.childNodes.length);
      api.record.value("clone-outerHTML", clone.outerHTML);
      api.record.value("root-innerHTML-after-clone", root.innerHTML);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
