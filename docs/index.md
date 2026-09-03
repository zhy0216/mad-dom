---
layout: home

hero:
  name: MAD DOM
  text: Not happy. Just native.
  tagline: A native DOM for Bun, written in Rust. A drop-in replacement for happy-dom — one import is the whole migration, and your DOM tests get 1.6× faster.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/zhy0216/mad-dom

features:
  - title: Native arena
    details: The DOM lives in a Rust memory arena — a native HTML parser, native selector matching and serialization, reached from JavaScriptCore through a thin Node-API binding. Less GC churn, more DOM per millisecond.
  - title: One-import migration
    details: Swap `import { Window } from "happy-dom"` for `"mad-dom"` and nothing else changes. Same API shape — Window, Browser, GlobalWindow, window.document — running directly under `bun test`.
  - title: Verified compatibility
    details: The happy-dom API is tracked against a locked baseline and verified with a black-box differential suite — currently 100% pass on the compatibility contract.
---
