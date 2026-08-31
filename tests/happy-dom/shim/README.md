# happy-dom src-path shim layer (hdunit T04)

This directory hosts the **re-export shim layer** that lets rewritten happy-dom
unit tests (`import X from '…/src/a/B.js'`) resolve upstream internal module
paths to mad-dom facade bindings.

- Generated shims: `tests/happy-dom/shim/src/**` (regenerate with
  `bun scripts/generate-happy-dom-shim.mjs`, or `npm run compat:hdunit:shim`).
- Hand-written layer: `tests/happy-dom/shim/adapters/window-settings.ts`
  (the `Window` settings constructor-signature adapter) and
  `tests/happy-dom/shim/shim.test.ts` (the T04 self-test).
- Coverage / gap summary: `tests/happy-dom/shim/shim-manifest.json`.

## The one rule: shims are name/signature alignment, never behavior

A shim file contains **only re-exports and constructor-signature adaptation**.
No DOM behavior of any kind is implemented here. Behavior differences between
upstream happy-dom and mad-dom are **not** patched in the shim layer — they are
recorded (as a gap shim, a manifest entry, or a Window-settings warning) and
left for the subsystem waves (T06–T10) to fix in facade/core.

## What each shim contains

Every mappable `src/` module from the frozen `vendor-scan.json` contract gets
`shim/src/<shimPath>.ts` (bun resolves the rewritten `.js` import specifier to
the `.ts` shim). The generator picks one of these forms, in priority order:

| Kind | Content | Reference-equal to |
| --- | --- | --- |
| `package` | `export { X as default } from "mad-dom"` | the facade public export |
| `facade` | `import "mad-dom"; export { X as default } from "<internal facade module>"` | the facade's own internal class |
| `vendor-enum` | `export { default } from "<vendor-src-enums/…>"` | the T01-vendored upstream literals |
| `type-only` | `export default undefined` | upstream (interface has no runtime value) |
| `gap` | `export default undefined` (recorded) | — (no facade binding yet) |
| `index` | `export * from "mad-dom"` | the facade public surface |

Rationale for each:

- **`package`** shims are reference-equal to `(await import('mad-dom')).X` by
  construction (`import W from shim; W === (await import('mad-dom')).Window`).
- **`facade`** shims exist because mad-dom implements many WHATWG classes
  internally (`Node`, `Element`, `HTMLElement`, `Request`, `Range`, …) but does
  not yet export them from the package entry. The shim re-exports the facade
  binding directly, so it stays reference-equal to the class the facade itself
  uses. The leading `import "mad-dom"` forces the facade module-init order
  (the internal modules are only readable after the facade registry has run).
- **`vendor-enum`** shims deliver **honest values**: the literals are copied
  verbatim from the locked upstream baseline by T01
  (`tests/happy-dom/vendor-src-enums/**`, MIT, provenance in every file). The
  upstream enum values ARE the behavior contract, so copying them is correct,
  not fabrication. They are delivered as a re-export of the vendored module to
  guarantee identity with those literals.
- **`type-only`** shims mirror the upstream runtime faithfully: an interface
  erases at compile time, so the default export is `undefined` upstream too.
- **`gap`** shims are the honest record of "the mad-dom facade has no such
  class yet" (e.g. `EventTarget`, `Blob`, `DOMParser`, `SVGElement`,
  `BrowserWindow`, most media classes, …). They make the rewritten import
  *resolve*; using the default (which is `undefined`) fails with the standard
  `TypeError`. Every gap is listed in `shim-manifest.json` for wave triage —
  it is never silently fabricated.
- **`index`** shim (`shim/src/index.ts`) backs the upstream `src/index.js`
  named-import surface; every name points at a facade public export.

## Exclusions (never generated)

`PropertySymbol.js` is `mappable: true` in the scan but is a documented T04
exclusion: the private-symbol mechanism is semantically not portable to the
mad-dom facade. Its dependent test files are triaged `not-applicable` in T10.
The exclusion list lives in the generator (`EXCLUDED_MAPPABLE`) and in
`shim-manifest.json`; the coverage gate counts every mappable path **minus**
these documented exclusions and fails (exit 1) if any required shim is missing.

Not-shimmed on purpose: `*Utility` / internal parsers (`CSSParser`,
`HTMLParser`, fetch internals, …) are marked not-mappable in the scan and are
out of scope here (T10 triage).

## Window settings constructor-signature adaptation

happy-dom tests construct `new Window({ url, settings: { enableJavaScriptEvaluation, … } })`.
The facade `Window` constructor already accepts a plain options object (mints a
native window, honors `url`), so construction works unchanged. Because the shim
class must stay **reference-equal** to the facade `Window`, the adaptation is a
companion export: `adaptWindowSettings(options, { warn })` (from
`shim/src/window/Window.js`) classifies each happy-dom setting against facade
capabilities and returns `{ windowOptions, mapped, ignored, warnings }`.

- `url` is **mapped** (facade simulated initial navigation).
- Every other happy-dom window setting currently has **no facade toggle** and is
  **ignored with a recorded warning** — never silently dropped. The self-test
  pins this (`shim.test.ts`, "Window settings adaptation").
- Other config-bearing constructors (`Browser`) already accept the happy-dom
  options shape in the facade, so no extra shim wrapper is needed.

## Usage & validation

```sh
# regenerate shims + run the coverage gate (fails exit 1 on a missing shim)
bun scripts/generate-happy-dom-shim.mjs
npm run compat:hdunit:shim

# self-test: coverage, reference equality, honest enums, gaps, Window settings
bun test tests/happy-dom/shim
```

The generator is idempotent (fixed headers, no timestamps); re-running it
produces no diff. The `new Window(...)` construction tests skip when the native
binding is not built (`isNativeAvailable()`), so the self-test stays green in
any checkout; the classification/warning half always runs.
