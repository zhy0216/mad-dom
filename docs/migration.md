# Migrating from happy-dom

Start with a small group of DOM tests under Bun, change the import, and verify
their results. MAD DOM targets **happy-dom 20.11.11** and is currently alpha.

## Install and change imports

```sh
bun add -d mad-dom@next
```

```diff
- import { Window, Browser } from "happy-dom";
+ import { Window, Browser } from "mad-dom";
```

Use the public package entry. Internal paths such as `happy-dom/lib/...` and
upstream `PropertySymbol` hooks are not a migration contract. If you annotate
DOM values with happy-dom types, update those type imports as well.

## What stays familiar

| Existing usage | MAD DOM entry point |
| --- | --- |
| `new Window({ url, width, height, settings })` | [Window](/window) |
| `window.document`, selectors, events, forms, templates | [DOM guide](/dom) |
| `window.customElements`, `attachShadow()` | [Web components](/web-components) |
| `window.happyDOM.setURL()` / `setViewport()` | [Window controls](/window#url-and-viewport) |
| `Browser`, pages, `mainFrame.document` | [Browser](/browser) |
| `GlobalWindow` for host-context evaluation | [GlobalWindow](/window#globalwindow) |

The `happyDOM` property retains its name for API compatibility. Creating a
Window does not automatically install DOM globals in your Bun process.

## Check setup integrations separately

The `@happy-dom/global-registrator`, `@happy-dom/jest-environment`, and
`@happy-dom/server-renderer` packages belong to the upstream project. Installing
mad-dom does not change the engine inside those packages. Likewise, a runner
configuration selecting its built-in happy-dom environment still selects that
environment.

For Bun, use explicit Window instances or the small
[preload example](/testing#modules-that-expect-dom-globals). This repository
does not ship equivalent adapter packages or establish full React, Vue, Vitest,
or Jest integration support. Test your renderer, event helpers, matchers, and
module import order together before expanding the migration.

## Review behavior-sensitive code

| If your suite relies on… | Check before switching |
| --- | --- |
| `happyDOM.waitUntilComplete()` | Window-owned timers are tracked; direct fetch and all host async work are not. Await operation promises explicitly. |
| `browser.waitUntilComplete()` / `page.waitUntilComplete()` | These currently wait for navigation, not every task in the page's Window. |
| `abort()` or close canceling pending work | Abort cancels Window work and allows reuse. Close cancels work and clears owned observers/listeners; retained Windows expose empty documents. |
| Several windows with active observers | Current `happyDOM.close()` disconnects observers across windows. Coordinate teardown; this is a tracked bug. |
| Scripts in downloaded pages | `goto()`, `page.content` and `document.write()` share opt-in classic script execution. Module and full subresource loading remain incomplete. |
| Fetch interceptors or timer limits | Some settings are accepted but unused. Check [Configuration](/configuration). |
| Cookies during navigation | Pages share context cookies through document access, fetch and navigation; incognito contexts remain isolated. |
| Layout or screenshots | There is no layout/painting engine; common geometry properties return zero. |

These lifecycle and settings issues are scheduled in the
[repair plan](https://github.com/zhy0216/mad-dom/blob/main/plans/browser-lifecycle-parity/plan.md).
Use the [Async guide](/async) for current cleanup patterns.

## Verify correctness, then performance

Run the same assertions against both engines. Include unusual selectors,
form behavior, async updates, custom elements, and teardown, as these often
exercise more than simple tree operations. A minimal reproduction should set up
one document and record the exact differing value or callback sequence.

Once both variants pass, compare multiple runs with identical setup. The
recorded 2.83× core / 1.57× workflow improvement is a starting point for
evaluation; see [Performance](/performance) for the measured scope. Keep the
previous dependency and configuration available until the migrated suite passes.

For the project's own coverage and reproduction commands, see
[Compatibility](/compat-report).
