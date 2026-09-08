# Task 01 baseline findings

本轮最明确的公开 API 热点是完整 HTML getter 和大结果冷查询。冻结的生产代码中，
FFI on 在 size 1 的 HTML getter 比 off 慢 49.7%–87.1%，大结果冷查询慢
36.0%–39.0%；两版、初始与补充批次的每个 ABBA 组均保持同一方向。
创建池和多数 snapshot 的公开路径尚无稳定收益结论。这里比较的是优化前同一
source/image 的 FFI 开关；不是 02/03 candidate 的优化验收。

数据来自 [完整表格](tables.md)、[完整合并样本](combined.json) 和
[运行/负载清单](campaign.json)。A=FFI off，B=FFI on；变化为 `(B/A−1)×100%`。
每个表项每侧保留 72 measured rounds、8 个新进程中位数和 4 个 ABBA 组变化。
大小 1 为主；0.1、2 的全部 phase 仍在完整表格中。没有跨 Bun 计算 speedup。

| size 1 公开操作 | Bun 1.4.0：off → on ms | 变化 | Bun 1.4.2：off → on ms | 变化 |
| --- | ---: | ---: | ---: | ---: |
| 大结果 scoped querySelectorAll，cold | 12.8352 → 17.8448 | +39.0% | 13.2144 → 17.9724 | +36.0% |
| innerHTML ASCII | 5.5116 → 10.0630 | +82.6% | 5.6488 → 10.1192 | +79.1% |
| innerHTML Unicode | 7.5395 → 11.4133 | +51.4% | 7.8590 → 11.9383 | +51.9% |
| outerHTML ASCII | 5.4393 → 10.0060 | +84.0% | 6.0656 → 11.3505 | +87.1% |
| outerHTML Unicode | 7.5495 → 11.3040 | +49.7% | 7.8406 → 12.4134 | +58.3% |
| child cold | 7.6839 → 7.7498 | +0.9% | 8.2594 → 8.5854 | +3.9% |
| preorder cold | 101.0610 → 104.6379 | +3.5% | 103.8840 → 104.6314 | +0.7% |
| create pool 256 | 10.2651 → 10.2564 | −0.1% | 11.2921 → 11.5043 | +1.9% |
| 16 Core operations 总和 | 397.614 → 398.112 | +0.1% | 384.777 → 391.722 | +1.8% |
| 13 Testing operations 总和 | 298.022 → 289.917 | −2.7% | 320.837 → 306.808 | −4.4% |

热点时间单位是一轮 32 次完整操作；创建项是一轮 32 个完整池档。Core/Testing
总和先逐轮相加再取中位数，不是各 phase 中位数相加。Core 的 serialize phase
另有 +78.2% / +79.7% 的同向结果；总和掩盖了这一局部成本。Testing 总和的较小
改善属于混合 workload signal，不将它解释成某一个 native API 的独立收益。

size 2 的冷查询仍为 +39.0% / +32.3%；size 0.1 则为 −23.4% / −25.1%，且有噪声
标记。这是规模敏感的路径选择线索，不能推广为所有 query 应禁用 FFI。
HTML 四项在两个辅助大小均有同向退化，但部分辅助表项仍有噪声标记；它们不享有
size 1 那样一致的稳定性。热查询、grow/shrink、各个创建池档的全部数据未删减。

| 三层 size 1，FFI on 的 ms/round | raw 1.4.0 / 1.4.2 | adapter 1.4.0 / 1.4.2 | facade 1.4.0 / 1.4.2 |
| --- | ---: | ---: | ---: |
| query.large.cold | 7.7761 / 7.9991 | 13.0025 / 13.5764 | 17.8448 / 17.9724 |
| preorder.cold | 9.9219 / 9.8687 | 11.1284 / 11.0854 | 104.6379 / 104.6314 |
| innerHTML.ascii | 5.5631 / 5.5356 | 9.9691 / 10.6950 | 10.0630 / 10.1192 |
| innerHTML.unicode | 5.9656 / 5.7186 | 11.9319 / 14.0404 | 11.4133 / 11.9383 |
| create.256 | 1.0382 / 1.0317 | 1.1784 / 1.3629 | 10.2564 / 11.5043 |

三层分属独立进程，并有不同输出契约：raw 的输入编码、caller buffer 分配及解码
在计时外；adapter 包括编码、增长、owned copy、解码；facade 还包括公开 wrapper
语义。不能用这些中位数相减声称精确的 JS 或 Rust 成本，也不应要求每次 facade
中位数都大于 adapter。raw Unicode serialization 的 off/on 改善约 28%–29%，其
两端返回 string 与 bytes 的差别尤其说明它不能替代公开 getter 的完整结果。

