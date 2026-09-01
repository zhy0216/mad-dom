# 计划 0002：hdunit 内部耦合 skip 文件 1:1 移植为公开 API 差分场景

- 状态：草案
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
