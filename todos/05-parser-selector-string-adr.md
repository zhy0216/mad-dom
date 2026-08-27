# 05 确定解析器、选择器与字符串存储方案

- 状态：待办
- 优先级：P0
- 里程碑：M0
- 条目 ID：`T05`
- 依赖：T01
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

通过小型技术验证选择 HTML parser、selector parser/engine 和字符串存储方案。

## 条目

- [ ] **T05 — 确定解析器、选择器与字符串存储方案**
  - 实现：
    - 验证候选 HTML parser 能直接写入统一 arena，并支持 document/fragment 与上下文元素。
    - 验证选择器方案能在 NodeId/arena 上匹配，不要求长期镜像树。
    - 比较 owned string、interning 或其他方案的 API、内存、许可和迁移成本。
    - 把选择与暂缓优化项记录为 ADR。
  - 验收：
    - ADR 分别写明输入边界、错误模型、namespace 能力、许可证和替换成本。
    - 任何选定方案都不维护第二棵长期 DOM。
    - 字符串索引/驻留优化有明确启用条件和基准要求。

## 预期改动

- `spikes/**`
- `adr/0004-*.md`

## 专属校验

- 技术原型测试/基准命令
- 统一仓库校验

## 边界

不实现生产级解析、选择器或全局字符串驻留。
