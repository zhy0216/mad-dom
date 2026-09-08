difficulty: medium
agent: inherit

## T1 · 追随 latest Bun 的 CI 与发布策略

### 要做什么

- 将当前 `.bun-version=1.4.0`、README/docs/ADR/benchmark 中的版本语义拆成最低支持版本、baseline 版本和 latest 验证版本；不要把 baseline 描述成产品精确绑定。
- 用户明确要求跟随最新 Bun，覆盖当前 `AGENTS.md` 中固定 1.4.0 的旧策略；同步修正该指引。历史 benchmark/ADR 的实测版本必须保留为历史事实，不能批量把历史 1.4.0 替换成 latest。
- 增加 latest Bun CI lane，覆盖 check、Rust、native build、FFI capability、native tests、compat、WPT、integration、install smoke 和 benchmark sanity；保留 baseline lane 供回归定位。
- 让 release/package metadata、platform package、Node-API ABI、FFI ABI 和 capability level 一致；FFI 不可用时主包仍能发布 Node-API fallback。
- 更新 loader/release 文档，说明 latest capability failure、FFI disabled、ABI mismatch、platform binary missing 的区别。
- 避免通过固定 Bun 小版本规避问题；新增失败报告要包含 Bun version、capability matrix、platform/libc、native ABI 和 FFI ABI。

### 预计修改文件

- `.bun-version`
- `AGENTS.md`（仅 Bun 版本策略段）
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `README.md`
- `docs/platforms.md`
- `docs/release.md`
- `docs/performance.md`
- `adr/` 中版本/capability 记录
- `scripts/release.mjs`
- `scripts/install-smoke.mjs`

### 验收条件

- CI 明确区分 latest 与 baseline；latest lane 不再隐式使用 1.4.0 伪装为最新。
- package engines 表示最低支持版本，文档不再把开发基线写成精确运行时锁定。
- latest 下 FFI enabled、FFI unavailable、Node-API fallback 三种发布/安装 smoke 都能给出稳定结果。
- release 产物中 main/platform/FFI ABI 和 capability 元数据版本一致，错误可诊断。
- workflow YAML 校验、`bun run smoke:install`、release draft/checksum dry run 和相关 docs checks 通过。

### 前置依赖

依赖 `01-capability-matrix-and-benchmarks.md`、`03-bun-ffi-loader-and-facade.md`（避免 install-smoke/packaging 文件并行冲突）；可与 04、05 并行。

### 初次实现与验收记录（2026-09-07，历史记录）

初次验收时，06 专项已完成，但完整 suite 的两项原分支失败尚待 04
修复，因此当时未归档。下方保留原始结果；两项问题现已随 04 合入解决，
最终串行整合结果见本文最后一节。

#### 逐条验收

1. **latest/baseline 明确区分**：`ci.yml` 两条 lane 分别显式请求
   `bun-version: latest` 与 `bun-version-file: .bun-version`，均包含 check、
   Rust fmt/clippy/tests、native build/probe/tests、compat/types/ledger/hdunit、
   WPT、integration、bench sanity、docs、release draft/checksum 与真实安装。
   `release.yml` 先依赖可复用 CI，再用 latest 构建平台包。
2. **版本语义**：engines 保持最低 `>=1.4.0`，`.bun-version` 保持可复现
   baseline `1.4.0`，不作 latest 标记。AGENTS、README、platform/release/
   performance 文档与 ADR-0010 说明区别；历史 benchmark/ADR 实测数字未替换。
   官方 GitHub stable API 实际返回 Bun 1.4.2，发布时间
   `2026-09-05T05:55:48Z`；setup-bun 的官方源码证实显式 version 优先。
