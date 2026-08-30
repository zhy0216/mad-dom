# 49 实现原生多平台构建与 npm 产物

- 状态：部分完成
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T49`
- 依赖：T06, T21, T48
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按构建 ADR 生成、校验并发布可被支持平台 Bun 直接加载的原生产物。

## 条目

- [x] **T49 — 实现原生多平台构建与 npm 产物**
  - 实现：
    - 实现目标平台矩阵构建、平台包拆分和运行时加载选择。
    - 生成校验和/签名所需元数据，并增加缺失或不支持平台错误。
    - 建立打包后在无 Cargo 环境中的安装 smoke test。
    - 实现 alpha/beta/stable 发布演练和失败回滚脚本。
  - 验收：
    - 每个目标平台产物可重复构建并通过安装后 smoke test。
    - npm 包只包含预期文件和正确类型/ESM 入口。
    - 不支持平台得到清晰、稳定的加载错误。

## 预期改动

- 构建/发布脚本
- `package.json` 与平台包元数据
- CI workflows
- 安装 smoke tests
- 发布文档

## 专属校验

- 平台构建与安装 smoke
- `npm pack --dry-run`
- 完整统一校验
- 发布 dry-run

## 边界

不 push tag、不发布 npm，除非用户在执行该 todo 时另行明确授权。

## 结果

- 全部实现落地并按 ADR-0005 逐条对照验证；宿主平台（`aarch64-apple-darwin`）
  端到端验证通过。非宿主平台原生产物受限于本机无交叉工具链，交由
  `release.yml` 矩阵在各自 native runner 构建并跑安装 smoke，本机无法本地验证
  （见下方 blocker，故状态为「部分完成」，不误标完成）。
- 验收逐条：
  1. **每个目标平台产物可重复构建并通过安装后 smoke test**——宿主平台实测通过：
     `scripts/build-platform-package.mjs` 从干净 toolchain（1.93.1 / Bun 1.4.0）
     可重复构建，`scripts/install-smoke.mjs` 全部 4 项断言通过（happy path /
     missing-platform / unsupported-platform / ABI mismatch）；其余 6 个平台由
     `.github/workflows/release.yml` 矩阵构建并安装 smoke（blocker）。
  2. **npm 包只包含预期文件与正确类型/ESM 入口**——`npm pack --dry-run` 37 文件、
     含 `index.js`/`index.d.ts`/`js/`/`README.md`/`LICENSE`，无任何 `.node`；
     平台包 tarball 恰为 `mad-dom.<os>-<arch>[-<libc>].node` + `package.json` +
     `LICENSE` + `README.md`，`main` 直指二进制，`os`/`cpu`/`libc` 元数据正确。
  3. **不支持平台得到清晰、稳定的加载错误**——`MAD_DOM_UNSUPPORTED_PLATFORM` /
     `MAD_DOM_ABI_MISMATCH` / `MAD_DOM_NATIVE_NOT_FOUND` code 稳定，消息依次含
     当前 platform/arch（linux 附 libc）、逐次尝试与失败原因、README 支持矩阵锚点；
     `tests/bun/native-loader.test.js`（11 例）+ 安装 smoke 断言覆盖。
- 专属校验结果：
  - 平台构建与安装 smoke：`bun scripts/install-smoke.mjs` 全绿（宿主平台）；
  - `npm pack --dry-run`：通过；
  - 完整统一校验：`npm run validate` 通过（603 tests / 0 fail，cargo fmt/clippy/
    test、compat:types、compat:ledger、wpt 全绿）；
  - 发布 dry-run：`release.mjs draft --stage alpha/beta/stable` 与
    `release-rollback.mjs --dry-run` 全部输出有序计划且不触碰 registry；
  - `git diff --check` 通过。
- Blockers（待补齐，不构成本任务误标完成的理由）：
  - 非宿主平台产物无法在本机构建与验证（无交叉工具链/对应 OS runner）；`release.yml`
    的构建 + 安装 smoke 矩阵需运行 CI 后逐平台确认。
  - glibc 下限与 Bun 1.4 对 optional 依赖 `libc` 字段的安装裁剪行为需在首个 linux
    CI release build 实测后回填 `docs/release.md`（方法学与 TBD 已记录）。
  - 既有 T38 `timeStamp` 测试在毫秒边界偶发失败（原生 `SystemTime::now()` 同 ms
    碰撞），与 T49 改动无关，validate 复跑通过。
