// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/match-media/MediaQueryList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `MediaQueryList` class import is
// replaced by the public `window.matchMedia()` entry point, which returns the
// same `MediaQueryList` object shape (`media` / `matches`).
//
// Dropped assertion surfaces (documented, not observable-equivalent on both
// sides):
//   - the `addEventListener` / `removeEventListener` change-event blocks
//     drive the internal `happyDOM.setInnerWidth()` / `setInnerHeight()`
//     debug API, which the mad-dom `happyDOM` surface does not implement —
//     the resize path is host/debug-API dependent and is not diffed;
//   - the device-settings blocks that construct `MediaQueryList` with the
//     internal `settings.device` options are kept via the public
//     `new Window({ settings: { device: ... } })` surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "match-media-media-query-list";
export const description =
  "real differential: matchMedia — media string normalization + matches evaluation for width/height/orientation/device/aspect-ratio/range/rem/em/vw/vh queries";
export const targets = "real";

function record(api, prefix, mql) {
  api.record.value(`${prefix}.media`, mql.media);
  api.record.value(`${prefix}.matches`, mql.matches);
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ width: 1024, height: 768 });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    // get media() — normalization of the media query string.
    const mediaCases = [
      ["media-1", "(min-width: 1023px)"],
      ["media-2", "PRINT and (MAX-width: 1024px)"],
      ["media-3", "NOT all AND (prefers-COLOR-scheme)"],
      ["media-4", "NOT all AND (prefers-REDUCED-motion)"],
      ["media-5", "all and (hover: none"],
      ["media-6", "all and (400px <= height <= 2000px) and (400px <= width <= 2000px)"],
      ["media-7", "all and (400px <= height <= 2000px) and (400px <= width <= 2000px) and (min-width: 400px)"],
      ["media-8", "prefers-color-scheme"],
      ["media-9", "(prefers-color-scheme"],
      ["media-10", "(prefers-color-scheme)"],
      ["media-11", "prefers-reduced-motion"],
      ["media-12", "(prefers-reduced-motion"],
      ["media-13", "(prefers-reduced-motion)"],
      ["media-14", "(forced-colors:      active)"]
    ];
    for (const [key, q] of mediaCases) {
      record(api, key, window.matchMedia(q));
    }

    // matches() — media type names.
    record(api, "type-all", window.matchMedia("all and (min-width: 1024px)"));
    record(api, "type-print", window.matchMedia("print"));
    record(api, "type-print-min", window.matchMedia("print and (min-width: 1024px)"));
    record(api, "type-screen", window.matchMedia("screen"));
    record(api, "type-screen-min", window.matchMedia("screen and (min-width: 1024px)"));

    // matches() — keywords.
    record(api, "kw-not-all", window.matchMedia("not all"));
    record(api, "kw-not-print", window.matchMedia("not print"));
    record(api, "kw-not-min-1", window.matchMedia("not (min-width: 1025px)"));
    record(api, "kw-not-min-2", window.matchMedia("not (min-width: 1024px)"));
    record(api, "kw-only-all", window.matchMedia("only all"));
    record(api, "kw-only-print", window.matchMedia("only print"));
    record(api, "kw-only-screen", window.matchMedia("only screen and (min-width: 1024px)"));

    // matches() — min-width / max-width.
    record(api, "mw", window.matchMedia("(min-width)"));
    record(api, "mw-1025", window.matchMedia("(min-width: 1025px)"));
    record(api, "mw-1024", window.matchMedia("(min-width: 1024px)"));
    record(api, "mw-rem-1025", window.matchMedia(`(min-width: ${1025 / 16}rem)`));
    record(api, "mw-rem-1024", window.matchMedia(`(min-width: ${1024 / 16}rem)`));
    record(api, "mw-em-1025", window.matchMedia(`(min-width: ${1025 / 16}em)`));
    record(api, "mw-em-1024", window.matchMedia(`(min-width: ${1024 / 16}em)`));
    record(api, "mw-vw-101", window.matchMedia("(min-width: 101vw)"));
    record(api, "mw-vw-100", window.matchMedia("(min-width: 100vw)"));
    record(api, "mw-pct", window.matchMedia("(min-width: 0%)"));
    record(api, "maxw", window.matchMedia("(max-width)"));
    record(api, "maxw-1023", window.matchMedia("(max-width: 1023px)"));
    record(api, "maxw-1024", window.matchMedia("(max-width: 1024px)"));
    record(api, "maxw-rem-1023", window.matchMedia(`(max-width: ${1023 / 16}rem)`));
    record(api, "maxw-rem-1024", window.matchMedia(`(max-width: ${1024 / 16}rem)`));

    // matches() — min-height / max-height / height / width.
    record(api, "mh", window.matchMedia("(min-height)"));
    record(api, "mh-769", window.matchMedia("(min-height: 769px)"));
    record(api, "mh-768", window.matchMedia("(min-height: 768px)"));
    record(api, "mh-vh-101", window.matchMedia("(min-height: 101vh)"));
    record(api, "mh-vh-100", window.matchMedia("(min-height: 100vh)"));
    record(api, "mh-pct", window.matchMedia("(min-height: 0%)"));
    record(api, "mh-rem-769", window.matchMedia(`(min-height: ${769 / 16}rem)`));
    record(api, "mh-rem-768", window.matchMedia(`(min-height: ${768 / 16}rem)`));
    record(api, "maxh", window.matchMedia("(max-height)"));
    record(api, "maxh-767", window.matchMedia("(max-height: 767px)"));
    record(api, "maxh-768", window.matchMedia("(max-height: 768px)"));
    record(api, "maxh-rem-767", window.matchMedia(`(max-height: ${767 / 16}rem)`));
    record(api, "maxh-rem-768", window.matchMedia(`(max-height: ${768 / 16}rem)`));
    record(api, "w", window.matchMedia("(width)"));
    record(api, "w-1023", window.matchMedia("(width: 1023px)"));
    record(api, "w-1024", window.matchMedia("(width: 1024px)"));
    record(api, "h", window.matchMedia("(height)"));
    record(api, "h-767", window.matchMedia("(height: 767px)"));
    record(api, "h-768", window.matchMedia("(height: 768px)"));

    // matches() — orientation (landscape by default at 1024x768).
    record(api, "orient", window.matchMedia("(orientation)"));
    record(api, "orient-portrait", window.matchMedia("(orientation: portrait)"));
    record(api, "orient-landscape", window.matchMedia("(orientation: landscape)"));

    // matches() — prefers-color-scheme (default light).
    record(api, "pcs", window.matchMedia("(prefers-color-scheme)"));
    record(api, "pcs-dark", window.matchMedia("(prefers-color-scheme: dark)"));
    record(api, "pcs-light", window.matchMedia("(prefers-color-scheme: light)"));

    // matches() — forced-colors (default none).
    record(api, "fc", window.matchMedia("(forced-colors)"));
    record(api, "fc-active", window.matchMedia("(forced-colors: active)"));
    record(api, "fc-none", window.matchMedia("(forced-colors: none)"));

    // matches() — prefers-reduced-motion (default no-preference).
    record(api, "prm", window.matchMedia("(prefers-reduced-motion)"));
    record(api, "prm-reduce", window.matchMedia("(prefers-reduced-motion: reduce)"));
    record(api, "prm-nopref", window.matchMedia("(prefers-reduced-motion: no-preference)"));

    // matches() — hover / pointer / any-pointer / display-mode.
    record(api, "hover", window.matchMedia("(hover)"));
    record(api, "hover-invalid", window.matchMedia("(hover: invalid)"));
    record(api, "hover-none", window.matchMedia("(hover: none)"));
    record(api, "hover-hover", window.matchMedia("(hover: hover)"));
    record(api, "pointer", window.matchMedia("(pointer)"));
    record(api, "pointer-invalid", window.matchMedia("(pointer: invalid)"));
    record(api, "pointer-none", window.matchMedia("(pointer: none)"));
    record(api, "pointer-coarse", window.matchMedia("(pointer: coarse)"));
    record(api, "pointer-fine", window.matchMedia("(pointer: fine)"));
    record(api, "any-pointer", window.matchMedia("(any-pointer)"));
    record(api, "any-pointer-invalid", window.matchMedia("(any-pointer: invalid)"));
    record(api, "any-pointer-none", window.matchMedia("(any-pointer: none)"));
    record(api, "any-pointer-coarse", window.matchMedia("(any-pointer: coarse)"));
    record(api, "any-pointer-fine", window.matchMedia("(any-pointer: fine)"));
    record(api, "display-mode", window.matchMedia("(display-mode)"));
    record(api, "display-mode-invalid", window.matchMedia("(display-mode: invalid)"));
    record(api, "display-mode-browser", window.matchMedia("(display-mode: browser)"));

    // matches() — aspect-ratio (1024x768).
    record(api, "min-ar", window.matchMedia("(min-aspect-ratio)"));
    record(api, "min-ar-1024-770", window.matchMedia("(min-aspect-ratio: 1024/770)"));
    record(api, "min-ar-1024-760", window.matchMedia("(min-aspect-ratio: 1024/760)"));
    record(api, "max-ar", window.matchMedia("(max-aspect-ratio)"));
    record(api, "max-ar-1024-760", window.matchMedia("(max-aspect-ratio: 1024/760)"));
    record(api, "max-ar-1024-770", window.matchMedia("(max-aspect-ratio: 1024/770)"));
    record(api, "ar", window.matchMedia("(aspect-ratio)"));
    record(api, "ar-1024-768", window.matchMedia("(aspect-ratio: 1024/768)"));
    record(api, "ar-1024-769", window.matchMedia("(aspect-ratio: 1024/769)"));
    record(api, "ar-1024-767", window.matchMedia("(aspect-ratio: 1024/767)"));

    // matches() — range syntax.
    record(api, "r-400-w", window.matchMedia("(400px <= width)"));
    record(api, "r-400l-w", window.matchMedia("(400px < width)"));
    record(api, "r-2000l-w", window.matchMedia("(2000px < width)"));
    record(api, "r-400-2000-w", window.matchMedia("(400px <= width <= 2000px)"));
    record(api, "r-400-1023-w", window.matchMedia("(400px <= width <= 1023px)"));
    record(api, "r-400-1024-w", window.matchMedia("(400px <= width <= 1024px)"));
    record(api, "r-2000ge-w", window.matchMedia("(2000px >= width)"));
    record(api, "r-2000g-w", window.matchMedia("(2000px > width)"));
    record(api, "r-700g-w", window.matchMedia("(700px > width)"));
    record(api, "r-rem-1024-w", window.matchMedia(`(${1024 / 16}rem <= width)`));
    record(api, "r-em-1024-w", window.matchMedia(`(${1024 / 16}em <= width)`));
    record(api, "r-rem-1024l-w", window.matchMedia(`(${1024 / 16}rem < width)`));
    record(api, "r-em-1024l-w", window.matchMedia(`(${1024 / 16}em < width)`));
    record(api, "r-400-h", window.matchMedia("(400px <= height)"));
    record(api, "r-400l-h", window.matchMedia("(400px < height)"));
    record(api, "r-2000l-h", window.matchMedia("(2000px < height)"));
    record(api, "r-400-2000-h", window.matchMedia("(400px <= height <= 2000px)"));
    record(api, "r-400-767-h", window.matchMedia("(400px <= height <= 767px)"));
    record(api, "r-400-768-h", window.matchMedia("(400px <= height <= 768px)"));
    record(api, "r-2000ge-h", window.matchMedia("(2000px >= height)"));
    record(api, "r-2000g-h", window.matchMedia("(2000px > height)"));
    record(api, "r-700g-h", window.matchMedia("(700px > height)"));
    record(api, "r-rem-768-h", window.matchMedia(`(${768 / 16}rem <= height)`));
    record(api, "r-em-768-h", window.matchMedia(`(${768 / 16}em <= height)`));
    record(api, "r-rem-768l-h", window.matchMedia(`(${768 / 16}rem < height)`));
    record(api, "r-em-768l-h", window.matchMedia(`(${768 / 16}em < height)`));
    record(api, "r-both", window.matchMedia("(400px <= height <= 2000px) and (400px <= width <= 2000px)"));

    // matches() — multiple rules.
    record(api, "multi-1", window.matchMedia("(min-width: 1024px) and (max-width: 2000px)"));
    record(api, "multi-2", window.matchMedia("(min-width: 768px) and (max-width: 1023px)"));
    record(api, "multi-3", window.matchMedia("screen and (min-width: 1024px) and (max-width: 2000px)"));

    // device settings: print media type.
    {
      const printWindow = new entry.Window({
        width: 1024,
        height: 768,
        settings: { device: { mediaType: "print" } }
      });
      record(api, "print-device-print", printWindow.matchMedia("print"));
      record(api, "print-device-print-min", printWindow.matchMedia("print and (min-width: 1024px)"));
    }

    // device settings: prefers-color-scheme dark.
    {
      const darkWindow = new entry.Window({
        width: 1024,
        height: 768,
        settings: { device: { prefersColorScheme: "dark" } }
      });
      record(api, "pcs-dark-device-dark", darkWindow.matchMedia("(prefers-color-scheme: dark)"));
      record(api, "pcs-dark-device-light", darkWindow.matchMedia("(prefers-color-scheme: light)"));
    }

    // device settings: forced-colors active.
    {
      const fcWindow = new entry.Window({ settings: { device: { forcedColors: "active" } } });
      record(api, "fc-device", fcWindow.matchMedia("(forced-colors)"));
      record(api, "fc-device-active", fcWindow.matchMedia("(forced-colors: active)"));
      record(api, "fc-device-none", fcWindow.matchMedia("(forced-colors: none)"));
    }

    // device settings: prefers-reduced-motion reduce.
    {
      const prmWindow = new entry.Window({
        width: 1024,
        height: 768,
        settings: { device: { prefersReducedMotion: "reduce" } }
      });
      record(api, "prm-device", prmWindow.matchMedia("(prefers-reduced-motion)"));
      record(api, "prm-device-reduce", prmWindow.matchMedia("(prefers-reduced-motion: reduce)"));
      record(api, "prm-device-nopref", prmWindow.matchMedia("(prefers-reduced-motion: no-preference)"));
    }

    // root font-size affects rem/em evaluation (default 16px).
    {
      window.document.documentElement.style.fontSize = "10px";
      record(api, "fontsize-mw-rem-1025", window.matchMedia(`(min-width: ${1025 / 10}rem)`));
      record(api, "fontsize-mw-rem-1024", window.matchMedia(`(min-width: ${1024 / 10}rem)`));
      record(api, "fontsize-mw-em-1025", window.matchMedia(`(min-width: ${1025 / 10}em)`));
      record(api, "fontsize-mw-em-1024", window.matchMedia(`(min-width: ${1024 / 10}em)`));
      record(api, "fontsize-maxw-rem-1023", window.matchMedia(`(max-width: ${1023 / 10}rem)`));
      record(api, "fontsize-maxw-rem-1024", window.matchMedia(`(max-width: ${1024 / 10}rem)`));
    }

    // disableComputedStyleRendering falls back to 16px root font.
    {
      const noCssWindow = new entry.Window({
        width: 1024,
        height: 768,
        settings: { disableComputedStyleRendering: true }
      });
      record(api, "nocs-maxw-rem-1023", noCssWindow.matchMedia(`(max-width: ${1023 / 16}rem)`));
      record(api, "nocs-maxw-rem-1024", noCssWindow.matchMedia(`(max-width: ${1024 / 16}rem)`));
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
