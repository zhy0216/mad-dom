import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { Location } from "../../js/facade/extensions/window-platform.js";
import { History } from "../../js/facade/extensions/window-platform.js";
import { Navigator } from "../../js/facade/extensions/window-platform.js";

// T45 Window platform integration tests (URL / Location / History / Navigator).
//
// They drive the platform surface through the official package entry and pin
// the acceptance criteria:
//
//   - per-window state isolation — every window owns its own location /
//     history / navigator / storage state, and `window.document` reads it
//     through the same per-window state (document.URL / documentURI stay
//     linked to location.href);
//   - Location/History state and Window/Document URL linkage — the `hash`
//     setter and `pushState` / `replaceState` update the URL, the session
//     history stack and document.URL in lockstep;
//   - simulated navigation — the `href` setter, the property setters and
//     `assign` / `replace` update the URL and history synchronously without
//     any real page load or browser process behavior, and `reload()` /
//     `back()` / `forward()` / `go()` are no-ops;
//   - reuse of Bun/Web standard objects — `window.URL` / `window.DOMException`
//     are the global constructors, and URL parsing (about:blank pathname /
//     origin, relative resolution failures) follows the WHATWG host;
//   - the Navigator surface exposes the fixed happy-dom baseline mock values.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("window platform export shapes (T45)", () => {
  test("window-platform.js exports the platform classes and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/window-platform.js");
    expect(Object.keys(mod).sort()).toEqual([
      "History",
      "Location",
      "Navigator",
      "Storage",
      "fetchCookieJar",
      "install",
      "seam",
    ]);
    expect(mod.seam.owner).toBe("T45");
    expect(Object.isFrozen(mod.seam)).toBe(true);
  });

  test("the platform classes are reachable and not user-constructible through the entry", () => {
    // They are facade classes minted by the window accessors; constructing them
    // without a platform state would have no window to bind to.
    expect(typeof Location).toBe("function");
    expect(typeof History).toBe("function");
    expect(typeof Navigator).toBe("function");
  });
});

