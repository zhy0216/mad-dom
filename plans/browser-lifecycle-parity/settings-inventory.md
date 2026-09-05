# Settings inventory — happy-dom 20.11.11

Window and Browser use `js/facade/browser-settings.js`. Both validate in the
constructor and merge nested settings. Unknown keys and wrong primitive types
throw the baseline messages. Object sections cannot be null; nullable hook and
adapter slots retain the baseline's permissive validation. Defaults below apply
to both entry points. Mutating settings affects operations that subsequently
read them, rather than rescheduling work already started.

| Key | Default | Consumer / status | Coverage |
| --- | --- | --- | --- |
| `enableJavaScriptEvaluation` | `false` | Classic scripts in write/content/goto; javascript navigation | Lifecycle script matrix |
| `disableJavaScriptEvaluation` | `false` | Deprecated, ignored by the pinned baseline's classic script path | Lifecycle script matrix with both flags true |
| `disableJavaScriptFileLoading` | `false` | Blocks classic external scripts | Lifecycle script matrix |
| `disableCSSFileLoading` | `false` | Deferred: automatic CSS loading | Existing CSSOM covers inline styles only |
| `enableImageFileLoading` | `false` | Deferred: automatic image loading | L8 roadmap |
| `disableIframePageLoading` | `false` | Deferred: child-frame loading | L8 roadmap |
| `disableComputedStyleRendering` | `false` | CSSOM/media-query computed-style behavior | Existing CSSOM/media-query suites |
| `handleDisabledFileLoadingAsSuccess` | `false` | Disabled classic script load/error events | Script pipeline |
| `disableErrorCapturing` | `false` | Timer and classic script error policy | Isolated error capture / timer suites |
| `errorCapture` | `tryAndCatch` | Callback containment; Browser process-level observers when selected | Isolated process test and listener counts |
| `enableFileSystemHttpRequests` | `false` | Deferred: file URL HTTP emulation; virtual servers are explicit mappings | No implementation claim |
| `suppressCodeGenerationFromStringsWarning` | `false` | Accepted; mad-dom does not emit this upstream warning | Settings validation |
| `suppressInsecureJavaScriptEnvironmentWarning` | `false` | Accepted; mad-dom does not emit this upstream warning | Settings validation |
| `timer.maxTimeout` | `-1` | Caps timeout delay; `-1` disables cap | Limit/cancellation differential |
| `timer.maxIntervalTime` | `-1` | Caps interval delay | Limit/cancellation differential |
| `timer.maxIntervalIterations` | `-1` | Baseline boundary: a nonnegative N allows N + 1 callbacks | Iteration differential |
| `timer.preventTimerLoops` | `false` | Per-Window scheduling-stack limits; true means 1; object accepts timeout/animation limits | Recursive timer/animation differential |
| `fetch.disableSameOriginPolicy` | `false` | Deferred: complete CORS/preflight enforcement; do not infer isolation from this flag | Credentials and mixed-content checks are separate |
| `fetch.disableStrictSSL` | `false` | Async Bun fetch TLS verification | Transport option; sync script/XHR transport remains limited |
| `fetch.interceptor` | `null` | before/after async hooks; before/after sync hooks for parser-blocking scripts | Mock never reaches server; header mutation, response replacement, rejection cleanup |
| `fetch.requestHeaders` | `null` | Array of URL/header rules, before interceptors; baseline's string test is rule.url.startsWith(request.url) | Header override and RegExp differentials |
| `fetch.virtualServers` | `null` | Async fetch/navigation and sync/async classic script resources | Existing virtual-server suite |
| `module.resolveNodeModules` | `null` | Deferred: module resolution | L8 roadmap |
| `module.urlResolver` | `null` | Deferred: module resolution | L8 roadmap |
| `module.disableCache` | `false` | Deferred: module cache | L8 roadmap |
| `navigation.disableMainFrameNavigation` | `false` | Blocks main-frame navigation with optional URL fallback | Navigation-policy differential |
| `navigation.disableChildFrameNavigation` | `false` | Deferred: child frames | L8 roadmap |
| `navigation.disableChildPageNavigation` | `false` | Deferred: complete popup/opener ownership and navigation policy | See results limitations |
| `navigation.disableFallbackToSetURL` | `false` | Keeps URL unchanged when navigation is disabled | Navigation-policy differential |
| `navigation.crossOriginPolicy` | `anyOrigin` | Main-frame sameOrigin / strictOrigin restrictions | Navigation-policy differential |
| `navigation.beforeContentCallback` | `null` | Receives fresh Window before content, after per-goto callback | Callback order + script-created timer differential |
| `navigator.userAgent` | Baseline OS/architecture UA with HappyDOM/20.11.11 | Navigator and HTTP headers | Detached settings / fetch suites |
| `navigator.maxTouchPoints` | `0` | Navigator | Detached settings suite |
| `device.prefersColorScheme` | `light` | Media queries | Existing CSSOM suite |
| `device.prefersReducedMotion` | `no-preference` | Media queries | Existing CSSOM suite |
| `device.mediaType` | `screen` | Media queries | Existing CSSOM suite |
| `device.forcedColors` | `none` | Media queries | Existing CSSOM suite |
| `debug.traceWaitUntilComplete` | `-1` | Positive deadline records task stacks, rejects all waiters and cancels work | Concurrent debug-wait differential |
| `viewport.width` | `1024` | Window/page viewport | Existing viewport suite |
| `viewport.height` | `768` | Window/page viewport | Existing viewport suite |
| `viewport.devicePixelRatio` | `1` | Window/page viewport | Existing viewport suite |
| `canvasAdapter` | `null` | Deferred: adapter-driven canvas rendering | No implementation claim |

`goto` consumes `headers`, `hard`, `timeout`, `referrer`, `referrerPolicy` and
`beforeContentCallback`. Its timeout covers headers and body. Full browser
referrer-policy/CORS/redirect-cookie behavior remains outside the bounded
transport implementation. Full modules, child frames and automatic image/CSS
resources remain L8 work.

Script execution is opt-in. Explicit eval remains usable without that setting;
GlobalWindow keeps host eval. VM contexts are not a security boundary.
