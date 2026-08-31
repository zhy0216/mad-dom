# 02 机械重写管线：src 路径与 vitest → bun:test

- 状态：待办
- 优先级：P0
- 里程碑：基建
- 条目 ID：`T02`
- 依赖：T01
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

把 vendored 测试机械重写为 bun 可运行的形式：`src/…` 内部路径 → shim 路径、`vitest` → `bun:test` + 适配层、vi API 等价替换、局部 helper 递归重写。重写必须**保真**——只改 import 与 API 表面，不触碰任何断言、行为或结构；产物可重复生成，并输出无法自动映射的文件清单（供 T05 及波次 triage 使用）。

## 条目

- [ ] **T02 — 机械重写脚本与产物**
  - 实现：
    - 脚本 `scripts/rewrite-happy-dom-tests.mjs`，输入 `tests/happy-dom/vendor/` 与 `vendor-scan.json`，输出 `tests/happy-dom/rewritten/`（镜像目录结构）：
      - `src/` 路径：可映射者改写为 T01 冻结的 `shimPath` 相对路径（保留 default/named/namespace 形式）；不可映射者**保留原路径不动**（这样文件必然无法运行，由 triage 门禁兜底拦截），并记入 report；
      - `import { … } from 'vitest'` → `from 'bun:test'`，`vi` 从适配层导入（`tests/happy-dom/adapter/`）；`vi.fn`→`mock`、`vi.spyOn`→`spyOn`、`vi.clearAllMocks`→`clearAllMocks`、`vi.restoreAllMocks`→适配层 `restoreAllMocks`、`vi.mock` 调用点登记到 adapter-gap 清单（setup 类文件由 T03 手工移植，重写器跳过并标记）；
      - `import type` 原样保留（bun 原生跑 TS）；`.js` 后缀保留（bun 会解析到同名 `.ts` shim）；
      - 局部 helper（`CustomElement.js` 等 vendor 内相对导入）与 `.test.ts` 同规则递归重写；
      - 每个输出文件头部插入 provenance 注释（上游路径 @ commit、MIT、由脚本生成、勿手改）；
      - 输出 `tests/happy-dom/rewrite-report.json`：`{generatedBy, files[], unmappedImports[], adapterGaps[], skippedFiles[]}`，unmappedImports 按原因分类（`internal-only-module` / `propertysymbol` / `named-from-index` / 其他）。
    - 幂等：重跑覆盖产物，`git diff` 无残留差异（provenance 注释用固定格式，不含时间戳或随机值）。
  - 验收：
    - 重写后产物中不存在 `from 'vitest'`、不存在裸 `vi.` 调用（适配层导入除外）；
    - 所有可映射文件的 import 均指向 shim 路径且路径真实存在（T04 完成后可校验）；
    - `rewrite-report.json` 的 unmappedImports 与 vendor-scan 中「不可映射」分类交叉一致；
    - 幂等性：连续两次运行产物完全一致；
    - 抽查 ≥ 5 个不同子系统的重写文件，diff 仅限 import 行与文件头注释（无断言/结构变化）；
    - 重写器自测（`tests/happy-dom/rewrite-selftest/`，用固定样例输入验证各规则分支，不依赖 vendor 全量）。

## 预期改动

- `scripts/rewrite-happy-dom-tests.mjs`
- `tests/happy-dom/rewritten/**`（生成物，提交）
- `tests/happy-dom/rewrite-report.json`
- `tests/happy-dom/rewrite-selftest/**`
- `package.json`（新增 `compat:hdunit:rewrite` 脚本）

## 专属校验

- `bun scripts/rewrite-happy-dom-tests.mjs` 幂等重跑 + `git diff` 干净
- rewrite 自测：`bun test tests/happy-dom/rewrite-selftest`
- report 与 vendor-scan 交叉核对脚本

## 边界

- 不做语义适配：`new Window({settings})` 等构造签名适配归 T04 shim；setup/mockModule 机制归 T03。
- 不删减、不跳过任何测试断言；重写只解决「能否解析与运行」的机械问题，不解决「行为是否正确」（归波次）。
- 不改 `compat/` 下任何文件；不安装新依赖。
- 不实际运行 rewritten 测试（运行面归 T03/T05 与波次）。
