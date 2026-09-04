difficulty: easy

# 07 · README dom-bench 节重写（cold/warm 语义 + 统计口径 + 热点结论）

## 目标

让 benchmark/README.md 与重构后的 dom-bench 一致，消除"每轮 wrapper 全部失效重新铸造"的
失真描述。对应 plan.md 拆解 T7。只改 `benchmark/README.md`。

## 要做什么

- 重写"DOM-intensive benchmark (dom-bench)"一节：
  - 用法更新：`--runs`、`--sizes 0.1,1,10`、`--json`；说明 CLI 校验行为（非法参数 exit 2）。
  - 相位表全量更新（parse / buildMixed / buildCreate / buildAttr / buildAppend / buildText /
    buildBulk / queryHot / queryCold / getById / getByTag / serialize / traverseWarm /
    traverseCold / readHeavy / mutationChurn），每相位一行说明负载与计时窗口。
- "方法学要点"更新：
  - 跨引擎有效性：checks（命中数、build 树计数、序列化内容哈希、遍历计数）逐项相等才 valid；
  - 统计口径：每轮 pipeline total 的中位数；min/p90/MAD；MAD>20% median 打 UNSTABLE；
  - **cold/warm 定义**：warm = 共享文档上 wrapper 已被 `DOC_STATES.pinned` 驻留、导航 memo
    命中（树不变时遍历零 FFI，见 window.js:106 与 ADR/导航 memo 注释）；cold = 全新解析文档
    首次遍历/首查，wrapper 现铸、memo 未命中。明确写出：**pinned 驻留是设计特性不是测量噪声**，
    速度收益应与 RSS 增量一起读。
- 修正"### traverse 阶段剖析"小节：
  - 删除/改写"bench 每轮计量前强制 gc+排空，弱缓存里的 wrapper 全部失效，18,102 个节点每轮
    重新铸造"（该段描述的是 memo 落地前的旧现实；现 worker 的 traverse-warm 恰恰测驻留态）。
    保留历史叙述但明确标注"2026-09-04 之前"，并补一段"现行测量：traverse-warm 测驻留+memo，
    traverse-cold 测铸造路径"。
  - 更新结论行：build 族（buildMixed ~80% 总耗时）与 cold 路径铸造成本是引擎下一热点，
    getByTag 双原生查询（live-collections.js:272 急切校验 + length 再查）为已知计量事实——
    作为引擎侧后续优化输入（roadmap，不在本 plan 实施）。
- 文件其余部分（integration benchmark、hdunit 关系、gaps）不动。

## 预计修改的文件

- `benchmark/README.md`

## 验收条件

- README 中不存在与当前 worker 实现矛盾的表述（自查："全部失效/重新铸造"不得再作为
  现行行为描述出现）。
- 相位表与 `bun benchmark/dom-bench/run.mjs --json` 实际输出的 phase 键一一对应（跑一次核对）。
- `git diff` 仅 benchmark/README.md。

## 前置依赖

依赖 06-sizes-rss（文档必须描述最终形态，队列严格串行收尾）。
