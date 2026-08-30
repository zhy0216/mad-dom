# MAD DOM TODO 队列

本目录把 [ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 拆成适合 `$herdr-finish-todo` 并发执行的小型工作单元。每个编号文件对应一个稳定条目 ID、一个独立任务分支和一个最终本地 commit；实现可以并发，rebase、校验、合并和清理必须由协调器逐项串行完成。

README 和各 TODO 文件是本地调度真相源。Issue（如果将来建立）只能作为镜像，不能替代依赖、验收条件或状态；本流程不会自动 push、创建 PR 或修改远端 issue。

## 入口与前置检查

- 只有用户显式调用 `$herdr-finish-todo`、`/herdr-finish-todo` 或明确要求用 Herdr 并发清理 TODO 时，才按本协议启动任务。可传入文件名、序号、优先级或条目 ID 过滤；过滤后仍保持原队列顺序。
- 协调器留在调用 skill 时的原 checkout，独占原分支的 rebase 复核、仓库级校验、快进合并和资源清理；实现 agent 不得切换、修改或合并原分支。
- 必须在 Herdr 管理的 pane 中运行：`test "${HERDR_ENV:-}" = 1`。失败时停止，不从 Herdr 外部控制会话。
- 原 checkout 必须处于有名字的分支、非 detached HEAD 且 `git status --porcelain` 为空。发现用户改动时停止，不自行 stash、提交、覆盖或丢弃。
- 启动任务前完整读取本 README、适用的 `AGENTS.md`/`CLAUDE.md`、仓库 README、构建配置和相关计划；确认至少有一条能发现编译或类型错误的命令，并确定测试命令。只做只读能力检查，并记录本轮已有资源；不要用裸 `herdr` 做发现：

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
- 截至当前队列快照，T20 已完成，先串行完成结构 seam **T20A**；随后 **T21A 与 T21B** 可并发。T21、T22、T23、T24、T25 是集成闸门，不得与各自子任务并发。T25 归档后，T26、T30、T37 是下一组候选，但仍须在启动前检查实际文件/模块冲突。下面的候选波次是参考，不是固定批次，调度器必须随状态变化重新计算。

| 依赖满足后 | 可考虑并发的候选 | 额外约束 |
| --- | --- | --- |
| T20 | T20A | 结构 seam 独占共享注册文件，必须先串行完成。 |
| T20A | T21A、T21B | error taxonomy 与 affinity guard 文件完全分离，可并发；T21 负责 FFI 接线。 |
| T21A、T21B | T21 | 集成闸门独占 handle/api/lib 与安全集成 fixture。 |
| T21 | T22A | native Window/Document contract 先冻结。 |
| T22A | T22B | facade 依赖 native 签名，不与 T22A 并发。 |
| T22A、T22B | T22 | 集成闸门独占根入口、类型和 registry。 |
| T22 | T23A | native node contract 先冻结；T23B 随后实现 facade。 |
| T23A | T23B | 避免 native/facade 方法名和返回值漂移。 |
| T23A、T23B | T23 | 集成闸门独占共享入口和兼容 ledger。 |
| T23 | T24A、T24B | append/insert 与 remove/replace 拥有不同 native 文件，可并发。 |
| T24A、T24B | T24C | facade mutation 等两个 native contract 都完成后再执行。 |
| T24A、T24B、T24C | T24 | 集成闸门独占共享 registry、入口和类型。 |
| T24 | T25A、T25D | Core payload seam 与 live childNodes 分域，可并发。 |
| T25A | T25B、T25C | 属性与 textContent Core 模块分文件，可并发。 |
| T25B、T25C、T25D | T25E | 跨层属性/text 接入等待 Core contract 和 collection contract。 |
| T25A、T25B、T25C、T25D、T25E | T25 | 集成闸门完成 M4，之后才释放 M5/M6/M7 候选。 |
| T25 | T26、T30、T37 | HTML、selector、event 逻辑分域；若共享入口或测试文件则拆分/串行。 |
| T26 | T27、T28 | fragment parser 与 serializer 逻辑分域；共享 `mod`、fixture 或构建文件时串行。 |
| T30 | T31 | 依赖独立；与同时修改 facade/type 的任务交叉时以实际路径为准。 |
| T33 | T34、T35 | 两个 TODO 都声明 `Core/绑定/facade/type`，默认串行；只有能证明 diff 不重叠时才并发。 |

T20A 的占位文件采用“先登记、后交接”：T20A 负责一次性创建 module declaration/最小占位，归档后才由表中指定的子任务接管实现文件。这样不会把同一文件同时分配给两个 worktree。T21A/T21B、T24A/T24B 和 T25B/T25C 的实现文件彼此独占；T22A→T22B、T23A→T23B、T24A/T24B→T24C、T25A→T25B/T25C→T25E 是契约冻结后的串行边。若实际 diff 触及未声明的共享路径，立即停止并重新拆分，不以“最终能 rebase”为并发依据。

### Worktree 与 agent

为每个任务生成唯一 agent 名称（`[a-z][a-z0-9_-]{0,31}`）和建议分支名 `herdr/todo-<序号>-<slug>`；名称已存在时生成新名称，不覆盖既有资源。创建 worktree 时从原分支最新提交开始并保持用户焦点不变：

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
运行与改动相关的校验。全部完成时更新本任务 todo 状态；不要修改 todos/README.md、父集成闸门、共享 registry 或兼容 ledger，归档和队列表更新由协调器在集成锁内完成。
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

## 父任务、状态、复核与集成

编号不带后缀的 T21、T22、T23、T24、T25 是集成闸门（aggregate/integration gate），不是可与子任务同时执行的重复实现。T20A 是一次性的结构 seam 任务，先独占并预登记共享模块；它归档后才把占位文件交给表中指定的子任务。只有某个闸门依赖的全部带后缀任务已归档并通过复核后，才启动该闸门；闸门统一拥有共享 registry、`handle.rs`/`lib.rs`/`api.rs`、根入口、类型、compat ledger 和既有跨层 fixture。子任务只写自己的独占模块和新测试，不修改 `todos/README.md`、闸门文件或共享入口。

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

T02 已建立统一校验命令；当前每个 TODO 都必须在条目专属命令之外运行：

```sh
npm run validate
git diff --check
```

`npm run validate` 依次覆盖 JavaScript 检查、Rust fmt/Clippy/测试、Bun 测试、类型兼容和兼容清单。涉及解析、选择器、WPT、原生产物、发布或基准的 TODO，还必须运行该文件列出的对应命令；局部 agent 的结果不能代替协调器的仓库级校验。仅在 T02 之前运行队列时，才按当时可用的子命令退化执行：`bun --check index.js`、`npm pack --dry-run` 和 `git diff --check`。

## 有序队列

| 顺序 | 优先级 | TODO 文件 | 里程碑 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 01 | P0 | [01-repository-workspace.md](done/01-repository-workspace.md) | M0 | 无 | 已完成 |
| 02 | P0 | [02-validation-and-ci.md](done/02-validation-and-ci.md) | M0 | T01 | 已完成 |
| 03 | P0 | [03-compatibility-baseline-adr.md](done/03-compatibility-baseline-adr.md) | M0/M1 | T01 | 已完成 |
| 04 | P0 | [04-native-binding-spike.md](done/04-native-binding-spike.md) | M0 | T01 | 已完成 |
| 05 | P0 | [05-parser-selector-string-adr.md](done/05-parser-selector-string-adr.md) | M0 | T01 | 已完成 |
| 06 | P0 | [06-native-build-adr.md](done/06-native-build-adr.md) | M0/M9 | T04 | 已完成 |
| 07 | P0 | [07-happy-dom-baseline-manifest.md](done/07-happy-dom-baseline-manifest.md) | M1 | T03 | 已完成 |
| 08 | P0 | [08-public-api-snapshot.md](done/08-public-api-snapshot.md) | M1 | T07 | 已完成 |
| 09 | P0 | [09-type-compatibility-harness.md](done/09-type-compatibility-harness.md) | M1 | T07 | 已完成 |
| 10 | P0 | [10-differential-runner.md](done/10-differential-runner.md) | M1 | T07 | 已完成 |
| 11 | P0 | [11-compatibility-ledger-and-provenance.md](done/11-compatibility-ledger-and-provenance.md) | M1 | T08, T09, T10 | 已完成 |
| 12 | P0 | [12-generational-arena.md](done/12-generational-arena.md) | M2 | T01 | 已完成 |
| 13 | P0 | [13-core-errors-and-node-model.md](done/13-core-errors-and-node-model.md) | M2 | T12 | 已完成 |
| 14 | P0 | [14-tree-relations.md](done/14-tree-relations.md) | M2 | T13 | 已完成 |
| 15 | P0 | [15-append-and-insert-mutations.md](done/15-append-and-insert-mutations.md) | M2 | T14 | 已完成 |
| 16 | P0 | [16-remove-and-replace-mutations.md](done/16-remove-and-replace-mutations.md) | M2 | T15 | 已完成 |
| 17 | P0 | [17-cross-document-operations.md](done/17-cross-document-operations.md) | M2 | T16 | 已完成 |
| 18 | P0 | [18-core-property-and-stress-tests.md](done/18-core-property-and-stress-tests.md) | M2 | T17 | 已完成 |
| 19 | P0 | [19-minimal-native-binding.md](done/19-minimal-native-binding.md) | M3 | T04, T17 | 已完成 |
| 20 | P0 | [20-wrapper-identity-and-gc.md](done/20-wrapper-identity-and-gc.md) | M3 | T19 | 已完成 |
| 20A | P0 | [20a-binding-extension-seam.md](done/20a-binding-extension-seam.md) | M3/M4 | T20 | 已完成 |
| 21A | P0 | [21a-error-taxonomy.md](done/21a-error-taxonomy.md) | M3 | T20A | 已完成 |
| 21B | P0 | [21b-affinity-guard.md](done/21b-affinity-guard.md) | M3 | T20A | 已完成 |
| 21 | P0 | [21-native-error-and-safety-boundary.md](done/21-native-error-and-safety-boundary.md) | M3 | T21A, T21B | 已完成 |
| 22A | P0 | [22a-native-window-document.md](done/22a-native-window-document.md) | M4 | T21 | 已完成 |
| 22B | P0 | [22b-window-document-facade.md](done/22b-window-document-facade.md) | M4 | T22A | 已完成 |
| 22 | P0 | [22-window-document-facade.md](done/22-window-document-facade.md) | M4 | T22A, T22B | 已完成 |
| 23A | P0 | [23a-core-node-contract.md](done/23a-core-node-contract.md) | M4 | T22 | 已完成 |
| 23B | P0 | [23b-facade-node-api.md](done/23b-facade-node-api.md) | M4 | T23A | 已完成 |
| 23 | P0 | [23-basic-node-creation-and-navigation.md](done/23-basic-node-creation-and-navigation.md) | M4 | T23A, T23B | 已完成 |
| 24A | P0 | [24a-native-append-insert.md](done/24a-native-append-insert.md) | M4 | T23 | 已完成 |
| 24B | P0 | [24b-native-remove-replace.md](done/24b-native-remove-replace.md) | M4 | T23 | 已完成 |
| 24C | P0 | [24c-facade-mutation.md](done/24c-facade-mutation.md) | M4 | T24A, T24B | 已完成 |
| 24 | P0 | [24-javascript-tree-mutations.md](done/24-javascript-tree-mutations.md) | M4 | T24A, T24B, T24C | 已完成 |
| 25A | P0 | [25a-core-payload-seam.md](done/25a-core-payload-seam.md) | M4 | T24, T20A | 已完成 |
| 25B | P0 | [25b-core-attributes.md](done/25b-core-attributes.md) | M4 | T25A | 已完成 |
| 25C | P0 | [25c-core-text-content.md](done/25c-core-text-content.md) | M4 | T25A | 已完成 |
| 25D | P0 | [25d-live-child-nodelist.md](done/25d-live-child-nodelist.md) | M4 | T24, T23 | 已完成 |
| 25E | P0 | [25e-binding-attributes-text.md](done/25e-binding-attributes-text.md) | M4 | T23, T24, T25A, T25B, T25C, T25D | 已完成 |
| 25 | P0 | [25-attributes-text-and-nodelist.md](done/25-attributes-text-and-nodelist.md) | M4 | T25A, T25B, T25C, T25D, T25E | 已完成 |
| 26 | P1 | [26-html-document-parser.md](done/26-html-document-parser.md) | M5 | T05, T17, T25 | 已完成 |
| 27 | P1 | [27-html-fragment-parser.md](done/27-html-fragment-parser.md) | M5 | T26 | 已完成 |
| 28 | P1 | [28-html-serializer.md](done/28-html-serializer.md) | M5 | T26 | 已完成 |
| 29 | P1 | [29-inner-outer-html-api.md](done/29-inner-outer-html-api.md) | M5 | T27, T28 | 已完成 |
| 30 | P1 | [30-selector-parser-and-matcher.md](done/30-selector-parser-and-matcher.md) | M6 | T05, T17, T25 | 已完成 |
| 31 | P1 | [31-query-apis.md](done/31-query-apis.md) | M6 | T30 | 已完成 |
| 32 | P1 | [32-live-query-collections.md](done/32-live-query-collections.md) | M6 | T31 | 已完成 |
| 33 | P1 | [33-extended-node-types.md](done/33-extended-node-types.md) | M7 | T17, T25, T29 | 已完成 |
| 34 | P1 | [34-attributes-and-domtokenlist.md](done/34-attributes-and-domtokenlist.md) | M7 | T25, T33 | 已完成 |
| 35 | P1 | [35-treewalker-and-nodeiterator.md](done/35-treewalker-and-nodeiterator.md) | M7 | T25, T33 | 已完成 |
| 36 | P1 | [36-range-and-selection.md](done/36-range-and-selection.md) | M7 | T33, T35 | 已完成 |
| 37 | P1 | [37-event-target-and-propagation.md](done/37-event-target-and-propagation.md) | M7 | T25 | 已完成 |
| 38 | P1 | [38-event-classes.md](done/38-event-classes.md) | M7 | T37 | 已完成 |
| 39 | P1 | [39-html-element-base.md](done/39-html-element-base.md) | M7 | T29, T34, T37 | 已完成 |
| 40 | P1 | [40-template-and-forms.md](done/40-template-and-forms.md) | M7 | T27, T34, T39 | 已完成 |
| 41 | P2 | [41-mutation-observer.md](done/41-mutation-observer.md) | M7 | T24, T34, T37 | 已完成 |
| 42 | P2 | [42-custom-elements.md](42-custom-elements.md) | M8 | T37, T39, T40, T41 | 待办 |
| 43 | P2 | [43-shadow-dom.md](43-shadow-dom.md) | M8 | T31, T37, T42 | 待办 |
| 44 | P2 | [44-cssom.md](44-cssom.md) | M8 | T34, T39, T43 | 待办 |
| 45 | P2 | [45-window-platform-and-storage.md](done/45-window-platform-and-storage.md) | M8 | T22, T37 | 已完成 |
| 46 | P2 | [46-fetch-and-network-surface.md](done/46-fetch-and-network-surface.md) | M8 | T38, T45 | 已完成 |
| 47 | P2 | [47-timers-and-script-execution.md](47-timers-and-script-execution.md) | M8 | T37, T41, T42, T46 | 待办 |
| 48 | P2 | [48-compatibility-closure-and-wpt.md](48-compatibility-closure-and-wpt.md) | M8/M9 | T11, T25, T29, T32, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44, T45, T46, T47 | 待办 |
| 49 | P2 | [49-native-packaging-and-artifacts.md](49-native-packaging-and-artifacts.md) | M9 | T06, T21, T48 | 待办 |
| 50 | P2 | [50-hardening-and-stable-release.md](50-hardening-and-stable-release.md) | M9 | T18, T20, T21, T48, T49 | 待办 |

## 优先级含义

- `P0`：落实三层架构、兼容测试骨架和首个基础 DOM 垂直切片。
- `P1`：完成解析、序列化、选择器和 alpha 阶段基础 DOM 扩展。
- `P2`：完成 happy-dom 高阶能力、兼容收口、原生发布与 stable 门禁。
