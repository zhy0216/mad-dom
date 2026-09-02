# 计划 0002：hdunit 内部耦合 skip 文件 1:1 移植为公开 API 差分场景

- 状态：已完成
- 对应 ADR：[ADR-0001 §6（上游用例移植）](../adr/0001-basic-technical-architecture.md)、[ADR-0002（兼容基线与差分协议）](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)、[ADR-0006（hdunit 套件与 triage 门禁）](../adr/0006-happy-dom-unit-suite-hdunit.md)
- 计划日期：2026-09-01
- 用户决策（2026-09-01）：产物放差分赛道（hc-diff）；粒度 1:1 逐文件移植；本计划先行

## 1. 背景与目标

hdunit triage 现有 298 个 vendored 文件，终态分布 enabled 68 / expected-fail 22 / skip 208。
其中约 **175 个 skip 文件**的 reason 为 `unmapped-internal-import`，且其运行时导入的是 happy-dom
**内部实现模块**（CSSParser、FetchCORSUtility、SVGLength、CharacterDataUtility、各类内部类），
而非 enum/type-only 常量。这类测试直接构造上游内部对象、断言内部属性，机械重写管道救不回来
（`rewrite-happy-dom-tests.mjs` 只重定向 import，不触碰断言）。

目标：把这 175 个文件 **1:1 移植为差分场景**——逐文件提取上游测试断言的公开可观察行为，
用公开 API（`new entry.Window()` + 公开成员）重写，放入差分套件 `tests/compat/scenarios/`，
由 runner 对 happy-dom 20.11.11 与 mad-dom 双端对拍。**happy-dom 当 oracle**：
fidelity 由差分器机械保证，不再依赖人工核对断言期望值。

## 2. 范围

**精确范围**：triage 分片中 `status=skip` 且 reason 含 `unmapped-internal-import` 且存在
非 enum/type-only 运行时导入的文件（当前约 175 个，跨 27 个子系统，按子系统计数见 §6）。

**明确排除**（另走其他路线，互不重叠）：

| 类别 | 数量 | 路线 |
| --- | --- | --- |
| enum/常量类导入（DOMExceptionNameEnum、NamespaceURI 等，T12 extraEnum shim 已生成） | ~21 | T12 机械路线：rewrite 管道认识 extraEnum shim |
| facade-gap / 部分通过（File、Screen、DetachedBrowser、Storage 12/14 等） | ~12 | facade 实现路线，不是重写 |
| 纯 type-only 内部接口导入 | 少量 | 同上机械路线（bun 运行时擦除） |

## 3. 可移植性判定（每文件三问）

写场景前逐文件判定，全部满足才进入 A 档移植，否则 B 档豁免：

1. **可构造**：上游测试断言的起始状态能否通过公开 API 构造？
   （`new CSSParser(sheet)` → `sheet.cssText` / `sheet.insertRule()`）
2. **可观测**：断言读取的最终状态能否通过公开 API 读出？
   （内部属性 → 公开 getter / 序列化 / 事件）
3. **可差分**：行为是否依赖宿主、网络、真实时间或随机数？（是 → 不可差分）

- A 档：全部满足 → 写场景。
- B 档：任一不满足 → 不移植，triage reason 改为 `internal-only-no-public-surface`
  （保持 skip，理由写明哪一问不满足）。B 档判定必须在波次 review 中逐项列明，不得批量豁免。

## 4. 场景规范

- **位置**：`tests/compat/scenarios/dom/<subsystem>/<name>.js`
  （runner `listScenarioFiles` 递归发现子目录，`_` 前缀与 `divergent/` 除外）。
- **id**：`<subsystem>-<upstream-basename>`（kebab-case，去 `.test` 后缀），
  例如 `css/CSSParser.test.ts` → id `css-parser`。
- **写法**：只允许 `entry.Window` 构造面 + 公开成员；全部状态通过 `api.record.*` 归一化记录；
  固定输入，无随机/时间依赖。与现有 `tests/compat/scenarios/dom/*.js` 同构。
- **断言迁移规则**：
  - 上游对内部对象的方法调用 → 公开等价操作（等价面优先选规格语义而非实现路径）；
  - 上游引用 enum/常量的值断言 → 字面量内联（以 `tests/happy-dom/vendor-src-enums/` 的
    T01 vendored 字面量为源，不凭空写）；
  - 上游只测内部实现细节、公开面无法区分的断言 → 舍去，并在文件头注明舍弃面。
- **文件头**：复用 rewritten 头格式的 MIT provenance 注释块（upstream path / commit / tag /
  license + 移植说明 + 舍弃面说明），保真声明改为「hand-ported to public API, upstream
  assertions migrated by the rules above」。

