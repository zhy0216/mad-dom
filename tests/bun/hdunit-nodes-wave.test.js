// hdunit nodes wave (T06) facade integration tests.
//
// Exercises the T06 facade additions that the vendored happy-dom node tests
// enabled: per-window `Text` / `Comment` constructor minting and the
// CharacterData surface, `Node.ownerDocument` identity, the `Symbol.toStringTag`
// `[object <Name>]` contract, element URL reflection (`cite` / `href` / `src`),
// the per-tag reflected attributes, the `on<event>` handler-attribute accessors,
// the `details` summary-toggle default action, the `dialog` show/close
// state machine, the `options` collection add/remove/selectedIndex surface, the
// table-section `insertRow` / `deleteRow`, and `labels` resolution.
//
// Each fix in js/facade/extensions/hdunit-nodes.js (and the small wiring
// additions in forms.js / html-element.js / window-platform.js) is pinned by at
// least one assertion here, matching the happy-dom behavior the rewritten tests
// observed.
import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "../../index.js";
import { Comment, Text } from "../../js/facade/extensions/classes.js";
import { Event } from "../../js/facade/extensions/events.js";

const createdWindows = [];
function freshWindow(options) {
  const win = options === undefined ? new Window() : new Window(options);
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) win.destroy();
});

describe("T06 character-data classes and ownerDocument", () => {
  test("new window.Text / new window.Comment mint detached nodes", () => {
    const window = freshWindow();
    const text = new window.Text("hello");
    expect(text).toBeInstanceOf(Text);
    expect(text.data).toBe("hello");
    expect(text.nodeName).toBe("#text");
    expect(text.toString()).toBe("[object Text]");
    expect(Object.prototype.toString.call(text)).toBe("[object Text]");

    const comment = new window.Comment("hi");
    expect(comment).toBeInstanceOf(Comment);
    expect(comment.data).toBe("hi");
    expect(comment.nodeName).toBe("#comment");
    expect(comment.toString()).toBe("[object Comment]");
    expect(Object.prototype.toString.call(comment)).toBe("[object Comment]");
  });

  test("document.createComment produces a comment node", () => {
    const window = freshWindow();
    const node = window.document.createComment("x");
    expect(node.nodeName).toBe("#comment");
    expect(node.data).toBe("x");
  });

  test("ownerDocument is identity-stable with window.document (detached too)", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElement("div");
    const text = document.createTextNode("t");
    expect(element.ownerDocument).toBe(document);
    expect(text.ownerDocument).toBe(document);
    expect(element.ownerDocument).toBe(window.document);
  });

  test("Text.wholeText combines adjacent text nodes", () => {
    const window = freshWindow();
    const document = window.document;
    const body = document.body;
    const node1 = document.createTextNode("Hello");
    const node2 = document.createTextNode(" ");
    const node3 = document.createTextNode("World");
    body.append(node1, node2, node3);
    expect(node1.wholeText).toBe("Hello World");
    expect(node3.wholeText).toBe("Hello World");
  });

  test("Text.splitText validates offsets like happy-dom", () => {
    const window = freshWindow();
    const document = window.document;
    const node = document.createTextNode("test");
    document.body.append(node);
    const tail = node.splitText(2);
    expect(node.data).toBe("te");
    expect(tail.data).toBe("st");
    expect(node.nextSibling).toBe(tail);
    expect(() => node.splitText(-1)).toThrow(DOMException);
    expect(() => node.splitText(5)).toThrow(DOMException);
  });
});

describe("T06 Symbol.toStringTag and per-tag classes", () => {
  test("Object.prototype.toString reports the concrete class", () => {
    const window = freshWindow();
    const document = window.document;
    expect(Object.prototype.toString.call(document.createElement("meta"))).toBe(
      "[object HTMLMetaElement]",
    );
    expect(Object.prototype.toString.call(document.createElement("option"))).toBe(
      "[object HTMLOptionElement]",
    );
    expect(Object.prototype.toString.call(document.createElement("dialog"))).toBe(
      "[object HTMLDialogElement]",
    );
  });
});

