# MAD DOM TODO 队列

本目录把 [ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md) 拆成适合 `finish-todo` 顺序执行的小型工作单元。每个编号文件对应一个独立 commit；完成前必须经过独立实现、对抗式复核、仓库级校验和归档。

## 执行规则

- 严格按下表顺序执行，优先级为 `P0 → P1 → P2`；同优先级按编号升序。
- 一次只处理一个 TODO 文件。文件内只有一个稳定条目 ID，完成后整体移动到 `todos/done/`。
- “依赖”列中的条目必须已完成；若未完成，当前条目标记为 `blocked-on:<id>`，不得越级搭建后续基础设施。
- 条目的“预期改动”是文件所有权提示，不授权顺手重构、升级依赖或修改无关文件。
- 每个条目均需同时满足验收条件、条目专属校验和仓库级校验；不得用删除测试、扩大 normalizer 或静默 no-op 宣称完成。
- 执行中的 roadmap 能力若从锁定基线发现范围仍大于一个原子 commit，应先拆出更小 TODO、更新本表并暂停当前条目。
- 完成文件后，`finish-todo` 应将本表链接改为 `done/<filename>`，状态改为“已完成”；部分完成则保留原路径并标为“部分完成”。

## 仓库级校验约定

开始 T01 前可用的固定基础校验：

- `bun --check index.js`
- `npm pack --dry-run`
- `git diff --check`

T02 将建立统一校验命令 `npm run validate`（依次覆盖 JavaScript 检查、Rust fmt/Clippy/测试和 Bun 测试）。自 T02 完成后，每个 TODO 除上述基础校验和文件内专属命令外，还必须运行 `npm run validate`。涉及 Rust、Bun 集成、类型、兼容、WPT、原生产物或基准的条目，必须运行文件中列出的对应命令；局部 agent 的结果不能代替主代理仓库级校验。

