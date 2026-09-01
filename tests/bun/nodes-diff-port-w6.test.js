// W6 nodes html-element differential port facade additions integration tests.
//
// Each facade addition that the W6 (nodes html 元素) diff-port wave made to
// js/facade/extensions/hdunit-nodes.js / html-element.js / forms.js /
// attributes.js / cssom.js is pinned by at least one assertion here, mirroring
// the happy-dom behaviour the rewritten node tests observed:
//
//   - HTML attribute-name case-insensitivity (getAttribute/setAttribute/
//     hasAttribute/removeAttribute normalize to lowercase, happy-dom parity);
//   - the anchor/area hyperlink URL parts (href/origin/protocol/username/
//     password/host/hostname/port/pathname/search/hash + part setters) and the
//     relList DOMTokenList;
//   - the button/input form-action family (formAction/formEnctype/formMethod/
//     formTarget) and the popover target reflections;
//   - the input height/width slots, size, indeterminate and list (datalist);
//   - the iframe attribute reflections and sandbox DOMTokenList;
//   - the link attribute reflections; the object/output element surfaces;
//   - the script attribute/enum reflections, blocking DOMTokenList, src and
//     text; the select autofocus; the textarea reflections;
//   - the table-cell colSpan/rowSpan/cellIndex; the track kind enum;
//   - the `window.Image` constructor; the form action URL resolution and the
//     style attribute setter.
import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "../../index.js";

const createdWindows = [];
function freshWindow(options) {
  const win = options === undefined ? new Window() : new Window(options);
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) win.destroy();
});

describe("W6 HTML attribute-name case-insensitivity", () => {
  test("getAttribute / hasAttribute / removeAttribute match case-insensitively", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElement("div");
    element.setAttribute("acceptCharset", "value");
    expect(element.getAttribute("acceptcharset")).toBe("value");
    expect(element.getAttribute("acceptCharset")).toBe("value");
    expect(element.hasAttribute("ACCEPTCHARSET")).toBe(true);
    element.removeAttribute("AcceptCharset");
    expect(element.hasAttribute("acceptcharset")).toBe(false);
  });
});

describe("W6 anchor / area hyperlink URL parts", () => {
  test("href resolves against the window location and part setters rewrite it", () => {
    const window = freshWindow({ url: "https://www.somesite.com/test.html" });
    const document = window.document;
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "test");
    expect(anchor.href).toBe("https://www.somesite.com/test");
    anchor.setAttribute("href", "https://user:pw@www.example.com:443/path?q1=a#xyz");
    expect(anchor.origin).toBe("https://www.example.com");
    expect(anchor.protocol).toBe("https:");
    expect(anchor.username).toBe("user");
    expect(anchor.password).toBe("pw");
    expect(anchor.host).toBe("www.example.com");
    expect(anchor.hostname).toBe("www.example.com");
    expect(anchor.port).toBe("");
    expect(anchor.pathname).toBe("/path");
    expect(anchor.search).toBe("?q1=a");
    expect(anchor.hash).toBe("#xyz");
    anchor.protocol = "http";
    expect(anchor.href).toBe("http://user:pw@www.example.com/path?q1=a#xyz");
    anchor.username = "user2";
    anchor.password = "pw2";
    expect(anchor.href).toBe("http://user2:pw2@www.example.com/path?q1=a#xyz");
    anchor.port = "8080";
    expect(anchor.href).toBe("http://user2:pw2@www.example.com:8080/path?q1=a#xyz");
    anchor.pathname = "/path2";
    anchor.search = "?q1=b";
    anchor.hash = "#fgh";
    expect(anchor.href).toBe("http://user2:pw2@www.example.com:8080/path2?q1=b#fgh");
    expect(anchor.toString()).toBe(anchor.href);
  });

  test("area shares the hyperlink surface and relList", () => {
    const window = freshWindow({ url: "https://www.somesite.com/test.html" });
    const document = window.document;
    const area = document.createElement("area");
    area.setAttribute("href", "https://www.example.com");
    expect(area.href).toBe("https://www.example.com/");
    expect(area.origin).toBe("https://www.example.com");
    area.setAttribute("rel", "value1 value2");
    expect(area.relList.length).toBe(2);
    expect(area.relList[0]).toBe("value1");
    expect(area.relList.value).toBe("value1 value2");
    area.download = "x";
    expect(area.getAttribute("download")).toBe("x");
  });

  test("anchor relList over the rel attribute", () => {
    const window = freshWindow();
    const document = window.document;
    const anchor = document.createElement("a");
    anchor.setAttribute("rel", "a b");
    expect(anchor.relList.value).toBe("a b");
    expect(anchor.relList.length).toBe(2);
    anchor.relList.add("c");
    expect(anchor.getAttribute("rel")).toBe("a b c");
    anchor.relList = "x y";
    expect(anchor.getAttribute("rel")).toBe("x y");
  });
});

