# MAD DOM TODO 队列（差分移植：hdunit 内部耦合文件 → hc-diff 公开 API 场景）

本目录把 [plans/0002-hdunit-internal-to-differential-port.md](../plans/0002-hdunit-internal-to-differential-port.md) 拆成适合 `$herdr-finish-todo` 执行的小型工作单元。这是第三轮队列，编号从 D01 重新开始；仓库文档中指向 `todos/<数字>-*` 的旧链接一律指第一、二轮队列（已归档移除），与本轮无关。

每个编号文件对应一个稳定条目 ID、一个独立任务分支和一个最终本地 commit。README 和各 TODO 文件是本地调度真相源。本流程不会自动 push、创建 PR 或修改远端 issue。

## 背景与总体策略

hdunit triage 有 196 个 `status=skip` 且 reason 含 `unmapped-internal-import` 的 vendored 文件，其运行时导入 happy-dom **内部实现模块**（CSSParser、SVGLength、CharacterDataUtility、各类内部类），机械重写管线救不回来。计划 0002 的终态：把这批文件 **1:1 移植为差分场景**——逐文件提取上游断言的公开可观察行为，用公开 API（`new entry.Window()` + 公开成员）重写，放入差分套件 `tests/compat/scenarios/`，由 runner 对 happy-dom v20.11.11 与 mad-dom 双端对拍，**happy-dom 当 oracle**：fidelity 由差分器机械保证。

## 共用移植协议（计划 §3–§5，每个波次文件都遵守）

### A/B 判定（每文件三问）

1. **可构造**：上游断言起始状态能否通过公开 API 构造（`new CSSParser(sheet)` → `sheet.cssText` / `sheet.insertRule()`）。
2. **可观测**：断言读取的最终状态能否通过公开 API 读出（内部属性 → 公开 getter / 序列化 / 事件）。
3. **可差分**：行为是否依赖宿主、网络、真实时间或随机数（是 → 不可差分）。

- **A 档**：三问全满足 → 写场景。
- **B 档**：任一不满足 → 不移植，triage reason 改为 `internal-only-no-public-surface (哪一问: 简述)`，保持 skip。理由必须逐项落笔，不得以「不好写」代替「不可观测」。
- **enum-only 排除**：仅含 enum/type-only 内部导入、无内部实现模块运行时构造的文件**不属于本计划**（计划 §2，T12 机械路线），原样保留，triage 不动，在 commit body 列明。

### A 档四件套（缺一不可）

