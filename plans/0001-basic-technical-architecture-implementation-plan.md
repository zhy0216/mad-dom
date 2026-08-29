# ADR-0001 基础技术架构实现计划

- 状态：草案
- 对应 ADR：[ADR-0001：基础技术架构](../adr/0001-basic-technical-architecture.md)
- 计划日期：2026-08-28
- 目标运行时：Bun `>=1.4.0`

## 1. 目标

本计划把 ADR-0001 拆解为可验证的实施阶段。首要目标不是一次性补齐 happy-dom 的全部能力，而是先建立稳定的三层架构、兼容性度量体系和端到端垂直切片，再持续扩大公开 API 与可观察行为覆盖面。

计划完成后，仓库应具备：

1. 与 Bun/JavaScriptCore 解耦、可独立测试的 Rust DOM Core；
2. 只负责转换、包装、生命周期和错误映射的轻量原生绑定层；
3. ESM JavaScript facade 与同步维护的 TypeScript 类型；
4. 锁定 happy-dom 版本后的公开 API、类型和黑盒差分测试体系；
5. 以兼容清单驱动、能够逐步扩展到稳定版本的交付流程。

## 2. 实施原则

- **Core 优先**：DOM 规则、状态和不变量只在 Rust Core 中实现，JavaScript 侧不维护镜像树。
- **垂直切片**：每个阶段都应形成可从 JavaScript 调用、能通过 Core 与 Bun 集成测试的完整能力，而不是长期堆积互不连通的模块。
- **兼容性可测量**：公开 API 和行为均从锁定的 happy-dom 基线生成，缺口必须显式记录。
- **正确性先于索引优化**：先以统一 DOM 模型实现正确行为，再根据基准结果引入字符串驻留、查询索引或回收优化。
- **句柄不越界**：跨原生边界只传不透明句柄或包装对象，不暴露 Rust 裸指针。
- **决策留痕**：ADR-0001 中明确要求后续决定的技术选型，先完成原型和 ADR，再进入对应生产实现。

## 3. 工作流与依赖

```text
M0 决策与工程基线
 ├─> M1 兼容基线与测试骨架 ───────────────────────┐
 └─> M2 Rust Core：arena + 基础 DOM ─> M3 原生绑定 │
                                      │            │
                                      └─> M4 首个端到端切片
                                                │
                      ┌─────────────────────────┼──────────────┐
                      ▼                         ▼              ▼
              M5 解析与序列化            M6 选择器       M7 DOM API 扩展
                      └─────────────────────────┴──────────────┘
                                                │
                                                ▼
                                      M8 happy-dom 能力波次
                                                │
                                                ▼
                                         M9 发布与稳定化
```

M1 与 M2 可以并行推进；M3 依赖绑定技术 ADR；M4 依赖 M2、M3 和最小 JavaScript facade。后续能力必须持续接入 M1 建立的兼容门禁。

执行时，M3/M4 的大范围工作项按 `todos/README.md` 拆成可独立 worktree 的 contract 子任务和串行集成闸门；大节中的能力清单是验收范围，不代表单个 commit 或可无条件并发的任务。

## 4. 里程碑

### M0：固定决策与工程基线

#### 工作项

- 建立预期目录骨架：
  - `crates/mad-dom-core/`
  - `crates/mad-dom-bun/`
  - `js/`
  - `compat/public-api/`
  - `tests/rust/`、`tests/bun/`、`tests/compat/`、`tests/wpt/`
- 建立 Cargo workspace，并明确 crate 间只能由 `mad-dom-bun` 依赖 `mad-dom-core`，Core 不得依赖 Bun/JSC。
- 固定并记录用于开发和 CI 的 Bun、Rust toolchain 与支持平台；`package.json` 的 Bun 下限仍保持为公开运行时约束。
- 配置最小 CI：JavaScript/TypeScript 检查、Rust 格式检查、Clippy、Rust 测试、Bun 测试。
- 完成以下后续 ADR 或技术原型：
  1. happy-dom 首个兼容基线、上游 commit 与差分协议；
  2. Bun/JavaScriptCore 原生扩展机制及最小调用链；
  3. HTML、选择器和字符串存储的选型；
  4. 首批目标平台的本地构建方式。
- 为原生绑定原型验证以下最小链路：
  - JavaScript 调用 Rust 函数；
  - Rust 返回字符串、数字和结构化错误；
  - 原生对象可被 JavaScript GC 回收；
  - panic 被截获，不能越过 FFI 边界；
  - Bun 测试进程可稳定加载本地构建产物。

#### 交付物

