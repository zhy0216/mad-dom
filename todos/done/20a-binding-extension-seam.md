# 20A 冻结跨层扩展 seam 与文件所有权

- 状态：待办
- 优先级：P0
- 里程碑：M3/M4
- 条目 ID：T20A
- 依赖：T20
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

在 wrapper identity 和 GC 生命周期完成后，先冻结原生绑定与 JavaScript facade 的扩展接口，消除后续并发任务对单体入口文件的争用。本条目只做结构性拆分，不增加公开 DOM 行为。

## 条目

- [ ] **T20A — 冻结跨层扩展 seam 与文件所有权**
  - 实现：
    - 从现有绑定中抽出稳定的内部上下文：文档访问、NodeId 校验、wrapper 唯一工厂、生命周期错误出口和 affinity/error hook。
    - 建立原生扩展 registry，并登记后续模块边界：window_document、node_api、mutation_insert_api、mutation_remove_api、attributes_api、text_api、collection_api、affinity。
    - 预留 js/facade 的 Window/Document 基础模块和 node、mutation、attributes、text、child-nodelist 扩展目录；约定 install、导出和 wrapper 转换入口。
    - 对需要 Rust module registration 的扩展提交空或最小占位模块，避免后续任务为了编译而修改共享 registry；占位文件的后续实现 owner 由队列表注明，必须在 T20A 归档后交接，不是并发共享写入。
    - 记录每个路径的唯一 owner、允许依赖方向和集成闸门；保留 T19/T20 的行为与现有公开入口。
  - 验收：
    - 结构性变更通过现有 workspace 测试，且没有新的公开 API 或第二份 DOM 状态。
    - 后续子任务可以只修改自己的模块文件和专属测试；registry、根入口和类型文件有明确的集成 owner。
    - 文档列出的 seam 能表达 document context、wrapper factory、错误/affinity hook 和 Core delegation，不要求子任务猜测私有字段。

## 预期改动

- crates/mad-dom-bun/src/handle.rs
- crates/mad-dom-bun/src/lib.rs
- crates/mad-dom-bun/src/api.rs
- crates/mad-dom-bun/src/extensions/
- crates/mad-dom-bun/src/affinity.rs（仅创建 module declaration/最小占位；T21B 在 T20A 归档后接管实现）
- js/facade/（目录和扩展契约）
- 本条目专属结构/所有权测试

## 专属校验

- cargo fmt --all -- --check
- cargo test --workspace
- npm run validate
- git diff --check

## 并发边界

T20A 是 T21A/T21B 以及 M4 子任务的结构性前置，必须单独完成并归档后才释放并发窗口。它不得实现错误分类、affinity 语义、Window 行为或任何新的 Node、mutation、attribute API。T20A 对共享 registry、module declaration 和占位文件拥有一次性写入权；归档后，T21B、T22A/B、T23A/B、T24A/B/C、T25B/C/D/E 才分别接管自己的实现文件。
