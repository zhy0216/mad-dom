import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Express from "express";
import { Browser, BrowserErrorCaptureEnum, Window, isNativeAvailable } from "../../index.js";

// Browser / page / frame facade integration tests (happy-dom browser model).
//
// They drive the browser surface through the official package entry and pin:
//
//   - the entry exports (`Browser`, `BrowserErrorCaptureEnum`,
//     `VirtualConsolePrinter`) and the settings merge;
//   - the page / frame structure: one main frame per page, the frame's Window
//     / Document identity, the URL and content surface;
//   - server-side `goto` navigation against a local express server: the HTML
//     is parsed into the document, `<title>` lands in the head, and the frame
//     URL follows redirects;
//   - the anchor default action: `click()` dispatches the bubbling cancelable
//     MouseEvent and — unless a listener prevents the default — navigates the
//     frame to the resolved href (`waitUntilComplete` / `waitForNavigation`
//     resolve when the navigation finishes);
//   - the error capture: a browser with `errorCapture: processLevel` attaches
//     process-level listeners while pages are open, contained window-script
//     errors (throwing timer callbacks) dispatch the window `error` event and
//     land in `page.virtualConsolePrinter`, and closing the browser removes
//     every listener;
//   - `window.fetch` is writable (happy-dom class-method parity): an instance
//     assignment shadows the prototype method.
//
// No external network is touched; navigation runs against localhost only. The
// structural block needs no native artifact; the runtime blocks skip without
// the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH), exactly
// like the other native suites.

const nativeAvailable = isNativeAvailable();

let server = null;
let baseURL = "";

beforeAll(async () => {
  const app = Express();
  app.get("/start", (_req, res) => {
    res.set("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html><head><title>Start &amp; page</title></head>
<body><a id="next" href="/target">next page</a></body></html>`);
  });
  app.get("/target", (_req, res) => {
    res.set("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html><head><title>Target page</title></head>
<body><h1>target</h1></body></html>`);
  });
  app.get("/redirect", (_req, res) => {
    res.redirect("/target");
  });
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => {
    if (server !== null) server.close(() => resolve());
    else resolve();
  });
});

const maybe = (description, fn) => (nativeAvailable ? test : test.skip)(description, fn);

describe("browser entry surface", () => {
  test("Browser, BrowserErrorCaptureEnum and VirtualConsolePrinter are exported", async () => {
    const mod = await import("../../index.js");
    expect(typeof mod.Browser).toBe("function");
    expect(mod.BrowserErrorCaptureEnum).toEqual({
      tryAndCatch: "tryAndCatch",
      processLevel: "processLevel",
      disabled: "disabled",
    });
    expect(typeof mod.VirtualConsolePrinter).toBe("function");
    const browser = new Browser({ settings: { errorCapture: mod.BrowserErrorCaptureEnum.processLevel } });
    const page = browser.newPage();
    expect(page.virtualConsolePrinter).toBeInstanceOf(mod.VirtualConsolePrinter);
    await browser.close();
  });

  test("settings merge the defaults and honor the given values", async () => {
    const browser = new Browser({
      settings: {
        errorCapture: BrowserErrorCaptureEnum.processLevel,
        enableJavaScriptEvaluation: true,
        timer: { maxTimeout: 1000 },
      },
    });
    expect(browser.settings.errorCapture).toBe("processLevel");
    expect(browser.settings.enableJavaScriptEvaluation).toBe(true);
    expect(browser.settings.timer.maxTimeout).toBe(1000);
    expect(browser.settings.timer.maxIntervalTime).toBe(2147483647);
    expect(browser.settings.errorCapture).toBe(BrowserErrorCaptureEnum.processLevel);
    await browser.close();
  });
});

describe("browser page / frame structure", () => {
  maybe("a page has exactly one main frame owning a Window/Document pair", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    expect(page.mainFrame.page).toBe(page);
    expect(page.frames).toEqual([page.mainFrame]);
    expect(page.context.pages).toContain(page);
    expect(page.mainFrame.window).toBeInstanceOf(Window);
    expect(page.mainFrame.window.document).toBe(page.mainFrame.document);
    expect(page.mainFrame.document).toBe(page.mainFrame.window.document);
    expect(page.url).toBe("about:blank");
    expect(page.closed).toBe(false);
    expect(page.mainFrame.parentFrame).toBeNull();
    expect(page.mainFrame.childFrames).toEqual([]);
    expect(browser.contexts.length).toBe(1);
    await browser.close();
    expect(page.closed).toBe(true);
    expect(browser.closed).toBe(true);
  });

  maybe("newIncognitoContext mints a separate context", async () => {
    const browser = new Browser();
    const context = browser.newIncognitoContext();
    expect(browser.contexts).toContain(context);
    expect(context.pages).toEqual([]);
    await browser.close();
    expect(context.closed).toBe(true);
  });
});

