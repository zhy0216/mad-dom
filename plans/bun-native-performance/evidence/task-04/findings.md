# Task 04 findings

保留单次目录扫描和串行 read/hash。128 包 verify 的实际 CLI 整进程中位数在 Bun enabled 两版下降 30.7% / 32.7%，forced fallback 下降 29.9% / 33.7%。所有 source-comparison ABBA 组的多包 verify 都改善，其他端到端行没有确认的重复 >5% 回归。这里验收的是公开 checksum CLI，不宣称 DOM facade 变快。

完整分布、p90、MAD、每个进程中位数、所有原始与补充 ABBA 组见 [tables.md](tables.md) 和 [combined.json](combined.json)。正数表示 B 更慢，不跨 Bun 版本求比值。

## 单次扫描的收益

| Bun / IO mode | Reference → candidate 整进程 ms | 变化 | 内部命令 ms | 全部 ABBA 组端到端变化 |
|---|---:|---:|---:|---|
| baseline / bun | 50.361 → 34.884 | -30.7% | 22.818 → 10.968 | -31.5%, -27.9% |
| baseline / fallback | 40.049 → 28.065 | -29.9% | 15.426 → 4.640 | -28.4%, -27.6%, -31.2%, -32.0% |
| latest / bun | 46.108 → 31.044 | -32.7% | 24.410 → 11.165 | -29.3%, -26.2%, -36.0%, -32.8% |
| latest / fallback | 35.471 → 23.521 | -33.7% | 15.773 → 4.345 | -29.2%, -32.2%, -34.6%, -33.4% |

独立 [baseline audit](audit-baseline.json) / [latest audit](audit-latest.json) 均观察到多包 verify 的 readdir 从 128 次降为 1 次；read 仍为 129 次（128 tarball + 1 manifest），hash 仍为 128 次。Bun/Node 的实际 API 调用各自独立计数，正确性/诊断钩子不进入正式计时。

小包和大包场景的源码对照多数接近噪声。baseline Bun 大包表面改善约 7%–10%，但 ABBA 组方向/幅度不一致；不把它认定为单次扫描的稳定收益。latest 初始 many.generate +8.5%、large.verify +7.5%，完整补采后合并为 −0.1% / +1.7%，组间反转；generate 生产分支未改，未确认重复回归。baseline fallback 内部 large.generate 首批 +8.5%（组 +7.5% / +7.0%）触发补采，补采变为 −0.2%（组 +4.5% / −11.4%），未重复出现同向退化；对应直接 CLI 首批 +0.8%、补采 −1.5%。generate 分支没有改变，内部 data-module 解析/JIT 和共享负载影响不可精确分离，不把内部窗口替代端到端验收。所有内部行仍展示在完整表格。

## 吞吐和内存

下表为 many.verify 内部 worker 每轮的 after RSS、after heap 和进程 maxRSS 中位数，单位 MiB；A=reference，B=candidate。完整每轮 before/after/峰值字段都在 raw JSON。maxRSS 包括 oracle 和运行时，不是 CLI buffer 的独立峰值。

| Bun / IO mode | RSS A → B | heap A → B | maxRSS A → B |
|---|---:|---:|---:|
| baseline / bun | 52.35 → 50.50 | 7.06 → 1.98 | 54.11 → 53.69 |
| baseline / fallback | 51.22 → 49.75 | 4.70 → 3.99 | 53.93 → 54.01 |
| latest / bun | 51.26 → 48.46 | 7.01 → 1.94 | 52.35 → 52.14 |
| latest / fallback | 50.50 → 48.30 | 4.59 → 3.87 | 52.66 → 52.50 |

生产 reference/candidate 的最大在途 tarball 都是 1 个：small 4 KiB、many 16 KiB、large 8 MiB。并发 prototype 在 small/many 为 2 个（8 KiB / 32 KiB），large 按 8 MiB 预算仍是 1 个。没有以无界读取换取吞吐；生产实现没有额外调度器。heap 随自然 GC 波动，尤其 fallback 的分布很宽；不把单个中位数解释为精确分配节省或 leak 证明。

## 有界并发决定

预声明原型最多 2 个文件、8 MiB 已知大小，逐有界批次 Promise.allSettled，所有工作完成后按输入顺序检查失败。与已经单次扫描的串行 candidate 对比，两版分别 ABBAABBA，并按同一噪声/回归规则完整补采。原型未进入生产：收益没有达到两版稳定 ≥10% 且无重复 >5% 回归的预算。

| Bun / IO mode | many.generate 整进程变化 | many.verify 整进程变化 |
|---|---:|---:|
| baseline / bun | -4.1% | -2.9% |
| baseline / fallback | +4.5% | +3.8% |
| latest / bun | -5.9% | -6.8% |
| latest / fallback | +10.2% | +9.4% |

latest fallback 的多包 generate/verify 在每个初始与补充组都变慢约 6%–12%；额外 stat、批次/Promise/Map 工作无法与同步 fallback 读取重叠，是源码支持的解释。没有用独立 CPU profile 做更细的因果归因。原型对静态 fixture 满足在途预算，但 stat 后增长的文件仍需另一个内存协议；保留简单实现也避免引入这种新合约及新的异常排序风险。

## 优化前的实际 IO 成本

这是冻结原源码上的独立 A=fallback/B=Bun 对照，已在修改 checksums.mjs 前保存；采用相同 fixture、窗口、2 warmup/9 measured 和至少两组 ABBA。表中的数字是整进程变化，不是单独 Bun.write 耗时。

| Workload | baseline Bun vs fallback | latest Bun vs fallback |
|---|---:|---:|
| small.generate | +5.1% | +3.6% |
| small.verify | +7.6% | +5.0% |
| many.generate | +29.8% | +26.1% |
| many.verify | +18.1% | +22.2% |
| large.generate | +10.3% | -8.3% |
| large.verify | +2.0% | -7.1% |

small/large 的实际 manifest 都是 380 字节，many 是 12,160 字节。Bun 的真实 CLI 路径在部分场景更慢，但这里同时包含 read/hash/manifest IO 和启动，不能归因于单个写 API。历史 1 MiB 重复 Bun.write 约 4× 的差异是另一微基准；没有用它改小 manifest 写入策略，也没有设置全局“Bun 更快/更慢”开关。

## 样本与边界

所有正式、补充和原型 campaign 已完成，144 个独立 ABBA worker，0 失败；每 worker 六个内部新进程各 2 warmup/9 measured，并保存对应直接 CLI 的 2 个预热标记启动和 9 个测量启动。每个窗口合计 7,776 measured + 1,728 warmup 样本。直接 CLI 每次启动本身是冷进程；其父进程的 warmup 标记不代表 CLI 内部已经预热。

每一轮核对完整 manifest 和每个 tarball，fixture/oracle/删除不计时。测量使用暖文件/page cache；normal GC 保留在计时中，内部数据模块解析/依赖缓存和直接启动是两个独立窗口。共享 VM 的负载、CPU pressure、进程名与所有失败预备记录保留。生命周期、scratch 和历史 v2 RSS 漏检限制不变。样本不能外推为其他机器、冷磁盘或所有 Bun IO 的统一收益。
