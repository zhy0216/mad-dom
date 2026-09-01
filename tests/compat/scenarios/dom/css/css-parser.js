// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSSParser.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `new CSSParser(sheet)` +
// `parseFromString()` is replaced by the public `<style>.textContent` →
// `sheet.cssRules` parse path (the same CSS text flows through the parser).
// The big fixture text is inlined from the upstream `data/CSSParserInput.ts`.
// Rule-type numbers are inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts. Only the internal
// `validateSelectorText` behaviour surfaces through the observable rule
// count (the trailing `;`-prefixed rule is dropped by both implementations).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-parser";
export const description = "real differential: CSS parsing through <style>.sheet.cssRules (nested at-rules, keyframes, @font-face)";
export const targets = "real";

const CSS_PARSER_INPUT = `
    :host {
        display: flex;
        overflow: hidden;
        width: 100%;
    }

    .container {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        --css-variable: 1px;
        background-image:
            url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
            url(test.jpg)
        ;
    }

    @media screen and (max-width: 36rem) {
        .container {
            height: 0.5rem;
            animation: keyframes2 2s linear infinite;
        }
    }

    @keyframes keyframes1 {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    @-webkit-keyframes keyframes2 {
        0% {
            transform: rotate(0deg);
        }

        100% {
            transform: rotate(360deg);
        }
    }

    @unknown-rule {
        .unknown-class {
            text-spacing: 1px;
        }
    }

    @container (min-width: 36rem) {
        .container {
            color: red;
        }
    }

    @container containerName (min-width: 36rem) {
        .container {
            color: red;
        }
    }

    @supports (display: flex) {
        .container {
            color: green;
        }
    }

    /*
    * Multi-line comment with leading star
    */
    :root {
        --my-var: 10px;
    }

    /* Single-line comment */
    .foo { color: red; }

    ;

	.invalidAsThereIsASemicolon {
		color: red;
	}

    .validAsThereIsNoSemicolon {
        color: pink;
    }
`.trim();

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

  function parse(cssText) {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.appendChild(style);
    return style.sheet.cssRules;
  }

  function ruleDetail(rule) {
    const detail = {
      type: rule.type,
      selectorText: rule.selectorText ?? null,
      conditionText: rule.conditionText ?? null,
      mediaText: rule.media ? rule.media.mediaText : null,
      name: rule.name ?? null,
      keyText: rule.keyText ?? null,
      start: rule.start ?? null,
      end: rule.end ?? null,
      cssText: rule.cssText ?? null,
      style: rule.style ? rule.style.cssText : null,
    };
    // Grouping rules and @keyframes own child rules; style/font-face/keyframe
    // rules expose no observable cssRules in the upstream assertions.
    if (rule.type === 4 || rule.type === 0 || rule.type === 12 || rule.type === 7) {
      detail.inner = rule.cssRules.map((child) => ({
        selectorText: child.selectorText ?? null,
        keyText: child.keyText ?? null,
        cssText: child.cssText ?? null,
        style: child.style ? child.style.cssText : null,
      }));
    }
    return detail;
  }

  try {
    // --- parseFromString() over the big fixture ---
    const rules = parse(CSS_PARSER_INPUT);
    api.record.value("rules-length", rules.length);
    api.record.value("rules", rules.map(ruleDetail));

    // --- @font-face ---
    const fontFaceRules = parse(`
        @font-face {
            font-family: "Ionicons";
            src: url("~react-native-vector-icons/Fonts/Ionicons.ttf");
        }
    `);
    api.record.value("font-face-length", fontFaceRules.length);
    api.record.value("font-face-cssText", fontFaceRules[0].cssText);
    api.record.value("font-face-fontFamily", fontFaceRules[0].style.fontFamily);
    api.record.value("font-face-src", fontFaceRules[0].style.src);

    // --- @media (forced-colors: active) ---
    const forcedColors = parse(`
        @media (forced-colors: active) {
            .foo { color: red; }
        }
    `);
    api.record.value("forced-colors-length", forcedColors.length);
    api.record.value("forced-colors-media-length", forcedColors[0].media.length);
    api.record.value("forced-colors-media-0", forcedColors[0].media[0]);
    api.record.value("forced-colors-media-mediaText", forcedColors[0].media.mediaText);
    api.record.value("forced-colors-inner-selector", forcedColors[0].cssRules[0].selectorText);
    api.record.value("forced-colors-inner-color", forcedColors[0].cssRules[0].style.color);
    api.record.value("forced-colors-cssText", forcedColors[0].cssText);

    // --- nested at-rule cssText ---
    const nestedCases = {
      "media-in-media":
        "@media (forced-colors: active) { @media screen and (max-width: 36rem) { .foo { height: 0.5rem; } } }",
      "media-in-container":
        "@container (min-width: 36rem) { @media screen and (max-width: 36rem) { .foo { height: 0.5rem; } } }",
      "media-in-supports":
        "@supports (display: flex) { @media screen and (max-width: 36rem) { .foo { height: 0.5rem; } } }",
      "media-in-keyframes":
        "@keyframes keyframes1 { @media screen and (max-width: 36rem) { .foo { height: 0.5rem; } } }",
      "container-in-container":
        "@container containerName (min-width: 36rem) { @container containerName (min-width: 36rem) { .foo { height: 0.5rem; } } }",
      "container-in-supports":
        "@supports (display: flex) { @container (min-width: 36rem) { .foo { height: 0.5rem; } } }",
      "container-in-media":
        "@media screen and (max-width: 36rem) { @container (min-width: 36rem) { .foo { height: 0.5rem; } } }",
      "container-in-keyframes":
        "@keyframes keyframes1 { @container (min-width: 36rem) { .foo { height: 0.5rem; } } }",
      "supports-in-supports":
        "@supports (display: flex) { @supports (display: grid) { .foo { height: 0.5rem; } } }",
      "supports-in-media":
        "@media screen and (max-width: 36rem) { @supports (display: grid) { .foo { height: 0.5rem; } } }",
      "supports-in-container":
        "@container (min-width: 36rem) { @supports (display: grid) { .foo { height: 0.5rem; } } }",
      "supports-in-keyframes":
        "@keyframes keyframes1 { @supports (display: grid) { .foo { height: 0.5rem; } } }",
      "keyframes-in-supports":
        "@supports (display: flex) { @keyframes keyframes1 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } }",
      "keyframes-in-media":
        "@media screen and (max-width: 36rem) { @keyframes keyframes1 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } }",
      "keyframes-in-container":
        "@container (min-width: 36rem) { @keyframes keyframes1 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } }",
      "keyframes-in-keyframes":
        "@keyframes keyframes1 { @keyframes keyframes2 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } }",
      "scope":
        `@scope {
                    .foo { color: red; }
                }`,
      "scope-from-to":
        `@scope (.start div) to (.end div) {
                    .foo { color: red; }
                }`,
      "scope-in-scope":
        `@scope {
                    @scope {
                        .foo { color: red; }
                    }
                }`,
      "scope-in-container":
        `@container (min-width: 36rem) {
                    @scope {
                        .foo { color: red; }
                    }
                }`,
      "scope-in-media":
        `@media screen and (max-width: 36rem) {
                    @scope {
                        .foo { color: red; }
                    }
                }`,
      "scope-in-supports":
        `@supports (display: flex) {
                    @scope {
                        .foo { color: red; }
                    }
                }`,
      "scope-in-keyframes":
        `@keyframes keyframes1 {
                    @scope {
                        .foo { color: red; }
                    }
                }`,
    };

    for (const [name, cssText] of Object.entries(nestedCases)) {
      const nested = parse(cssText);
      api.record.value(`nested-${name}-length`, nested.length);
      api.record.value(`nested-${name}-cssText`, nested[0].cssText);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
