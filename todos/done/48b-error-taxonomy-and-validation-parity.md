# 48B 错误分类与校验对齐（真实 DOMException + happy-dom 消息）

- 状态：已完成
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T48B`
- 依赖：T48, T48A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 napi4 降级的普通 `Error` 替换为真实 `DOMException`，并按 happy-dom 逐字对齐
DOM-spec 错误的 `name`/`message`，同时把属性名与文本数据的可接受性对齐到
happy-dom 的可观察行为。

## 条目

- [x] **T48B — 错误分类与校验对齐（真实 DOMException + happy-dom 消息）**
  - 实现：
    - 在 FFI/facade 边界构造并抛出真实 `DOMException`（`InvalidCharacterError`、
      `HierarchyRequestError` 等），保留稳定 `code`；移除 `[ERR_MAD_DOM_*]` 前缀
      的降级消息，改为与 happy-dom 一致的 WebIDL 消息（如
      `Failed to execute 'setAttribute' on 'Element': '' is not a valid attribute name.`）。
    - 对齐属性名校验：接受 digit-led 与前置 `.`、允许 `:` 与非 ASCII，拒绝空名/
      空白/NUL/前置 `-`（`validate_attribute_name`，匹配 happy-dom 边界）。
    - 对齐文本数据：`textContent` 接受并存储 NUL 字节（happy-dom 行为），
      `createTextNode`/`createComment` 相应放开。
  - 验收：
    - `dom-attributes` 的 `errors[0]`/`errors[1]` 与 `digit-led-name`、
      `dom-text-content` 的 `errors[0]`/`nul-stored` 差异归零（`dom-attributes`
      的描述符与 `errors[2]` 由 T48A 关闭）。
    - 相应 ledger 条目翻转为 `pass`，无 skip 或未解释 gap。

## 预期改动

- Core/绑定/facade/type
- `compat/**`、`tests/compat/**`、文档

## 专属校验

- 错误分类/消息/时机差分套件
- 兼容清单退化检查
- 统一仓库校验

## 边界

不得用扩大 normalizer 或模糊化错误消息的方式制造相等；消息必须与基线逐字一致。
