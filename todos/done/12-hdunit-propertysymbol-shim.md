# 12 hdunit PropertySymbol 兼容 shim 与构造函数适配

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T12`
- 依赖：T06, T07, T08, T09, T10
- 来源：协调器决策（T09 验收阈值未达成：css/fetch 大量文件因 `Cannot find module …/shim/src/PropertySymbol.js` 无法解析，只能诚实 skip；根因是 T01 vendor-scan 将 `PropertySymbol.js` 标为可映射，而 T04 边界明确不生成 PropertySymbol shim，形成契约缺口）

## 背景

T04 边界「不做 PropertySymbol shim」基于「私有 symbol 机制语义上不可移植」的判断。但实测暴露：大量 vendored 测试（T09 的 css 全部 20 个文件、fetch 约 7 个文件，以及 T06–T10 各子系统中被 triage 为 `propertysymbol` 的文件，合计约 105 个）以**值导入**方式使用 `PropertySymbol`：

- `import * as PropertySymbol from '…/src/PropertySymbol.js'`
- `new CSSStyleDeclaration(PropertySymbol.illegalConstructor, window, …)`（测试期望触发 "Illegal constructor" 等行为）

这些文件在 vendor-scan 中 `allRuntimeImportsMappable` 为真（PropertySymbol.js 被归为可映射），但 T04 未生成 shim，重写后运行时解析失败。T09 因此只能启用 fetch Headers/AbortController 2 个文件，未达「≥8 enabled」验收阈值（协调器已记录并向用户确认，用户决定新建本 TODO 补上契约缺口）。

本任务目标：在 shim 层补齐 `PropertySymbol` 兼容面 + 构造函数适配，使这些文件从「无法解析」变为「可运行」，再按 T06–T10 的闭环逐文件跑绿或诚实 triage。

## 条目

- [ ] **T12 — PropertySymbol 兼容 shim 与启用补扫**
  - 实现：
    - `tests/happy-dom/shim/src/PropertySymbol.ts`：按上游 `src/PropertySymbol.js` 的导出面生成**诚实值** shim——每个键导出为唯一 `Symbol`（附 provenance 头注释：上游路径 @ commit、MIT）。上游导出是行为契约的一部分，照抄键集是正确做法；不为任何键实现 DOM 行为。
    - 构造函数适配（集中在 shim 包装层，**不修改 facade 本体**）：为所有测试中以 `new X(PropertySymbol.<key>, …)` 形态构造的 facade 类（CSSStyleDeclaration、EventTarget、Element、Document、Window 等，以 rewrite-report 中 propertysymbol 依赖清单为准）在 shim 内提供包装构造器，使其能解释 PropertySymbol 参数并产生测试期望的可观察行为（主要是 `illegalConstructor` → 抛 `TypeError("Illegal constructor")`；其余键按上游语义最小对齐）。若某键语义超出包装层可诚实表达的范围，如实登记 expected-fail/skip，不伪造通过。
    - 依赖 `PropertySymbol.<key>` 作为内部状态访问的断言（读/写内部槽位）：如 facade 无法诚实表达，登记 expected-fail + reason（引用具体键与语义），不强行实现。
    - **启用补扫**：扫描 rewrite-report 中全部 `propertysymbol` 分类文件（含 T09 的 css 20 + fetch 7，及各子系统中被 T06–T10 triage 为 propertysymbol-skip 的文件），逐个：置 enabled → 跑 → 通过保持（triage enabled + ledger 计数 + upstream-map provenance）；失败优先修 facade/core（带 `tests/bun` 或 Rust 单测佐证）；无法修复的如实 expected-fail/skip + reason。不得手改 rewritten/vendor 文件。
    - 维护各子系统 triage 分片与 `compat/ledger.json`、`compat/upstream-map.json` 对应条目；每次状态变化后跑 `compat:hdunit:validate` 保持门禁绿。
  - 验收：
    - 全部子系统分片门禁绿；`compat:hdunit:report` 显示 enabled 计数显著上升（css/fetch 至少达到 T09 验收口径「≥8 enabled」且以实际可行为准）；
    - PropertySymbol shim 每个导出键可 `bun import`，键集与上游一致（机械核对）；
    - 所有曾因 `Cannot find module …PropertySymbol.js` 失败的 rewritten 文件均可解析（无 module-not-found），其余失败都有 triage 状态 + 可复核 reason；
    - 每处 facade/core 修复有测试佐证；不改 rewritten/vendor 断言；
    - `npm run validate` 全绿（含 `compat:ledger` 与全量 `bun test`）。
  - 阻塞/回退：
    - 若发现 T01 vendor-scan 的 mappable 判定或 T02 重写存在更深缺陷，记录证据并报告协调器，不擅自改 T01/T02 产出规则；
    - 本任务不改 T04 的「不得实现 DOM 行为」边界——PropertySymbol 键与构造函数适配属「名字/签名对齐」的兼容面，不是 DOM 行为实现；超出此边界的行为缺口一律 expected-fail/skip + reason。

## 预期改动

- `tests/happy-dom/shim/src/PropertySymbol.ts`、`tests/happy-dom/shim/src/**`（构造函数适配包装，仅限受 PropertySymbol 影响的类）
- `tests/happy-dom/shim/README.md`、`tests/happy-dom/shim/shim-manifest.json`（PropertySymbol 由排除项改为提供项）
- `scripts/generate-happy-dom-shim.mjs`（PropertySymbol 生成规则）
- `tests/happy-dom/triage/**`（properetysymbol 文件重新 triage）
- `compat/ledger.json`、`compat/upstream-map.json`
- `js/facade/**`、`crates/mad-dom-core/**`（仅限可修行为，带测试佐证）及配套测试（`tests/bun/**`）

## 专属校验

- `bun test tests/happy-dom/shim`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`
- 受影响 rewritten 分片的 `bun test … --preload tests/happy-dom/adapter/preload.ts --timeout 500`
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 不碰 T06–T10 已声明的分片之外的子系统目录（本次补扫覆盖 propertysymbol 文件即属各分片内部）。
- 不为 PropertySymbol 实现 DOM 行为：键是 symbol 值、构造适配是签名面；「通过 symbol 键读/写内部状态」的断言归 expected-fail。
- 本任务只补契约缺口并重新 triage；「改写为公开 API」路径仍只作为可选项登记到 report，不作为 hdunit 的 pass。
- 不改 rewritten/vendor 文件；不 push、不创建 PR。
