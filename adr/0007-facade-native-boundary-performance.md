# ADR-0007：Facade / 原生边界的令牌、批处理与代际缓存

- 状态：已接受
- 日期：2026-09-05
- 修订：[ADR-0001](./0001-basic-technical-architecture.md) 第 1、3 节

## 背景

ADR-0001 确立了 Rust Core 为唯一 DOM 状态、JavaScript 节点持有原生句柄、同一
`NodeId` 保持稳定 wrapper 身份的初始架构。实现完整 facade 后，DOM-intensive
基准暴露出跨 Node-API 的固定成本：逐节点 `createElement`、属性写入、挂载以及
首次 `firstChild` / `nextSibling` 遍历均需要铸造 `NodeHandle`，即使调用只需要
一个整数节点引用。

2026-09-05 的改造前 9 轮基线中，`buildMixed` 为 59.63 ms（happy-dom
52.38 ms），`traverseCold` 为 19.52 ms（happy-dom 3.61 ms）；创建、属性、挂载和
文本创建拆分相位也全部落后。仅优化 Rust 树操作无法消除这些固定边界成本。

## 决策

### 1. Core 仍是唯一权威 DOM

树、属性、文本、文档归属和所有 DOM 规则仍只保存在 Rust Core。Facade 可以保存
以下**派生缓存**，但缓存值必须由 Core 产生，并由 Core 写入点维护的代际信号验证：

- wrapper 身份；
- 不可变节点分类（类型、名称、命名空间）；
- 父子与兄弟导航结果；
- `id` / `class` 的已读值；
- live collection 的已计算数量。

代际不匹配、跨文档 adopt 后的陈旧句柄以及 document destroy 都必须回到原生路径，
不得由缓存掩盖既有错误类型和时机。这些缓存不是第二棵 DOM，也不能独立决定 DOM
变更是否合法。

### 2. 文档作用域令牌取代热路径上的强制 NodeHandle 铸造

绑定可向 facade 返回进程内单调分配的 `u32` 节点令牌。令牌只在所属
`DocumentHandle` 中有意义；`NodeId { document, slot, generation }` 仍完全留在绑定
内，并通过每文档 `token -> NodeId` 表解析。进程级唯一性保证把令牌交给另一个存活
文档也只会被拒绝，而不会碰巧命中它的本地节点；令牌不复用，因此 arena 槽位复用
不能让陈旧令牌指向新节点。代价是单进程累计最多分配 2³² 个令牌，耗尽后新建令牌
明确失败；这是当前紧凑 `Uint32Array` 协议的硬上限。

令牌正反向表使用 `FxHashMap`，但这个选择严格限制在绑定自己铸造的单调 `u32`
令牌和 Core arena `NodeId`：用户字符串和任意外部 key 不得进入这些表。该哈希器不
提供 HashDoS 防护；此处可接受的前提是插入 key 完全由绑定/Core 生成，抓取页面也
不执行页面脚本。若未来允许不可信代码驱动任意 arena 回收序列，必须重新评估并改用
带随机种子的哈希器，不能把 `FxHashMap` 扩散到一般状态。

Facade wrapper 可以先持有“document state + token + 不可变分类”，直到某个没有
令牌入口的 API 才延迟铸造标准 `NodeHandle`。原生 `NodeHandle` 同时盖上相同令牌，
文档私有 token registry 将查询、导航、延迟物化等路径收敛到同一个 facade 对象
身份。

令牌入口只做值转换和批处理；层级、归属、名称校验、observer 记录与 custom-element
反应仍由既有 Core API 执行。

### 3. 有界批处理

- 常见内置 HTML tag 的 `createElement` 使用自适应令牌池：首次单独创建，重复使用
  按 8、32、128 递增到每批 256，避免一次性使用某个 tag 时隐藏预分配 256 个节点。
  当前 binding 在一次 registry lock 内注册连续令牌，只向 JavaScript 返回区间起点；
  facade 用 `start + --remaining` 标量游标保持旧 token 数组 `pop()` 的节点顺序，
  消除 `Vec<u32> -> Array<number>` 的逐项封送。没有 range 入口的旧 binding 回退到
  原有数组批量入口。
- `setAttribute` 与同文档 `appendChild` 可直接接收令牌，避免仅为一次写操作铸造
  两个 Node-API class 对象。