## 5. 登记与门禁（每个移植的四件套）

每个 A 档移植产生四件登记，缺一不可：

1. **场景文件**（§4）。
2. **ledger diff 条目**：`{ id: "hc-diff-<id>", suite: "diff", status: "pass",
   subsystem, scenario: "<id>", addedIn: "<波次>" }`。
   **双端不一致不许合入**：场景必须先把 diff 修到一致（修 facade/core，或按 §4 规则缩小断言面），
   合入即 `pass`，不得用 known-gap / expected-fail 兜底滞留。
3. **upstream-map 条目**：`{ localId: "hc-up-<id>", upstreamPath:
   "packages/happy-dom/test/<原路径>", upstreamCommit: 固定 commit, license: "MIT",
   localPath: "<场景文件>" }`（upstream-map note 已预留 hc-up-* 给手写移植）。
4. **ledger up 条目**：`{ id: "hc-up-<id>", suite: "up", status: "pass",
   upstreamRef: "hc-up-<id>", subsystem, addedIn }`
   ——ledger schema 已含 `up` 套件（`SUITE_ENTRY_FIELDS[UP] = ["upstreamRef"]`，
   `ledger-lib.js:98`），upstream-map 校验要求 localId 对应 `up`/`hdunit` 套件条目
   （`ledger-lib.js:398`），upstreamRef 只需存在于 localIdSet（`ledger-lib.js:537`）。
5. **triage 更新**：该 skip 文件 reason 改为 `ported-to-diff (hc-diff-<id>)`，status 保持 skip
   （vendored 文件本身永远跑不了，但不再是无覆盖状态）。hdunit coverage 计数不变
   （validate-triage.mjs 对 reason 无白名单，只要求非空，`validate-triage.mjs:180`）。

**每波门禁**（全绿才合入）：`compat:ledger`（含差分活体跑）→ `compat:hdunit:validate` →
`npm run validate`。

## 6. 波次划分

按子系统分波。`compat/ledger.json` 与 `compat/upstream-map.json` 是单文件，波间**串行集成**，
不并行（与 herdr-finish-todo 协议一致）。

| 波次 | 子系统 | 文件数 | 说明 |
| --- | --- | --- | --- |
| W1 (pilot) | css | 17 | 先验证四件套登记机制与工作量系数 |
| W2 | dom, query-selector, range, selection, utilities | 9 | |
| W3 | fetch, xml-http-request, web-socket | 10 | web-socket 可能 B 档（宿主依赖） |
| W4 | browser, window, location, history | 13 | browser 内部机制多数预计 B 档 |
| W5–W8 | nodes | 104 | 按上游目录拆 4 波，每波 ~26 |
| W9 | svg | 26 | 内部类测试多为 tagName/属性反射，合并判定面 |
| W10 | canvas, cookie, cookie-store, custom-element, html-parser, index, javascript, match-media, module, navigator, permissions, xml-parser, xml-serializer | 17 | 尾部杂项收口 |

每波一个独立 commit；W1 完成后回填本计划的「验证点结论」章节再启动后续波次。

## 7. 每波工作流

