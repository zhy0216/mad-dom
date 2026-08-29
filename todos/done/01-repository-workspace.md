# 01 建立 Cargo workspace 与目录骨架

- 状态：已完成
- 优先级：P0
- 里程碑：M0
- 条目 ID：`T01`
- 依赖：无
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

建立 ADR-0001 约定的 Rust workspace、crate 依赖方向和实现目录，使 Core 能脱离 Bun 独立编译。

## 条目

- [x] **T01 — 建立 Cargo workspace 与目录骨架**
  - 实现：
    - 创建根 `Cargo.toml`、`crates/mad-dom-core` 与 `crates/mad-dom-bun`。
    - 创建 `js/`、`compat/`、`tests/rust`、`tests/bun`、`tests/compat`、`tests/wpt` 目录骨架。
    - 保证只有绑定 crate 依赖 Core，Core 不包含 Bun/JSC 依赖。
  - 验收：
    - `cargo metadata` 能识别两个 workspace member。
    - `cargo check --workspace` 与 `cargo test --workspace` 通过。
    - 目录结构与 ADR-0001 一致，且不改动现有 npm 公共行为。

## 预期改动

- `Cargo.toml`
- `crates/mad-dom-core/**`
- `crates/mad-dom-bun/**`
- `js/**`、`compat/**`、`tests/**`

## 专属校验

- `cargo check --workspace`
- `cargo test --workspace`
- `bun --check index.js`

## 边界

只搭建可编译骨架，不选择具体绑定、解析器或选择器实现。
