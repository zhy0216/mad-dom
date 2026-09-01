# 11 差分移植收尾：口径、文档与性能验收

- 状态：待办
- 优先级：P2
- 里程碑：收尾
- 条目 ID：`D11`
- 依赖：D10
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§8 验收标准、§9 风险）

## 目标

D01–D10 全部合入后收口：更新覆盖口径文档、核对计划验收标准、测性能基线并处置 runner 并发化决策，最后归档计划文档。

## 条目

- [ ] **D11 — 收尾**
  - 实现：
    - **口径文档**：更新 `tests/happy-dom/COVERAGE.md`——ported 文件在 hdunit 仍是 skip（vendored 文件不可运行），理由从「内部耦合不可覆盖」改为「已由差分场景覆盖」（`ported-to-diff (hc-diff-<id>)`）；B 档文件口径为「公开面无等价构造/观测，已豁免」（`internal-only-no-public-surface`）；report 的 skip 计数口径保持原状。
    - **验收核对**：核对计划 §8——`unmapped-internal-import` 文件全部有终态判定（ported-to-diff / internal-only-no-public-surface / enum-only 排除三项之和覆盖全部 196 个）；ledger diff 条目与场景文件一一对应（`npm run compat:ledger` 交叉核对强制）；diff 套件场景数（含既有 33 个）≈ 180+；`npm run compat:hdunit:report` 计数口径与 D01 基线一致。
    - **性能基线**：跑全量 `npm run compat:ledger`（或 `bun tests/compat/runner/run.js tests/compat/scenarios/dom --json`）记录总时长与单场景平均子进程耗时，与 CI 预算对比：
      - 预算内 → 在计划文档「验证点结论」补记最终时长基线；
      - 超预算 → **不停手修并发化**：把「runner 并发化」作为独立任务提案写入计划文档风险章节，并报告协调器请用户决策是否立项（不在本计划范围内，README 用户决策点 2）。
    - **计划归档**：`plans/0002-hdunit-internal-to-differential-port.md` 状态改「已完成」，「验证点结论」补记最终数字（A/B/enum-only 分布、场景总数、时长基线）。
  - 验收：
    - COVERAGE.md 口径与 triage reason 实际状态一致；`npm run compat:hdunit:report` 与 validate 绿；
    - 196 个文件终态判定完备（无「未 triage」遗留），与 `tests/happy-dom/triage/*.json` 逐一机械可核对；
    - `npm run compat:ledger`、`npm run validate` 全绿；
    - 计划文档状态「已完成」且验证点结论章节完整；
    - 若 runner 超预算：提案已落笔并已向用户报告，不作为本任务完成的条件（决策由用户做）。
  - 阻塞/回退：不得为凑「≈180 场景」把 B 档文件强行移植；口径文档必须如实反映 triage 状态。

## 预期改动

- `tests/happy-dom/COVERAGE.md`
- `plans/0002-hdunit-internal-to-differential-port.md`（状态、验证点结论、性能记录）
- 可能：`compat/ledger.json` 的 note / `tests/compat/runner/README.md`（仅当口径描述需要同步时）

## 专属校验

- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`
- `npm run compat:ledger`
- 性能基线测量（runner --json 全量）
- `npm run validate`（仓库级）

## 边界

- 不改场景文件与 triage 条目本身（收尾只动口径文档与计划文档）；发现漏移植/误判时报告协调器，不擅自返工。
- runner 并发化不实做，只提案（用户决策点 2）。
- 不 push、不创建 PR。