- `createTextNode` 将 Node-API 已完成转换的 owned `String` 直接移入 Core，避免再次
  分配/复制；刚创建的代际 `NodeId` 用 fresh proof 登记令牌，跳过必然 miss 的反向表
  探测。facade 使用只接受 fresh Text token 的创建专用 wrapper 工厂，省去通用分类
  dispatch，但仍在返回前登记到与普通 lazy wrapper 完全相同的文档身份表。
- 首次遍历可请求最多 65,535 节点的 preorder 块。快照以 `Uint32Array` 传递一个
  continuation-depth header（`0` 表示完整），随后是 `(token, descriptor/depth)` 对；
  内置 HTML tag 用紧凑代码，非标准/非 HTML 元素回退到标准原生分类。原生端在同一
  registry lock 下单次探测已有 token、批量预留缺失 token 并原位写入传输 buffer；
  descriptor 的最高位标记“本快照刚分配 token”：它严格证明该 token 从未到达 facade，
  因而可跳过一次 wrapper identity Map 探测；已有 token 仍走完整收敛检查。facade
  同步预建导航 memo，并按紧凑 descriptor 缓存已选 HTML prototype；新 wrapper 的
  私有状态在一次 WeakMap 写入前完整初始化，避免 hydration 再逐节点重复查找内部状态。
- 超限时保留已经返回的有界前缀，只撤销边界祖先上尚未证明的终止关系；遍历抵达
  边界后继续尝试标记的子树块或使用 32 项 sibling window。这样完整遍历没有固定
  上限处的规模断崖，孤立的一次属性读取也不会无界物化整棵树。

所有批量上限是实现细节而非公开 DOM 契约；修改时必须同时覆盖小量调用的浪费、
默认负载和规模曲线。

### 4. Core 写入点驱动的代际视图

`Document` 维护两个互相独立的单调计数器：

- `structure_generation`：所有父子/兄弟关系写入；
- `attribute_generation`：所有既有元素属性存储写入。

`with_document` 比较调用前后值，并更新 JavaScript 拥有的 4 字节 epoch buffer。
绑定只保留 buffer 的弱 Node-API 引用：每次发布只在当前同步调用内取得 backing
pointer，绝不把 Rust 内存暴露为 external ArrayBuffer，也不跨调用保留 JS backing
pointer。buffer 被 transfer 后原对象 detach，订阅会在下一次发布清除；转移出的
对象只是旧值副本，和 native 状态不再共享内存。

Facade 通过私有 `Int32Array` 读取 generation，不需要为缓存校验再次跨 FFI。令牌
热写入口直接返回准确的 canonical generation，由 facade 写入自己的私有 buffer；
普通/raw `epochView()` 订阅仍由 native 同步发布。这样安全边界不依赖可篡改的 JS
builtin，同时避免每次 facade append/attribute write 都反查 ArrayBuffer。如果 observer
调度器可能在 native 返回前同步重入 JavaScript，则绑定会先发布两个私有代际，
并在重入后返回最新 canonical 值，避免外层写回覆盖嵌套突变。

32 位代际不会循环重用：活值跳过 destroy 哨兵，并在即将出现 ABA 前饱和为
“禁用缓存”哨兵。此后 facade 永久回退到 native 读，文档仍可用。destroy 则把
所有仍连接的 view 写成独立终止哨兵并释放订阅。属性写入不会使导航缓存失效；
结构变化会使依赖节点存活性的属性缓存失效。

tag collection 数量只依赖结构代际；class collection 同时依赖结构和属性代际。
`id` / `class` 值缓存同时检查两者，以保证 adopt、原生低层写入、DOMTokenList、
NamedNodeMap 与 facade setter 都立即可见。缓存冷填充通过可选的
`idClassAttributes()` 在一个文档锁和一次 Node-API 往返中读取两项；旧 binding
继续使用两个定名 reader 或通用 `getAttribute`。`null`、空字符串和内部 `undefined`
未填充哨兵保持严格区分。

节点 facade 的 handle/token、不可变分类、代际证明、导航 memo 与属性缓存集中在
module-private WeakMap 记录中；wrapper 本身不携带可枚举或可反射的内部 Symbol。
每文档 token registry、预取池及 custom-element 构造 mint 记录也由私有 Map/WeakMap
闭包持有，并绑定模块初始化时取得的 collection intrinsic。这样应用代码在初始化后
替换 `Map.prototype` / `WeakMap.prototype`、复制 wrapper 自有描述符或枚举 Symbol，
都不能取得文档句柄、伪造分类或制造陈旧缓存命中。原生 NodeHandle 上的只读、不可
配置分类印章仍仅用于绑定到 facade 的可信输入，不成为 DOM wrapper 的公开状态。
Facade 只把 handle 自身的 own data property 识别为 token/分类印章；旧 binding 缺少
印章时，`Object.prototype.madDomToken` / `madDomType` 等继承属性不会合并 wrapper
身份或伪造类型。

