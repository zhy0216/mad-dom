# 10 hdunit 波次：内部耦合子系统 triage

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T10`
- 依赖：T05
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

为 `rewritten/` 中依赖纯内部模块、无法机械移植的子系统给出**终态**：svg（约 26 个文件，全部内部耦合）、cookie/cookie-store、history、html-parser、module、javascript、location、match-media、navigator、permissions、query-selector、range、selection、utilities、web-socket、xml-http-request、xml-parser、xml-serializer、custom-element、index（合计约 49 个文件）。每个文件必须收敛为 `enabled` / `skip` / `expected-fail` 之一（带 reason），不允许「未 triage」遗留。

## 条目

- [ ] **T10 — 内部耦合子系统终态 triage**
  - 实现：
    - 按 T02 report 的 unmappedImports 分类逐文件判定：
      - `propertysymbol` 依赖（约 105 个文件，含 svg 大部分）→ 默认 `skip`，reason 引用 T04 边界（PropertySymbol 私有 symbol 机制不可移植）；
      - 依赖内部 *Utility / parser / Browser 内部 → `skip` + reason（`internal-<module>`）；其中与 mad-dom 已有能力重叠的可考虑「改写为公开 API」路径——但**改写文件进入 `tests/compat` 或登记为 `up` 套件**，不属于 hdunit 原样门禁（此路径可选，不作为验收要求）；
      - 全部 import 可映射但仍依赖 `src/index.js` named 导入的文件（如 `index.test.ts`）：若 named 面已由 T04 的 `shim/src/index.ts` 覆盖则可 `enabled` 实跑；否则 `expected-fail` + reason；
      - 个别可实跑的（如 range/selection 若已有 facade 能力）：置 enabled 跑绿或修复后跑绿。
    - 为每个子系统写 `tests/happy-dom/triage/<subsystem>.json` 分片；ledger 按子系统各一条汇总条目；
    - 全部完成后跑 `compat:hdunit:validate`，保证门禁绿、无未分类文件。
  - 验收：
    - 本轮所有子系统分片门禁绿；`compat:hdunit:report` 显示全部 vendored 文件都有终态（enabled/expected-fail/skip 计数之和 = rewrite-report 文件总数）；
    - 每个 skip/expected-fail 的 reason 可复核且引用具体模块路径（机械可查）；
    - enabled 文件全部实跑通过；
    - `npm run validate` 全绿。
  - 阻塞/回退：同 T06。

## 预期改动

- `tests/happy-dom/triage/<内部耦合子系统>.json`
- `compat/ledger.json`、`compat/upstream-map.json`
- 如需启用个别文件：`js/facade/**` 修复及配套测试

## 专属校验

- `npm run compat:hdunit:validate`
- `npm run compat:hdunit:report`（终态覆盖率检查）

## 边界

- 不碰 T06–T09 已声明分片与目录。
- 不为内部模块造行为 shim（T04 边界）；「改写为公开 API」只作为可选项登记到 report，不作为 hdunit 的 pass。
- skip 比例高是本波次的预期结果（svg 等子系统上游强依赖内部实现），如实记录即可，不强行压低。
- 不手改 rewritten/vendor 文件。