1. 列出本波文件，逐文件 A/B 判定（B 档逐项列理由，入 triage 并附 review 记录）。
2. 写场景，本地对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>`
   双端一致（不一致 → 修 facade/core 或按 §4 缩小断言面）。
3. 登记四件套（§5）。
4. 跑全量门禁。
5. 单提交合入。

## 8. 验收标准

- 每波：本波文件 triage reason 全部为 `ported-to-diff` 或 `internal-only-no-public-surface`；
  ledger diff 条目与场景文件一一对应（validate-ledger 交叉核对强制）；门禁绿。
- 收尾：175 个文件全部有终态判定；diff 套件从 33 场景扩展到 ~180+；
  `tests/happy-dom/COVERAGE.md` 更新口径——ported 文件在 hdunit 仍是 skip
  （vendored 文件不可运行），但理由从「内部耦合不可覆盖」变为「已由差分场景覆盖」，
  report 的 skip 计数口径保持原状。
- 性能：runner 串行 spawnSync，180 场景 ≈ 360 子进程。W1 后测时长基线，
  若超出 CI 预算 → 把 runner 并发化列为独立任务（不在本计划内）。

## 9. 风险

- **mad-dom 未实现面**：场景跑出 diff，波次变成实现波（修 core/facade），工期上浮。
  W1 在 css 上先探明「移植 : 修实现」的工作量系数，再决定 W5–W9 是否按文件数重排。
- **happy-dom 公开面依赖内部细节**（如 document.write 空白文本节点差异，TreeWalker 案例）：
  该断言面不进场景或整文件降 B 档。
- **B 档豁免扩大化**：以「不好写」代替「不可观测」豁免。缓解：§3 三问逐项落笔 + 波次 review。

## 10. 与其他路线的关系

- T12 enum 机械路线（~21 文件）与本计划并列、无重叠。
- facade-gap / 部分通过（~12 文件）走 facade 实现路线，不在本计划。
- 本计划完成后，hdunit skip 的构成收敛为：`internal-only-no-public-surface`（B 档）、
  `ported-to-diff`（本计划产物）、facade-gap 类、enum 类（T12 后应已机械启用或仍 skip）。

## 11. 首个波次（W1）需验证的机制点

1. `up` 套件条目 `upstreamRef` 自锚是否通过 `compat/ledger` 与 `validate-ledger.js`
   （schema 允许，`ledger-lib.js:537` 只查存在性；首次实测确认）。
2. 场景放 `scenarios/dom/<subsystem>/` 子目录的递归发现与 id 无重复（runner 拒绝重复 id）。
3. runner 时长基线（§8 性能项）。
4. triage reason 改为 `ported-to-diff (hc-diff-<id>)` 后 `compat:hdunit:validate`
   与 `compat:hdunit:report` 计数口径不变。

## 12. 验证点结论（W1 pilot，2026-09-01）

W1（css，17 文件）已完成并合入，四个机制点全部实测通过：

1. **`up` 套件自锚通过 `compat:ledger`**。14 条 `hc-up-*` 条目以
   `upstreamRef: "hc-up-<id>"` 自锚（id 即自身），经 `npm run compat:ledger`
   全绿：`ledger-lib.js:537` 只要求 `upstreamRef` 存在于 upstream-map 的
   `localIdSet`，`validateUpstreamMap` 要求 localId 是 ledger 中 `up`/`hdunit`
   套件条目 id（双向校验闭环）。首次实测无 schema/交叉核对报错，无需任何绕过。
2. **子目录递归发现与 id 去重**。14 个场景放 `tests/compat/scenarios/dom/css/`
   子目录被 runner `listScenarioFiles` 递归发现（`run.js:89`，跳过 `_`/`divergent`），
   `compat:ledger` 交叉核对显示 47 个 real-pair 场景（含 14 个 css）每个恰有
   一条 diff 条目。id 去重：`loadScenarios` 对重复 id 直接 `failInfrastructure`
   （`run.js:111`）；用两个同名 mock 场景实测复现 `duplicate scenario id` 报错，
   拒绝行为确认。
3. **runner 时长基线（W1 场景）**。`bun tests/compat/runner/run.js
   tests/compat/scenarios/dom/css --json` 全量对拍 14 场景 = 28 个子进程：
   热跑稳定 ~1.43s（首次含冷启动 1.48s），单场景平均 ~102ms、单子进程平均
   ~51ms（串行 `spawnSync`）。按 §8 估算：终态 180 场景 ≈ 360 子进程 ≈
   ~18s，未超典型 CI 预算；D11 收尾再复核。
4. **triage reason 改 `ported-to-diff` 后计数口径不变**。14 个文件 reason 改为
   `ported-to-diff (hc-diff-<id>)`、2 个改为 `internal-only-no-public-surface`，
   status 全部保持 `skip`。`compat:hdunit:validate` 仍绿（enabled 68 / expected-fail 22 /
   skip 208），`compat:hdunit:report` 与 `report-baseline.json` 的 delta 为
   enabled 0 / expected-fail 0 / skip 0；css 子系统保持 enabled 3 / skip 17。

### 工作量系数（W1：17 文件）

- **A 档 14**：写场景 `tests/compat/scenarios/dom/css/<id>.js` 并登记四件套
  （ledger diff/up + upstream-map + triage）。
- **B 档 2**：`css/CSSUnitValue.test.ts`（一问可构造——`CSSUnitValue` 无公开入口导出，
  无法经公开 API 构造）、`css/declaration/CSSStyleDeclarationValueParser.test.ts`
  （一问可构造——被测静态解析类无公开等价构造面）。
- **enum-only 排除 1**：`css/CSSStyleSheet.test.ts` 运行时导入仅
  `DOMExceptionNameEnum` 纯枚举，无内部实现模块运行时构造（triage 不动，归 T12 机械路线）。
- **修 facade/core**：facade 8 处、全部落在 `js/facade/extensions/cssom.js`：
  (1) `CSS.escape` 按 CSSOM §2.4 实现；(2) `MediaList` 数字索引 accessor；
  (3) `CSSGroupingRule.insertRule/deleteRule` 补 WebIDL 参数个数校验；
  (4) `CSSKeyframesRule.appendRule/deleteRule/findRule` 补参数个数校验 +
  `@-webkit-keyframes` 前缀保留；(5) `CSSStyleRule.styleMap` getter（挂到既有
  `StylePropertyMap`）；(6) `parseCssRules` 空选择器/以 `;` 开头选择器丢弃 +
  keyframes 前缀；(7) 计算样式 `var()` 解析（`parseCssVariablesInValue`）；
  (8) 属性访问器表补 `src`（`@font-face`）。core（Rust）0 处。
- **单文件平均耗时**：场景对拍 + 三问判定 + 登记合计，本波实测约 15–25 分钟/文件
  （A 档含 facade 修复对拍迭代），移植 : 修实现 ≈ 14 : 8（文件口径），
  W5–W9 工作量估算以「每 A 档文件约 20 分钟 + 预计 1/2 文件需小型 facade 修复」为基准。

**结论对后续波次的影响**：四机制点全部按计划 §5/§11 的假定成立，W2–W10 可按
共用协议照常推进；css 子系统的 facade 差距集中在 cssom.js 单文件，nodes/svg 波次
预计以 core（Rust）修复为主、结构不同，系数不直接外推，W5 后再复核是否按文件数重排。

## 13. 验证点结论（D11 收尾，2026-09-02）

D01–D10 全部合入，收尾核对（条目 D11）完成，本计划**已完成**。终态数字如下。

### A/B/enum-only 分布（原 `unmapped-internal-import` 196 文件）

- **A 档 `ported-to-diff (hc-diff-<id>)`：147**，按波次 W1 14 / W2 6 / W3 4 / W4 3 /
  W5 8 / W6 16 / W7 36 / W8 33 / W9 25 / W10 2。
- **B 档 `internal-only-no-public-surface`：38**，子系统分布 cookie 2 / xml-serializer 1 /
  html-parser 2 / history 1 / dom 1 / fetch 5 / javascript 1 / css 2 / utilities 1 /
  module 2 / web-socket 1 / window 2 / index 1 / browser 7 / nodes 9；三问逐项理由已落在
  triage reason（哪一问不满足、为何不可构造/不可观测/不可差分）。
- **enum-only 排除（triage 原样保留，T12 机械路线）：11**，permissions 1 / canvas 2 /
  cookie-store 1 / range 1 / custom-element 1 / svg 1（`SVGUnitTypes`，W9 判定为纯常量
  持有类）/ xml-parser 1 / css 1 / nodes 2；§1/§2 的「约 175」是范围初估，实际共 196 个。
- 三项之和 = **196**，与 `tests/happy-dom/COVERAGE.md` 的 `unmapped-internal-import`
  计数一致，与 `tests/happy-dom/triage/*.json` 逐一机械可核对（validate-triage 确认
  298 个文件全部有终态，无「未 triage」遗留）。

### 场景总数

- 差分套件 `tests/compat/scenarios/dom/` = **180 个真实对拍场景**（含既有 33 个，
  波次新增 147 个）；`compat/ledger.json` 180 条 diff 条目全部 `pass`，与场景文件
  一一对应（`npm run compat:ledger` 交叉核对强制，0 stale / 0 regression）。

### 时长基线（D11 实测，§8 性能项复核）

- 全量对拍 180 场景 = 360 子进程（串行 `spawnSync`）：热跑稳定 **~20.2–20.6s**
  （三次实测 20.25s / 20.36s / 20.58s），单场景平均 ~113ms、单子进程平均 ~57ms。
- 与 §8/§12 预算对比：W1 预估终态 ~18s，实测 ~20.4s，处于同一量级，未超典型 CI 预算；
  **runner 并发化不立项**（README 用户决策点 2 未触发）。

### 口径与报告

- `tests/happy-dom/COVERAGE.md` 已按 §8 更新口径：`ported-to-diff` 文件在 hdunit 仍是
  `skip`（vendored 文件不可运行），但理由从「内部耦合不可覆盖」改为「已由差分场景覆盖」；
  B 档文件口径为「公开面无等价构造/观测，已豁免」。
- `npm run compat:hdunit:report` 计数口径与 D01 基线一致：enabled 68 / expected-fail 22 /
  skip 208，delta 全 0；`npm run compat:hdunit:validate`、`npm run compat:ledger`、
  `npm run validate` 全绿。
