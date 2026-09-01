# 11 hdunit 收尾：CI、报告、文档与仓库门禁

- 状态：待办
- 优先级：P2
- 里程碑：收尾
- 条目 ID：`T11`
- 依赖：T06, T07, T08, T09, T10
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

把 hdunit 从「可运行」变成「可持续的仓库门禁」：接入 CI 与 `npm run validate` 链、提供机器可读报告、补齐文档（tests/happy-dom/README.md、compat/README.md、benchmark/README 与发布技能）、确认发布面不含 hdunit 资产，并输出本队列的最终通过率总结。

## 条目

- [ ] **T11 — CI、报告与文档收尾**
  - 实现：
    - CI（`.github/workflows/ci.yml`）：新增 hdunit 步骤——先 vendor/rewrite 校验（幂等 + 逐字节），再 `npm run compat:hdunit:validate`；失败即 CI 失败；与既有 compat ledger 步骤顺序协调（可在其之前或之后，不得并行占用同一 tmp）；
    - `npm run validate` 追加 `compat:hdunit:validate`（幂等性校验按 CI 需要保留或单独脚本）；
    - 报告：`compat:hdunit:report --json` 输出机器可读汇总（每子系统 enabled/expected-fail/skip 计数、通过率、与上次基线的 delta）；`benchmark/README.md` 补充 hdunit 与 integration benchmark 的关系说明；
    - 文档：
      - `tests/happy-dom/README.md`：目录结构（vendor/rewritten/shim/adapter/triage）、各命令、triage 状态机、如何给新文件 triage、上游升级流程（随 ADR-0002 基线升级一起重 vendor + 重跑门禁）；
      - `compat/README.md`：hdunit 清单与门禁章节（T05 已开，本任务补全运行与 CI 细节）；
      - `.agents/skills/mad-dom-publish/SKILL.md`：发布面确认排除 `tests/happy-dom`（package.json `files` 已排除 tests，补充技能里的检查项）；
    - 最终通过率总结写入 `tests/happy-dom/COVERAGE.md`：各子系统文件数、终态分布、enabled 通过率、known-gap 主要类别，作为下一轮波次的起点基线。
  - 验收：
    - `npm run validate` 全绿（含 hdunit 门禁）；
    - CI 配置正确（本地无法跑 workflow，则逐命令验证等价步骤）；
    - `compat:hdunit:report --json` 可解析且与 triage/ledger 一致；
    - `npm pack --dry-run` 产物不含 tests/happy-dom；
    - COVERAGE.md 数字与 report 一致。
  - 阻塞/回退：CI 接入若与既有 workflow 冲突，记录并报告协调器，不擅自重构 workflow。

## 预期改动

- `.github/workflows/ci.yml`
- `package.json`（validate 链、报告脚本）
- `tests/happy-dom/README.md`、`tests/happy-dom/COVERAGE.md`
- `compat/README.md`
- `benchmark/README.md`、`.agents/skills/mad-dom-publish/SKILL.md`

## 专属校验

- `npm run validate`
- `npm run compat:hdunit:report`（含 --json）
- `npm pack --dry-run`（发布面检查）
- `git diff --check`

## 边界

- 不改 triage 状态（那是 T06–T10 的成果）；只做接入、报告与文档。
- 不 push、不创建 PR、不发布。
- 通过率总结必须诚实（直接由 report 生成），不美化数字。
