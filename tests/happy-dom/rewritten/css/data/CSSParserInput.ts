// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/data/CSSParserInput.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export default `

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
