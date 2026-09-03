# Roadmap 001 — alpha 发布收口 → beta 全平台矩阵 → stable 收口

- 状态：提案（2026-09-03 盘点）
- 依据：ADR-0005（构建发布架构）、`docs/release.md`（发布手册）、
  `docs/stable-gate-report.md`（T50 stable-gate 证据）、npm registry 实况、
  `tests/happy-dom/COVERAGE.md`（hdunit 口径）

## 背景（现状盘点）

门禁侧已收口：happy-dom 锁定基线（`20.11.11` @ `64e2c774…`）ledger 43/43
100% pass；safety 套件（Core `forbid(unsafe_code)`、Miri、ASan）与性能/内存
基线（19 项指标，`bench/baseline.json`）均已建立并进 CI。

发布侧存在三个实际问题（2026-09-03 `npm view` 实测）：

1. **平台包缺发**：主包已有 `0.0.1-alpha.0/1/2`（`next` = alpha.2），但
   `@mad-dom/platform-*` 只有 `platform-darwin-arm64@0.0.1-alpha.1` 在
   registry，其余 6 个全部 404。主包 optionalDependencies 是精确版本 pin，
   所以安装 `mad-dom@next` 在任何平台都会运行时报
   `MAD_DOM_UNSUPPORTED_PLATFORM`（mad-dom-publish skill §2 记录的正是此坑）。
2. **dist-tag 违反政策**：`latest` 目前指向 `0.0.1-alpha.0`；ADR-0005 §10
   规定预发布只进 `next`，`latest` 由 stable 收口迁移。
3. **版本脱节**：仓库 `package.json` 仍是 `0.0.1-alpha.0`，registry 已发到
   alpha.2；仓库无对应 git tag。

## P0 — alpha 发布收口（最急）

alpha 平台集（ADR-0005 §2，省略 win32-x64 与 musl）：
`darwin-arm64`、`darwin-x64`、`linux-x64-gnu`、`linux-arm64-gnu`。

- [x] 版本联动：仓库与下一次发布统一到同一新版本（如 `0.0.1-alpha.3`），
      主包 optionalDependencies 全 pin 到该版本；补打对应 git tag。
      （2026-09-03 完成：`0.0.1-alpha.3` + `v0.0.1-alpha.3` tag，本地待 push；
      顺带修复 `release.mjs publish` 引用未定义 `mainTgz` 的崩溃 bug 与
      registry integrity 传播重试——原实现在真实发布时会在发完 platform 包后、
      发主包前 ReferenceError，且 `npm view` 无传播延迟容忍。）
- [x] 经 `release.yml` 在 native runner 上构建剩余 3 个平台并各自跑
      `install-smoke.mjs`（本机只有 darwin-arm64 target，交叉构建留给 CI）。
      （2026-09-03 dry-run 彩排绿，run 33728552831：4/4 alpha 平台构建+smoke。
      过程中修了三个 CI bug：rustup 未装 matrix target（darwin-x64 编译失败）、
      darwin-x64 用了 arm64 runner（smoke 加载失败→ macos-15-intel）、
      artifact 路径丢 `@mad-dom` 层级（verify 打包 0 个平台包）。）
- [x] 发布顺序：platform 包先发 → registry integrity 校验 → 主包最后发
      （CI 走 `release.mjs publish --no-dry-run` + `MAD_DOM_ALLOW_PUBLISH=1`，
      provenance 只能由 GitHub Actions 产生，本地发布不能加 `--provenance`）。
      （2026-09-03 代码侧收口：修掉 publish 路径未定义 `mainTgz` 的崩溃 +
      integrity 传播重试；dry-run 彩排已按此顺序打印完整计划。
      真实发布待授权；⚠️ `release.yml` 目前没有任何 npm 认证步骤——
      真实 publish 会在第一个 `npm publish` 就 ENEEDAUTH，需先给
      verify job 配 NPM_TOKEN secret（automation token + 写 ~/.npmrc）
      或为 @mad-dom 开启 trusted publishing。）
- [ ] 发布后验证：干净环境 `bun add mad-dom@next`，四个断言
      （happy path / missing-platform / unsupported-platform / ABI mismatch）。
- [x] 决策项：`latest` 指向 alpha.0 的处理方式——按政策等 stable 迁移，还是
      先行摘除（`npm install mad-dom` 目前会装到无平台包的 alpha.0）。
      （2026-09-03 实测：摘除不可行，registry 对 DELETE dist-tags/latest 返回
      E403——`latest` 只能被覆盖不能被删除。决策回退为按 ADR-0005 §10 等
      stable gate 迁移；裸装 alpha.0 会在运行时 fail-fast 报
      MAD_DOM_UNSUPPORTED_PLATFORM，无静默错误。）
- [x] 首次 linux CI release build 完成后，回填 `docs/release.md` 两个 TBD：
      glibc floor（runner `ldd --version`）、Bun 1.4 installer `libc`-trimming
      实测（gnu/musl 是否双装）。
      （2026-09-03：glibc floor 已实测回填 = **2.39**（x64+arm64 两个 gnu
      runner 均记录，workflow 已加 `ldd --version` 步骤）；libc-trimming 需
      gnu+musl 同时在 registry 才能测，alpha 集不含 musl → 实测顺延到 beta，
      文档已记录测量方法。）

## P1 — beta：7 平台全矩阵

- [ ] 补齐 `win32-x64`（msvc runner）与 `linux-x64-musl`、
      `linux-arm64-musl`（`taiki-e/setup-cross-toolchain-action`）。
- [ ] 全矩阵逐平台 install smoke + sha256 checksum manifest 校验。
- [ ] `bun run bench:check` 在 release 流程中无回归。

## P2 — stable 收口

- [ ] stable-gate 证据复核（`docs/stable-gate-report.md` 数字可重放）。
- [ ] `latest` dist-tag 从 alpha.0 迁移到 stable 版本（ADR-0005 §10，
      stable gate 拥有该迁移）。
- [ ] README/文档中阶段描述与版本对齐。

## P3 — 兼容轨（与发布轨并行）

- [ ] WPT 测量轨扩容：当前子集 3 case、37 pass / 56 fail（39.8%，
      93 assertions）。纯测量、不改 happy-dom 契约；扩子集时更新
      `tests/wpt/manifest.json` 的 commit pin 与上游归属。
- [ ] `up`（ported upstream）套件：目前 0 条目；移植案例须记入
      `compat/upstream-map.json` 溯源（ADR-0002 §7.4）。
- [ ] hdunit 尾巴：剩 11 个仅含 enum/type-only 内部导入的文件，等
      T12 机械路线启用（`tests/happy-dom/COVERAGE.md`）；147 个已差分移植、
      38 个已豁免，口径不动。
- [ ] happy-dom 基线仍锁 `20.11.11`；上游新版本 rebase 属独立决策，
      触发时走 ADR-0002 协议（基线清单 + 差分重跑）。

## P4 — 文档卫生（小）

- [x] `docs/release.md`（`npm ci`）、`docs/compat-report.md`、
      `docs/stable-gate-report.md` 中的 `npm run` 残留改为 `bun run`
      （`npm pack` / `npm publish --provenance` 例外，见 AGENTS.md）。

## 验证命令

```sh
bun run validate                 # 仓库级全门禁
bun run compat:ledger            # 兼容契约回归
bun run smoke:install            # 无 Cargo 安装 smoke（四断言）
bun run release:draft -- --stage alpha   # 发布彩排（不触 registry）
```
