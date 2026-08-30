# 48E 公开入口形态对齐（createWindow 与 Window 构造器）

- 状态：待办
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T48E`
- 依赖：T48
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

对齐包公开入口形态，关闭 `dom-create-append-serialize` 与
`dom-query-selector-identity` 记录的 `entry-create-window-type` 差异。

## 条目

- [ ] **T48E — 公开入口形态对齐（createWindow 与 Window 构造器）**
  - 实现：
    - 把 `new Window()` / `new Window(options)` 确立为公开构造路径（T48 已让
      Window 可构造并支持 options），`createWindow()` 保留为兼容别名或从包入口
      撤出，使 `typeof entry.createWindow` 与 happy-dom 一致。
    - 同步更新全部 bun 测试、差分场景的窗口获取分支、README 与 index.d.ts
      导出声明，保持运行时与类型表面同步。
  - 验收：
    - `dom-create-append-serialize` 与 `dom-query-selector-identity` 全部差异
      归零，两条 ledger 条目翻转为 `pass`。

## 预期改动

- Core/绑定/facade/type
- `compat/**`、`tests/compat/**`、文档

## 专属校验

- 入口/类型/差分套件
- 兼容清单退化检查
- 统一仓库校验

## 边界

不得删除记录该差异的差分场景；入口形态变更必须与类型声明同步落地。
