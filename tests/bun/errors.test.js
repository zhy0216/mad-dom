import { describe, expect, test } from "bun:test";
import { createDocument, isNativeAvailable } from "../../index.js";

// T21 error-boundary fixtures — the T21A error taxonomy exercised end to end
// through the official package dev entry (index.js → build/mad-dom.node).
//
// The taxonomy maps Core errors to four JS classes (TypeError for argument
// misuse, SyntaxError for parse failures, DOMException for DOM-spec
// violations, plain Error for lifecycle/internal failures). napi4 — the pinned
// feature level — has no DOMException constructor or `throw_syntax_error`, so
// the DOMException and SyntaxError kinds are raised as a controlled plain
// `Error` that keeps the stable `code` and embeds the frozen `name`. These
// fixtures pin that observable shape, the call timing (a failing mutation
// leaves the tree untouched) and the stable, template-built messages.
//
// The input classes with a reachable surface today: strings (element/text/
// comment data), object types (napi handle coercion), documents (cross-
// document misuse) and NodeIds (via a destroyed document). Number-range and
// index validation has no index-taking native entry yet; it lands with the
// index-taking APIs (T25D live child nodelist) through the same wiring.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.skipIf(!nativeAvailable)("native error taxonomy (T21)", () => {
  test("string validation: invalid element names are InvalidCharacter errors", () => {
    const doc = createDocument();
    const err = thrown(() => doc.createElement("1div"));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    expect(err.message).toContain("InvalidCharacterError");
    expect(err.message).toContain("invalid character in element name");

    // Empty and whitespace-only names are rejected the same way.
    expect(thrown(() => doc.createElement("")).code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    expect(thrown(() => doc.createElement(" ")).code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    doc.destroy();
  });

  test("character data stores NUL verbatim (T48B text-data alignment)", () => {
    const doc = createDocument();
    const text = doc.createText("a\u0000b");
    expect(text.data()).toBe("a\u0000b");

    const comment = doc.createComment("a\u0000b");
    expect(comment.data()).toBe("a\u0000b");
    doc.destroy();
  });

  test("hierarchy violations are HierarchyRequestError errors", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    const err = thrown(() => doc.appendChild(div, div));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(err.message).toContain("HierarchyRequestError");
    doc.destroy();
  });

  test("cross-document misuse is WrongDocumentError, never misread", () => {
    const docA = createDocument();
    const docB = createDocument();
    const elA = docA.createElement("from-a");
    const targetB = docB.createElement("from-b");

    const err = thrown(() => docB.appendChild(targetB, elA));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(err.message).toContain("WrongDocumentError");

    // Both handles stay fully usable and unmutated.
    expect(elA.nodeName()).toBe("from-a");
    expect(targetB.nodeName()).toBe("from-b");
    expect(targetB.childNodes()).toHaveLength(0);
    docA.destroy();
    docB.destroy();
  });

  test("a destroyed document fails every later call with a stable lifecycle error", () => {
    const doc = createDocument();
    const div = doc.createElement("div");
    const text = doc.createText("x");
    doc.appendChild(div, text);
    doc.destroy();

    const calls = [
      () => doc.createElement("span"),
      () => doc.createText("x"),
      () => div.nodeName(),
      () => div.parentNode(),
      () => div.childNodes(),
      () => doc.appendChild(div, text),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every call on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
      expect(err.message).toBe(
        "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
      );
    }
  });

  test("failed mutations leave the tree untouched (error timing)", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    doc.appendChild(parent, a);

    // A failing cross-document append must not partially mutate anything.
    const docB = createDocument();
    const foreign = docB.createElement("span");
    expect(thrown(() => doc.appendChild(parent, foreign)).code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(parent.childNodes()).toHaveLength(1);
    expect(a.parentNode()).toBe(parent);

    // A failing hierarchy append must not attach anything either.
    const err = thrown(() => doc.appendChild(a, parent));
    expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(a.childNodes()).toHaveLength(0);
    expect(parent.childNodes()).toHaveLength(1);

    doc.destroy();
    docB.destroy();
  });

  test("wrong object types fail with controlled napi errors, not crashes", () => {
    const doc = createDocument();
    const div = doc.createElement("div");

    // Where a NodeHandle is required, non-handle values are rejected by the
    // napi conversion boundary with a controlled error.
    for (const bad of [42, null, undefined, {}, "div", Symbol("x")]) {
      const err = thrown(() => doc.appendChild(div, bad));
      expect(err, `appendChild(child = ${String(bad)}) must fail`).toBeInstanceOf(Error);
      expect(err.code).toBe("InvalidArg");
    }

    // String parameters are converted by napi; a non-string is rejected with
    // a controlled StringExpected error rather than coerced or crashed.
    const err = thrown(() => doc.createElement(42));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("StringExpected");

    doc.destroy();
  });
});