- 根目录 `Cargo.toml`、两个 crate 的最小骨架和统一开发命令；
- 上述 ADR/原型结论；
- 可重复运行的 CI；
- 原生绑定 smoke test。

#### 完成标准

- 全新 checkout 可以通过一条有文档记录的命令完成构建和测试；
- Core crate 的依赖图不包含 Bun、JavaScriptCore 或 JavaScript 包装逻辑；
- 原生调用、错误返回和对象析构的 smoke test 在目标 Bun 版本通过。

### M1：兼容基线与测试骨架

#### 工作项

- 锁定明确的 happy-dom npm 版本和对应 Git commit，写入 `compat/happy-dom-baseline.json`；至少包含版本、commit、Bun 版本、生成时间和生成器版本。
- 建立公开 API 快照生成器，采集：
  - 包导出项；
  - 构造函数与原型链；
  - 自有属性名、symbol 和属性描述符；
  - 关键常量和可稳定序列化的默认值。
- 建立 TypeScript 双目标 fixture：同一份公开用法分别对 happy-dom 和 MAD DOM 执行类型检查。
- 建立黑盒差分 runner，使同一场景在隔离进程中分别加载 happy-dom 和 MAD DOM，并比较规范化结果。
- 定义统一的结果规范化格式，覆盖：
  - 原始值与结构化值；
  - DOM/HTML 快照；
  - 异常名称、稳定消息和抛出时机；
  - 属性描述符；
  - 对象身份关系；
  - 事件与异步任务顺序。
- 建立 `pass`、`known-gap`、`not-applicable` 兼容清单；每项使用稳定 ID，并要求 gap/不适用项填写原因。
- 建立 `compat/upstream-map.json`，记录移植或改写测试的上游路径、commit、许可证来源和本地测试 ID。
- 在 CI 中禁止已有 `pass` 项退化；允许新增 gap，但必须在 PR 中显式更新清单。

#### 交付物

- happy-dom 基线文件；
- 可重放的 API 快照、类型 fixture 和差分 runner；
- 初始兼容清单与机器可读汇总报告。

#### 完成标准

- 基线生成过程可重复，且不会依赖持续变化的上游 `main`；
- 故意制造的导出、描述符、类型、异常和对象身份差异均能被测试发现；
- CI 能显示通过数、已知缺口数、不适用数和相对上一版本的退化项。

### M2：Rust Core 内核

#### 工作项

##### `arena`

- 定义不透明 `NodeId { slot, generation }`，字段不向绑定层直接暴露；
- 实现槽位分配、读取、可变访问、删除、复用和 generation 校验；
- 对无效、已删除、跨文档或 generation 不匹配句柄返回结构化错误；
- 明确 arena 释放策略和容量观测接口，暂不提前引入复杂压缩。

##### `dom`

- 实现第一批节点类型：`Document`、`DocumentFragment`、`Element`、`Text`、`Comment`；
- 实现属性、父节点、首尾子节点和前后兄弟关系；
- 提供唯一的 mutation API：`append`、`insert_before`、`remove`、`replace`、文本与属性更新；
- 每次 mutation 原子维护以下不变量：
  - 父子关系双向一致；
  - 兄弟链一致且无环；
  - 节点只能属于一个文档；
  - 删除或迁移后旧句柄不能错误指向新节点；
  - 不允许把祖先插入其后代；
- 为 clone、adopt 和跨文档 import 预留显式 API，不允许直接复制 `NodeId`。

##### `error`

- 定义稳定的 Core 错误分类，例如无效句柄、层级错误、错误文档、无效字符、语法错误和索引越界；
- Core 的公共入口返回 `Result`；测试 panic 不代表可恢复输入错误。

##### 测试

- 单元测试覆盖槽位复用、generation 溢出策略、悬空句柄和所有 mutation 分支；
- 属性测试生成任意合法/非法变更序列，并在每一步检查树不变量；
- 增加深树、宽树、频繁插入删除和跨文档误用压力用例；
- 为后续 Miri/sanitizer 检查隔离并记录全部 `unsafe` 使用点。

#### 完成标准

- Core 可在不启动 Bun 的情况下独立构建和测试；
- 所有树修改只能经由统一 mutation API；
- 属性测试能稳定运行固定种子，并在失败时输出可重放操作序列；
- Core 不包含 JavaScript wrapper、GC handle 或运行时特定类型。

### M3：Bun/JavaScriptCore 原生绑定

#### 工作项

