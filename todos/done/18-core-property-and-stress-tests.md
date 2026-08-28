# 18 建立 Core 属性测试与压力用例

- 状态：已完成
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T18`
- 依赖：T17
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

用可重放的随机 mutation 序列持续验证 arena、树关系和跨文档不变量。

## 条目

- [x] **T18 — 建立 Core 属性测试与压力用例**
  - 实现：
    - 生成合法/非法 append、insert、remove、replace、clone/import/adopt 序列。
    - 每步运行不变量检查，并在失败时输出 seed 与最小复现。
    - 加入深树、宽树、频繁复用和跨文档误用压力测试。
    - 记录现有 unsafe 清单和适用的 Miri/sanitizer 命令。
  - 验收：
    - 固定种子测试稳定可重放。
    - 故意注入关系或 generation 缺陷时属性测试能失败。
    - 测试资源上限适合常规 CI。

## 预期改动

- `crates/mad-dom-core/tests/**`
- 测试依赖配置
- 安全检查文档/脚本

## 专属校验

- Core 属性测试
- `cargo test -p mad-dom-core`
- 适用的 Miri 或 sanitizer smoke
- 统一仓库校验

## 边界

不以模糊测试替代明确单元测试。
