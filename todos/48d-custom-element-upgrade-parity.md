# 48D 自定义元素升级语义对齐

- 状态：待办
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T48D`
- 依赖：T48, T48A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把自定义元素的升级语义对齐到 happy-dom 的可观察行为，关闭
`dom-custom-elements-upgrade` 记录的缺口。

## 条目

- [ ] **T48D — 自定义元素升级语义对齐**
  - 实现：
    - `registry.upgrade(root)` 与 happy-dom 一致：happy-dom 将之记录为 no-op
      （"Not implemented yet"），对齐后不再执行 genuine 升级或派发生命周期反应。
    - define-after-connect 的升级身份：happy-dom 物理替换已连接候选元素（旧引用
      保持普通 `HTMLElement`），对齐后 `define-identity-pre` 读到 `false` 且
      upgrade 顺序与 happy-dom 一致。
  - 验收：
    - `dom-custom-elements-upgrade` 全部差异归零，ledger 条目翻转为 `pass`。
    - 与 happy-dom 冲突时以锁定基线可观察行为为准，不引入未记录的双模式。

## 预期改动

- Core/绑定/facade/type
- `compat/**`、`tests/compat/**`、文档

## 专属校验

- 升级/身份/生命周期差分套件
- 兼容清单退化检查
- 统一仓库校验

## 边界

不得删除 `dom-custom-elements-upgrade` 场景或用 not-applicable 掩盖差异。
