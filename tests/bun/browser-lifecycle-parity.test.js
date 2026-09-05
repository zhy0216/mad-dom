import { describe, expect, test } from "bun:test";
import * as baseline from "happy-dom";
import * as candidate from "../../index.js";

const deferred = () => Promise.withResolvers();
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const quiet = { suppressInsecureJavaScriptEnvironmentWarning: true, suppressCodeGenerationFromStringsWarning: true };

// All network observations use an in-process server and explicit response gates.
// Both engines run the same scenario against the locked 20.11.11 dependency.
async function differential(scenario) {
  const expected = await scenario(baseline);
  expect(await scenario(candidate)).toEqual(expected);
}

describe("browser lifecycle parity (happy-dom 20.11.11)", () => {
  test("closing a window disconnects only observers constructed by that window", () => differential(async ({ Window }) => {
    const a = new Window(), b = new Window();
    const events = [];
    const own = new a.MutationObserver(() => events.push("a"));
    const other = new b.MutationObserver(() => events.push("b"));
    own.observe(b.document.body, { childList: true });
    other.observe(b.document.body, { childList: true });
    await a.happyDOM.close();
    b.document.body.appendChild(b.document.createElement("div"));
    await b.happyDOM.waitUntilComplete();
    own.disconnect();
    other.disconnect();
    await Promise.all([a.happyDOM.close(), b.happyDOM.close()]);
    return events;
  }));

  test("abort aliases cancel timers, animation callbacks and microtasks, then allow reuse", () => differential(async ({ Window }) => {
    const w = new Window();
    const events = [];
    w.setTimeout(() => events.push("timeout"), 30);
    w.setInterval(() => events.push("interval"), 30);
    w.requestAnimationFrame(() => events.push("raf"));
    w.queueMicrotask(() => events.push("microtask"));
    // Fallback host cleanup keeps a failing implementation from hanging the test runner.
    const abort = w.happyDOM.cancelAsync();
    await abort;
    w.setTimeout(() => events.push("reuse"), 0);
    await tick();
    await w.happyDOM.close();
    return events;
  }));

  test("simultaneous waits include nested promise-created window tasks", () => differential(async ({ Window }) => {
    const w = new Window();
    const events = [];
    w.setTimeout(() => {
      events.push("first");
      Promise.resolve().then(() => w.setTimeout(() => events.push("nested"), 10));
    }, 10);
    await Promise.all([1, 2].map((id) => w.happyDOM.waitUntilComplete().then(() => events.push(`wait${id}`))));
    const result = [...events];
    await w.happyDOM.close();
    return result;
  }));

  test("all browser wait layers cover fetch headers and streamed bodies", () => differential(async ({ Browser }) => {
    const headers = deferred(), body = deferred(), received = deferred();
    const server = Bun.serve({ port: 0, async fetch() {
      received.resolve();
      await headers.promise;
      return new Response(new ReadableStream({ async start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
        await body.promise;
        controller.enqueue(new TextEncoder().encode("last"));
        controller.close();
      } }));
    } });
    const browser = new Browser();
    const page = browser.newPage();
    page.url = server.url.href;
    let done = 0;
    try {
      const request = page.mainFrame.window.fetch(server.url.href).then((r) => r.text());
      await received.promise;
      const waits = [browser, browser.defaultContext, page, page.mainFrame].map((owner) => owner.waitUntilComplete().then(() => done++));
      await tick();
      const beforeHeaders = done;
      headers.resolve();
      await tick();
      const beforeBody = done;
      body.resolve();
      const text = await request;
      await Promise.all(waits);
      return { beforeHeaders, beforeBody, done, text };
    } finally {
      headers.resolve(); body.resolve();
      await browser.close();
      server.stop(true);
    }
  }));

  test("timer caps and interval iteration boundaries use baseline defaults", () => differential(async ({ Window, Browser }) => {
    const browser = new Browser();
    const defaults = browser.settings.timer;
    const w = new Window({ settings: { timer: { maxTimeout: 1, maxIntervalTime: 1, maxIntervalIterations: 2 } } });
    let intervals = 0, timeout = false;
    const id = w.setInterval(() => intervals++, 1000);
    const timeoutID = w.setTimeout(() => timeout = true, 1000);
    let fallback = false;
    const guard = setTimeout(() => { fallback = true; w.clearInterval(id); w.clearTimeout(timeoutID); }, 500);
    await w.happyDOM.waitUntilComplete();
    clearTimeout(guard);
    w.clearInterval(id); w.clearTimeout(timeoutID);
    await Promise.all([w.happyDOM.close(), browser.close()]);
    return { defaults, intervals, timeout, fallback };
  }));

  test("fetch headers and interceptors can mock without hitting the network", () => differential(async ({ Window }) => {
    let hits = 0;
    const server = Bun.serve({ port: 0, fetch() { hits++; return new Response("network"); } });
    const hooks = [];
    const w = new Window({ url: server.url.href, settings: { fetch: {
      requestHeaders: [{ headers: { "X-Default": "default" } }],
      interceptor: {
        async beforeAsyncRequest({ request, window }) {
          hooks.push(["before", request.headers.get("X-Default"), window === w]);
          return new window.Response("mock");
        },
        async afterAsyncResponse() { hooks.push(["after"]); },
      },
    } } });
    try {
      const text = await (await w.fetch(server.url.href, { headers: { "X-Default": "explicit" } })).text();
      return { hooks, text, hits };
    } finally { await w.happyDOM.close(); server.stop(true); }
  }));

  test("context cookies are shared between pages and isolated from incognito", () => differential(async ({ Browser }) => {
    const browser = new Browser();
    const a = browser.newPage(), b = browser.newPage();
    const context = browser.newIncognitoContext(), c = context.newPage();
    for (const page of [a, b, c]) page.url = "http://localhost/";
    a.mainFrame.window.document.cookie = "session=one; Path=/";
    const result = [b.mainFrame.window.document.cookie, c.mainFrame.window.document.cookie,
      browser.defaultContext.cookieContainer.getCookies(new URL(a.url)).map((cookie) => cookie.key)];
    await browser.close();
    return result;
  }));

  test("content and navigation execute opted-in inline scripts and callback-created work", () => differential(async ({ Browser }) => {
    const events = [];
    const browser = new Browser({ settings: { ...quiet, enableJavaScriptEvaluation: true,
      navigation: { beforeContentCallback(w) { events.push("settings"); w.marker = "injected"; } },
    } });
    const page = browser.newPage();
    page.content = '<script>document.body.setAttribute("data-content", "ran")</script>';
    const content = page.mainFrame.window.document.body.getAttribute("data-content");
    const previous = page.mainFrame.window;
    const server = Bun.serve({ port: 0, fetch() { return new Response('<script>setTimeout(() => document.body.setAttribute("data-nav", marker), 10)</script>'); } });
    try {
      await page.goto(server.url.href, { beforeContentCallback() { events.push("option"); } });
      await page.waitUntilComplete();
      return { content, events, navigation: page.mainFrame.window.document.body.getAttribute("data-nav"), replaced: previous !== page.mainFrame.window, previousClosed: previous.closed };
    } finally { await browser.close(); server.stop(true); }
  }));

  test("Browser validates unknown keys and malformed nested settings", () => differential(async ({ Browser }) => {
    const result = [];
    for (const settings of [{ unknown: true }, { timer: null }, { timer: { maxTimeout: "1" } }]) {
      try { const b = new Browser({ settings }); result.push("accepted"); await b.close(); }
      catch (error) { result.push(error.message); }
    }
    return result;
  }));

  test("closing a detached Window is repeatable, clears its DOM, and rejects new fetches", () => differential(async ({ Window }) => {
    const w = new Window({ url: "http://localhost/" });
    const document = w.document;
    document.body.innerHTML = "<p>before</p>";
    w.close();
    const detachedClose = { closed: w.closed, body: document.body.innerHTML };
    await Promise.all([w.happyDOM.close(), w.happyDOM.close()]);
    const events = [];
    w.setTimeout(() => events.push("timer"));
    w.requestAnimationFrame(() => events.push("raf"));
    w.queueMicrotask(() => events.push("microtask"));
    let error;
    try { await w.fetch("data:text/plain,closed"); } catch (e) { error = [e.name, e.message]; }
    await w.happyDOM.whenAsyncComplete();
    return { detachedClose, closed: w.closed, documentKept: w.document === document, html: document.documentElement.outerHTML, error, events };
  }));

  test("abort cancels pending fetches, settles overlapping waiters and leaves other Windows running", () => differential(async ({ Window }) => {
    const gates = [deferred(), deferred()], received = [deferred(), deferred()];
    const server = Bun.serve({ port: 0, async fetch(request) {
      const i = new URL(request.url).pathname === "/a" ? 0 : 1;
      received[i].resolve();
      await gates[i].promise;
      return new Response("ok");
    } });
    const a = new Window({ url: server.url.href }), b = new Window({ url: server.url.href });
    try {
      const resultA = a.fetch(new URL("a", server.url)).then((r) => r.text()).catch((e) => e.name);
      const resultB = b.fetch(new URL("b", server.url)).then((r) => r.text());
      await Promise.all(received.map((r) => r.promise));
      const waits = [a.happyDOM.waitUntilComplete(), a.happyDOM.waitUntilComplete()];
      await a.happyDOM.abort();
      await Promise.all(waits);
      const first = await resultA;
      gates[1].resolve();
      const second = await resultB;
      const reused = await (await a.fetch("data:text/plain,reused")).text();
      return { first, second, reused };
    } finally { gates.forEach((g) => g.resolve()); await Promise.all([a.happyDOM.close(), b.happyDOM.close()]); server.stop(true); }
  }));

  test("abort while reading a response body rejects the body promise", () => differential(async ({ Window }) => {
    const gate = deferred();
    const server = Bun.serve({ port: 0, fetch() { return new Response(new ReadableStream({ async start(c) {
      c.enqueue(new TextEncoder().encode("part"));
      await gate.promise;
      c.close();
    } })); } });
    const w = new Window({ url: server.url.href });
    try {
      const response = await w.fetch(server.url.href);
      const reading = response.text().then(() => "resolved", (e) => e.name);
      await w.happyDOM.abort();
      return await reading;
    } finally { gate.resolve(); await w.happyDOM.close(); server.stop(true); }
  }));

  test("page abort cancels navigation through the body and keeps its realm usable", () => differential(async ({ Browser }) => {
    const received = deferred(), gate = deferred();
    const server = Bun.serve({ port: 0, async fetch() { received.resolve(); await gate.promise; return new Response("<p>late</p>"); } });
    const browser = new Browser(), page = browser.newPage();
    try {
      const navigation = page.goto(server.url.href).then(() => "resolved", (e) => e.name);
      await received.promise;
      await page.abort();
      const result = await navigation;
      page.content = "<p>reused</p>";
      await page.waitUntilComplete();
      return { result, body: page.mainFrame.window.document.body.innerHTML, closed: page.closed };
    } finally { gate.resolve(); await browser.close(); server.stop(true); }
  }));

  test("browser abort reaches every page and closing removes contexts", () => differential(async ({ Browser }) => {
    const browser = new Browser();
    const context = browser.newIncognitoContext();
    const pages = [browser.newPage(), context.newPage()];
    const events = [];
    for (const page of pages) page.mainFrame.window.queueMicrotask(() => events.push("task"));
    await browser.abort();
    let defaultError;
    try { await browser.defaultContext.close(); } catch (e) { defaultError = e.message; }
    await context.close();
    const count = browser.contexts.length;
    await browser.close();
    const errors = [];
    for (const fn of [() => browser.newPage(), () => browser.newIncognitoContext(), () => browser.waitUntilComplete()]) {
      try { await fn(); } catch (e) { errors.push(e.message); }
    }
    const postClose = [pages[0].mainFrame.document === null];
    for (const fn of [() => pages[0].evaluate("1"), () => pages[0].goto("about:blank")]) {
      try { await fn(); } catch (e) { postClose.push([e.name, e.code ?? null]); }
    }
    return { events, defaultError, count, remaining: browser.contexts.length, errors, postClose, windows: pages.map((p) => p.mainFrame.window) };
  }));

  test("loop prevention bounds recursive timers and animation frames", () => differential(async ({ Window }) => {
    const w = new Window({ settings: { timer: { preventTimerLoops: { timeout: 2, requestAnimationFrame: 2 } } } });
    let timeouts = 0, frames = 0;
    function timeout() { timeouts++; if (timeouts < 20) w.setTimeout(timeout); }
    function frame() { frames++; if (frames < 20) w.requestAnimationFrame(frame); }
    w.setTimeout(timeout); w.requestAnimationFrame(frame);
    await w.happyDOM.waitUntilComplete();
    await w.happyDOM.close();
    return { timeouts, frames };
  }));

  test("script settings, classic order, currentScript and script errors share one pipeline", () => differential(async ({ Browser }) => {
    const result = [];
    for (const settings of [{}, { enableJavaScriptEvaluation: true }, { enableJavaScriptEvaluation: true, disableJavaScriptEvaluation: true }, { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true }]) {
      const browser = new Browser({ settings: { ...quiet, ...settings, fetch: { interceptor: {
        beforeSyncRequest({ window }) { return { ok: true, status: 200, headers: new window.Headers(), body: Buffer.from('document.body.setAttribute("data-order", document.body.getAttribute("data-order") + ":external")') }; },
      } } } });
      const page = browser.newPage(); page.url = "http://localhost/";
      const errors = [];
      page.mainFrame.window.addEventListener("error", (e) => errors.push(e.message));
      page.content = '<script id="one">document.body.setAttribute("data-order", document.currentScript.id)</script><script src="/script.js"></script><script>document.body.setAttribute("data-order", document.body.getAttribute("data-order") + ":last")</script><script type="application/json">throw new Error("json")</script><script>throw new Error("inline")</script>';
      await page.waitUntilComplete();
      result.push({ order: page.mainFrame.window.document.body.getAttribute("data-order"), current: page.mainFrame.window.document.currentScript, errors });
      await browser.close();
    }
    return result;
  }));

  test("async external scripts are waited for and cannot execute after cancellation", () => differential(async ({ Browser }) => {
    const result = [];
    for (const cancel of [false, true]) {
      const gate = deferred(), received = deferred();
      const server = Bun.serve({ port: 0, async fetch() {
        received.resolve(); await gate.promise;
        return new Response('setTimeout(() => document.body.setAttribute("data-loaded", "yes"), 1)');
      } });
      const browser = new Browser({ settings: { ...quiet, enableJavaScriptEvaluation: true } }), page = browser.newPage();
      page.url = server.url.href;
      try {
        page.content = '<script async src="/async.js"></script>';
        await received.promise;
        if (cancel) await page.abort();
        gate.resolve();
        await page.waitUntilComplete();
        result.push(page.mainFrame.window.document.body.getAttribute("data-loaded"));
      } finally { gate.resolve(); await browser.close(); server.stop(true); }
    }
    return result;
  }));

  test("after-response hooks replace responses and see configured request headers", () => differential(async ({ Window }) => {
    const seen = [];
    const w = new Window({ settings: { fetch: {
      requestHeaders: [{ url: /^data:/, headers: { "X-Probe": "present" } }],
      interceptor: { async afterAsyncResponse({ request, response, window }) {
        seen.push([request.headers.get("X-Probe"), await response.text()]);
        return new window.Response("replaced");
      } },
    } } });
    const text = await (await w.fetch("data:text/plain,original")).text();
    await w.happyDOM.close();
    return { seen, text };
  }));

  test("navigation settings suppress network access and control URL fallback", () => differential(async ({ Browser }) => {
    const result = [];
    let hits = 0;
    const server = Bun.serve({ port: 0, fetch() { hits++; return new Response("network"); } });
    try {
      for (const navigation of [{ disableMainFrameNavigation: true }, { disableMainFrameNavigation: true, disableFallbackToSetURL: true }, { crossOriginPolicy: "sameOrigin" }]) {
        const browser = new Browser({ settings: { navigation } }), page = browser.newPage();
        page.url = "http://localhost:1/";
        page.content = "<p>kept</p>";
        await page.goto(server.url.href);
        result.push({ url: page.url === server.url.href ? "target" : "original", body: page.mainFrame.document.body.innerHTML });
        await browser.close();
      }
      return { hits, result };
    } finally { server.stop(true); }
  }));

  test("debug waiting rejects concurrent waiters with task traces and cancels the work", () => differential(async ({ Window }) => {
    const w = new Window({ settings: { debug: { traceWaitUntilComplete: 20 } } });
    let fired = false;
    w.setTimeout(() => fired = true, 10000);
    const errors = await Promise.all([1, 2].map(() => w.happyDOM.waitUntilComplete().then(() => false, (e) =>
      e.message.includes('The maximum time was reached for "waitUntilComplete()"') && e.message.includes("traces")
    )));
    await w.happyDOM.close();
    return { errors, fired };
  }));

  test("script globals and explicit eval remain observable on the owning Window", () => differential(async ({ Browser }) => {
    const browser = new Browser(), page = browser.newPage();
    page.evaluate('var counter = 1; setTimeout(() => { globalThis.counter += 2 }, 0)');
    await page.waitUntilComplete();
    const window = page.mainFrame.window;
    const first = window.counter;
    window.counter = 7;
    const updated = page.evaluate("counter");
    await browser.close();
    return { first, updated };
  }));

  test("document.write appends after Browser content and resets after document.open", () => differential(async ({ Browser }) => {
    const browser = new Browser(), page = browser.newPage();
    page.content = "<p>first</p>";
    const document = page.mainFrame.document;
    document.write("<p>second</p>");
    const appended = document.body.innerHTML;
    document.open();
    document.write("<p>reset</p>");
    const reset = document.body.innerHTML;
    await browser.close();
    return { appended, reset };
  }));

  test("a rejected interceptor leaves no pending waiter", async () => {
    // Upstream's before-hook rejection leaks its task. Keep the failure on
    // fetch() while ensuring our idle wait and teardown remain usable.
    const w = new candidate.Window({ settings: { fetch: { interceptor: {
      async beforeAsyncRequest() { throw new Error("hook failed"); },
    } } } });
    await expect(w.fetch("data:text/plain,unused")).rejects.toThrow("hook failed");
    await w.happyDOM.waitUntilComplete();
    await w.happyDOM.close();
  });

  test("process error capture and native release are isolated from the test runner", async () => {
    const child = Bun.spawn([process.execPath, new URL("./fixtures/browser-lifecycle-process.mjs", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
    const output = new Response(child.stdout).text();
    const errors = new Response(child.stderr).text();
    expect(await child.exited, await errors).toBe(0);
    expect(await output).toContain("lifecycle process: pass");
  });
});
