# 黑盒差分 runner（T10）

在相互隔离的子进程里，用**同一个场景**分别驱动 happy-dom（锁定基线
`20.11.11`，见 `compat/happy-dom-baseline.json`）和 MAD DOM（仓库入口
`index.js`），对两侧的可观察结果做规范化后逐路径比较。契约来源：
[ADR-0002](../../../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)
第 5 节（黑盒差分 runner 协议）与第 6 节（结果规范化格式）。

## 目录结构

```
tests/compat/runner/
  protocol.js   场景协议（模块契约、api 表面、隔离契约；本文件的权威注释在代码头）
  normalize.js  结果规范化（规则表见代码头注释；唯一规范化执行点）
  compare.js    规范化记录比较器（差异路径 + kind）
  targets.js    目标适配器注册表：happy-dom / mad-dom / mock-pass / mock-fail
  mocks.js      自测用受控 mock DOM（mock-fail 携带 5 处已注明的种子差异）
  child.js      探针进程 bootstrap（每个 (场景, 目标) 一个全新进程）
  run.js        编排器 + 报告 + CLI
tests/compat/scenarios/
  selftest/     自测场景（mock 目标对）；divergent/ 子目录存放故意失败场景
  dom/          真实差分场景（happy-dom vs mad-dom）
tests/compat/runner.test.js   T10 自测（bun test）
```

## 场景协议

每个场景是**一个自描述模块**，命名导出：

| 导出 | 说明 |
| --- | --- |
| `id` | 稳定 kebab-case 标识符，全局唯一；T11 兼容清单的 `hc-diff-*` 条目将映射到它 |
| `description` | 一行人类描述 |
| `targets` | 可选；`"real"`（默认）→ `["happy-dom", "mad-dom"]`；`"mock"` → `["mock-pass", "mock-fail"]`；或显式二元数组 |
| `run(api)` | 场景体（异步） |

`api` 表面（由 runner 经目标适配器注入）：

- `api.target` — 当前目标适配器 id（仅元数据；**场景禁止按 target 分支**，唯一例外是 runner 自测的篡改 harness）；
- `api.dom` — 实现入口对象（happy-dom 模块命名空间 / mad-dom 包命名空间 / mock DOM）；
- `api.record.value(key, value)` — 命名原始观测（场景结束后规范化）；
- `api.record.event(name, detail = null)` — 有序事件（顺序即观测，永不排序）；
- `api.record.error(error, phase)` — 异常观测；`phase` 为场景声明的抛出阶段（推荐词表：`setup` / `sync-throw` / `promise-rejection` / `callback` / `teardown`；任意非空字符串均可）；name 与 message **原样比较**；
- `api.record.snapshot(key, node)` — DOM 观测：调用时**立即**深捕获（结构树 + 根节点 `outerHTML`），之后的变更不影响已记录内容；
- `api.record.descriptor(key, object, propertyKey)` — 属性描述符形状观测（缺失 → `{ present: false }`）；
- `api.record.identity(label, a, b)` — "a 与 b 是同一对象"布尔关系（`Object.is`），输出为按 label 排序的布尔关系表。

