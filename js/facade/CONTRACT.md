# js/facade 扩展契约（T20A seam）

本文件由 T20A 冻结，是 JavaScript facade 的"扩展契约"：后续 facade 子任务按
本契约实现，不需要猜测私有字段或根入口的接线方式。T20A 归档后，各文件由
队列表指定的 owner 接管实现；共享文件（本契约、`extensions/index.js`、根
`index.js`/`index.d.ts`）只有集成闸门（T22/T23/T24/T25）可以修改。

ADR-0007 后，以下“唯一转换入口”扩展为同一身份系统的一组入口：native handle
使用 `ctx.wrap`，一般文档作用域令牌使用 `ctx.wrapLazyNode`，native 已证明 fresh 的
Text token 可使用创建专用的 `ctx.wrapFreshTextNode`；三者必须收敛为同一 facade
对象。Core 仍是唯一权威状态，允许的派生 memo/属性/collection 缓存必须通过 Core
代际视图验证。

## 目录与所有权

| 路径 | owner | 闸门 | 角色 |
| --- | --- | --- | --- |
| `CONTRACT.md` | T20A | — | 本契约（冻结，仅 T20A） |
| `window.js` | T22B | T22 | `createWindow`、`Window.document`、基础生命周期转发 |
| `document.js` | T22B | T22 | Document facade 基础模块 |
| `extensions/index.js` | T22B | T22 | facade registry：调用各扩展的 `install(ctx)`；实现本契约 |
| `extensions/node.js` | T23B | T23 | 节点创建与导航 facade |
| `extensions/mutation.js` | T24C | T24 | `appendChild`/`insertBefore`/`removeChild`/`replaceChild` facade |
| `extensions/attributes.js` | T25E | T25 | attribute 读写访问器 |
| `extensions/text-content.js` | T25E | T25 | `textContent` 访问器 |
| `extensions/child-nodelist.js` | T25D | T25 | live childNodes facade |
| `extensions/html.js` | T29 | T29 | `innerHTML`/`outerHTML` 与 `documentElement`/`head`/`body`/`parseHtml` facade |
| `extensions/query.js` | T31 | T31 | `querySelector`/`querySelectorAll`/`matches`/`closest`/`getElementById` 与静态 NodeList facade |
| `extensions/live-collections.js` | T32 | T32 | `getElementsByTagName`/`getElementsByClassName` 与 live HTMLCollection facade |
| `extensions/extended-nodes.js` | T33 | T33 | `CharacterData`/`ProcessingInstruction`/`DocumentType` 与 `cloneNode`/`importNode`/`adoptNode` facade |
| `extensions/events.js` | T37 | T37 | `addEventListener`/`removeEventListener`/`dispatchEvent` 与基础 `Event` facade |
| `extensions/attribute-nodes.js` | T34 | T34 | `NamedNodeMap`/`Attr`/`DOMTokenList`、`Element.attributes`/`classList`/`namespaceURI` 与 `createAttribute` facade |
| `extensions/html-element.js` | T39 | T39 | `HTMLElement` 原型层级、反射属性（`id`/`title`/`className`/`dir`/`lang`/`hidden`/`inert`/`tabIndex`/`contentEditable`）、`dataset` 与 `click`/`focus`/`blur` facade |
| `extensions/window-platform.js` | T45 | T45 | `URL`/`Location`/`History`/`Navigator`、`localStorage`/`sessionStorage`、`document.cookie` 与 `document.URL` facade |
| `extensions/tree-traversal.js` | T35 | T35 | `createTreeWalker`/`createNodeIterator`、`TreeWalker`/`NodeIterator` 与 `window.NodeFilter` facade |
| `extensions/mutation-observer.js` | T41 | T41 | `MutationObserver`/`MutationRecord` facade、observe 选项校验与 microtask 交付 |
| `extensions/template.js` | T40 | T40 | `template.content` 与 `getInnerHTML`/`getHTML` facade |
| `extensions/forms.js` | T40 | T40 | 首批表单控件（`input`/`button`/`select`/`option`/`textarea`/`form`）value/name/disabled/checked/selected 与 `form.elements`/提交/重置 facade |
| `extensions/fetch.js` | T46 | T46 | `Headers`/`Request`/`Response`/`AbortController`/`AbortSignal` 与 `window.fetch` facade（兼容包装 Bun 原生能力，`data:` 离线） |
| `extensions/range-selection.js` | T36 | T36 | `createRange`/`getSelection`、`Range`/`Selection` 与 `window.Range`/`window.Selection`/`window.getSelection` facade |
| `extensions/custom-elements.js` | T42 | T42 | `window.customElements` `CustomElementRegistry`（define/get/getName/whenDefined/upgrade）与同步生命周期反应（connected/disconnected/attributeChanged）facade |
| `extensions/shadow-dom.js` | T43 | T43 | `Element.attachShadow`/`shadowRoot`、`ShadowRoot`（host/mode/innerHTML）与 `slot`/`assignedNodes`/`assignedElements` 基础 slot 分配 facade |
| `extensions/timers.js` | T47 | T47 | `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`/`requestAnimationFrame`/`cancelAnimationFrame`/`queueMicrotask`、`eval`（document/window 全局绑定）与 window `error` 事件传播 facade |
| `extensions/cssom.js` | T44 | T44 | `Element.style`（live `CSSStyleDeclaration` 双向同步 `style` 属性）、`document.styleSheets`/`<style>.sheet`/`CSSStyleSheet`/`CSSRule` 家族、`matchMedia`/`MediaQueryList` 与无布局 `getComputedStyle` facade |

