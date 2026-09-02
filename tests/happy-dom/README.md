# hdunit：happy-dom 单测套件（vendored + 文件级门禁）

`tests/happy-dom/` 是 [ADR-0006](../adr/0006-happy-dom-unit-suite-hdunit.md) 定义的 `hdunit`
套件落地目录：把锁定版 happy-dom（v20.11.11 @ `64e2c774…`）的**整棵测试树原样 vendor**
进仓库，经机械重写与适配层后，以**文件级 triage 门禁**逐文件声明终态并持续守护。
它不手写移植（那是 `up` 套件的活），也不改任何断言——只做机械转换与声明。

## 目录结构

| 路径 | 职责 | 管线步骤 |
| --- | --- | --- |
| `vendor/` | 上游 `packages/happy-dom/test/` 逐字节原样拷贝 + `UPSTREAM.md` provenance | T01 输入 |
| `vendor-src-enums/` | 上游纯 enum/常量 `src/` 模块（带 provenance 头，供 shim 原样消费） | T01 输入 |
| `vendor-scan.json` / `vendor-scan.summary.md` | 模块清单：每个 vendored 文件的 import 分类（`src-runtime` / `src-type` / `local-helper` / `vitest-api` / `external`）与 `shimPath` 映射（T01/T02/T03/T04 的接口契约） | T01 产物 |
| `rewritten/` | 机械重写后的镜像：`src/…` 内部导入重指向 `shim/src/…`，vitest → `bun:test` + adapter。生成产物，不入库（`compat:hdunit:test` 缺失时自动重建） | T02 产物 |
| `rewrite-report.json` | 重写报告：文件清单、`fileKind`（`test-source` 等）、import 映射统计 | T02 产物 |
| `rewrite-selftest/` | 重写管线的自测（`rewrite-selftest.test.ts`） | T02 |
| `shim/src/` | re-export shim 层：每个可映射 `src/` 模块在 `shim/src/<srcPath>` 生成 re-export，指向 `mad-dom` 公开入口或本地 shim | T04 产物 |
| `shim/adapters/` + `shim/shim-manifest.json` + `shim/shim.test.ts` | shim 层自测与清单 | T04 |
| `adapter/` | bun 测试适配层：`index.ts`（`vi` 兼容 API）、`preload.ts`、`setup.ts`/`setup.test.ts`、`smoke.sample.ts`、`fixtures/`、`run-compat-hdunit-test.mjs` | T03 产物 |
| `triage/` | 每子系统一个分片 JSON，声明该子系统每个测试文件的终态 | T05 起，波次维护 |
| `validate-triage.mjs` | triage 门禁：schema 校验 + 文件存在性/唯一性 + 与 ledger/upstream-map 交叉核对 + 活体运行比对（含 `--self-test`） | 门禁 |
| `report.mjs` | 离线汇总报告：每子系统计数、通过率、与上次基线 delta | 报告 |
| `report-baseline.json` | 上次记录的分片汇总（`compat:hdunit:report:baseline` 写入），供 delta 比对 | 报告基线 |
| `adapter-gaps.json` | 机械重写无法覆盖的 vi 用法登记（如 `vi.mock` 调用点） | T02 产物 |

vendor 输入（`vendor/`、`vendor-src-enums/`）与所有产物（`rewritten/`、`shim/`、triage、
报告）都**禁止手改**：改动必须回到对应管线脚本重生成，或经 triage 状态机声明。

## 各命令

```sh
npm run compat:hdunit:vendor            # T01 重 vendor（需上游 checkout，见下）
npm run compat:hdunit:rewrite           # T02 重写 rewritten/ + rewrite-report.json
npm run compat:hdunit:shim              # T04 生成 shim 层
npm run compat:hdunit:validate          # 门禁：schema + 交叉核对 + 活体运行（exit 0/1/2）
npm run compat:hdunit:report            # 离线汇总（含各子系统通过率）
npm run compat:hdunit:report -- --json  # 机器可读 JSON（含 baseline delta）
npm run compat:hdunit:report:baseline   # 把当前汇总写为基线（波次收尾/有意变更后运行）
npm run compat:hdunit:test              # 开发用：bun test 全量跑 rewritten 套件（不设门禁）
```

