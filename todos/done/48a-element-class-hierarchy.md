# 48A 元素类层级（per-tag 原型）

- 状态：已完成
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

- 验收项全部归零：`dom-attributes` 描述符与 `errors[2]`（text.getAttribute
  TypeError）、`dom-text-content` 的 `textContent` 描述符、
  `dom-custom-elements-upgrade` 的 `direct-localName` 差异在当前 main 上均为 0。
- `hc-diff-attributes-read-write`、`hc-diff-text-content-accessor`、
  `hc-diff-custom-elements-upgrade` 三个 ledger 条目在 T48B/T48D 合入、场景差异
  归零后已翻转为 `pass`；`compat:ledger` 0 回归、0 过期条目。
- `npm run validate`（JS check、cargo fmt/clippy/test、compat:types、603 bun
  tests、compat:ledger、wpt）、`npm run compat:differential`（37 场景 0 差异）、
  `git diff --check` 全部通过。
- 注：差分/ledger 校验前需先 `npm run dev:build` 重建本地原生产物
  `build/mad-dom.node`；加载过期二进制会把已合入的修复误报为回归。
