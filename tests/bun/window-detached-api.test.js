import { describe, expect, test } from "bun:test";

import { VirtualConsolePrinter, Window, isNativeAvailable } from "../../index.js";

// Window / DetachedWindowAPI / virtual console facade tests (happy-dom
// detached-window surface).
//
// They pin the surface calibrated against happy-dom 20.11.11:
//
//   - `window.console` writes into `window.happyDOM.virtualConsolePrinter`
//     (the printer resolved lazily on every print), and the constructor
//     `console` option is used directly when given;
//   - the printer entry shape (`message` is the array of raw logged args),
//     the `print` / `clear` events and the `readAsString` level filtering;
//   - `window.happyDOM.settings` (DefaultBrowserSettings shape, merged from
//     the constructor options, unknown keys throw) and its observable wiring:
//     `settings.navigator.userAgent` feeds `navigator.userAgent` while
//     `settings.navigation.userAgent` does not (baseline behavior);
//   - `happyDOM.setViewport` updates the viewport surface (`innerWidth` /
//     `innerHeight` / `outerWidth` / `devicePixelRatio`) and dispatches
//     `resize` on an actual size change;
//   - `happyDOM.waitUntilComplete` waits for outstanding window timers
//     (a `setTimeout` effect is observable after the await) and still
//     resolves when a `document.write` external script fetch fails;
//   - `document.write` first-write full-document restructuring (`<title>` into
//     `head`, content into `body`) and the `enableJavaScriptEvaluation`
//     script-evaluation gate.
//
// The runtime blocks skip without the locally built native artifact
// (npm run dev:build, or MAD_DOM_NATIVE_PATH), exactly like the other native
// suites.

const nativeAvailable = isNativeAvailable();

const maybe = (description, fn) => (nativeAvailable ? test : test.skip)(description, fn);

