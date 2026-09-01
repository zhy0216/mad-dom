# 09 差分移植波次 W9：svg 子系统内部类

- 状态：待复核
- 优先级：P1
- 里程碑：W9
- 条目 ID：`D09`
- 依赖：D08
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W9）

## 目标

把 svg 子系统 26 个 `unmapped-internal-import` skip 文件（SVGLength、SVGAnimated* 系列、SVGPoint/SVGRect/SVGTransform 等）按共用移植协议（todos/README.md）1:1 移植为差分场景。计划注：内部类测试多为 tagName/属性反射，判定面合并。id 规则：subsystem `svg` + basename，如 `svg/SVGLength.test.ts` → `svg-svg-length`（`<subsystem>-<basename>` 机械套用，kebab 后前缀重复属预期，保持机械一致即可）。部分文件（SVGMatrix 等）上游直接构造内部对象断言内部状态，若公开面读不出则舍去该断言面或整文件 B 档。

## 波次文件清单（26）

`svg/SVGAngle.test.ts`、`svg/SVGAnimatedAngle.test.ts`、`svg/SVGAnimatedBoolean.test.ts`、`svg/SVGAnimatedEnumeration.test.ts`、`svg/SVGAnimatedInteger.test.ts`、`svg/SVGAnimatedLength.test.ts`、`svg/SVGAnimatedLengthList.test.ts`、`svg/SVGAnimatedNumber.test.ts`、`svg/SVGAnimatedNumberList.test.ts`、`svg/SVGAnimatedPreserveAspectRatio.test.ts`、`svg/SVGAnimatedRect.test.ts`、`svg/SVGAnimatedString.test.ts`、`svg/SVGAnimatedTransformList.test.ts`、`svg/SVGLength.test.ts`、`svg/SVGLengthList.test.ts`、`svg/SVGMatrix.test.ts`、`svg/SVGNumber.test.ts`、`svg/SVGNumberList.test.ts`、`svg/SVGPoint.test.ts`、`svg/SVGPointList.test.ts`、`svg/SVGPreserveAspectRatio.test.ts`、`svg/SVGRect.test.ts`、`svg/SVGStringList.test.ts`、`svg/SVGTransform.test.ts`、`svg/SVGTransformList.test.ts`、`svg/SVGUnitTypes.test.ts`

## 条目

- [ ] **D09 — W9 svg 子系统差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（如 SVGUnitTypes 若仅枚举，triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - 判定面合并：SVGAnimated* 系列先确定 1–2 个代表（如 SVGAnimatedBoolean、SVGAnimatedLength）的公开面等价写法与舍弃面，其余同族套用同一模板；SVGLength/SVGNumber/SVGPoint/SVGRect 等基础值对象看公开构造与公开成员读写是否等价，读不出 → B 档。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/svg/<name>.js`）、逐场景对拍至双端一致、登记四件套。enum 值断言从 `tests/happy-dom/vendor-src-enums/` 内联。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/svg/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/svg.json`
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/svg/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动 svg 子系统；不碰 nodes 子系统 triage 条目与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 纯内部对象状态断言无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
