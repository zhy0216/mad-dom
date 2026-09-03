difficulty: easy

# 03 · 新建 docs/platforms.md（平台与安装页）

## T1 · 编写 platforms 页

要做什么：

- 新建 `docs/platforms.md`，全英文，用户向。
- 内容（事实基准）：
  1. 安装：`bun add -d mad-dom`；平台二进制以 optional npm 包
     `@mad-dom/platform-*` 分发，`bun add` 直接可用，无需编译，无需 Rust；
  2. 平台矩阵表（两行）：
     - Available now (alpha)：macOS arm64、macOS x64、Linux x64 (glibc)、
       Linux arm64 (glibc)；
     - Coming in beta：Windows x64、Linux x64 (musl)、Linux arm64 (musl)；
  3. 运行要求：Bun >= 1.4.0；Linux glibc >= 2.39（首个 linux CI release
     build 实测值）；
  4. Troubleshooting 小节（错误名必须准确）：
     - `MAD_DOM_UNSUPPORTED_PLATFORM`：当前平台不在矩阵内，或平台包没装上
       （检查是否用了 `--no-optional` / `omit=optional`）；
     - `MAD_DOM_ABI_MISMATCH`：二进制与主包版本不匹配（混版本安装），
       重装 `mad-dom` 即可；
  5. 不提发布流程、脚本、checksum、ADR（那些属于维护者文档）。

预计修改文件：`docs/platforms.md`（新建）。

验收条件：

- `bun run docs:build` 成功，无死链；
- 页面内无 "ADR" 字样；平台矩阵与 `package.json` optionalDependencies 的
  7 个包一致（alpha 4 个在矩阵上半，其余 3 个在 beta 行）。

前置依赖：无。
