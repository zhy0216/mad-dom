# 05 差分移植波次 W5：nodes 核心内部类

- 状态：待复核
- 优先级：P1
- 里程碑：W5
- 条目 ID：`D05`
- 依赖：D04（波次文件划分以 D01 后用户重排决策为准，见 todos/README.md 用户决策点 1）
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W5–W8）

## 目标

nodes 子系统 104 个 `unmapped-internal-import` 文件按上游目录拆 4 波（W5–W8）。本波覆盖 **nodes 核心内部类**（node / element / character-data / child-node / attr / document / document-fragment / parent-node，共 13 个文件），按共用移植协议（todos/README.md）1:1 移植为差分场景。id 规则：subsystem `nodes` + basename，如 `nodes/node/Node.test.ts` → `nodes-node`。

## 波次文件清单（13）

| 文件 | 导入的内部模块 |
| --- | --- |
| `nodes/attr/Attr.test.ts` | nodes/node/NodeTypeEnum 等 |
| `nodes/character-data/CharacterDataUtility.test.ts` | CharacterDataUtility.js |
| `nodes/character-data/CharaterData.test.ts` | CharacterData.js、CharacterDataUtility.js、ChildNodeUtility.js、NonDocumentChildNodeUtility.js |
| `nodes/child-node/ChildNodeUtility.test.ts` | ChildNodeUtility.js |
| `nodes/child-node/NonDocumentChildNodeUtility.test.ts` | NonDocumentChildNodeUtility.js |
| `nodes/document-fragment/DocumentFragment.test.ts` | 内部 |
| `nodes/document/Document.test.ts` | 内部 |
| `nodes/element/Element.test.ts` | 内部 |
| `nodes/element/NamedNodeMap.test.ts` | 内部 |
| `nodes/node/Node.test.ts` | 内部 |
| `nodes/node/NodeList.test.ts` | 内部 |
| `nodes/node/NodeUtility.test.ts` | NodeUtility.js |
| `nodes/parent-node/ParentNodeUtility.test.ts` | ParentNodeUtility.js |

## 条目

- [x] **D05 — W5 nodes 核心内部类差分移植**
  - 实现：
    - 逐文件核实运行时导入（读 `tests/happy-dom/rewritten/nodes/**`）：enum/type-only 排除（如 Attr 若仅 NodeTypeEnum，triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - 纯 *Utility 文件（CharacterDataUtility、ChildNodeUtility、NodeUtility、ParentNodeUtility 等）上游直接断言内部工具函数行为，公开面通常无法等价构造/观测 → 大概率 B 档，如实判定。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/nodes/<name>.js`）、逐场景对拍至双端一致、登记四件套。A 档场景等价面优先选规格语义（如 Node/Element/Document 的公开成员操作），不选实现路径。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/nodes/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/nodes.json`（注意：nodes 分片由 W5–W8 四个波次共享，本波只改本波文件条目）
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/nodes/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动 `tests/happy-dom/triage/nodes.json` 中本波清单内的条目，不碰 W6–W8 的 nodes 条目。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 纯 Utility 内部函数测试无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
