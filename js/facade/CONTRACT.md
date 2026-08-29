# js/facade 扩展契约（T20A seam）

本文件由 T20A 冻结，是 JavaScript facade 的"扩展契约"：后续 facade 子任务按
本契约实现，不需要猜测私有字段或根入口的接线方式。T20A 归档后，各文件由
队列表指定的 owner 接管实现；共享文件（本契约、`extensions/index.js`、根
`index.js`/`index.d.ts`）只有集成闸门（T22/T23/T24/T25）可以修改。

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
- `ctx.defineMethod(target, name, fn, descriptor)` 与
  `ctx.defineAccessor(target, name, get, set, descriptor)` —— 描述符注册助手；
  安装器不得用其他方式定义属性。
- `ctx.documentContext` —— 只读访问 wrapper 所需的文档所有权引用；绝不以
  原始值形式暴露 NodeId。

### 转换入口

`ctx.wrap` 是 native 与 facade 之间的唯一包装转换点。任何返回节点/文档
wrapper 的 facade 方法都必须调用 `ctx.wrap`，不得自行缓存或重建对象。

## 规则

- facade **不保存第二份权威 DOM 状态**；每次读取/决策都来自 native handle
  （ADR-0001 §2 "Core 优先"）。
- 扩展不得修改 `window.js`、`document.js`、`extensions/index.js`、根
  `index.js`/`index.d.ts` 或彼此的专属文件。
- 扩展只新增自己的文件与专属测试。
- T22 闸门负责把 facade 接入包根入口。
