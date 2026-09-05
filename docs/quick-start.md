# Quick start

A native DOM for Bun, written in Rust. Not happy. Just native.

## Install

```sh
bun add -d mad-dom
```

The platform binary for your OS and CPU is pulled in automatically as an
optional package — nothing to compile. See [Platforms](/platforms) for the
support matrix.

## Start with one import

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Use familiar APIs — `Window`, `Browser`, `GlobalWindow`, `window.document` —
and run your existing tests after switching. See the [compatibility
report](/compat-report) for the tested contract and remaining upstream gaps.

## A first window

```js
import { Window } from "mad-dom";

const window = new Window({ url: "https://localhost:8080" });
const document = window.document;

document.body.innerHTML = '<div class="container"></div>';

const container = document.querySelector(".container");
const button = document.createElement("button");
container.appendChild(button);

// "<div class="container"><button></button></div>"
console.log(document.body.innerHTML);

window.close();
```

## Run your tests

```sh
bun test
```

## Run the benchmarks

The source-build benchmark covers 16 core DOM phases and 13 test workflows,
including DOM Testing Library. To reproduce it, run from a **repository
checkout** with Bun `1.4.0` and Rust `1.93.1`:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1
```

These commands require the repository's benchmark files; they are not part
of the installed npm package. See [Performance](/performance) for the recorded
results, workload definitions and measurement limits, and
[Examples](/examples) for more of the API.

## Status

Alpha. The native DOM is real, verified, and worth trying in your test suite —
but don't run production on it yet.
