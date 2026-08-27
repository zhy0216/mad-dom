# 48 收口 happy-dom 兼容清单并接入 WPT

- 状态：待办
- 优先级：P2
- 里程碑：M8/M9
- 条目 ID：`T48`
- 依赖：T11, T25, T29, T32, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44, T45, T46, T47
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

根据锁定基线补齐所有剩余公开 API/行为，并用 WPT 补充未覆盖或不明确部分。

## 条目

- [ ] **T48 — 收口 happy-dom 兼容清单并接入 WPT**
  - 实现：
    - 按 subsystem 处理剩余 gap；若单项超过一个原子 commit，先在 README 当前顺序位置生成更小 todo，暂停本条目。
    - 确保公开导出、原型、描述符、类型、同步/异步行为和异常全部纳入清单。
    - 引入可维护的 WPT 子集、manifest 和单独统计报告。
  - 验收：
    - happy-dom 公共兼容套件达到 100%，无 skip、expected failure 或未解释 gap。
    - WPT 通过率单独展示，不改变既有 happy-dom 契约。
    - 所有上游测试来源和许可证映射完整。

## 预期改动

- Core/绑定/facade/type
- `compat/**`
- `tests/compat/**`
- `tests/wpt/**`
- 文档

## 专属校验

- 完整 API/类型/差分套件
- 兼容清单退化检查
- WPT 子集
- 统一仓库校验

## 边界

不得用扩大 normalizer、删除测试或标记 not-applicable 的方式制造 100%。