3. **发布/安装 fallback**：实际 main + linux-x64-gnu tarball 在 Bun 1.4.2
   和 1.4.0 均通过 automatic enabled、disabled、FFI path unavailable、
   FFI ABI mismatch、partial symbols、required binary missing/unsupported、
   Node-API ABI mismatch 和 metadata tamper 检查。另以本次源码 binary
   的隔离 Linux fixture 屏蔽 FFI 导出名，验证真正 unavailable symbols 的
   Node-API-only build、draft、checksum 与自动 fallback 安装；只携带一个
   image。fixture 仅测试，绝不作为发布输入。`MAD_DOM_FFI_DISABLED=1`
   构建也能产生 Node-API-only 元数据和合法 draft。
4. **产物一致性**：main/platform `madDomRuntime` 统一 npm version、Node-API
   ABI 1、FFI ABI 1、支持位 31、`ffiRequired: false`；`madDomBuild` 记录
   实测 Bun/revision、platform/libc、两通道 capability 与 binary SHA-256。
   reuse 拒绝错误版本/ABI/bitset/level、错误平台、checksum 变更和第二套 image。
   `--version 0.0.1-alpha.06-dry-run` 的 build → draft → install 全链通过。
5. **专项检查通过**：actionlint 1.7.12、docs build、release metadata tests、
   真实 tarball smoke、draft/checksum dry run 均通过。当时完整 repo gate 有
   下述两项已知依赖，初次验收没有声称全部通过或提前归档。

#### 实际环境与命令结果

- Linux x64 / glibc 2.39；Rust 1.93.1；`CARGO_BUILD_JOBS=3`。
- 本机 Bun 1.4.2 (`744846f84`) 与单独下载的官方 baseline 1.4.0
  (`34cbb9a40`)；baseline 子进程通过 PATH 选同一 executable。
- Native 测试显式设置 `MAD_DOM_NATIVE_PATH=$PWD/build/mad-dom.node`、
  `MAD_DOM_FFI_PATH=$PWD/build/mad-dom.node`。安装 smoke 清除这些覆盖，
  断言实际选用 tarball 中的 image。

| 命令/检查 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile`、`bun run dev:build` | 两版均通过；初次主机缺 `cc`，补齐 build-essential 后构建成功，没有改依赖/锁文件 |
| `bun run check` | 两版通过 |
| `cargo fmt --check` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo test --workspace` | 687 passed / 0 failed（Rust 工具链与源码相同，只需验证一次） |
| `bun run compat:types` | 两版通过，24 fixtures，双目标 0 diagnostics |
| `bun run test:native` | 两版各 8 passed / 0 failed |
| `bun run test:release` | 两版各 13 passed / 0 failed，含真实无 FFI exports 的 tarball fixture、reuse 元数据/二进制篡改拒绝 |
| `bun run validate` / `bun run test` | 未通过；1.4.2 初次 1111 pass / 2 fail，1.4.0 全套 1124 pass / 2 fail；两版失败相同，见下文。后续新增专项测试单独通过 |
| `bun run compat:hdunit:rewrite` | ledger 前生成；两版均通过，后续再次 rewrite 幂等 |
| `bun run compat:ledger` | 两版通过，449 entries，180 real-pair scenarios，0 regressions |
| `bun run compat:hdunit:validate` | 两版通过，298 files 已声明终态 |
| `bun run wpt:test` | 两版 5 runner tests 通过；这是既有 WPT 合约门禁，不是所有上游 WPT 全通过的声明 |
| `bun install --frozen-lockfile --cwd benchmark/mad-dom-integration-test`；`bun run test:integration` | 安装通过，两版各 10 tests / 0 fail，加独立 exception observer；test:ci 排除外网 Browser 场景 |
| `bun run probe:bun:selftest` / `bun run report:runtime --require-native` | 两版通过；FFI ABI 1 / bitset 31，API-presence 与 ownership safety 保持区分 |
| `bun run bench:bun-native:selftest`、`bun run bench:bun-io:selftest`、`bun run bench:dom --runs 1 --sizes 0.01` | 两版通过；tiny run 仅 correctness sanity |
| `bun run bench:check`（1.4.2） | 首次建立 Linux host baseline，exit 0；不是与 macOS baseline 的跨主机性能回归通过 |
| `bun run bench:check`（1.4.0 复用本次 1.4.2 host baseline 的额外比较） | exit 1：GC RSS delta 为负值时既有乘法阈值给出 `-22.44` vs ceiling `-37.14` MiB；不能直接判定内存退化，不改 04/07 benchmark 范围，待整合复核 |
| `actionlint 1.7.12 .github/workflows/ci.yml .github/workflows/release.yml` | 通过；1.7.7 不认识仓库原有 macos-15-intel runner，改用当前 linter 后通过，不改 runner 规避检查 |
| `bun run docs:build` | 两版通过 |
| `npm pack --dry-run --json --registry=https://registry.npmjs.org` | 发布面检查通过，不含 tests/compat/benchmark/scripts/Cargo 资产 |
| `bun run platform:build --artifact build/mad-dom.node --out build/release/platform`；`bun run release:draft --no-build` | 通过，真实 host platform + main 两个 tarball；host-only draft 明确标记矩阵不完整 |
| `bun run checksums verify build/release/tgz --manifest build/release/SHASUMS256.txt` | 两个 tarball SHA-256 均重算一致 |
| `bun run smoke:install --main-tgz build/release/tgz/mad-dom-0.0.1-alpha.3.tgz --platform-tgz build/release/tgz/mad-dom-platform-linux-x64-gnu-0.0.1-alpha.3.tgz --expect-ffi available` | 两版通过；附加 `--out` 为 baseline 隔离输出；无 missing-artifact 假失败 |
| disabled / unavailable fixture / version override 各自独立 `--out` 的 draft 与 smoke | 均通过；main/platform 同版本、单 image、metadata/checksum 一致 |
| `git diff --check` | 通过 |

