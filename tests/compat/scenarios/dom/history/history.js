// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/history/History.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: every assertion goes through the public
// `window.history` state machine of a `new Window()` / `new Window({ url })`.
// The upstream drives the same surface through a browser page frame
// (`new Browser().newPage().mainFrame.window`); the detached-window history
// state machine is the public equivalent. The internal enum values are inlined
// from the vendored literal source
// (`tests/happy-dom/vendor-src-enums/history/HistoryScrollRestorationEnum.ts`):
// `HistoryScrollRestorationEnum.auto = "auto"` and
// `HistoryScrollRestorationEnum.manual = "manual"`.
//
// Narrowed assertion surfaces (documented):
//   - the `back()` / `forward()` / `go()` navigation tests are dropped — they
//     drive a real navigation flow through the internal `Fetch` (mocked via
//     `vi.spyOn(Fetch.prototype, 'send')`) and `waitForNavigation()` and read
//     the internal `browserFrame[internal symbol-slot history]` item list;
//     neither the fetch mock nor the navigation is available on the public
//     surface;
//   - the `internal history items / push()` slot assertions have no public
//     equivalent; the corresponding public observations
//     (`history.length`, `history.state`, `window.location.href`) are asserted
//     instead through the public `pushState` / `replaceState` methods;
//   - the `popstate` event assertions are dropped — happy-dom dispatches
//     `popstate` asynchronously during history traversal, which is part of the
//     dropped navigation flow.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "history-history";
export const description =
  "real differential: window.history public state machine — length/state/scrollRestoration, pushState/replaceState (arg-count TypeErrors, cross-origin SecurityError), absolute-URL pushes after setURL";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const history = window.history;
  const document = window.document;

  try {
    // 1. Initial state (upstream `get length()` / `get state()` /
    // `get scrollRestoration()` defaults): one entry at about:blank, no state,
    // scroll restoration "auto".
    api.record.value("hist-length-initial", history.length);
    api.record.value("hist-state-initial", history.state);
    api.record.value("hist-scroll-initial", history.scrollRestoration);

    // 2. `pushState()` with an empty URL on about:blank (upstream
    // `pushState()`): pushes a same-URL entry, keeps the href, sets the state.
    {
      const lengthBefore = history.length;
      history.pushState({ key: "value" }, "", "");
      api.record.value("push-state", history.state);
      api.record.value("push-length-delta", history.length - lengthBefore);
      api.record.value("push-href", window.location.href);
      api.record.value("push-doc-url", document.URL);
    }

    // 3. `pushState()` with a relative URL cannot resolve against the
    // about:blank base — the entry is still pushed with the current URL.
    {
      const lengthBefore = history.length;
      history.pushState(null, "", "/rel");
      api.record.value("push-rel-state", history.state);
      api.record.value("push-rel-length-delta", history.length - lengthBefore);
      api.record.value("push-rel-href", window.location.href);
    }

    // 4. `replaceState()` replaces the current entry (upstream
    // `replaceState()`): state updates, length is unchanged.
    {
      const lengthBefore = history.length;
      history.replaceState({ key: "value2" }, "", "");
      api.record.value("replace-state", history.state);
      api.record.value("replace-length-delta", history.length - lengthBefore);
      api.record.value("replace-href", window.location.href);
    }

    // 5. `pushState()` / `replaceState()` argument-count validation.
    {
      try {
        history.pushState();
        api.record.value("push-no-args", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }
    {
      try {
        history.pushState({});
        api.record.value("push-one-arg", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }
    {
      try {
        history.replaceState();
        api.record.value("replace-no-args", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }

    // 6. `pushState()` with a cross-origin absolute URL throws a
    // SecurityError (against the about:blank origin).
    {
      try {
        history.pushState({}, "", "https://evil.example.com/x");
        api.record.value("push-cross-origin", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }

    // 7. `pushState()` / `replaceState()` with absolute same-origin URLs after
    // `happyDOM.setURL()`: the URL state machine (upstream pushState/replace
    // `href` surface — the same URL resolution the navigation tests use).
    {
      const navigable = new entry.Window();
      navigable.happyDOM.setURL("https://www.example.com/");
      const navHistory = navigable.history;
      const lengthBefore = navHistory.length;
      navHistory.pushState({ t: "v" }, "", "/test/");
      api.record.value("push-abs-href", navigable.location.href);
      api.record.value("push-abs-length-delta", navHistory.length - lengthBefore);
      api.record.value("push-abs-state", navHistory.state);
      navHistory.pushState(null, null, "https://www.example.com/test2/");
      api.record.value("push-abs-2-href", navigable.location.href);
      api.record.value("push-abs-2-length-delta", navHistory.length - lengthBefore);
      navHistory.replaceState({ r: "x" }, "", "/replaced/");
      api.record.value("replace-abs-href", navigable.location.href);
      api.record.value("replace-abs-state", navHistory.state);
      api.record.value("replace-abs-length-delta", navHistory.length - lengthBefore);
    }

    // 8. `scrollRestoration` setter (upstream `get/set scrollRestoration()`):
    // only "auto" / "manual" are accepted; an invalid value is ignored.
    {
      history.scrollRestoration = "invalid";
      api.record.value("scroll-invalid", history.scrollRestoration);
      history.scrollRestoration = "manual";
      api.record.value("scroll-manual", history.scrollRestoration);
      history.scrollRestoration = "invalid";
      api.record.value("scroll-invalid-after-manual", history.scrollRestoration);
      history.scrollRestoration = "auto";
      api.record.value("scroll-auto", history.scrollRestoration);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
