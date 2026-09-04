difficulty: easy

# 01 · 可靠性修补（dom-bench CLI / spawn / median / 字节数）

## 目标

修掉 dom-bench 主进程与 worker 的全部输入输出健壮性问题。对应 plan.md 拆解 T1。只改
`benchmark/dom-bench/run.mjs` 与 `benchmark/dom-bench/worker.mjs`。

## 要做什么

- 参数校验（两个文件都要）：新增共享形态的 `parseRuns`（worker 已有 parseArgs，run.mjs 的
  parseArgs 同样处理）——`--runs` 必须为整数且 ≥ 1，否则 `console.error(usage)` 并 `process.exit(2)`。
  修掉现状：`--runs 0 --json` 静默返回空 phases；普通模式 `mad.phases[phase].toFixed` 对 undefined throw。
  usage 文案为单行：`usage: bun benchmark/dom-bench/run.mjs [--runs <n>] [--json]`（worker 同理带 --engine）。
- 子进程健壮性（run.mjs:39 `runEngine`）：
  - `spawnSync("bun", ...)` 改为 `spawnSync(process.execPath, ...)`；
  - 检查 `result.error`（spawn 失败时 status 为 null）与 `result.signal`，任一存在则报错退出
    （错误信息含引擎名与原因）；
  - `JSON.parse(result.stdout)` 包 try/catch：失败时报"worker for <engine> produced invalid JSON"，
    附 stderr 前 500 字符与 stdout 前 500 字符；
  - 解析成功后校验 `report.schema === "mad-dom-dom-bench/1"` 且 `report.engine === <engine>`，
    不符则报错退出。
- median 统一（worker.mjs:82）：改为标准中位数，照抄 `benchmark/run.mjs:88` 的实现
  （偶数取两中值平均）：`const mid = Math.floor(n/2); return n % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;`
- `htmlBytes`（worker.mjs:215）：`HTML.length` 改为 `Buffer.byteLength(HTML, "utf8")`。
- build 规模口径如实化（worker.mjs:42、report.workload）：除 `buildNodes` 外，worker 在 runBuild 里
  如实统计 `builtElements`（createElement 次数）、`builtTextNodes`（createTextNode 次数）、
  `buildRoots`（root + body 挂载数，当前为 1），写入 report.workload；run.mjs 打印行
  （run.mjs:64 `${mad.workload.buildNodes}-node build`）改为
  `${builtElements} elements + ${builtTextNodes} text nodes`。
- worker 侧 `--engine` 校验保留现行为（报错 throw 即可，不必改 exit code）。

## 预计修改的文件

- `benchmark/dom-bench/run.mjs`
- `benchmark/dom-bench/worker.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 3` 退出 0，两引擎正常打印对比表。
- `bun benchmark/dom-bench/run.mjs --runs 0`、`--runs abc`、`--runs -1`、`--runs 1.5` 全部以非零退出码
  结束并打印 usage（不能出现 undefined/toFixed crash）。
- `bun benchmark/dom-bench/worker.mjs --engine mad-dom --runs 1 --json` 输出合法 JSON，
  `phases` 五个键全为数字（无 undefined/缺键）。
- median 为偶数轮时等于两中值平均（可临时构造样例验证后删除，或口头对照 run.mjs:88 实现一致）。
- `git diff` 仅限上述两文件。

## 前置依赖

无。
