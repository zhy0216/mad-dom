# 03 bun:test 适配层与上游 setup 移植

- 状态：待办
- 优先级：P0
- 里程碑：基建
- 条目 ID：`T03`
- 依赖：T01
- 来源：本队列 README（hdunit：happy-dom 单测套件移植）

## 目标

提供 rewritten 测试运行时所需的适配层：`vi` 兼容面（含 `restoreAllMocks`）、上游 `test/setup.ts` 的 `mockModule`/`resetMockedModules` 全局机制、`child_process`/`http`/`https` 的模块 mock，以及 TZ 设置，全部用 bun 原生能力实现；并落地 `bun test` 运行入口。

## 条目

- [ ] **T03 — bun 适配层与运行入口**
  - 实现：
    - `tests/happy-dom/adapter/index.ts`：
      - `vi` 兼容对象：`fn`→`bun:test` 的 `mock`、`spyOn`→`bun:test` 的 `spyOn`（包装并登记进注册表）、`clearAllMocks`→`mock.clearAllMocks`、`restoreAllMocks`（遍历注册表调用各 mock 的 `restore()`，并清空注册表）、`mock`（占位：调用即抛出带指引的错误，提示该场景需 T03 手工处理或登记 adapter-gap）；
      - 已验证 bun 1.4.0 的 mock 函数对象具备 `mockImplementation`/`mockReturnValue`/`mockResolvedValue`/`mockRejectedValue`/`mockClear`/`mockReset`/`mockRestore`，与 vi.fn 对齐；
    - `tests/happy-dom/adapter/setup.ts`（移植上游 `test/setup.ts`，改造为 bun 语义）：
      - 全局 `mockModule`/`resetMockedModules`：预先真实 import `child_process`/`http`/`https` 生成可变副本，再用 `bun:test` 的 `mock.module` 拦截为副本引用（上游 `vi.mock` 的 `importOriginal` 懒加载语义在 bun 下不可用，改为 setup 预加载副本）；
      - `beforeAll` 设置 `process.env.TZ = 'Etc/GMT-2'`；
    - `tests/happy-dom/adapter/preload.ts`：注入全局（挂 `globalThis.vi`、`mockModule`、`resetMockedModules` 与 restoreAllMocks），供 `bun test --preload` 使用；
    - 运行入口：`bunfig.toml` 或脚本 `compat:hdunit:test`：`bun test tests/happy-dom/rewritten --preload tests/happy-dom/adapter/preload.ts`；对齐上游 `testTimeout: 500`（bun `--timeout 500`；如与慢用例冲突，放大超时并在 README 记录偏差原因）。
  - 验收：
    - 适配层自测（`tests/happy-dom/adapter/*.test.ts`，不依赖 vendored 测试）覆盖：spyOn 注册与 restoreAllMocks 恢复、mockImplementation 系列等价行为、mock.module 拦截 node 模块、mockModule/resetMockedModules 工作流（模拟上游 usage 模式）；
    - 用 1 个手写样例测试文件（走 rewritten 目录、用 preload 运行）证明：`import { vi } from '<adapter>'` 语法可用、setup 机制生效；
    - adapter-gap 清单（`tests/happy-dom/adapter-gaps.json`）记录 T02 report 中 `vi.mock` 调用点的处理结果：每个调用点要么已由 setup 覆盖、要么登记为 gap + 原因（供 T05 triage 引用）；
    - `bun --check` 通过；adapter 不在 `npm run check` 的检查范围之外引入类型问题。

## 预期改动

- `tests/happy-dom/adapter/**`（index.ts、setup.ts、preload.ts、自测）
- `tests/happy-dom/adapter-gaps.json`
- `bunfig.toml`（如需）与 `package.json`（`compat:hdunit:test` 脚本）

## 专属校验

- `bun test tests/happy-dom/adapter`
- `bun run compat:hdunit:test`（在 T02 产物存在时可运行；产物为空或缺失时给出可读报错）
- 上游 setup 行为对照：mockModule/resetMockedModules 语义与上游 `test/setup.ts` 一致（对照阅读，写进自测）

## 边界

- 不运行/不修复 vendored 测试本体（归 T05 与波次）；适配层只为运行环境服务。
- 不改 `compat/`；不安装 vitest。
- `vi.mock` 仅覆盖上游 setup 中的 4 处使用；测试文件内若另有动态 `vi.mock` 需求，登记 adapter-gap 而非扩展适配层能力（保真优先，不发明新 API）。
