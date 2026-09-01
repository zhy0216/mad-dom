# 08 hdunit 波次：轻量子系统

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T08`
- 依赖：T05
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

启用 animation、canvas、file、console、screen、tree-walker、clipboard、dom-implementation、dom-parser、form-data、html-serializer、intersection-observer、mutation-observer、storage、url、validity-state 等轻量子系统（约 26 个文件）的 vendored 测试。这些子系统文件少、多数 clean（animation 4/4、file 3/3、console 2/2、screen 2/2、tree-walker 2/2、clipboard、dom-implementation、dom-parser、form-data、html-serializer、intersection-observer、mutation-observer、storage、url、validity-state 各 1，多为可映射），适合一次扫完。

## 条目

- [ ] **T08 — 轻量子系统波次**
  - 实现：
    - 与 T06 相同的闭环：置 enabled → 跑 → 通过保持；失败 → 修 facade/core（带测试佐证）或 expected-fail/skip + reason；
    - 由于每个子系统文件很少，本任务允许把全部轻量子系统的 triage 集中到**各自分片文件**（每子系统一个 JSON），与 T07/T09/T10 分片不重叠；ledger 按子系统各一条汇总条目；
    - 优先扫 clean 文件；canvas 2/3、window 之外其余内部耦合文件如实 triage；
    - 状态变化后跑 `compat:hdunit:validate` 保持门禁绿。
  - 验收：
    - 所有轻量子系统分片门禁绿；enabled 全部实跑通过；
    - 轻量子系统合计至少 16 个文件终态为 enabled（clean 文件基本全绿 + 部分修复）；
    - 每处 facade/core 修复有测试佐证；不改 rewritten 断言；
    - `npm run validate` 全绿；report 输出各轻量子系统计数。
  - 阻塞/回退：同 T06。

## 预期改动

- `tests/happy-dom/triage/<轻量子系统>.json`
- `compat/ledger.json`、`compat/upstream-map.json`
- `js/facade/**`、`crates/mad-dom-core/**`、binding 面及配套测试

## 专属校验

- `bun test tests/happy-dom/rewritten/{animation,canvas,file,console,screen,tree-walker,clipboard,dom-implementation,dom-parser,form-data,html-serializer,intersection-observer,mutation-observer,storage,url,validity-state}`
- `npm run compat:hdunit:validate`

## 边界

- 不碰 nodes（T06）、event/dom/window/browser（T07）、css/fetch（T09）、内部耦合 triage（T10）的分片与目录。
- animation 子系统涉及 `Element.animate`（上游最新功能），mad-dom 尚无动画实现时如实 expected-fail/skip，不伪造通过。
- known-gap 诚实记录；不手改 rewritten/vendor 文件。
