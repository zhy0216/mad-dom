# ADR-0005：原生产物构建与发布架构

- 状态：已接受
- 日期：2026-08-28

## 背景

[ADR-0001](./0001-basic-technical-architecture.md) 第 8 节明确把"实际发布时的原生二进制拆包和平台命名方案"留作后续决策；[实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 的 M0 工作项要求确定"首批目标平台的本地构建方式"，M9 要求"通过独立 ADR 确定目标平台矩阵、二进制包拆分、加载策略、签名和 npm 发布方式"。[T04](../todos/done/04-native-binding-spike.md) 完成绑定原型后，[ADR-0003](./0003-native-binding-spike.md) 把"平台矩阵、二进制拆包、npm 分发与签名"显式移交给本 ADR（[T06](../todos/06-native-build-adr.md)），打包与产物实现随后由 [T49](../todos/49-native-packaging-and-artifacts.md)（M9）落地，stable 门禁由 [T50](../todos/50-hardening-and-stable-release.md) 收口。

本 ADR 只做架构决策：固定首批平台矩阵与 phase 划分、Bun ABI 约束、本地开发构建与发布构建的边界、npm 拆包策略与精确包命名、安装期/加载期选择逻辑、产物校验与签名、不支持平台的错误行为，以及发布顺序、dist-tag 与回滚原则。它不生成任何正式发布产物，不编写构建脚本或 workflow（均属 T49）。决策结果必须能直接指导 T49 的实现，不遗留关键命名或加载歧义。

## 决策

### 1. Bun ABI 约束

沿用 [ADR-0003](./0003-native-binding-spike.md) 的结论，并把它作为平台矩阵的前提：

- 绑定产物是标准 **Node-API** 动态库（napi-rs 实现，`napi 3.12.x` / `napi-derive 3.6.x`，crate-type `cdylib`），**Bun 通过 Node-API 加载，不依赖任何 Bun 内部 ABI**（ADR-0003 决策第 4 条已实测：Bun 1.4.0 经 Node-API 稳定加载 cdylib 产物）；
- 因此平台二进制的兼容变量是"Node-API 特性层级 + 目标平台"，而不是"Bun 内部构建"；Bun 小版本升级原则上不要求重新编译原生包，但仍必须重跑全平台安装 smoke（见第 10 节回滚与升级联动；ADR-0003 已记录 Bun 的 finalizer 时序差异风险）；
- 绑定不得使用超出 Bun 1.4.0 所实现的 Node-API 特性层级的 API；实际使用的 Node-API 层级、`napi` crate 精确版本由 [T19](../todos/19-minimal-native-binding.md) 实现时锁定并写入构建元数据，T49 按元数据复现构建；
- `panic = unwind` 是 catch_unwind 边界（ADR-0003 决策第 3 条）的前提：任何目标 triple 的构建配置不得改为 `panic = abort`；
- 运行时下限固定为 [package.json](../package.json) 的 `engines.bun >= 1.4.0` 与 [.bun-version](../.bun-version) 固定的 Bun 1.4.0（与 [ADR-0002](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 第 1 节的判定环境一致）；Rust 工具链固定为 [rust-toolchain.toml](../rust-toolchain.toml) 的 1.93.1。

### 2. 首批平台矩阵与 phase 划分

包名按第 5 节命名规则；此处固定矩阵、目标 triple 与 phase。phase 的含义：**首批**平台必须在 alpha 发布演练（T49）中全部完成构建与安装 smoke；**唯一例外是 win32-x64**——它属于第二批演练，alpha 演练允许缺席（beta 起必须就绪），缺席时它不得进入当次主包的 `optionalDependencies` 声明（避免精确 pin 指向不存在的版本），且 win32-x64 环境的加载必须命中第 9 节的明确错误路径（"平台已声明但本版本未随附"）；**第二批**平台在 beta 前补齐；stable 门禁（[T50](../todos/50-hardening-and-stable-release.md)）要求**全部已声明平台**（无论 phase）通过发布验证，缺一不得宣布 stable。

| 包名 | 目标 triple | libc | phase |
| --- | --- | --- | --- |
| `@mad-dom/platform-darwin-arm64` | `aarch64-apple-darwin` | —（macOS 无 libc 维度） | 首批 |
| `@mad-dom/platform-darwin-x64` | `x86_64-apple-darwin` | — | 首批 |
| `@mad-dom/platform-linux-x64-gnu` | `x86_64-unknown-linux-gnu` | glibc | 首批 |
| `@mad-dom/platform-linux-arm64-gnu` | `aarch64-unknown-linux-gnu` | glibc | 首批 |
| `@mad-dom/platform-win32-x64` | `x86_64-pc-windows-msvc` | — | 首批（alpha 允许缺席，beta 起必须就绪） |
| `@mad-dom/platform-linux-x64-musl` | `x86_64-unknown-linux-musl` | musl | 第二批（beta 起） |
| `@mad-dom/platform-linux-arm64-musl` | `aarch64-unknown-linux-musl` | musl | 第二批（beta 起） |

取舍说明：

- **glibc 基线**：gnu 目标的兼容下限由构建宿主决定，ADR-0003 已把"最小 glibc 版本"列为未实证风险；本 ADR 要求 T49 把实测下限（由构建容器/runner 的 glibc 版本决定）写入发布文档，用户侧兼容承诺以该实测值为准，不做无证据的声明。选择较低基线的构建宿主是 T49 的实现自由，但结论必须记录。
- **musl 后置于第二批**：musl 构建需要独立工具链与交叉编译验证，且 musl 与 glibc 在同一 os/arch 下互相不可加载，属于额外兼容面；glibc 发行版（绝大多数 CI 与桌面 Linux）优先覆盖。musl 目标必须保持 Rust 默认的 `panic = unwind`（Rust 1.71+ 的 musl 目标默认 unwind，当前工具链 1.93.1 满足），否则 catch_unwind 边界失效，直接违反 ADR-0003。
- **macOS 不做 universal2 胖二进制**：x64 与 arm64 拆为两个平台包，避免单包体积翻倍；如未来有需求，另行评估，不改命名规则。
- **Windows 只含 MSVC 目标**：`x86_64-pc-windows-msvc`；不承诺 MinGW/GNU 目标。win-x64 phase 后移一位（alpha 允许缺席）是因为它需要独立的 runner 与产物命名（`.dll` → `.node`）验证链，不应阻塞其余首批平台。
- **不在矩阵中的架构**（如 npm cpu 值为 `arm` 的 32 位 ARM、`aarch64` Windows 等）：命名规则（第 5 节）保留其位置，当前不构建、不声明，命中第 9 节的"平台不支持"错误。

### 3. 本地开发加载流程与开发/发布构建边界

**开发期（T19 起）**：

- 生产绑定在 [crates/mad-dom-bun](../crates/mad-dom-bun/Cargo.toml) 实现（[T19](../todos/19-minimal-native-binding.md)），构建形态沿用 [T04 原型](../todos/done/04-native-binding-spike.md) 已验证的模式：`cargo build`（本地 triple，debug 或 release）+ 把 cdylib 产物复制/重命名为标准产物名，交给 Bun 测试进程 `require`。原型脚本形态见 [spikes/native-binding/build.sh](../spikes/native-binding/build.sh)。
- 开发构建只覆盖开发者本机 triple，不做交叉编译、不做打包、不产出 npm 包。本地构建产物是 git-ignored 的（根 [.gitignore](../.gitignore) 的 `*.node` 等规则），属于 `target/` 输出，永不进入 `git` 或 `npm pack`。
- 主包 [index.js](../index.js) 的加载器（第 6 节）按统一解析顺序工作：显式环境变量 → npm 平台包 → 仓库本地构建产物。仓库本地构建路径只可能存在于源码 checkout（且被 git-ignored、不在 [package.json](../package.json) 的 `files` 清单中），安装后的 npm 包天然不存在该路径，因此加载器无需 dev/release 模式分支。`MAD_DOM_NATIVE_PATH` 环境变量允许显式指向任意 `.node` 产物，供 CI 安装后 smoke 与本地调试使用。
- 开发入口命令由 T19 固定（形态为 `dev:build` 类脚本：本地 triple 构建 + 产物复制 + 可选 smoke），并写入开发文档；[CI](../.github/workflows/ci.yml) 现有校验（`cargo fmt/clippy/test --workspace` + `bun test tests/bun`）不受影响，是否在 CI 增加原生加载 smoke 由 T19 决定。

**发布期（T49 起）**：

- 发布构建永远从干净 checkout + 固定 toolchain（`rust-toolchain.toml` 1.93.1、`.bun-version` 1.4.0）出发，按第 2 节矩阵逐平台构建（GitHub Actions 原生 runner + musl 交叉工具链，具体供应商选择属 T49 实现细节，矩阵与命名不变），统一 `release` profile。
- 发布构建禁止复用开发者本地 `target/` 产物；开发构建与发布构建共享的只有 crate 源码与第 5 节的产物命名，二者产物不互相流入。

### 4. 拆包策略对比与选定

#### 方案 A：optionalDependencies 平台包（npm 惯例，esbuild / @swc/core / lightningcss 同型，选定）

主包保持纯 JS，平台二进制各自独立成包，通过 `optionalDependencies` 精确版本声明；npm/Bun 安装器按平台包 `package.json` 的 `os`/`cpu`/`libc` 字段自动裁剪，在支持完整裁剪的包管理器上只安装当前平台的一个包（`libc` 维度的裁剪依赖较新的包管理器，能力边界见第 6 节）。

- **优点**：安装体积最小（只下载本平台二进制）；主包无安装期脚本、无网络下载，`--ignore-scripts`、离线镜像、企业代理场景天然安全；平台选择委托给包管理器官方机制（`os`/`cpu`/`libc` 元数据），不重复发明探测；校验和与完整性由 registry integrity + 发布清单承担。
- **缺点**：npm 对 optionalDependencies 的安装失败是**静默跳过**（不报错），必须靠 require 期 fail-fast 探测兜底（第 8、9 节）；发布物数量随平台数增长，需要包模板与发布编排（T49）。

#### 方案 B：单包内嵌全部平台二进制

把所有平台的 `.node` 放进主包 `files`。优点是实现最简、无拆包歧义；缺点是每次安装下载全部平台二进制，体积随平台数倍增，npm 包体积长期膨胀，且 `files` 清单与平台裁剪能力完全脱钩。与"原生 DOM 库"的使用面（几乎任何使用者都会触发加载）矛盾明显，排除。

#### 方案 C：主包 + postinstall 下载脚本

安装时从 GitHub Releases 等渠道下载当前平台二进制。优点是只维护一个 npm 包；缺点是安装期引入网络依赖与镜像/代理脆弱性，`--ignore-scripts` 下完全失效，下载脚本本身是供应链攻击面（任意网络代码在用户机器执行），且与 npm 官方完整性机制脱节。排除。

**选定方案 A**。理由：它是唯一同时满足"安装期零网络依赖、平台选择交给包管理器、体积最小"的方案；其唯一实质缺点（静默失败）由第 6/8/9 节的 require 期机制闭环解决。

### 5. 包命名规则（精确）

- 主包：`mad-dom`（现有 [package.json](../package.json)，未变更）。
- 平台包：**`@mad-dom/platform-<os>-<arch>[-<libc>]`**，scope 为 `@mad-dom`（T49 需创建该 npm org，平台包均以 `publishConfig.access: "public"` 发布）。
  - `<os>`：npm `os` 元数据值 = `process.platform` 值：`darwin` | `linux` | `win32`。
  - `<arch>`：npm `cpu` 元数据值 = `process.arch` 值：`x64` | `arm64`；`arm`（32 位 ARM）命名规则同样保留为该模式（如 `@mad-dom/platform-linux-arm-gnu`），当前不在矩阵。
  - `[-<libc>]`：**仅 linux 出现**，取值 `gnu` 或 `musl`，两变体均显式携带后缀（自文档化，避免"无后缀 = 哪个 libc"的歧义）；darwin/win32 不带 libc 段。
- 平台包内二进制文件名：**`mad-dom.<os>-<arch>[-<libc>].node`**（与包名后缀一致，便于排障与校验和对照）。
- 平台包 `package.json` 元数据：
  - `"os": ["<os>"]`、`"cpu": ["<arch>"]`；linux 包再加 `"libc": ["glibc"]` 或 `["musl"]`；
  - `"main": "./mad-dom.<os>-<arch>[-<libc>].node"`（`main` 直接指向二进制，`require('@mad-dom/platform-…')` 即完成 dlopen；平台包不含任何 JS 包装层）；
  - 文件清单：`mad-dom.<…>.node` + `package.json` + `LICENSE` + `README.md`，无其他文件；
  - **版本恒等于对应主包版本**，随主包同批发布，永不独立演进。
- 主包声明方式：`package.json` 新增 `optionalDependencies`，**全部使用精确版本 pin**（如 `"@mad-dom/platform-darwin-arm64": "0.1.0"`，不用 `^`/`~`），锁定值 = 主包自身版本。该声明属于 T49 对 [package.json](../package.json) 的变更点；主包 `files` 清单继续排除任何 `.node`（主包永远不带原生文件）。主包顶层原生加载具有副作用，T49 落地时同步复核 `sideEffects` 声明的准确性（见第 8 节）。

### 6. 加载选择逻辑（安装期 + require 期）

**安装期**：包管理器按 optionalDependencies 的 `os`/`cpu`/`libc` 自动裁剪；在支持完整裁剪的包管理器上只安装当前平台的一个包。**`libc` 裁剪是较新的包管理器能力，不能假设普遍可用**：npm-install-checks 6.1.0（2023-03）才开始检查 `libc` 字段，而 arborist 在树构建期对 optional 依赖按 `{cpu, os, libc}` 裁剪首次出现在 arborist 9.6.0（2026-05，对应 npm ≥ 11.15）；更旧的 npm（如 8.x/10.x）不做 `libc` 裁剪，会把 gnu 与 musl 两个平台包同时装上。**Bun 1.4 安装器对 `libc` 字段的裁剪行为未经实测，是 T49 的强制验证点**——T49 必须在 Bun 1.4 下实测并记录 gnu/musl 场景的裁剪结果。裁剪不生效时会出现 gnu+musl 双包安装（安装体积增加但不影响正确性），这正是下文 require 期"linux 双 libc 变体尝试"兜底设计存在的原因；双包的消除与安装体验优化按实测结论另行处理，不构成本 ADR 的加载歧义。

**require 期（发布形态）**：

1. 按第 2/5 节的固定映射构造平台包名：linux 上先用运行时 libc 探测结果，探测规则固定为：检查 musl 动态加载器存在性（`/lib/ld-musl-<arch>.so.1` 一类 musl 特征路径），否则视为 gnu；探测结果同时写入错误信息；
2. `require('@mad-dom/platform-…')`；成功即加载完成；
3. linux 上若首个 libc 变体失败（未安装或 dlopen 失败），**允许再尝试另一 libc 变体一次**——无论安装器裁剪未生效（旧版包管理器双包安装，见"安装期"）还是目标变体缺失，该兜底都消除了 `libc` 裁剪能力差异对加载的影响；两个变体都失败时聚合两次失败原因后抛第 9 节错误；
4. 平台包加载成功后执行 abiVersion 探针（第 8 节）；通过后主包才继续初始化。

**require 期（开发形态）**：按第 3 节解析顺序——`MAD_DOM_NATIVE_PATH` 显式指定优先；其次平台包；再次仓库本地构建产物路径（具体路径由 T19 固定并写入开发文档）；全部失败抛第 9 节错误，消息指明可用入口（`dev:build` 命令或重装包）。

### 7. 产物校验与签名

- **registry integrity（基线，自动）**：npm registry 为每个 tarball 生成 sha512 integrity，安装器自动校验；这是所有安装路径的最低保障。
- **sha256 校验和清单（发布必须）**：T49 的发布 workflow 对每个平台包 tarball 与主包 tarball 计算 sha256，生成单一清单文件（`SHASUMS256.txt` 形态，列出包名 + 版本 + sha256），与 GitHub Release 产物一并发布；发布校验步骤必须核对清单内每个条目与实际上传产物一致后才允许发布主包。
- **npm provenance（发布必须）**：主包与全部平台包统一使用 `npm publish --provenance`（GitHub Actions OIDC），公开"该 tarball 由本仓库该 commit 的 CI 构建"的可验证证明；构建环境必须固定 toolchain（第 3 节），保证 provenance 有意义。
- **额外独立签名（minisign / sigstore 离线验证等）：签名增强阶段（signing 第二阶段）取舍**——本阶段独立于第 2 节的平台矩阵 phase，两者互不联动。provenance + registry integrity + sha256 清单已覆盖"构建来源可证明、传输完整可校验"的核心需求；minisign 一类离线签名需要额外密钥管理与用户侧验证工具，npm 生态中使用者校验率极低。触发条件：出现下游需要离线/镜像场景验证产物的真实需求时，再开独立 ADR 引入；在此之前不维护双签名体系。
- **不引入 postinstall smoke**（见第 8 节）。

### 8. 安装后 smoke test：require 期 fail-fast 探测

- **不做 postinstall 脚本**：postinstall 在 `--ignore-scripts`（CI 常见配置）与企业锁定环境下不执行；方案 A 的平台包也不需要任何安装期 JS。安装后验证不能依赖脚本，统一放在 **require 期**。
- **加载即探测（fail-fast）**：主包 `index.js` 在模块加载时执行第 6 节解析并完成两个探测：(1) 平台包 require/dlopen 成功；(2) **abiVersion 探针**——绑定层暴露一个返回 ABI 版本号的探针函数，主包 JS 侧持有所期望的常量值，二者不一致立即报错（对应"主包与平台包版本错配"的残存路径，如 lockfile override 导致混合版本）。探测全部通过后主包才可用；任何失败抛第 9 节错误。
- 这样，[T49](../todos/49-native-packaging-and-artifacts.md) 的"无 Cargo 环境安装 smoke test"实现为：在干净环境（独立 runner/容器，无 Rust 工具链）中 `bun add` 已发布的包（或本地 `npm pack` 产物），`import` 主包并执行一次最小 DOM 冒烟（构造文档、解析固定 HTML、一次选择器查询），断言成功；对不支持平台额外断言第 9 节错误的 `code` 与消息结构。该脚本同时服务 [T50](../todos/50-hardening-and-stable-release.md) 的全平台安装验证。
- 顶层加载具有副作用（dlopen），T49 落地时复核主包 `sideEffects` 声明：保持打包器不做"导入即裁剪"的错误假设（改为 `true` 或按实际语义调整），并在发布文档说明。

### 9. 不支持平台的错误行为

- **形态**：抛普通 `Error`，附稳定 `code`（与 [ADR-0003](./0003-native-binding-spike.md) 的错误映射形态一致：普通 `Error` 携带 `code` 属性）：
  - `code: "MAD_DOM_UNSUPPORTED_PLATFORM"`（平台不在矩阵、平台包未安装、平台包加载失败共用此 code，细节在消息内区分）；
  - ABI 探针失败使用独立 code `"MAD_DOM_ABI_MISMATCH"`。
- **消息约定（稳定、可测试）**：必须依次包含：当前 `process.platform` 与 `process.arch`（linux 附探测到的 libc）、逐次尝试的平台包名与失败原因（如 `@mad-dom/platform-linux-x64-gnu: not installed` / dlopen 原始错误文本）、以及指向支持矩阵的稳定锚点文本（README 的支持矩阵小节，具体文案由 T49 随发布文档固定）。T49 的安装 smoke 必须断言该消息结构，保证不同版本间不漂移。
- **三种失败分类**（消息中必须可区分）：
  1. 平台不在第 2 节矩阵 → 消息含"not in the supported matrix"与矩阵锚点；
  2. 平台在矩阵但包未安装（`--no-optional`、镜像裁剪、optionalDependencies 静默失败，或该平台已声明但本预发布版本未随附——见第 2 节 win32-x64 的 alpha 例外）→ 消息含"reinstall without --no-optional"一类可操作指引，未随附场景必须标明"该平台已声明、本版本未包含"；
  3. 包在但加载失败（损坏、ABI 错配、dlopen 失败）→ 消息含 dlopen/探针原始错误与版本信息。
- **禁止静默 no-op**（[TODO 队列执行规则](../todos/README.md)的发布侧落实）：主包不存在任何纯 JS 回退 DOM 实现，加载失败不得被捕获吞掉、不得降级为"假 Window/Document"，不得延迟到首次 API 调用才报错——加载即报错（第 8 节 fail-fast）。
- 非 Bun 运行时（如 Node.js）：产物是 Node-API 库，技术上可能可加载，但本仓库不验证、不承诺、不测试（[ADR-0001](./0001-basic-technical-architecture.md) 非目标）；不额外做运行时硬阻断，兼容性只在 `engines.bun >= 1.4.0` 声明的范围内成立。

### 10. 发布顺序、dist-tag 与回滚原则

- **发布顺序（强制）**：先发布全部平台包 → 校验清单内每个平台包在 registry 存在且 integrity 正确 → 最后发布主包。主包 optionalDependencies 是精确 pin，若任一目标平台包缺席就发布主包，该平台用户的 `npm install`/`bun add` 仍会成功（optional 依赖解析失败被包管理器静默跳过），但原生加载必然失败——require 期抛 `MAD_DOM_UNSUPPORTED_PLATFORM`（包缺失）或在混合版本场景抛 `MAD_DOM_ABI_MISMATCH`（第 8、9 节）；此顺序由 T49 的发布脚本硬编码，不允许跳过。
- **dist-tag 策略**：预发布与演练走 `next`（与现有 [package.json](../package.json) 的 `publishConfig.tag: "next"` 一致），主包与平台包同 tag；stable 门禁（[T50](../todos/50-hardening-and-stable-release.md)）通过后，把主包与平台包的 `latest` 显式迁移到该版本（`npm dist-tag add`），`next` 保持跟随预发布线。tag 变更是显式命令，不是重发布。
- **版本不可变与回滚**：npm 已发布版本不可覆盖，因此回滚 = 发布新版本（修复版）并把 dist-tag 指回可用版本；禁止"部分回滚"——主包与平台包版本同进同退，不得只回滚部分平台包（精确 pin 下会制造混合版本组合）。unpublish 仅限恶意代码等极端情形，并遵循 npm 政策。
- **发布演练**：T49 必须完成 alpha/beta/stable 三类发布演练与失败回滚脚本，演练必须覆盖：dist-tag 迁移、任一平台包发布失败时的中止流程（主包不得发出）、以及回滚脚本（dist-tag add 回退到上一个 healthy 版本）。
- **基线升级联动**：Bun 版本升级按 [ADR-0002](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 第 9 节流程（独立提交 + 完整门禁），且升级后必须重跑**全平台安装 smoke**（Node-API 加载与 finalizer 时序随 Bun 版本漂移的风险由 ADR-0003 记录，安装 smoke 是唯一的端到端防线）；happy-dom 基线升级不改变平台包本身，但 stable 门禁仍要求发布验证数据在当前基线下重新生成。

### 11. 对 T49 的指导映射

T49 需要实现的工件逐项对应本 ADR 的条款：

1. **主包变更**（[package.json](../package.json)）：新增 `optionalDependencies`（第 5 节精确规则）、复核 `sideEffects`（第 8 节）；`files` 保持排除 `.node`。
2. **平台包模板**：`@mad-dom/platform-<os>-<arch>[-<libc>]` 的 package.json 模板（`os`/`cpu`/`libc`/`main` 指向二进制）、二进制命名、文件清单与 public access（第 5 节）。
3. **构建 workflow**：第 2 节矩阵的逐平台 job（原生 runner + musl 交叉工具链）、统一 release profile、toolchain 固定（第 3 节）；实测并记录 glibc 下限与 Bun 安装器 libc 裁剪行为（第 2、6 节的两个强制验证点）。
4. **校验和与签名**：sha256 清单生成与核对、`npm publish --provenance`（第 7 节）。
5. **加载器与错误**：第 6 节解析顺序、第 8 节 abiVersion 探针（绑定侧探针函数由 T19/T21 的绑定实现提供）、第 9 节错误 code 与稳定消息结构。
6. **安装 smoke**：无 Cargo 环境的 `bun add` + 最小 DOM 冒烟脚本，覆盖每个已声明平台与不支持平台断言（第 8、9 节），复用为 T50 的全平台验证。
7. **发布脚本与回滚**：第 10 节发布顺序硬编码、dist-tag 管理、alpha/beta/stable 演练与回滚脚本。
8. **发布文档**：支持矩阵（第 9 节错误消息引用的锚点）、glibc 下限、构建/发布/回滚手册。

## 与仓库现状的一致性核对

| 现状 | 一致性 |
| --- | --- |
| [package.json](../package.json)：`engines.bun >= 1.4.0` | 本 ADR 第 1 节运行时下限与之一致 |
| [package.json](../package.json)：`publishConfig.tag: "next"` | 第 10 节 dist-tag 策略以其为预发布基线 |
| [package.json](../package.json)：`files` 不含任何 `.node` | 第 5 节"主包永远不带原生文件"与现状一致；T49 除新增 `optionalDependencies` 外，还需按第 8 节复核 `sideEffects` |
| [.bun-version](../.bun-version) 固定 1.4.0、[rust-toolchain.toml](../rust-toolchain.toml) 固定 1.93.1 | 第 1、3 节工具链固定引用同一来源 |
| [ADR-0003](./0003-native-binding-spike.md)：napi-rs / Node-API 选型与"平台限制"移交 | 第 1 节 Bun ABI 约束、第 2 节矩阵承接其未决项 |
| [ADR-0001](./0001-basic-technical-architecture.md) 第 8 节"拆包和平台命名不在 0001 决定" | 本 ADR 即该预留决策的结论 |
| [.gitignore](../.gitignore) 的 `*.node` 等规则 | 第 3 节开发产物不进 git/npm 的前提成立 |
| [CI](../.github/workflows/ci.yml) 现有校验集 | 第 3 节开发/发布边界不改变现有 CI 职责 |

## 非目标

- 不实现任何构建脚本、workflow、平台包模板或发布产物（[T49](../todos/49-native-packaging-and-artifacts.md)）；
- 不生成正式跨平台发布产物，不执行任何真实发布或 tag（T06 边界）；
- 不决定性能与内存回归门禁、Miri/sanitizer 计划（[T50](../todos/50-hardening-and-stable-release.md)）；
- 不引入 Node.js 运行时支持或对 Node 的验证承诺；
- 不决定发布 CI 的具体供应商细节（若 GitHub Actions 方案不可行，T49 记录替代并保持矩阵与命名不变）；
- 不把 `arm`（32 位 ARM）等未列入矩阵的平台纳入承诺。

## 影响

### 正面影响

- T49 不再有方案不确定性：矩阵、命名、声明方式、加载顺序、错误 code、发布顺序与回滚全部可执行；
- Bun ABI 依赖收敛到 Node-API 一个稳定面，平台二进制不随 Bun 内部演进重编；
- 平台选择委托 npm 官方元数据机制，主包保持零安装期脚本与零网络依赖，`--ignore-scripts`/离线镜像场景安全；
- 加载即 fail-fast 探测 + 稳定错误 code，使"不支持平台"从静默事故变成可测试契约；
- 精确 pin + 发布顺序规则保证任意版本组合安装均自洽，回滚路径明确。

### 代价与风险

- Bun 1.4 安装器对 `libc` 裁剪行为未实测（第 6 节强制验证点）；加载器的双 libc 尝试兜底了加载歧义，但安装体积与错误文案可能需按实测调整；
- musl 目标的 `panic = unwind` 与交叉编译产物质量需在 T49 实测（第 2 节已给出硬约束）；
- 跨平台 dlopen 细节（符号可见性、Windows `.dll` → `.node` 命名、MSVC 运行库）尚未实证，ADR-0003 已记录该遗留风险，首批演练可能暴露返工；
- optionalDependencies 的静默失败把正确性责任转移到 require 期 fail-fast——该路径一旦被破坏（如使用者手动预加载劫持），错误会更晚暴露；
- 平台包数量（7 个）增加发布编排与 npm org 维护成本；每批发布的 tag 迁移是显式人工步骤；
- npm provenance 依赖 CI 的 OIDC 权限配置，配置错误会阻塞发布而非产物本身。

## 后续决策

1. [T19](../todos/19-minimal-native-binding.md)：生产绑定的 dev 构建命令、本地产物路径与 abiVersion 探针的绑定侧实现；
2. [T49](../todos/49-native-packaging-and-artifacts.md)：按第 11 节实现全部工件，并回填两个强制验证点（glibc 下限、Bun libc 裁剪）的实测结论；
3. [T50](../todos/50-hardening-and-stable-release.md)：stable 门禁下 dist-tag 迁移 `latest` 的最终执行；
4. 额外独立签名（minisign 等）：仅当出现离线验证需求时开新 ADR。

## 参考资料

内部：

- [ADR-0001：基础技术架构](./0001-basic-technical-architecture.md)（第 2 节运行时与语言、第 8 节目录结构中预留的拆包决策）
- [ADR-0002：happy-dom 兼容基线与差分协议](./0002-happy-dom-compatibility-baseline-and-differential-protocol.md)（第 1 节判定环境、第 9 节基线/运行时升级流程）
- [ADR-0003：Bun/JSC 原生绑定技术选型](./0003-native-binding-spike.md)（决策与平台限制、移交 T06/T49 的未决项）
- [ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)（M0 工作项"首批目标平台的本地构建方式"、M9 构建发布与发布门禁）
- [TODO 队列](../todos/README.md)（执行规则：依赖顺序与禁止静默 no-op）
- [T04：Bun/JSC 原生绑定原型](../todos/done/04-native-binding-spike.md)、[原型构建脚本](../spikes/native-binding/build.sh)、[原型 smoke test](../spikes/native-binding/spike.test.js)
- [T06：确定原生产物构建与发布架构](../todos/06-native-build-adr.md)
- [T19：最小生产绑定](../todos/19-minimal-native-binding.md)
- [T21：原生错误与安全边界](../todos/21-native-error-and-safety-boundary.md)
- [T49：原生多平台构建与 npm 产物](../todos/49-native-packaging-and-artifacts.md)
- [T50：安全、性能、文档与 stable 门禁](../todos/50-hardening-and-stable-release.md)
- [package.json](../package.json)、[.bun-version](../.bun-version)、[rust-toolchain.toml](../rust-toolchain.toml)、[.gitignore](../.gitignore)、[CI workflow](../.github/workflows/ci.yml)
- [生产绑定 crate](../crates/mad-dom-bun/Cargo.toml)、[主包入口](../index.js)

外部：

- [Node-API 规范（Node.js 文档）](https://nodejs.org/api/n-api.html)
- [napi-rs（napi / napi-derive）仓库](https://github.com/napi-rs/napi-rs)
- [npm package.json 字段：os / cpu / libc / optionalDependencies / provenance](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
