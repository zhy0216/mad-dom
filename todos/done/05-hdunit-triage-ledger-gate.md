# 05 hdunit triage 清单、ledger/upstream-map 扩展与退化门禁

- 状态：待办
- 优先级：P0
- 里程碑：基建
- 条目 ID：`T05`
- 依赖：T02, T03, T04
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）；[ADR-0002 §7](../../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)

## 目标

在 harness 三件套（重写、适配、shim）齐备后，建立 hdunit 的清单与门禁体系：每个 vendored 测试文件的终态可声明、可验证、不可退化。以新 ADR 定义 `hdunit` 套件，扩展 compat ledger/upstream-map 的 schema 与校验，落地 triage 分片（按子系统）+ 门禁命令。初始状态全量 `skip`，门禁在空集上自洽，为波次提供声明接口。

## 条目

- [ ] **T05 — ADR、schema 扩展、triage 门禁**
  - 实现：
    - 新增 `adr/0006-happy-dom-unit-suite-hdunit.md`：定义 hdunit 套件——
      - 与既有 `up` 套件的区别：`up` 是手写移植场景（只允许公开 API），`hdunit` 是**原样 vendored 文件级门禁**（允许经 T02 重写与 T04 shim 的路径，但禁止手改断言）；
      - id 规则 `hc-hdunit-<subsystem>-<case>`；suite 专属字段 `vendorPath`（rewritten 文件相对路径）；
      - triage 状态机：`enabled`（必须 pass）/ `skip`（必须给 reason）/ `expected-fail`（必须给 reason 与期望失败面，且不得长期滞留——波次收尾时必须收敛为 enabled 或 skip）；
      - provenance 规则：每个 enabled 文件同时登记 `compat/upstream-map.json`（upstreamPath@64e2c774、MIT、localPath=rewritten 文件），与 vendor-scan 交叉核对；
      - 退化语义：enabled 文件失败、skip 文件被 enable 后失败、triage 与实际运行不一致 → 门禁失败。
    - `compat/ledger-lib.js` / `compat/validate-ledger.js` 扩展：`SUITES` 增加 `HDUNIT: 'hdunit'`，`SUITE_ENTRY_FIELDS.hdunit = ['vendorPath']`，id 校验与 hdunit 前缀规则一致；ledger 每个子系统一条汇总条目（`hc-hdunit-<subsystem>-coverage`，记录该分片 enabled/expected-fail/skip 计数），细节以 triage 分片为真相源；
    - `compat/upstream-map.json` schema 校验扩展：`localId` 可与 hdunit 条目双向一致（现有校验只认 `up` 套件）；`FORBIDDEN_LOCAL_IMPORTS` 机械扫描按 hdunit 文件的实际形态调整（rewritten 文件指向 shim 路径与 adapter 路径，不得出现 `happy-dom/lib`、裸 `propertysymbol` 等）；
    - `tests/happy-dom/triage/` 分片 schema（每子系统一个 JSON）：`{schemaVersion, subsystem, entries: [{file, status, reason?, ledgerId?}]}`；`tests/happy-dom/validate-triage.mjs`：schema 校验 + 文件存在性/唯一性 + 与 ledger/upstream-map 交叉核对 + **活体运行比对**（enabled 文件必须跑绿，skip 不跑，expected-fail 允许失败但要匹配声明的失败面）；
    - 运行/报告命令：`compat:hdunit:test`（已有，T03）、`compat:hdunit:validate`（门禁）、`compat:hdunit:report`（离线汇总：每子系统 enabled/expected-fail/skip 计数与通过率）；
    - 初始 triage：全部 rewritten 文件登记为 `skip`（reason 按 T02 report 分类：`unmapped-internal-import` / `propertysymbol` / `pending-wave` 等），0 enabled，门禁自洽可跑。
  - 验收：
    - `adr/0006-*.md` 通过评审并入仓（本 TODO 的验收即 ADR 落地）；
    - `compat:ledger:selftest` 全绿（含新增 hdunit 场景）；`compat:ledger` 门禁绿；
    - 篡改演练（临时副本）：把 skip 改为 enabled 但不跑绿 → 门禁 exit 1；enabled 文件回归失败 → exit 1；triage 引用不存在的文件 → schema 错误 exit 2；upstream-map 与 ledger id 不一致 → exit 1；全部按预期失败；
    - 初始全 skip 状态下 `compat:hdunit:validate` 通过，`compat:hdunit:report` 输出各子系统计数；
    - `npm run validate` 全绿（ledger 扩展不破坏既有 43 条 pass 条目与门禁）。

## 预期改动

- `adr/0006-happy-dom-unit-suite-hdunit.md`
- `compat/ledger-lib.js`、`compat/validate-ledger.js`、`compat/ledger.json`（新增 hdunit 汇总条目）、`compat/upstream-map.json`
- `tests/happy-dom/triage/**`、`tests/happy-dom/validate-triage.mjs`、`tests/happy-dom/report.mjs`
- `package.json`（`compat:hdunit:validate`、`compat:hdunit:report`）
- `compat/README.md`（hdunit 清单与门禁章节）

## 专属校验

- `bun compat/validate-ledger.js --self-test` 与 `bun compat/validate-ledger.js`
- `bun tests/happy-dom/validate-triage.mjs`（含篡改自测）
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`
- `npm run validate`（仓库级）

## 边界

- 本任务只搭体系与初始全 skip 清单，不启用任何测试文件（启用归 T06–T10）；ledger 汇总条目初始为 0/0/skip 全量计数。
- 不改 ADR-0002 正文（基线、api/types/diff/up 定义不变）；hdunit 是新 ADR 的事。
- 门禁不得「静默跳过」：skip 必须带 reason；expected-fail 必须声明失败面；两者都在 report 中可见。
- 不修改 T02/T03/T04 的产物规则；若发现规则缺陷，记录并报告协调器，由协调器决定回改对应 TODO 还是新开 TODO。
