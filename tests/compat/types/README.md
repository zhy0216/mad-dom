# tests/compat/types：TypeScript 双目标兼容 harness（T09）

同一组共享 fixture 分别以 happy-dom 与 MAD DOM 的类型入口做 typecheck，落实
[ADR-0002 第 4 节](../../../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)
的类型双目标 fixture 协议。驱动器只调用 `tsc --pretty false` CLI，解析其固定格式的
诊断输出为结构化 JSON 后判定，不依赖任何编辑器行为。

## 结构

```
tests/compat/types/
  run.mjs                     驱动器（bun/node 均可运行）
  tsconfig.base.json          共享编译选项（strict、noEmit、moduleResolution bundler、types: []）
  happy-dom/tsconfig.json     把虚拟模块 dom-under-test 映射到 node_modules/happy-dom/lib/index.d.ts
  mad-dom/tsconfig.json       把虚拟模块 dom-under-test 映射到仓库根 index.d.ts
  expected-divergences.json   当前 MAD DOM 类型面已知缺口的记录（known-gap 清单）
  fixtures/positive/*.ts      正向 fixture：happy-dom 接受的公开用法
  fixtures/negative/*.ts      负向 fixture：两个目标都必须拒绝的用法（行内 @ts-expect-error 标记）
  harness.test.js             bun test 集成：运行驱动器与自证场景
```

约束：

- fixture 只允许 `import ... from "dom-under-test"`（单行 import），只覆盖包入口公开用法；
  禁止深层导入、`PropertySymbol` 内部用法与 `any` 断言逃逸。
- 两套 tsconfig 都只用包入口声明（happy-dom 的 `lib/index.d.ts`、MAD DOM 的根
  `index.d.ts`），不引用 happy-dom 内部深层声明路径。
- `expected-divergences.json` 是临时 known-gap 清单：[T11](../../../todos/11-compatibility-ledger-and-provenance.md)
  的兼容清单将接手这些记录。

## 运行

```sh
npm run compat:types                # 驱动器（已接入 npm run validate）
bun tests/compat/types/run.mjs      # 等价直跑
bun tests/compat/types/run.mjs --json        # 追加机器可读摘要
bun tests/compat/types/run.mjs --self-test   # 在 /tmp 临时副本上演练 3 个篡改场景
bun test tests/compat/types         # harness.test.js（含 --self-test）
```

驱动器对每个目标分别执行 `tsc -p <tsconfig> --pretty false`，把输出解析为
`{fixture, line, column, code, message}`，然后逐 fixture 判定：

1. **happy-dom 目标：所有 fixture 必须零诊断。** 负向 fixture 依赖 tsc 的
   "Unused '@ts-expect-error' directive"（TS2578）机制：被标记行一旦不再报错，
   TS2578 就会出现在标记行上并使运行失败——这证明负向断言确实在执行。
2. **mad-dom 目标：** 每条诊断必须归入以下三类之一，否则失败：
   - 命中 `expected-divergences.json` 中该 fixture 的诊断模式（code + message
     子串 + 可选行号）；
   - 负向 fixture 被标记行上的真实拒绝（mad-dom 拒绝错误用法，正是期望行为）；
   - 模块级缺口规则（见下）吸收的 TS2578。
3. **硬门禁（ADR-0002 第 4 节）：** happy-dom 接受、mad-dom 拒绝且未被清单覆盖
   → exit 1。修复方式只有两种：补齐 mad-dom 类型，或先在该 fixture 的清单条目中
   记录缺口（含 reason 与 addedIn）。
4. **过期条目：** 清单中每条模式都必须命中至少一条真实诊断。MAD DOM 类型补齐后
   模式不再命中 → exit 1，必须在同一提交中删除该条目。

### 模块级缺口规则（负向 fixture）

当 mad-dom 目标连 `dom-under-test` 的具名导出都解析不了时（import 行上的
TS2305/TS2724/TS2307 等），负向 fixture 的被标记行在 mad-dom 侧表现为 `any`
级联，只产生"未使用指令"TS2578。此时驱动器把这些 TS2578 视为模块级缺口的级联
吸收（记为 `known-gap: module-level missing exports`），而不是强行通过：import
缺口本身仍必须被清单条目覆盖。一旦具名导出补齐（import 行零诊断），被标记行就
必须在 mad-dom 侧真实报错，任何"mad-dom 接受了错误用法"的情况都要以清单条目
显式记录（宽松方向偏差，ADR-0002 第 4 节判定规则的记录项）。

## expected-divergences.json 升级流程

- 字段：`id`（稳定、不复用）、`fixture`（相对 fixtures/ 的路径）、`reason`、
  `addedIn`（加入时的 TODO id）、`diagnostics`（期望的诊断模式数组：
  `code` + `messageIncludes` + 可选 `line`，至少一项）。
- 新增：MAD DOM 拒绝了 happy-dom 接受的用法而短期内不修类型时，先加条目（含
  原因）再合入；驱动器校验 schema（未知字段拒绝、id 唯一、fixture 必须存在）。
- 删除：类型实现补齐导致模式过期（stale）时，必须在同一提交中删除对应条目；
  否则驱动器 exit 1。这保证清单只缩不减时是显式决定。
- T11 的兼容清单落地后，本文件改为由 ledger 生成或迁移，字段语义向
  `hc-types-*` 测试 ID 对齐。

## 自证（验收证据）

`--self-test` 在 `os.tmpdir()` 建立本目录的临时副本（node_modules 以符号链接
回真实仓库，两套 tsconfig 的路径改写为绝对路径），然后验证三个篡改场景都以
exit 1 失败：

- **A**：从清单删除任一条目 → 硬门禁失败（模拟 "MAD DOM 拒绝 happy-dom 接受
  的公开用法时测试失败"）；
- **B**：把某条模式改成永不匹配 → stale entry 失败（过期条目不可静默残留）；
- **C**：删除负向 fixture 的某个 `@ts-expect-error` 标记 → happy-dom 目标出现
  未抑制诊断并失败（证明负向检测真实执行）。

## 边界

- 不通过扩充 `index.d.ts`/`index.js` 伪造未实现的运行时能力来让 fixture 通过；
  类型面缺口一律走清单。
- TypeScript 为精确版本 devDependency（当前 `5.9.3`，最新 5.x；npm latest 已是
  7.x，不采用）。fixture 或 TypeScript 版本变更按 ADR-0002 第 4 节视为协议
  变更，走独立提交。