#### 初次验收发现的问题与边界（历史）

- `tests/compat/runner.test.js:516` 把 navigator.platform 写死为
  `X11; Darwin arm64`，实际 Linux 为 `X11; Linux x64`；隔离可稳定复现。
- `tests/bun/native-node-contract.test.js:418` 全套有其他待 GC 文档造成
  live-document 计数污染；单独该文件 12/12 通过。协调器已将两处修复交给 04，
  本任务不改、不 skip、不替换断言，CI 保留原 gate。
- 上述额外 baseline benchmark 的负 delta 阈值问题保留原始失败证据。
- 未运行任何 hosted matrix / 远端 workflow；macOS、arm64、Windows、musl
  不作本地已验证声明。musl 必须在能真实加载该 payload 且 libc 匹配的环境
  测量；仅在 glibc runner 安装 cross toolchain 不足以通过新 metadata gate。
- 通用 externalDeallocator 仍为 `api-present-unverified`；没有把 API 存在
  写成 ownership safety 已验证，不复述“不支持 deallocator”；默认 caller-owned，
  实测内存/GC 协议与 ADR-0009 由 04 负责。

证据：`adr/0010-latest-bun-ci-and-release-policy.md`；本地 ignored
`build/release/runtime-metadata.json`、`build/release/SHASUMS256.txt`、
`build/smoke*/runtime-results.json`；各命令日志 `/tmp/mad-dom-06-*.log`。

### 串行整合完成记录（2026-09-08 UTC）

状态：06 验收完成并归档。按协调器授权，当前任务分支 rebase 到
`main=49351d2c346bab2156ac029345f5e95995f379f2`，没有冲突；人工检查确认
04 的源码/测试/文档均保留，队列 README 的 04 done 行没有被覆盖，06 的
历史验收结果也保留。未 merge/push/创建 PR/publish，最终修改只 amend
06 原任务 commit。

#### 原失败修复与新增 metadata 修复

- 04 将 native-node-contract 的严格 GC counter 验证放入同版本子进程，
  消除全套遗留文档的计数污染；将 Navigator 平台断言改为 happy-dom 实际
  结果对照。两版完整 gate 均证明旧失败已消失，本任务未修改这两个文件。
