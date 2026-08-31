---
name: mad-dom-publish
description: 发布 mad-dom 及其原生平台包到 npm（@mad-dom/platform-*），或在 integration-test 中用本地包跑 happy-dom 集成测试。当用户要求发布/推版本/release mad-dom、发平台包、用 npm 安装的方式验证集成测试时使用。记录官方 registry 配置、版本联动、provenance 限制、传播延迟等坑。
---

# MAD DOM 发布与集成测试引用

mad-dom 是 native memory-arena 的 Bun DOM 实现：主包 `mad-dom` + 每平台一个 optional 原生包 `@mad-dom/platform-<os>-<arch>[-<libc>]`。原生加载链（`js/native-loader.js`）按顺序解析：`MAD_DOM_NATIVE_PATH` → platform 包 → 仓库 dev artifact `build/mad-dom.node`。

## 0. 什么时候用哪个路径

- **本地快速迭代（推荐默认）**：integration-test 用 `"mad-dom": "file:.."`（bun 建 symlink 到仓库根，走 `build/mad-dom.node` dev artifact），不发布。见 §5。
- **真实发布**：走 §1–§4。仅在用户明确要求发布时执行。

## 1. 前置检查

```bash
# 必须登录官方 registry（npm 全局 ~/.npmrc 配的是 npmmirror！）
npm whoami --registry=https://registry.npmjs.org          # 期望 zhy0216
# @mad-dom 组织必须已存在（@mad-dom/* 是 scoped 包，没有组织会 404 "Scope not found"）
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/@mad-dom/platform-darwin-arm64   # 期望 200
```

坑：`~/.npmrc` 全局 registry 是 `https://registry.npmmirror.com`。**任何 npm/npm view 命令都要显式 `--registry=https://registry.npmjs.org`**，否则走镜像（延迟大、且 whoami 会失败）。

## 2. 版本联动（最重要）

- 主包与所有 platform 包**共享同一个版本**。`release.mjs` 的 `stageMainPackage` 把 optionalDependencies 全部 pin 到 `version` 参数。
- npm 不允许重复发布同一版本 → 每次发布必须 bump（如 `0.0.1-alpha.2` → `0.0.1-alpha.3`）。
- **先发布 platform 包，再发主包**。若 platform 包缺失，bun install 只报 optional 警告，运行时报 `MAD_DOM_UNSUPPORTED_PLATFORM`（如主包 alpha.2 配了 platform alpha.2 但只发了 alpha.1）。

## 3. 打包（dry-run，安全）

```bash
cd <repo>
bun scripts/release.mjs draft --stage alpha --version <新版本> [--no-build]
```

- `--no-build`：复用 `build/release/platform/*` 已有的编译产物（二进制没变就不用重编，快很多）。
- 本机只装了 `aarch64-apple-darwin` 的 rust target，所以只构建/打包 darwin-arm64，其余平台会被 skip（留给 CI 在原生 runner 上构建）。
- 产物在 `build/release/tgz/`：`mad-dom-<v>.tgz` + `mad-dom-platform-darwin-arm64-<v>.tgz`。

历史坑（已修，2026-08-31）：`scripts/release.mjs` 的 `packPackage` 曾对共享 tgz 目录 `rmSync`，会把前面已打好的平台包 tarball 清掉。现在只 `mkdirSync`。若将来行为异常，先查这里。

## 4. 发布（真实、不可逆，需用户明确授权）

本地**不能加 `--provenance`**：GitHub Actions 之外会报 `Automatic provenance generation not supported for provider: null`。`release.mjs publish` 硬编码 `--provenance`，所以本地用下面的手动流程（CI 才走 `MAD_DOM_ALLOW_PUBLISH=1 bun scripts/release.mjs publish --no-dry-run`）。

```bash
cd build/release/tgz

# 1) platform 包先发（新版本：需先按 §3 重打包，或改 platform pkg package.json version 后 npm pack）
npm publish mad-dom-platform-darwin-arm64-<v>.tgz --tag next --registry=https://registry.npmjs.org

# 2) 校验 registry 完整性（release.mjs 同款逻辑）
LOCAL=$(shasum -a 512 mad-dom-platform-darwin-arm64-<v>.tgz | awk '{print $1}' | xxd -r -p | base64)
REMOTE=$(npm view @mad-dom/platform-darwin-arm64@<v> dist.integrity --registry=https://registry.npmjs.org)
test "$REMOTE" = "sha512-$LOCAL" && echo "INTEGRITY OK" || echo "MISMATCH"

# 3) 主包最后发
npm publish mad-dom-<v>.tgz --tag next --registry=https://registry.npmjs.org
```

**传播延迟**：发布成功后 `npm view`/`curl` 可能 404 约 1–2 分钟（tarball URL 先 200，元数据后到）。等下再查，不是失败信号：
```bash
for i in 1 2 3 4 5 6; do sleep 20; npm view mad-dom@<v> version --registry=https://registry.npmjs.org 2>/dev/null && break; done
```

