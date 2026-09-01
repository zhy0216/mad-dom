// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/query-selector/QuerySelector.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `QuerySelector` class import is
// replaced by the public `element.querySelectorAll / querySelector / matches`
// entry points (the `QuerySelector.querySelectorAll(div, sel)` helper calls
// are equivalent to `div.querySelectorAll(sel)`).
//
// Dropped assertion surfaces (documented, not observable-equivalent on both
// sides):
//   - the internal `matches(element, sel, { ignoreErrors: true })` helper
//     option has no public surface — replaced by the public
//     `element.matches('1')` throw behavior;
//   - the XML-document blocks construct through `window.DOMParser`, whose port
//     belongs to the W10 xml-parser wave and is out of scope here;
//   - the `:has` / `:is` / `:where` / `:focus` / `:focus-visible` /
//     `:target` / `:checked` / `:disabled` / `:nth-child(An+B of S)` selector
//     surfaces are not implemented by the mad-dom selector engine yet (mad-dom
//     rejects them with `ERR_MAD_DOM_SYNTAX`), so their assertion blocks cannot
//     be diffed — they are dropped from this scenario and tracked as a mad-dom
//     implementation gap, not a portability gap;
//   - invalid-selector error *objects* differ between the sides (happy-dom
//     raises a formatted `DOMException`, mad-dom surfaces the selector
//     engine's native `ERR_MAD_DOM_SYNTAX`) — only the throw/no-throw behavior
//     is diffed for those assertions, and the error-formatting gap is noted;
//   - `[attr|="value"]` (dash-match) is dropped: happy-dom's implementation
//     also matches a value followed by whitespace (`^value[- ]`), deviating
//     from the CSS Selectors dash-match definition; mad-dom implements the
//     spec behavior, so the two sides intentionally diverge there;
//   - the unterminated `:not([type]` selector is dropped: happy-dom's parser
//     rejects it, mad-dom's parser accepts it (parser strictness gap).
//
// Everything else ports 1:1 through the public API.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "query-selector";
export const description = "real differential: querySelectorAll/querySelector/matches — combinators, attributes, pseudo-classes, escaping, coercion";
export const targets = "real";

const QUERY_SELECTOR_HTML = `
    <div class="class1 class2">
        <!-- Comment 1 !-->
        <h1>Heading1</h1>
        <!-- Comment 2 !-->
        <div class="class1 class2">
            <span class="class1 class2" attr1="value1" attr2="word1 word2" attr3="bracket[]bracket" type="hidden">Span1</span>
            <span class="class1 class2" attr1="value1">Span2</span>
            <span class="class1 class2" attr1="word1.word2">Span3</span>
        </div>
    </div>
    <div>
        <!-- Comment 1 !-->
        <h1>Heading1</h1>
        <!-- Comment 2 !-->
    </div>
`.trim();