- 按 M0 ADR 选定的方案实现最小生产绑定，不把原型代码直接视为生产实现；
- 绑定对象只持有“文档所有权引用 + `NodeId`”，调用前验证 isolate、线程、文档和句柄有效性；
- 实现每文档弱引用 wrapper cache，保证同一 `NodeId` 重复访问时 JavaScript 对象身份稳定；
- `Window` 强拥有当前 `Document`；任何仍可达的节点 wrapper 都能使所属文档和 arena 保持存活；
- 把 Core 错误映射为稳定的 `TypeError`、`SyntaxError`、`DOMException` 或普通 `Error`；
- 在边界验证字符串、数字范围、索引和对象类型；
- 捕获 Rust panic，并转为不可恢复但受控的 JavaScript 错误；
- 加入线程/isolate 断言，第一阶段不提供跨线程共享；
- 将 FFI 与 `unsafe` 封装在少量模块中，并记录每个安全前提。

#### 必测场景

- wrapper 身份：`node.firstChild === node.firstChild`；
- GC 生命周期：释放 Window、Document 或部分节点引用时无 use-after-free；
- 删除并复用 arena 槽位后，旧 wrapper 不能访问新节点；
- 跨文档和跨 isolate 误用返回预期异常；
- Rust panic、无效 UTF-8/字符串输入和极端索引不会破坏 Bun 进程。

#### 完成标准

- 绑定层不实现树规则、解析规则或选择器规则；
- GC 压力测试下对象身份和文档生命周期稳定；
- 原生边界测试可由 Bun test runner 重复执行，无崩溃和悬空引用。

### M4：首个端到端 DOM 垂直切片

#### 范围

- `createWindow()`；
- `Window`、`Document`、`Node`、`Element`、`Text` 的最小构造与导航；
- `document.createElement()`、`document.createTextNode()`；
- `appendChild()`、`insertBefore()`、`removeChild()`、`replaceChild()`；
- `parentNode`、`firstChild`、`lastChild`、`previousSibling`、`nextSibling`、`childNodes`；
- `nodeType`、`nodeName`、`textContent`；
- 基础属性读写。

#### 工作项

- 在 `js/` 中实现 ESM facade，只做参数整形、原生入口调用和必要的 JavaScript 级协议适配；
- 从 `js/` 源生成或复制发布入口 `index.js` 和 `index.d.ts`，避免手工维护两份不一致实现；
- 依据 happy-dom 基线校准构造方式、原型链、属性描述符、可枚举性和异常时机；
- 为 `NodeList` 先实现正确的 live 行为，再根据基准决定缓存或索引；
- 将本切片的全部场景加入 Core、Bun 集成和差分测试。

#### 完成标准

- 用户可以在 Bun 中创建窗口、构建和修改一棵基础 DOM 树；
- JavaScript 可观察到的树结构与 Rust arena 中唯一状态一致；
- 本切片兼容清单中不存在未解释的跳过项；
- 包入口、类型声明和运行时行为同步发布。

### M5：HTML 解析与序列化

#### 工作项

- 按选型 ADR 实现 `html` 模块，解析时直接写入目标文档 arena，不建立长期存在的第二棵树；
- 支持文档解析和 fragment parsing，并正确处理上下文元素；
- 实现 `serialize` 模块，覆盖 Document、Fragment、Element、Text、Comment 和属性转义；
- 接入 `innerHTML`、`outerHTML`、`documentElement`、`head`、`body` 等首批 HTML API；
- 固定解析与序列化测试 corpus，覆盖畸形标记、实体、Raw Text/RCDATA、模板和命名空间边界；
- 建立 parse → serialize 与 serialize → parse 往返测试，但以 happy-dom 可观察结果而非字节完全一致作为最终兼容判断；
- 为大文档、深层嵌套和重复属性输入建立基准及资源上限测试。

#### 完成标准

- 解析器和序列化器仅操作统一 DOM 模型；
- 常见 HTML 文档和 fragment 可通过 JS API 端到端解析、修改并序列化；
- 所有已纳入清单的解析差异均有 `pass` 或明确的 `known-gap` 状态。

### M6：选择器与查询 API

#### 工作项

- 按选型 ADR 实现选择器解析与匹配，选择器 AST 不依赖 JavaScriptCore 类型；
- 首批支持 `querySelector`、`querySelectorAll`、`matches`、`closest`、`getElementById`、`getElementsByTagName` 和 `getElementsByClassName`；
- 校准静态 `NodeList` 与 live collection 的差异、迭代协议和对象身份；
- 选择器语法错误通过结构化错误映射为兼容异常；
- 正确性稳定后，以基准决定是否增加 id/class/tag 索引；索引只能由统一 mutation API 更新；
- 使用固定用例、生成式 DOM/选择器组合和 happy-dom 差分测试验证。