## 5. integration-test 本地引用（快速路径）

integration-test 是 happy-dom 的集成测试拷来改的，import 已改为 `'mad-dom'`。**本地优先用 `file:` 依赖，不要发布**：

```bash
# integration-test/package.json 的 devDependencies 写：
#   "mad-dom": "file:..",
# （bun 会 symlink 到仓库根，走 build/mad-dom.node dev artifact，无需 platform 包）

cd integration-test
rm -rf node_modules bun.lock
# bun 会读 ~/.npmrc 的 npmmirror + 可能有缓存，装 mad-dom 相关包时显式指定：
bun install --registry=https://registry.npmjs.org --force --no-cache
bun test test        # 或 bun test test/<file>
```

## 6. 测试结果快照（2026-08-31，happy-dom 集成测试对 mad-dom）

| 文件 | 结果 | 说明 |
|---|---|---|
| CommonJS.test.cjs | ✅ 1/1 | Window/document/appendChild 可用 |
| WindowGlobals.test.js | ✅ 3/3 | `document.write` + script 求值（vm 上下文绑定 window 表面） |
| Fetch.test.js | ✅ 2/2 | `window.FormData`（multipart 序列化与 happy-dom 逐字节一致）+ fetch |
| XMLHttpRequest.test.js | ✅ 3/3 | `window.XMLHttpRequest`（异步走 fetch；同步走 spawnSync 子进程） |
| WebSocket.test.js | ✅ 1/1 | `window.WebSocket` = Bun 原生 WebSocket |
| Browser.test.js | ⚠️ | ✅ 已实现 `Browser`/`BrowserErrorCaptureEnum`（browser/page 模型，`js/facade/extensions/browser.js`）；测试本身依赖真实 github/npmjs SSR 内容与外网可达性，网络正常时通过 |
| BrowserExceptionObserver.test.js | ✅ | process-level 错误捕获：未捕获脚本错误/拒绝路由到 window `error` 事件 + `virtualConsolePrinter` |

实现位置（均按 facade 扩展约定注册进 `js/facade/extensions/index.js`）：
- `form-data.js`：`window.FormData` + `serializeFormData()`，fetch.js `getBodyStream` 接入
- `web-socket.js`：`window.WebSocket` → Bun 原生 WebSocket
- `xhr.js`：`window.XMLHttpRequest`（`async=false` 用 `spawnSync` 跑子进程 fetch）
- `document-write.js`：`Document.prototype.write`，脚本经 `window.eval` 求值，抛错经 `dispatchWindowError` 派发到 window
- `browser.js`：`Browser`/`BrowserErrorCaptureEnum`/page/frame 模型（入口导出；goto 为服务端导航，不评估页面脚本；process-level 错误捕获走 `process.on('uncaughtException'/'unhandledRejection')` 按 vm 上下文 `Error` intrinsic 匹配窗口；锚点默认导航靠 frame 注册 body/documentElement/head 原生 handle 反查）

坑：
- `Fetch`/`XMLHttpRequest` 都监听 3000/3001 端口，`bun test` 默认并行跑多个文件会端口冲突报 `Failed to start server. Is port 3001 in use?`。单文件逐个跑可避免误判。
- 端口被无关进程占用时先 `lsof -nP -iTCP:3001 -sTCP:LISTEN` 排查。
- `window.eval` 的 vm 上下文不能直接把 window facade 当 global：Bun 的 vm 里裸调用全局函数（`addEventListener(...)`）时 `this` 是 `undefined`。`createWindowEval` 构建显式 global 对象，把 window 表面方法绑定到 facade；`window`/`self`/`globalThis` 指向 sandbox 本体保证 `this === window`。
- 文档反向查找（`document.write` 找 window）用 `ctx.windowFacadeOfDocument`，值存 WeakRef，避免 window→native→document→window 强引用环（Bun GC 收不掉，`timers.test.js` 生命周期测试会挂）。
- `window.js` 导出形状被 T22B 测试 pin 死（恰好 `["Window","createWindow","seam"]`），新能力一律走 `ctx`，不要加模块导出。

## 7. 原生加载相关历史修复

`js/native-loader.js` 是唯一 loader（`mutation-observer.js`/`custom-elements.js`/`window.js` 已接入）。2026-08-31 发现 `mutation.js` 与 `events.js` 还带 pre-T49 的遗留 loader（只认 `MAD_DOM_NATIVE_PATH`/`build/mad-dom.node`，不解析 platform 包），已改为 `import { loadNative } from "../../native-loader.js"`。若再遇到 `MAD_DOM_NATIVE_NOT_FOUND` 指向 `build/mad-dom.node`，先查是否有 facade 文件漏接入共享 loader。