describe("W6 button / input form-action family and popover targets", () => {
  test("formAction resolves against the window location, other members reflect", () => {
    const window = freshWindow();
    const document = window.document;
    const button = document.createElement("button");
    expect(button.formAction).toBe("about:blank");
    window.happyDOM.setURL("https://localhost/path/");
    button.setAttribute("formaction", "/test/");
    expect(button.formAction).toBe("https://localhost/test/");
    button.setAttribute("formaction", "https://example.com");
    expect(button.formAction).toBe("https://example.com/");
    button.formEnctype = "value";
    expect(button.getAttribute("formenctype")).toBe("value");
    button.formMethod = "value";
    expect(button.getAttribute("formmethod")).toBe("value");
    button.formTarget = "value";
    expect(button.getAttribute("formtarget")).toBe("value");
    button.formNoValidate = true;
    expect(button.getAttribute("formnovalidate")).toBe("");
  });

  test("popoverTargetElement stores an element and rejects a string", () => {
    const window = freshWindow();
    const document = window.document;
    const input = document.createElement("input");
    const target = document.createElement("div");
    input.popoverTargetElement = target;
    expect(input.popoverTargetElement).toBe(target);
    expect(() => {
      input.popoverTargetElement = "test";
    }).toThrow(
      new TypeError(
        "Failed to set the 'popoverTargetElement' property on 'HTMLInputElement': Failed to convert value to 'Element'.",
      ),
    );
    input.setAttribute("popovertargetaction", "hide");
    expect(input.popoverTargetAction).toBe("hide");
    input.setAttribute("popovertargetaction", "invalid");
    expect(input.popoverTargetAction).toBe("toggle");
  });
});

describe("W6 input height/width slots, size, indeterminate, list", () => {
  test("height/width are property slots (default 0, attribute ignored)", () => {
    const window = freshWindow();
    const document = window.document;
    const input = document.createElement("input");
    expect(input.height).toBe(0);
    expect(input.width).toBe(0);
    input.height = 20;
    input.width = 20;
    expect(input.height).toBe(20);
    expect(input.width).toBe(20);
    expect(input.getAttribute("height")).toBe("20");
    input.setAttribute("height", "50");
    expect(input.height).toBe(20);
  });

  test("size defaults to 20 and indeterminate is a non-attribute slot", () => {
    const window = freshWindow();
    const document = window.document;
    const input = document.createElement("input");
    expect(input.size).toBe(20);
    input.size = 50;
    expect(input.size).toBe(50);
    input.type = "checkbox";
    expect(input.indeterminate).toBe(false);
    input.indeterminate = true;
    expect(input.indeterminate).toBe(true);
    expect(input.hasAttribute("indeterminate")).toBe(false);
  });

  test("list resolves the datalist by id", () => {
    const window = freshWindow();
    const document = window.document;
    const datalist = document.createElement("datalist");
    datalist.id = "list_id";
    document.body.appendChild(datalist);
    const input = document.createElement("input");
    expect(input.list).toBe(null);
    input.setAttribute("list", "list_id");
    expect(input.list).toBe(datalist);
  });
});

