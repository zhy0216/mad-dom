# MAD DOM TODO 队列（hdunit：happy-dom 单测套件移植）

本目录把「happy-dom 上游单测套件移植为 mad-dom 持续合规门禁」拆成适合 `$herdr-finish-todo` 并发执行的小型工作单元。这是第一轮队列（T01–T50）全部归档后的第二轮队列，编号从 T01 重新开始；仓库文档中指向 `todos/<数字>-*` 的旧链接一律指第一轮队列（已归档移除），与本轮无关。

每个编号文件对应一个稳定条目 ID、一个独立任务分支和一个最终本地 commit；实现可以并发，rebase、校验、合并和清理必须由协调器逐项串行完成。README 和各 TODO 文件是本地调度真相源。Issue（如果将来建立）只能作为镜像，不能替代依赖、验收条件或状态；本流程不会自动 push、创建 PR 或修改远端 issue。

## 背景与总体策略

happy-dom 单测套件（约 302 个 `*.test.ts`、约 9.9 万行，vitest + TypeScript）**不能只改 import 名原样运行**：其运行时 import 中约 1534 条指向上游内部 `src/` 路径（约 492 个模块，其中约 227 个是 PropertySymbol、*Utility、内部 parser/enum 等纯内部模块）。总体策略（用户已确认）：

1. **Vendor**：把上游 test/ 原样 vendor 进仓库（MIT，锁定兼容基线版本 v20.11.11 @ `64e2c774…`，与 `compat/happy-dom-baseline.json` 交叉核对）。
2. **机械重写**：用脚本把 `src/…` 内部路径改写为 shim 路径、`vitest` 改写为 `bun:test` + 适配层（保真，不手改断言）。
3. **Shim 层**：为可映射到公开 API 的内部模块生成 re-export shim；Window 等构造签名做适配。
4. **Triage + 门禁**：每个 vendored 文件登记终态（`enabled` / `skip` / `expected-fail`），按子系统分片存放；新 ledger 套件 `hdunit` 记录兼容结论，退化门禁把守。
5. **子系统波次**：基建完成后按子系统逐波启用测试、修复 facade/core 差异、诚实记录 known-gap。

runner 用 **bun test**（不是 vitest）：`vi.fn`/`vi.spyOn`/`vi.clearAllMocks` 与 bun `mock`/`spyOn`/`clearAllMocks` 一一对应（已验证 bun 1.4.0），`vi.restoreAllMocks` 由适配层注册表实现，`vi.mock`（仅 4 处、集中在 setup）由适配层用 `mock.module` 手工移植。

## 入口与前置检查

- 只有用户显式调用 `$herdr-finish-todo`、`/herdr-finish-todo` 或明确要求用 Herdr 并发清理 TODO 时，才按本协议启动任务。可传入文件名、序号、优先级或条目 ID 过滤；过滤后仍保持原队列顺序。
- 协调器留在调用 skill 时的原 checkout，独占原分支的 rebase 复核、仓库级校验、快进合并和资源清理；实现 agent 不得切换、修改或合并原分支。
- 必须在 Herdr 管理的 pane 中运行：`test "${HERDR_ENV:-}" = 1`。失败时停止，不从 Herdr 外部控制会话。
- 原 checkout 必须处于有名字的分支、非 detached HEAD 且 `git status --porcelain` 为空。发现用户改动时停止，不自行 stash、提交、覆盖或丢弃。
- 启动任务前完整读取本 README、适用的 `AGENTS.md`/`CLAUDE.md`、仓库 README、构建配置和相关 ADR（尤其 `adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md`）；确认至少有一条能发现编译或类型错误的命令，并确定测试命令。只做只读能力检查，并记录本轮已有资源；不要用裸 `herdr` 做发现：
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
- OpenCode 必须显式使用 `deepseek/deepseek-v4-flash`；不可静默改用其他模型。只清理本轮创建、且已成功合并的 workspace、worktree 和分支。
- 解析仓库根目录，记录原分支名和起始 HEAD；后续每次集成都重新记录 base HEAD。前置条件不满足时停止并报告，不猜测或替代缺失的校验命令。

