# 07 hdunit 波次：event / dom / window / browser

- 状态：待办
- 优先级：P1
- 里程碑：波次
- 条目 ID：`T07`
- 依赖：T05
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

启用 `rewritten/` 下 event、dom、window、browser 四个子系统的 vendored 测试（约 30 个文件：event 9、dom 8、window 4、browser 9），逐文件跑绿或诚实 triage。其中 event 8/9、browser 2/9 属于全部 import 可映射的 clean 文件，优先启用；其余依赖内部模块的文件视情况 skip/expected-fail。

## 条目

- [ ] **T07 — event/dom/window/browser 波次**
  - 实现：
    - 按 T06 同样的闭环：置 enabled → 跑 → 通过保持；失败 → 修 facade/core（带测试佐证）或 triage expected-fail/skip + reason；
    - 特别注意：
      - event 子系统的 `Event`/`EventTarget` 构造与传播语义（mad-dom 已有实现，差异多半是小语义，可修）；
      - browser 子系统 9 个文件多数依赖 `Browser` 内部（DefaultBrowserSettings、BrowserFrameFactory 等），预期大部分 skip/expected-fail；其中 2 个 clean 文件（如依赖公开 API 的）优先跑绿；
      - window 子系统 4 个文件含 `new Window({settings})` 与 CrossOriginBrowserWindow（内部），clean 文件优先；
    - 维护 `tests/happy-dom/triage/{event,dom,window,browser}.json` 与 ledger 对应子系统汇总条目；状态变化后跑 `compat:hdunit:validate` 保持门禁绿。
  - 验收：
    - 四个分片门禁绿：enabled 全实跑通过，expected-fail/skip 全带 reason 且与实测一致；
    - event/dom 两个子系统合计至少 12 个文件终态为 enabled；
    - 每处 facade/core 修复有测试佐证；不改 rewritten 断言；
    - `npm run validate` 全绿；report 输出四个子系统的状态计数。
  - 阻塞/回退：同 T06（基建缺陷报告协调器，不擅自改产出规则）。

## 预期改动

- `tests/happy-dom/triage/{event,dom,window,browser}.json`
- `compat/ledger.json`、`compat/upstream-map.json`
- `js/facade/**`、`crates/mad-dom-core/**`、binding 面及配套测试

## 专属校验

- `bun test tests/happy-dom/rewritten/{event,dom,window,browser}`
- `npm run compat:hdunit:validate`

## 边界

- 不碰 nodes（T06）、css/fetch（T09）、轻量子系统（T08）与内部耦合 triage（T10）的分片与目录。
- known-gap 诚实记录；不手改 rewritten/vendor 文件。
