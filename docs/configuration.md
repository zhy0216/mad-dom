# Configuration

Window constructor options describe one detached Window. The nested `settings`
object follows happy-dom's browser-settings shape. Browser accepts
`new Browser({ settings })`, and its pages share that settings object.

## Configure a detached Window

```js
import { Window } from "mad-dom";

const window = new Window({
  url: "https://app.example/",
  width: 1280,
  height: 720,
  settings: {
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    navigator: { userAgent: "MAD DOM test suite", maxTouchPoints: 0 },
  },
});
try {
  console.log(window.happyDOM.settings.enableJavaScriptEvaluation); // true
  console.log(window.navigator.userAgent); // MAD DOM test suite
} finally {
  window.destroy();
}
```

Nested settings are merged with defaults. For a detached Window, unknown keys
and incorrectly typed scalar values throw when settings are initialized.
Browser currently uses a separate merge path and does not enforce identical
validation. Prefer constructor configuration to mutating settings after work
has begun; some changes are only read when the relevant operation starts.

## Settings with implemented behavior

| Setting or option | Scope and effect |
| --- | --- |
| Window `url` | Initial location; does not fetch content |
| Window `width` / `height` | Initial viewport; defaults to 1024 × 768 |
| Window `console` | Supplies `window.console`; otherwise logs go to the virtual printer |
| `enableJavaScriptEvaluation` | Defaults to false; enables script execution through `document.write()`, not through Browser navigation |
| `disableJavaScriptFileLoading` | Defaults to false; skips external scripts on the document-write path when true |
| `navigator.userAgent` / `maxTouchPoints` | Values exposed through `window.navigator` |
| `viewport.width` / `height` / `devicePixelRatio` | Browser page defaults; use `happyDOM.setViewport()` to change a detached Window |
| `device.prefersColorScheme`, `prefersReducedMotion`, `mediaType`, `forcedColors` | Inputs used by the media-query implementation |
| `disableComputedStyleRendering` | Consulted by computed-style behavior; does not provide visual layout |
| `fetch.virtualServers` | Maps Browser navigation to local fixture files; see [Browser](/browser#serve-a-directory-through-a-virtual-url) |
| Browser `errorCapture` | Selects error-capture behavior, including the process-level observer mode |

The complete declared shape is `IBrowserSettings` in the shipped
[`index.d.ts`](https://github.com/zhy0216/mad-dom/blob/main/index.d.ts).
Type presence alone does not mean a setting is implemented in every path.

## Settings still awaiting implementation

| Setting family | Current limitation |
| --- | --- |
| `timer.maxTimeout`, `maxIntervalTime`, `maxIntervalIterations`, `preventTimerLoops` | Stored but not consumed by timer scheduling; explicitly stop intervals and use test timeouts |
| `fetch.interceptor` | Hooks are accepted but not called; do not depend on them to mock requests |
| `fetch.requestHeaders` | Default headers are not applied through this setting; pass request headers directly |
| `fetch.disableSameOriginPolicy`, `disableStrictSSL` | Do not currently control the direct fetch implementation |
| `module.*` | No complete Browser module-loading pipeline |
| Navigation policy flags and `beforeContentCallback` | Not wired into the current navigation path |
| Automatic image, CSS, and iframe loading settings | Do not make `goto()` load a complete page with subresources and child frames |

The detached and Browser timer defaults differ in the current code, and neither
set of limits is enforced. These differences, validation, script behavior,
and task ownership are recorded in the
[repair plan](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md).

## Error capture

Use the default error handling for ordinary tests, and inspect the Window's
`error` events or virtual console. `BrowserErrorCaptureEnum.processLevel`
installs process-level `uncaughtException` and `unhandledRejection` observers
while Browser pages are open. That mode can interact with a test runner's own
handlers. The repository exercises it in a separate process; follow the same
pattern when your test specifically needs process-level capture.

## Native binary selection

`MAD_DOM_NATIVE_PATH` is an environment variable for selecting a native
artifact. It is separate from Window/Browser settings:

```sh
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun example.mjs
```

It takes precedence over installed platform packages and the source checkout's
default build artifact. Use it when verifying a local source build so the
installed npm binary cannot accidentally be measured instead. See
[Platforms and troubleshooting](/platforms) for the loader's resolution order
and error codes.