describe("T06 element URL reflection", () => {
  test("cite / href / src resolve against the window location", () => {
    const window = freshWindow();
    const document = window.document;
    window.happyDOM.setURL("https://localhost:8080/test/path/");
    expect(window.location.href).toBe("https://localhost:8080/test/path/");

    const quote = document.createElement("blockquote");
    quote.setAttribute("cite", "test");
    expect(quote.cite).toBe("https://localhost:8080/test/path/test");

    const base = document.createElement("base");
    base.setAttribute("href", "sub/");
    expect(base.href).toBe("https://localhost:8080/test/path/sub/");

    const embed = document.createElement("embed");
    embed.setAttribute("src", "file.bin");
    expect(embed.src).toBe("https://localhost:8080/test/path/file.bin");
  });

  test("cite reflects the raw attribute when resolution fails", () => {
    const window = freshWindow();
    const element = window.document.createElement("q");
    element.setAttribute("cite", "test");
    expect(element.cite).toBe("test");
  });
});

describe("T06 reflected attributes", () => {
  test("meta content/httpEquiv/name/scheme", () => {
    const window = freshWindow();
    const meta = window.document.createElement("meta");
    meta.content = "v";
    meta.httpEquiv = "refresh";
    meta.name = "viewport";
    meta.scheme = "s";
    expect(meta.getAttribute("content")).toBe("v");
    expect(meta.getAttribute("http-equiv")).toBe("refresh");
    expect(meta.getAttribute("name")).toBe("viewport");
    expect(meta.getAttribute("scheme")).toBe("s");
    expect(meta.httpEquiv).toBe("refresh");
  });

  test("li value and ol reversed/start/type", () => {
    const window = freshWindow();
    const document = window.document;
    const li = document.createElement("li");
    expect(li.value).toBe(0);
    li.value = 42;
    expect(li.getAttribute("value")).toBe("42");

    const ol = document.createElement("ol");
    expect(ol.reversed).toBe(false);
    expect(ol.start).toBe(1);
    ol.reversed = true;
    ol.start = 5;
    ol.type = "a";
    expect(ol.getAttribute("reversed")).toBe("");
    expect(ol.getAttribute("start")).toBe("5");
    expect(ol.getAttribute("type")).toBe("a");
  });

  test("time dateTime and data value", () => {
    const window = freshWindow();
    const document = window.document;
    const time = document.createElement("time");
    time.dateTime = "1969-07-20";
    expect(time.getAttribute("datetime")).toBe("1969-07-20");
    expect(time.dateTime).toBe("1969-07-20");

    const data = document.createElement("data");
    data.value = "x";
    expect(data.getAttribute("value")).toBe("x");
    expect(data.value).toBe("x");
  });

  test("progress value/max/position and meter clamping", () => {
    const window = freshWindow();
    const document = window.document;
    const progress = document.createElement("progress");
    expect(progress.max).toBe(1);
    expect(progress.value).toBe(0);
    expect(progress.position).toBe(-1);
    progress.max = 10;
    progress.value = 1;
    expect(progress.position).toBe(0.1);

    const meter = document.createElement("meter");
    expect(meter.value).toBe(0);
    expect(meter.min).toBe(0);
    expect(meter.max).toBe(1);
    expect(meter.low).toBe(0);
    expect(meter.high).toBe(1);
    expect(meter.optimum).toBe(0.5);
    meter.setAttribute("value", "2");
    expect(meter.value).toBe(1);
    meter.setAttribute("value", "-1");
    expect(meter.value).toBe(0);
    expect(() => {
      meter.value = "invalid";
    }).toThrow(
      new TypeError(
        "Failed to set the 'value' property on 'HTMLMeterElement': The provided double value is non-finite.",
      ),
    );
  });

  test("optgroup disabled/label and col span", () => {
    const window = freshWindow();
    const document = window.document;
    const group = document.createElement("optgroup");
    group.disabled = true;
    group.label = "Group";
    expect(group.getAttribute("disabled")).toBe("");
    expect(group.getAttribute("label")).toBe("Group");

    const col = document.createElement("col");
    expect(col.span).toBe(1);
    col.span = 3;
    expect(col.getAttribute("span")).toBe("3");
  });

  test("labels resolves for-referencing and ancestor labels", () => {
    const window = freshWindow();
    const document = window.document;
    const control = document.createElement("progress");
    control.id = "p1";
    const label1 = document.createElement("label");
    const label2 = document.createElement("label");
    const parentLabel = document.createElement("label");
    label1.setAttribute("for", "p1");
    label2.setAttribute("for", "p1");
    parentLabel.appendChild(control);
    document.body.append(label1, label2, parentLabel);
    const labels = control.labels;
    expect(labels.length).toBe(3);
    expect(labels[0]).toBe(label1);
    expect(labels[1]).toBe(label2);
    expect(labels[2]).toBe(parentLabel);
  });
});

