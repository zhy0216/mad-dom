---
layout: home

hero:
  name: MAD DOM
  text: Not happy. Just native.
  tagline: A native DOM for Bun, written in Rust, with a happy-dom-compatible API.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/zhy0216/mad-dom

features:
  - title: Start with one import
    details: Change the Window import from happy-dom to mad-dom and run your suite under bun test. Familiar APIs, with compatibility measured against a defined contract.
    link: /quick-start
    linkText: Read the quick start
  - title: Speed you can measure
    details: The 2026-09-05 source-build benchmark measured 2.83× for 16 core DOM phases and 1.57× for 13 test workflows on an M3 Max with Bun 1.4.0 (size 1×, 9 rounds). Full results include slower phases and raw samples.
    link: /performance
    linkText: See the numbers
  - title: Compatibility you can verify
    details: The happy-dom API is tracked against a locked baseline and verified with a black-box differential suite — currently 100% pass on the compatibility contract.
    link: /compat-report
    linkText: Read the report
---
