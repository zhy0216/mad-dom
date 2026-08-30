// Real differential scenario (T37): the EventTarget surface.
//
// Scope is exactly the T37 slice — addEventListener / removeEventListener /
// dispatchEvent, the capture/at-target/bubbling struct order over the DOM
// tree, stopPropagation / stopImmediatePropagation / preventDefault and the
// dispatchEvent return value, the once/capture/passive/signal options, and the
// reentrancy guarantees (listeners added mid-dispatch are snapshotted out,
// listeners removed mid-struct still run, the propagation path is fixed under
// tree mutation, nested dispatches complete before the outer resumes, and a
// completed event can be re-dispatched).
//
// The observations use eventPhase numbers, dispatchEvent return values,
// identity relations and ordered `record.event` calls — never element
// `nodeName` (the frozen T23A casing gap), never errors (the T21A napi4 error
// degradation) and never descriptor probes (the recorded prototype-layout
// gap). Same-event nested dispatch is deliberately absent: happy-dom recurses
// forever there and MAD DOM rejects it, so it is covered by the Bun tests
// instead.
export const id = "dom-events";
export const description = "real differential: addEventListener/removeEventListener/dispatchEvent, capture/target/bubble order, stopPropagation/stopImmediatePropagation/preventDefault, once/capture/passive/signal and reentrancy";
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
    document.body.innerHTML = '<div id="mid"><span id="leaf">leaf</span></div>';
    const body = document.body;
    const mid = document.getElementById("mid");
    const leaf = document.getElementById("leaf");
    const Event = window.Event;

    // 1. Full struct order with phases.
    {
      const e = new Event("evt", { bubbles: true, cancelable: true });
      document.addEventListener("evt", (event) => api.record.event("evt", { role: "doc-capture", phase: event.eventPhase }), { capture: true });
      body.addEventListener("evt", (event) => api.record.event("evt", { role: "body-capture", phase: event.eventPhase }), { capture: true });
      mid.addEventListener("evt", (event) => api.record.event("evt", { role: "mid-capture", phase: event.eventPhase }), { capture: true });
      leaf.addEventListener("evt", (event) => api.record.event("evt", { role: "leaf-capture", phase: event.eventPhase }), { capture: true });
      leaf.addEventListener("evt", (event) => api.record.event("evt", { role: "leaf-target", phase: event.eventPhase }));
      mid.addEventListener("evt", (event) => api.record.event("evt", { role: "mid-bubble", phase: event.eventPhase }));
      body.addEventListener("evt", (event) => api.record.event("evt", { role: "body-bubble", phase: event.eventPhase }));
      document.addEventListener("evt", (event) => api.record.event("evt", { role: "doc-bubble", phase: event.eventPhase }));
      api.record.value("struct-order-return", leaf.dispatchEvent(e));
    }

    // 2. Target / currentTarget identity during a dispatch, and the state
    // after it.
    {
      const e = new Event("evt2", { bubbles: true });
      let seen = {};
      mid.addEventListener("evt2", (event) => {
        seen = {
          target: event.target === leaf,
          currentTarget: event.currentTarget === mid,
          targetNull: event.target === null,
        };
      }, { capture: true });
      leaf.dispatchEvent(e);
      api.record.value("target-is-leaf", seen.target);
      api.record.value("current-target-is-mid", seen.currentTarget);
      api.record.value("target-null", seen.targetNull);
      api.record.value("after-phase", e.eventPhase);
      api.record.value("after-current-target-null", e.currentTarget === null);
      api.record.identity("after-target-is-leaf", e.target, leaf);
    }

    // 3. Registration order within a struct.
    {
      const e = new Event("evt3", { bubbles: true });
      leaf.addEventListener("evt3", () => api.record.event("evt3", { role: "first" }));
      leaf.addEventListener("evt3", () => api.record.event("evt3", { role: "second" }));
      leaf.addEventListener("evt3", () => api.record.event("evt3", { role: "third" }));
      leaf.dispatchEvent(e);
    }

    // 4. Duplicate registration (same callback, same bucket) is a no-op; the
    // capture bucket is a separate registration that runs first at the target.
    {
      const e = new Event("evt4", { bubbles: true });
      const handler = () => api.record.event("evt4", { role: "handler" });
      leaf.addEventListener("evt4", handler);
      leaf.addEventListener("evt4", handler);
      leaf.addEventListener("evt4", handler, { capture: true });
      leaf.dispatchEvent(e);
    }

    // 5. removeEventListener removes the matching callback (bubbling bucket
    // first; the capture flag is ignored, matching the baseline).
    {
      const e = new Event("evt5", { bubbles: true });
      const drop = () => api.record.event("evt5", { role: "drop" });
      leaf.addEventListener("evt5", drop, { capture: true });
      leaf.removeEventListener("evt5", drop);
      leaf.dispatchEvent(e);
      api.record.event("evt5", { role: "after-removal" });
    }

    // 6. stopPropagation ends the dispatch after the current target's
    // listeners; stopImmediatePropagation ends it immediately.
    {
      const e = new Event("evt6", { bubbles: true });
      mid.addEventListener("evt6", () => api.record.event("evt6", { role: "mid-capture" }), { capture: true });
      leaf.addEventListener("evt6", () => api.record.event("evt6", { role: "leaf-1" }));
      leaf.addEventListener("evt6", (event) => {
        api.record.event("evt6", { role: "leaf-2" });
        event.stopPropagation();
      });
      leaf.addEventListener("evt6", () => api.record.event("evt6", { role: "leaf-3" }));
      mid.addEventListener("evt6", () => api.record.event("evt6", { role: "mid-bubble" }));
      leaf.dispatchEvent(e);
    }
    {
      const e = new Event("evt6b", { bubbles: true });
      leaf.addEventListener("evt6b", (event) => {
        api.record.event("evt6b", { role: "1" });
        event.stopImmediatePropagation();
      });
      leaf.addEventListener("evt6b", () => api.record.event("evt6b", { role: "2" }));
      leaf.dispatchEvent(e);
    }

    // 7. preventDefault and the dispatchEvent return value respect cancelable
    // and passive.
    {
      const cancelable = new Event("evt7", { bubbles: true, cancelable: true });
      leaf.addEventListener("evt7", (event) => event.preventDefault());
      api.record.value("prevent-default-return", leaf.dispatchEvent(cancelable));
      api.record.value("prevent-default-flag", cancelable.defaultPrevented);
    }
    {
      const notCancelable = new Event("evt7b", { bubbles: true, cancelable: false });
      leaf.addEventListener("evt7b", (event) => event.preventDefault());
      api.record.value("non-cancelable-return", leaf.dispatchEvent(notCancelable));
      api.record.value("non-cancelable-flag", notCancelable.defaultPrevented);
    }
    {
      const passive = new Event("evt7c", { bubbles: true, cancelable: true });
      leaf.addEventListener("evt7c", (event) => event.preventDefault(), { passive: true });
      api.record.value("passive-return", leaf.dispatchEvent(passive));
      api.record.value("passive-flag", passive.defaultPrevented);
    }

    // 8. once removes the listener after its first invocation.
    {
      const e1 = new Event("evt8", { bubbles: true });
      leaf.addEventListener("evt8", () => api.record.event("evt8", { role: "once" }), { once: true });
      leaf.dispatchEvent(e1);
      const e2 = new Event("evt8", { bubbles: true });
      leaf.dispatchEvent(e2);
      api.record.event("evt8", { role: "done" });
    }

    // 9. A non-bubbling event stops after the target.
    {
      const e = new Event("evt9", { bubbles: false });
      mid.addEventListener("evt9", () => api.record.event("evt9", { role: "mid-capture" }), { capture: true });
      leaf.addEventListener("evt9", () => api.record.event("evt9", { role: "leaf-target" }));
      mid.addEventListener("evt9", () => api.record.event("evt9", { role: "mid-bubble" }));
      leaf.dispatchEvent(e);
    }

    // 10. Dispatching on the document targets the document root.
    {
      const e = new Event("evt10", { bubbles: true });
      document.addEventListener("evt10", (event) => {
        api.record.event("evt10", { role: "doc-root", phase: event.eventPhase, targetNodeType: event.target.nodeType });
      });
      document.dispatchEvent(e);
    }

    // 11. Reentrancy: a listener added mid-dispatch is not invoked by it;
    // a listener removed mid-struct still runs (the snapshot).
    {
      const e = new Event("evt11", { bubbles: true });
      leaf.addEventListener("evt11", () => {
        api.record.event("evt11", { role: "trigger" });
        leaf.addEventListener("evt11", () => api.record.event("evt11", { role: "added" }));
      });
      leaf.dispatchEvent(e);
      const e2 = new Event("evt11", { bubbles: true });
      leaf.dispatchEvent(e2);
    }
    {
      const e = new Event("evt11b", { bubbles: true });
      const victim = () => api.record.event("evt11b", { role: "victim" });
      leaf.addEventListener("evt11b", () => {
        api.record.event("evt11b", { role: "remover" });
        leaf.removeEventListener("evt11b", victim);
      });
      leaf.addEventListener("evt11b", victim);
      leaf.dispatchEvent(e);
      const e2 = new Event("evt11b", { bubbles: true });
      leaf.dispatchEvent(e2);
    }

    // 12. Mutating the tree during dispatch does not change the path.
    {
      const e = new Event("evt12", { bubbles: true });
      document.addEventListener("evt12", () => api.record.event("evt12", { role: "doc-capture" }), { capture: true });
      mid.addEventListener("evt12", () => {
        api.record.event("evt12", { role: "mid-capture" });
        leaf.parentNode.removeChild(leaf);
      }, { capture: true });
      leaf.addEventListener("evt12", () => api.record.event("evt12", { role: "leaf-target" }));
      body.addEventListener("evt12", () => api.record.event("evt12", { role: "body-bubble" }));
      leaf.dispatchEvent(e);
    }

    // 13. A nested dispatch completes before the outer dispatch resumes.
    {
      const e = new Event("evt13", { bubbles: true });
      leaf.addEventListener("evt13", () => {
        api.record.event("evt13", { role: "outer-leaf" });
        mid.dispatchEvent(new Event("evt13-inner", { bubbles: true }));
      });
      mid.addEventListener("evt13", () => api.record.event("evt13", { role: "outer-mid" }));
      mid.addEventListener("evt13-inner", () => api.record.event("evt13", { role: "inner-mid" }));
      leaf.dispatchEvent(e);
    }

    // 14. A completed event can be dispatched again and keeps defaultPrevented.
    {
      const e = new Event("evt14", { bubbles: true, cancelable: true });
      leaf.addEventListener("evt14", (event) => event.preventDefault());
      api.record.value("redispatch-1", leaf.dispatchEvent(e));
      api.record.value("redispatch-2", leaf.dispatchEvent(e));
      api.record.value("redispatch-flag", e.defaultPrevented);
    }

    // 15. The listener's `this` is the current target.
    {
      const e = new Event("evt15", { bubbles: true });
      leaf.addEventListener("evt15", function () {
        api.record.event("evt15", { role: "leaf", thisIsLeaf: this === leaf });
      });
      mid.addEventListener("evt15", function () {
        api.record.event("evt15", { role: "mid", thisIsMid: this === mid });
      });
      leaf.dispatchEvent(e);
    }

    // 16. An object listener's handleEvent is invoked.
    {
      const e = new Event("evt16", { bubbles: true });
      const listener = {
        handleEvent(event) {
          api.record.event("evt16", { role: "handleEvent", type: event.type });
        },
      };
      leaf.addEventListener("evt16", listener);
      leaf.dispatchEvent(e);
    }

    // 17. A signal abort removes the listener.
    {
      const signal = {
        aborted: false,
        _handlers: [],
        addEventListener(type, handler) {
          if (type === "abort") this._handlers.push(handler);
        },
        abort() {
          this.aborted = true;
          for (const handler of this._handlers) handler();
        },
      };
      leaf.addEventListener("evt17", () => api.record.event("evt17", { role: "signal" }), { signal });
      leaf.dispatchEvent(new Event("evt17", { bubbles: true }));
      signal.abort();
      leaf.dispatchEvent(new Event("evt17", { bubbles: true }));
      api.record.event("evt17", { role: "done" });
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
