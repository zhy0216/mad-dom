// Deliberately divergent self-test scenario (T10).
//
// Expected differences between mock-pass and mock-fail (seeded bugs 1, 4, 5):
//
//   events[1].name / events[2].name        — mock-fail delivers the pipeline
//                                            events in swapped order;
//   snapshots.tree.attributes.id           — mock-fail silently drops the
//                                            "id" attribute (left-only);
//   snapshots.tree.children[0].data        — mock-fail uppercases character
//                                            data ("hello" vs "HELLO");
//   snapshots.tree.outerHTML               — the divergent serialization
//                                            output, compared verbatim.
export const id = "selftest-dom-snapshot-events";
export const description = "deliberately divergent: DOM snapshot (attributes/text/serialization) and event delivery order differ between the mock targets";
export const targets = "mock";

export async function run(api) {
  const root = api.dom.createElement("div");
  root.setAttribute("class", "box");
  root.setAttribute("id", "root");
  root.appendChild(api.dom.createText("hello"));
  api.record.snapshot("tree", root);
  api.dom.emitPipeline((name, detail) => api.record.event(name, detail));
}
