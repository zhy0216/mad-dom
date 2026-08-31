# 09 hdunit 波次：css / fetch

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T09`
- 依赖：T05
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

启用 `rewritten/` 下 css（约 20 个文件，含 rules/declaration/style-property-map 子目录）与 fetch（约 11 个文件）的 vendored 测试。css 只有 3/20 是 clean（多数依赖内部 CSSParser、属性值解析器等），fetch 3/11 clean（多数依赖 Fetch 内部、multipart parser 等），预期 enabled 比例偏低，重点在于如实 triage 并用已有 CSSOM/fetch 能力跑绿能跑的。

## 条目

- [ ] **T09 — css/fetch 波次**
  - 实现：
    - 与 T06 相同的闭环：置 enabled → 跑 → 通过保持；失败 → 修 facade/core（带测试佐证）或 expected-fail/skip + reason；
    - css 子系统：优先 3 个 clean 文件；依赖 `CSSParser`/`CSSStyleDeclarationValueParser` 等内部路径的文件无法 shim（T04 边界），归 skip + reason `internal-parser`；`CSSStyleSheet`、`CSSStyleDeclaration` 直接可映射的用例跑绿后，差异修复落在 `js/facade` 的 CSSOM 面；
    - fetch 子系统：优先 3 个 clean 文件（Headers/Response 面）；依赖 `Fetch`/`ResourceFetch`/`SyncFetch` 内部的归 skip + reason；
    - 维护 `tests/happy-dom/triage/{css,fetch}.json` 与 ledger 汇总条目；状态变化后跑 `compat:hdunit:validate`。
  - 验收：
    - css/fetch 分片门禁绿；enabled 全部实跑通过；
    - 两子系统合计至少 8 个文件终态为 enabled（clean 文件尽量全绿 + 部分可修文件）；
    - 每处 facade 修复有测试佐证；不改 rewritten 断言；
    - `npm run validate` 全绿；report 输出 css/fetch 计数。
  - 阻塞/回退：同 T06。

## 预期改动

- `tests/happy-dom/triage/{css,fetch}.json`
- `compat/ledger.json`、`compat/upstream-map.json`
- `js/facade/**`（CSSOM、fetch 面）及配套测试（`tests/bun/cssom.test.js`、`tests/bun/fetch.test.js` 等）

## 专属校验

- `bun test tests/happy-dom/rewritten/{css,fetch}`
- `npm run compat:hdunit:validate`

## 边界

- 不碰其他波次分片与目录。
- 不为 triage 通过而给内部 parser（CSSParser 等）造 shim：T04 已明确这类路径不 shim，归 skip；若后续确有价值，由协调器开新 TODO。
- known-gap 诚实记录；不手改 rewritten/vendor 文件。
