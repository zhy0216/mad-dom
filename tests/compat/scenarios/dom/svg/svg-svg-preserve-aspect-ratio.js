// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGPreserveAspectRatio.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGPreserveAspectRatio(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<svg>`
// `preserveAspectRatio` `baseVal` (a real SVGPreserveAspectRatio backed by
// the `preserveAspectRatio` attribute) plus the `window.SVGPreserveAspectRatio`
// static enum constants. The `SVGPreserveAspectRatioAlignEnum` /
// `SVGPreserveAspectRatioMeetOrSliceEnum` imports are replaced by the public
// statics (inline literal values).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-preserve-aspect-ratio";
export const description = "real differential: SVGPreserveAspectRatio align/meetOrSlice read/write + statics + read-only errors";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    api.record.value("static-meet-unknown", window.SVGPreserveAspectRatio.SVG_MEETORSLICE_UNKNOWN);
    api.record.value("static-meet-meet", window.SVGPreserveAspectRatio.SVG_MEETORSLICE_MEET);
    api.record.value("static-meet-slice", window.SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE);
    api.record.value("static-align-unknown", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_UNKNOWN);
    api.record.value("static-align-none", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_NONE);
    api.record.value("static-align-xminymin", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMINYMIN);
    api.record.value("static-align-xmidymin", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMIN);
    api.record.value("static-align-xmaxymin", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMIN);
    api.record.value("static-align-xminymid", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMINYMID);
    api.record.value("static-align-xmidymid", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMID);
    api.record.value("static-align-xmaxymid", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMID);
    api.record.value("static-align-xminymax", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMINYMAX);
    api.record.value("static-align-xmidymax", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMAX);
    api.record.value("static-align-xmaxymax", window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMAX);

    const element = document.createElementNS(SVG_NS, "svg");
    const aspectRatio = element.preserveAspectRatio.baseVal;
    api.record.value("type", aspectRatio instanceof window.SVGPreserveAspectRatio);
    api.record.value("align-default", aspectRatio.align);
    api.record.value("meetOrSlice-default", aspectRatio.meetOrSlice);
    element.setAttribute("preserveAspectRatio", "xMaxYMax slice");
    api.record.value("align-attribute", aspectRatio.align);
    api.record.value("meetOrSlice-attribute", aspectRatio.meetOrSlice);

    element.setAttribute("preserveAspectRatio", "xMaxYMax slice");
    aspectRatio.align = window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMID;
    api.record.value("set-align-attr", element.getAttribute("preserveAspectRatio"));
    api.record.value("set-align-readback", aspectRatio.align);
    element.setAttribute("preserveAspectRatio", "xMaxYMax slice");
    aspectRatio.meetOrSlice = window.SVGPreserveAspectRatio.SVG_MEETORSLICE_MEET;
    api.record.value("set-meet-attr", element.getAttribute("preserveAspectRatio"));
    api.record.value("set-meet-readback", aspectRatio.meetOrSlice);

    try {
      element.preserveAspectRatio.animVal.align = window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMAX;
      api.record.value("readonly-align", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      element.preserveAspectRatio.animVal.meetOrSlice = window.SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE;
      api.record.value("readonly-meet", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
