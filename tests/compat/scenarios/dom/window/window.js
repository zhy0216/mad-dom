// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/window/Window.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the upstream `Window` constructor surface is
// rebuilt through the public `new entry.Window(options)` / `new
// entry.Window()` and its public members. Ported surfaces:
//   - per-window isolation across multiple `Window` instances — `window.Request`
//     resolves relative URLs against each window's own location and created
//     nodes (`createElement` / `createTextNode` / `createComment`) report
//     their own document as `ownerDocument`, and each window has its own
//     document;
//   - the constructor viewport surface — `innerWidth` / `innerHeight` /
//     `outerWidth` / `outerHeight` / `devicePixelRatio` from the `width` /
//     `height` options (the deprecated `innerWidth` / `innerHeight` aliases
//     and the `settings.viewport` browser setting), with the option values
//     taking precedence over the viewport setting and the happy-dom defaults
//     (1024 × 768, devicePixelRatio 1);
//   - the `url` constructor option and `happyDOM.setURL()` drive the same
//     simulated initial navigation to a fixed URL.
//
// Narrowed assertion surfaces (documented):
//   - the per-window `FileReader` / `DOMParser` / `Range` / `Image` / `Audio` /
//     `DocumentFragment` isolation assertions are dropped — those constructors
//     (elements / parsers / file surface) are outside the implemented window
//     surface of this wave (they belong to the nodes / file subsystems);
//   - the `happyDOM.settings` / `happyDOM.virtualConsolePrinter` and
//     `window.console` assertions are dropped — the `VirtualConsole` /
//     `VirtualConsolePrinter` and the `DetachedWindowAPI.settings` surface is
//     the `DetachedWindowAPI` file of this wave (B-class, no public
//     equivalent);
//   - the `happyDOM` iframe / `window.open()` security-navigation tests are
//     dropped — they drive the internal `Fetch` navigation and are
//     host/mock-dependent;
//   - the exact `Object.getOwnPropertyNames(window)` list is dropped — the
//     own-property shape of the window surface differs between the sides
//     (happy-dom mints every member as an own instance property, mad-dom uses
//     prototype accessors); the presence of the public members is asserted
//     through direct member reads instead.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "window-window";
export const description =
  "real differential: Window constructor surface — per-window isolation (Request URLs + created-node ownerDocument), viewport options (width/height/innerWidth/innerHeight/settings.viewport + devicePixelRatio), url option and happyDOM.setURL";
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

  try {
    // 1. Per-window isolation across multiple Window instances (upstream
    // "Is able to handle multiple instances of Window"): each window resolves
    // its own Request URLs against its own location, and created nodes report
    // their own document as ownerDocument.
    {
      const window1 = new entry.Window({ url: "https://localhost:1" });
      const window2 = new entry.Window({ url: "https://localhost:2" });
      const window3 = new entry.Window({ url: "https://localhost:3" });

      api.record.value("req-1", new window1.Request("test1").url);
      api.record.value("req-2", new window2.Request("test2").url);
      api.record.value("req-3", new window3.Request("test3").url);

      api.record.value("element-owner-1", window1.document.createElement("div").ownerDocument === window1.document);
      api.record.value("element-owner-2", window2.document.createElement("div").ownerDocument === window2.document);
      api.record.value("element-owner-3", window3.document.createElement("div").ownerDocument === window3.document);
      api.record.value("text-owner", window1.document.createTextNode("Test").ownerDocument === window1.document);
      api.record.value("comment-owner", window1.document.createComment("Test").ownerDocument === window1.document);
      api.record.value("docs-distinct", window1.document !== window2.document);
    }

    // 2. Viewport defaults (upstream "Initializes by using given options." —
    // the default branch).
    api.record.value("default-inner", [window.innerWidth, window.innerHeight]);
    api.record.value("default-outer", [window.outerWidth, window.outerHeight]);
    api.record.value("default-dpr", window.devicePixelRatio);
    api.record.value("default-href", window.location.href);

    // 3. Constructor `width` / `height` options drive the viewport.
    {
      const sized = new entry.Window({ width: 1920, height: 1080 });
      api.record.value("sized-inner", [sized.innerWidth, sized.innerHeight]);
      api.record.value("sized-outer", [sized.outerWidth, sized.outerHeight]);
      api.record.value("sized-dpr", sized.devicePixelRatio);
    }

    // 4. Partial width / height options fall back to the defaults.
    {
      const wide = new entry.Window({ width: 1920 });
      api.record.value("wide", [wide.innerWidth, wide.innerHeight, wide.outerWidth, wide.outerHeight]);
      const tall = new entry.Window({ height: 1080 });
      api.record.value("tall", [tall.innerWidth, tall.innerHeight, tall.outerWidth, tall.outerHeight]);
    }

    // 5. Deprecated `innerWidth` / `innerHeight` options
    // (upstream "Supports deprecated innerWidth and innerHeight.").
    {
      const deprecated = new entry.Window({ innerWidth: 1920, innerHeight: 1080 });
      api.record.value("deprecated", [deprecated.innerWidth, deprecated.innerHeight, deprecated.outerWidth, deprecated.outerHeight]);
      // Explicit width / height win over the deprecated aliases.
      const both = new entry.Window({ innerWidth: 1920, innerHeight: 1080, width: 800, height: 600 });
      api.record.value("deprecated-vs-width", [both.innerWidth, both.innerHeight]);
    }

    // 6. The `settings.viewport` browser setting
    // (upstream "Uses viewport browser setting by default.").
    {
      const viewportSetting = new entry.Window({ settings: { viewport: { width: 1920, height: 1080 } } });
      api.record.value("viewport-setting", [viewportSetting.innerWidth, viewportSetting.innerHeight]);
      // Partial viewport settings fall back to the defaults.
      const widthOnly = new entry.Window({ settings: { viewport: { width: 1920 } } });
      api.record.value("viewport-width-only", [widthOnly.innerWidth, widthOnly.innerHeight]);
      // The devicePixelRatio comes from the viewport setting.
      const dpr = new entry.Window({ settings: { viewport: { devicePixelRatio: 2 } } });
      api.record.value("viewport-dpr", [dpr.innerWidth, dpr.devicePixelRatio]);
    }

    // 7. Explicit width / height options override the viewport setting
    // (upstream "It is possible to override viewport browser setting."), and a
    // single explicit dimension mixes with the setting.
    {
      const overridden = new entry.Window({ width: 800, height: 600, settings: { viewport: { width: 1920, height: 1080 } } });
      api.record.value("override", [overridden.innerWidth, overridden.innerHeight]);
      const mixed = new entry.Window({ width: 800, settings: { viewport: { width: 1920, height: 1080 } } });
      api.record.value("mixed", [mixed.innerWidth, mixed.innerHeight, mixed.outerWidth, mixed.outerHeight]);
    }

    // 8. The `url` constructor option and `happyDOM.setURL()` drive the same
    // simulated initial navigation.
    {
      const withUrl = new entry.Window({ url: "http://localhost:8080" });
      api.record.value("url-href", withUrl.location.href);
      api.record.value("url-viewport", [withUrl.innerWidth, withUrl.innerHeight]);
    }
    {
      const navigated = new entry.Window();
      navigated.happyDOM.setURL("https://localhost:8080");
      api.record.value("happyDOM-setURL-href", navigated.location.href);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
