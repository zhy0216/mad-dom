difficulty: hard
agent: inherit
status: done

# 03 · JS FFI adapter 分配与 facade 路径优化

## T1 · 有界复用，保留独立拥有的返回值

前置依赖：`01-balanced-baseline.md`。

基于 01 profile 优先优化 `native-loader.js` 中的 `ffiBytes`、`outputWords`、
`outputBytes` 和标量/context 准备成本，再处理 facade 中的 TextDecoder 调用。
保持原有 adapter 方法 ABI/返回协议。允许复用 encoder/decoder、length scratch、
有界 capacity hints；仅在实测需要时设计同步消费内部 scratch 的 helper。

预计修改文件：`js/native-loader.js`、`js/facade/window.js`、
`js/facade/extensions/html.js`、`node.js`、`query.js`、`child-nodelist.js`、
`snapshot-node.js`（按实际需要）；新内部 helper 仅限 `js/` 的相关模块。

原有 adapter 数组必须能在后续调用、document destroy、transfer、GC 后继续读取。
不能把复用 buffer 的 subarray 直接交给原有 caller；StaticNodeList、创建池和
跨调用持有的 snapshot 不允许保存借用的 scratch。私有同步消费 helper 如被采用，
须严格限制 lease scope，try/finally 释放，重入使用独立存储；不要使小结果长期
保留曾出现过的最大 buffer，也不要通过缓存强引用 document。

验收条件：

- 内存预算、容量增长/回落、异常后的复用策略明确且有边界；重复多文档操作不会
  无界积累容量或保持已销毁文档。
- 保留真实 intrinsic TypedArray length、shared/resizable/detached 输入拒绝、
  u32 无副作用校验、UTF-8/非 ASCII/空值语义；不能为速度移除协议检查。
- 只读溢出/协议异常继续安全 fallback；真正的 native 错误保持原 taxonomy。
- `createElements` 仍 exact-capacity/single-shot；坏 success 长度抛错，不能
  在可能已变更 DOM 后再用 Node-API 创建第二批节点。

## T2 · 完整公开操作的路径选择

前置依赖：`01-balanced-baseline.md`；本文件 T1。

预计修改文件：同 T1，必要时 `js/runtime-metadata.js`，以及本计划 `evidence/task-03/`。

分别复测序列化、作用域查询/遍历与创建池：包括输入编码、输出复制/解码、wrapper
hydrate 和最终公开返回。比较 FFI createElements token 数组与已有 Node-API
`createElementTokenRange`，不能只比较旧 Node-API 数组路径就断言 FFI 更快。

根据证据保留有价值的 FFI 路径，必要时对单个操作选择已有 Node-API/range。
策略应有限、静态且可解释；大小策略必须来自公开语义或可信元数据，不为了决策
先执行一次昂贵完整操作。不做每次调用的自适应计时或 Bun 版本白名单。
能力检测与操作实际选择分开报告，保留 forced-disabled、partial symbol 和
oversized 输出回退；不能把可用能力误报为缺失来隐瞒选择。

验收条件：

- 冻结 reference/candidate 对照包含完整 facade 时间、内存、actual path 和指纹。
- 目标为重点 facade ≥10% 稳定收益或已确认退化被消除；不将 raw-only 收益作为完成
  依据。没有证据的复杂分支撤回；模式/版本的相反结果均保留。
- 全部 Core/Testing workload 保持正确；document-root implied skeleton、query
  失效、wrapper identity、live collections、observer/custom-element 行为不变。
- 只依赖旧 ABI v1，02 尚未合入时也能工作。不改 Rust 文件、ABI、平台或 release 元数据。

## T3 · 行为和内存回归验证

前置依赖：本文件 T1、T2。

预计修改文件：`tests/bun/ffi-memory.test.js`、`native-loader.test.js`、
`fixtures/ffi-output-faults.mjs`、`ffi-memory-digest.mjs`、`ffi-call-trace.mjs`、
`ffi-facade-workload.mjs`，及实际受影响的现有 facade 专项测试。
需要新 test/fixture 时放在 `tests/bun/` 对应模块，不修改 02 所有的 `ffi-fast-path.test.js`。

验收条件：

- retained arrays 在多次大小交替调用、transfer、GC、destroy 后内容未被覆盖；
  真正跨文档/Worker/reentrant/异常路径不会串数据；新的私有借用边界有针对性覆盖。
- malformed output、empty/large/oversize 结果、创建 0..4096、旧 binding、缺符号、
  FFI disabled 的既有测试全部通过，路径变化时更新 trace oracle 但不能削弱行为断言。
- 在本 worktree 构建并设置两个 native override 后，baseline/latest 均通过：

```sh
bun test tests/bun/native-loader.test.js tests/bun/ffi-memory.test.js
bun test tests/bun/lazy-token-fast-path.test.js tests/bun/navigation-memo.test.js tests/bun/query-api.test.js
bun test tests/bun/html-api.test.js tests/bun/nodelist-live.test.js
bun run bench:bun-native:selftest
bun run validate
```

记录完整命令结果到 `evidence/task-03/`；原生命周期计数及 RSS 限制保持不变。
