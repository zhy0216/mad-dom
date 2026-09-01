# 10 差分移植波次 W10：尾部杂项子系统

- 状态：待办
- 优先级：P1
- 里程碑：W10
- 条目 ID：`D10`
- 依赖：D09
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W10）

## 目标

把 13 个尾部子系统共 17 个 `unmapped-internal-import` skip 文件按共用移植协议（todos/README.md）1:1 移植为差分场景，收口本计划最后一波常规移植。杂项子系统内部耦合形态差异大（编译器、解析器、容器），逐文件独立判定，不与同波其他文件共享判定模板。

## 波次文件清单（17）

| 文件 | 导入的内部模块 |
| --- | --- |
| `canvas/ImageBitmap.test.ts` | canvas 内部 |
| `canvas/OffscreenCanvas.test.ts` | canvas 内部（若依赖真实渲染上下文 → 不可差分） |
| `cookie/CookieContainer.test.ts` | CookieContainer.js |
| `cookie/urilities/CookieURLUtility.test.ts` | CookieURLUtility.js |
| `cookie-store/CookieStore.test.ts` | cookie-store 内部 |
| `custom-element/CustomElementRegistry.test.ts` | custom-element 内部 |
| `html-parser/HTMLParser.malformedHTML.test.ts` | html-parser 内部 |
| `html-parser/HTMLParser.test.ts` | html-parser 内部 |
| `index.test.ts` | src/index named 面内部 |
| `javascript/JavaScriptCompiler.test.ts` | javascript 内部 |
| `match-media/MediaQueryList.test.ts` | match-media 内部 |
| `module/ECMAScriptModuleCompiler.test.ts` | module 内部 |
| `module/ModuleURLUtility.test.ts` | ModuleURLUtility.js |
| `navigator/Navigator.test.ts` | navigator 内部 |
| `permissions/Permissions.test.ts` | permissions 内部 |
| `xml-parser/XMLParser.test.ts` | XMLParser.js |
| `xml-serializer/XMLSerializer.test.ts` | XMLSerializer.js |

## 条目

- [ ] **D10 — W10 尾部杂项差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - 编译器（JavaScriptCompiler、ECMAScriptModuleCompiler）、解析器内部（HTMLParser、XMLParser）、容器内部（CookieContainer）大概率无公开等价面 → B 档是预期结果；`index.test.ts` 若能经 `entry.Window` 公开面重述核心断言则可 A 档（id `index-index`），否则 B 档。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/<subsystem>/<name>.js`）、逐场景对拍至双端一致、登记四件套。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/<本波各子系统>/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/<本波各子系统>.json`（含顶层 `index.json`）
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动本波清单内子系统；不碰其他子系统 triage 分片与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 编译器/解析器内部实现无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
