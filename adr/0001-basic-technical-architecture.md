# ADR-0001：基础技术架构

- 状态：已接受（第 1、3 节由 [ADR-0007](./0007-facade-native-boundary-performance.md) 修订）
- 日期：2026-08-27

## 背景

MAD DOM 的目标是在 Bun 中提供一个原生、高性能、可保留状态的 DOM 实现，并成为 happy-dom 在 Bun 中的原生替代实现。项目当前处于 pre-alpha 阶段，仅建立了 npm 包、ESM 入口和类型声明，尚未实现 DOM 行为。

首个阶段需要先固定模块边界、所有权和运行时约束，避免 JavaScript API、原生绑定与 DOM 存储互相耦合。具体的解析器、绑定方案和发布工具仍可以通过后续 ADR 独立选择。

## 决策

### 1. 总体分层

系统分为三层：

```text
JavaScript / TypeScript API
          │
          ▼
Bun / JavaScriptCore 原生绑定
          │
          ▼
Rust DOM Core
  ├─ HTML Parser
  ├─ Arena-backed DOM Tree
  ├─ Selector Engine
  └─ Serializer
```

- **JavaScript / TypeScript API** 提供面向使用者的 `Window`、`Document`、`Node`、`Element` 等对象，以及包入口和类型声明。
- **原生绑定层** 只负责值转换、对象包装、异常映射、GC 生命周期衔接和对象身份缓存，不承载 DOM 业务逻辑。
- **Rust DOM Core** 负责解析、树结构、属性、节点变更、选择器匹配和序列化；核心层不依赖 Bun 或 JavaScriptCore，因此可以独立测试。

DOM 权威状态只在 Rust Core 中保存，不在 JavaScript 侧维护第二份镜像树。Facade
可以保存由 Core 代际验证的派生缓存，边界见 ADR-0007。

### 2. 运行时和语言

- 第一阶段只支持 Bun，不以 Node.js 或浏览器运行时兼容为目标。
- DOM Core 使用 Rust，并以 Cargo workspace 组织。
- 对外包保持 ESM 接口，并提供随实现同步维护的 TypeScript 声明。
- Bun/JavaScriptCore 的具体原生扩展机制由后续 ADR 在原型验证后确定；无论采用何种机制，都必须保持绑定层轻薄且不泄漏 Rust 裸指针。

### 3. DOM 存储与节点句柄

每个 `Document` 拥有一个独立的内存 arena。节点通过不透明的代际句柄访问：

```text
NodeId = { slot, generation }
```

- `slot` 定位 arena 中的槽位。
- 节点删除并复用槽位时递增 `generation`，从而识别悬空句柄。
- 父节点、子节点和兄弟节点关系均保存为句柄，不保存跨 FFI 的裸指针。
- 所有树变更必须通过统一的 mutation API 完成，并在一次操作内维护父子关系、文档归属和索引等不变量。
- JavaScript 节点包装对象保存“文档所有权引用 + 原生 `NodeHandle`”，或 ADR-0007
  定义的文档作用域不透明令牌；Core `NodeId` 不以原始值跨边界。只要包装对象仍
  可达，其所属文档及 arena 就必须保持存活。
- 同一文档、同一 `NodeId` 应返回稳定的 JavaScript 对象身份；绑定层弱引用缓存与
  facade 的令牌身份表共同维持该不变量（ADR-0007）。
- 跨文档移动、克隆和收养节点必须通过显式操作完成，不能直接复用另一个 arena 的句柄。

### 4. 核心模块边界

Rust Core 初步拆分为以下模块：

| 模块 | 职责 |
| --- | --- |
| `arena` | 槽位分配、代际句柄、删除和有效性检查 |
| `dom` | 节点类型、属性、树关系、文档所有权和变更不变量 |
| `html` | 将 HTML 输入解析并直接写入 DOM arena |
| `selectors` | 解析选择器并在 arena 上执行匹配和查询 |
| `serialize` | 将节点或文档序列化为 HTML |
| `error` | Core 内部的结构化错误类型 |