### 5. Core 自适应文档 id 索引

文档查询索引具有显式的 `Off` / `IdOnly` / `Full` 三态。初始为 `Off`；第一次
document-scoped plain `querySelector("#id")` 或 `getElementById` 由 Core 自己识别并
准备 `IdOnly`，只建立 light document tree 的 `by_id`。绑定不复制 CSS id 识别规则，
也不维护第二份表。`getElementById` 的准备只读取已有 document root，不会为了空文档
物化 implied HTML skeleton。

`Off → IdOnly` 先在局部状态完整遍历并构建，成功后一次发布；树 attach/detach、id
写入、parser replacement、custom-element replacement 与跨文档 adopt 都继续经过
Core 的统一维护点。断开树与 shadow tree 不进入 document 索引，重复 id 的列表始终
保持 document order。

公开的 T32 `set_query_index_enabled(true)` 仍精确表示完整 id/class/tag/all-elements
索引：`IdOnly → Full` 从权威树原子重建且幂等，`query_index_enabled()` 在私有
`IdOnly` 状态仍返回 `false`；关闭则从任一索引态回到空 `Off`。因此自适应优化不改变
完整索引的公开诊断语义，也不让一般 selector 或 live collection 隐式承担完整索引的
内存和写维护成本。

### 6. 版本与回退

这些原生方法是 additive、可特性检测的性能入口，不改变公开 WHATWG facade，也不
提高 native ABI 版本 1：

- facade 对没有令牌/批量/快照方法的旧平台包回退到 `NodeHandle` 路径；
- 创建池按 range 入口、数组 batch 入口、单 token 入口、`NodeHandle` 路径的可用性
  逐级回退；可选入口一旦被调用并抛错就原样传播，不在失败后重复创建；
- 所有 optional 原生性能入口（epoch、token、快照、固定属性读、导航预取和 collection
  count）只从 native handle 的直接 prototype own data method 解析；文档方法按文档
  安全预绑定，节点方法按 prototype 首次解析为捕获的 receiver invoker，热循环不重复
  做 descriptor 查询。`Object.prototype` 同名属性一律忽略；创建/快照还必须同时具备
  materializer，partial binding 不会产出无法物化的 lazy wrapper；
- 没有结构或属性 epoch view 时停用对应缓存；
- 错误分类、wrapper 身份和 DOM 结果在这些路径上一致。

TypeScript 的低层 `DocumentHandle` / `NodeHandle` 接口把这些入口声明为 optional，
防止它们被误解为跨版本必备的公开 DOM 能力。

## 结果

同机 Bun 1.4.0、macOS arm64 的正式 15 轮 1× dom-bench 中，15 个相位领先；唯一
表面落后的 `readHeavy` 为 4.41 vs 4.39 ms，差 0.46% 且处于噪声内。为避免固定
引擎顺序或挑选有利结果，随后补跑完整 pipeline ABBA（mad、happy、happy、mad），
每个 worker 15 个测量轮，合并为每引擎 30 个样本。ABBA 合并中位数 16/16 相位领先：

| 相位 | mad-dom | happy-dom 20.11.11 |
| --- | ---: | ---: |
| `parse` | 8.903 ms | 29.756 ms |
| `buildMixed` | 29.028 ms | 47.382 ms |
| `queryHot` | 2.147 ms | 11.047 ms |
| `queryCold` | 5.110 ms | 9.078 ms |
| `getById` | 0.791 ms | 41.147 ms |
| `getByTag` | 0.216 ms | 2.482 ms |
| `serialize` | 0.924 ms | 4.369 ms |
| `traverseWarm` | 0.546 ms | 1.416 ms |
| `traverseCold` | 3.203 ms | 3.434 ms |
| `buildCreate` | 5.880 ms | 7.132 ms |
| `buildAttr` | 19.567 ms | 26.200 ms |
| `buildAppend` | 10.355 ms | 12.515 ms |
| `buildText` | 7.109 ms | 8.530 ms |
| `buildBulk` | 24.066 ms | 89.061 ms |
| `readHeavy` | 4.117 ms | 4.559 ms |
| `mutationChurn` | 8.034 ms | 64.938 ms |

