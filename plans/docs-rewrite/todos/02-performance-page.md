difficulty: easy

# 02 · 新建 docs/performance.md（速度页）

## T1 · 编写 performance 页

要做什么：

- 新建 `docs/performance.md`，全英文，用户向。
- 内容（数字只能用下列事实基准，禁止编造或外推）：
  1. 主表格：同一套 vendored happy-dom integration suite，只改 import，
     在 `bun test` 下跑两边（median of 3 runs，macOS arm64，Bun 1.4.0，
     deterministic DOM workload）：mad-dom **128 ms** vs happy-dom 20.11.11
     **206 ms** = **1.6× faster**；
  2. 方法一句话：测试是 happy-dom 自家 integration-test suite 原样 vendored，
     唯一改动是 import specifier（细节可链
     `https://github.com/zhy0216/mad-dom/blob/main/benchmark/README.md`）；
  3. 复现：`bun benchmark/run.mjs`；
  4. "Why it's fast" 一段话封顶：DOM 不在 JS 对象里，而在 Rust memory arena
     —— native HTML parser、native selector matching，经 thin Node-API binding
     到达 JS。不展开 arena/生命周期等实现细节，不引用 ADR；
  5. 末尾一小节（两三句）：仓库内部有性能/内存回归门禁
     （`bench/baseline.json`，`bun run bench:check`），只说存在，不展开。

预计修改文件：`docs/performance.md`（新建）。

验收条件：

- `bun run docs:build` 成功，无死链；
- 页面内无 "ADR" 字样；数字与 plan.md 事实基准逐条一致。

前置依赖：无。
