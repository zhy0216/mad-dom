# 48C 表单约束校验（ValidityState / checkValidity / invalid 事件）

- 状态：已完成
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T48C`
- 依赖：T48
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 WHATWG 表单约束校验，关闭 `dom-form-validation` 记录的缺口。

## 条目

- [x] **T48C — 表单约束校验（ValidityState / checkValidity / invalid 事件）**
  - 实现：
    - 每控件 `validity`（live `ValidityState`：`valueMissing`/`typeMismatch`/
      `patternMismatch`/`tooLong`/`tooShort`/`rangeUnderflow`/`rangeOverflow`/
      `stepMismatch`/`badInput`/`customError` 等）、`validationMessage`、
      `willValidate`、`setCustomValidity`、控件 `checkValidity`。
    - `form.checkValidity()`/`reportValidity()` 评估 required/type 等约束，
      无效时派发 `invalid` 事件（bubbles/cancelable，默认行为报告）。
    - `noValidate`/`formnovalidate` 与提交路径联动，提交无效表单不派发 submit。
  - 验收：
    - `dom-form-validation` 全部差异归零，ledger 条目翻转为 `pass`。

## 预期改动

- Core/绑定/facade/type
- `compat/**`、`tests/compat/**`、文档

## 专属校验

- 约束校验差分/事件顺序套件
- 兼容清单退化检查
- 统一仓库校验

## 边界

不得以 checkValidity 恒真或吞掉 invalid 事件的方式制造相等。