两个 mad-dom batch 的 `readHeavy` 中位数为 4.005/4.142 ms，两个 happy-dom batch
为 4.386/4.582 ms，方向一致。按 batch 分层的 200,000 次 bootstrap 给出 happy-dom
− mad-dom 差值 95% CI +0.126..+0.777 ms、ratio 1.030×..1.189×，点估计 mad-dom
少 9.69%。全部 16 相位各做 50,000 次同法 bootstrap 后，差值 CI 下界均大于零；
最窄的是 `traverseCold` 的 +0.119 ms。

0.1× 审计使用四个交替 worker（mad、happy、happy、mad），每个 31 个测量轮，合并
为每引擎 62 个样本。分层 50,000 次 bootstrap 中 14/16 相位的 happy-dom − mad-dom
差值 CI 明确大于零；`buildText` 与 `readHeavy` 统计持平。关键合并中位数与 CI 为：

| 相位 | mad-dom | happy-dom 20.11.11 | happy-dom − mad-dom 95% CI |
| --- | ---: | ---: | ---: |
| `traverseCold` | 0.3377 ms | 0.3528 ms | +0.0003..+0.0263 ms |
| `buildText` | 0.5742 ms | 0.6689 ms | −0.0332..+0.1914 ms |
| `readHeavy` | 0.4050 ms | 0.3996 ms | −0.0487..+0.0260 ms |

其余 13 个相位也有有利点值；因此合并点值为 15/16 领先，唯一反向的 `readHeavy`
只差 0.0054 ms。这里按置信区间报告两个统计持平项，不把亚毫秒单次运行的方向当成
稳定输赢。最终正式命令的固定引擎顺序 15 轮在表中三项给出 0.43 vs 0.36、0.74 vs
0.49、0.59 vs 0.39 ms，方向与高样本 ABBA 部分相反且三个区间都重叠；保留这些
原始点值，但决策结论采用交替顺序的 62 样本审计。

正式命令的 15 轮 2× 规模测量也 16/16 相位领先：

| 相位 | mad-dom | happy-dom 20.11.11 |
| --- | ---: | ---: |
| `parse` | 20.08 ms | 66.01 ms |
| `buildMixed` | 60.89 ms | 106.87 ms |
| `queryHot` | 4.33 ms | 25.25 ms |
| `queryCold` | 10.38 ms | 21.17 ms |
| `getById` | 1.40 ms | 95.10 ms |
| `getByTag` | 0.34 ms | 5.37 ms |
| `serialize` | 1.80 ms | 9.74 ms |
| `traverseWarm` | 1.10 ms | 3.75 ms |
| `traverseCold` | 6.24 ms | 6.91 ms |
| `buildCreate` | 12.29 ms | 15.05 ms |
| `buildAttr` | 40.03 ms | 58.35 ms |
| `buildAppend` | 20.84 ms | 28.19 ms |
| `buildText` | 15.28 ms | 18.44 ms |
| `buildBulk` | 53.58 ms | 185.15 ms |
| `readHeavy` | 9.81 ms | 10.30 ms |
| `mutationChurn` | 15.27 ms | 42.52 ms |

happy-dom 的跨相位总耗时样本超过稳定性阈值，因此结论只依赖逐相位中位数。旧的
完整快照/超限空结果协议曾让 2×
在越过 32K 后陡增到 53.66 ms；现行 65,535 节点 continuation 协议没有该断崖。

最终固定代码的 `--runs 15 --sizes 0.1,1,2` 复核中，1×/2× 除 `readHeavy` 外的
15 个相位均有有利点值；2× 的 `buildCreate`、`buildText`、`traverseCold` 分别为
12.42 vs 20.39、14.82 vs 18.50、6.27 vs 7.09 ms。`readHeavy` 为 10.21 vs
10.17 ms，只反向 0.04 ms（0.4%）且区间重叠；上表更早的 2× 正式测量则为
9.81 vs 10.30 ms，方向相反。它与高样本 1× ABBA 的明确领先一起证明这是窄幅轮次
噪声，而不是可复现的边界退化。

同一次最终正式命令的 total 行同时记录 pipeline-end、排空后 worker RSS 增量；
0.1× / 1× / 2× 的 mad-dom 分别为 +13.4 / +236.7 / +333.2 MB，happy-dom 为
+591.1 / +5,752.8 / +10,730.1 MB。这些数包含多轮 worker 的驻留 wrapper、JIT 和
GC 状态，不是单文档对象大小；JSON 仍保留每相位 peak/after 采样。它与上面的
cold/warm 数字共同构成时间—内存口径。