#### 完成标准

- 查询 API 在树变更前后保持规定的静态或 live 语义；
- 无论是否启用索引，结果顺序和异常行为一致；
- mutation 属性测试同时验证所有已启用索引与树状态一致。

### M7：基础 DOM API 扩展

按兼容清单而不是按源码目录扩展能力，每一批都必须同时包含 Core、绑定、facade、类型和测试。

建议顺序：

1. `CharacterData`、`DocumentType`、`ProcessingInstruction` 与节点克隆/导入/收养；
2. `DOMTokenList`、`classList`、`NamedNodeMap`、`Attr`；
3. `TreeWalker`、`NodeIterator`、`Range`、`Selection`；
4. `EventTarget`、事件传播、监听器选项和常用事件类；
5. HTMLElement 基类、常见 HTML 元素、表单和模板相关行为；
6. MutationObserver 与 microtask 交付顺序。

每批能力的完成标准：

- API 快照、类型 fixture 和行为差分均接入；
- 对象身份、属性描述符、live collection 和异常时机有专门测试；
- 新增异步行为时，明确由 Bun 调度的任务/microtask 边界，且用事件序列测试固定；
- 不把未实现行为用静默空操作伪装为成功。

### M8：happy-dom 能力波次

基础 DOM 稳定后，依据基线清单中的依赖关系分波次实现：

1. Custom Elements 与 Shadow DOM；
2. CSSOM、style、媒体查询和样式相关可观察 API；
3. URL、Location、History、Navigator 与 Storage；
4. Fetch、Request、Response、Headers、Cookie 等网络表面；
5. Window 定时器、异步任务、脚本执行及 Bun 测试环境集成；
6. 其余由锁定 happy-dom 版本公开导出的能力。

#### 波次规则

- 每个波次先从基线清单生成范围和依赖 DAG，再拆分垂直切片；
- 能复用 Bun/Web 标准实现时，仍需以锁定 happy-dom 的可观察行为做兼容门禁；
- happy-dom 与 Web 标准冲突时，不得未经记录改变既有兼容结果；如需双模式，先新增 ADR；
- WPT 单独统计，只用于补充 happy-dom 未覆盖或行为不明确的部分；
- 每完成一个波次，公布分能力通过率、剩余 gap 和性能/内存基准变化。

### M9：构建、发布与稳定化

#### 工作项

- 通过独立 ADR 确定目标平台矩阵、二进制包拆分、加载策略、签名和 npm 发布方式；
- 建立各平台原生产物的可重复构建、校验和与 smoke test；
- 增加安装后验证，确保不依赖开发机 Cargo 环境；
- 在 CI 中运行：
  - Rust 单元/属性测试；
  - Bun 集成与 GC 压力测试；
  - happy-dom API、类型和差分套件；
  - WPT 子集；
  - Miri、sanitizer 或目标平台可用的等价检查；
  - 性能与内存回归基准；
- 建立 alpha、beta、stable 的发布清单和失败回滚方式；
- 更新 README、支持矩阵、兼容率报告、已知限制和许可证/上游署名。

#### 发布门禁

| 阶段 | 门禁 |
| --- | --- |
| pre-alpha | 架构和绑定原型可运行；允许大量明确记录的缺口 |
| alpha | 基础 DOM 垂直切片稳定；持续公布兼容率；已有 pass 不得退化 |
| beta | 目标 happy-dom 能力波次基本完成；无已知崩溃、悬空引用或数据损坏问题 |
| stable | 锁定基线的公开兼容套件 100% 通过；无跳过、预期失败或未解释 gap；全部目标平台通过发布验证 |

## 5. 持续质量门禁

所有实现 PR 均应满足：

- 新增公开行为必须附带稳定测试 ID；
- Rust Core 行为有单元测试，跨层行为有 Bun 集成测试，兼容行为有差分测试；
- `unsafe` 或 FFI 变更必须说明安全前提并增加失败路径测试；
- 不得新增由 JavaScript 保存的第二份 DOM 权威状态；
- 不得绕开 mutation API 直接修改树关系或查询索引；
- 不得让已有 `pass` 项退化为 gap；确需基线升级时使用独立提交并恢复全套通过；
- TypeScript 声明与同一 PR 中的运行时导出保持一致；
- 新依赖需说明其运行时边界、许可证、维护状态和是否进入原生产物。

## 6. 基准与可观测指标

从 M2 开始保存基线，不以单次绝对速度作为合并门禁，先防止明显退化。

