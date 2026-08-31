// WebSocket facade extension (integration-test surface).
//
// Installs `window.WebSocket`. Bun ships a WHATWG-compliant client WebSocket
// (EventTarget surface: `addEventListener` / `onopen` / `onmessage` / `onerror`
// / `onclose`, plus `send()` / `close(code, reason)`), which already satisfies
// the happy-dom integration surface used by WebSocket.test.js, so the window
// accessor hands out that global constructor unchanged.

import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/web-socket",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

export function install(ctx) {
  ctx.defineAccessor(Window.prototype, "WebSocket", function getWebSocket() {
    return globalThis.WebSocket;
  }, undefined);
}
