# 48A 元素类层级（per-tag 原型）

- 状态：部分完成
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T48A`
- 依赖：T48
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把单 `Node` 类的元素包装模型升级为 WHATWG 类层级（`Element`/`HTMLElement`/per-tag
原型），关闭 T48 记录的描述符/非元素访问/裸对象缺口。

## 条目

- [x] **T48A — 元素类层级（per-tag 原型）**
  - 实现：
    - 引入 `Element` 类并把属性方法、`innerHTML`/`outerHTML`、查询与 `tagName`/
      `localName` 从 `Node.prototype` 迁移到 `Element.prototype`，`Text`/`Comment`
      等非元素不再持有这些成员（`text.getAttribute` 读 `undefined`，调用抛
      `TypeError: ... is not a function`，与 happy-dom 一致）。
    - 为常见标签建立 per-tag 原型（`HTMLDivElement` 等），`createElement`/
      解析/导入按标签选择直接原型，使 `Object.getPrototypeOf(el)` 与 happy-dom
      一致（`getAttribute`/`textContent` 在直接原型上 `present: false`）。
    - `new DefinedClass()` 通过注册表写入的 window/document 符号铸造真实 detached
      元素（`localName` 读注册名），替代当前裸对象。
    - 保持 `instanceof`、`createElement` 升级路径与 `Node.prototype → HTMLElement.prototype`
      关系的正确性，更新受影响的 facade 与 bun 测试。
  - 验收：
    - `dom-attributes` 的 `getAttribute`/`setAttribute` 描述符、`errors[2]`
      （text.getAttribute TypeError）、`dom-text-content` 的 `textContent` 描述符、
      `dom-custom-elements-upgrade` 的 `direct-localName` 差异归零。
    - 相应 ledger 条目翻转为 `pass`，无 skip 或未解释 gap。

## 预期改动

- Core/绑定/facade/type
- `compat/**`、`tests/compat/**`、文档

## 专属校验

- 描述符/原型链/instanceof 差分套件
- 兼容清单退化检查
- 统一仓库校验

## 边界

不得用扩大 normalizer 或删除测试的方式消除描述符差异。

## 结果

- 验收项全部归零：`getAttribute`/`setAttribute` 与 `textContent` 描述符差异归零
  （`dom-attributes` 18→6、`dom-text-content` 8→2，剩余差异均为 T48B 的 napi4
  错误形状 / NUL 校验 / digit-led 名称校验）；`errors[2]` 的 text.getAttribute
  现与 happy-dom 完全一致（TypeError "is not a function"，唯一残余是 T48B 的
  digit-led 额外错误造成的数组索引错位）；`direct-localName` 差异归零
  （`dom-custom-elements-upgrade` 4→3，剩余差异均为 T48D）。
- 三个 ledger 条目保持 `known-gap` 并更新原因（移除 T48A 已关闭项，其余差异显式
  归属 T48B/T48D）；在剩余差异存在时翻转为 `pass` 会触发退化门禁，故如实保留。
  这三条（`hc-diff-attributes-read-write`、`hc-diff-text-content-accessor`、
  `hc-diff-custom-elements-upgrade`）待 T48B/T48D 合入、各自场景差异归零后由后续
  任务翻转为 `pass`。
- `npm run validate`、`npm run compat:differential`、`npm run compat:types`、
  `npm run compat:ledger`、`git diff --check` 全部通过。
