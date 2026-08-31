# compat：happy-dom 兼容基线

本目录存放 MAD DOM 与锁定版 happy-dom 的兼容资产。[ADR-0002](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 定义兼容契约；本目录的文件负责让契约机器可读、可重复验证。

## 基线清单

`happy-dom-baseline.json` 记录 [ADR-0002 第 1 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 锁定的基线三元组及生成元数据：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 本清单 schema 版本（当前 `1.0.0`） |
| `generator` | 生成器 `name` + `version`（mad-dom 自身版本） |
| `happyDom` | npm 版本 `npmVersion`、40 位上游 git commit `gitCommit`、tag `tag`、npm 发布时间 `npmPublishTime` |
| `bun` | 兼容判定用 Bun 版本 `version`（与仓库 [.bun-version](../.bun-version) 一致） |
| `generatedAt` | 清单生成时间（ISO 8601 UTC，`Z` 结尾） |
| `source` | 来源：npm registry 与锁定 tarball、上游仓库、分支策略（不读上游 main） |
| `adr` | 指向 ADR-0002 的相对路径 |

清单值必须与 ADR-0002 第 1 节精确一致：`validate-baseline.js` 内置的锁定基线常量即取自该表，任何一端漂移都会校验失败。schema 拒绝未知字段。

## 校验

```sh
bun compat/validate-baseline.js
```

零依赖、离线、可重复运行：只读取清单与仓库 `.bun-version`，不访问网络。校验覆盖：

- 必填字段存在且非空；未知字段拒绝；
- 版本号为 semver 格式；commit 为 40 位小写 hex；tag 必须等于 `v<npmVersion>`；
- 时间字段为可解析的 ISO 8601 UTC；
- `schemaVersion` 匹配；
- 交叉验证：`bun.version` 与 `.bun-version` 一致；`happyDom` 三元组与 ADR-0002 锁定值一致。

失败时逐字段输出错误并以 exit 1 退出；通过时输出简明 OK 摘要。也可显式传入清单路径（用于临时副本或篡改演练）：

```sh
bun compat/validate-baseline.js <path/to/manifest.json>
```

## 基线升级操作

按 [ADR-0002 第 9 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 执行，一次升级一个独立提交：

1. 更新 `happy-dom-baseline.json` 的 `happyDom`（npm 版本、commit、tag，必要时 `npmPublishTime`）与 `bun`（如需），并把 `generatedAt`、`generator.version` 刷新为本次生成值；
2. 同步更新 `validate-baseline.js` 顶部的 `PINNED` 锁定常量与 ADR-0002 第 1 节基线表（或由新 ADR 取代）；
3. 在同一独立提交中重新生成快照与类型/差分结果，恢复全部兼容门禁（快照、类型、黑盒差分、退化检查）；新增差异逐项归入 `pass` 或 `known-gap` 并写明原因，不得静默跳过；
4. 提交说明列出新旧版本、新旧 commit 与差异摘要；该提交只做基线升级，不混入功能改动。

生成与验证只针对锁定的 npm 版本与上游 tag（如 `v20.11.11` 对应 commit `64e2c774…`）；不读取上游 `main` 分支或未发布提交，上游 main 不作为发布门禁。

## 兼容清单（T11）

[T11](../todos/11-compatibility-ledger-and-provenance.md) 落地
[ADR-0002 第 7 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)
的稳定测试 ID 与兼容清单规则：每个兼容场景记录为 `pass` / `known-gap` /
`not-applicable`，永久的 `hc-*` ID 使历史结论可追溯。

### 文件

| 文件 | 职责 |
| --- | --- |
| `ledger.json` | 兼容清单本体：每个场景一条 `hc-*` 条目，含状态、原因、子系统与时间 |
| `upstream-map.json` | 上游移植用例的 provenance 映射（上游路径、commit、许可证、本地 ID） |
| `validate-ledger.js` | 退化门禁：schema 校验 + 交叉验证 + 活体差分运行比对（`ledger-lib.js` 为其纯函数库） |
| `ledger-report.js` | 离线汇总报告：按 subsystem/suite 的状态计数（不运行门禁） |

### 字段语义

| 字段 | 含义 |
| --- | --- |
| `id` | `hc-<suite>-<capability>-<case>`，全小写 kebab-case（ADR-0002 §7.1）；一经分配不可复用或重命名 |
| `suite` | `api`（快照）/ `types`（类型 fixture）/ `diff`（黑盒差分）/ `up`（上游移植用例）；必须与 id 前缀一致 |
| `status` | `pass` / `known-gap` / `not-applicable`；diff 套件只允许前两者（真实目标对场景必然产生可观察结果） |
| `subsystem` | `core`（Rust 内核）/ `bindings`（原生绑定面）/ `facade`（JS facade 与 Window-Document-Element 公开 API）/ `types`（TypeScript 类型面）/ `tooling`（测试基础设施自身） |
| `reason` / `recordedAt` | 仅 `known-gap` 与 `not-applicable` 必填（非空字符串 / ISO 8601 UTC）；`pass` 必须缺省，不得伪造解释 |
| `addedIn` | 首次记录该条目的 TODO id |
| 套件专属引用 | diff → `scenario`（runner 场景 id，一一对应）；types → `fixture` + `diagnostics`；up → `upstreamRef`；api 无专属字段（快照为全表面单次比较，粒度推迟） |

### 退化门禁规则

- 已有 `pass` 条目不得退化：`validate-ledger.js` 以 report 模式活体运行差分
  runner，`pass` 场景出现任何差异路径 → exit 1（CI 失败）；
- `known-gap` 场景转绿同样必须显式收口：差异归零 → 判为过期条目，要求在同一
  提交中翻转为 `pass`（删除 reason/recordedAt），保持清单诚实；
- 新增 `known-gap` 必须在 PR 中显式更新清单（ADR-0002 §7.5）；
- runner 的 mock 自测场景（`selftest-*`）不属于清单范围：它们是 runner 自身的
  基础设施自证，不是 happy-dom vs mad-dom 的兼容性问题，由
  `compat:differential:selftest` 直接以严格退出码把守。

### upstream-map 规则

- 上游许可证固定 `MIT`（happy-dom 上游许可）；来源映射锚定 ADR-0002 第 1 节的
  锁定 commit（`64e2c774…`，并与 `happy-dom-baseline.json` 交叉核对，防两份
  provenance 锚点分叉）；
- 只移植依赖公开 API 的用例；`localPath` 文件做机械扫描，出现
  `happy-dom/lib/`、`happy-dom/es/`、`happy-dom/dist/`、`happy-dom/src/` 或
  `PropertySymbol` 即校验失败（公开面只允许包入口导入）；
- `localId` 与 ledger 中 `suite: "up"` 的条目双向一致。

### 运行

```sh
npm run compat:ledger           # 门禁：schema + 交叉验证 + 活体退化检查
npm run compat:ledger:selftest  # 在 /tmp 临时副本上演练 6 个篡改场景
npm run compat:ledger:report    # 离线汇总报告（--json）
```

退出码：`0` 通过；`1` 门禁失败（pass 退化或条目过期）；`2` schema/配置/基础设施
错误。`validate-ledger.js --json` 在 stdout 输出机器可读门禁文档
（`mad-dom-compat-ledger-gate/1`）。

### CI

`.github/workflows/ci.yml` 在 "Run Bun tests" 之后运行
`Validate compatibility ledger (regression gate)` 步骤（`npm run compat:ledger`）：
模拟 pass 退化（如把 known-gap 条目改成 pass）会让该步骤以 exit 1 失败。

## hdunit 清单与门禁（ADR-0006）

[ADR-0006](../adr/0006-happy-dom-unit-suite-hdunit.md) 定义 `hdunit` 套件：原样
vendored 测试文件的文件级门禁（与 `up` 的手写移植相对）。每个 rewritten 测试
文件的终态（`enabled` / `skip` / `expected-fail`）由 `tests/happy-dom/triage/`
下的**分片文件**声明（每子系统一个 JSON，明细以分片为真相源）；`compat/ledger.json`
每个子系统一条 `hc-hdunit-<subsystem>-coverage` 汇总条目记录计数，enabled 文件
在 `compat/upstream-map.json` 登记 provenance。

### 文件

| 文件 | 职责 |
| --- | --- |
| `tests/happy-dom/triage/<subsystem>.json` | 分片 schema：`{schemaVersion, subsystem, entries: [{file, status, reason?, ledgerId?}]}`；`file` 相对 `tests/happy-dom/rewritten/` |
| `tests/happy-dom/validate-triage.mjs` | hdunit 门禁：schema 校验 + 文件存在性/唯一性 + 与 ledger/upstream-map 交叉核对 + 活体运行比对（含 `--self-test` 篡改演练） |
| `tests/happy-dom/report.mjs` | 离线汇总：每子系统 enabled/expected-fail/skip 计数与通过率，核对全量文件都有终态 |

### triage 状态机

- `enabled`：必须实跑通过（T03 预载下 `bun test` exit 0），且必须登记 ledger
  单文件条目与 upstream-map provenance；`skip` 与 `expected-fail` 必须带非空
  `reason`（按 T02 报告分类：`propertysymbol` / `unmapped-internal-import` /
  `pending-wave` 等），`expected-fail` 还必须声明期望失败面且波次收尾时收敛为
  `enabled` / `skip`。门禁不得静默跳过任何文件。

### 退化门禁规则

- `enabled` 文件实跑失败、`skip` 置 `enabled` 后不跑绿、`expected-fail` 意外转绿、
  triage 与活体运行/ledger/upstream-map 不一致 → `compat:hdunit:validate` exit 1；
- 分片 schema 非法、引用不存在的文件、未登记的 rewritten 文件 → exit 2；
- 初始状态全量 `skip`（0 enabled），门禁在空集上自洽可跑；波次（T06–T10）在各自
  分片内置 `enabled` 并同步 ledger 计数与 upstream-map。

### 运行

```sh
npm run compat:hdunit:validate           # 门禁：schema + 交叉核对 + 活体运行（含 --self-test 篡改演练）
npm run compat:hdunit:report             # 离线汇总：各子系统计数与通过率（--json）
bun tests/happy-dom/validate-triage.mjs --self-test   # 4 个篡改演练（临时副本）
```

`compat:ledger` 门禁同时扩展：`hdunit` 作为新 suite 纳入 schema 校验，upstream-map
的 `localId` 可与 hdunit（非 `-coverage`）条目双向一致；`compat:ledger:selftest`
新增 3 个 hdunit 场景（S7–S9）。

## 边界

T07 不生成公开 API 快照（`public-api/` 归 [T08](../todos/08-public-api-snapshot.md) 所有），不安装 happy-dom，也不提供快照生成器。