## 并发调度协议

### 选择可运行任务

每次补位都重新读取本 README 和候选 TODO 的完整原文，按以下顺序选择：

1. 跳过 `todos/README.md` 与 `todos/done/`；所有依赖任务必须处于“已完成”（通常已归档到 `todos/done/`，或已在本轮合并并完成清理）状态。
2. 优先级按 `P0 → P1 → P2`，同优先级按编号升序；优先级只用于可运行候选的排序，不得绕过硬依赖。
3. 只有彼此无依赖关系、没有共同文件或模块写入、没有迁移顺序或未决产品/范围决策的任务才可并行。一个 TODO 文件不得拆给多个 worktree。
4. “预期改动”是所有权提示，不是扩大范围的授权。声明路径重叠、共享入口/fixture 或实际 diff 可能冲突时，保守地串行化；必要时先拆出更小 TODO 并更新本表。

开工前为每个候选建立可追踪记录：TODO 文件和条目 ID、验收条件、预期改动、专属校验、依赖、重叠/冲突风险，以及是否存在 roadmap、blocked 或需要用户决策的范围。向用户报告依赖关系、任务顺序和首批分配后，才创建 worktree 和 agent。

### 滑动窗口

- 同时处于 `starting`、`working`、`done-but-not-integrated`、`reviewing` 或 `rebasing` 的任务总数最多为 **5**。
- 资源不足或没有足够独立的候选时可以少于 5，不为了凑数启动有依赖或明显冲突的任务。
- 一个任务完成合并并清理后，立即从队列中选择下一个依赖已满足的候选补位，不等待整批任务结束。

候选波次参考（调度器必须随状态变化重新计算）：

| 依赖满足后      | 可考虑并发的候选 | 额外约束                                                                 |
| --------------- | ---------------- | ------------------------------------------------------------------------ |
| T01             | T02、T03、T04    | 三者通过 T01 冻结的 `vendor-scan.json` 字段契约对接；T02 写 `scripts/` 与 `tests/happy-dom/rewritten/`、T03 写 `tests/happy-dom/adapter/`、T04 写 `tests/happy-dom/shim/`，文件不重叠，可并发 |
| T02、T03、T04   | T05              | 集成闸门：harness 三件套齐备后才统一定义 triage schema 与门禁；独占 `compat/` ledger/upstream-map schema 扩展 |
| T05             | T06–T10          | 每波独占自己的子系统目录与 triage 分片文件，互不重叠，可并发（正好填满 5 窗口） |
| T06–T10         | T11              | 收尾独占 CI、报告、README/docs 与发布面                                    |

### Worktree 与 agent

为每个任务生成唯一 agent 名称（`[a-z][a-z0-9_-]{0,31}`）和建议分支名 `herdr/hdunit-<序号>-<slug>`；名称已存在时生成新名称，不覆盖既有资源。创建 worktree 时从原分支最新提交开始并保持用户焦点不变：

```sh
herdr worktree create --cwd <repo-root> --branch <task-branch> --base <base-branch> --label <todo-label> --no-focus
herdr agent start <agent-name> --kind opencode --pane <pane-id> -- --auto --model deepseek/deepseek-v4-flash
```

必须从 `herdr worktree create` 的 JSON 响应读取实际 workspace ID、worktree 路径和 root pane ID，并持续保存“TODO、分支、workspace、pane、agent、路径、状态”映射；不要猜测 ID，也不要使用 `opencode --fork` 代替独立 worktree。

发送给 agent 的提示必须包含 TODO 原文、验收条件、允许修改的范围、仓库约束和校验命令，并至少明确：

