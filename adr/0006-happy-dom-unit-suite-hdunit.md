# ADR-0006：hdunit —— happy-dom 单测套件原样移植与文件级门禁

- 状态：已接受
- 日期：2026-08-31

## 背景

[ADR-0002](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 第 7 节建立了稳定测试 ID 与兼容清单规则，其中 `up` 套件承载"上游移植用例"（手写、只允许公开 API）。但 happy-dom 上游自带的约 298 个 `*.test.ts`（约 9.9 万行，vitest + TypeScript）体量大、内部耦合深，无法逐条手写移植；[本队列](../todos/README.md) 的总体策略把它**原样 vendor** 进仓库（T01），经机械重写（T02，`src/…` 内部路径改写为 shim 路径、vitest 改写为 `bun:test` + 适配层）、bun 适配层（T03）与 re-export shim（T04）后，以**文件级门禁**逐文件声明终态并持续守护。

`up` 与 `hdunit` 是互补的两个套件：`up` 是"精选场景手写移植"，`hdunit` 是"全量上游文件原样移植"。两者的门禁语义不同，不能共用同一套状态机与 schema。本 ADR 定义 `hdunit` 套件的契约：与 `up` 的区别、id 规则、suite 专属字段、triage 状态机、provenance 规则与退化语义，并扩展 [ADR-0002 第 7 节](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 的兼容清单 schema（`compat/ledger.json`、`compat/upstream-map.json` 及 [T05](../todos/05-hdunit-triage-ledger-gate.md) 的校验链）。它不实现任何 runner、生成器或测试启用（启用归 T06–T10 波次）。

## 决策

### 1. hdunit 套件定义

`hdunit` 是 **原样 vendored 文件级门禁**：

- 判定单位是"vendored 测试文件"（`tests/happy-dom/rewritten/**` 下 `fileKind = test-source`、`mode = rewritten` 的文件，清单以 [T02 产物](../tests/happy-dom/rewrite-report.json) 为准）；
- 允许的改动面：T02 机械重写（`src/…` → `tests/happy-dom/shim/src/…`、vitest → `bun:test` + [T03 适配层](../tests/happy-dom/adapter/)）、T04 shim 路径与 `mad-dom` 公开入口。**禁止手改断言**；断言与行为的保真由 T02 重写管线保证，任何 rewritten 文件的进一步改动都必须回到 T02 管线（或报告协调器）；
- 与 `up` 套件的区别：`up` 是手写移植场景（只允许公开 API，`upstreamRef` 映射）；`hdunit` 是原样文件（允许经重写/shims 的路径，禁止手写改动），一条 rewritten 文件不登记为 `up` 用例，也不进入 `tests/compat` 的手写场景集；
- 文件级状态由 **triage 分片** 声明（`tests/happy-dom/triage/<subsystem>.json`，每子系统一个 JSON），分片是每文件状态的**真相源**。

### 2. id 规则

id 格式 `hc-hdunit-<subsystem>-<case>`，全小写 kebab-case：

- `<subsystem>` 与波次划分一致（`nodes`、`event`、`dom`、`window`、`browser`、`css`、`fetch`、`svg`、`cookie` 等，见本队列 README 的 T06–T10），取 rewritten 路径首段（顶层 `index.test.ts` 归 `index`）；
- `<case>` 为文件的稳定短名（如 `attr`、`domrect`）或保留字 `coverage`；
- 示例：`hc-hdunit-nodes-coverage`、`hc-hdunit-dom-domrect`；
- id 一经分配不可复用或重命名（沿用 ADR-0002 第 7.2 节）；`-coverage` 后缀保留给子系统汇总条目（见第 5 节）。

### 3. suite 专属字段

`hdunit` 套件在兼容清单条目上增加字段：

- `vendorPath`：必填，posix 相对路径。对**子系统汇总条目**（`hc-hdunit-<subsystem>-coverage`）指向 triage 分片（`tests/happy-dom/triage/<subsystem>.json`）；对**单文件条目**（波次启用文件时创建）指向 rewritten 文件（`tests/happy-dom/rewritten/<file>`）；
- `enabled` / `expectedFail` / `skip`：可选的**非负整数**，仅汇总条目携带，记录对应分片的 enabled / expected-fail / skip 文件计数；单文件条目不得携带（每文件状态在 triage 分片里）；
- 状态：hdunit 条目一律为 `pass`（它记录的是"已声明、可复核"的书账状态；每文件的通过/失败证据在 triage 分片与活体运行里），因此不携带 `reason`/`recordedAt`；
- `subsystem` 统一为 `tooling`（hdunit 属测试基础设施面）；领域子系统体现在 id 的 `<subsystem>` 段与分片文件名。

### 4. triage 状态机

每个 vendored 测试文件必须收敛为恰好一种终态，且不得静默缺席：

- `enabled`：文件必须**实跑通过**（`bun test <file>` 在 T03 预载下 exit 0）；不得带 reason；
- `skip`：文件**不运行**，必须带非空 `reason`（按 T02 报告分类：`propertysymbol` / `unmapped-internal-import` / `pending-wave` 等，可复核、尽量引用具体模块路径）；reason 在 report 中可见；
- `expected-fail`：文件**允许失败**，但必须带非空 `reason` 声明**期望失败面**，且**不得长期滞留**——波次收尾时必须收敛为 `enabled` 或 `skip`；reason 在 report 中可见；
- 分片 schema：`{schemaVersion, subsystem, entries: [{file, status, reason?, ledgerId?}]}`；`file` 相对 `tests/happy-dom/rewritten/`；`ledgerId` 在文件为 `enabled` 时必须填写（指向单文件 ledger 条目）。

### 5. ledger 汇总条目

`compat/ledger.json` 中每个子系统恰好一条汇总条目 `hc-hdunit-<subsystem>-coverage`，记录该分片的 `enabled` / `expectedFail` / `skip` 计数，`vendorPath` 指向分片。**明细以 triage 分片为真相源**：门禁（[validate-triage.mjs](../tests/happy-dom/validate-triage.mjs)）从分片重算计数并与汇总条目比对，任何漂移即失败。波次启用文件时同步更新计数，并在同一提交新增单文件条目与 provenance。

### 6. provenance 规则

- 每个 `enabled` 文件必须同时登记 `compat/upstream-map.json`：`localId` = 该文件的单文件 ledger 条目 id（`hc-hdunit-<subsystem>-<case>`），`upstreamPath`@锁定的 `64e2c774…`、`license: MIT`、`localPath` = rewritten 文件路径；
- 汇总（`-coverage`）条目**不得**出现在 upstream-map 中（provenance 按文件登记，不按子系统）；
- 与 T01 的 [vendor-scan](../tests/happy-dom/vendor-scan.json) 交叉核对：`upstreamPath` 必须落在 vendored 文件清单内；`localPath` 必须通过禁入扫描（不得出现 `happy-dom/lib`、`happy-dom/es`、`happy-dom/dist`、`happy-dom/src`、裸 `propertysymbol` 等私有内部引用——enabled 文件只允许 shim 路径、适配层路径与 `mad-dom` 公开入口）；
- `skip` / `expected-fail` 文件不登记 provenance（它们不构成兼容通过证据）。

### 7. 退化语义

下列任一情况门禁失败（[compat:hdunit:validate](../tests/happy-dom/validate-triage.mjs) exit 1）：

- `enabled` 文件在活体运行中失败（不跑绿）；
- `skip` 文件被置为 `enabled` 后无法跑绿（含 ledger 计数未同步）；
- `expected-fail` 文件意外转绿（须翻转为 `enabled` 并补 provenance）或声明的失败面与实际不符；
- triage 状态与活体运行不一致、分片与 ledger 汇总计数不一致、upstream-map 与 ledger/分片不一致、文件未声明终态。

结构性错误（分片 schema 非法、引用不存在的文件、未登记的 rewritten 文件、ledger/upstream-map schema 非法）以 exit 2 判定（门禁无法评估）。

### 8. 命令与门禁接线

- `compat:hdunit:test`（T03）：`bun test` 全量跑 rewritten 套件（开发用）；
- `compat:hdunit:validate`（本 ADR）：triage 门禁——schema 校验 + 交叉核对 + 活体运行比对，含 `--self-test` 篡改演练；
- `compat:hdunit:report`（本 ADR）：离线汇总——每子系统 `enabled` / `expected-fail` / `skip` 计数与通过率，并核对全量文件都有终态；
- `compat:ledger` / `compat:ledger:selftest`（T11 + 本 ADR 扩展）：兼容清单门禁，hdunit 条目的 schema 校验与 upstream-map `localId` 双向一致性；
- hdunit 门禁在 T11（收尾）接入 `npm run validate` 链；在此之前波次以 `compat:hdunit:validate` 保持门禁绿。

## 非目标

- 不启用任何测试文件：初始状态全量 `skip`，启用归 T06–T10 波次；
- 不为内部模块（`internal-parser`、`internal-utility`、`PropertySymbol` 等）造行为 shim；`propertysymbol` 依赖按 T04 边界 `skip`；
- 不重写既有 `up` 套件语义、不修改 ADR-0002 正文（基线、api/types/diff/up 定义不变）；
- 不做断言级（`it()` 粒度）的失败面匹配——`expected-fail` 的失败面以 reason 声明，活体运行只校验"确实失败"；更细粒度解析推迟到后续波次有实际需要时。

## 影响

### 正面影响

- 每个 vendored 测试文件获得可声明、可验证、不可退化的终态，302 个文件的兼容结论可追溯；
- 门禁在空集上自洽：初始全 skip 也可跑、可验证、可报告，为波次提供稳定的声明接口；
- `ledger`/`upstream-map` 扩展对既有 43 条 pass 条目零破坏（hdunit 独立成 suite，`subsystem` 归 `tooling`）。

### 代价与风险

- 43 个分片文件 + 43 条汇总条目引入簿记面，波次必须同步更新三处（分片、ledger 计数、upstream-map），未同步即门禁失败；
- 活体运行依赖 T03 适配层与 shim 的解析行为；`enabled` 文件在无 node_modules/原生产物时无法实跑（波次环境必须构建）；
- `expected-fail` 的"期望失败面"目前以 reason 文本声明，缺少机器可比较的失败面编码，存在声明与实际漂移的风险，由波次收尾的收敛要求兜底。

## 后续决策

以下主题由对应 TODO 落地，不在本 ADR 内决定：

1. 各子系统波次的启用顺序与修复闭环（[T06](../todos/06-hdunit-nodes-wave.md)–[T10](../todos/10-hdunit-internal-coupled-triage.md)）；
2. hdunit 门禁接入 CI 与 `npm run validate` 链（[T11](../todos/11-hdunit-closeout.md)）；
3. 如需把 `expected-fail` 的失败面提升为机器可比的编码，须新开 ADR 或独立 TODO。

## 参考资料

内部：

- [ADR-0001：基础技术架构](./0001-basic-technical-architecture.md)（第 6 节兼容策略、第 7 节测试策略）
- [ADR-0002：happy-dom 兼容基线与差分协议](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md)（第 7 节 ID 与清单规则）
- [TODO 队列](../todos/README.md)（T01–T11 hdunit 移植）
- [T02 重写报告](../tests/happy-dom/rewrite-report.json)、[T01 扫描报告](../tests/happy-dom/vendor-scan.json)

外部：

- [happy-dom 官方仓库](https://github.com/capricorn86/happy-dom)
- [锁定的上游 commit 64e2c774](https://github.com/capricorn86/happy-dom/commit/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9)
- [happy-dom MIT License（锁定 commit）](https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE)
