import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Express from "express";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
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

  test("CookieSameSiteEnum is exported with the happy-dom values", async () => {
    const mod = await import("../../index.js");
    expect(mod.CookieSameSiteEnum).toEqual({ strict: "Strict", lax: "Lax", none: "None" });
    expect(Object.isFrozen(mod.CookieSameSiteEnum)).toBe(true);
  });

  test("browser.defaultContext.cookieContainer adds, filters and clears cookies (wiki shape)", async () => {
    const mod = await import("../../index.js");
    const browser = new Browser();
    const expires = new Date("2030-01-01T00:00:00Z");

    const { changed, deleted } = browser.defaultContext.cookieContainer.addCookies([
      { key: "key1", originURL: "https://example.com" },
      {
        key: "key2",
        originURL: "https://example.com",
        value: "value2",
        domain: "example.com",
        path: "/path/to/page/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: mod.CookieSameSiteEnum.strict,
      },
    ]);
    expect(changed.length).toBe(2);
    expect(deleted.length).toBe(0);

    // The minimal cookie merged the container defaults; `clientSide` (the
    // second getCookies argument) filters the httpOnly cookie out — the
    // wiki-cookiecontainer baseline observable.
    const cookies = browser.defaultContext.cookieContainer.getCookies("https://example.com", true);
    expect(cookies).toEqual([
      {
        key: "key1",
        originURL: "https://example.com",
        value: null,
        domain: "",
        path: "",
        expires: null,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    // Without the clientSide filter the string URL still only matches key1 —
    // the baseline reads `url.protocol` off the argument as given, so a
    // string URL never satisfies the secure cookie's `https:` check; a null
    // URL matches every stored cookie.
    expect(browser.defaultContext.cookieContainer.getCookies("https://example.com").length).toBe(1);
    expect(browser.defaultContext.cookieContainer.getCookies().length).toBe(2);

    // An expired replacement deletes the stored cookie (happy-dom parity).
    const expired = browser.defaultContext.cookieContainer.addCookies([
      { key: "key1", originURL: "https://example.com", expires: new Date("1990-01-01T00:00:00Z") },
    ]);
    expect(expired.changed.length).toBe(0);
    expect(expired.deleted.length).toBe(1);
    expect(browser.defaultContext.cookieContainer.getCookies().length).toBe(1);

    // Closing the context clears its cookie store.
    await browser.close();
    expect(browser.defaultContext.cookieContainer.getCookies()).toEqual([]);
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

// --- navigation history / reload / evaluate / viewport / virtual servers -----

describe("browser navigation history", () => {
  maybe("goto records history and goBack / goForward re-navigate", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    await page.goto(`${baseURL}/target`);
    expect(page.url).toBe(`${baseURL}/target`);

    const backResponse = await page.mainFrame.goBack();
    expect(backResponse).not.toBeNull();
    expect(page.url).toBe(`${baseURL}/start`);
    expect(page.mainFrame.document.title).toBe("Start & page");

    const forwardResponse = await page.mainFrame.goForward();
    expect(forwardResponse).not.toBeNull();
    expect(page.url).toBe(`${baseURL}/target`);
    expect(page.mainFrame.document.title).toBe("Target page");
    await browser.close();
  });

  maybe("goSteps and reload re-navigate the history entries", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    await page.goto(`${baseURL}/target`);

    const stepsResponse = await page.mainFrame.goSteps(-1);
    expect(stepsResponse).not.toBeNull();
    expect(page.url).toBe(`${baseURL}/start`);

    const reloadResponse = await page.reload({ hard: true, timeout: 60000 });
    expect(reloadResponse).not.toBeNull();
    expect(page.url).toBe(`${baseURL}/start`);
    expect(page.mainFrame.document.title).toBe("Start & page");

    // goSteps(0) is a reload.
    const zero = await page.mainFrame.goSteps(0);
    expect(zero).not.toBeNull();
    expect(page.url).toBe(`${baseURL}/start`);
    await browser.close();
  });

  maybe("empty-history navigation resolves without throwing", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    expect(await page.mainFrame.goBack()).toBeNull();
    expect(await page.mainFrame.goForward()).toBeNull();
    expect(await page.mainFrame.goSteps(-1)).toBeNull();
    expect(await page.mainFrame.goSteps(1)).toBeNull();
    expect(await page.mainFrame.reload({ hard: true, timeout: 60000 })).toBeNull();
    expect(page.url).toBe("about:blank");
    // The page delegations share the behavior.
    expect(await page.goBack()).toBeNull();
    expect(await page.goForward()).toBeNull();
    expect(await page.goSteps(-1)).toBeNull();
    // happy-dom tolerates the wiki's `page.reload(url, options)` shape (the
    // URL string becomes the options object) and still resolves.
    expect(await page.reload("https://example.com", { hard: true, timeout: 60000 })).toBeNull();
    expect(page.url).toBe("about:blank");
    await browser.close();
  });

  maybe("a branch prune truncates the frame history", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    await page.goto(`${baseURL}/start`);
    await page.goto(`${baseURL}/target`);
    await page.mainFrame.goBack();
    await page.goto(`${baseURL}/redirect`);
    // /redirect follows to /target; the forward branch (the old /target
    // entry) is gone, so goForward resolves without a navigation.
    expect(page.url).toBe(`${baseURL}/target`);
    expect(await page.mainFrame.goForward()).toBeNull();
    await browser.close();
  });
});

describe("browser frame evaluate", () => {
  maybe("evaluate runs strings and node:vm Scripts against the window context", async () => {
    const browser = new Browser();
    const page = browser.newPage();

    page.mainFrame.evaluate('document.body.innerHTML = "<span>hello world</span>";');
    expect(page.mainFrame.document.querySelector("span").innerText).toBe("hello world");

    page.mainFrame.evaluate(new Script('document.body.innerHTML = "<span>Hello world!!!!</span>";'));
    expect(page.mainFrame.document.querySelector("span").innerText).toBe("Hello world!!!!");

    // The page delegation shares the evaluator; the return value is the
    // script's completion value.
    expect(page.evaluate("1 + 1")).toBe(2);
    expect(page.evaluate(new Script("document.title"))).toBe("");
    await browser.close();
  });

  maybe("innerText renders connected text and rebuilds on set", async () => {
    const window = new Window();
    const document = window.document;
    document.body.innerHTML = "<div>a</div><div>b</div>";
    expect(document.body.innerText).toBe("a\nb");
    const paragraph = document.createElement("p");
    paragraph.innerText = "line1\nline2";
    expect(paragraph.outerHTML).toBe("<p>line1<br>line2</p>");
    window.destroy();
  });
});

describe("browser page viewport", () => {
  maybe("setViewport propagates the dimensions to the frame window", async () => {
    const browser = new Browser();
    const page = browser.newPage();
    expect(page.mainFrame.window.innerWidth).toBe(1024);
    expect(page.mainFrame.window.innerHeight).toBe(768);
    expect(page.mainFrame.window.devicePixelRatio).toBe(1);

    let resizeEvents = 0;
    page.mainFrame.window.addEventListener("resize", () => resizeEvents++);
    page.setViewport({ width: 1920, height: 1080, devicePixelRatio: 2 });

    expect(page.mainFrame.window.innerWidth).toBe(1920);
    expect(page.mainFrame.window.innerHeight).toBe(1080);
    expect(page.mainFrame.window.outerWidth).toBe(1920);
    expect(page.mainFrame.window.outerHeight).toBe(1080);
    expect(page.mainFrame.window.devicePixelRatio).toBe(2);
    expect(resizeEvents).toBe(1);

    // An unchanged viewport dispatches no resize event.
    page.setViewport({ width: 1920, height: 1080, devicePixelRatio: 2 });
    expect(resizeEvents).toBe(1);
    await browser.close();
  });
});

describe("browser virtual servers", () => {
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "mad-dom-virtual-server-"));
    writeFileSync(
      join(directory, "index.html"),
      '<html><head><title>Virtual fixture</title></head><body><script src="script.js"></script></body></html>',
    );
    writeFileSync(join(directory, "script.js"), 'console.log("script.js loaded");');
    mkdirSync(join(directory, "gb", "en"), { recursive: true });
    writeFileSync(
      join(directory, "gb", "en", "index.html"),
      "<html><head><title>Locale fixture</title></head><body>locale</body></html>",
    );
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  maybe("a string virtual server serves the directory files", async () => {
    const browser = new Browser({
      settings: { fetch: { virtualServers: [{ url: "https://vs.local", directory }] } },
    });
    const page = browser.newPage();
    const response = await page.goto("https://vs.local");
    expect(response).not.toBeNull();
    expect(response.status).toBe(200);
    expect(page.url).toBe("https://vs.local/");
    expect(page.mainFrame.document.title).toBe("Virtual fixture");
    expect(page.mainFrame.document.querySelector("script").getAttribute("src")).toBe("script.js");
    await browser.close();
  });

  maybe("a RegExp virtual server matches by match prefix (happy-dom resolution)", async () => {
    const browser = new Browser({
      settings: {
        fetch: {
          virtualServers: [{ url: /https:\/\/vs\.local\/[a-z]{2}\/[a-z]{2}\//, directory }],
        },
      },
    });
    const page = browser.newPage();
    await page.goto("https://vs.local/gb/en/");
    // The matched prefix includes the `gb/en/` part, so only `/` remains and
    // the directory root `index.html` is served (verified against happy-dom).
    expect(page.mainFrame.document.title).toBe("Virtual fixture");
    await browser.close();

    // An origin-only match maps the remaining path under the directory:
    // `/gb/en/` → `gb/en/index.html`.
    const pathBrowser = new Browser({
      settings: {
        fetch: { virtualServers: [{ url: /https:\/\/vs\.local/, directory }] },
      },
    });
    const pathPage = pathBrowser.newPage();
    await pathPage.goto("https://vs.local/gb/en/");
    expect(pathPage.mainFrame.document.title).toBe("Locale fixture");
    await pathBrowser.close();
  });

  maybe("a missing virtual-server file answers the happy-dom 404 page", async () => {
    const browser = new Browser({
      settings: { fetch: { virtualServers: [{ url: "https://vs.local", directory }] } },
    });
    const page = browser.newPage();
    const response = await page.goto("https://vs.local/missing.html");
    expect(response.status).toBe(404);
    expect(page.mainFrame.document.title).toBe("Happy DOM Virtual Server - 404 Not Found");
    await browser.close();
  });

  maybe("window.open on a detached window serves the virtual server and waitUntilComplete covers it", async () => {
    const window = new Window({
      url: "https://vs.local",
      settings: { fetch: { virtualServers: [{ url: "https://vs.local", directory }] } },
    });
    const childWindow = window.open("https://vs.local");
    expect(childWindow).toBeInstanceOf(Window);
    await window.happyDOM.waitUntilComplete();
    expect(childWindow.document.querySelector("script").getAttribute("src")).toBe("script.js");

    // A cross-origin open returns the restricted shim, never the document.
    const crossOrigin = window.open("https://other.local");
    expect(crossOrigin).not.toBeInstanceOf(Window);
    expect(() => crossOrigin.location.href).toThrow();
    window.destroy();
  });
});
