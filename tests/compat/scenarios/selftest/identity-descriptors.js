// Self-test pass scenario (T10): identity relation matrix, property descriptor
// shapes and a small DOM snapshot on which both mock variants agree.
export const id = "selftest-identity-descriptors";
export const description = "self-test pass: identity relations, descriptor shapes (data/accessor/missing) and an agreeing DOM snapshot";
export const targets = "mock";

export async function run(api) {
  const element = api.dom.createElement("section");
  // Letter-free character data: mock-fail's seeded text-casing bug (bug 4 in
  // mocks.js) must not be visible in this agreeing pass scenario.
  const text = api.dom.createText("42");
  element.appendChild(text);

  api.record.identity("element-is-itself", element, element);
  api.record.identity("element-is-not-text", element, text);
  api.record.identity("first-child-is-text", element.childNodes[0], text);
  api.record.identity("distinct-elements", api.dom.createElement("a"), api.dom.createElement("a"));

  api.record.descriptor("element-node-name", element, "nodeName");
  api.record.descriptor("element-tag-lower-accessor", element, "tagLower");
  api.record.descriptor("element-child-nodes", element, "childNodes");
  api.record.descriptor("element-missing-property", element, "doesNotExist");

  api.record.snapshot("tree", element);
}
