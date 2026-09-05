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

Window and Browser use the same validated defaults and nested merge logic.
Unknown keys and incorrectly typed scalar values throw in the constructor. Prefer constructor configuration to mutating settings after work
has begun; some changes are only read when the relevant operation starts.

## Settings with implemented behavior

| Setting or option | Scope and effect |
| --- | --- |
| Window `url` | Initial location; does not fetch content |
| Window `width` / `height` | Initial viewport; defaults to 1024 × 768 |
| Window `console` | Supplies `window.console`; otherwise logs go to the virtual printer |
| `enableJavaScriptEvaluation` | Defaults to false; enables classic scripts through `document.write()`, Browser content and navigation |
| `disableJavaScriptFileLoading` | Defaults to false; skips external classic scripts on all content paths when true |
| `navigator.userAgent` / `maxTouchPoints` | Values exposed through `window.navigator` |
| `viewport.width` / `height` / `devicePixelRatio` | Browser page defaults; use `happyDOM.setViewport()` to change a detached Window |
| `device.prefersColorScheme`, `prefersReducedMotion`, `mediaType`, `forcedColors` | Inputs used by the media-query implementation |
| `disableComputedStyleRendering` | Consulted by computed-style behavior; does not provide visual layout |
| `fetch.virtualServers` | Maps fetch, navigation and script loads to local fixture files; see [Browser](/browser#serve-a-directory-through-a-virtual-url) |
| `timer.maxTimeout`, `maxIntervalTime` | Cap delays; `-1` means unlimited |
| `timer.maxIntervalIterations` | Stops after limit + 1 callbacks, matching 20.11.11; `-1` means unlimited |
| `timer.preventTimerLoops` | Limits repeated scheduling stacks; accepts `true` or `{ timeout, requestAnimationFrame }` |
| `fetch.interceptor` | Async before/after request hooks; sync hooks for parser-blocking scripts |
| `fetch.requestHeaders` | Applies configured header rules before interceptors |
| `fetch.disableStrictSSL` | Controls TLS verification on async fetch |
| `navigation.beforeContentCallback` | Runs after the per-navigation callback, before parsing content |
| Navigation main-frame/policy flags | Restrict navigation and optional URL fallback |
| `handleDisabledFileLoadingAsSuccess` | Reports disabled classic script loads as load events |
| `debug.traceWaitUntilComplete` | Positive milliseconds enable task traces and a rejecting wait deadline |
| Browser `errorCapture` | Selects error-capture behavior, including the process-level observer mode |

The complete declared shape is `IBrowserSettings` in the shipped
[`index.d.ts`](https://github.com/zhy0216/mad-dom/blob/main/index.d.ts).
Type presence alone does not mean a setting is implemented in every path.

## Settings still awaiting implementation

| Setting family | Current limitation |
| --- | --- |
| `fetch.disableSameOriginPolicy` | A complete direct-fetch CORS/preflight implementation is deferred |
| `module.*` | No complete module-loading pipeline |
| `navigation.disableChildFrameNavigation` | Child frames are deferred |
| Automatic image, CSS, and iframe loading settings | Do not load a complete rendered page |
| `enableFileSystemHttpRequests`, `canvasAdapter` | Accepted; no corresponding consumer in the bounded lifecycle implementation |
| Warning suppression flags | Accepted; mad-dom does not emit the upstream VM warnings |

`disableJavaScriptEvaluation` is a deprecated stored flag in the pinned
baseline; the positive `enableJavaScriptEvaluation` flag controls script
execution. Both Window and Browser use `-1` for the three timer limits.
The complete per-key defaults, consumers, coverage and limitations are recorded
in the [settings inventory](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/settings-inventory.md).

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