1. **场景文件**：`tests/compat/scenarios/dom/<subsystem>/<name>.js`，id = `<subsystem>-<basename>`（kebab-case，去 `.test` 后缀，如 `css/CSSParser.test.ts` → `css-parser`）。只允许 `entry.Window` 构造面 + 公开成员；全部状态经 `api.record.*` 归一化记录；固定输入，无随机/时间依赖；文件头复用 rewritten 头格式的 MIT provenance 块（upstream path / commit `64e2c774cadbb8eda5416c1e2bcca5006d1b5df9` / tag v20.11.11 / license + 移植说明 + 舍弃面说明），保真声明写「hand-ported to public API」。断言迁移：上游内部方法调用 → 公开等价操作；enum/常量值断言 → 从 `tests/happy-dom/vendor-src-enums/` 字面量内联；公开面无法区分的断言 → 舍去并注明。
2. **对拍**：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>` 双端一致（不一致 → 修 facade/core，或按上条规则缩小断言面）。**双端不一致不许合入**，不得用 known-gap / expected-fail 兜底滞留，合入即 `pass`。
3. **ledger + upstream-map 三条**：
   - ledger diff 条目：`{ id: "hc-diff-<id>", suite: "diff", status: "pass", subsystem, scenario: "<id>", addedIn: "<波次>" }`
   - upstream-map 条目：`{ localId: "hc-up-<id>", upstreamPath: "packages/happy-dom/test/<原路径>", upstreamCommit: 64e2c774…, license: "MIT", localPath: "<场景文件>" }`
   - ledger up 条目：`{ id: "hc-up-<id>", suite: "up", status: "pass", upstreamRef: "hc-up-<id>", subsystem, addedIn }`（自锚；schema 已支持，validate-ledger 只查存在性）
4. **triage 更新**：该文件 reason 改为 `ported-to-diff (hc-diff-<id>)`，status 保持 skip（vendored 文件本身跑不了）。hdunit coverage 计数口径不变。

### 每波门禁（全绿才合入）

```sh
npm run compat:ledger        # 差分活体跑 + ledger/upstream-map 交叉核对
npm run compat:hdunit:validate
npm run validate
```

## 并发调度协议

**本轮队列严格串行**：计划 §6 明确 `compat/ledger.json` 与 `compat/upstream-map.json` 是单文件，波间串行集成，不并行。每个 TODO 依赖前一个，滑动窗口恒为 1：D01 → D02 → … → D11。不要为了并发把任一波次拆给多个 worktree。

**用户决策点（两处）**：

1. **D01 合入后、D05 启动前**：协调器向用户报告 W1 工作量系数（移植 : 修实现）、验证点结论与 runner 时长基线，由用户决定 W5–W9（D05–D09）是否按文件数重排。D02–D04 不受影响，可继续。
2. **D11 收尾时**：若 runner 总时长（≈ 2 × 场景数个子进程）超出 CI 预算，把「runner 并发化」列为独立任务——是否立项由用户决定，不在本计划内。

## 入口与前置检查

- 只有用户显式调用 `$herdr-finish-todo`、`/herdr-finish-todo` 或明确要求用 Herdr 清理 TODO 时，才按本协议启动任务。可传入文件名、序号、优先级或条目 ID 过滤；过滤后仍保持原队列顺序（本轮即 D01→D11 全串行）。
- 协调器留在调用 skill 时的原 checkout，独占原分支的 rebase 复核、仓库级校验、快进合并和资源清理；实现 agent 不得切换、修改或合并原分支。
- 必须在 Herdr 管理的 pane 中运行：`test "${HERDR_ENV:-}" = 1`，失败即停。
- 原 checkout 必须处于有名字的分支、非 detached HEAD 且 `git status --porcelain` 为空。
- 启动前完整读取本 README、[plans/0002](../plans/0002-hdunit-internal-to-differential-port.md)、`adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md`、`adr/0006-happy-dom-unit-suite-hdunit.md`，确认校验命令；只做只读检查：

  ```sh
  test "${HERDR_ENV:-}" = 1
  herdr --help
  herdr agent
  herdr worktree
  command -v opencode
  opencode models deepseek
  git status --porcelain
  git worktree list
  herdr agent list
  herdr worktree list --cwd <repo-root>
  ```

- OpenCode 必须显式使用 `deepseek/deepseek-v4-flash`，不可静默换模型。只清理本轮创建且已成功合并的 workspace、worktree 和分支。

## Worktree 与 agent

每个任务一个独立 worktree（base 为原分支最新提交），agent 名称符合 `[a-z][a-z0-9_-]{0,31}`，建议分支名 `herdr/diff-<序号>-<slug>`；名称已存在时生成新名称：

```sh
herdr worktree create --cwd <repo-root> --branch <task-branch> --base <base-branch> --label <todo-label> --no-focus
herdr agent start <agent-name> --kind opencode --pane <pane-id> -- --auto --model deepseek/deepseek-v4-flash
```

必须从 `herdr worktree create` 的 JSON 响应读取实际 workspace ID、worktree 路径和 root pane ID，持续保存「TODO、分支、workspace、pane、agent、路径、状态」映射。发送给 agent 的提示必须包含 TODO 原文、验收条件、允许修改的范围、仓库约束和校验命令，并至少明确：

```text
你位于 Herdr 为本任务创建的独立 Git worktree，只处理指定 todo 文件。
完整读取 todo 原文、plans/0002-hdunit-internal-to-differential-port.md、仓库说明和相关源码；实现全部验收条件，不顺手重构、不升级依赖、不修改无关文件。
只在当前任务分支执行 git 写操作；禁止切换、修改或合并原分支，禁止 push、创建 PR、stash、删除 worktree 或操作其他任务分支。
运行与改动相关的校验。全部完成时更新本任务 todo 状态；不要修改 todos/README.md、其他 todo 文件，归档和队列表更新由协调器在集成锁内完成。
创建且只保留一个本地任务 commit，遵循仓库提交风格；commit body 逐文件列明 A 档/B 档/enum-only 排除判定。此阶段不要 rebase 或 merge，协调器会在集成阶段另行通知。
结束时报告 commit、修改文件、逐条验收证据、校验命令与结果、剩余风险或 blocker，并保持 worktree 干净。
```

## 监控与完成判定

所有任务启动后用 `herdr agent list/get/read/wait` 监控。只有观察到 agent 曾进入 `working` 生命周期后回到 `idle`，或明确为 `done`，才可进入复核；`unknown` 不代表完成。读取输出优先：

```sh
herdr agent read <agent-name> --source recent-unwrapped --lines 160
```

对仍处于 `working`/Thinking 的任务采用 5 分钟节奏：批量刷新一次状态；没有 `done`、`idle` 或 `blocked` 等可操作状态时，选一个工作中的 agent 执行 `herdr agent wait <agent-name> --timeout 300000`。`wait` 因 settle 提前返回时立即处理并刷新所有任务；`timeout` 只是下一个检查点。不得高频轮询，也不得仅因 Thinking 时间长、连续检查无改动就发送 `esc`/`ctrl+c`、重启或改写任务。只有明确错误、进程退出、需要交互的 `blocked` 或用户要求停止时，才中断正常等待；`blocked` 时先读界面和原因，不替用户回答范围、权限或产品决策。

## 状态、复核与集成

TODO 文件使用状态词：`待办`、`进行中`、`待复核`、`待集成`、`部分完成`、`blocked-on:Dxx` 和 `已完成`。只有全部条目、专属校验和仓库级校验都通过，且文件已移动到 `todos/done/`，才能标为「已完成」。

agent 报告完成后，协调器必须独立检查：

- worktree `git status --short` 为空且没有进行中的 rebase；
- 相对原分支确有任务 commit，且最终只保留一个任务 commit；
- diff 只覆盖该 TODO 的合理范围；每条验收条件有代码或测试证据；
- 场景文件与 ledger diff 条目一一对应（`compat:ledger` 交叉核对强制）；B 档判定在 triage reason 与 commit body 中逐项列明；
- `git diff --check` 与条目专属校验通过。证据不足时把具体问题发回原 agent 并 amend 同一个任务 commit。

rebase → 校验 → merge 持有单一集成锁。集成时：

1. 再次确认原 checkout 干净并记录当前 base HEAD。
2. 通知同一 agent 将任务分支 rebase 到 base 最新提交，亲自解决全部冲突（重点：`compat/ledger.json`、`compat/upstream-map.json`、`tests/happy-dom/triage/*.json`、`plans/0002-*.md`）并重新运行相关校验；不得在此阶段 merge、push、切换原 checkout 或清理 worktree。
3. 等 agent settle 后确认 rebase 结束、worktree 干净、原分支是任务分支祖先、任务仍只有一个 commit，并重新审查完整 diff。
4. 协调器在该 worktree 中亲自运行仓库级校验；agent 自报结果不能替代本步骤。
5. 回到原 checkout，`git merge --ff-only <task-branch>`；失败视为 base 变化或 rebase 不完整，不得强行 merge，重新 rebase、解决冲突并复验。
6. 验证原分支 HEAD 等于任务分支 HEAD、TODO 状态正确、`git status --short` 为空。

不得用 merge commit、force-push、reset 原分支或以覆盖冲突绕过 rebase。真正 blocked 的任务保留现场并记录原因。

## 清理、归档与补位

仅对已成功合并且确认干净的本轮资源执行清理：优先让 agent 正常退出，然后：

```sh
herdr worktree remove --workspace <workspace-id>
git branch -d <task-branch>
```

若 OpenCode 仍占用 workspace，先用 `herdr agent send-keys <agent-name> ctrl+c` 确认退出再重试；只有分支已合并、worktree 干净、路径和 workspace ID 均与本轮记录一致时才可考虑 `--force`。清理成功后把 TODO 移到 `todos/done/`、更新本表链接并标「已完成」，然后启动下一个任务（本轮即 D01→D11 依次推进）。

收尾报告必须列出：合入 commit 与对应 TODO、归档文件、每个任务的仓库级校验证据、blocked/deferred/未完成项及原因、仍保留的 Herdr 资源及原因，以及原分支最终 `git status --short`。不 push、不创建 PR。

## 仓库级校验约定

每个 TODO 都必须在其专属校验之外运行：

```sh
npm run validate
git diff --check
```

`npm run validate` 已包含 `compat:ledger`（差分活体跑 + ledger 交叉核对）与 `compat:hdunit:validate`，但各 TODO 仍须先跑条目专属校验（逐场景对拍、`compat:ledger`、`compat:hdunit:validate`），局部 agent 的结果不能代替协调器的仓库级校验。

## 有序队列

| 顺序 | 优先级 | TODO 文件 | 里程碑 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 01 | P0 | [01-diff-port-css-pilot.md](done/01-diff-port-css-pilot.md) | W1 pilot（css，17） | 无 | 已完成 |
| 02 | P1 | [02-diff-port-w2-dom-query.md](done/02-diff-port-w2-dom-query.md) | W2（dom/query-selector/range/selection/utilities，9） | D01 | 已完成 |
| 03 | P1 | [03-diff-port-w3-fetch-xhr-ws.md](done/03-diff-port-w3-fetch-xhr-ws.md) | W3（fetch/xml-http-request/web-socket，10） | D02 | 已完成 |
| 04 | P1 | [04-diff-port-w4-browser-window.md](done/04-diff-port-w4-browser-window.md) | W4（browser/window/location/history，13） | D03 | 已完成 |
| 05 | P1 | [05-diff-port-w5-nodes-core.md](done/05-diff-port-w5-nodes-core.md) | W5（nodes 核心内部类，13） | D04 | 已完成 |
| 06 | P1 | [06-diff-port-w6-nodes-html.md](done/06-diff-port-w6-nodes-html.md) | W6（nodes html 元素，22） | D05 | 已完成 |
| 07 | P1 | [07-diff-port-w7-nodes-svg-a.md](done/07-diff-port-w7-nodes-svg-a.md) | W7（nodes svg 元素 A–FE，36） | D06 | 已完成 |
| 08 | P1 | [08-diff-port-w8-nodes-svg-b.md](08-diff-port-w8-nodes-svg-b.md) | W8（nodes svg 元素 FI–V，33） | D07 | 待办 |
| 09 | P1 | [09-diff-port-w9-svg.md](09-diff-port-w9-svg.md) | W9（svg，26） | D08 | 待办 |
| 10 | P1 | [10-diff-port-w10-tail.md](10-diff-port-w10-tail.md) | W10（尾部杂项，17） | D09 | 待办 |
| 11 | P2 | [11-diff-port-closeout.md](11-diff-port-closeout.md) | 收尾（口径、文档、性能验收） | D10 | 待办 |

## 优先级含义

- `P0`：pilot 波次，先验证四件套登记机制、up 套件自锚、子目录场景发现与工作量系数，并回填计划「验证点结论」。
- `P1`：常规波次，按子系统/上游目录逐文件 A/B 判定、写场景、登记四件套，是差分覆盖的实际来源。
- `P2`：收尾（COVERAGE/report 口径、计划归档、性能验收与决策）。