describe("T06 event-handler attributes", () => {
  test("on* getter compiles the attribute in the window scope", () => {
    const window = freshWindow({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
    const body = window.document.createElement("body");
    body.setAttribute("onbeforeprint", "window.test = 1");
    const listener = body.onbeforeprint;
    expect(typeof listener).toBe("function");
    listener(new Event("beforeprint"));
    expect(window.test).toBe(1);
  });

  test("on* setter wires a real event listener and clears the attribute", () => {
    const window = freshWindow({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
    const body = window.document.createElement("body");
    body.onbeforeprint = () => {
      window.test = 2;
    };
    body.dispatchEvent(new Event("beforeprint"));
    expect(window.test).toBe(2);
    expect(body.getAttribute("onbeforeprint")).toBe(null);
  });
});

describe("T06 details summary-toggle and dialog state", () => {
  test("clicking a direct summary toggles details and fires toggle", () => {
    const window = freshWindow({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
    const details = window.document.createElement("details");
    const summary = window.document.createElement("summary");
    details.appendChild(summary);
    let toggles = 0;
    details.addEventListener("toggle", () => toggles++);
    summary.click();
    expect(details.open).toBe(true);
    summary.click();
    expect(details.open).toBe(false);
    expect(toggles).toBe(2);
  });

  test("a click on a non-summary child does not toggle details", () => {
    const window = freshWindow();
    const details = window.document.createElement("details");
    const div = window.document.createElement("div");
    details.appendChild(div);
    div.click();
    expect(details.open).toBe(false);
  });

  test("dialog show/close/returnValue lifecycle", () => {
    const window = freshWindow();
    const dialog = window.document.createElement("dialog");
    expect(dialog.open).toBe(false);
    dialog.show();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttributeNS(null, "open")).toBe("");
    let closed = null;
    dialog.addEventListener("close", (event) => (closed = event));
    dialog.close("foo");
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe("foo");
    expect(closed).not.toBe(null);
    expect(closed.cancelable).toBe(false);
    expect(closed.bubbles).toBe(false);
  });
});

describe("T06 options collection and table-section rows", () => {
  test("select.options selectedIndex / add / remove", () => {
    const window = freshWindow();
    const document = window.document;
    const select = document.createElement("select");
    const option1 = document.createElement("option");
    const option2 = document.createElement("option");
    select.appendChild(option1);
    select.appendChild(option2);
    expect(select.options.selectedIndex).toBe(0);
    select.options.selectedIndex = 1;
    expect(option1.selected).toBe(false);
    expect(option2.selected).toBe(true);
    select.options.add(document.createElement("option"), 0);
    expect(select.options.item(0).value).toBe("");
    select.options.remove(0);
    expect(select.options.length).toBe(2);
  });

  test("table section insertRow / deleteRow", () => {
    const window = freshWindow();
    const section = window.document.createElement("thead");
    const row = section.insertRow();
    expect(section.children[0]).toBe(row);
    expect(section.innerHTML).toBe("<tr></tr>");
    section.insertRow(0);
    expect(section.children.length).toBe(2);
    section.deleteRow(1);
    expect(section.children.length).toBe(1);
    expect(() => section.insertRow(5)).toThrow();
  });
});

describe("T06 input.files", () => {
  test("input.files is a FileList-like collection", () => {
    const window = freshWindow();
    const input = window.document.createElement("input");
    const file1 = new File(["a"], "a.txt");
    const file2 = new File(["b"], "b.txt");
    input.files.push(file1);
    input.files.push(file2);
    expect(input.files.length).toBe(2);
    expect(input.files.item(0)).toBe(file1);
    expect(input.files.item(1)).toBe(file2);
  });
});
