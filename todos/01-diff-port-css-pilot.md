# 01 差分移植波次 W1（pilot）：css 内部耦合文件

- 状态：待办
- 优先级：P0
- 里程碑：W1 pilot
- 条目 ID：`D01`
- 依赖：无
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W1、§11 验证点）

## 目标

把 css 子系统 17 个 `unmapped-internal-import` skip 文件 1:1 移植为差分场景（hc-diff），按共用移植协议（todos/README.md）逐文件 A/B 判定并登记四件套；同时验证本计划全部四个机制点，并把结论回填计划文档「验证点结论」章节。本波是后续 D02–D10 的机制基准，工作量系数（移植 : 修实现）直接决定 D05–D09 是否重排。

## 波次文件清单（17）

`tests/happy-dom/triage/css.json` 中 reason 含 `unmapped-internal-import` 的文件：

1. `css/CSS.test.ts`（CSS.js、CSSUnitValue.js、CSSUnits.js）
2. `css/CSSParser.test.ts`（css/utilities/CSSParser.js）
3. `css/CSSRule.test.ts`（CSSRuleTypeEnum + CSSParser）
4. `css/CSSStyleSheet.test.ts`（仅 DOMExceptionNameEnum —— **先核实导入**：若确无内部实现模块运行时构造，按 enum-only 排除，不移植）
5. `css/CSSUnitValue.test.ts`（CSSUnitValue.js）
6. `css/MediaList.test.ts`（css/utilities/CSSParser.js）
7. `css/declaration/CSSStyleDeclarationValueParser.test.ts`（property-manager/CSSStyleDeclarationValueParser.js）
8. `css/declaration/computed-style/CSSStyleDeclarationComputedStyle.test.ts`（computed-style 内部类）
9. `css/rules/CSSConditionRule.test.ts`（CSSParser）
10. `css/rules/CSSContainerRule.test.ts`（CSSRuleTypeEnum + CSSParser）
11. `css/rules/CSSFontFaceRule.test.ts`（CSSRuleTypeEnum + CSSParser）
12. `css/rules/CSSGroupingRule.test.ts`（DOMExceptionNameEnum + CSSParser）
13. `css/rules/CSSKeyframeRule.test.ts`（CSSRuleTypeEnum + CSSParser）
14. `css/rules/CSSKeyframesRule.test.ts`（CSSRuleTypeEnum、DOMExceptionNameEnum + CSSParser）
15. `css/rules/CSSMediaRule.test.ts`（CSSRuleTypeEnum + CSSParser）
16. `css/rules/CSSScopeRule.test.ts`（CSSRuleTypeEnum + CSSParser）
17. `css/rules/CSSStyleRule.test.ts`（CSSRuleTypeEnum + CSSParser）

## 条目

- [ ] **D01 — css 波次差分移植 + 机制验证 + 计划回填**
  - 实现：
    - 逐文件核实运行时导入（读 `tests/happy-dom/rewritten/<file>` 的 import 与 triage reason）：仅 enum/type-only 的按 enum-only 排除（triage 不动，commit body 列明）；其余逐文件执行三问 A/B 判定（B 档理由落笔到 triage reason：`internal-only-no-public-surface (哪一问: 简述)`）。
    - A 档文件按 README 共用协议写场景（`tests/compat/scenarios/dom/css/<name>.js`，id `css-<basename>`，如 `css-parser`）、逐场景本地对拍至双端一致、登记 ledger diff / upstream-map / ledger up / triage reason 四件套。断言的 enum 值从 `tests/happy-dom/vendor-src-enums/` 内联。
    - 验证计划 §11 四个机制点并留下证据（写入 commit body 与计划回填章节）：
      1. `up` 套件 `upstreamRef` 自锚通过 `npm run compat:ledger`（首次实测 schema/交叉核对接受自锚）；
      2. 场景放 `scenarios/dom/css/` 子目录被 runner 递归发现、id 无重复（runner 拒绝重复 id）；
      3. runner 时长基线：记录本波新增场景对拍耗时（`bun tests/compat/runner/run.js tests/compat/scenarios/dom/css --json` 或等价方式），给出单场景平均子进程耗时；
      4. triage reason 改 `ported-to-diff (hc-diff-<id>)` 后 `compat:hdunit:validate` 与 `compat:hdunit:report` 计数口径不变（enabled/expected-fail/skip 计数与改动前一致）。
    - 回填 `plans/0002-hdunit-internal-to-differential-port.md`：新增「验证点结论」章节（四个机制点结论 + 工作量系数：本波 A 档/B 档/enum-only 各多少、修 facade/core 几处、单文件平均耗时），并把 §1 状态从「草案」改「执行中」。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每个文件 triage reason 为 `ported-to-diff (hc-diff-<id>)` 或 `internal-only-no-public-surface`，无「未 triage」遗留；
    - 每个 A 档场景双端一致、ledger diff 条目与场景一一对应、up 条目与 upstream-map 条目完备，`npm run compat:ledger` 绿；
    - `npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数与改动前一致；
    - 计划文档「验证点结论」章节存在且覆盖四个机制点；commit body 逐文件列明 A/B/enum-only 判定。
  - 阻塞/回退：
    - 若 `up` 套件自锚被 `compat:ledger` 拒绝（schema/交叉核对与计划 §5 描述不符），记录精确报错，不要绕过校验，报告协调器请用户决策；
    - 若某文件三问判定拿不准（介于 A/B 之间），按 B 档处理并写明理由，不猜测可观测性；
    - 不得用 known-gap/expected-fail 兜底滞留双端不一致的场景。

## 预期改动

- `tests/compat/scenarios/dom/css/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/css.json`
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）
- `plans/0002-hdunit-internal-to-differential-port.md`（验证点结论 + 状态）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/css/<path>`（双端一致，exit 0）
- `npm run compat:ledger`（含差分活体跑与交叉核对）
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动 css 子系统；不碰其他子系统 triage 分片与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- enum-only 文件不移植、不改 triage（T12 机械路线范围）；facade-gap 文件不在本计划（facade 实现路线）。
- 不 push、不创建 PR。