- 协调器从真实平台 metadata 复现 `ffi.capabilities=2**32+31`、
  `capabilityLevel=ffi-partial` 被 JS 位运算截断后错误接受。本任务新增
  明确的整数/u32 范围检查，先验证 `[0, 0xffffffff]`，然后才进行 known-bit
  检查。disabled/unavailable/mismatch 中显式提供的 capability 值也必须
  满足 u32；partial 零能力 fallback 保持合法。
- 新增六个测试覆盖溢出、负值、非整数、NaN/Infinity 及非启用 partial
  情形；两版最终 `bun run test:release` 均 **19 pass / 0 fail**。
  真实 `build/06-integrated/latest-release` metadata 的 4294967327 样例
  返回 `MAD_DOM_METADATA_MISMATCH`，原声明与 ABI/capability 位未放宽。

#### 完整 gate 的实际时点

| Runtime | 命令 | Rust / Bun 数量 | 时点与结果 |
| --- | --- | --- | --- |
| latest 实测 1.4.2 / `744846f84` | rewrite 后 `bun run validate` | Rust **691**；Bun **1140 / 0 fail** | exit 0；完整 gate 在 u32 修复前完成，日志最后写入 2026-09-08 02:33:10 UTC |
| baseline 1.4.0 / `34cbb9a40` | rewrite 后 `bun run validate` | Rust **691**；Bun **1146 / 0 fail** | exit 0；命令启动早于 u32 修复，实际测试阶段加载了新增六项；日志最后写入 2026-09-08 02:40:11 UTC |
| 两版最终源码专项 | `bun run test:release` | 每版 **19 / 0 fail** | u32 修复完成后分别运行，含真实 unavailable fixture 的 build/draft/install 与 metadata/hash 篡改拒绝 |

两次完整 validate 均执行 check、cargo fmt/clippy/tests、compat types、
完整 Bun tests、ledger、hdunit rewrite/validate、WPT。ledger 仍为
449 entries / 180 real-pair scenarios / 0 regressions，types 24 fixtures，
hdunit 298 files，WPT runner 5 tests。没有把旧的 latest 全套结果声称为
最终 immutable commit 的全套结果；按协调器指示，不仅因 u32 局部修复
机械重跑 latest 全套，协调器将对最终提交独立运行完整 gate。

Baseline 使用任务内 `build/tools/baseline/bun-linux-x64/bun` 并将该目录
置于 PATH 首位；断言 `process.execPath === Bun.which('bun')`，完整 revision
与绝对路径记录在 `build/06-integrated/baseline-executable.json`。
两版 frozen install、当前 worktree native rebuild 都成功。

#### 新 binary 与真实产物

当前 worktree `build/mad-dom.node` SHA-256：

`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`

它与 rebase 前 binary 不同。Node-API ABI=1、FFI ABI=1、有效能力=31；
两版 runtime reports 都选择本 worktree 的同一 image。以 `--artifact`
重新生成平台 metadata，分别在 latest/baseline 下 draft、重算 checksum、
真实安装 main/platform tarball，确认 payload hash 与上述 binary 一致。
在 u32 修复后再次打包主包，最终 main tarball SHA-256：

`ab7dbac4673f19d9621681f8875bb8ff151d7e8fdbf435ceee1db1008641fffd`

平台 tarball SHA-256（相同 binary，构建观察 Bun 不同）：

- latest：`b10437ac3aaf1c39f2301057703d4179a290405e25935682694e7dfd7eae3705`
- baseline：`c7ef7a5bfd8d652d9f07bdd377602e92a146c554d5103bff1167c52aa1ae9d2c`

`MAD_DOM_FFI_DISABLED=1` 平台构建产生合法 Node-API-only 元数据并通过
完整 draft/install；运行时 opt-out 检查报告 disabled。新的 unavailable
Linux fixture 从本次 binary 仅屏蔽 FFI 导出名，仍只携带一个 image，
其 SHA-256 为 `cb31fd97e682bd98c02644ac21b16faaec241a4d3a6809d6e77acd60d183ec97`。
它的 Node-API-only draft、checksum 与自动 unavailable 安装在两版均通过，
不作为发布输入。所有 smoke 仍包括 ABI mismatch、partial symbols、缺失/
不支持平台、Node-API fallback、版本/元数据错误。