解析器、选择器和序列化器直接操作统一的 DOM 模型，不各自建立中间树或长期缓存副本。

### 5. 所有权、并发与安全边界

- `Window` 拥有当前 `Document`；`Document` 拥有 arena；节点本身不拥有 JavaScript 运行时对象。
- 一个文档及其包装对象限定在创建它们的 Bun/JavaScriptCore isolate 和线程中使用。
- 第一阶段不为 DOM 读写引入内部锁。若未来需要后台解析或跨线程访问，必须通过新的 ADR 定义数据转移、取消和同步模型。
- Rust panic 不得穿过原生边界。Core 返回结构化 `Result`，绑定层将错误转换为对应的 `TypeError`、`SyntaxError`、`DOMException` 或普通 `Error`。
- 所有来自 JavaScript 的字符串、索引和句柄都必须在原生边界或 Core API 中验证。

### 6. happy-dom 兼容策略

MAD DOM 的最终兼容目标是：在相同 Bun 版本和相同输入条件下，对一个锁定版本的 happy-dom 实现 **100% 的公开 API 与可观察行为兼容**。

“100% 兼容”具体包含：

- happy-dom 公共入口导出的运行时值、类、函数、常量和 TypeScript 类型；
- 构造方式、原型链、属性描述符、对象身份、live collection 和迭代行为；
- DOM 变更、HTML/XML 解析、选择器、序列化、事件顺序和异步任务结果；
- Custom Elements、Shadow DOM、CSSOM、Storage、Fetch 等 happy-dom 已公开提供的浏览器环境能力；
- 异常类型、异常时机和稳定的错误信息；
- happy-dom 使用者在 Bun 测试环境中可以观察到的其他行为。

以下内容不属于兼容承诺：

- happy-dom 的内部目录结构、私有符号和未公开的深层导入；
- 源码实现方式、内部数据结构和性能特征；
- 堆栈中的源码路径、进程调度抖动等由宿主运行时产生且无法稳定复现的值。

兼容基线必须锁定到一个明确的 happy-dom npm 版本和对应的上游 Git commit，并记录在仓库的兼容清单中。不能把持续变化的 `main` 分支作为发布门禁。升级基线需要单独提交，并在合并前恢复全部兼容测试通过。

若 happy-dom 的可观察行为与 Web 标准存在差异，happy-dom 兼容模式以锁定版本的实际行为为准。Web Platform Tests 用于补充 happy-dom 未覆盖或行为不明确的部分，不能静默改变已经建立的兼容契约。

实现仍按可验证的垂直切片推进。alpha 阶段可以存在公开记录的兼容缺口，但不得宣称 100% 兼容；首个稳定兼容版本必须满足完整发布门禁。

### 7. 测试策略

- Rust 单元测试覆盖 arena 分配/复用、悬空句柄检测和树变更不变量。
- Rust 属性测试覆盖任意变更序列下的树一致性。
- 解析、选择器和序列化使用固定用例及往返测试。
- **公开 API 快照测试**：从锁定版本的 happy-dom 生成导出项、原型链、属性名和属性描述符清单，并与 MAD DOM 比较。
- **类型兼容测试**：同一组 TypeScript fixture 分别使用 happy-dom 和 MAD DOM 类型检查；MAD DOM 不得拒绝 happy-dom 能接受的公开用法。
- **上游用例移植**：在 MIT 许可和署名要求下，移植或改写 happy-dom 中只依赖公开 API 的测试，并保留上游文件与 commit 的来源映射。直接引用 happy-dom 内部源码或私有符号的测试不原样复用。
- **黑盒差分测试**：同一测试场景分别在锁定的 happy-dom 和 MAD DOM 中运行，比较规范化后的返回值、DOM 快照、序列化结果、异常、属性描述符和事件顺序。
- **生成式差分测试**：对 DOM 变更、属性、选择器和解析输入使用固定随机种子生成操作序列；发现差异后保存最小复现用例。
- **Bun 集成测试**：覆盖对象身份、GC 生命周期、异常映射、异步行为以及与 Bun 测试运行器的集成。
- **Web Platform Tests**：作为 happy-dom 测试以外的补充标准套件，并单独统计，不与 happy-dom 兼容率混为一个指标。
- 原生边界和 unsafe 代码保持最小化，并在 CI 中加入适用的 sanitizer、Miri 或等价内存安全检查。

