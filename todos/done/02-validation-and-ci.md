# 02 建立统一校验命令与基础 CI

- 状态：已完成
- 优先级：P0
- 里程碑：M0
- 条目 ID：`T02`
- 依赖：T01
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

让全新 checkout 能通过有文档记录的一组命令完成 JavaScript、Rust 和包入口校验。

## 条目

- [x] **T02 — 建立统一校验命令与基础 CI**
  - 实现：
    - 在 `package.json` 增加格式清晰的 check/test/validate scripts，并补最小 Bun smoke test。
    - 将 `npm run validate` 固定为仓库级门禁，至少依次执行 JavaScript 检查、`cargo fmt --check`、Clippy、`cargo test --workspace` 和 Bun 测试。
    - 固定 Rust toolchain 和开发使用的 Bun 版本记录。
    - 增加 CI，运行 JS 检查、Rust fmt、Clippy、测试和包 smoke test。
    - 在 README 记录本地开发与校验命令。
  - 验收：
    - 本地统一校验命令一次通过。
    - CI 从空缓存 checkout 可重复运行。
    - 校验至少能发现 JS 语法错误、Rust 编译错误、Clippy 警告和 smoke test 失败。

## 预期改动

- `package.json`
- 锁文件或运行时版本文件
- `.github/workflows/**`
- `tests/bun/**`
- `README.md`

## 专属校验

- `npm run validate`
- `npm pack --dry-run`

## 边界

不加入产品功能，不配置正式多平台发布。