describe.skipIf(!nativeAvailable)("window platform surface (T45)", () => {
  test("a default window exposes location, history, navigator and the two storage areas", () => {
    const win = new Window();
    try {
      expect(win.location).toBeInstanceOf(Location);
      expect(win.history).toBeInstanceOf(History);
      expect(win.navigator).toBeInstanceOf(Navigator);
      expect(win.localStorage).toBeDefined();
      expect(win.sessionStorage).toBeDefined();
      expect(win.URL).toBe(globalThis.URL);
      expect(win.DOMException).toBe(globalThis.DOMException);
      win.destroy();
    } finally {
      win.destroy();
    }
  });

  test("repeat reads hand back one and the same platform object (per-window identity)", () => {
    const win = new Window();
    try {
      expect(win.location).toBe(win.location);
      expect(win.history).toBe(win.history);
      expect(win.navigator).toBe(win.navigator);
      expect(win.localStorage).toBe(win.localStorage);
      expect(win.sessionStorage).toBe(win.sessionStorage);
    } finally {
      win.destroy();
    }
  });

  test("the default location is about:blank with the WHATWG host semantics", () => {
    const win = new Window();
    try {
      const location = win.location;
      expect(location.href).toBe("about:blank");
      expect(location.hash).toBe("");
      expect(location.host).toBe("");
      expect(location.hostname).toBe("");
      expect(location.origin).toBe("null");
      expect(location.pathname).toBe("blank");
      expect(location.port).toBe("");
      expect(location.protocol).toBe("about:");
      expect(location.search).toBe("");
      expect(location.toString()).toBe("about:blank");
      expect(String(location)).toBe("about:blank");
      expect(Object.prototype.toString.call(location)).toBe("[object Location]");
      expect(Object.keys(location)).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("document.URL and documentURI stay linked to location.href", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const location = win.location;
      const history = win.history;
      expect(doc.URL).toBe("about:blank");
      expect(doc.documentURI).toBe(doc.URL);

      location.hash = "#frag";
      expect(location.href).toBe("about:blank#frag");
      expect(doc.URL).toBe("about:blank#frag");
      expect(doc.documentURI).toBe(location.href);

      history.pushState({ n: 1 }, "", "?q=2");
      expect(doc.URL).toBe(location.href);
      expect(doc.documentURI).toBe(location.href);
    } finally {
      win.destroy();
    }
  });

  test("the hash setter pushes a history entry and an unchanged hash is a no-op", () => {
    const win = new Window();
    try {
      const location = win.location;
      const history = win.history;
      const lengthBefore = history.length;
      location.hash = "#part1";
      expect(location.hash).toBe("#part1");
      expect(history.length).toBe(lengthBefore + 1);
      expect(history.state).toBeNull();

      const lengthAfterPush = history.length;
      location.hash = "#part1";
      expect(history.length).toBe(lengthAfterPush);

      location.hash = "#part2";
      expect(history.length).toBe(lengthAfterPush + 1);
      expect(location.href).toBe("about:blank#part2");
    } finally {
      win.destroy();
    }
  });

  test("pushState / replaceState manage the history stack, URL and errors", () => {
    const win = new Window();
    try {
      const location = win.location;
      const history = win.history;

      // Relative URLs against the about: base resolve to about:blank (the
      // WHATWG relative resolution fails, exactly like the baseline), but the
      // state and the stack still update.
      const lengthBefore = history.length;
      history.pushState({ a: 1 }, "", "/rel");
      expect(history.length).toBe(lengthBefore + 1);
      expect(history.state).toEqual({ a: 1 });
      expect(location.href).toBe("about:blank");

      // A missing second argument is a TypeError with the baseline message.
      const zero = thrown(() => history.pushState());
      expect(zero).toBeInstanceOf(TypeError);
      expect(zero.message).toBe(
        "Failed to execute 'pushState' on 'History': 2 arguments required, but only 0 present.",
      );

      // An absolute URL from origin "null" is a SecurityError DOMException.
      const crossOrigin = thrown(() => history.pushState({}, "", "https://evil.example.com/x"));
      expect(crossOrigin).toBeInstanceOf(win.DOMException);
      expect(crossOrigin.name).toBe("SecurityError");
      expect(crossOrigin.message).toContain("cannot be created in a document with origin 'null'");

      // replaceState swaps the current entry without growing the stack.
      const replaceLength = history.length;
      history.replaceState({ b: 2 }, "", "/rep");
      expect(history.length).toBe(replaceLength);
      expect(history.state).toEqual({ b: 2 });
    } finally {
      win.destroy();
    }
  });

  test("scrollRestoration accepts only auto and manual", () => {
    const win = new Window();
    try {
      const history = win.history;
      expect(history.scrollRestoration).toBe("auto");
      history.scrollRestoration = "manual";
      expect(history.scrollRestoration).toBe("manual");
      history.scrollRestoration = "bogus";
      expect(history.scrollRestoration).toBe("manual");
      history.scrollRestoration = "auto";
      expect(history.scrollRestoration).toBe("auto");
    } finally {
      win.destroy();
    }
  });

  test("simulated navigation updates the URL and history without fetching", () => {
    const win = new Window();
    try {
      const location = win.location;
      const history = win.history;

      location.href = "https://example.com/a/b?q=1";
      expect(location.href).toBe("https://example.com/a/b?q=1");
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(win.document.URL).toBe(location.href);

      // The property setters re-resolve the current URL synchronously.
      location.pathname = "/new";
      expect(location.href).toBe("https://example.com/new?q=1");
      location.search = "?z=9";
      expect(location.href).toBe("https://example.com/new?z=9");
      location.hostname = "other.test";
      expect(location.href).toBe("https://other.test/new?z=9");
      location.port = "99";
      expect(location.href).toBe("https://other.test:99/new?z=9");
      location.protocol = "http:";
      expect(location.href).toBe("http://other.test:99/new?z=9");

      location.assign("https://next.test/x");
      expect(location.href).toBe("https://next.test/x");
      location.replace("https://next.test/y");
      expect(location.href).toBe("https://next.test/y");

      // reload / back / forward / go are simulated no-ops.
      expect(() => location.reload()).not.toThrow();
      expect(() => history.back()).not.toThrow();
      expect(() => history.forward()).not.toThrow();
      expect(() => history.go(-1)).not.toThrow();
      expect(location.href).toBe("https://next.test/y");
    } finally {
      win.destroy();
    }
  });

  test("navigator exposes the fixed happy-dom baseline mock values", () => {
    const win = new Window();
    try {
      const navigator = win.navigator;
      expect(navigator.userAgent).toContain("HappyDOM/20.11.11");
      expect(navigator.userAgent).toMatch(/^Mozilla\/5\.0 \(X11; /);
      expect(navigator.language).toBe("en-US");
      expect(navigator.languages).toEqual(["en-US", "en"]);
      expect(navigator.appCodeName).toBe("Mozilla");
      expect(navigator.appName).toBe("Netscape");
      expect(navigator.appVersion).toBe(navigator.userAgent.slice(navigator.userAgent.indexOf("/") + 1));
      expect(navigator.platform).toBe(
        navigator.userAgent.slice(
          navigator.userAgent.indexOf("(") + 1,
          navigator.userAgent.indexOf(")"),
        ),
      );
      expect(navigator.product).toBe("Gecko");
      expect(navigator.productSub).toBe("20100101");
      expect(navigator.vendor).toBe("");
      expect(navigator.onLine).toBe(true);
      expect(navigator.cookieEnabled).toBe(true);
      expect(navigator.hardwareConcurrency).toBe(8);
      expect(navigator.maxTouchPoints).toBe(0);
      expect(navigator.webdriver).toBe(true);
      expect(navigator.doNotTrack).toBe("unspecified");
      expect(navigator.toString()).toBe("[object Navigator]");
      expect(navigator.sendBeacon("https://x.test/", "data")).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("window.URL and window.DOMException reuse the host constructors", () => {
    const win = new Window();
    try {
      expect(new win.URL("https://x.test/y").href).toBe("https://x.test/y");
      expect(thrown(() => new win.URL("not a url"))).toBeInstanceOf(TypeError);
      const exception = new win.DOMException("boom", "SecurityError");
      expect(exception.name).toBe("SecurityError");
      expect(exception.message).toBe("boom");
    } finally {
      win.destroy();
    }
  });

  test("each window owns isolated platform state", () => {
    const winA = new Window();
    const winB = new Window();
    try {
      expect(winA.location).not.toBe(winB.location);
      expect(winA.history).not.toBe(winB.history);
      expect(winA.navigator).not.toBe(winB.navigator);
      expect(winA.localStorage).not.toBe(winB.localStorage);
      expect(winA.sessionStorage).not.toBe(winB.sessionStorage);

      winA.location.hash = "#only-a";
      expect(winA.location.href).toBe("about:blank#only-a");
      expect(winB.location.href).toBe("about:blank");

      winA.history.pushState({ only: "a" }, "", "/a");
      expect(winA.history.state).toEqual({ only: "a" });
      expect(winB.history.state).toBeNull();
      expect(winB.history.length).toBe(1);
    } finally {
      winA.destroy();
      winB.destroy();
    }
  });
});