describe("W6 iframe / link / object / output / script / track / select / textarea reflections", () => {
  test("iframe attribute reflections and sandbox DOMTokenList", () => {
    const window = freshWindow({ url: "https://localhost:8080/test/path/" });
    const document = window.document;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "test");
    expect(iframe.src).toBe("https://localhost:8080/test/path/test");
    iframe.src = "test";
    expect(iframe.getAttribute("src")).toBe("test");
    iframe.allow = "value";
    expect(iframe.getAttribute("allow")).toBe("value");
    iframe.height = "value";
    expect(iframe.getAttribute("height")).toBe("value");
    iframe.name = "value";
    expect(iframe.getAttribute("name")).toBe("value");
    iframe.srcdoc = "<div></div>";
    expect(iframe.getAttribute("srcdoc")).toBe("<div></div>");
    iframe.sandbox.add("allow-forms", "allow-scripts");
    expect(iframe.sandbox.toString()).toBe("allow-forms allow-scripts");
    iframe.sandbox = "a b";
    expect(iframe.getAttribute("sandbox")).toBe("a b");
    expect(iframe.tabIndex).toBe(0);
  });

  test("link attribute reflections and relList supports", () => {
    const window = freshWindow({ url: "https://localhost:8080/test/path/" });
    const document = window.document;
    const link = document.createElement("link");
    link.setAttribute("href", "test");
    expect(link.href).toBe("https://localhost:8080/test/path/test");
    link.as = "style";
    expect(link.getAttribute("as")).toBe("style");
    link.crossOrigin = "anonymous";
    expect(link.getAttribute("crossorigin")).toBe("anonymous");
    expect(link.referrerPolicy).toBe("");
    link.setAttribute("rel", "stylesheet");
    expect(link.relList.supports("stylesheet")).toBe(true);
    expect(link.relList.supports("preload")).toBe(true);
    expect(link.relList.supports("unsupported")).toBe(false);
  });

  test("object data URL reflection and validation surface", () => {
    const window = freshWindow({ url: "https://localhost:8080/test/path/" });
    const document = window.document;
    const object = document.createElement("object");
    object.setAttribute("data", "test");
    expect(object.data).toBe("https://localhost:8080/test/path/test");
    object.data = "test";
    expect(object.getAttribute("data")).toBe("test");
    expect(object.willValidate).toBe(false);
    expect(object.validity.valid).toBe(true);
    object.setCustomValidity("Test message");
    expect(object.validationMessage).toBe("Test message");
    expect(object.checkValidity()).toBe(true);
    const form = document.createElement("form");
    form.appendChild(object);
    expect(object.form).toBe(form);
    expect(object.tabIndex).toBe(0);
  });

  test("output defaultValue/value/htmlFor/name/type", () => {
    const window = freshWindow();
    const document = window.document;
    const output = document.createElement("output");
    expect(output.defaultValue).toBe("");
    output.defaultValue = "Test";
    expect(output.defaultValue).toBe("Test");
    output.textContent = "test";
    expect(output.value).toBe("test");
    output.value = "test";
    expect(output.textContent).toBe("test");
    output.htmlFor = "test";
    expect(output.getAttribute("for")).toBe("test");
    output.name = "test";
    expect(output.getAttribute("name")).toBe("test");
    expect(output.type).toBe("output");
    expect(output.checkValidity()).toBe(true);
    expect(output.willValidate).toBe(false);
  });

  test("script attribute/enum reflections, blocking, src, text", () => {
    const window = freshWindow({ url: "https://localhost:8080/test/path/" });
    const document = window.document;
    const script = document.createElement("script");
    script.src = "test";
    expect(script.getAttribute("src")).toBe("test");
    script.setAttribute("src", "test");
    expect(script.src).toBe("https://localhost:8080/test/path/test");
    script.setAttribute("fetchpriority", "high");
    expect(script.fetchPriority).toBe("high");
    script.setAttribute("fetchpriority", "invalid");
    expect(script.fetchPriority).toBe("auto");
    script.setAttribute("referrerpolicy", "no-referrer");
    expect(script.referrerPolicy).toBe("no-referrer");
    script.setAttribute("referrerpolicy", "invalid");
    expect(script.referrerPolicy).toBe("");
    script.noModule = true;
    expect(script.getAttribute("nomodule")).toBe("");
    script.setAttribute("blocking", "a b");
    expect(script.blocking.length).toBe(2);
    script.appendChild(document.createTextNode("test"));
    expect(script.text).toBe("test");
    script.text = "test2";
    expect(script.textContent).toBe("test2");
  });

  test("track kind enum, src, srclang, label, default, readyState", () => {
    const window = freshWindow({ url: "https://localhost:8080/test/path/" });
    const document = window.document;
    const track = document.createElement("track");
    expect(track.kind).toBe("subtitles");
    track.setAttribute("kind", "invalid");
    expect(track.kind).toBe("metadata");
    track.kind = "invalid";
    expect(track.getAttribute("kind")).toBe("metadata");
    track.kind = "captions";
    expect(track.getAttribute("kind")).toBe("captions");
    track.setAttribute("src", "test");
    expect(track.src).toBe("https://localhost:8080/test/path/test");
    track.srclang = "test";
    expect(track.getAttribute("srclang")).toBe("test");
    track.label = "test";
    expect(track.getAttribute("label")).toBe("test");
    track.default = true;
    expect(track.getAttribute("default")).toBe("");
    expect(track.readyState).toBe(0);
  });

  test("select autofocus and tabIndex", () => {
    const window = freshWindow();
    const document = window.document;
    const select = document.createElement("select");
    expect(select.tabIndex).toBe(0);
    select.autofocus = true;
    expect(select.getAttribute("autofocus")).toBe("");
    expect(select.autofocus).toBe(true);
  });

  test("textarea string reflections and tabIndex", () => {
    const window = freshWindow();
    const document = window.document;
    const textarea = document.createElement("textarea");
    expect(textarea.tabIndex).toBe(0);
    textarea.cols = "value";
    expect(textarea.getAttribute("cols")).toBe("value");
    textarea.rows = "value";
    expect(textarea.getAttribute("rows")).toBe("value");
    textarea.placeholder = "value";
    expect(textarea.getAttribute("placeholder")).toBe("value");
    textarea.inputMode = "value";
    expect(textarea.getAttribute("inputmode")).toBe("value");
    textarea.autocomplete = "value";
    expect(textarea.getAttribute("autocomplete")).toBe("value");
  });
});

