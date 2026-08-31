# 01 Vendor happy-dom 单测套件与模块清单

- 状态：待办
- 优先级：P0
- 里程碑：基建
- 条目 ID：`T01`
- 依赖：无
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

把 happy-dom 上游单测套件**原样** vendor 进仓库（`tests/happy-dom/vendor/`），并生成后续重写、适配、shim 共用的机器可读模块清单（`tests/happy-dom/vendor-scan.json`）。Vendor 来源必须与兼容基线一致：ADR-0002 第 1 节锁定的 `happy-dom@20.11.11`（tag `v20.11.11`，commit `64e2c774cadbb8eda5416c1e2bcca5006d1b5df9`），不得使用本地 master（本地仓库当前只有 tag `v20.12.0`，没有锁定 commit，需从 origin fetch）。

## 条目

- [ ] **T01 — Vendor 管线与模块清单**
  - 实现：
    - 脚本 `scripts/vendor-happy-dom-tests.mjs`：
      - 从上游 origin fetch `v20.11.11` tag（`git fetch origin tag v20.11.11`，本地缓存优先，离线时给出明确报错）；
      - 拷贝 `packages/happy-dom/test/` **全部内容**（`.test.ts`、局部 helper、`data/`、`utilities/`、`__snapshots__/` 等）到 `tests/happy-dom/vendor/`，保留目录结构；
      - 同时抽取**纯枚举/常量模块**（仅含字面量导出、无 DOM 依赖，如 `DOMExceptionNameEnum`、`NodeTypeEnum`、`CSSRuleTypeEnum`、SVG 系列 Enum）到 `tests/happy-dom/vendor-src-enums/`，供 T04 shim 使用；每个文件附 provenance 头注释（上游路径、commit、MIT）；
      - 生成 `tests/happy-dom/vendor-scan.json`：`{schemaVersion, upstream{repository,commit,tag,license}, files[]}`，每个文件记录：vendor 相对路径、上游路径、文件内 import 分类（`src-runtime`/`src-type`/`local-helper`/`vitest-api`/`external`）、所用 vi API 清单、**是否全部运行时 import 可映射**、以及每个 `src/` 路径的 `shimPath` 字段（可映射者指向 `tests/happy-dom/shim/src/<相对路径>`，不可映射者为 `null` + 原因分类）。`shimPath` 的生成规则在此冻结，成为 T02/T03/T04 的接口契约；
      - `--verify` 模式：对 vendor 目录做逐字节校验（重新 fetch 比对或哈希清单比对），验证可重复性；
    - `tests/happy-dom/vendor/UPSTREAM.md`：记录来源（repo、tag、commit、license MIT）、vendor 日期、与 `compat/happy-dom-baseline.json` 的交叉核对结果；
    - 扫描时输出统计摘要（文件数、行数、可映射/不可映射文件与路径数、vi API 分布），写入 `tests/happy-dom/vendor-scan.summary.md`。
  - 验收：
    - `bun scripts/vendor-happy-dom-tests.mjs` 与 `--verify` 均可重复运行且结果一致；
    - vendor 文件与上游 `v20.11.11` 的 `packages/happy-dom/test/` 逐字节一致（除 UPSTREAM.md）；
    - vendor-scan.json 通过自身 schema 校验，`shimPath` 规则与 T02/T04 约定一致；
    - 可映射统计与上游预扫描口径一致（约 492 个内部路径中约 265 个可映射；约 104 个文件全部运行时 import 可映射；以实际扫描为准）；
    - `git diff --check` 通过；`npm run check` 通过（新增脚本不破坏仓库检查）。

## 预期改动

- `scripts/vendor-happy-dom-tests.mjs`
- `tests/happy-dom/vendor/**`、`tests/happy-dom/vendor-src-enums/**`
- `tests/happy-dom/vendor-scan.json`、`tests/happy-dom/vendor-scan.summary.md`、`tests/happy-dom/vendor/UPSTREAM.md`
- `package.json`（新增 `compat:hdunit:vendor` 脚本）

## 专属校验

- `bun scripts/vendor-happy-dom-tests.mjs --verify`
- vendor-scan.json schema 校验与统计口径检查
- 不触发 `npm run validate` 全量（vendor 只是数据，不进入构建与测试面；但需保证仓库检查命令不报错）

## 边界

- 只 vendor 数据与生成清单，不做任何改写（改写归 T02）、不写 shim（归 T04）、不写适配层（归 T03）、不改 `compat/upstream-map.json` 与 `compat/ledger.json`（schema 扩展归 T05）。
- 不做 triage 决策（归 T05 及后续波次）；不安装 vitest；不改依赖。
- 不从本地 master 拷贝测试；若需要研究上游最新代码另开只读 checkout，不进入 vendor。
- provenance 记录必须包含 MIT 许可与锁定 commit，为 T05 的 upstream-map 录入预留 `localId` 字段（本任务不分配正式 id）。