describe.skipIf(!nativeAvailable)("window virtual console", () => {
  test("window.console.log writes into happyDOM.virtualConsolePrinter", () => {
    const window = new Window();
    try {
      window.console.log("Test", { test: true });
      const printer = window.happyDOM.virtualConsolePrinter;
      expect(printer).toBeInstanceOf(VirtualConsolePrinter);
      expect(printer.readAsString(0)).toBe('Test {"test":true}\n');
    } finally {
      window.destroy();
    }
  });

  test("readAsString without a level returns every entry", () => {
    const window = new Window();
    try {
      window.console.log("Test", { test: true });
      expect(window.happyDOM.virtualConsolePrinter.readAsString()).toBe('Test {"test":true}\n');
    } finally {
      window.destroy();
    }
  });

  test("read() drains entries whose message is the array of raw logged args", () => {
    const window = new Window();
    try {
      window.console.log("Test", { test: true });
      const entries = window.happyDOM.virtualConsolePrinter.read();
      expect(entries.length).toBe(1);
      expect(entries[0].message).toEqual(["Test", { test: true }]);
      expect(entries.map((entry) => entry.message.join(" ")).join("\n")).toBe(
        "Test [object Object]",
      );
      // read() drains the buffer.
      expect(window.happyDOM.virtualConsolePrinter.read()).toEqual([]);
    } finally {
      window.destroy();
    }
  });

  test("readAsString filters by log level", () => {
    const window = new Window();
    try {
      window.console.log("plain");
      window.console.error("failure");
      const printer = window.happyDOM.virtualConsolePrinter;
      expect(printer.readAsString(3)).toBe("failure\n");
      // readAsString drains: nothing left at any level.
      expect(printer.readAsString(0)).toBe("");
    } finally {
      window.destroy();
    }
  });

  test("the printer dispatches print on each entry and clear on console.clear", () => {
    const window = new Window();
    try {
      const events = [];
      window.happyDOM.virtualConsolePrinter.addEventListener("print", () => events.push("print"));
      window.happyDOM.virtualConsolePrinter.addEventListener("clear", () => events.push("clear"));
      window.console.log("Test", { test: true });
      window.console.clear();
      expect(events).toEqual(["print", "clear"]);
      expect(window.happyDOM.virtualConsolePrinter.read()).toEqual([]);
    } finally {
      window.destroy();
    }
  });

  test("the constructor console option is used directly", () => {
    const calls = [];
    const hostConsole = { log: (...args) => calls.push(args) };
    const window = new Window({ console: hostConsole });
    try {
      expect(window.console).toBe(hostConsole);
      window.console.log("Test");
      expect(calls).toEqual([["Test"]]);
      // Nothing lands in the virtual printer when a console is provided.
      expect(window.happyDOM.virtualConsolePrinter.read()).toEqual([]);
    } finally {
      window.destroy();
    }
  });

  test("console entries resolve the printer lazily: a repointed printer receives them", () => {
    const window = new Window();
    try {
      const pagePrinter = new VirtualConsolePrinter();
      window.console.log("before");
      window.happyDOM.virtualConsolePrinter = pagePrinter;
      window.console.log("after");
      expect(pagePrinter.readAsString()).toBe("after\n");
      expect(window.happyDOM.virtualConsolePrinter).toBe(pagePrinter);
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("window.happyDOM settings", () => {
  test("settings carry the happy-dom defaults and merge constructor options", () => {
    const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const settings = window.happyDOM.settings;
      expect(settings.enableJavaScriptEvaluation).toBe(true);
      expect(settings.disableJavaScriptEvaluation).toBe(false);
      expect(settings.navigation.disableMainFrameNavigation).toBe(false);
      expect(settings.viewport).toEqual({ width: 1024, height: 768, devicePixelRatio: 1 });
      expect(settings.navigator.userAgent).toContain("HappyDOM/20.11.11");
    } finally {
      window.destroy();
    }
  });

  test("settings.navigation.userAgent is writable and does not feed navigator.userAgent", () => {
    const window = new Window({ url: "https://localhost:3000" });
    try {
      const before = window.navigator.userAgent;
      window.happyDOM.settings.navigation.userAgent = "CustomUA/1.0";
      expect(window.happyDOM.settings.navigation.userAgent).toBe("CustomUA/1.0");
      // Baseline behavior: the navigator reads settings.navigator.userAgent.
      expect(window.navigator.userAgent).toBe(before);
    } finally {
      window.destroy();
    }
  });

  test("settings.navigator.userAgent feeds navigator.userAgent", () => {
    const window = new Window();
    try {
      window.happyDOM.settings.navigator.userAgent = "CustomUA/2.0";
      expect(window.navigator.userAgent).toBe("CustomUA/2.0");
      expect(window.navigator.appVersion).toBe("2.0");
    } finally {
      window.destroy();
    }
  });

  test("an unknown constructor setting throws like happy-dom", () => {
    const window = new Window({ settings: { doesNotExist: true } });
    try {
      expect(() => window.happyDOM.settings).toThrow('Unknown browser setting "doesNotExist"');
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("window.happyDOM.setViewport", () => {
  test("setViewport updates the viewport surface", () => {
    const window = new Window();
    try {
      window.happyDOM.setViewport({ width: 1920, height: 1080, devicePixelRatio: 2 });
      expect(window.innerWidth).toBe(1920);
      expect(window.innerHeight).toBe(1080);
      expect(window.outerWidth).toBe(1920);
      expect(window.outerHeight).toBe(1080);
      expect(window.devicePixelRatio).toBe(2);
    } finally {
      window.destroy();
    }
  });

  test("setViewport dispatches resize on a size change and not otherwise", () => {
    const window = new Window();
    try {
      let resized = 0;
      window.addEventListener("resize", () => resized++);
      window.happyDOM.setViewport({ width: 800 });
      expect(resized).toBe(1);
      window.happyDOM.setViewport({ width: 800 });
      expect(resized).toBe(1);
    } finally {
      window.destroy();
    }
  });

  test("the deprecated aliases set the same viewport state", () => {
    const window = new Window();
    try {
      window.happyDOM.setInnerWidth(640);
      expect(window.innerWidth).toBe(640);
      window.happyDOM.setInnerHeight(480);
      expect(window.innerHeight).toBe(480);
      window.happyDOM.setWindowSize({ width: 320, height: 240 });
      expect(window.innerWidth).toBe(320);
      expect(window.innerHeight).toBe(240);
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("window.happyDOM.waitUntilComplete", () => {
  maybe("waits for outstanding window timers", async () => {
    const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
    try {
      window.document.write(`
        <script>
          setTimeout(() => {
            document.body.innerHTML = "Hello World!";
          }, 10);
        </script>
      `);
      await window.happyDOM.waitUntilComplete();
      expect(window.document.body.innerHTML).toBe("Hello World!");
    } finally {
      window.destroy();
    }
  });

  maybe("a cleared timeout no longer keeps waitUntilComplete pending", async () => {
    const window = new Window();
    try {
      const id = window.setTimeout(() => {}, 60_000);
      window.clearTimeout(id);
      await window.happyDOM.waitUntilComplete();
      expect(true).toBe(true);
    } finally {
      window.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("document.write restructuring", () => {
  maybe("the first write of a full document restructures head and body", () => {
    const window = new Window({ url: "http://localhost:8080" });
    try {
      window.document.write(`
        <html>
            <head>
                 <title>Test page</title>
            </head>
            <body>
                <div class="root"></div>
            </body>
        </html>
      `);
      expect(window.document.title).toBe("Test page");
      expect(window.document.head.querySelector("title")).not.toBeNull();
      expect(window.document.body.querySelector(".root")).not.toBeNull();
      expect(window.document.documentElement.outerHTML).toContain("<head>");
    } finally {
      window.destroy();
    }
  });

  maybe("scripts evaluate only with enableJavaScriptEvaluation", () => {
    const enabled = new Window({ settings: { enableJavaScriptEvaluation: true } });
    try {
      enabled.document.write(
        '<script>document.body.setAttribute("data-ran", "1");</script>',
      );
      expect(enabled.document.body.getAttribute("data-ran")).toBe("1");
    } finally {
      enabled.destroy();
    }

    const disabled = new Window();
    try {
      disabled.document.write(
        '<script>document.body.setAttribute("data-ran", "1");</script>',
      );
      expect(disabled.document.body.getAttribute("data-ran")).toBeNull();
      expect(disabled.document.querySelector("script")).not.toBeNull();
    } finally {
      disabled.destroy();
    }
  });

  maybe("a later write appends to the body", () => {
    const window = new Window();
    try {
      window.document.write("<p>first</p>");
      window.document.write("<b>second</b>");
      expect(window.document.body.innerHTML).toBe("<p>first</p><b>second</b>");
    } finally {
      window.destroy();
    }
  });

  maybe("a failing external script load never blocks waitUntilComplete", async () => {
    const window = new Window({
      url: "http://127.0.0.1:9/",
      settings: { enableJavaScriptEvaluation: true },
    });
    try {
      window.document.write('<div class="root"></div><script src="app.js"></script>');
      await window.happyDOM.waitUntilComplete();
      expect(window.document.body.querySelector(".root")).not.toBeNull();
      expect(window.document.body.querySelector("script[src]")).not.toBeNull();
    } finally {
      window.destroy();
    }
  });
});
