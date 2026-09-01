# 06 hdunit 波次：nodes 子系统

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T06`
- 依赖：T05
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

启用 `rewritten/nodes/**`（约 165 个文件，其中约 60 个全部运行时 import 可映射）的 vendored 测试，逐文件跑绿或诚实 triage：修复 facade/core 差异使测试通过，或登记 known-gap/expected-fail（附 reason）。这是 hdunit 的第一个波次，重点验证「跑 → 修 → 登记」闭环，并把 nodes 变成最大的一块兼容证据。

## 条目

- [ ] **T06 — nodes 子系统波次**
  - 实现：
    - 读取 `tests/happy-dom/triage/nodes.json` 与 T02 report，按「clean 文件优先」（全部 import 可映射的约 60 个）排定启用顺序；
    - 逐文件：置 `enabled` → `bun test <file>` → 分类处理：
      - 通过：triage 保持 enabled，ledger `hc-hdunit-nodes-coverage` 计数更新，upstream-map 登记该文件 provenance；
      - 失败：优先修复根因（允许修改 `js/facade/**`、`crates/mad-dom-core/**`、binding 面，修复必须带 `tests/bun` 或 Rust 单元测试佐证）；短期无法修复或修复成本失控 → triage 置 `expected-fail` 或 `skip` + reason（引用 ledger `hc-hdunit-nodes-*` 条目），并在该文件 ledger 条目注明 gap 子系统（core/bindings/facade）；
    - 单文件卡壳不阻塞整体：先扫完全部 clean 文件，再处理内部耦合文件（能跑的先跑）；
    - 维护 `tests/happy-dom/triage/nodes.json` 与 `compat/ledger.json` 的 nodes 汇总条目；每次状态变化后跑 `compat:hdunit:validate` 保持门禁绿。
  - 验收：
    - nodes 分片门禁绿：enabled 文件全部实跑通过，expected-fail/skip 全部带 reason 且与实测一致；
    - 60 个 clean 文件中至少 40 个终态为 enabled（其余为 expected-fail/skip + reason）——低于此数说明修复闭环有问题，须向协调器报告原因；
    - 每处 facade/core 修复有对应测试佐证；不得改 vendor/rewritten 断言本身（只允许改 triage 状态）；
    - `npm run validate`（含全量 `npm run test`、`cargo test`、`compat:ledger`）全绿；
    - report 显示 nodes 通过率与各状态计数。
  - 阻塞/回退：
    - 若发现 T01–T05 基建缺陷（shim 缺失、重写错误、适配层 bug），记录具体证据并报告协调器，不得在本任务里擅自改其他 TODO 的产出规则；可在协调器授权下小修 shim/adapter 的明确 bug。

## 预期改动

- `tests/happy-dom/triage/nodes.json`
- `compat/ledger.json`（nodes 汇总与 `hc-hdunit-nodes-*` 条目）、`compat/upstream-map.json`
- `js/facade/**`、`crates/mad-dom-core/**`、binding 面及配套测试（`tests/bun/**`、Rust 单测）
- `tests/happy-dom/shim/**`（仅限明确 bug 修复，经协调器授权）

## 专属校验

- `bun test tests/happy-dom/rewritten/nodes`（分片全跑）
- `npm run compat:hdunit:validate`
- 相关 facade/core 修复的针对性测试

## 边界

- 不碰其他子系统目录与 triage 分片（归 T07–T10）。
- 不修改 rewrite/vendor 产物；发现重写错误 → 报告协调器（回改 T02 或开新 TODO），不手改 rewritten 文件。
- known-gap 必须诚实：不把「没跑通」伪装成「不适用」；`skip` 与 `expected-fail` 的 reason 必须可复核。