describe("browser navigation", () => {
  maybe("goto fetches the page, parses the title and sets the frame URL", async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    expect(page.url).toBe(`${baseURL}/start`);
    expect(page.mainFrame.url).toBe(page.url);
    expect(page.mainFrame.document.title).toBe("Start & page");
    const link = page.mainFrame.document.querySelector("#next");
    expect(link).not.toBeNull();
    await browser.close();
  });

  maybe("goto follows redirects to the final URL", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/redirect`);
    expect(page.url).toBe(`${baseURL}/target`);
    expect(page.mainFrame.document.title).toBe("Target page");
    await browser.close();
  });

  maybe("anchor click performs the default server-side navigation", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    const link = page.mainFrame.document.querySelector("#next");
    link.click();
    await page.waitUntilComplete();
    expect(page.url).toBe(`${baseURL}/target`);
    expect(page.mainFrame.document.title).toBe("Target page");
    expect(page.mainFrame.document.querySelector("h1")?.textContent).toBe("target");
    await browser.close();
  });

  maybe("waitForNavigation resolves when a click-triggered navigation finishes", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    const link = page.mainFrame.document.querySelector("#next");
    link.click();
    await page.waitForNavigation();
    expect(page.url).toBe(`${baseURL}/target`);
    await browser.close();
  });

  maybe("preventDefault cancels the anchor default navigation", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    const link = page.mainFrame.document.querySelector("#next");
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
    await page.waitUntilComplete();
    expect(page.url).toBe(`${baseURL}/start`);
    await browser.close();
  });
});

describe("browser error capture", () => {
  maybe("a throwing window timer callback dispatches the error event and prints to the virtual console", async () => {
    const browser = new Browser({
      settings: { errorCapture: BrowserErrorCaptureEnum.processLevel, enableJavaScriptEvaluation: true },
    });
    const page = browser.newPage();
    const windowFacade = page.mainFrame.window;
    let errorEvent = null;
    windowFacade.addEventListener("error", (event) => (errorEvent = event));

    windowFacade.document.write(`
      <script>
        (() => {
          setTimeout(() => {
            throw new Error('Test error');
          }, 0);
        })();
      </script>
    `);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(errorEvent).not.toBeNull();
    expect(errorEvent.error.message).toBe("Test error");
    expect(errorEvent.message).toBe("Test error");
    expect(errorEvent).toBeInstanceOf(windowFacade.ErrorEvent);
    const consoleOutput = page.virtualConsolePrinter.readAsString();
    expect(consoleOutput.startsWith("Error: Test error\n    at Timeout.eval")).toBe(true);
    await browser.close();
  });

  maybe("process-level listeners are attached while pages are open and removed on close", async () => {
    const beforeException = process.listenerCount("uncaughtException");
    const beforeRejection = process.listenerCount("unhandledRejection");
    const browser = new Browser({
      settings: { errorCapture: BrowserErrorCaptureEnum.processLevel },
    });
    const page = browser.newPage();
    expect(process.listenerCount("uncaughtException")).toBe(beforeException + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection + 1);
    await page.close();
    expect(process.listenerCount("uncaughtException")).toBe(beforeException);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection);
    await browser.close();
  });

  maybe("a browser without process-level capture attaches no process listeners", async () => {
    const beforeException = process.listenerCount("uncaughtException");
    const beforeRejection = process.listenerCount("unhandledRejection");
    const browser = new Browser();
    browser.newPage();
    expect(process.listenerCount("uncaughtException")).toBe(beforeException);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection);
    await browser.close();
  });

  maybe("window.fetch is writable: an instance assignment shadows the prototype method", async () => {
    const windowFacade = new Window();
    let called = 0;
    windowFacade.fetch = () => {
      called++;
      return Promise.resolve({});
    };
    expect(typeof windowFacade.fetch).toBe("function");
    await windowFacade.fetch();
    expect(called).toBe(1);
    windowFacade.destroy();
  });
});

describe("browser lifecycle", () => {
  maybe("close marks every layer closed and the content surface works", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    page.content = "<html><head><title>x</title></head><body>y</body></html>";
    expect(page.mainFrame.document.title).toBe("x");
    expect(page.content).toContain("<body>");
    await page.close();
    expect(page.closed).toBe(true);
    expect(page.mainFrame.closed).toBe(true);
    await browser.close();
    expect(browser.closed).toBe(true);
  });

  maybe("an anchor click after page close no longer navigates", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    const link = page.mainFrame.document.querySelector("#next");
    await page.close();
    link.click();
    await page.waitUntilComplete();
    expect(page.url).toBe(`${baseURL}/start`);
    await browser.close();
  });
});
