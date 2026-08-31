// Window settings constructor-signature adapter (mad-dom hdunit T04).
//
// happy-dom tests construct windows as `new Window({ url, settings: { … } })`.
// The mad-dom facade `Window` constructor already accepts a plain options
// object (it mints a native window and honors `url`), so `new Window({ settings })`
// returns a working facade Window instance out of the box.
//
// What this adapter adds is the **name/signature alignment contract**: it
// classifies every happy-dom window setting against the facade capabilities
// and reports the ones the facade has no switch for, so an unmappable toggle is
// recorded (a warning), never silently dropped. Per the T04 boundary the shim
// implements **no DOM behavior** — this module only classifies and records; it
// does not construct windows, evaluate scripts or configure anything.
//
// The shim class itself stays reference-equal to `(await import('mad-dom')).Window`
// (see tests/happy-dom/shim/README.md); this adapter is the companion used by
// the shim layer and its self-tests.

/**
 * Settings the facade Window maps to a real capability. Currently only the
 * top-level `url` is honored by the facade (simulated initial navigation);
 * everything else has no facade toggle yet and is reported as ignored.
 */
export const MAPPED_WINDOW_OPTIONS = ["url"];

/**
 * Known happy-dom window `settings` keys. Anything else passed inside
 * `settings` is still recorded (as unknown) rather than silently dropped.
 */
export const KNOWN_WINDOW_SETTINGS = [
  "enableJavaScriptEvaluation",
  "disableJavaScriptEvaluation",
  "suppressCodeGenerationFromStringsWarning",
  "disableJavaScriptFileLoading",
  "disableCSSFileLoading",
  "disableIframePageLoading",
  "disableComputedStyleRendering",
  "disableErrorCapturing",
  "enableFileSystemHttpRequests",
  "handleDisabledFileLoadingAsSuccess",
  "errorCapture",
  "navigator",
  "device",
  "timer",
  "console",
  "fetch",
  "driver",
  "frame",
  "module",
  "navigation",
  "debug",
  "viewport",
  "canvasAdapter",
];

function flatKeys(settings) {
  if (settings === null || typeof settings !== "object") return [];
  return Object.keys(settings);
}

/**
 * Classify a happy-dom `{ settings }`-shaped window options object against the
 * facade capabilities. Pure — never constructs a window, never mutates input.
 *
 * @param {object} [options] - happy-dom-style `IWindowOptions`.
 * @param {{ warn?: boolean }} [opts] - when `warn` is true, ignored/unknown
 *   settings are also logged as warnings (the "记录警告" half of the contract).
 * @returns {{ windowOptions: object, mapped: string[], ignored: string[], warnings: string[] }}
 */
export function adaptWindowSettings(options = {}, { warn = false } = {}) {
  const windowOptions = options ?? {};
  const settings = windowOptions.settings ?? {};
  const mapped = [];
  const ignored = [];
  const warnings = [];

  for (const key of MAPPED_WINDOW_OPTIONS) {
    if (key in windowOptions) mapped.push(key);
  }

  for (const key of flatKeys(settings)) {
    const known = KNOWN_WINDOW_SETTINGS.includes(key);
    ignored.push(key);
    const label = known ? `unmappable window setting` : `unknown window setting`;
    warnings.push(
      `[mad-dom hdunit shim] Window settings: ${label} \`settings.${key}\` has no facade ` +
        `toggle yet and is ignored (recorded, not silently dropped; facade waves T06+).`,
    );
  }

  if (warn && warnings.length > 0 && typeof console !== "undefined") {
    for (const warning of warnings) console.warn(warning);
  }

  return { windowOptions, mapped, ignored, warnings };
}
