# 19 实现最小生产原生绑定

- 状态：已完成
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T19`
- 依赖：T04, T17
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按绑定 ADR 建立生产绑定入口，只负责值转换和对 Core 的调用。

## 条目

- [x] **T19 — 实现最小生产原生绑定**
  - 实现：
    - 实现创建/销毁文档、传递不透明句柄以及字符串/数字结果返回。
    - 绑定对象保存文档所有权引用与 NodeId，不保存裸指针。
    - 把 FFI/unsafe 集中在少量模块并写明安全前提。
  - 验收：
    - Bun 可从正式包开发入口调用最小 Core API。
    - 绑定 crate 不复制树状态或实现 DOM 规则。
    - 重复加载与析构 smoke test 无崩溃。

## 预期改动

- `crates/mad-dom-bun/**`
- 本地构建/加载脚本
- `tests/bun/**`

## 专属校验

- 原生构建命令
- Bun 原生 smoke test
- `cargo test --workspace`
- 统一仓库校验

## 边界

暂不实现 wrapper cache、完整异常映射或公开 DOM facade。