每个占位文件是合法 ESM 模块，导出冻结的 `seam` 元数据（`id`、`owner`、
`gate`、`status`），由 `tests/bun/seam.test.js` 锁定；owner 接管实现后可删除
或改写该导出，并随闸门更新测试。

## 模块形状

每个能力扩展是一个 ESM 模块，且**只导出一个具名 `install(ctx)` 函数**。
`extensions/index.js`（facade registry，T22B 实现）在 facade 初始化时对每个
扩展恰好调用一次 `install`。

### ctx（由 js/facade/window.js 在 install 时提供）

- `ctx.wrap(nativeHandle)` —— **唯一**的 native handle → facade wrapper 转换
  入口。所有 wrapper 生产都必须经过它，使 T20 的 wrapper identity 与每文档
  弱缓存保持权威。
- `ctx.wrapLazyNode(documentHandle, token, type, name, namespace)` —— ADR-0007
  的 token → facade wrapper 入口；后续 `ctx.wrap(nativeHandle)` 必须按 token 返回
  同一对象。
- `ctx.wrapFreshTextNode(documentState, token, epoch)` —— `ctx.wrapLazyNode` 的
  创建专用 Text 子入口；只接受 native fresh proof，跳过通用 kind dispatch，仍登记
  到同一个文档 token 身份表。
- `ctx.defineMethod(target, name, fn, descriptor)` 与
  `ctx.defineAccessor(target, name, get, set, descriptor)` —— 描述符注册助手；
  安装器不得用其他方式定义属性。
- `ctx.documentContext` —— 只读访问 wrapper 所需的文档所有权引用与文档作用域
  token；绝不暴露 Core `NodeId`。
- `ctx.registerHandleType(name, makeWrapper)` 与 `ctx.registerWrap(handle,
  wrapper)` —— wrapper 类型注册表与"wrap 之外的铸造"登记（T48A
  `new DefinedClass()` 铸造路径把真实 detached 元素写回每文档弱缓存）。

### 转换入口

`ctx.wrap`、`ctx.wrapLazyNode` 与其创建专用子入口 `ctx.wrapFreshTextNode` 是 native
handle / token 的规范转换点。任何返回节点/文档 wrapper 的 facade 方法必须使用
其中之一，不得在身份表之外自行重建对象。`ctx.wrapFreshTextNode` 仅可用于 native
已证明 fresh 的 Text token，并须登记到与 `ctx.wrapLazyNode` 相同的文档 token 身份表。

## 规则

- facade **不保存第二份权威 DOM 状态**；允许保存 ADR-0007 定义的、由 Core 代际
  验证的派生缓存，miss 时仍由 native/Core 决定结果。代际值 `-1` 表示计数空间
  已耗尽，此后必须永久绕过相等性缓存；`-2147483648` 表示文档已销毁。
- 节点的 handle/token、分类、代际证明、导航 memo 与属性缓存必须保存在模块私有
  记录中，不得成为 wrapper 或 custom-element prototype 上可反射、复制或伪造的
  Symbol 属性；文档 token registry 与预取池同样不得作为可替换的公开状态暴露。
- 扩展不得修改 `window.js`、`document.js`、`extensions/index.js`、根
  `index.js`/`index.d.ts` 或彼此的专属文件。
- 扩展只新增自己的文件与专属测试。
- T22 闸门负责把 facade 接入包根入口。