直接跑脚本等价命令：

```sh
bun scripts/vendor-happy-dom-tests.mjs [--verify]   # --verify：临时目录重生成并逐字节比对
bun scripts/rewrite-happy-dom-tests.mjs [--verify]  # --verify：同上
bun scripts/generate-happy-dom-shim.mjs             # 生成 shim，缺必需 shim 时 exit 1
bun tests/happy-dom/validate-triage.mjs --self-test # 4 个篡改演练（临时副本）
```

### vendor 需要上游 checkout

`compat:hdunit:vendor`（及 CI 中的 `--verify`）需要一个带锁定 tag 的 happy-dom checkout，
按 `--upstream <dir>` → `HAPPY_DOM_UPSTREAM_DIR` → `~/workspace/happy-dom` 的顺序解析；
本地默认用 `~/workspace/happy-dom`。tag `v20.11.11` 必须解析到锁定的
`64e2c774…`，否则拒绝 vendor。

## triage 状态机

每个 vendored 测试文件必须收敛为**恰好一种终态**，不得静默缺席：

- `enabled`：文件必须实跑通过（T03 预载下 `bun test` exit 0）；必须带 `ledgerId`，
  并在 `compat/upstream-map.json` 登记 provenance；不带 reason。
- `skip`：不运行，必须带非空 `reason`（如 `propertysymbol` / `unmapped-internal-import` /
  `pending-wave`）。
- `expected-fail`：允许失败，但必须带非空 `reason` 声明**期望失败面**；波次收尾必须收敛为
  `enabled` / `skip`，不得长期滞留。

分片 schema（`triage/<subsystem>.json`）：

```json
{
  "schemaVersion": "1.0.0",
  "subsystem": "nodes",
  "entries": [
    { "file": "nodes/attr/Attr.test.ts", "status": "enabled", "ledgerId": "hc-hdunit-nodes-attr" },
    { "file": "nodes/some/NoSupport.test.ts", "status": "skip", "reason": "unmapped-internal-import" },
    { "file": "nodes/other/Fragile.test.ts", "status": "expected-fail", "reason": "fetch 面缺失" }
  ]
}
```

`file` 相对 `tests/happy-dom/rewritten/`，必须在 T02 清单（`rewrite-report.json`）的
`test-source` 文件中；每个文件只能出现在一个分片。

### 门禁规则（`compat:hdunit:validate`）

- exit 0：全量文件都有终态、无退化。
- exit 1：`enabled` 文件不跑绿、`expected-fail` 意外转绿、triage 与活体运行/ledger
  计数/upstream-map 不一致、`skip` 置 `enabled` 后不跑绿。
- exit 2：schema 非法、引用不存在的文件、未登记的 rewritten 文件、ledger/upstream-map
  schema 非法等结构性错误（门禁无法评估）。

triage 是**真相源**；`compat/ledger.json` 的 `hc-hdunit-<subsystem>-coverage` 汇总条目只
记录计数，门禁会从分片重算并比对，任何漂移即失败。**因此改分片必须同步改 ledger 计数**
（`compat:ledger` 门禁会拦）。

## 如何给新文件 triage

流程（波次工作流，参照 T06–T10 的既有提交）：

1. 确认文件在 `rewritten/` 存在且是 `rewrite-report.json` 中的 `test-source` 文件
   （`bun tests/happy-dom/report.mjs --json` 可核对全量终态覆盖）。
2. 确定它所属子系统（rewritten 路径首段；顶层 `index.test.ts` 归 `index`），打开对应
   `triage/<subsystem>.json`。
