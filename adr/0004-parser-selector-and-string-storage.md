# ADR-0004：HTML 解析器、选择器引擎与字符串存储选型（基于 T05 原型）

- 状态：已接受
- 日期：2026-08-28

## 背景

[ADR-0001](./0001-basic-technical-architecture.md) 第 3 节固定了"每个 Document 拥有独立 arena + 代际句柄"的存储模型，第 4 节把 HTML 解析与选择器列为 Core 模块。[实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 的 M0 工作项要求通过小型技术原型验证三件事：

1. 候选 HTML parser 能把解析结果直接写入统一 arena，并支持 document / fragment + 上下文元素；
2. 候选选择器方案能在 NodeId/arena 上匹配，不要求长期镜像树；
3. owned string 与 interning 等字符串方案的 API、内存与迁移成本对比。

[T05](../todos/05-parser-selector-string-adr.md) 落地了隔离原型 [spikes/parser-selector-string/](../spikes/parser-selector-string/src/lib.rs)（[store](../spikes/parser-selector-string/src/store.rs) / [parse](../spikes/parser-selector-string/src/parse.rs) / [selector](../spikes/parser-selector-string/src/selector.rs) / [strings](../spikes/parser-selector-string/src/strings.rs) 四个模块），13 个单元测试全部通过（`npm run spike2:test`）。本 ADR 记录候选对比、决策、许可证兼容性与优化边界。原型与 [ADR-0003](./0003-native-binding-spike.md) 的 T04 原型一样通过根 [Cargo.toml](../Cargo.toml) 的 `workspace.exclude` 隔离。

## 候选方案对比

### 解析器

#### 方案 A：html5ever（servo，0.39.0，选定）

经 `TreeSink` trait 把 token 流逐节点写入自定义存储。原型使用的版本：`html5ever 0.39.0` + `markup5ever 0.39.0` + `tendril 0.5.1`（依赖锁定在 [spikes/parser-selector-string/Cargo.lock](../spikes/parser-selector-string/Cargo.lock)）。

- **输入边界**：UTF-8 文本（`&str` 经 `TendrilSink::one` 一次性送入；增量输入走 `feed`）。字节输入需先做编码探测，原型未覆盖（生产 [T26](../todos/26-html-document-parser.md) 决定，html5ever 自带 encoding 路径可用）。
- **错误模型**：`parse_error` 只上报非致命消息（原型收集到 `Vec<String>`），树照常建立——HTML5 规范的错误恢复语义；quirks mode 经 `set_quirks_mode` 上报。实测 `</div><p>unclosed` 产生错误且树结构不变量保持完好。
- **namespace 能力**：元素与属性名都是 `QualName { ns, local }`；实测 `<svg><circle/></svg>` 的子树落在 SVG namespace，`<template>` contents、MathML annotation-xml integration point 等标志经 `ElementFlags` 原样获得。
- **许可证**：html5ever / markup5ever / tendril 均为 MIT OR Apache-2.0，与本仓库 MIT 直接兼容。
- **替换成本**：中到高。`TreeSink` 是清晰的 trait 边界，替换解析器只需重写 sink 一侧；但 Rust 生态内没有第二个完整实现 HTML5 解析算法的候选，且 HTML5 合规（WPT）是最大隐性成本，自写解析器不可行。

#### 方案 B：lol_html / 流式改写器（Cloudflare）

面向流式改写而非树构建：不维护树结构、无法支持 DOM 导航与 innerHTML 语义，与本项目目标（完整 DOM）不符。排除。

#### 方案 C：自写 HTML5 tokenizer/tree builder

需要复现规范中数百条错误恢复规则与 WPT 用例，成本与合规风险远超集成成本。排除。

### 选择器引擎

#### 方案 A：selectors + cssparser（servo/stylo，0.40.0 + 0.37.0，选定）

匹配通过 `Element` trait dispatch 到任意树结构，不要求镜像树。原型以 [SpikeElement](../spikes/parser-selector-string/src/selector.rs)（借用 `SpikeTree` + 槽位下标）实现该 trait，实测 tag/class/id/组合器/namespace 选择器全部在 spike 存储上匹配成功。

- **输入边界**：选择器字符串 `&str`（cssparser `ParserInput`/`Parser` 解析）；匹配输入是实现 `Element` trait 的元素视图（零分配借用视图）。
- **错误模型**：cssparser 返回结构化 `ParseError { kind, location }`（含行/列 `SourceLocation`）；`selectors` 定义 `SelectorParseError` 错误种类。原型映射为 String 仅是简化，生产 [T30](../todos/30-selector-parser-and-matcher.md) 需保留结构化形状（对齐 Core 错误模型）。
- **namespace 能力**：`Parser::default_namespace`（无前缀类型选择器默认限定 HTML namespace）与 `namespace_for_prefix`（原型内置 svg/mathml 前缀）；`NamespaceConstraint::Specific/Any` 与存储中的 `QualName` 对接，实测 `svg|circle` 命中、无前缀 `circle` 未命中、`*|circle` 命中。
- **许可证**：selectors 0.40.0 与 cssparser 0.37.0 均为 MPL-2.0（依赖 `precomputed-hash 0.1.1` 为 MIT）；兼容使用方式见下文专节。
- **替换成本**：高。selectors-4 语义面庞大（右端优先匹配、组合器、缓存与 invalidation、bloom filter、`:has()` 支持矩阵），自写引擎的长期成本远高于集成成本；若必须替换，替换点是 `SelectorImpl` 与 `Element` 两个 trait 边界。

#### 方案 B：自写选择器引擎

selectors-4 的完整语义（伪类矩阵、`::has` 相对选择器、大小写规则）需要长期跟进，初期原型到生产的时间不允许。排除。

#### 方案 C：复用 happy-dom / other JS 引擎的 CSS 实现

跨语言边界与 Core 单一 Rust 实现的目标冲突（[ADR-0001](./0001-basic-technical-architecture.md) 第 2 节）。排除。

### 字符串存储

#### 方案 A：owned `String`（选定基线）

槽位各字段（文本、注释、属性值、doctype 等）直接持有 `String`（[store.rs](../spikes/parser-selector-string/src/store.rs)），零间接层、零共享状态。

- **输入边界**：一切字符串都以 `&str` 进入存储，存储侧 `to_owned()`。
- **错误模型**：不涉及解析错误；分配失败即 abort 的默认策略（与 arena 一致）。
- **namespace 能力**：不适用（名字结构由 `QualName` 承载，与字符串存储方案正交）。
- **许可证**：自有代码，无第三方约束。
- **替换成本**：中。改为 interning 需要把所有字符串字段改为句柄类型并引入 intern 表，读写 API 全面改为借用；改为 `Rc<str>`/`Box<str>` 改动更小但收益有限（见方案 C）。

#### 方案 B：interning（去重驻留表，暂缓）

原型实现 [SpikeInterner](../spikes/parser-selector-string/src/strings.rs)（`Vec` 本体 + `HashMap` 去重索引）并与 owned 基线对比：重复语料（2000 元素 × 3 引用，仅 13 个唯一字符串）下 interning 内存显著更低；全唯一语料（2000 个互不相同的字符串）下 interning 反而更贵（索引开销叠加）。结论：**收益完全取决于语料重复率**，作为默认方案不成立，作为优化项保留（启用条件见决策第 4 条）。

- **API/迁移成本**：所有字符串字段改 `StrId` 句柄；intern 表生命周期必须与 arena 绑定（每文档一张，避免跨文档泄漏）；读侧从 `&String` 改为 `&str` 借用。
- **许可证**：自有代码。
- **替换成本**：中（同方案 A 的迁移面，但可在生产 API 稳定后局部实施）。

#### 方案 C：`Rc<str>` / `Box<str>` 共享

无去重索引（相同内容仍多份），只是把分配从 `String` 缓冲换成更小的指针形态；与 interning 相比省不了重复内容的内存。排除。

## 决策

1. **解析器：html5ever 0.39**，经 `TreeSink` 把解析结果直接写入统一 arena，document 与 fragment + 上下文元素两条路径均验证通过。
2. **选择器：selectors 0.40 + cssparser 0.37**，通过 `Element` trait 在 arena 槽位上匹配，不建镜像树。
3. **字符串：owned `String` 起步**；interning 作为受限优化暂缓，必须满足下述启用条件并附基准证据后才可实施。
4. **interning 启用条件（全部满足才允许实施）**：
   - 差分基准显示解析吞吐或内存不达标（相对基线目标）；
   - 真实语料（html5ever 测试语料 / WPT 片段）剖析显示唯一字符串字节占全部字符串字节的比例低于阈值（原型证据表明阈值语义可行，生产阈值由剖析数据定，建议 ≤ 50% 才考虑）；
   - 实施前后必须提交基准对比，指标至少包括：解析吞吐（MB/s，document 与 fragment 两路径）、每文档分配次数与字节数、常驻内存、`querySelectorAll` 延迟（P50/P95）、intern 表自身的内存与查找开销。
5. **暂缓优化清单**（原型留了接口但未实施，生产实现前不得顺手引入）：
   - interning（见第 4 条）；
   - bloom filter 快速拒绝（`Element::add_element_unique_hashes` 原型恒返回 false）；
   - `SelectorCaches` 跨查询复用与 query index（当前每次查询新建缓存）；
   - 文本节点子串引用 / CoW；
   - 槽位复用与回收（属 [T12](../todos/12-generational-arena.md)/[T13](../todos/13-core-errors-and-node-model.md) 的代际 arena 职责，原型句柄是裸下标）。

### "不维护第二棵长期 DOM"的论证

这是本 ADR 的核心验收约束，三个选型分别满足：

- **解析器**：`TreeSink` 的每个 `create_element`/`append`/`append_before_sibling` 调用都直接落在统一存储的槽位上（[parse.rs](../spikes/parser-selector-string/src/parse.rs)），解析结束即最终树，中途不存在 html5ever 自有 DOM 或转换拷贝。fragment 解析按 WHATWG 算法在存储内新建合成 `<html>` 根，解析完成后把根的子节点移交给上下文元素并摘除合成根——全程同一棵树，只多一个待回收槽位（原型不做槽位回收）。
- **选择器**：匹配经 `Element` trait 进入临时元素视图（借用 + 槽位下标，Clone 零分配），匹配结束视图即消失；任何时刻存储里没有为选择器服务的持久节点数据或第二棵树。`SelectorCaches` 是查询级临时对象，不引用节点。
- **字符串**：owned 方案的字符串就住在节点槽位里，天然无镜像；interning 若启用也是存储内索引，不是第二棵结构。

## MPL-2.0 许可证与仓库 MIT 的兼容使用

- 经依赖 `Cargo.toml` 核实：**selectors 0.40.0 与 cssparser 0.37.0 的许可证为 MPL-2.0**；html5ever / markup5ever / tendril 为 MIT OR Apache-2.0；precomputed-hash 为 MIT。
- MPL-2.0 是文件级弱 copyleft：以第三方依赖身份经 cargo 正常引入、以动态或静态链接方式使用、**不修改其源码**时，MPL 义务不扩散到使用方代码——只有当修改 MPL 覆盖的源文件时，才需要按 MPL-2.0 第 3 节公开那些文件的修改。本仓库为 MIT，MPL-2.0 与 MIT 单向兼容（MPL 代码可进入 MIT 项目，仅其自身文件保持 MPL 边界），兼容使用方式即：**作为依赖链接使用，不 fork、不修改 selectors/cssparser 源码**。
- 仓库策略：
  1. 所有适配代码（`SelectorImpl` 关联类型、`Element` trait 实现、newtype 与 `ToCss` 实现等）全部写在本仓库自己的文件里（生产位于 [crates/mad-dom-core](../crates/mad-dom-core/Cargo.toml) 的 selectors 模块），不向上游提交补丁也不在本地 patch 依赖；
  2. 升级 selectors/cssparser 走独立提交，复查许可证是否变化；
  3. 注意 cssparser 0.37 不再为 `String`/`str` 提供 `ToCss`，`SelectorImpl` 的标识类型必须自行 newtype（原型为 `SpikeIdent`/`SpikeNamespace`/`SpikeAttrValue`），升级时需复核该 impl 面。

## 原型与生产边界

- [spikes/parser-selector-string/](../spikes/parser-selector-string/src/lib.rs) 通过根 [Cargo.toml](../Cargo.toml) 的 `workspace.exclude` 隔离（同 [ADR-0003](./0003-native-binding-spike.md) 的模式），由 `npm run spike2:build` / `npm run spike2:test` 构建、测试（定义在 [package.json](../package.json)）。
- **生产实现位于 crates/mad-dom-core 的 `html` 与 `selectors` 模块**（[T26](../todos/26-html-document-parser.md)/[T27](../todos/27-html-fragment-parser.md) 解析、[T28](../todos/28-html-serializer.md) 序列化、[T30](../todos/30-selector-parser-and-matcher.md)/[T31](../todos/31-query-apis.md) 选择器与查询），全部在生产约束下重新实现；从原型迁移的只有**模式**：TreeSink 直写、`RefCell` 内部可变性（html5ever 0.39 的 `TreeSink` 方法全部 `&self`）、`ElemName` 关联类型的 owned clone 策略、fragment 合成根移交、`Element` trait 视图、错误收集形态。spike 代码不直接复制进生产 crate。
- 生产 arena 按 [ADR-0001](./0001-basic-technical-architecture.md) 第 3 节实现 `NodeId { slot, generation }`（[T12](../todos/12-generational-arena.md)），原型 `Handle` 是裸下标，不具备悬空检测。
- 原型刻意缺席：代际句柄与槽位回收、`:hover` 等 non-TS 伪类、伪元素、`:has()`、bloom filter、query index、字符串 interning（仅对比验证）、live query（[T32](../todos/32-live-query-collections.md)）。

## 验证结果

实测环境：aarch64 Linux，Rust 1.93.1（[rust-toolchain.toml](../rust-toolchain.toml) 固定），html5ever 0.39.0 / selectors 0.40.0 / cssparser 0.37.0。测试 13 个（parse 5 + selector 6 + strings 2），`npm run spike2:test` 全部通过（13 passed / 0 failed）。

| 验证点 | 实测结论 |
| --- | --- |
| document 解析直写统一存储 | 通过：doctype/html/head/body 树形、实体展开（`T&amp;S` → `T&S`）、相邻文本合并、属性、quirks mode、错误收集全部正确；namespace 实测 svg 子树在 SVG namespace |
| fragment + 上下文元素 | 通过：div 上下文中 p/b 成为上下文元素子节点；tr 上下文中 td 不被"修复"掉；不产生第二个文档子树 |
| 解析错误模型 | 通过：`</div><p>unclosed` 收集到 parse error，树照常建立，父子指针不变量完好 |
| template contents | 通过：`<template>` 元素自身无子节点，内容落在独立 fragment 槽位 |
| 选择器命中/未命中 | 通过：tag/class/id/通配/后代/子组合器、右端优先语义、`querySelectorAll` 文档序、结构化解析错误（语法错误/未知前缀/未知伪类返回 Err） |
| namespace 选择器 | 通过：`svg|circle`/`*|circle` 命中、无前缀 `circle` 未命中（默认 namespace 生效） |
| owned vs interning 对比 | 通过：重复语料 interning 显著省内存，全唯一语料 interning 更贵（启用条件的依据） |

## 非目标

- 不实现生产级解析、选择器匹配或全局字符串驻留（T26–T31）；
- 不决定编码探测、字节输入与 BOM 处理策略（T26）；
- 不建立选择器错误分类全表（T30 对齐 [T13](../todos/13-core-errors-and-node-model.md) 的错误模型）；
- 不做性能基准工具链（interning 启用时按决策第 4 条建立）。

## 影响

### 正面影响

- M0 期末三条选型全部有可运行证据，T26–T31 不再有方案不确定性；
- "TreeSink 直写统一存储 + 选择器在槽位上匹配"得到实测，T12/T13 的 arena 设计不再需要为解析器或选择器让步；
- MPL-2.0 兼容边界（不改上游源码、适配层自有）可以直接进入依赖审计清单。

### 代价与风险

- selectors 与 cssparser 处于 servo/stylo 主线演进中，0.x 版本 API 破坏频繁：锁定精确版本（见 [spikes/parser-selector-string/Cargo.lock](../spikes/parser-selector-string/Cargo.lock)），升级走独立提交；
- cssparser 0.37 的 `ToCss` impl 面已收缩（无 `String`/`str` 实现），后续升级需复核 newtype 策略；
- fragment 解析的合成根移交是原型简化：生产实现需决定 `<template>` 上下文、form element 关联（`parse_fragment_for_element` 的 form 参数）等细节（T27）；
- interning 的启用阈值依赖尚不存在的剖析工具，若基准显示性能达标则该项永久搁置。

## 后续决策

1. [T12](../todos/12-generational-arena.md)/[T13](../todos/13-core-errors-and-node-model.md)：生产 arena 与错误模型（`NodeId { slot, generation }`）；
2. [T26](../todos/26-html-document-parser.md)/[T27](../todos/27-html-fragment-parser.md)：生产 document/fragment 解析（输入边界按本 ADR 留下的缺口补齐）；
3. [T28](../todos/28-html-serializer.md)：序列化（从同一存储出发，不需要第二棵树）；
4. [T30](../todos/30-selector-parser-and-matcher.md)/[T31](../todos/31-query-apis.md)：生产选择器匹配与查询 API（结构化错误映射、`SelectorCaches` 策略）。

## 参考资料

内部：

- [ADR-0001：基础技术架构](./0001-basic-technical-architecture.md)（第 3 节 DOM 存储与节点句柄、第 4 节核心模块边界、第 7 节测试策略）
- [ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)（M0 工作项）
- [ADR-0003：原生绑定技术选型](./0003-native-binding-spike.md)（workspace-exclude 原型模式）
- [TODO 队列](../todos/README.md)
- [T05：确定解析器、选择器与字符串存储方案](../todos/05-parser-selector-string-adr.md)
- [原型 crate 清单](../spikes/parser-selector-string/Cargo.toml)、[依赖锁定](../spikes/parser-selector-string/Cargo.lock)、[实现](../spikes/parser-selector-string/src/lib.rs)（store / parse / selector / strings 四模块）

外部：

- [html5ever 仓库](https://github.com/servo/html5ever)
- [selectors（servo/stylo 组件）](https://github.com/servo/servo)
- [rust-cssparser 仓库](https://github.com/servo/rust-cssparser)
- [MPL-2.0 许可证全文](https://www.mozilla.org/en-US/MPL/2.0/)
- [WHATWG HTML 解析规范](https://html.spec.whatwg.org/multipage/parsing.html)
- [Selectors Level 4 规范](https://drafts.csswg.org/selectors-4/)