describe("W6 table-cell and form/HTMLElement additions", () => {
  test("table-cell colSpan/rowSpan/cellIndex", () => {
    const window = freshWindow();
    const document = window.document;
    const td = document.createElement("td");
    expect(td.colSpan).toBe(1);
    td.colSpan = 2;
    expect(td.getAttribute("colspan")).toBe("2");
    td.colSpan = 0;
    expect(td.getAttribute("colspan")).toBe("1");
    td.setAttribute("rowspan", "0");
    expect(td.rowSpan).toBe(1);
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    tr.appendChild(td1);
    tr.appendChild(td2);
    expect(td1.cellIndex).toBe(0);
    expect(td2.cellIndex).toBe(1);
    expect(td.cellIndex).toBe(-1);
  });

  test("form action resolves against the window location", () => {
    const window = freshWindow();
    const document = window.document;
    const form = document.createElement("form");
    expect(form.action).toBe("about:blank");
    window.happyDOM.setURL("https://localhost/path/");
    form.setAttribute("action", "/test/");
    expect(form.action).toBe("https://localhost/test/");
    form.setAttribute("action", "https://example.com");
    expect(form.action).toBe("https://example.com/");
    form.encoding = "value";
    expect(form.getAttribute("encoding")).toBe("value");
    form.autocomplete = "value";
    expect(form.getAttribute("autocomplete")).toBe("value");
  });

  test("style setter writes the cssText and the element attribute", () => {
    const window = freshWindow();
    const document = window.document;
    const div = document.createElement("div");
    div.style = "border-radius: 2px; padding: 2px;";
    expect(div.getAttribute("style")).toBe("border-radius: 2px; padding: 2px;");
    expect(div.style.borderRadius).toBe("2px");
    div.style = "";
    expect(div.getAttribute("style")).toBe("");
    expect(div.style.cssText).toBe("");
  });

  test("window.Image mints an img element with width/height", () => {
    const window = freshWindow();
    const document = window.document;
    const image = new window.Image();
    expect(image.width).toBe(0);
    expect(image.height).toBe(0);
    expect(image.tagName).toBe("IMG");
    expect(image.localName).toBe("img");
    expect(image.ownerDocument).toBe(document);
    const sized = new window.Image(100, 200);
    expect(sized.width).toBe(100);
    expect(sized.height).toBe(200);
    expect(sized.getAttribute("width")).toBe("100");
  });

  test("HTMLElement popover / accessKey / layout reads", () => {
    const window = freshWindow();
    const document = window.document;
    const div = document.createElement("div");
    expect(div.accessKey).toBe("");
    expect(div.offsetHeight).toBe(0);
    expect(div.offsetWidth).toBe(0);
    expect(div.clientHeight).toBe(0);
    expect(div.clientWidth).toBe(0);
    expect(div.popover).toBe(null);
    div.setAttribute("popover", "");
    expect(div.popover).toBe("auto");
    div.setAttribute("popover", "invalid");
    expect(div.popover).toBe("manual");
    div.popover = "auto";
    expect(div.getAttribute("popover")).toBe("auto");
    div.popover = null;
    expect(div.getAttribute("popover")).toBe(null);
  });
});