const NTH_CHILD_HTML = `
    <div></div>
    <b class="n1"></b>
    <span class="n2"></span>
    <div class="n3"></div>
    <b class="n4"></b>
    <span class="n5"></span>
    <div class="n6"></div>
    <b class="n7"></b>
    <span class="n8"></span>
    <div class="n9"></div>
    <i class="n10"></i>
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

  function tagClass(element) {
    return `${element.tagName.toLowerCase()}.${element.className}`;
  }

  function tagNameList(nodeList) {
    return Array.from(nodeList).map((element) => element.tagName);
  }

  function baseContainer(html = QUERY_SELECTOR_HTML) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
  }

  try {
    // --- invalid selector errors (querySelectorAll) ---
    // The two sides' error *objects* differ (happy-dom raises a formatted
    // `DOMException`, mad-dom surfaces the selector engine's native
    // `ERR_MAD_DOM_SYNTAX` — a compat gap tracked separately), so only the
    // throw/no-throw behavior is diffed here.
    const container = document.createElement("div");
    for (const [name, selector] of Object.entries({
      number: 12,
      function: () => {},
      symbol: Symbol("test"),
      boolean: true,
    })) {
      let threw = false;
      try {
        container.querySelectorAll(selector);
      } catch (error) {
        threw = true;
      }
      api.record.value(`qsa-invalid-${name}`, threw);
    }

    // --- selector value coercion ---
    const coercion = document.createElement("div");
    coercion.innerHTML = `
        <span>
            <false></false>
            <true></true>
            <null></null>
            <undefined></undefined>
        </span>
    `;
    api.record.value("coerce-array", coercion.querySelectorAll(["false"]).length);
    api.record.value("coerce-array-identity", coercion.querySelectorAll(["false"])[0] === coercion.children[0].children[0]);
    api.record.value("coerce-false", coercion.querySelectorAll(false).length);
    api.record.value("coerce-true", coercion.querySelectorAll(true).length);
    api.record.value("coerce-null", coercion.querySelectorAll(null).length);
    api.record.value("coerce-undefined", coercion.querySelectorAll(undefined).length);

    // --- basic tag / class / id selectors ---
    const base = baseContainer();
    api.record.value("spans-length", base.querySelectorAll("span").length);
    api.record.value("spans-first-identity", base.querySelectorAll("span")[0] === base.children[0].children[1].children[0]);
    api.record.value("h1-length", base.querySelectorAll("h1").length);
    api.record.value("class1-length", base.querySelectorAll(".class1").length);
    api.record.value("class1-class2-length", base.querySelectorAll(".class1.class2").length);
    api.record.value("child-combinator-length", base.querySelectorAll(".class1 > .class1 > *").length);
    api.record.value("descendant-tags", tagNameList(base.querySelectorAll("div > div > span")));
    api.record.value("tag-class-length", base.querySelectorAll("span.class1").length);
    api.record.value("nodelist-item-identity", base.querySelectorAll("span").item(0) === base.children[0].children[1].children[0]);

    // --- attribute selectors ---
    api.record.value("attr-eq-length", base.querySelectorAll('[attr1="value1"]').length);
    const attrEmpty = baseContainer(QUERY_SELECTOR_HTML.replace(/attr1="value1"/gm, 'attr1=""'));
    api.record.value("attr-empty-eq-length", attrEmpty.querySelectorAll('[attr1=""]').length);
    api.record.value("attr-word-length", base.querySelectorAll('[attr1="word1.word2"]').length);
    api.record.value("attr-multi-length", base.querySelectorAll('[attr1="value1"][attr2="word1 word2"]').length);
    api.record.value("attr-tag-length", base.querySelectorAll('span[attr1="value1"]').length);
    api.record.value("attr-unquoted-length", base.querySelectorAll("span[attr1=value1]").length);
    api.record.value("attr-single-quote-length", base.querySelectorAll("span[attr1='value1']").length);
    api.record.value("attr-underscore-length", baseContainer(QUERY_SELECTOR_HTML.replace(/ attr1/gm, "_attr1")).querySelectorAll("span[_attr1]").length);
    api.record.value("attr-ldjson-length", baseContainer(QUERY_SELECTOR_HTML.replace(/ attr1="value1"/gm, ' attr1="application/ld+json"')).querySelectorAll('span[attr1="application/ld+json"]').length);
    api.record.value("attr-tilde-length", base.querySelectorAll('[class~="class2"]').length);
    api.record.value("attr-caret-length", base.querySelectorAll('[class^="cl"]').length);
    api.record.value("attr-caret-unquoted-length", base.querySelectorAll("[class^=cl]").length);
    api.record.value("attr-dollar-length", base.querySelectorAll('[class$="ss2"]').length);
    api.record.value("attr-star-length", base.querySelectorAll('[class*="s1 cl"]').length);
    api.record.value("attr-star-or-eq-length", base.querySelectorAll('[class*="s1 cl"], [attr1="value1"]').length);
    api.record.value("attr-star-or-tag-length", base.querySelectorAll('[class*="s1 cl"], h1').length);

    const tilde = baseContainer('<div data-controller="modal"><div data-controller="modal-auto-close"></div></div>');
    api.record.value("attr-tilde-parent-matches", tilde.children[0].matches('[data-controller~="modal"]'));
    api.record.value("attr-tilde-child-matches", tilde.children[0].children[0].matches('[data-controller~="modal"]'));
    api.record.value("attr-tilde-child-auto-matches", tilde.children[0].children[0].matches('[data-controller~="modal-auto"]'));
    api.record.value("attr-tilde-child-close-matches", tilde.children[0].children[0].matches('[data-controller~="modal-auto-close"]'));
    api.record.value("attr-tilde-query", tilde.querySelector('[data-controller~="modal"]') === tilde.children[0]);

    api.record.value("attr-submit-reset-length", (() => {
      const c = baseContainer(`<input type="submit"></input><input type="reset"></input>`);
      return c.querySelectorAll("input[type=submit], input[type=button], input[type=reset]").length;
    })());
    api.record.value("attr-expr-length", (() => {
      const c = baseContainer(`<div style='expression("123")'><span>Test</span></div>`);
      return c.querySelectorAll('[style*="expression("]').length;
    })());
    api.record.value("attr-css-hex-length", (() => {
      const c = baseContainer('<div class="toast" data-key="0abc"></div><div class="toast" data-key="other"></div>');
      return c.querySelectorAll('[data-key="\\30 abc"]').length;
    })());
    api.record.value("attr-css-escape-length", (() => {
      const c = baseContainer('<div data-key="a:b"></div>');
      return c.querySelectorAll('[data-key="a\\:b"]').length;
    })());
    api.record.value("attr-css-escape-2-length", (() => {
      const c = baseContainer('<div class="toast" data-key="0abc"></div>');
      return c.querySelectorAll(`.toast[data-key="${window.CSS.escape("0abc")}"]`).length;
    })());
    api.record.value("attr-apostrophe-value-length", (() => {
      const c = baseContainer(`<div data-value="it's a test">Content</div>`);
      return c.querySelectorAll('[data-value="it\'s a test"]').length;
    })());
    api.record.value("attr-dquote-value-length", (() => {
      const c = baseContainer(`<div data-value='say "hello"'>Content</div>`);
      return c.querySelectorAll('[data-value=\'say "hello"\']').length;
    })());
    api.record.value("attr-colon-escape-length", (() => {
      const c = baseContainer('<meta ab="a:b"></meta>');
      return c.querySelectorAll('[ab="a\\:b"]').length;
    })());
    api.record.value("attr-colon-unescaped-length", (() => {
      const c = baseContainer('<meta ab="a:b"></meta>');
      return c.querySelectorAll('[ab="a:b"]').length;
    })());
    api.record.value("attr-not-href-length", (() => {
      const c = baseContainer(`<a href="JAVASCRIPT:alert(1)">Link</a><a href="https://example.com">Link</a>`);
      return c.querySelectorAll('a[href]:not([href *= "javascript:" i])').length;
    })());
    api.record.value("attr-bracket-value-length", (() => {
      const c = baseContainer(QUERY_SELECTOR_HTML);
      return c.querySelectorAll('span[attr1="value1"][attr3="bracket[]bracket"]').length;
    })());

    // --- escaped class / id selectors ---
    const colonClasses = document.createElement("div");
    const colonEl1 = document.createElement("div");
    const colonEl2 = document.createElement("div");
    colonEl1.className = "before:after";
    colonEl2.className = "before:after";
    colonClasses.appendChild(colonEl1);
    colonClasses.appendChild(colonEl2);
    let colonInvalidThrew = false;
    try {
      colonClasses.querySelectorAll(".before:");
    } catch (error) {
      colonInvalidThrew = true;
    }
    api.record.value("colon-invalid", colonInvalidThrew);
    api.record.value("colon-escaped-length", colonClasses.querySelectorAll(".before\\:after").length);

    const hashClasses = document.createElement("div");
    const hashEl1 = document.createElement("div");
    const hashEl2 = document.createElement("div");
    hashEl1.className = "before#after";
    hashEl2.className = "before#after";
    hashClasses.appendChild(hashEl1);
    hashClasses.appendChild(hashEl2);
    api.record.value("hash-unescaped-length", hashClasses.querySelectorAll(".before#after").length);
    api.record.value("hash-escaped-length", hashClasses.querySelectorAll(".before\\#after").length);

    const ampClasses = document.createElement("div");
    const ampEl1 = document.createElement("div");
    const ampEl2 = document.createElement("div");
    ampEl1.className = "before&after";
    ampEl2.className = "before&after";
    ampClasses.appendChild(ampEl1);
    ampClasses.appendChild(ampEl2);
    let ampInvalidThrew = false;
    try {
      ampClasses.querySelectorAll(".before&after");
    } catch (error) {
      ampInvalidThrew = true;
    }
    api.record.value("amp-invalid", ampInvalidThrew);
    api.record.value("amp-escaped-length", ampClasses.querySelectorAll(".before\\&after").length);

    // --- unicode selectors ---
    const unicodeContainer = baseContainer(`
        <div class="class1 «unicode-class1» class2" id="«r1»">
            <h1>Heading1</h1>
            <div class="class1 «unicode-class1» class2">
                <span class="class1 «unicode-class1» class2">Span1</span>
                <span class="class1 «unicode-class1» class2">Span2</span>
                <span class="class1 «unicode-class1» class2">Span3</span>
            </div>
        </div>
    `);
    api.record.value("unicode-class-length", unicodeContainer.querySelectorAll(".«unicode-class1»").length);
    api.record.value("unicode-id-identity", unicodeContainer.querySelector("#«r1»") === unicodeContainer.children[0]);

    // --- document order ---
    const orderContainer = baseContainer(`
        <div class="a"><div class="aa"><div class="aaa"></div><div class="aab"></div></div></div>
        <div class="b"><div class="ba"><div class="baa"></div></div></div>
        <div class="c"><div class="ca"><div class="caa"></div></div></div>
    `);
    api.record.value(
      "document-order",
      Array.from(orderContainer.querySelectorAll('div[class^="c"], div[class^="b"], div[class^="a"]')).map((div) => div.className),
    );
    orderContainer.innerHTML = `
        <div>0</div>
        <button>1</button>
        <div>2</div>
        <div>3</div>
        <div>4</div>
        <div>5</div>
        <div>6</div>
        <div>7</div>
        <button>8</button>
        <button>9</button>
        <button>10</button>
        <button>11</button>
    `;
    api.record.value("button-order", Array.from(orderContainer.querySelectorAll("button")).map((b) => b.textContent));

    // --- child combinator with universal selector ---
    api.record.value("child-universal-length", (() => {
      const c = baseContainer(`
          <div id="root">
              <div>
                  <span></span>
                  <p><em>deep</em></p>
                  <a href="#"></a>
              </div>
          </div>
      `);
      return Array.from(c.querySelectorAll("#root > div > *")).map((el) => el.tagName);
    })());

    // --- pseudo-classes ---
    api.record.value("first-child-length", base.querySelectorAll(":first-child").length);
    api.record.value("span-first-child-length", base.querySelectorAll("span:first-child").length);
    api.record.value("last-child-length", base.querySelectorAll(":last-child").length);
    api.record.value("span-last-child-length", base.querySelectorAll("span:last-child").length);
    api.record.value("only-child-length", base.querySelectorAll(":only-child").length);
    api.record.value("first-of-type-length", base.querySelectorAll(":first-of-type").length);
    api.record.value("span-first-of-type-length", base.querySelectorAll("span:first-of-type").length);
    api.record.value("h1-first-last-of-type-length", base.querySelectorAll("h1:first-of-type:last-of-type").length);
    api.record.value("last-of-type-length", base.querySelectorAll(":last-of-type").length);

    const emptyForCache = baseContainer();
    api.record.value("last-of-type-initial", emptyForCache.querySelectorAll(":last-of-type").length);
    emptyForCache.innerHTML = "";
    api.record.value("last-of-type-clear", emptyForCache.querySelectorAll(":last-of-type").length);
    emptyForCache.innerHTML = QUERY_SELECTOR_HTML;
    api.record.value("last-of-type-rebuild", emptyForCache.querySelectorAll(":last-of-type").length);

    api.record.value("not-type-hidden-length", (() => {
      const c = baseContainer();
      const elements = c.querySelectorAll("span:not([type=hidden])");
      const first = elements.length;
      elements[0].setAttribute("type", "hidden");
      elements[1].setAttribute("type", "hidden");
      const second = c.querySelectorAll("span:not([type=hidden])").length;
      elements[0].setAttribute("type", "text");
      elements[1].setAttribute("type", "text");
      const third = c.querySelectorAll("span:not([type=hidden])").length;
      return [first, second, third];
    })());

    const notClosed = baseContainer(`<button></button><button type="submit"></button><button></button>`);
    api.record.value("not-closed-length", notClosed.querySelectorAll("button:not([type])").length);

    api.record.value("not-multi-length", (() => {
      const c = baseContainer(`<ul class="list">
          <li class="list-item"></li><li class="list-item"></li><li class="list-item"></li>
          <li class="other-item"></li><li></li>
      </ul>`);
      return c.querySelectorAll("ul > li:not(.list-item, .other-item)").length;
    })());

    const notFoo = baseContainer(`
        <div data-foo data-bar class="foo bar"></div>
        <div data-foo class="foo"></div>
        <div data-bar class="bar"></div>
    `);
    api.record.value("not-class-length", notFoo.querySelectorAll(".foo:not(.bar)").length);
    api.record.value("not-class-2-length", notFoo.querySelectorAll(".bar:not(.foo)").length);
    api.record.value("not-attr-length", notFoo.querySelectorAll("[data-foo]:not([data-bar])").length);
    api.record.value("not-tabindex-length", (() => {
      const c = baseContainer(`
          <div tabindex="-1"></div>
          <div tabindex="0"></div>
          <div tabindex="1"></div>
          <textarea tabindex="-1"></textarea>
      `);
      return c.querySelectorAll("[tabindex]:not(textarea)").length;
    })());
    api.record.value("not-input-list-length", (() => {
      const c = baseContainer(`<input type="checkbox"></input>`);
      const first = c.querySelectorAll("input:not([type]):not([list])").length;
      c.innerHTML = "<input></input>";
      const second = c.querySelectorAll("input:not([type]):not([list])").length;
      return [first, second];
    })());

    // --- subsequent sibling ---
    api.record.value("sibling-length", (() => {
      const c = baseContainer(`
          <div class="a">a1</div>
          <div class="b">b1</div>
          <div class="c">c1</div>
          <div class="a">a2</div>
          <div class="b">b2</div>
          <div class="a">a3</div>
      `);
      const siblings = c.querySelectorAll(".a ~ .a");
      const first = [siblings.length, siblings[0].textContent, siblings[1].textContent];
      siblings[0].className = "z";
      const second = c.querySelectorAll(".a ~ .a").length;
      c.innerHTML = `
          <div class="a">a1</div>
          <div class="b">b1</div>
          <div class="c">c1</div>
          <div class="a">a2</div>
          <div class="b">b2</div>
          <div class="a">a3</div>
      `;
      const third = c.querySelectorAll(".a ~ .a").length;
      return [first, second, third];
    })());

    api.record.value("adjacent-sibling", (() => {
      const c = baseContainer(`
          <div class="a">a1</div>
          <div class="b">b1</div>
          <div class="c">c1</div>
          <div class="a">a2</div>
          <div class="b">b2</div>
          <div class="a">a3</div>
      `);
      const firstDivB = c.querySelector(".a + .b");
      const allDivB = c.querySelectorAll(".a + .b");
      const firstDivC = c.querySelector(".a + .c");
      return [firstDivB === c.children[1], allDivB.length, allDivB[0].textContent, allDivB[1].textContent, firstDivC === null];
    })());

    // --- round-bracket attribute values ---
    api.record.value("void-links-length", (() => {
      const c = baseContainer(`
          <span>loremipsum</span>
          <a href="/123">normal link</a>
          <a href="javascript:void(0)">void</a>
      `);
      const voidLinks = c.querySelectorAll('a[href="javascript:void(0)"]');
      const normalLinks = c.querySelectorAll('a[href]:not([href="javascript:void(0)"])');
      return [voidLinks.length, normalLinks.length];
    })());

    // --- :scope / :root ---
    api.record.value("scope-length", (() => {
      const c = baseContainer(`<span>Span 1</span><span>Span 2</span><a>Link 1</a><a>Link 2</a>`);
      const scope = c.querySelectorAll(":scope").length;
      const spans = c.querySelectorAll(":scope > span");
      const links = c.querySelectorAll(":scope a");
      return [scope, spans.length, links.length, spans[0].textContent, links[1].textContent];
    })());
    api.record.value("root-length", document.querySelectorAll(":root").length);
    api.record.value("root-identity", document.querySelectorAll(":root")[0] === document.documentElement);

    // --- nth-child family (without the `of S` selector-list form) ---
    const nth = baseContainer(NTH_CHILD_HTML);
    const nthCases = {
      "n8": ":nth-child(n+8)",
      "2n": ":nth-child(2n)",
      "neg3": ":nth-child(-n + 3)",
      "2n1": "div :nth-child(2n+1)",
      "3n1": "div :nth-child(3n+1)",
      "3n3": "div :nth-child(3n+3)",
      "odd": ":nth-child(odd)",
      "even": ":nth-child(even)",
      "nth-of-type-2n": ":nth-of-type(2n)",
      "nth-of-type-odd": ":nth-of-type(odd)",
      "nth-last-2n": ":nth-last-child(2n)",
      "nth-last-of-type-2n": ":nth-last-of-type(2n)",
    };
    for (const [name, selector] of Object.entries(nthCases)) {
      api.record.value(`nth-${name}`, Array.from(nth.querySelectorAll(selector)).map(tagClass));
    }

    // --- invalid selector strings ---
    const invalidSelectors = { "num": "1", "bracket-open": "[1", "dot-num": ".1", "hash-num": "#1", "tag-dot": "a.", "tag-hash": "a#" };
    for (const [name, selector] of Object.entries(invalidSelectors)) {
      let threw = false;
      try {
        base.querySelectorAll(selector);
      } catch (error) {
        threw = true;
      }
      api.record.value(`invalid-sel-${name}`, threw);
    }

    // --- trailing / doubled comma ---
    for (const [name, selector] of Object.entries({ "trailing": ".test,.test-2,", "doubled": ".test.,,test-2" })) {
      let threw = false;
      try {
        base.querySelectorAll(selector);
      } catch (error) {
        threw = true;
      }
      api.record.value(`comma-${name}`, threw);
    }

    // --- :not with pseudo inside ---
    const notPseudo = document.createElement("div");
    const childA = document.createElement("div");
    const childB = document.createElement("div");
    notPseudo.appendChild(childA);
    notPseudo.appendChild(childB);
    api.record.value("not-nth-child-identity", notPseudo.querySelector(":not(:nth-child(1))") === childB);

    // --- selector trimming / newlines ---
    const trimContainer = baseContainer();
    api.record.value("trim-h1-identity", trimContainer.querySelector("\n \n\r\t\t\f h1 \n \n\r\t\t\f") === trimContainer.children[0].children[0]);
    api.record.value("trim-desc-identity", trimContainer.querySelector("\n \n\r\t\t\f div div        span \n \n\r\t\t\f") === trimContainer.children[0].children[1].children[0]);
    api.record.value("trim-newline-class", trimContainer.querySelector("div.class1\n.class2 span") === trimContainer.children[0].children[1].children[0]);

    // --- datalist id ---
    const datalist = document.createElement("div");
    const dl = document.createElement("datalist");
    const span = document.createElement("span");
    dl.id = "datalist_id";
    span.id = "span_id";
    datalist.appendChild(dl);
    datalist.appendChild(span);
    api.record.value("datalist-mismatch", datalist.querySelector("datalist#span_id") === null);
    api.record.value("datalist-match", datalist.querySelector("datalist#datalist_id") === dl);
    api.record.value("span-datalist-mismatch", datalist.querySelector("span#datalist_id") === null);
    api.record.value("span-match", datalist.querySelector("span#span_id") === span);

    // --- class name with line breaks ---
    const lineBreak = baseContainer(`<div class="class1
    class2"></div>`);
    api.record.value("class-linebreak", lineBreak.querySelector(".class1.class2") === lineBreak.children[0]);

    // --- grouped selectors order ---
    const grouped = baseContainer(`
        <div class><h1><span>Here is a heading</span></h1>
        <div class="a"><span>With a child span</span></div></div>
    `);
    api.record.value("grouped-h1", grouped.querySelector(".a,h1") === grouped.children[0].children[0]);
    const groupedBlock = baseContainer(`
        <div><blockquote><div class="a"><ul><li><span>Item 1</span></li><li><span>Item 2</span></li></ul></div></blockquote></div>
    `);
    api.record.value("grouped-blockquote", groupedBlock.querySelector(".a,BLOCKQUOTE") === groupedBlock.children[0].children[0]);

    // --- :scope / :root in matches() ---
    const scopeMatch = baseContainer(`<span>Span 1</span><span>Span 2</span><a>Link 1</a><a>Link 2</a>`);
    api.record.value("matches-scope", scopeMatch.matches(":scope"));
    api.record.value("matches-scope-child", scopeMatch.children[0].matches(":scope"));
    api.record.value("matches-root", document.documentElement.matches(":root"));
    const detached = document.createElement("div");
    api.record.value("matches-root-detached", detached.matches(":root"));

    // --- unicode + apostrophe selectors ---
    const unicode2 = baseContainer(`
        <label id="type d'activité-label">Type d'activité</label>
        <input aria-labelledby="type d'activité-label" />
    `);
    api.record.value("unicode-apostrophe", !!unicode2.querySelector('[id="type d\'activité-label"]'));
    const simpleId = baseContainer(`<div id="simple"></div>`);
    api.record.value("unicode-simple-id", !!simpleId.querySelector('[id="simple"]'));

    // --- matches() ---
    const matchDiv = baseContainer('<div class="foo"></div>');
    api.record.value("matches-true", matchDiv.children[0].matches(".foo"));
    api.record.value("matches-false", matchDiv.children[0].matches(".bar"));
    for (const [name, selector] of Object.entries({ "num": "1", "not": ":not", "is": ":is", "where": ":where", "div-not": "div:not" })) {
      let threw = false;
      try {
        matchDiv.children[0].matches(selector);
      } catch (error) {
        threw = true;
      }
      api.record.value(`matches-invalid-${name}`, threw);
    }
    api.record.value("matches-desc", (() => {
      const c = baseContainer();
      const element = c.children[0].children[1].children[0];
      return [element.matches("div.class1 .class2 span"), element.matches("div.class1 .class3 span")];
    })());
    api.record.value("matches-sibling", (() => {
      const c = baseContainer(`
          <div class="a">a1</div>
          <div class="b">b1</div>
          <div class="c">c1</div>
          <div class="a">a2</div>
          <div class="b">b2</div>
          <div class="a">a3</div>
      `);
      const sibling = c.querySelector(".a ~ .b");
      const first = [sibling.matches(".a ~ .b"), sibling.matches(".a ~ .z")];
      sibling.setAttribute("class", "z");
      const second = [sibling.matches(".a ~ .b"), sibling.matches(".a ~ .z")];
      return [first, second];
    })());

    // --- querySelector() single matches ---
    const qsDiv = document.createElement("div");
    const qsDiv2 = document.createElement("div");
    const qsSpan = document.createElement("span");
    qsDiv.appendChild(qsDiv2);
    qsDiv2.appendChild(qsSpan);
    api.record.value("qs-descendant", qsDiv.querySelector("span") === qsSpan);
    api.record.value("qs-wildcard", qsDiv.querySelector("*") === qsDiv2);
    api.record.value("qs-null", qsDiv.querySelector("b") === null);
    const idDiv = document.createElement("div");
    const idDiv2 = document.createElement("div");
    idDiv2.id = "id";
    idDiv.appendChild(idDiv2);
    api.record.value("qs-id", idDiv.querySelector("#id") === idDiv2);
    api.record.value("qs-id-escaped", (() => {
      const c = document.createElement("div");
      const inner = document.createElement("div");
      inner.id = ":id:";
      c.appendChild(inner);
      return c.querySelector("#\\:id\\:") === inner;
    })());
    api.record.value("qs-not-list", (() => {
      const c = document.createElement("div");
      const input = document.createElement("input");
      input.setAttribute("type", "text");
      c.appendChild(input);
      return c.querySelector('input:not([list])[type="search"]') === null;
    })());
    api.record.value("qs-custom-element", (() => {
      const c = document.createElement("div");
      const customElement1 = document.createElement("custom-element");
      const customElement2 = document.createElement("custom-element");
      const customElement3 = document.createElement("custom-element");
      customElement1.className = "class1";
      customElement2.className = "class2";
      customElement3.className = "class3";
      c.appendChild(customElement1);
      c.appendChild(customElement2);
      c.appendChild(customElement3);
      return c.querySelector("custom-element.class2") === customElement2;
    })());
    api.record.value("qs-attrs", (() => {
      const c = document.createElement("div");
      const c2 = document.createElement("div");
      const span2 = document.createElement("span");
      span2.setAttribute("attr1", "value1");
      c.appendChild(c2);
      c2.appendChild(span2);
      return [
        c.querySelector('span[attr1="value1"]') === span2,
        c.querySelector('[attr1="value1"]') === span2,
        c.querySelector("span[attr1]") === span2,
        c.querySelector("[attr1]") === span2,
      ];
    })());
    api.record.value("qs-unicode-class", (() => {
      const c = document.createElement("div");
      const element = document.createElement("span");
      element.className = "class-😀";
      c.appendChild(element);
      return c.querySelector(".class-😀") === element;
    })());
    api.record.value("qs-span-class", (() => {
      const c = baseContainer();
      return c.querySelector("div > div > span") === c.children[0].children[1].children[0];
    })());
    api.record.value("qs-first-matching", (() => {
      const c = baseContainer();
      return c.querySelector("div > div > .class1.class2") === c.children[0].children[1];
    })());
    api.record.value("qs-first-child-not", (() => {
      const c = document.createElement("div");
      const child1 = document.createElement("div");
      const child2 = document.createElement("div");
      c.appendChild(child1);
      c.appendChild(child2);
      return c.querySelector(":not(:nth-child(1))") === child2;
    })());
    api.record.value("qs-has-attrs", (() => {
      const c = baseContainer(QUERY_SELECTOR_HTML);
      return c.querySelector('div > div > span[attr1="value1"]') === c.children[0].children[1].children[0];
    })());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
