# 04 src-path shim 层：内部路径 → facade 再导出

- 状态：待办
- 优先级：P0
- 里程碑：基建
- 条目 ID：`T04`
- 依赖：T01
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

为可映射的上游内部模块路径生成 re-export shim（`tests/happy-dom/shim/`），使 rewritten 测试的 `import X from '…/src/a/B.js'` 解析到 mad-dom facade 的对应类；并为 `new Window({settings})` 等构造签名提供适配包装。Shim 只做「名字与签名」对齐，不做行为实现（行为差异由波次修复 facade/core）。

## 条目

- [ ] **T04 — shim 生成与构造适配**
  - 实现：
    - 按 T01 `vendor-scan.json` 的 `shimPath` 清单生成 `tests/happy-dom/shim/src/<相对路径>.ts`（对应 `.js` 引用，bun 按 TS 解析）：
      - 每个模块 `export { default } from '<facade 入口>'`（类名即模块 basename 时）；少数 named 导出（如 `BrowserErrorCaptureEnum` 从 `src/index.js` 的 named 导入）从 facade 入口对应 re-export；
      - `shim/src/index.ts` 对应上游 `src/index.js` 的 named 导入面（全部指向 facade 公开导出）；
      - 纯枚举/常量模块（DOMExceptionNameEnum、NodeTypeEnum、CSSRuleTypeEnum、SVG 系列 Enum 等）：从 T01 的 `vendor-src-enums/` 生成**诚实值** shim（字面量照抄，附 provenance 注释；上游枚举值是行为契约的一部分，照抄是正确做法，不是伪造）；
      - 生成脚本 `scripts/generate-happy-dom-shim.mjs`，幂等可重复；扫描生成的 shim 必须 100% 覆盖 `vendor-scan.json` 中所有可映射路径（自动校验，缺一个即失败）；
    - 构造签名适配：
      - `Window`：接受 happy-dom `{ settings: { enableJavaScriptEvaluation, … } }` 形态的参数，映射到 facade Window 能力（能映射的映射，不能映射的开关忽略并允许脚本记录警告）；返回 facade Window 实例；
      - 其他带配置参数的构造（如 `Browser`）按需适配；适配点集中在 shim 内，不修改 facade 本体；
    - shim 自测（`tests/happy-dom/shim/*.test.ts`）：shim 导入的类与 facade 导出**引用相等**；Window 构造适配（含 settings 对象）可用。
  - 验收：
    - 所有可映射路径都有对应 shim 文件且能被 bun import；
    - shim 类与 facade 导出引用相等（`import W from shim; W === (await import('mad-dom')).Window` 成立）；
    - Window settings 适配自测通过；不可映射开关有记录（警告或注释），不静默误导；
    - 生成脚本幂等；覆盖率校验缺失时报错退出 1；
    - 不得在 shim 中实现任何 DOM 行为（只 re-export + 构造适配）。

## 预期改动

- `scripts/generate-happy-dom-shim.mjs`
- `tests/happy-dom/shim/**`（生成物 + 自测）
- `tests/happy-dom/shim/README.md`（说明 shim 边界与「不得实现行为」规则）
- `package.json`（`compat:hdunit:shim` 脚本）

## 专属校验

- `bun scripts/generate-happy-dom-shim.mjs`（含覆盖率校验，幂等）
- `bun test tests/happy-dom/shim`
- 与 T02 产物交叉：rewritten 中所有指向 shim 的路径真实存在（可在 T02 完成后补跑）

## 边界

- **不做 PropertySymbol shim**（私有 symbol 机制，语义上不可移植；其依赖文件归 T10 triage 为 not-applicable）。
- 不实现 *Utility / 内部 parser（CSSParser、HTMLParser、Fetch 内部等）shim：这些路径在 vendor-scan 中标记不可映射，归 T10。
- 不修改 facade、core、binding 代码；行为缺口只允许「triage 记录」，不允许在 shim 里补行为。
- 不改变 facade 构造签名本身；适配只发生在 shim 包装层。
