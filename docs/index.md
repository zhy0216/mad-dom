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
  - title: One-import migration
    details: Swap `import { Window } from "happy-dom"` for `"mad-dom"` and nothing else changes. Same API shape — Window, Browser, GlobalWindow, window.document — running directly under `bun test`.
    link: /quick-start
    linkText: Read the quick start
  - title: Speed you can measure
    details: The same test suite, only the import swapped — your DOM tests get 1.6× faster (128 ms vs 206 ms, median of 3, macOS arm64, Bun 1.4.0).
    link: /performance
    linkText: See the numbers
  - title: Compatibility you can verify
    details: The happy-dom API is tracked against a locked baseline and verified with a black-box differential suite — currently 100% pass on the compatibility contract.
    link: /compat-report
    linkText: Read the report
---