各 TODO 的“统一仓库校验”均指 `npm run validate`；在 T02 完成前，按条目依赖运行其中已经可用的子命令。

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
| 11 | P0 | [11-compatibility-ledger-and-provenance.md](11-compatibility-ledger-and-provenance.md) | M1 | T08, T09, T10 | 待办 |
| 12 | P0 | [12-generational-arena.md](12-generational-arena.md) | M2 | T01 | 待办 |
| 13 | P0 | [13-core-errors-and-node-model.md](13-core-errors-and-node-model.md) | M2 | T12 | 待办 |
| 14 | P0 | [14-tree-relations.md](14-tree-relations.md) | M2 | T13 | 待办 |
| 15 | P0 | [15-append-and-insert-mutations.md](15-append-and-insert-mutations.md) | M2 | T14 | 待办 |
| 16 | P0 | [16-remove-and-replace-mutations.md](16-remove-and-replace-mutations.md) | M2 | T15 | 待办 |
| 17 | P0 | [17-cross-document-operations.md](17-cross-document-operations.md) | M2 | T16 | 待办 |
| 18 | P0 | [18-core-property-and-stress-tests.md](18-core-property-and-stress-tests.md) | M2 | T17 | 待办 |
| 19 | P0 | [19-minimal-native-binding.md](19-minimal-native-binding.md) | M3 | T04, T17 | 待办 |
| 20 | P0 | [20-wrapper-identity-and-gc.md](20-wrapper-identity-and-gc.md) | M3 | T19 | 待办 |
| 21 | P0 | [21-native-error-and-safety-boundary.md](21-native-error-and-safety-boundary.md) | M3 | T19, T20 | 待办 |
| 22 | P0 | [22-window-document-facade.md](22-window-document-facade.md) | M4 | T19, T20, T21 | 待办 |
| 23 | P0 | [23-basic-node-creation-and-navigation.md](23-basic-node-creation-and-navigation.md) | M4 | T22 | 待办 |
| 24 | P0 | [24-javascript-tree-mutations.md](24-javascript-tree-mutations.md) | M4 | T23 | 待办 |
| 25 | P0 | [25-attributes-text-and-nodelist.md](25-attributes-text-and-nodelist.md) | M4 | T24 | 待办 |
| 26 | P1 | [26-html-document-parser.md](26-html-document-parser.md) | M5 | T05, T17, T25 | 待办 |
| 27 | P1 | [27-html-fragment-parser.md](27-html-fragment-parser.md) | M5 | T26 | 待办 |
| 28 | P1 | [28-html-serializer.md](28-html-serializer.md) | M5 | T26 | 待办 |
| 29 | P1 | [29-inner-outer-html-api.md](29-inner-outer-html-api.md) | M5 | T27, T28 | 待办 |
| 30 | P1 | [30-selector-parser-and-matcher.md](30-selector-parser-and-matcher.md) | M6 | T05, T17, T25 | 待办 |
| 31 | P1 | [31-query-apis.md](31-query-apis.md) | M6 | T30 | 待办 |
| 32 | P1 | [32-live-query-collections.md](32-live-query-collections.md) | M6 | T31 | 待办 |
| 33 | P1 | [33-extended-node-types.md](33-extended-node-types.md) | M7 | T17, T25, T29 | 待办 |
| 34 | P1 | [34-attributes-and-domtokenlist.md](34-attributes-and-domtokenlist.md) | M7 | T25, T33 | 待办 |
| 35 | P1 | [35-treewalker-and-nodeiterator.md](35-treewalker-and-nodeiterator.md) | M7 | T25, T33 | 待办 |
| 36 | P1 | [36-range-and-selection.md](36-range-and-selection.md) | M7 | T33, T35 | 待办 |
| 37 | P1 | [37-event-target-and-propagation.md](37-event-target-and-propagation.md) | M7 | T25 | 待办 |
| 38 | P1 | [38-event-classes.md](38-event-classes.md) | M7 | T37 | 待办 |
| 39 | P1 | [39-html-element-base.md](39-html-element-base.md) | M7 | T29, T34, T37 | 待办 |
| 40 | P1 | [40-template-and-forms.md](40-template-and-forms.md) | M7 | T27, T34, T39 | 待办 |
| 41 | P2 | [41-mutation-observer.md](41-mutation-observer.md) | M7 | T24, T34, T37 | 待办 |
| 42 | P2 | [42-custom-elements.md](42-custom-elements.md) | M8 | T37, T39, T40, T41 | 待办 |
| 43 | P2 | [43-shadow-dom.md](43-shadow-dom.md) | M8 | T31, T37, T42 | 待办 |
| 44 | P2 | [44-cssom.md](44-cssom.md) | M8 | T34, T39, T43 | 待办 |
| 45 | P2 | [45-window-platform-and-storage.md](45-window-platform-and-storage.md) | M8 | T22, T37 | 待办 |
| 46 | P2 | [46-fetch-and-network-surface.md](46-fetch-and-network-surface.md) | M8 | T38, T45 | 待办 |
| 47 | P2 | [47-timers-and-script-execution.md](47-timers-and-script-execution.md) | M8 | T37, T41, T42, T46 | 待办 |
| 48 | P2 | [48-compatibility-closure-and-wpt.md](48-compatibility-closure-and-wpt.md) | M8/M9 | T11, T25, T29, T32, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44, T45, T46, T47 | 待办 |
| 49 | P2 | [49-native-packaging-and-artifacts.md](49-native-packaging-and-artifacts.md) | M9 | T06, T21, T48 | 待办 |
| 50 | P2 | [50-hardening-and-stable-release.md](50-hardening-and-stable-release.md) | M9 | T18, T20, T21, T48, T49 | 待办 |

## 优先级含义

- `P0`：落实三层架构、兼容测试骨架和首个基础 DOM 垂直切片。
- `P1`：完成解析、序列化、选择器和 alpha 阶段基础 DOM 扩展。
- `P2`：完成 happy-dom 高阶能力、兼容收口、原生发布与 stable 门禁。
