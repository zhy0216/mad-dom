# tests/wpt：Web Platform Tests 子集（T48）

本目录把一小撮**锁定 commit 的 web-platform-tests（WPT）**用例接入 MAD DOM，
作为一条**独立的 WPT 统计轨道**：通过率单独展示，不参与 happy-dom 兼容清单
（`compat/ledger.json`）的 pass/known-gap 判定。[ADR-0002 第 8 节](../../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)
明确要求 WPT 单独统计，只用于补充 happy-dom 未覆盖或行为不明确的部分。

## 原则

- **可维护子集**：`manifest.json` 是唯一真相源，列出每个 vendored 用例的上游
  路径、锁定 commit 和许可证；新增/删除用例只改 manifest 与 `cases/`。
- **上游逐字保留**：`cases/*.html` 是从上游仓库按 `manifest.source.commit`
  逐字拉取的 `.html` 测试文件；runner 在运行时提取其中的内联 `<script>` 测试
  体执行，本地不做改写。
- **诚实报告**：每个用例在**全新隔离进程 + 全新 window** 中运行；缺失的
  MAD DOM API 表现为单个测试失败，而不是隐藏或跳过。通过率如实打印
  （`--json` 给出机器可读报告），且不改变 happy-dom 兼容结果。

## 结构

```
tests/wpt/
  README.md        本文档
  manifest.json    WPT 子集清单（上游 source + 用例列表）
  testharness.js   最小 testharness.js shim（test/async_test/promise_test/断言）
  runner.js        编排器：逐个用例跑独立子进程，汇总统计报告
  child.js         单用例探针：新建 window、注入全局、提取并执行测试体
  cases/           逐字 vendored 的上游 .html 用例
```

## 运行

```sh
npm run wpt:test    # 跑子集并打印通过率（单独展示，非门禁）
npm run wpt:json    # 同上，stdout 只输出机器可读报告（mad-dom-wpt-report/1）
```

退出码：`0` = 基础设施正常、报告已生成（测试通过/失败不改变退出码，WPT 是
测量不是门禁）；`2` = manifest/提取/探针基础设施错误。

## 更新子集

1. 在 `https://github.com/web-platform-tests/wpt` 选定一个固定 commit，把要
   加的 `.html` 用例按上游路径原样下载到 `cases/`；
2. 在 `manifest.json` 的 `tests` 追加条目（`id`、`localPath`、
   `upstreamPath`、`title`）；升级 commit 时同步更新 `source.commit` 并记录
   新旧 commit；
3. 运行 `npm run wpt:test` 确认通过率如实变化，无探针基础设施错误。

## 边界

- 只使用公开 DOM 面；不注入 happy-dom 或上游 testharness.js 私有实现。
- 通过率变化不触发 happy-dom 门禁；happy-dom 兼容结论仍然只来自
  `compat/ledger.json` + 差分 runner。
- 不以“扩大 shim”“删除用例”“标记 not-applicable”的方式制造高通过率——
  shim 只补 testharness.js 的测试框架 API，不改断言语义。