```text
你位于 Herdr 为本任务创建的独立 Git worktree，只处理指定 todo 文件。
完整读取 todo 原文、仓库说明和相关源码；实现全部验收条件，不顺手重构、不升级依赖、不修改无关文件。
只在当前任务分支执行 git 写操作；禁止切换、修改或合并原分支，禁止 push、创建 PR、stash、删除 worktree 或操作其他任务分支。
运行与改动相关的校验。全部完成时更新本任务 todo 状态；不要修改 todos/README.md、其他 todo 文件、compat/ledger.json 与其他任务声明的文件，归档和队列表更新由协调器在集成锁内完成。
创建且只保留一个本地任务 commit，遵循仓库提交风格；此阶段不要 rebase 或 merge，协调器会在集成阶段另行通知。
结束时报告 commit、修改文件、逐条验收证据、校验命令与结果、剩余风险或 blocker，并保持 worktree 干净。
```

### 监控与完成判定

所有任务启动后使用 `herdr agent list/get/read/wait` 监控。只有观察到 agent 曾进入 `working` 生命周期后回到 `idle`，或明确为 `done`，才可进入复核；`unknown` 不代表完成。读取 agent 输出优先使用：

```sh
herdr agent read <agent-name> --source recent-unwrapped --lines 160
```

对仍处于 `working`/Thinking 的任务采用 5 分钟节奏：批量刷新一次状态；若没有 `done`、`idle` 或 `blocked` 等可操作状态，选择一个正在工作的 agent 执行：

```sh
herdr agent wait <agent-name> --timeout 300000
```

`wait` 因 settle 提前返回时立即处理并刷新所有任务；`timeout` 只是下一个检查点。不得用 15 秒等短间隔高频轮询，也不得仅因 Thinking 时间长、连续检查无改动或画面不变就发送 `esc`/`ctrl+c`、重启或改写任务。只有明确错误、进程退出、需要交互的 `blocked` 或用户要求停止时，才中断正常等待。

任务进入 `blocked` 时先读取界面和原因；不得盲目发送按键，也不得替用户回答范围、权限或产品决策。保留未保存工作的 worktree，记录 blocker，并继续补位其他无依赖任务。

## 状态、复核与集成

TODO 文件使用以下状态词：`待办`、`进行中`、`待复核`、`待集成`、`部分完成`、`blocked-on:Txx[A-Z]?` 和 `已完成`。只有全部条目、专属校验和仓库级校验都通过，且文件已移动到 `todos/done/`，才能标为“已完成”；blocked 或部分完成不得误标完成。

agent 报告完成后，协调器必须独立检查：

- worktree `git status --short` 为空且没有进行中的 rebase；
- 相对原分支确有任务 commit，并且最终只保留一个任务 commit；
- diff 只覆盖该 TODO 的合理范围，每条验收条件都有代码或测试证据；
- `git diff --check` 和条目专属校验通过。证据不足时把具体问题发回原 agent，并 amend 同一个任务 commit。

rebase → 校验 → merge 持有单一集成锁，一次只处理一个任务。集成时：

1. 再次确认原 checkout 干净并记录当前 base HEAD。
2. 通知同一 agent 将任务分支 rebase 到 base 最新提交，亲自解决全部冲突并重新运行相关校验；不得在此阶段 merge、push、切换原 checkout 或清理 worktree。提示至少包含：
   ```text
   进入集成阶段。将当前任务分支 rebase 到原分支 <base-branch> 的最新提交。
   必须亲自解决全部冲突，保留原分支已合入任务的正确行为，同时保留本 todo 的验收结果。
   完成 rebase 后重新运行相关校验；若需要修复，只 amend 当前任务 commit。
   不要 merge、push、切换原 checkout 或清理 worktree。返回新 HEAD、冲突处理摘要、git status 和校验结果。
   ```
3. 等 agent settle 后，确认 rebase 已结束、worktree 干净、原分支是任务分支祖先、任务仍只有一个 commit，并重新审查完整 diff。
4. 协调器在任务 worktree 中亲自运行仓库级校验；agent 自报结果不能替代本步骤。
5. 回到原 checkout，使用快进合并：
   ```sh
   git merge --ff-only <task-branch>
   ```
6. 验证原分支 HEAD 等于任务分支 HEAD、TODO 状态正确且 `git status --short` 为空。

若 `--ff-only` 失败，视为 base 在集成锁期间变化或 rebase 不完整；不得强行 merge，重新获取 base、rebase、解决冲突并复验。

