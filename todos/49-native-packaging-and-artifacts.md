# 49 实现原生多平台构建与 npm 产物

- 状态：待办
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T49`
- 依赖：T06, T21, T48
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按构建 ADR 生成、校验并发布可被支持平台 Bun 直接加载的原生产物。

## 条目

- [ ] **T49 — 实现原生多平台构建与 npm 产物**
  - 实现：
    - 实现目标平台矩阵构建、平台包拆分和运行时加载选择。
    - 生成校验和/签名所需元数据，并增加缺失或不支持平台错误。
    - 建立打包后在无 Cargo 环境中的安装 smoke test。
    - 实现 alpha/beta/stable 发布演练和失败回滚脚本。
  - 验收：
    - 每个目标平台产物可重复构建并通过安装后 smoke test。
    - npm 包只包含预期文件和正确类型/ESM 入口。
    - 不支持平台得到清晰、稳定的加载错误。

## 预期改动

- 构建/发布脚本
- `package.json` 与平台包元数据
- CI workflows
- 安装 smoke tests
- 发布文档

## 专属校验

- 平台构建与安装 smoke
- `npm pack --dry-run`
- 完整统一校验
- 发布 dry-run

## 边界

不 push tag、不发布 npm，除非用户在执行该 todo 时另行明确授权。
