# Task 03 evidence

状态：v1 实现、六项正式对照（464 runner-valid）、null-source control（80 进程）、
v1 语义 probe、T2 路径决策与最终 T3 复验全部完成；T2 决定不引入新静态路径。
本文件为任务最终状态；单 commit 归档于本地分支。

本候选仅修改 `js/native-loader.js` 和 `js/facade/extensions/html.js`：复用
encoder/decoder、六个有界长度 scratch 和五个容量提示；返回数组始终独立拥有。
公开操作仍沿用原路径，没有能力屏蔽、版本名单、计时自适应或新 ABI。
原生 image 在本 worktree 用 Rust 1.93.1 构建，未合入任务 02。
当前测量 worktree 继承的 commit 为 `fe77b7e28ba1ca24e40ce9272bc6a504cb32c191`；
协调器后续报告的 main 集成（包括 04 的 `24d89122758dca628786211763497bd065d2c2a4`）
不属于这些测量的源码。所有 campaign 继续记录自己的 HEAD 锚点与实际生产文件摘要。

[预声明方法与预算](method.md)、[修改前生产源码](before-source.json)、
[独立核实的 baseline/latest](runtimes.json)、[官方 latest API 原始响应](latest-release.json)
在正式采样前保留。source comparison 由公共 runner 分别设置冻结 reference 和
candidate 的两个 native override；不会把 candidate image 用作冻结 reference。
[candidate-v1-source.json](candidate-v1-source.json) 另行归档当前已测候选相对 01 的
全部生产差异，包含真实字节的 base64、每个文件的 SHA256、冻结基准 commit 与继承的
01 commit；即使后续返修，单个最终 commit 也能重建这版候选。
`*-ffi` 批次另行比较同一 candidate 的 FFI off/on，两个端点都明确指向 candidate；
它们不属于冻结 source comparison。其 integrity 文件额外核验冻结 reference 仍未变，
实际测量端点、模式和路径以各批次 manifest 与完整命令为准。

| 验收 | 当前证据 |
| --- | --- |
| T1 容量、回落、异常与所有权 | `outputBuffer` 仅保留数值提示和四字节长度 word；三种 word 操作提示上限 16,384 words，两种 byte 操作上限 131,072 bytes；六种操作总计 24 bytes scratch backing store，另有固定 JS 对象开销。所有 output 临时分配；小成功立即缩小提示；超提示上限或异常重置；原硬上限和八次重试不变。见 [方法](method.md) 与 [真实调用 fixture](../../../../tests/bun/fixtures/ffi-adapter-reuse.mjs)。 |
| T1 原输入检查与错误协议 | intrinsic TypedArray length、shared/resizable/detached 拒绝、无隐式数值转换、UTF-8、原 native taxonomy 和只读 fallback 均保留；既有 ffi-memory / ffi-loader 专项真实运行。 |
| T1 创建 exact-capacity / single-shot | 新 fixture 在真实 C 调用后注入错误 success 长度并断言抛错且只调用一次；验证 0、1、8、32、128、256、257、3000、4095、4096 的容量与唯一 token，另保留既有非法输入与 facade 故障测试。 |
| T2 完整公开时间、actual path、指纹与内存 | 六项 v1 正式对照共 464 个 runner-valid worker，使用未修改的 01 runner 全部 Core/Testing/raw/adapter/facade workload；原中断的预约覆盖限制另列。见 [完整 v1 结论](findings-v1.md)、[全部合并样本](combined.json) 与各批次独立 audit。回归定位已完成：null-source control 证明 source-off 重复退化与生产字节无关，见 [control 结果](null-control-results.md)。 |
| T2 创建池 scalar range 对照 | 独立 audit 确认 FFI off 使用 Node-API `createElementTokenRange`；创建 1 的公开路径本来就使用 scalar。`create.N` 在三个 size 标签下均固定创建 N 个节点，属于不同测量位置/进程状态的重复；按全部重复与噪声判断无稳定 tier 收益，control 亦显示零差异下同类位置漂移（如 `raw\|0.1\|create.32`-族），不满足可信 pool 元数据选择条件。最终取舍见 [T2 决策](t2-path-decision.md)。 |
| T2 路径选择结论 | 不引入新静态路径：state-dependent HTML 路线被 v1 语义 probe 的等价性反证阻止（leading U+FEFF 在 FFI TextDecoder 路线被剥离而 Node-API 路线保留；非 Element receiver 的 outerHTML 仅在 FFI serialize mode 0 成功，Node-API 抛 `ERR_MAD_DOM_HIERARCHY`；borrowed getter 同一 wrapper 跨 materialize 转换公开字符串改变），公开字符串/错误 taxonomy 前后不一致；创建与序列化无决策级收益证据。v1 生产改动即最终候选，无多余分支需撤回。trace oracle 无需变化（路径未变），断言未削弱，actual-path audit 保持原样。 |
| T2 正确性与 ABI 独立性 | 两版 navigation/query、HTML/live collection、FFI facade/loader/Worker、边界 selftest 和完整 validate 均通过。native 两侧均使用旧 ABI v1。 |
| T3 retained arrays / reentrant / Worker | [ffi-memory](../../../../tests/bun/ffi-memory.test.js) 新增 24 个文档的大小交替、全部六种输出、destroy/GC/transfer 保留验证；[Worker fixture](../../../../tests/bun/fixtures/ffi-retained-worker.mjs) 验证真实跨线程 owner 隔离和往返 transfer；[重入 fixture](../../../../tests/bun/fixtures/ffi-adapter-reuse.mjs) 在真实 native 写出后重入另一文档，检验长度隔离与异常恢复。 |
| T3 完整命令和失败 | [主要命令、env、退出码及日志哈希](commands/commands.json)；[validation driver](validation.mjs) 通过 activity.py build-test 许可执行，两版均使用自己的 executable 和同一个本 worktree image。附加检查另有独立 ledger，见下文。最终复验：null control 恢复 v1 后于 2026-09-09 两版全绿重跑（ledger 054-073，标签复用原名、按时间戳区分，见 [验证索引](validation-results.md) 末节）。 |

