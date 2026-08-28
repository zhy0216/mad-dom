# compat：happy-dom 兼容基线

本目录存放 MAD DOM 与锁定版 happy-dom 的兼容资产。[ADR-0002](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 定义兼容契约；本目录的文件负责让契约机器可读、可重复验证。

## 基线清单

`happy-dom-baseline.json` 记录 [ADR-0002 第 1 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 锁定的基线三元组及生成元数据：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 本清单 schema 版本（当前 `1.0.0`） |
| `generator` | 生成器 `name` + `version`（mad-dom 自身版本） |
| `happyDom` | npm 版本 `npmVersion`、40 位上游 git commit `gitCommit`、tag `tag`、npm 发布时间 `npmPublishTime` |
| `bun` | 兼容判定用 Bun 版本 `version`（与仓库 [.bun-version](../.bun-version) 一致） |
| `generatedAt` | 清单生成时间（ISO 8601 UTC，`Z` 结尾） |
| `source` | 来源：npm registry 与锁定 tarball、上游仓库、分支策略（不读上游 main） |
| `adr` | 指向 ADR-0002 的相对路径 |

清单值必须与 ADR-0002 第 1 节精确一致：`validate-baseline.js` 内置的锁定基线常量即取自该表，任何一端漂移都会校验失败。schema 拒绝未知字段。

## 校验

```sh
bun compat/validate-baseline.js
```

零依赖、离线、可重复运行：只读取清单与仓库 `.bun-version`，不访问网络。校验覆盖：

- 必填字段存在且非空；未知字段拒绝；
- 版本号为 semver 格式；commit 为 40 位小写 hex；tag 必须等于 `v<npmVersion>`；
- 时间字段为可解析的 ISO 8601 UTC；
- `schemaVersion` 匹配；
- 交叉验证：`bun.version` 与 `.bun-version` 一致；`happyDom` 三元组与 ADR-0002 锁定值一致。

失败时逐字段输出错误并以 exit 1 退出；通过时输出简明 OK 摘要。也可显式传入清单路径（用于临时副本或篡改演练）：

```sh
bun compat/validate-baseline.js <path/to/manifest.json>
```

## 基线升级操作

按 [ADR-0002 第 9 节](../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md) 执行，一次升级一个独立提交：

1. 更新 `happy-dom-baseline.json` 的 `happyDom`（npm 版本、commit、tag，必要时 `npmPublishTime`）与 `bun`（如需），并把 `generatedAt`、`generator.version` 刷新为本次生成值；
2. 同步更新 `validate-baseline.js` 顶部的 `PINNED` 锁定常量与 ADR-0002 第 1 节基线表（或由新 ADR 取代）；
3. 在同一独立提交中重新生成快照与类型/差分结果，恢复全部兼容门禁（快照、类型、黑盒差分、退化检查）；新增差异逐项归入 `pass` 或 `known-gap` 并写明原因，不得静默跳过；
4. 提交说明列出新旧版本、新旧 commit 与差异摘要；该提交只做基线升级，不混入功能改动。

生成与验证只针对锁定的 npm 版本与上游 tag（如 `v20.11.11` 对应 commit `64e2c774…`）；不读取上游 `main` 分支或未发布提交，上游 main 不作为发布门禁。

## 边界

T07 不生成公开 API 快照（`public-api/` 归 [T08](../todos/08-public-api-snapshot.md) 所有），不安装 happy-dom，也不提供快照生成器。