代价是每文档令牌反向表、文档存活期间的 facade wrapper 驻留、两个代际槽、首次
文档 id 读取后的一张 Core `by_id` 派生表，以及快照期间的有界临时缓冲。性能文档
必须同时报告 cold/warm 与 RSS，不能只展示热缓存数字。

### 收口审计

倒数第二个仍有明确收益假设的改动，是把创建批次从 JavaScript token 数组改为连续
range。交替运行的两组 15 轮 2× A/B 中，旧 batch 的 pipeline total 中位数为
654.58/667.63 ms，range 为 657.84/663.16 ms；配对变化为约 +0.5%/-0.7%，两组
中心合并后约改善 0.1%，低于 1% 且处于轮次噪声内。细分创建相位的合并中位数仍有
方向一致的改善：`buildCreate` 约 5.3%，`buildAppend` 约 3.3%，`buildAttr` 约
1.5%，`buildMixed` 约 0.8%，因此保留 range 以减少临时数组和扩大创建余量。

0.1× 审计随后暴露 `buildText` 的窄热点，促成 owned String、fresh token 登记和
创建专用 Text wrapper 三项最终改动。四个配对、每块 31 轮的同引擎 A/B 中，
`buildText` 每对分别改善 4.42%、3.66%、6.75%、8.73%，合并中位数从 0.60775
降到 0.57408 ms（改善 5.54%）。对应 pipeline total 的四对变化为 −0.35%、
−0.54%、+0.48%、+1.65%，中心不足 1%。因此保留明确改善目标相位的实现，并按
“最后一轮 total 改善不足约 1%”停止继续改造。

此前审计过但未保留的候选包括：完整 id/class/tag/all-elements 索引使 total 退化约
0.9%；合并 memo/internals 状态使 total 退化约 6.2%；普通九字段对象记录只在相互
冲突的 mixed-query/traversal 微测中分别变化约 -1.3%/+1.6%；预填数组在更长 ABBA
中让 `queryCold`/`traverseCold` 分别退化约 3.4%/2.1%；其余缓存布局变体结果不一致，
并会削弱私有状态硬化。完成逐路径检查后，没有剩余的、保持正确性且预期能让 official
pipeline total 再改善超过 1% 的具体方案。

## 被否决的方案

- **只优化 Rust arena / selector**：无法去除逐调用 Node-API 固定成本。
- **在 JavaScript 保存可独立变更的镜像树/属性表**：会产生双重权威和同步错误，
  违反 ADR-0001 的核心约束。
- **永久强引用所有 native NodeHandle**：身份简单但强制为每个节点创建昂贵的原生
  class 对象；令牌 wrapper 只在需要时物化。
- **无限制整树快照**：单次 `firstChild` 可能因巨型文档产生无界延迟和内存尖峰；
  采用 65,535 节点块、continuation depth 与有界 sibling window。
- **为 token 表自制 identity hasher**：`NodeId` 是多字段代际 id，忽略字段会让新节点
  大量碰撞；使用成熟的全字段 `FxHash`，并把非抗 HashDoS 的前提限制在内部 key。
- **仅由 facade setter 手工清缓存**：会遗漏 raw handle、parser、token list、Attr
  node 和未来写入口；代际必须在 Core chokepoint 产生。
- **第一次 id 查询就启用完整 T32 索引**：会为 class/tag/all-elements 支付不必要的
  内存和所有后续写维护成本；采用独立 `IdOnly` 模式，只在显式 T32 开关时升级为
  `Full`。

## 验证要求

- token 必须保持文档隔离、稳定身份、destroy/adopt 错误和 batch 独立节点语义；
- 快照必须覆盖 compact tag、未知 HTML、SVG、文本、深度和超限分区回退；
- 属性缓存必须覆盖 facade、raw handle、classList/NamedNodeMap、结构变化与 destroy；
- id 索引必须覆盖 Off/IdOnly/Full 幂等转换、重复 id 顺序、move/detach/id 写入、
  parser replacement、shadow/detached 排除与跨文档 adopt，并与 full/traversal 结果等价；
- `bun run bench:dom --runs <n>` 必须比较完全相同的 workload checks；
- 至少保留 0.1× / 1× / 2× 规模审计，防止重新引入边界断崖。
