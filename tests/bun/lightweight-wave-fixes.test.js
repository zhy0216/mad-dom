import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";

// T08 facade-fix backing tests.
//
// The vendored rewritten suite enabled by T08 is the primary evidence for the
// facade/core fixes below; these tests pin the fixed surface in isolation so a
// regression is caught directly:
//
//   - ValidityState constraint flags read reflected pattern/max/min/step/
//     maxLength/minLength attributes (T08 added the reflections);
//   - MutationRecord exposes own enumerable data properties (the vendored
//     `toEqual` comparison needs the upstream own-property shape);
//   - MutationObserver can observe the document node itself;
//   - `happyDOM.close()` disconnects the window's observers;
//   - FormData constructs from an HTMLFormElement (+ files / submitter) and
//     validates `append(name, value, filename)`.

const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("T08 ValidityState reflected attributes", () => {
  test("pattern / max / min / step / maxLength / minLength reflect to attributes", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const input = doc.createElement("input");
      input.pattern = "[0-9]+";
      input.max = "9";
      input.min = "1";
      input.step = "2";
      input.maxLength = 5;
      input.minLength = 2;
      expect(input.getAttribute("pattern")).toBe("[0-9]+");
      expect(input.getAttribute("max")).toBe("9");
      expect(input.getAttribute("min")).toBe("1");
      expect(input.getAttribute("step")).toBe("2");
      expect(input.getAttribute("maxlength")).toBe("5");
      expect(input.getAttribute("minlength")).toBe("2");

      input.value = "10";
      input.type = "number";
      expect(input.validity.rangeOverflow).toBe(true);
      expect(input.validity.stepMismatch).toBe(false);
      input.value = "9";
      expect(input.validity.stepMismatch).toBe(true);
      expect(input.validity.rangeUnderflow).toBe(false);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 MutationRecord own-property shape", () => {
  test("records carry own enumerable data properties", async () => {
    const win = new Window();
    try {
      const doc = win.document;
      let records = [];
      const div = doc.createElement("div");
      const observer = new win.MutationObserver((mutationRecords) => {
        records = mutationRecords;
      });
      observer.observe(div, { attributes: true });
      div.setAttribute("attr", "value");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(Object.keys(record).sort()).toEqual([
        "addedNodes",
        "attributeName",
        "attributeNamespace",
        "nextSibling",
        "oldValue",
        "previousSibling",
        "removedNodes",
        "target",
        "type",
      ]);
      expect(record.type).toBe("attributes");
      expect(record.attributeName).toBe("attr");
      expect(record.target).toBe(div);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 MutationObserver document observe", () => {
  test("can observe the document node with subtree", async () => {
    const win = new Window();
    try {
      const doc = win.document;
      let records = [];
      const div = doc.createElement("div");
      doc.body.appendChild(div);
      const observer = new win.MutationObserver((mutationRecords) => {
        records = mutationRecords;
      });
      observer.observe(doc, { attributes: true, subtree: true });
      div.setAttribute("attr", "value");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("attributes");
      expect(records[0].target).toBe(div);
    } finally {
      win.destroy();
    }
  });

  test("happyDOM.close() disconnects the window's observers", async () => {
    const win = new Window();
    try {
      const doc = win.document;
      let records = [];
      const div = doc.createElement("div");
      doc.body.appendChild(div);
      const observer = new win.MutationObserver((mutationRecords) => {
        records = mutationRecords;
      });
      observer.observe(div, { attributes: true });
      await win.happyDOM.close();
      div.setAttribute("attr", "value");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(records).toEqual([]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T08 FormData form constructor", () => {
  test("reads successful controls (files, checked radio/checkbox, submitter)", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const form = doc.createElement("form");
      const text = doc.createElement("input");
      text.type = "text";
      text.name = "text";
      text.value = "value";
      const fileInput = doc.createElement("input");
      fileInput.type = "file";
      fileInput.name = "file";
      const file = new win.File(["content"], "file.txt", { type: "text/plain" });
      fileInput.files.push(file);
      const radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "radio";
      radio.value = "1";
      radio.checked = true;
      const button = doc.createElement("button");
      button.name = "button";
      button.value = "click";
      form.appendChild(text);
      form.appendChild(fileInput);
      form.appendChild(radio);
      form.appendChild(button);
      doc.body.appendChild(form);

      const formData = new win.FormData(form, button);
      expect(formData.get("text")).toBe("value");
      expect(formData.get("file")).toBe(file);
      expect(formData.get("radio")).toBe("1");
      expect(formData.get("button")).toBe("click");
    } finally {
      win.destroy();
    }
  });

  test("append rejects a filename on a non-Blob value", () => {
    const win = new Window();
    try {
      const formData = new win.FormData();
      expect(() => formData.append("key", "value", "filename")).toThrow(
        'Failed to execute "append" on "FormData": parameter 2 is not of type "Blob".',
      );
    } finally {
      win.destroy();
    }
  });
});