至少跟踪：

- arena 分配、删除和槽位复用吞吐；
- 每节点平均内存、删除后的保留容量和字符串占用；
- append/insert/remove、属性变更和跨文档操作耗时；
- HTML 解析与序列化吞吐及峰值内存；
- 常用选择器冷/热查询耗时；
- JS ↔ Rust 单次调用成本与批量操作成本；
- wrapper cache 命中率、GC 后释放数量和长时间运行内存曲线；
- happy-dom 兼容用例总数、通过率、gap 数和退化数。

索引、字符串驻留、arena 压缩或批量 FFI API 必须由这些数据驱动，并在改变架构约束时新增 ADR。

## 7. 主要风险与缓解措施

| 风险 | 缓解措施 |
| --- | --- |
| Bun/JSC 扩展机制不稳定或能力不足 | M0 先做最小调用、GC、异常和发布原型；绑定方案确认后再扩大 Core API 暴露面 |
| wrapper cache 或文档所有权导致泄漏/use-after-free | 将身份与 GC 压力测试作为 M3 门禁；使用代际句柄和文档强所有权，不暴露裸指针 |
| happy-dom 范围持续变化 | 锁定 npm 版本与 commit；升级基线走独立提交和完整回归 |
| 兼容测试耦合上游内部实现 | 只使用公开 API 做黑盒测试；移植用例保留来源映射并移除私有依赖 |
| live collection 和索引在 mutation 后失效 | 所有更新集中到 mutation API；属性测试联合检查树和索引不变量 |
| 解析器/选择器库要求不同 DOM 模型 | 在选型原型中验证可直接写入/读取统一 arena；不接受长期镜像树方案 |
| FFI 调用过细抵消原生性能收益 | 先测量跨边界成本，再为热点增加批量查询/变更 API，且保持业务规则仍在 Core |
| 跨平台原生发布拖慢核心开发 | 核心和绑定先以开发平台验证；平台矩阵和拆包通过独立 ADR 后进入 M9 |

## 8. 建议的首批 issue / TODO 拆分

本地 `todos/README.md` 是调度真相源；Issue（若建立）只镜像下表，不承载另一套依赖或状态。每个带后缀条目对应一个独立 worktree/commit；不带后缀的 T21–T25 是串行集成闸门，负责共享入口和兼容清单。

```text
T20 (done)
 └─ T20A seam
    ├─ T21A error taxonomy ─┐
    └─ T21B affinity guard ─┴─> T21 gate
                                  └─> T22A native Window/Document
                                        └─> T22B JS facade ─> T22 gate
                                              └─> T23A native node contract
                                                    └─> T23B facade node ─> T23 gate
                                                          ├─ T24A append/insert ─┐
                                                          └─ T24B remove/replace ─┴─> T24C facade mutation ─> T24 gate
                                                                                       ├─ T25A Core payload seam ─┬─ T25B attributes ─┐
                                                                                       │                          └─ T25C textContent ─┤
                                                                                       └─ T25D live childNodes ──────────────────────────┤
                                                                                                                                           └─> T25E binding/facade ─> T25 gate
```

首批并发窗口为 `T21A || T21B`（最多 2 个）；之后 `T24A || T24B`、`T25A || T25D`、以及 T25A 完成后的 `T25B || T25C` 可在各自 contract 冻结后并发。每个窗口最多 5 个任务，完成一个任务后才按依赖补位。共享 `handle.rs`、`lib.rs`、`api.rs`、根 `index.*`、`todos/README.md`、compat ledger 和既有集成 fixture 只能由对应集成闸门串行修改。

完成 T25 闸门后，T26（HTML parser）、T30（selector）和 T37（event target）可作为下一组候选；T26 完成后 T27/T28 可并发。其余能力继续按 `todos/README.md` 的依赖图调度。

## 9. ADR-0001 完成定义

只有同时满足以下条件，才能认为 ADR-0001 的基础架构已经落实，而不是仅完成目录搭建：

- DOM 权威状态只存在于 Rust arena；
- Core 可以脱离 Bun 独立测试；
- JavaScript wrapper 使用文档所有权引用和代际 `NodeId`，且身份稳定；
- panic、输入错误和悬空句柄均不能越过安全边界造成未定义行为；
- 解析、选择器和序列化共享同一 DOM 模型；
- 基础 DOM 能力已形成至少一个 Bun 端到端垂直切片；
- happy-dom 基线、兼容清单和差分测试成为 CI 门禁；
- 后续能力可以按清单持续扩展，而无需破坏三层边界或重建第二份 DOM 状态。
