# 21A 细化原生错误分类与稳定映射

- 状态：待办
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T21A`
- 依赖：T20A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Core/绑定错误映射整理成独立、可测试且可由后续安全接线任务复用的稳定分类表。本条目只冻结分类规则，不负责把规则接到 FFI 入口。

## 条目

- [ ] **T21A — 细化原生错误分类与稳定映射**
  - 实现：
    - 为 TypeError、SyntaxError、DOMException 和普通 Error 定义稳定分类、名称、code 与消息模板。
    - 明确 HierarchyRequestError、IndexSizeError、WrongDocumentError、InvalidCharacterError 等 DOMException 名称及适用的 Core 错误。
    - 为生命周期错误、参数错误和内部错误定义不会随 Rust 调试格式变化的映射描述。
    - 用纯 Rust 单元测试锁定每个映射分支；Bun 端错误观察留给 T21 集成闸门。
  - 验收：
    - 每个当前 CoreError/BindingError 分支都有唯一、文档化的 JS 错误分类。
    - 错误名称、稳定 code、消息前缀和映射时机有固定测试；同一错误重复执行结果一致。
    - 映射模块可由 T21 集成而无需改写分类规则。

## 预期改动

- crates/mad-dom-bun/src/error.rs
- error.rs 内的纯 Rust 映射测试和说明

## 专属校验

- 错误映射 Rust 单元测试
- cargo test -p mad-dom-bun
- 统一仓库校验

## 并发边界

可与 T21B 并发。只允许修改 error.rs 及其单元测试；不得修改 handle.rs、api.rs、lib.rs、affinity.rs、根入口或 Bun 集成 fixture。T21 负责把本模块接入所有 FFI 入口。