| 判断级别 | 证据与边界 | 给后续任务的优先级 |
| --- | --- | --- |
| 已证实的公开热点 | size 1 HTML getter 和大结果冷查询在两版、4 组 ABBA 中重复退化；独立 audit 实际观察到 adapter 路径 | 03 首先处理完整 serializer 路径选择/有界 buffer 与 decode，再处理 query 的增长与 owned copy；保留 Node-API 选择作为可测候选 |
| 已观察的机制 | Unicode getter 有 39,204 字节 owned copy 和完整 decode；query 4,100 字节、preorder 16,396 字节 owned copy；增长时新建多组 buffer | 03 按这些字节量验证复用/增长策略，不改变 caller-owned 输出、不返回悬空共享 view；C-call 重试次数是源码支持的解释，非直接计数 |
| 已观察的公开语义成本 | preorder 每次 audit 有 512 次 materializeNodeToken；fixture 中 512 个 `b` 不在 compact descriptor 名单内 | 02 先检查 preorder packing 的中间 Vec/复制，再看 query/child；03 保留 wrapper 身份和未知 descriptor 回退。不能删 fixture 来制造收益 |
| 相关 signal | raw preorder on/off 为 +15.2% / −0.6%；adapter 为 +28.4% / +12.7%，有噪声。其 native 及 adapter 帧出现在 profile 中 | 02 的 packing 优化有成本线索，但本轮没有 Rust allocator 的因果计数；必须用 candidate 的独立诊断和完整 facade ABBA 确认 |
| 无定论 | create 各档公开结果方向不一致；size 1 pool 256 接近持平。pool 1 两端均实际走 Node-API；FFI capability 并不决定路径 | 03 将创建池排在 serializer/query 后；保留 scalar range 对照和全部池档，不根据 raw 单项提升强制 FFI |
| 无定论 | 热缓存、child、preorder 和多个小 workload 的组间变化反号或接近噪声；全局 Core/Testing 总和不能定位原因 | 不将这些项标成稳定收益/回归；05 依原 >5% 重复回归与 10% 目标规则重新判定 |

02/03 可在 ABI v1 和 ownership 边界内独立实现；这里没有提出新 ABI、external
ArrayBuffer、全局无界池或取消 Node-API 生命周期。04 复用同一冻结 reference 与
运行时，IO 的因果定位由其自己的实际 checksum workload 完成。

CPU profile 单独在正式与补充采样全部结束后运行，两版 × FFI on/off × 三层共
12 个，全部有有效 sample 与 `operate` 栈。[profiles.json](profiles.json) 保留每个
外部文件的绝对路径、SHA256、字节数、实际命令/config、前 35 个全进程及 operate
后代栈帧。原始大文件位于 `/tmp/mad-dom-bun-performance-01/profiles/`，保留至 05
完成，不提交 native binary。复跑使用 [runner README](../../../../benchmark/bun-performance/README.md)
的独立 `--profile` 命令和新输出目录。

| profile 观察（两版顺序为 1.4.0 / 1.4.2） | 解释限制 |
| --- | --- |
| FFI-on facade 的 serializer callback `native-loader.js:658` 占 operate 后代加权样本 64.7% / 70.6% | 帧包含 native 调用及可能内联成本，不等于 JS 自身耗时占比，也不是普通运行的百分比 |
| FFI-on adapter 的 preorder callback `:641` 为 36.0% / 31.0%，query callback `:633` 为 22.9% / 23.4%，serializer callback `:658` 为 24.0% / 22.5% | 与增长/复制 audit 对应，但 JS profile 不解析 Rust Vec、allocator 或每次 native 重试 |
| FFI-on raw 直接出现 serialize、preorder、query、child、create 的 ABI 帧；`operate` 本身占 57.3% / 52.1% | JIT 内联和采样分辨率会丢失叶子归因，尤其短小创建调用；不根据未出现的帧认定零成本 |
| FFI-on facade 的 materializeNodeToken 为 10.8% / 14.4%；off 也为 14.6% / 11.0% | wrapper/native 分类属于两端公开契约中的实际成本，支持 audit 的语义解释 |

profile 明显扰动运行：baseline facade off 的独立进程约 353 秒、记录 RSS
1,947,631,616 字节；相邻 adapter on profile 约 32 秒、RSS 260,653,056 字节。
全进程包含 setup、验证及 GC，profile 与普通计时的耗时/RSS不能互换，更不能用这
个 profile RSS 推断 native leak。三个层的 profile 是各一组诊断，不产生 speedup。

共享 VM 为 8 vCPU AMD EPYC、Linux 6.8.0-31-generic，运行时平台 linux/x64/gnu。
各批次的端点快照范围如下；完整 `/proc` pressure/stat 和前 15 个进程名称保存在
每个 attempt 的 `before` / `after`。`ps` 的 %CPU 是进程统计而非整段计时的因果
归因，端点快照也不是持续监控。

| 批次 | 1 分钟 load 范围 | CPU some avg10 % 范围 | 噪声标记 rows / 264 |
| --- | ---: | ---: | ---: |
| baseline 初始 | 2.05–19.97 | 0.02–62.35 | 105 |
| latest 初始 | 2.61–29.14 | 0.36–81.26 | 95 |
| baseline 补充 | 1.21–6.58 | 0–37.07 | 79 |
| latest 补充 | 1.30–7.50 | 0–30.95 | 82 |

可见其他工作负载包括 MainThread、esbuild、tsc、turbo、浏览器和多组 agent。
本任务未控制它们；其中出现的 npm/python 等名称不是本任务执行命令。任务自己的
build/test、audit、profile 和正式采样全程串行，命令清单可复核起止时间。按预先
声明的噪声规则，两版五个 suite 均触发完整补充；没有剔除初始高负载样本、继续
选样直到通过，或更改阈值。强退化方向在本 VM 上可重复，绝对时长及小幅差异的
外推仍受共享负载限制。
