// Positive fixture: the T43 Shadow DOM type surface.
//
// Exercises the `ShadowRoot` type on the mad-dom target: the shadow-root reads
// (host / mode), the inherited DocumentFragment/Node surface (innerHTML,
// isConnected, nodeType) and the assignability of the mode. Instances are typed
// through function parameters: happy-dom's per-class d.ts mangles the
// Element.attachShadow / Element.shadowRoot member names, so a shared fixture
// cannot call them (no window construction on either target; `new Window()` is
// the package-entry path since T48E).
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { Element, ShadowRoot } from "dom-under-test";

function useShadowRootSurface(host: Element, root: ShadowRoot): void {
  // ShadowRoot-specific reads.
  const mode: string = root.mode;
  const hostElement: Element | null = root.host;

  // The inherited DocumentFragment / Node surface is reachable on a root.
  const html: string = root.innerHTML;
  const connected: boolean = root.isConnected;
  const nodeType: number = root.nodeType;
  const parent: ShadowRoot["host"] = null;

  const result = { mode, hostElement, html, connected, nodeType, parent };
  void result;
}

export const exported = { useShadowRootSurface };