兼容测试清单中的每个用例都必须有稳定标识，并记录 `pass`、`known-gap` 或 `not-applicable` 状态及原因。普通 PR 不得让已有通过项退化。alpha 阶段持续公布通过率；首个稳定兼容版本要求 happy-dom 公共兼容套件达到 100%，且不存在跳过项或预期失败项。

### 8. 预期目录结构

在进入实现阶段后，仓库按以下方向演进：

```text
mad-dom/
├─ adr/
├─ crates/
│  ├─ mad-dom-core/       # 与运行时无关的 Rust DOM Core
│  └─ mad-dom-bun/        # Bun / JavaScriptCore 原生绑定
├─ js/                    # JavaScript facade 与类型声明源码
├─ compat/
│  ├─ happy-dom-baseline.json
│  ├─ public-api/         # 导出、原型和类型契约快照
│  └─ upstream-map.json   # 移植用例与上游来源映射
├─ tests/
│  ├─ rust/
│  ├─ bun/
│  ├─ compat/             # happy-dom 黑盒与差分测试
│  └─ wpt/
├─ index.js               # npm 包公开入口或构建产物
├─ index.d.ts
├─ Cargo.toml
└─ package.json
```

实际发布时的原生二进制拆包和平台命名方案不在本 ADR 中决定。

## 非目标

第一阶段不包含：

- 图形界面、CSS 布局、绘制和真实浏览器渲染；
- 浏览器级进程隔离、安全沙箱或开发者工具；
- 对 happy-dom 私有模块、内部符号和内部数据结构的兼容；
- 在 Node.js 运行时中执行 MAD DOM；兼容性只在声明支持的 Bun 版本中保证；
- 锁定的 happy-dom 基线尚未提供的浏览器能力；
- 任意线程之间共享可变 DOM。

网络、脚本、Web Components、Shadow DOM 和事件循环等能力，只需实现 happy-dom 公共 API 所产生的可观察契约，不以构建完整浏览器为目标。

## 影响

### 正面影响

- DOM 只保留一份原生状态，减少 JS/native 之间的复制和同步成本。
- 代际句柄比跨边界裸指针更容易检测生命周期错误。
- Core 与 Bun 绑定分离，可独立进行高覆盖率测试，也为未来替换绑定机制保留空间。
- 单文档单线程模型使早期实现更简单，并减少锁和竞态问题。
- 锁定基线和差分测试使“兼容”成为可以持续度量的发布条件，而不是主观判断。

### 代价与风险

- 原生模块的跨平台构建、签名和 npm 分发比纯 JavaScript 包复杂。
- JavaScript 对象身份、GC 与 Rust 所有权的衔接是主要实现风险，需要专门的压力测试。
- happy-dom 的公开能力远超基础 DOM；100% 兼容会显著扩大实现范围和长期维护成本。
- 为兼容锁定版本，MAD DOM 可能需要暂时保留 happy-dom 与 Web 标准不一致的行为。
- 上游测试包含大量与其内部实现耦合的用例，需要维护独立的公开契约测试和来源映射。
- arena 对频繁删除后的内存回收、碎片和字符串驻留策略仍需基准测试验证。

## 后续决策

以下主题需要单独的 ADR 或技术原型：

1. 首个 happy-dom 兼容基线、公开 API 清单和差分测试协议；
2. Bun/JavaScriptCore 原生绑定技术及最小可行调用链；
3. HTML 解析器、选择器解析器和字符串存储方案；
4. 原生二进制的构建、平台矩阵和 npm 发布方式；
5. arena 回收、属性存储和查询索引的性能基线。

## 参考资料

- [happy-dom 官方仓库](https://github.com/capricorn86/happy-dom)
- [happy-dom 测试目录](https://github.com/capricorn86/happy-dom/tree/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/packages/happy-dom/test)
- [happy-dom MIT License](https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE)
