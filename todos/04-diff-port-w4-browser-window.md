# 04 差分移植波次 W4：browser / window / location / history

- 状态：待办
- 优先级：P1
- 里程碑：W4
- 条目 ID：`D04`
- 依赖：D03
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W4）

## 目标

把 browser（7）、window（3）、location（1）、history（2）共 13 个 `unmapped-internal-import` skip 文件按共用移植协议（todos/README.md）1:1 移植为差分场景。计划预告 **browser 内部机制多数预计 B 档**（Browser/Frame/Page 是宿主环境编排，无公开等价面）；`window/BrowserWindow`、`window/DetachedWindowAPI` 同理大概率 B 档。`window/Window`、`location/Location`、`history/History` 若有公开可观测面则 A 档移植。B 档是预期结果，逐项落笔，不强行移植。

## 波次文件清单（13）

| 文件 | 导入的内部模块 |
| --- | --- |
| `browser/Browser.test.ts` | browser 内部编排 |
| `browser/BrowserFrame.test.ts` | browser 内部编排 |
| `browser/BrowserPage.test.ts` | browser 内部编排 |
| `browser/detached-browser/DetachedBrowser.test.ts` | detached-browser 内部 |
| `browser/detached-browser/DetachedBrowserFrame.test.ts` | detached-browser 内部 |
| `browser/detached-browser/DetachedBrowserPage.test.ts` | detached-browser 内部 |
| `browser/utilities/BrowserFrameURL.test.ts` | browser 内部 |
| `window/BrowserWindow.test.ts` | BrowserWindow 内部 |
| `window/DetachedWindowAPI.test.ts` | DetachedWindowAPI 内部 |
| `window/Window.test.ts` | window 内部 |
| `location/Location.test.ts` | location 内部 |
| `history/History.test.ts` | history 内部 |
| `history/HistoryItemList.test.ts` | history 内部 |

## 条目

- [ ] **D04 — W4 四子系统差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`——Browser/Frame/Page 编排、DetachedBrowser 宿主桥接归「不可构造/不可观测」。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/<subsystem>/<name>.js`）、逐场景对拍至双端一致、登记四件套。A 档场景只走 `entry.Window` + 公开成员（如 window 公开 API、location 公开属性方法、history 公开状态机）。
    - 若 `history/History` 公开面依赖真实导航流程，先缩小到可公开构造/可观测的断言面，再决定 A/B。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/{browser,window,location,history}/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/{browser,window,location,history}.json`
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动本波 4 个子系统；不碰其他子系统 triage 分片与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- Browser/DetachedBrowser 编排类无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
