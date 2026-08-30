import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";

// T45 Storage / Cookie integration tests.
//
// They drive `window.localStorage` / `window.sessionStorage` and
// `document.cookie` through the official package entry and pin the acceptance
// criteria:
//
//   - storage string conversion and ordering — values are coerced with
//     `String()`, keys with `String(name)`, own-key descriptors are
//     `{ value, writable: true, enumerable: true, configurable: true }`, and
//     `Object.keys` follows the JS property order (integer-like keys ascending
//     first, then insertion order);
//   - storage isolation — `localStorage` and `sessionStorage` are distinct
//     areas per window, and two windows never share an area;
//   - storage exceptions / events — setting, reading, removing and clearing
//     never throw (happy-dom has no quota limit on a detached window) and no
//     `storage` event is dispatched (the baseline fires none);
//   - cookie parsing, scope and ordering — `document.cookie` writes are parsed
//     with the `Set-Cookie` attributes (path / domain / secure / httpOnly /
//     SameSite / Expires / Max-Age / __Secure- / __Host- prefixes), read back
//     as `key=value; ...` in insertion order, filtered by URL scope, and
//     removed on expiry.
//
// The runtime block skips without the locally built native artifact
// (npm run dev:build, or MAD_DOM_NATIVE_PATH), exactly like the other native
// suites.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.skipIf(!nativeAvailable)("storage (T45)", () => {
  test("an empty area reports length 0, null reads and an empty key list", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      expect(storage.length).toBe(0);
      expect(storage.key(0)).toBeNull();
      expect(storage.key(-1)).toBeNull();
      expect(storage.getItem("missing")).toBeNull();
      expect(storage["missing"]).toBeUndefined();
      expect(Object.keys(storage)).toEqual([]);
      expect(String(storage)).toBe("[object Object]");
    } finally {
      win.destroy();
    }
  });

  test("setItem coerces values with String and reads them back verbatim", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      storage.setItem("a", 1);
      storage.setItem("b", null);
      storage.setItem("c", undefined);
      storage.setItem("d", { x: 1 });
      storage.setItem("e", true);
      expect(storage.getItem("a")).toBe("1");
      expect(storage.getItem("b")).toBe("null");
      expect(storage.getItem("c")).toBe("undefined");
      expect(storage.getItem("d")).toBe("[object Object]");
      expect(storage.getItem("e")).toBe("true");
      expect(storage.length).toBe(5);
      expect(Object.keys(storage)).toEqual(["a", "b", "c", "d", "e"]);
    } finally {
      win.destroy();
    }
  });

  test("key ordering follows JS property order: integer-like keys first, then insertion", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      storage.clear();
      storage.setItem("10", "x");
      storage.setItem("2", "y");
      storage.setItem("a", "z");
      expect(Object.keys(storage)).toEqual(["2", "10", "a"]);
      expect(storage.key(0)).toBe("2");
      expect(storage.key(1)).toBe("10");
      expect(storage.key(2)).toBe("a");
      expect(storage.key(99)).toBeNull();
      expect(storage.getItem("10")).toBe("x");
    } finally {
      win.destroy();
    }
  });

  test("property reads and writes funnel through the storage area", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      storage.setItem("a", "1");
      expect(storage["a"]).toBe("1");
      storage["f"] = 42;
      expect(storage.getItem("f")).toBe("42");
      expect("f" in storage).toBe(true);
      expect(Object.getOwnPropertyDescriptor(storage, "f")).toEqual({
        value: "42",
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(delete storage["f"]).toBe(true);
      expect(storage.getItem("f")).toBeNull();
      expect("f" in storage).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("removeItem and clear drop the stored keys", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      storage.setItem("a", "1");
      storage.setItem("b", "2");
      storage.removeItem("a");
      expect(storage.getItem("a")).toBeNull();
      expect(Object.keys(storage)).toEqual(["b"]);
      storage.clear();
      expect(storage.length).toBe(0);
      expect(Object.keys(storage)).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("setItem / getItem / key never throw and no storage event is dispatched", () => {
    const win = new Window();
    try {
      const storage = win.localStorage;
      // No quota limit on the detached-window baseline: bulk writes stay
      // silent (no QuotaExceededError) and no `storage` event fires.
      const events = [];
      win.addEventListener?.("storage", () => events.push("storage"));
      for (let i = 0; i < 200; i++) {
        storage.setItem(`k${i}`, `v${i}`);
      }
      expect(storage.length).toBe(200);
      expect(storage.getItem("k199")).toBe("v199");
      expect(storage.key(199)).toBe("k199");
      expect(thrown(() => storage.setItem("x", "y"))).toBeUndefined();
      expect(events).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("localStorage and sessionStorage are isolated areas, isolated across windows", () => {
    const win = new Window();
    const second = new Window();
    try {
      win.localStorage.setItem("shared", "ls");
      win.sessionStorage.setItem("shared", "ss");
      expect(win.localStorage.getItem("shared")).toBe("ls");
      expect(win.sessionStorage.getItem("shared")).toBe("ss");
      expect(win.localStorage).not.toBe(win.sessionStorage);

      expect(second.localStorage.getItem("shared")).toBeNull();
      expect(second.sessionStorage.getItem("shared")).toBeNull();
      expect(second.localStorage.length).toBe(0);
    } finally {
      win.destroy();
      second.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("cookies (T45)", () => {
  test("an empty jar reads back an empty string", () => {
    const win = new Window();
    try {
      expect(win.document.cookie).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("cookie writes round-trip as key=value pairs in insertion order", () => {
    const win = new Window();
    try {
      const document = win.document;
      document.cookie = "name=value";
      expect(document.cookie).toBe("name=value");
      document.cookie = "a=1";
      document.cookie = "b=2";
      expect(document.cookie).toBe("name=value; a=1; b=2");
      document.cookie = "flag";
      expect(document.cookie).toBe("name=value; a=1; b=2; flag");
      document.cookie = "name=newvalue";
      expect(document.cookie).toBe("a=1; b=2; flag; name=newvalue");
    } finally {
      win.destroy();
    }
  });

  test("an empty key is rejected and a value-less cookie is legal", () => {
    const win = new Window();
    try {
      const document = win.document;
      document.cookie = "=novalue";
      expect(document.cookie).toBe("");
      document.cookie = "bare";
      expect(document.cookie).toBe("bare");
      document.cookie = "bare2=";
      expect(document.cookie).toBe("bare; bare2=");
    } finally {
      win.destroy();
    }
  });

  test("httpOnly cookies are hidden from document.cookie but replaced by name", () => {
    const win = new Window();
    try {
      const document = win.document;
      document.cookie = "visible=1";
      document.cookie = "hidden=1; HttpOnly";
      expect(document.cookie).toBe("visible=1");
      // A later non-httpOnly write with the same key replaces it.
      document.cookie = "hidden=2";
      expect(document.cookie).toBe("visible=1; hidden=2");
    } finally {
      win.destroy();
    }
  });

  test("expired cookies (Expires / Max-Age) are dropped and never read back", () => {
    const win = new Window();
    try {
      const document = win.document;
      document.cookie = "kept=1";
      document.cookie = "gone=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
      expect(document.cookie).toBe("kept=1");
      document.cookie = "future=1; Max-Age=3600";
      expect(document.cookie).toBe("kept=1; future=1");
      document.cookie = "dropped=1; Max-Age=-1";
      expect(document.cookie).toBe("kept=1; future=1");
    } finally {
      win.destroy();
    }
  });

  test("scope and prefix rules filter the jar deterministically", () => {
    const win = new Window();
    try {
      const document = win.document;
      // about:blank: a Path=/ cookie never matches the "blank" pathname.
      document.cookie = "scoped=1; Path=/";
      expect(document.cookie).toBe("");
      // A Secure cookie is never readable on a non-https page.
      document.cookie = "s=1; Secure";
      expect(document.cookie).toBe("");
      // __Secure- requires Secure; __Host- requires Secure + root path.
      document.cookie = "__Secure-ok=1; Secure";
      expect(document.cookie).toBe("");
      document.cookie = "__Secure-bad=1";
      expect(document.cookie).toBe("");
      document.cookie = "__Host-ok=1; Secure; Path=/";
      expect(document.cookie).toBe("");
      document.cookie = "__Host-bad=1; Secure";
      expect(document.cookie).toBe("");
      // A SameSite=None cookie is readable on about:blank because the cookie's
      // origin hostname matches the page hostname (both empty on about:blank).
      document.cookie = "none=1; SameSite=None";
      expect(document.cookie).toBe("none=1");
    } finally {
      win.destroy();
    }
  });

  test("cookies are scoped to the owning window and isolated across windows", () => {
    const winA = new Window();
    const winB = new Window();
    try {
      winA.document.cookie = "only-a=1";
      expect(winA.document.cookie).toBe("only-a=1");
      expect(winB.document.cookie).toBe("");
    } finally {
      winA.destroy();
      winB.destroy();
    }
  });
});