3. 实跑验证终态：
   - 能跑绿 → 置 `enabled`，分配 `ledgerId`（`hc-hdunit-<subsystem>-<case>`），删除 reason；
   - 结构上无法运行（propertysymbol / unmapped-internal-import / 依赖未落地波次）→
     `skip` + 具体 reason；
   - 能跑但失败面明确且波次内无法收口 → `expected-fail` + reason（波次收尾必须收敛）。
4. 同步三处书账：
   - 分片：改 `status`/`ledgerId`；
   - `compat/ledger.json`：更新 `hc-hdunit-<subsystem>-coverage` 的 enabled/expectedFail/
     skip 计数；`enabled` 文件还要新增单文件条目（`suite: "hdunit"`）；
   - `compat/upstream-map.json`：`enabled` 文件登记 `localId` = 单文件条目 id、
     `localPath` = rewritten 路径、锁定 commit + MIT。
5. 跑 `npm run compat:hdunit:validate`（必须 exit 0）与 `npm run compat:ledger`。
6. 波次收尾：跑 `npm run compat:hdunit:report`，确认数字与 COVERAGE.md 口径一致；如这是
   **基线点**（启用面变化），运行 `npm run compat:hdunit:report:baseline` 更新
   `report-baseline.json`，并把新数字同步进 `COVERAGE.md`。

## 报告与通过率口径

`compat:hdunit:report` 输出每子系统的 `total` / `enabled` / `expected-fail` / `skip` 与
通过率（`enabled / total`，四舍五入取整；total 为 0 时显示 `n/a`）。`--json` 附加：

- `totals.passRate` 与 `bySubsystem.<name>.passRate`；
- `baseline`：`report-baseline.json` 是否存在及其 `totals`；
- `delta`：每子系统与基线相比的 `enabled` / `expectedFail` / `skip` 差值。

当前通过率总结与 known-gap 分类见 [COVERAGE.md](./COVERAGE.md)。COVERAGE.md 必须与
report 数字一致（诚实，不美化）。

## 上游升级流程

hdunit 的 vendor 基线 = [ADR-0002 第 1 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)
锁定的三元组（v20.11.11 @ `64e2c774…`）。升级上游时，**必须随基线一起重 vendor 并重跑
门禁**，一次升级一个独立提交：

1. 按 [compat/README.md](../compat/README.md#基线升级操作) 更新 `compat/happy-dom-baseline.json`
   与 ADR-0002 基线表；
2. 更新 `scripts/vendor-happy-dom-tests.mjs` 顶部的 `PINNED` 常量（commit/tag/npm 版本）；
3. `npm run compat:hdunit:vendor` 重 vendor（新树逐字节落入 `vendor/`）；
4. `npm run compat:hdunit:rewrite` + `npm run compat:hdunit:shim` 重建产物；
5. 逐文件重新 triage（新增/删除/变更文件会打破终态覆盖，`compat:hdunit:report` 会指出
   未声明终态的文件）；同步 ledger 计数与 upstream-map 的 commit；
6. `npm run compat:hdunit:validate`（exit 0）+ `npm run compat:ledger`；
7. 若启用面有实质变化，更新 `report-baseline.json` 与 `COVERAGE.md`；
8. 提交说明列出新旧版本、新旧 commit 与差异摘要；该提交只做基线升级。

## CI

`.github/workflows/ci.yml` 的 `validate` job 在 "Validate compatibility ledger" 之后、
"Smoke test package packing" 之前运行 hdunit 步骤：先克隆锁定 tag 的上游 checkout 并
`--verify` vendor/rewrite（幂等 + 逐字节），再 `npm run compat:hdunit:validate`；任一步
失败即 CI 失败。`npm run validate` 链同样包含 `compat:hdunit:validate`（本地验证路径）。

## 边界

- 本目录不生成公开 API 快照（`compat/public-api/` 归 T08），不安装 happy-dom npm 包
  （版本由 `devDependencies` 锁定，供差分套件用，与本目录的 vendored 树无关）。
- 不改 triage 状态：那是各波次（T06–T10/T12）的成果；本仓库的收尾只做接入、报告与文档。