不得使用 merge commit、force-push、reset 原分支或以覆盖冲突绕过 rebase。真正 blocked 的任务保留现场并记录原因，不强制清理含未保存工作的 worktree。

## 清理、归档与补位

仅对已经成功合并且确认干净的本轮资源执行清理：优先让 agent 正常退出，然后使用记录的 workspace ID：

```sh
herdr worktree remove --workspace <workspace-id>
git branch -d <task-branch>
```

若 OpenCode 仍占用 workspace，先使用 `herdr agent send-keys <agent-name> ctrl+c` 并确认进程退出，再重试。只有分支已合并、worktree 干净、路径和 workspace ID 均与本轮记录完全一致时，才可考虑 `--force`；否则停止并报告。清理成功后，将 TODO 整体移动到 `todos/done/`，把本表链接改为 `done/<filename>` 并标为“已完成”，随后立即补充下一个可运行任务。

收尾报告必须列出：合入 commit 与对应 TODO、归档文件、每个任务的仓库级校验证据、blocked/deferred/未完成项及原因、仍保留的 Herdr 资源及原因，以及原分支最终 `git status --short`。不 push、不创建 PR，除非用户另行明确要求。

## 仓库级校验约定

当前每个 TODO 都必须在条目专属命令之外运行：

```sh
npm run validate
git diff --check
```

`npm run validate` 依次覆盖 JavaScript 检查、Rust fmt/Clippy/测试、Bun 测试、类型兼容和兼容清单。hdunit 基建（T01–T05）完成后，`compat:hdunit:validate` 将作为兼容门禁的一部分（T11 接入 CI 与 validate 链）；在 T11 之前，各 TODO 按各自文件列出的专属校验执行，局部 agent 的结果不能代替协调器的仓库级校验。

## 有序队列

| 顺序 | 优先级 | TODO 文件 | 里程碑 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 01 | P0 | [01-happy-dom-unit-vendor.md](done/01-happy-dom-unit-vendor.md) | 基建 | 无 | 已完成 |
| 02 | P0 | [02-happy-dom-unit-rewrite.md](done/02-happy-dom-unit-rewrite.md) | 基建 | T01 | 已完成 |
| 03 | P0 | [03-happy-dom-unit-bun-adapter.md](03-happy-dom-unit-bun-adapter.md) | 基建 | T01 | 待办 |
| 04 | P0 | [04-happy-dom-unit-shim.md](done/04-happy-dom-unit-shim.md) | 基建 | T01 | 已完成 |
| 05 | P0 | [05-hdunit-triage-ledger-gate.md](05-hdunit-triage-ledger-gate.md) | 基建 | T02, T03, T04 | 待办 |
| 06 | P1 | [06-hdunit-nodes-wave.md](06-hdunit-nodes-wave.md) | 波次 | T05 | 待办 |
| 07 | P1 | [07-hdunit-event-dom-window-browser-wave.md](07-hdunit-event-dom-window-browser-wave.md) | 波次 | T05 | 待办 |
| 08 | P1 | [08-hdunit-lightweight-wave.md](08-hdunit-lightweight-wave.md) | 波次 | T05 | 待办 |
| 09 | P1 | [09-hdunit-css-fetch-wave.md](09-hdunit-css-fetch-wave.md) | 波次 | T05 | 待办 |
| 10 | P1 | [10-hdunit-internal-coupled-triage.md](10-hdunit-internal-coupled-triage.md) | 波次 | T05 | 待办 |
| 11 | P2 | [11-hdunit-closeout.md](11-hdunit-closeout.md) | 收尾 | T06, T07, T08, T09, T10 | 待办 |

## 优先级含义

- `P0`：hdunit 移植基建（vendor、重写管线、bun 适配层、shim 层、triage 清单与门禁），决定整条队列的可行性与规模。
- `P1`：子系统波次（按子系统启用 vendored 测试、修复 facade/core 差异、诚实 triage），是兼容性覆盖的实际来源。
- `P2`：收尾（CI 接入、报告、文档、发布面排除），把 hdunit 变成可持续的仓库门禁。
