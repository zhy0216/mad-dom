// Positive fixture: MutationObserver callback and record typing (T41).
// Covers: construction via `window.MutationObserver`, the callback signature
// (records + observer), the MutationRecord read surface, observe options
// (childList / attributes / characterData / subtree / old-value flags /
// attributeFilter), takeRecords and disconnect.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { Window } from "dom-under-test";

const window = new Window({ width: 1024, height: 768 });
const document = window.document;
const element = document.createElement("div");
if (document.body) {
  document.body.appendChild(element);
}

const observer = new window.MutationObserver((records, observed) => {
  const same: boolean = observed === observer;
  for (const record of records) {
    const type: string = record.type;
    const targetType: number = record.target.nodeType;
    const added = record.addedNodes;
    const removed = record.removedNodes;
    const prev = record.previousSibling;
    const next = record.nextSibling;
    const attributeName: string | null = record.attributeName;
    const attributeNamespace: string | null = record.attributeNamespace;
    const oldValue: string | null = record.oldValue;
    if (type === "attributes") {
      const name: string | null = attributeName;
      void name;
    }
    void [same, targetType, added, removed, prev, next, attributeNamespace, oldValue];
  }
});

observer.observe(element, { childList: true });
observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
observer.observe(element, { characterData: true, characterDataOldValue: true });
observer.observe(element, { subtree: true });

const taken = observer.takeRecords();
const firstType: string | undefined = taken[0]?.type;

observer.disconnect();

export const exported = { observer, taken, firstType };
