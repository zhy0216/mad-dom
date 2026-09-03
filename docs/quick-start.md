# Quick start

A native DOM for Bun, written in Rust. Not happy. Just native.

## Install

```sh
bun add -d mad-dom
```

The platform binary for your OS and CPU is pulled in automatically as an
optional package — nothing to compile. See [Platforms](/platforms) for the
support matrix.

## One import is the whole migration

```diff
- import { Window } from "happy-dom";
+ import { Window } from "mad-dom";
```

Same API shape — `Window`, `Browser`, `GlobalWindow`, `window.document`, the
lot.

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

On the deterministic DOM workload the same suite runs **1.6× faster** under
`bun test` (128 ms vs 206 ms, median of 3 runs, macOS arm64, Bun 1.4.0).
Reproduce it yourself:

```sh
bun benchmark/run.mjs
```

See [Performance](/performance) for the full story, and
[Examples](/examples) for more of the API.

## Status

Alpha. The native DOM is real, verified, and worth trying in your test suite —
but don't run production on it yet.