实际命令（每个输出目录独立；包路径均存在才运行 smoke）：

```sh
bun install --frozen-lockfile
CARGO_BUILD_JOBS=3 bun run dev:build
# 所有源码 native/FFI gate 设置为当前 worktree build/mad-dom.node
bun run compat:hdunit:rewrite
bun run validate
bun run report:runtime --require-native
bun run test:release
build/tools/actionlint .github/workflows/ci.yml .github/workflows/release.yml
bun run docs:build
bun run test:integration
bun scripts/bench-ffi-gc.mjs --json --require-ffi
bun run bench:bun-native:selftest
bun run bench:bun-io:selftest
bun run bench:dom --runs 1 --sizes 0.01
bun run platform:build --artifact build/mad-dom.node --out build/06-integrated/latest-release/platform
bun run release:draft --no-build --out build/06-integrated/latest-release
bun run checksums verify build/06-integrated/latest-release/tgz --manifest build/06-integrated/latest-release/SHASUMS256.txt
bun run smoke:install --out build/06-integrated/latest-smoke --main-tgz build/06-integrated/latest-release/tgz/mad-dom-0.0.1-alpha.3.tgz --platform-tgz build/06-integrated/latest-release/tgz/mad-dom-platform-linux-x64-gnu-0.0.1-alpha.3.tgz --expect-ffi available
```

以上相关门禁均通过；baseline 对应命令通过 PATH 选 1.4.0，并使用
`baseline-release` / `baseline-smoke` 独立目录。disabled、unavailable 目录
保留各自 metadata、checksums 与 runtime results。最终两版 integration
各 10 tests / 0 fail，独立 exception observer 成功；FFI GC benchmark
各实际调用六种 operation，documents/registrations/cache delta 均为 0。
两版 boundary/IO/tiny-DOM sanity、docs build 通过；actionlint 1.7.12 通过；
额外 vendored happy-dom v20.11.11 的 `vendor-happy-dom-tests.mjs --verify`
通过。此前额外 `bench:check` 负 RSS delta 阈值失败保留为历史，交给 07；
没有修改 benchmark 逻辑或宣称该阈值已修复。

Integration 的本地 `file:../..` 依赖曾发生复制 ENOENT，导致短暂缺包；
不是 DOM 功能失败。将不完整安装目录移到任务备份，并执行
`bun install --frozen-lockfile --cache-dir /home/ubuntu/.cache/mad-dom-06-integration/fresh-cache --cwd benchmark/mad-dom-integration-test`
后，79 个锁定包安装成功，两版原始 `bun run test:integration` 命令通过。
没有改 integration manifest/lockfile/测试，没有以缺包结果代替功能验收。

#### 最终证据与范围

- `build/06-integrated/evidence.json`：两版全套数量/时点、native 与四组
  release 的 binary/tarball hashes、capability level。
- `build/06-integrated/{runtime-latest,runtime-baseline,baseline-executable,u32-tamper-result}.json`。
- `build/06-integrated/{latest,baseline,disabled,unavailable}-release/`：
  `runtime-metadata.json`、`SHASUMS256.txt`、`tgz/`。
- `build/06-integrated/*-smoke/runtime-results.json`；两版 FFI GC bench JSON。
- `/tmp/mad-dom-06-integrated-{latest,baseline}-validate.log`、
  `/tmp/mad-dom-06-integrated-u32-{latest,baseline}-tests.log` 及同前缀各专项日志。

验收范围仍为 Linux x64/glibc 2.39。Linux-only unavailable fixture 不证明
其他平台行为；macOS、arm64、Windows、musl 与 hosted matrix 未在本任务
运行。External deallocator 的通用 API-presence 报告仍是
`api-present-unverified`，04 的真实 native callback spike 与其生产所有权
限制分别记录于 ADR-0009；默认 caller-owned 与 FFI ABI v1 契约不变。
