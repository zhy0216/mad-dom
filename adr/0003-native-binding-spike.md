# ADR-0003：Bun/JSC 原生绑定技术选型（基于 T04 原型）

- 状态：已接受
- 日期：2026-08-28

## 背景

[ADR-0001](./0001-basic-technical-architecture.md) 第 2 节把"Bun/JavaScriptCore 的具体原生扩展机制"留作后续决策，第 5 节同时固定了硬约束：Rust panic 不得穿过原生边界、绑定层轻薄且不泄漏 Rust 裸指针。[实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 的 M0 工作项要求先为原生绑定原型验证五条最小链路：

1. JavaScript 调用 Rust 函数；
2. Rust 返回字符串、数字和结构化错误；
3. 原生对象可被 JavaScript GC 回收；
4. panic 被截获，不能越过 FFI 边界；
5. Bun 测试进程可稳定加载本地构建产物。

[T04](../todos/04-native-binding-spike.md) 落地了隔离原型 [spikes/native-binding/](../spikes/native-binding/src/lib.rs)（napi-rs 实现 + [构建脚本](../spikes/native-binding/build.sh) + [Bun smoke test](../spikes/native-binding/spike.test.js)），本 ADR 记录候选方案对比、风险、unsafe 边界、平台限制与最终选择。原型不含任何 DOM 语义；生产绑定在 [crates/mad-dom-bun](../crates/mad-dom-bun/Cargo.toml) 按 [T19](../todos/19-minimal-native-binding.md) 另行实现。

## 候选方案对比

### 方案 A：napi-rs（Node-API，`napi` + `napi-derive`，crate-type `cdylib`）

Rust 侧通过 `#[napi]` 宏暴露函数与类，产物是标准 Node-API 动态库（本机为 `libXXX.so`，复制/重命名为 `index.node`），由 Bun 1.4 的 Node-API 实现加载。原型使用的版本：`napi 3.12.2`、`napi-derive 3.6.3`（依赖从 crates.io 解析，锁定在 [spikes/native-binding/Cargo.lock](../spikes/native-binding/Cargo.lock)；不引入 `@napi-rs/cli` npm 依赖，只用 `cargo build` + shell 脚本）。

风险：

- **panic 截获是逐函数 opt-in**：napi 3 中 `#[napi(catch_unwind)]` 是显式标记（经 napi-derive 3.6.3 源码核实：未标记则不做 catch_unwind 包装）。Rust 1.81+ 从 `extern "C"` 边界向外 unwind 会直接 abort 进程，因此任何一个漏标记的入口都可能把 panic 变成进程崩溃。缓解：生产绑定层要求所有 `#[napi]` 入口统一标记 catch_unwind（或全部经由单一包装入口），并纳入 [T21](../todos/21-native-error-and-safety-boundary.md) 的边界审计。
- **错误子类映射是显式的**：napi 3 中所有 `Result` 错误统一经 `napi_create_error` 抛出为普通 `Error`（经 napi 3.12.2 源码核实：不再像 v2 那样按 `Status::InvalidArg` 推导 TypeError）。TypeError 必须用 `Env::throw_type_error` 显式抛出。缓解：错误映射表只存在于绑定层一处（见决策第 2 条）。
- **大版本演进成本**：napi v2→v3 有 API 破坏。缓解：锁定精确版本并记录；升级走独立提交。
- **编译重量**：`napi` crate 默认特性引入 futures 等依赖，release 编译约 25 s（本机）。可接受；后续如需精简由 T06/T19 评估。
- **跨平台构建/分发**未在本原型解决，显式留给 [T06](../todos/06-native-build-adr.md) 与 [T49](../todos/49-native-packaging-and-artifacts.md)。

### 方案 B：bun:ffi + 纯 C ABI

用 `#[no_mangle] extern "C"` 暴露 C ABI 函数，JS 侧经 `bun:ffi` 的 `dlopen`/`cc` 调用。

风险：

- Node-API 之外没有任何 JS 类/finalizer 集成：原生对象要被 JS GC 回收，只能靠 `FinalizationRegistry` 手工记账 + C ABI 层手工释放，最终必然把裸指针（或手工管理的句柄表）暴露到边界两侧，直接违反 ADR-0001 第 3 节"不保存跨 FFI 的裸指针"。
- 字符串/数字/结构体编解码、错误结构体、UTF-8 边界全部手写，`unsafe` 面大且分散，与"绑定层轻薄、unsafe 最小化"（ADR-0001 第 7 节）冲突。
- panic 截获需要每个入口手写 `catch_unwind` + 错误结构体，重复且易漏。
- 若 napi 依赖无法解析，本方案是降级路径（GC 验证将受限并在结论中说明）；实测 napi 构建链路完全可用，故未触发降级。

### 方案 C：对接 Bun 内部 Zig JSC 绑定

Bun 自身的 JS↔原生能力由 Zig 直接对接 JavaScriptCore C++ 内部接口实现。

风险：

- 这不是 Bun 的公开契约：JSC 内部 API 与 Bun 内部结构随版本漂移，无兼容承诺，代价是长期跟随 Bun 内部实现。
- Rust→Zig→JSC 多一跳 FFI，错误、GC 语义均无文档化保障。
- 无法独立测试绑定层，违背 ADR-0001 的三层解耦目标。排除。

## 决策

**选定方案 A（napi-rs / Node-API）**。理由对应验收要求逐条如下：

1. **GC finalizer 原生可用**：`#[napi]` class 实例由 JS 对象包装，GC 回收时自动调用 Rust `Drop`；实测计数归零（见验证结果表）。
2. **错误映射可控**：结构化错误（core 形状）→ `TypeError` / `Error` 的映射在绑定层一处完成，符合 ADR-0001 第 5 节"Core 返回结构化 `Result`，绑定层负责转换"。
3. **panic 截获有明确机制**：`#[napi(catch_unwind)]` 把 panic 转为 JS `Error`，实测进程存活。opt-in 属性即边界规则，便于审计。
4. **Bun 兼容**：Bun 1.4.0（[.bun-version](../.bun-version) 固定）通过 Node-API 稳定加载 cdylib 产物，无需 Bun 侧特殊支持。
5. **绑定层轻薄**：绑定代码只做值转换、对象包装、异常映射和生命周期衔接；Core 不依赖 Bun/JSC。原型手写代码中 `unsafe` 块数量为 0。
6. **不暴露裸指针**：JS 侧只见不透明的类实例与函数；Rust 值由 JS 包装对象独占，finalizer 触发 Drop。后续 DOM 绑定沿用"包装对象持有文档所有权引用 + `NodeId`"（ADR-0001 第 3 节），跨边界的只有句柄，没有指针。

### unsafe 边界与生命周期约定

- 全部 `unsafe` 封装在 `napi`/`napi-sys` crate 内部；手写绑定代码（原型与未来的 [crates/mad-dom-bun](../crates/mad-dom-bun/Cargo.toml)）不直接写 FFI/unsafe。
- 所有权：JS 包装对象独占 Rust 值；GC finalizer 是 Rust 值唯一的析构路径；不存在跨边界共享可变指针。napi 内部以 borrow guard 阻止重入别名。
- panic 边界：每个可能 panic 的 `#[napi]` 入口必须标记 `#[napi(catch_unwind)]`；panic 转为普通 JS `Error`，进程继续存活（实测）。
- 错误边界：结构化错误在绑定层映射——参数/用法错误 → `TypeError`，内部/其它错误 → 普通 `Error`（附 `code`）；panic 一律视为不可恢复的 `Error`，不伪装成输入错误。

### 平台限制

- 本原型仅在本机验证：`aarch64` Linux，Bun 1.4.0，Rust 1.93.1（[rust-toolchain.toml](../rust-toolchain.toml) 固定）。
- 构建脚本按 Unix cdylib 输出名（`libmad_dom_binding_spike.so` → `index.node`）处理；macOS/Windows 产物命名、平台矩阵与 npm 分发不在本 ADR 决定，移交 [T06](../todos/06-native-build-adr.md)（构建）与 [T49](../todos/49-native-packaging-and-artifacts.md)（打包）。
- Bun 特有行为：`Bun.gc(true)` 同步收集对象，但 napi finalizer 回调推迟到下一个事件循环轮次执行（Node.js 中 finalizer 随 GC 同步执行）。依赖析构时机的测试和生产代码必须显式排空事件循环，此差异已记录在验证结果中。

### 原型与生产绑定边界

- [spikes/native-binding/](../spikes/native-binding/src/lib.rs) 通过根 [Cargo.toml](../Cargo.toml) 的 `workspace.exclude` 隔离：`cargo fmt/clippy/test --workspace` 不受影响；原型自带 `Cargo.lock`，由 `npm run spike:build` / `npm run spike:test` 构建、测试。
- 原型只含无 DOM 语义的最小工具函数（除法、字符串计数、计数器句柄、panic 触发器），不实现任何 DOM 规则，也不得扩张为 DOM 绑定。
- 生产绑定（[T19](../todos/19-minimal-native-binding.md) 起，M3）在 crates/mad-dom-bun 全新实现：从原型迁移的只有**模式**（错误映射形态、catch_unwind 边界规则、GC 计数验证方法、构建脚本形态），不直接复制原型代码；wrapper 身份缓存、文档所有权、错误分类等生产需求在原型中刻意缺席。
- 原型 smoke test 保留在 `spikes/` 内，不并入 `tests/bun/`（该目录归 T02 所有）。

## 验证结果（五条最小链路实测）

实测环境：aarch64 Linux，Bun 1.4.0，Rust 1.93.1，napi 3.12.2 / napi-derive 3.6.3，release 构建。测试为 [spike.test.js](../spikes/native-binding/spike.test.js)，`bun test spikes/` 连续 5 次运行全部通过（7 pass / 0 fail）。

| 链路 | 机制 | 实测结论 |
| --- | --- | --- |
| 1. JS 调用 Rust；字符串/数字往返 | `#[napi]` 函数 + `#[napi(object)]` 返回结构 | 通过：UTF-8（含 emoji）字符串与 f64 无损往返，`chars().count()` 语义一致；1000 次重复调用稳定 |
| 2. 结构化错误 | core 形状错误枚举 → 绑定层映射 | 通过：参数错误经 `Env::throw_type_error` 抛出 `TypeError`（带 `code` 属性）；内部错误抛出普通 `Error`；参数类型不匹配由 napi 转换层拒绝（napi 3 中抛普通 `Error`，非 TypeError） |
| 3. 原生对象 GC | `#[napi]` class + `Drop` 计数器 | 通过：构造 20 003 个实例后 `Bun.gc(true)` 收集对象，finalizer 计数在**下一个事件循环轮次**归零；显式保留的实例跨 GC 存活，计数精确为 3；释放后归零。注意：仅靠 microtask 排空无效，需要一次 macrotask |
| 4. panic 截获 | `#[napi(catch_unwind)]` | 通过：panic 消息完整出现在 JS `Error.message` 中，进程不崩溃，后续原生调用正常。未标记 `catch_unwind` 的入口 panic 会 abort 进程（napi 3 行为），因此它是生产绑定的强制规则 |
| 5. 产物加载 | `cargo build --release` → 复制为 `index.node` → `require` | 通过：Bun 测试进程稳定加载；同一路径重复 `require` 返回同一模块实例（单次 dlopen）；构建脚本可重复执行；测试连续多轮运行无漂移 |

## 非目标

- 不决定平台矩阵、二进制拆包、npm 分发与签名（T06/T49）；
- 不实现任何 DOM 语义、wrapper 身份缓存或文档所有权（T19/T20）；
- 不建立错误分类全表（T21）；
- 不优化绑定性能或批量 API（M3 完成后按基准数据决定）。

## 影响

### 正面影响

- 绑定机制在 M0 期末即有可运行证据，M3 生产绑定不再有方案不确定性；
- Core 与绑定层的解耦假设（独立测试、结构化错误、无裸指针）全部得到实测支撑；
- panic opt-in 与错误映射的边界规则可以直接进入 T19/T21 的验收清单。

### 代价与风险

- Bun 的 finalizer 延迟语义与 Node.js 不同：依赖析构时机的代码必须排空事件循环；若未来 Bun 版本改变该行为，GC 压力测试需要相应调整（该风险由 M3 的 GC 门禁兜底）；
- napi 大版本演进需要跟进（当前锁定 3.12.x）；升级属独立提交；
- `catch_unwind` 是逐入口 opt-in，存在漏标记风险，必须靠 T21 的边界审计与 CI 规则兜底；
- 本原型仅覆盖单平台，跨平台构建风险（符号可见性、产物命名、最小 glibc 版本等）尚未实证。

## 后续决策

1. [T06](../todos/06-native-build-adr.md)：原生构建方式与首批目标平台；
2. [T19](../todos/19-minimal-native-binding.md)：生产最小绑定（按本 ADR 的模式实现）；
3. [T21](../todos/21-native-error-and-safety-boundary.md)：错误分类全表与 panic/unsafe 边界审计；
4. [T49](../todos/49-native-packaging-and-artifacts.md)：产物打包、分发与安装后验证。

## 参考资料

内部：

- [ADR-0001：基础技术架构](./0001-basic-technical-architecture.md)（第 2 节运行时与语言、第 5 节所有权与安全边界、第 7 节测试策略）
- [ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)（M0 工作项"M0 决策与工程基线"、M3 原生绑定）
- [TODO 队列](../todos/README.md)
- [T04：完成 Bun/JSC 原生绑定原型与 ADR](../todos/04-native-binding-spike.md)
- [原型 crate 清单](../spikes/native-binding/Cargo.toml)、[原型实现](../spikes/native-binding/src/lib.rs)、[构建脚本](../spikes/native-binding/build.sh)、[smoke test](../spikes/native-binding/spike.test.js)
- [生产绑定 crate 骨架](../crates/mad-dom-bun/Cargo.toml)

外部：

- [napi-rs（napi / napi-derive）仓库](https://github.com/napi-rs/napi-rs)
- [Node-API 规范（Node.js 文档）](https://nodejs.org/api/n-api.html)