key/label 必须匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`。违反契约会在探针内抛出 →
该侧被记为基础设施错误（exit 2），不会被吞掉。

场景规则（ADR-0002 §5.1/§5.4）：只用公开入口表面；固定输入；禁止读实现内部状态、
深层导入、宿主时钟与未记录种子的随机数；默认禁网（探针只拿到环境变量白名单）。

## 隔离模型

- 父进程（run.js）**永不**导入任何实现或目标适配器，只负责 spawn 探针；
- 每个 `(场景, 目标)` 组合一个全新 `bun child.js <scenario> <target> <out.json>` 进程；
- 探针环境变量白名单：`PATH`、`HOME`、`TMPDIR`、`LANG`、`LC_ALL`、`BUN_INSTALL`；cwd 固定为仓库根；
- 单探针超时 10s（`SIGKILL`）；崩溃/超时/非零退出/输出不可解析 → 该侧结构化
  `infraError`，不污染其他场景；
- 探针把信封 JSON 写入临时文件：`{ schema, scenario, target, pid, record, infraError }`。
  `pid` **只**用于自测的隔离断言（`runner.test.js`），规范化记录中永远不含 pid；
- 规范化在探针内、场景结束后执行一次（原始值可能含 symbol/bigint/循环引用，
  无法直接过 JSON 边界）；父进程只校验信封 schema，不再二次解释数据。

## 规范化规则（摘要）

权威规则表在 `normalize.js` 头注释。要点：

1. **原始值**：统一为 `{ type, ... }`；数字显式标记 `~NaN` / `~Infinity` /
   `~NegativeInfinity` / `~NegativeZero`；字符串原样；symbol 仅 `description`；
   function 仅 `name` + `length`；循环引用 → `{ type: "reference", id }`；深度上限 64；
2. **DOM/HTML 快照**：结构树（`nodeType`/`nodeName`/`namespaceURI`/按名字排序的
   `attributes`/`data`/`children` 按文档序递归）+ 根节点 `outerHTML`；快照叶子
   （属性值、文本、outerHTML）为**原样字符串**（"以原文比较"）；非字符串属性值
   会被显式分类而不是强转（防止把真实差异变相同）；
3. **异常**：`{ name, message, phase }`，message 原样比较、不做任何模糊化；
   错误按记录顺序保存（顺序是观测的一部分）；
4. **描述符**：`{ present, writable, enumerable, configurable, hasGet, hasSet }`；
   accessor 的 `writable` 为 `null`；
5. **身份**：按 label 排序的布尔关系表；
6. **事件**：有序 `{ name, detail }` 列表，detail 走原始值规范化；
7. **排序规则**：键控段（values / snapshots / descriptors / identity）输出前按 key
   排序；有序段（events / errors）与树的 children **保持原顺序**——顺序本身就是观测。

**边界（不可协商）**：normalizer 只做确定性规范化（分类、排序、稳定序列化），
不做"把不同变相同"的吞并——不 fuzzy 匹配消息、不剪裁字符串、不忽略大小写、
不隐藏路径。任何修改都是协议变更，必须独立提交并说明动机。

## 比较与差异路径

`compare.js` 对两份规范化记录做深度比较，输出按路径排序的差异列表：

```
{ path: "errors[0].name",               kind: "changed",   left, right }
{ path: "events[2].name",               kind: "changed",   left, right }
{ path: "snapshots.tree.attributes.id", kind: "left-only", left, right: null }
```

- 路径语法：对象键用 `.`、数组下标用 `[n]`；顶层段为记录的六大段；
- `changed` = 双方都存在但叶子不同；`left-only` / `right-only` = 只在一侧存在；
- 数组按下标逐个比较，多出的元素成 `left-only`/`right-only` —— **顺序差异**因此
  以出错下标的 `changed` 呈现（例如事件乱序 → `events[1].name`）。

## CLI 与退出码

```
bun tests/compat/runner/run.js [paths...] [--report] [--selftest] [--json]
```

- `paths`：场景文件或目录；默认 `scenarios/selftest` + `scenarios/dom`。名为
  `divergent` 的目录在目录遍历中被跳过（故意失败场景只能显式传入运行）；
- `--selftest`：只跑自测目录，严格退出码（`npm run compat:differential:selftest`）；
- `--report`：报告模式 —— 真实目标对（happy-dom vs mad-dom）的差异如实打印但
  **不**导致失败（它们是真实的兼容缺口，由 T11 兼容清单收口）；mock 对差异仍然
  致命（`npm run compat:differential`）；
- `--json`：只在 stdout 打印机器可读 JSON 报告（`mad-dom-diff-report/1`）。

退出码：`0` 全部一致（或仅报告模式差异）；`1` 存在致命差异；`2` 存在基础设施
错误（探针崩溃/超时/场景契约违规/规范化失败）。基础设施错误在任何模式下都
失败——**两侧以同样方式崩溃也失败**，坏场景绝不能静默"通过"。

## 自测设计

| 场景 | 目标对 | 预期 |
| --- | --- | --- |
| `selftest-primitives-events` | mock | 通过：17 个原始值类别 + 3 事件顺序/细节两侧一致 |
| `selftest-identity-descriptors` | mock | 通过：身份矩阵、描述符形状（data/accessor/缺失）、小型快照一致 |
| `selftest-isolation-write` | mock | 通过：在自己的探针里写 `globalThis.__madDomDifferentialPollution` |
| `selftest-isolation-read` | mock | 通过：在另一个探针里断言无污染；bun test 另断言两侧 pid 不同 |
| `selftest-error-shape`（divergent/） | mock | 故意失败：`errors[0].phase`、`errors[1].name`、`errors[1].message`、`values.sync-mode.value` |
| `selftest-dom-snapshot-events`（divergent/） | mock | 故意失败：事件顺序 ×2、`snapshots.tree.attributes.id`（left-only）、文本 data、outerHTML |
| `dom-create-append-serialize` | real | 报告：mad-dom 侧 setup 阶段 `createWindow()` 抛错，如实可见 |
| `dom-query-selector-identity` | real | 报告：同上的 setup 缺口（querySelectorAll / 身份 / click 冒泡顺序在 happy-dom 侧记录） |

mock-fail 的 5 处种子差异全部注明在 `mocks.js` 头注释（管线事件乱序、同步抛改
异步拒、异步错误名+消息、文本大写、丢弃 `id` 属性）。

## 真实差分与 T11 的接缝

真实场景（`dom/`）当前的差异是**真实兼容缺口**：MAD DOM 处于 pre-alpha，
`createWindow()` 抛 `Error("mad-dom is in pre-alpha development and does not
implement Window yet.")`，探针把它作为 setup 阶段异常记录，happy-dom 侧则记录
完整观测。这些差异：

- 在 `--report`（`npm run compat:differential`）下**如实打印、不作为失败**；
- `--json` 报告含完整规范化记录与差异路径，供 T11 生成
  `hc-diff-<capability>-<case>` 清单条目（`pass` / `known-gap` 状态、来源与时间）；
- **不得**通过扩大 normalizer 或改场景让它们"变绿"。
