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
    await tick(); await tick();
    w.clearInterval(id); w.clearTimeout(timeoutID);
    await Promise.all([w.happyDOM.close(), browser.close()]);
    return { defaults, intervals, timeout };
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
});
