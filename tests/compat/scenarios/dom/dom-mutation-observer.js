// Real differential scenario (T41): the public MutationObserver surface.
//
// Every observation is recorded synchronously inside the callback (the normal
// MutationObserver usage) so the recorded values never depend on re-reading a
// node wrapper after a later GC. Node identity is compared via `nodeType` (the
// frozen T23 contract lowercases element `nodeName` while happy-dom exposes the
// WHATWG uppercase spelling, so names would mask real parity).
export const id = "dom-mutation-observer";
export const description = "real differential: observe/disconnect/takeRecords, childList/attributes/characterData records, batching and microtask delivery";
export const targets = "real";

// Drains the microtask queue so queued observer deliveries fire.
async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function recordShape(record) {
  return {
    type: record.type,
    targetType: record.target.nodeType,
    added: record.addedNodes.map((node) => node.nodeType),
    removed: record.removedNodes.map((node) => node.nodeType),
    prev: record.previousSibling === null ? null : record.previousSibling.nodeType,
    next: record.nextSibling === null ? null : record.nextSibling.nodeType,
    attributeName: record.attributeName,
    oldValue: record.oldValue,
  };
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;
  const MutationObserverCtor = window.MutationObserver;

  try {
    // --- childList records: append and remove --------------------------------
    {
      const parent = document.createElement("parent");
      const a = document.createElement("a");
      const b = document.createElement("b");
      parent.appendChild(a);
      parent.appendChild(b);
      document.body.appendChild(parent);

      const batches = [];
      const observer = new MutationObserverCtor((records) => {
        batches.push(records.map(recordShape));
      });
      observer.observe(parent, { childList: true });

      const text = document.createTextNode("t");
      parent.appendChild(text);
      parent.removeChild(a);
      await flushMicrotasks();

      api.record.value("childlist-batches", batches);
    }

    // --- batching: same-task mutations arrive in one callback ---------------
    {
      const parent = document.createElement("parent");
      document.body.appendChild(parent);
      const batches = [];
      const observer = new MutationObserverCtor((records) => {
        batches.push(records.map((r) => r.type));
      });
      observer.observe(parent, { childList: true });

      parent.appendChild(document.createElement("x"));
      parent.appendChild(document.createElement("y"));
      parent.removeChild(parent.firstChild);
      await flushMicrotasks();
      api.record.value("batch-mutation-order", batches);
    }

    // --- attributes records with oldValue -----------------------------------
    {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const batches = [];
      const observer = new MutationObserverCtor((records) => {
        batches.push(records.map((r) => [r.type, r.attributeName, r.oldValue]));
      });
      observer.observe(el, { attributes: true });

      el.setAttribute("id", "x");
      el.setAttribute("id", "y");
      el.removeAttribute("id");
      await flushMicrotasks();
      api.record.value("attribute-batches", batches);
    }

    // --- characterData records with oldValue ---------------------------------
    {
      const text = document.createTextNode("hi");
      document.body.appendChild(text);
      const batches = [];
      const observer = new MutationObserverCtor((records) => {
        batches.push(records.map((r) => [r.type, r.oldValue]));
      });
      observer.observe(text, { characterData: true });

      text.data = "hello";
      text.appendData(" world");
      await flushMicrotasks();
      api.record.value("character-data-batches", batches);
    }

    // --- subtree observations -------------------------------------------------
    {
      const root = document.createElement("root");
      const mid = document.createElement("mid");
      root.appendChild(mid);
      document.body.appendChild(root);
      const batches = [];
      const subtree = new MutationObserverCtor((records) => {
        batches.push(records.map((r) => [r.target.nodeType, r.addedNodes.length]));
      });
      const direct = new MutationObserverCtor(() => batches.push(["direct-fired"]));
      subtree.observe(root, { childList: true, subtree: true });
      direct.observe(root, { childList: true, subtree: false });

      mid.appendChild(document.createElement("deep"));
      await flushMicrotasks();
      api.record.value("subtree-batches", batches);
    }

    // --- takeRecords returns records synchronously and suppresses delivery --
    {
      const parent = document.createElement("parent");
      document.body.appendChild(parent);
      const calls = [];
      const observer = new MutationObserverCtor((records) => calls.push(records.length));
      observer.observe(parent, { childList: true });

      parent.appendChild(document.createElement("x"));
      const taken = observer.takeRecords();
      await flushMicrotasks();
      api.record.value("take-records-shape", taken.map((r) => [r.type, r.addedNodes.length]));
      api.record.value("take-records-suppresses-callback", calls.length);

      parent.appendChild(document.createElement("y"));
      await flushMicrotasks();
      api.record.value("delivery-after-take-records", calls);
    }

    // --- two observed targets are delivered by two callbacks -----------------
    {
      const t1 = document.createElement("t1");
      const t2 = document.createElement("t2");
      document.body.appendChild(t1);
      document.body.appendChild(t2);
      const batches = [];
      const observer = new MutationObserverCtor((records) => {
        batches.push(`${records[0].target.nodeType}:${records.length}`);
      });
      observer.observe(t1, { childList: true });
      observer.observe(t2, { childList: true });

      t1.appendChild(document.createElement("c1"));
      t2.appendChild(document.createElement("c2"));
      await flushMicrotasks();
      api.record.value("per-listener-batches", batches);
    }

    // --- the callback receives the very observer constructed -----------------
    {
      const parent = document.createElement("parent");
      document.body.appendChild(parent);
      let identity = null;
      const observer = new MutationObserverCtor((_records, observed) => {
        identity = observed === observer;
      });
      observer.observe(parent, { childList: true });
      parent.appendChild(document.createElement("x"));
      await flushMicrotasks();
      api.record.value("callback-observer-identity", identity);
    }

    // --- disconnect stops delivery -------------------------------------------
    {
      const parent = document.createElement("parent");
      document.body.appendChild(parent);
      const calls = [];
      const observer = new MutationObserverCtor(() => calls.push(1));
      observer.observe(parent, { childList: true });
      observer.disconnect();
      parent.appendChild(document.createElement("x"));
      await flushMicrotasks();
      api.record.value("disconnect-suppresses-delivery", calls.length);
    }

    // --- option validation (baseline TypeError messages) ---------------------
    {
      const parent = document.createElement("parent");
      const observer = new MutationObserverCtor(() => {});
      const attempt = (fn) => {
        try {
          fn();
          return null;
        } catch (error) {
          api.record.error(error, "sync-throw");
        }
      };
      attempt(() => observer.observe(parent, {}));
      attempt(() => observer.observe(parent, { attributes: false, attributeOldValue: true }));
      attempt(() => observer.observe(parent, { characterDataOldValue: true, characterData: false }));
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
