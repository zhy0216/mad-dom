---
layout: home

hero:
  name: MAD DOM
  text: Less time in the DOM.
  tagline: Native speed. Familiar APIs. A Rust-powered DOM for Bun, measured at 2.83× faster core DOM work and 1.57× faster test workflows than happy-dom in our recorded benchmark.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: Explore the benchmarks
      link: /performance

features:
  - title: 2.83× faster core DOM work
    details: Native parsing, queries, mutations, and serialization. All 16 core phases contribute to the aggregate, with 15 showing lower medians in the recorded run.
    link: /performance
    linkText: See every phase
  - title: 1.57× faster test workflows
    details: Measured across 13 validated scenarios, including real DOM Testing Library queries, forms, templates, Shadow DOM, and snapshots. Start with a runnable Bun test.
    link: /testing
    linkText: Set up your tests
  - title: Familiar JavaScript APIs
    details: Window, Browser, selectors, events, and web components with a happy-dom-style API. Follow the migration guide and check the alpha compatibility boundaries.
    link: /migration
    linkText: Migrate from happy-dom
---

## Native speed, measured openly

The figures above come from the **2026-09-05 source-build run** against
happy-dom 20.11.11 on Apple M3 Max, 48 GiB RAM, macOS arm64, Bun 1.4.0, and
Rust 1.93.1. Size 1×, 2 warmup rounds, 9 measured rounds; aggregates are medians
of per-round sums. They measure DOM work, not complete application or test-runner
runtime. The [full report](/performance) includes slower scenarios, current
lifecycle limits, methodology, and raw samples.

## Start with a document

```sh
bun add -d mad-dom@next
```

```js
import { Window } from "mad-dom";

const window = new Window();
try {
  window.document.body.innerHTML = "<h1>Hello, native DOM</h1>";
  console.log(window.document.querySelector("h1").textContent);
} finally {
  window.destroy();
}
```

Build a fixture, query it, dispatch an event, and assert on the result. The
[quick start](/quick-start) walks through installation and your first Bun test.

## Explore the documentation

| You want to… | Read |
| --- | --- |
| Understand the architecture and performance advantages | [Why MAD DOM](/why-mad-dom) |
| Test components with Bun and DOM Testing Library | [Testing guide](/testing) |
| Parse, query, update, and serialize HTML | [DOM guide](/dom) |
| Work with pages and server-rendered documents | [Browser guide](/browser) |
| Check implemented behavior and remaining gaps | [Compatibility report](/compat-report) |