附加的 DOM report tests 与 IO selftest 使用 `commands/additional/commands.json`
单独记录，避免共享 build-test 许可下与完整 validate 同时写入同一个 ledger。
两版附加检查均于 2026-09-08T15:30:39Z 前通过，四个命令均退出 0。
逐项命令、两版结果及原失败入口另见 [v1 验证索引](validation-results.md)。

两版 FFI on 的冻结 source comparison 已各完成初始和一次完整补采，共 160 个
正式进程全部有效；四份 integrity 均证明生产源码、image、executable 与 driver
未变。latest 补采于 2026-09-08T15:29:11Z 完成，初始小操作退化及补采反向结果
见 [诊断说明](diagnostic-notes.md) 和 [完整合并样本](combined.json)。两版 FFI 模式
也已完成：baseline 为 40+40 个进程，latest 为 40+32 个进程；latest Testing
未触发补采，其初始两组完整 ABBA 仍保留。baseline source-off 已完成 40+32 个
有效进程；latest source-off 的 40+40 个有效进程于 22:15:17Z 完成最终分析与完整性
检查。六项原对照总计 464 个 runner-valid worker、116 组完整 ABBA；其中两组
baseline FFI 初始 Core 的预约全程覆盖不能认证，不能混作 116 组均有完整预约证明。
[v1 结论](findings-v1.md) 保留公开 HTML / 大查询收益、模式相反结果及 source-off
仍然重复的退化，不宣称这些退化已修复。

协调器授权的 [空差异 source control](method-null-control.md) 已于 2026-09-09
执行完成（[结果](null-control-results.md)）：先完成并核验已排队的四组 v1 语义
probe（baseline/latest × FFI on/off，全部退出 0，字节与哈希核验通过，
`publicKindReads = 0`），复核归档与当前生产字节严格相等；随后单个普通
sampling 预约内临时还原 v0（188 个生产文件与冻结 reference 逐字节相等，digest
`119652fe…`）、按原协议全 workload / 原 sizes / 原补采规则完成 40+40 个有效
进程、两组 integrity `unchanged: true`，最后从归档恢复 v1（digest `74ef5e3c…`，
全部逐字节校验通过，无 unknown-bytes 记录，v1 归档未动）。结论：v1
source-off 的重复退化在字节相同的生产下于原位点消失并在其他位点以同量级重现
（含 FFI off 下两端点同为 Node-API 的 raw/adapter 行），与 v1 改动无关；跨时段
因果限制仍适用。最终路径决策见 [T2 决策](t2-path-decision.md)：不引入新静态
路径。

会话中断恢复记录见 [本任务审计](recovery-20260908/task-03.json) 和
[协调器原始审计副本](recovery-20260908/session-recovery-20260908.json)。旧 wrapper
退出时间、退出码和锁丢失窗口不可追溯认证，旧 `granted` 行不证明当前持锁。
存活的 `baseline-ffi` driver 保持运行，由协调器自 15:53:38Z 起的 orphan guard
保护；其 runner 完整性和预约完整性分别判断。恢复时未完成的样本、旧 journal
和 guard 快照全部保留。确认三个未启动对照的旧 wrapper 已死亡且无对应存活子进程
后，使用 `*-resumed` 新目录经原 gate 重新预约，不覆盖旧目录。

两版均已通过 `bun run check`、`bun run report:runtime`、指定 loader/memory、
navigation/query、HTML/live tests、附加 capability/facade/Worker tests、
`bun run bench:bun-native:selftest`。两版完整 `validate` 均已通过：各 Bun 1197 pass、
Rust 691 pass、类型 24 fixtures，另有 WPT 5 pass。latest 补齐 fixture 后的完整
复验于 2026-09-08T13:47:01.374Z 退出 0。

历史失败全部保留：开发 fixture 的前两次执行分别暴露测试 API 用法错误和
`mock.module` 未拦截 createRequire 的问题；改为真实 dlopen 包装后两版通过。
首次 latest validate 的三项 ledger 失败来自新 worktree 缺少 69 个 rewritten
fixtures；原生产专项与 Rust/类型检查通过。按协调器要求通过 gate 运行
`bun run compat:hdunit:rewrite`，没有修改 ledger、测试容忍度或上游声明状态。
原失败 stderr 的三行空白源码摘录含 Bun 输出的行尾空格；本目录 `.gitattributes`
仅对此文件关闭行尾空格格式提示，保留原始日志字节及哈希，其余文件规则不变。

现有 native 生命周期计数和 RSS 限制未改变。小结果不会保留此前的大 buffer，
adapter 不缓存 document；这些结构性边界和压力测试不构成对任意泄漏的证明。
共享 VM 的外部竞争、raw RSS 历史漏检限制（[baseline README](../baseline/README.md)
记录在案，含 v2 漏检事实，不得回退删除）与 profile 归因限制继续适用；
null control 执行窗口的负载（granted 时 5.25、峰值约 12）与各批噪声标记均已
按原样保留在对应 manifest/analysis 记录中。v1 完整矩阵、控制结论、probe 观测、
最终路径取舍（不引入新静态路径）与两版最终 T3 复验均已记录于本目录；剩余已知
限制仅为跨时段因果不可单独认证与非零 VM 噪声。
