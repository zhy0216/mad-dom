// Real differential scenario (T45): localStorage / sessionStorage and cookies.
//
// Scope is exactly the T45 storage + cookie slice, calibrated against the
// locked happy-dom 20.11.11 observable behavior on a default (about:blank)
// window:
//
//   - storage string conversion (setItem coerces with String, own-key
//     descriptors, length / key / getItem / removeItem / clear, key ordering,
//     property write-through and delete), per-window and per-area isolation;
//   - cookie string parsing (key/value, no-value, attributes), scope
//     filtering (path / domain / secure / __Secure- / __Host- prefixes,
//     httpOnly, SameSite), expiry (Expires / Max-Age) and ordering.
//
// happy-dom fires no `storage` events on a detached window and its storage has
// no quota limit, so neither is probed here (and neither diverges).
export const id = "dom-storage-cookie";
export const description =
  "real differential: localStorage/sessionStorage (coercion, ordering, descriptors, isolation) and document.cookie (parsing, scope, expiry, ordering)";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;
  const localStorage = window.localStorage;
  const sessionStorage = window.sessionStorage;

  try {
    // 1. Empty storage surface.
    api.record.value("ls-length-empty", localStorage.length);
    api.record.value("ls-key-empty", localStorage.key(0));
    api.record.value("ls-key-negative", localStorage.key(-1));
    api.record.value("ls-get-missing", localStorage.getItem("missing"));
    api.record.value("ls-prop-missing", localStorage["missing"]);
    api.record.value("ls-keys-empty", Object.keys(localStorage));
    api.record.value("ls-string", String(localStorage));
    api.record.value("ls-proto-name", Object.getPrototypeOf(localStorage).constructor.name);

    // 2. setItem string coercion.
    localStorage.setItem("a", 1);
    localStorage.setItem("b", null);
    localStorage.setItem("c", undefined);
    localStorage.setItem("d", { x: 1 });
    localStorage.setItem("e", true);
    api.record.value("ls-coerced", [
      localStorage.getItem("a"),
      localStorage.getItem("b"),
      localStorage.getItem("c"),
      localStorage.getItem("d"),
      localStorage.getItem("e"),
    ]);
    api.record.value("ls-length-after-set", localStorage.length);

    // 3. Key ordering: integer-like keys first (ascending), then insertion.
    localStorage.clear();
    localStorage.setItem("10", "x");
    localStorage.setItem("2", "y");
    localStorage.setItem("a", "z");
    api.record.value("ls-keys-order", Object.keys(localStorage));
    api.record.value("ls-key-0", localStorage.key(0));
    api.record.value("ls-key-1", localStorage.key(1));
    api.record.value("ls-key-2", localStorage.key(2));
    api.record.value("ls-key-99", localStorage.key(99));

    // 4. Property read/write through the proxy.
    api.record.value("ls-prop-read", localStorage["a"]);
    localStorage["f"] = 42;
    api.record.value("ls-prop-write", localStorage.getItem("f"));
    api.record.value("ls-has-f", "f" in localStorage);
    api.record.value("ls-own-f", Object.prototype.hasOwnProperty.call(localStorage, "f"));
    api.record.descriptor("ls-prop-f-desc", localStorage, "f");
    api.record.value("ls-delete-prop", delete localStorage["f"]);
    api.record.value("ls-after-delete-get", localStorage.getItem("f"));
    api.record.value("ls-after-delete-has", "f" in localStorage);

    // 5. removeItem / clear.
    localStorage.removeItem("a");
    api.record.value("ls-after-remove-get", localStorage.getItem("a"));
    api.record.value("ls-after-remove-keys", Object.keys(localStorage));
    localStorage.clear();
    api.record.value("ls-after-clear-length", localStorage.length);
    api.record.value("ls-after-clear-keys", Object.keys(localStorage));

    // 6. Isolation: localStorage vs sessionStorage, and a second window.
    localStorage.setItem("shared", "ls");
    sessionStorage.setItem("shared", "ss");
    api.record.value("ls-isolation", localStorage.getItem("shared"));
    api.record.value("ss-isolation", sessionStorage.getItem("shared"));
    api.record.value("ls-length-isolated", localStorage.length);
    const secondWindow =
      typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
    api.record.value("win2-ls-get", secondWindow.localStorage.getItem("shared"));
    api.record.value("win2-ls-length", secondWindow.localStorage.length);

    // 7. Cookies: empty read.
    api.record.value("cookie-empty", document.cookie);

    // 8. Cookie write / read string round-trips.
    document.cookie = "name=value";
    api.record.value("cookie-basic", document.cookie);
    document.cookie = "a=1";
    document.cookie = "b=2";
    api.record.value("cookie-multi", document.cookie);
    document.cookie = "flag";
    api.record.value("cookie-novalue", document.cookie);
    document.cookie = "name=newvalue";
    api.record.value("cookie-replace-string", document.cookie);

    // 9. httpOnly cookies are filtered from the client-side document.cookie.
    document.cookie = "hidden=1; HttpOnly";
    api.record.value("cookie-httponly-filtered", document.cookie);
    document.cookie = "hidden=2";
    api.record.value("cookie-httponly-overwrite", document.cookie);

    // 10. Secure / prefix validation on the about: blank window (no https, so
    // secure cookies are created but never readable; invalid prefixes are not
    // created at all).
    document.cookie = "s=1; Secure";
    api.record.value("cookie-secure", document.cookie);
    document.cookie = "__Secure-a=1; Secure";
    api.record.value("cookie-secure-prefix-ok", document.cookie);
    document.cookie = "__Secure-b=1";
    api.record.value("cookie-secure-prefix-invalid", document.cookie);
    document.cookie = "__Host-h=1; Secure; Path=/";
    api.record.value("cookie-host-prefix-ok", document.cookie);
    document.cookie = "__Host-hb=1; Secure";
    api.record.value("cookie-host-prefix-invalid", document.cookie);

    // 11. Expiry: a past Expires / negative Max-Age removes the cookie; a
    // future Max-Age keeps it.
    document.cookie = "gone=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    api.record.value("cookie-expired", document.cookie);
    document.cookie = "kept=1; Max-Age=3600";
    api.record.value("cookie-max-age-future", document.cookie);
    document.cookie = "dropped=1; Max-Age=-1";
    api.record.value("cookie-max-age-negative", document.cookie);

    // 12. Scope filtering on about: blank: a Path=/ cookie never matches the
    // "blank" pathname and a SameSite=None insecure cookie is unreadable.
    document.cookie = "scoped=1; Path=/";
    api.record.value("cookie-path-scope", document.cookie);
    document.cookie = "nosamesite=1; SameSite=None";
    api.record.value("cookie-samesite-none-insecure", document.cookie);

    // 13. Cookie ordering is insertion order.
    document.cookie = "zz=1";
    document.cookie = "aa=2";
    api.record.value("cookie-order", document.cookie);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
