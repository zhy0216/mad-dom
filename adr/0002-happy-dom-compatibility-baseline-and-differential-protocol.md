# ADR-0002：happy-dom 兼容基线与差分协议

- 状态：已接受
- 日期：2026-08-28

## 背景

[ADR-0001](./0001-basic-technical-architecture.md) 第 6 节确立了"在相同 Bun 版本和相同输入条件下，对一个锁定版本的 happy-dom 实现 100% 公开 API 与可观察行为兼容"的目标，第 7 节确立了测试策略，并把"首个 happy-dom 兼容基线、公开 API 清单和差分测试协议"列为后续决策第 1 项。[实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 的 M1 要求在建立任何兼容测试之前先锁定 npm 版本与 Git commit，机器可读的基线清单由 [T07](../todos/07-happy-dom-baseline-manifest.md) 建立。

本 ADR 只做兼容契约决策：锁定基线三元组（happy-dom 版本、上游 Git commit、Bun 版本），定义公开 API 范围与排除项，并固定快照、类型检查、黑盒差分、结果规范化、稳定测试 ID、冲突优先级和基线升级流程的规则。它不实现任何 runner、生成器或清单文件。

## 决策

### 1. 锁定的兼容基线

| 项 | 值 |
| --- | --- |
| happy-dom npm 版本 | `20.11.11` |
| 上游 Git commit | `64e2c774cadbb8eda5416c1e2bcca5006d1b5df9` |
| 上游 tag | `v20.11.11`（与上述 commit 完全一致） |
| npm 发布时间 | 2026-08-27T15:53:05.965Z（registry 元数据） |
| 兼容判定用 Bun 版本 | `1.4.0`（仓库 [.bun-version](../.bun-version) 固定值，本地与 CI 一致） |
| MAD DOM 公开运行时下限 | `package.json` 中 `engines.bun >= 1.4.0`（仅公开约束，不是判定版本） |

选择依据：

- `20.11.11` 是 happy-dom 在 npm 上正式发布的稳定版本；上游 tag `v20.11.11` 与 commit `64e2c774…` 一一对应（经 `git ls-remote` 对上游 refs 验证），npm tarball、Git commit 和 [ADR-0001 参考资料中已固定的上游测试目录与 LICENSE 链接](./0001-basic-technical-architecture.md)共用同一个 provenance 锚点；
- ADR-0001 第 7 节的"上游用例移植"要求保留上游文件与 commit 的来源映射；选择 ADR-0001 已经引用的 commit 可避免来源映射与既有引用错位；
- 当前 npm latest 为 `20.11.12`（2026-08-27T16:06:52.119Z 发布，上游 commit `3d282e5b`），与 `20.11.11` 的差异仅为一个修复（issue #2322 / PR #2323，`Node` 断开连接时的父节点检查）。该差异不改变本 ADR 建立的契约结构，按第 9 节流程在首次基线升级时评估；
- 兼容判定一律不使用上游 `main` 分支或未发布提交。

基线包事实（对发布 tarball 核实）：

- 入口：`lib/index.js`（`package.json` 的 `main`），类型声明为同目录的 `lib/index.d.ts`；
- 入口导出规模：约 200 个运行时值导出（类、枚举对象、常量对象、`PropertySymbol` 模块对象）与 40 个 TypeScript 类型导出；
- 上游声明 `engines.node >= 20.0.0`；在本项目中，happy-dom 与 MAD DOM 的判定环境都是 [.bun-version](../.bun-version) 固定的 Bun 1.4.0。

### 2. 公开 API 范围与排除项

判定单位是"包入口导出项"。纳入范围：

- 入口 `lib/index.js` 的全部运行时值导出：类（如 `Window`、`GlobalWindow`、`BrowserWindow`、`Document`、`Element`、`Node`、`Event` 与 Fetch 表面等）、枚举与常量对象（如 `CSSRule`、`EventPhaseEnum`、`BrowserErrorCaptureEnum`、`CookieSameSiteEnum`）、函数与 `PropertySymbol` 模块对象；
- `lib/index.d.ts` 的全部类型导出（`I*` 接口、`T*` 类型别名）；
- 导出类实例的构造方式、原型链、公开属性描述符、可枚举性与可序列化默认值；
- 通过上述公开 API 可观察的行为：DOM 变更、HTML/XML 解析、选择器、序列化、事件顺序、异步任务结果、Custom Elements、Shadow DOM、CSSOM、Storage、Fetch 等（清单见 ADR-0001 第 6 节）。

排除项（沿用 ADR-0001 第 6 节，并在协议层细化）：

- 深层导入：一切非入口子路径，包括 `happy-dom/lib/**`（例如 `happy-dom/lib/PropertySymbol.js`）；
- happy-dom 的内部目录结构、源码实现方式、内部数据结构与性能特征；
- 实例对象上以 symbol 为键的内部槽位（`PropertySymbol.*` 所指涉的内部状态）不属于行为兼容承诺；
- `PropertySymbol` 本身作为入口导出项必须存在（同名导出、可观察类别一致并纳入快照），但其包含的符号键集合与各 symbol 描述仅做记录性快照（informational），不作为硬性兼容门禁；如需提升为硬性契约，必须新开 ADR；
- 堆栈中的源码路径、进程调度抖动等由宿主产生且无法稳定复现的值。

### 3. 公开 API 快照协议

由 [T08](../todos/08-public-api-snapshot.md) 实现，契约如下：

1. 采集范围与结构：
   - 入口导出清单：导出名、`typeof`、可枚举性、类别（类 / 函数 / 常量对象 / 枚举）；
   - 每个导出类的构造函数与原型链：类名、静态成员、沿 `Object.getPrototypeOf` 直至 `null` 的原型类名序列、实例原型上的方法与 accessor 名单；
   - 自有属性、symbol 键与属性描述符：`enumerable`、`configurable`、`writable` 或 `get`/`set` 存在性（不比较函数体）；symbol 键按第 2 节规则标记为 informational；
   - 可序列化默认值：新构造实例上稳定的原始值默认字段（如 `nodeType`、`readyState` 一类），只记录可序列化（原始值或纯结构）的项。
2. 生成方式：对锁定版本的 happy-dom 与 MAD DOM 使用同一生成器、同一 Bun 版本（1.4.0）与相同入口加载方式各生成一份清单，逐项比较；
3. 差异分类固定为四种：`missing`（MAD DOM 缺少导出或成员）、`extra`（MAD DOM 多出）、`shape-mismatch`（结构不同）、`value-mismatch`（可序列化默认值不同）；`missing`、`shape-mismatch`、`value-mismatch` 为硬失败；`extra` 不直接判失败，但必须逐项记录原因并保持可见，不得静默累积；
4. 快照元数据必须包含：基线 npm 版本、上游 commit、Bun 版本、生成时间和生成器版本；快照产物纳入 `compat/public-api/`。

### 4. 类型检查双目标 fixture 协议

由 [T09](../todos/09-type-compatibility-harness.md) 实现，契约如下：

1. fixture 是同一份 TypeScript 公开用法样本：只允许从包入口导入值与类型，禁止深层导入、`PropertySymbol` 内部用法和用 `any` 断言逃逸检查；
2. 同一 fixture、同一 TypeScript 版本，分别在两个类型目标下检查：目标 A 以 happy-dom `20.11.11` 的 `lib/index.d.ts` 为类型源，目标 B 以 MAD DOM 的 `index.d.ts` 为类型源；
3. 判定规则：
   - 硬门禁：happy-dom 接受、MAD DOM 拒绝 → 失败；
   - 记录项：happy-dom 拒绝、MAD DOM 接受 → 必须逐项记录（宽松方向偏差）并说明原因，不得静默；
4. fixture 必须覆盖：值导出引用、类型导出引用、构造签名、方法与属性签名、事件回调参数类型、枚举成员、泛型与重载形态；
5. fixture 或 TypeScript 版本的变更都视为协议变更，走独立提交。

### 5. 黑盒差分 runner 协议

由 [T10](../todos/10-differential-runner.md) 实现，契约如下：

1. 场景（scenario）是自描述脚本：固定输入（HTML/标记、固定种子生成的操作序列、事件脚本），只使用公开入口，不读取两个实现的内部状态；
2. 每个场景在两个相互隔离的子进程中分别执行：进程 A 加载 happy-dom `20.11.11`（安装自锁定 tarball），进程 B 加载 MAD DOM；两进程使用相同 Bun 版本、相同参数、相同的环境变量白名单和一致的网络策略（默认禁网，或双端完全一致的 mock）；
3. 每个进程输出结构化结果，具体传输格式由 T10 决定；runner 在比较前必须按第 6 节规范化；
4. 场景必须可稳定重放：随机操作使用记录在案的固定种子；发现差异时输出最小复现（种子 + 场景 ID + 操作子序列）；
5. happy-dom 在 Bun 下运行产生的宿主噪声（事件循环计时、Node 兼容 API 差异等）由规范化规则吸收，不得记为 MAD DOM 的兼容失败。

### 6. 结果规范化格式

规范化结果是固定结构，各段可选，但每段的编码规则固定：

1. 原始值：`typeof` 加归一化表示；数字显式标记 `-0`、`NaN`、`Infinity`；字符串原样保留；
2. 结构化值：数组与普通对象递归序列化；字符串键按字典序排序；symbol 键仅 informational、不参与比较；循环引用以引用标记表达；
3. DOM/HTML 快照：结构化树 dump（`nodeType`、`nodeName`、命名空间、按名字排序的属性、子树递归），加上实现自身的序列化 HTML 输出（以原文比较）；
4. 异常：`name` + 稳定消息 + 抛出时机（同步抛出 / Promise 拒绝 / 回调内抛出）；消息中包含路径、地址等宿主噪声时，必须由场景声明该字段 `unstable` 并给出其归一化方式，不得为通过用例修改全局 normalizer；
5. 属性描述符：`enumerable`、`configurable`、`writable` 或 `get`/`set` 存在性；函数值只比较"存在性 + `typeof` + 是否 accessor"；
6. 对象身份：以场景内别名表达的身份关系矩阵（如 `node.firstChild === node.firstChild`、live collection 引用稳定性、`parentNode` 返回身份），输出为布尔关系表；
7. 事件与异步顺序：事件序列（`type`、目标别名、`eventPhase`、`defaultPrevented`）与微任务/宏任务的可观察交付顺序；定时器只比较调度顺序，不比较绝对时间。

normalizer 是受版本控制的契约：任何修改必须是独立提交并说明动机；禁止为了让失败用例通过而扩大归一化范围。

### 7. 稳定测试 ID 与兼容清单规则

由 [T11](../todos/11-compatibility-ledger-and-provenance.md) 落地，契约如下：

1. ID 格式：`hc-<suite>-<capability>-<case>`，全小写 kebab-case：
   - `suite` ∈ `api`（快照）、`types`（类型 fixture）、`diff`（黑盒差分）、`up`（上游移植用例）；
   - `capability` 与实现计划 M7/M8 的能力波次命名一致（如 `node`、`element`、`form`、`event`、`fetch`、`css`、`parser`、`selector`）；
   - `case` 为场景或 fixture 的稳定短名；
   - 示例：`hc-diff-node-append-parent-identity`、`hc-api-element-classlist-descriptor`、`hc-types-event-eventinit`、`hc-up-element-closest-form-proxy`。
2. ID 一经分配不可复用或重命名；用例废弃时保留 ID 并更新状态，防止历史记录漂移；
3. 状态：`pass` / `known-gap` / `not-applicable`；后两者必须填写原因与记录时间；`not-applicable` 的典型原因：依赖宿主进程能力、依赖浏览器 UI、上游行为依赖其内部实现；
4. 来源映射：上游移植用例必须记录 happy-dom 仓库内的测试文件路径、锁定 commit（`64e2c774…`）与本地 ID 的对应关系；只移植依赖公开 API 的用例；
5. CI 规则：已有 `pass` 项不得退化为 `known-gap`；新增 `known-gap` 必须在 PR 中显式更新清单。

### 8. happy-dom 与 Web 标准冲突的优先级

- 在兼容模式下，happy-dom 的可观察行为与 Web 标准不一致时，一律以锁定基线（`20.11.11` @ `64e2c774…`）的实际行为为准；
- Web Platform Tests 只用于补充 happy-dom 未覆盖或行为不明确的部分，单独统计，不与 happy-dom 兼容率混合为同一指标（ADR-0001 第 7 节）；
- 不得在普通 PR 中把已建立的兼容结果"改判"为标准行为；此类决策必须通过新 ADR 或第 9 节的基线升级流程处理并记录。

### 9. 基线升级流程

- 触发条件：上游发布了包含兼容契约相关修复的新版本，或使用者提出了跟进需求；不设固定频率，每次升级都需要一次显式评估；
- 流程：
  1. 在独立提交中更新基线三元组（happy-dom npm 版本、上游 commit，必要时 Bun 版本），同步更新 T07 建立的机器可读基线清单，并重新生成快照与类型/差分结果；
  2. 全部兼容门禁（快照、类型、黑盒差分、退化检查）必须恢复通过；新增差异逐项归入 `pass` 或 `known-gap` 并写明原因，不得静默跳过；
  3. 该提交只做基线升级，不混入功能改动；提交说明必须列出新旧版本、新旧 commit 与差异摘要；
  4. 本 ADR 第 1 节的基线表随之更新（或由新 ADR 取代），并记录升级原因与日期；
  5. Bun 版本升级同样走独立提交与完整门禁，且必须同时验证 happy-dom 与 MAD DOM 在新版本下行为一致。
- 效果约束：升级前的兼容结论不自动带入新基线；一切结论以新基线下重新生成的结果为准。

## 非目标

本 ADR 不包含：

- 兼容 runner、快照生成器、类型 fixture 或兼容清单的实现（T08–T11）；
- `compat/happy-dom-baseline.json` 的创建与字段定义（T07 的交付物；本 ADR 只规定其必须可追溯到第 1 节的基线三元组）；
- 自动跟进上游发布的自动化策略；
- 对上游 `main` 分支或未发布提交的兼容承诺。

## 影响

### 正面影响

- "兼容"从目标陈述变为可复现判定：npm tarball、Git commit、Bun 版本和判定协议全部固定，任何人可以重建相同的判定环境；
- ADR-0001 的参考资料与本基线共用同一 provenance 锚点（`64e2c774…`），上游来源映射不会与既有引用错位；
- normalizer、ID 规则与状态语义先行固定，避免兼容测试为结果服务。

### 代价与风险

- 基线落后 npm latest 一个 patch（`20.11.12`），上游发布节奏快，存在持续追赶压力；
- `PropertySymbol` 的"导出存在但内部 informational"边界需要在后续实现中持续解释；
- 事件循环与定时器相关的规范化规则可能需要随实现演进，每次演进都有协议变更成本；
- 100% 门禁使基线升级成本随公开 API 面扩大而上升。

## 后续决策

以下主题由对应 TODO 落地，不在本 ADR 内决定：

1. `compat/happy-dom-baseline.json` 的机器可读字段（[T07](../todos/07-happy-dom-baseline-manifest.md)）；
2. 快照生成器的输出格式与比较算法（[T08](../todos/08-public-api-snapshot.md)）；
3. 类型检查使用的 TypeScript 版本与运行方式（[T09](../todos/09-type-compatibility-harness.md)）；
4. 差分 runner 的进程模型、场景 DSL 与结果传输格式（[T10](../todos/10-differential-runner.md)）；
5. 兼容清单文件与汇总报告的具体格式（[T11](../todos/11-compatibility-ledger-and-provenance.md)）。

## 参考资料

内部：

- [ADR-0001：基础技术架构](./0001-basic-technical-architecture.md)（第 6 节兼容策略、第 7 节测试策略）
- [ADR-0001 基础技术架构实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)（M0/M1）
- [TODO 队列](../todos/README.md)
- [T07：happy-dom 基线清单](../todos/07-happy-dom-baseline-manifest.md)
- [T08：公开 API 快照](../todos/08-public-api-snapshot.md)
- [T09：类型兼容 harness](../todos/09-type-compatibility-harness.md)
- [T10：差分 runner](../todos/10-differential-runner.md)
- [T11：兼容清单与来源映射](../todos/11-compatibility-ledger-and-provenance.md)

外部（均为已验证可访问的 URL）：

- [happy-dom 官方仓库](https://github.com/capricorn86/happy-dom)
- [锁定的上游 commit 64e2c774](https://github.com/capricorn86/happy-dom/commit/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9)
- [上游 tag v20.11.11](https://github.com/capricorn86/happy-dom/releases/tag/v20.11.11)
- [锁定 commit 下的上游测试目录](https://github.com/capricorn86/happy-dom/tree/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/packages/happy-dom/test)
- [happy-dom MIT License（锁定 commit）](https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE)
- [happy-dom 20.11.11 npm tarball](https://registry.npmjs.org/happy-dom/-/happy-dom-20.11.11.tgz)
