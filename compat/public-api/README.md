# public-api：happy-dom 公开 API 快照

本目录实现 [ADR-0002 第 3 节](../../adr/0002-happy-dom-compatibility-baseline-and-differential-protocol.md)的公开 API 快照协议（[T08](../../todos/08-public-api-snapshot.md)）：对锁定版本 happy-dom `20.11.11` 的包入口导出做确定性采集，生成可逐字节重现的 `snapshot.json`，并用比较器按固定差异类别判定兼容性。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `collector.js` | 采集器，运行在隔离子进程中，只 `import` 命令行给定的模块入口（对基线快照即公共 specifier `happy-dom`，绝不 import `happy-dom/lib/**` 等深层模块），把 JSON 文档写到指定文件 |
| `generate-snapshot.js` | 生成器：校验安装版本与基线一致后，spawn `bun collector.js happy-dom <tmp>` 隔离加载 happy-dom，读取采集结果，补上 `meta`，写出 `snapshot.json` |
| `snapshot.json` | 提交的初始快照（200 个导出：192 类、6 枚举、1 常量对象、1 symbol 对象） |
| `compare-snapshot.js` | 比较器库（纯函数，无副作用）：递归结构化比较，输出 ADR-0002 第 3 节的四种差异类别与首个差异路径 |
| `compare-snapshot-cli.js` | 比较器 CLI：`bun compare-snapshot-cli.js <expected.json> <actual.json> [--strict]`，硬差异 exit 1，informational-only exit 0 |

测试与自测 fixture 在 [`tests/compat/`](../../tests/compat/)（`fake-dom.mjs` / `fake-dom-modified.mjs` 合成模块）。

## 快照内容

- `meta`：`schemaVersion`、`generator`（mad-dom 名称 + 版本，来自 package.json）、`baseline`（指向 `compat/happy-dom-baseline.json` 的引用：happy-dom npm 版本、40 位上游 commit、tag、Bun 版本）、`target`（specifier 与安装版本）。meta 不含任何时间戳类易变字段——重生成必须逐字节稳定。
- `exports.<名称>`：每个入口导出的 `typeOf`、`category`（class / function / enum / constant-object / symbol-object / primitive / array）、命名空间可枚举性；类与函数含 `length`（arity）、`name`、`prototypeChain`（沿 `Object.getPrototypeOf` 至 null 的原型类名序列）、`constructorChain`、自有属性名（排序）与描述符形状（`writable`/`enumerable`/`configurable`/accessor 的 get、set 存在性/data 值的 `valueType`，绝不调用 getter）；类含零参构造结果 `construction`（constructible 时记录实例自有键、描述符形状与可序列化默认值 `instanceDefaults`；抛错时记 `not-constructible` + 错误名）；枚举/常量对象记录键与可 JSON 序列化的值及 `frozen`/`sealed`/`extensible`。

## 规范化与排除规则（为什么重生成无无意义 diff）

1. **函数体不序列化**：函数以存在性 + `typeof` + `length` + `name` 表达；native code 不比较。
2. **getter/setter 不调用**：accessor 只记录描述符形状（`hasGetter`/`hasSetter` 布尔），防副作用。
3. **描述符归约为形状**：不比较值引用，只比较 `writable`/`enumerable`/`configurable`/get、set 存在性/数据属性值的 `typeof`。
4. **值序列化白名单**：原始值（`NaN`/`±Infinity`/`-0`/`bigint`/`undefined` 以 `~` 前缀标签保真）与受限深度的纯对象/稠密数组才序列化；类实例、Date、Map、Set、宿主对象、循环引用一律排除（键名保留在 `instanceNonSerializableKeys`）。
5. **symbol 仅 informational**（ADR-0002 第 2 节）：所有 symbol 键（含 `PropertySymbol` 的 417 个键）按 `String(symbol)` 排序记录描述符形状，记录存在性但不作硬性门禁；同描述符号碰撞时加 ` #n` 后缀。
6. **全部键排序**、无时间戳/pid/随机值；`meta` 只有生成器版本、基线引用与 schema 版本。宿主相关字符串归一化为固定 token：宿主平台标签（如 happy-dom 默认 `navigator.userAgent` 内嵌的 `Linux arm64`/`Darwin arm64`）→ `<host-os>`，仓库绝对路径（如构造期捕获的 `DOMException` `sourceURL`/`stack`）→ `<repo>`，保证跨机器、跨操作系统逐字节稳定。
7. **分类规则**：函数当且仅当自有 `prototype` 不可写不可配置且 `prototype.constructor` 回指自身时归为 class（不调用函数即可判定）；自有字符串键值全为原始值的对象按导出名是否以 enum 结尾（大小写不敏感）归为 `enum`/`constant-object`；自有值全为 symbol 的对象归为 `symbol-object`。
8. 静态/原型成员只记录名称与描述符形状，不记录静态值——常量值以独立导出（枚举/常量对象）形式入快照。

## 使用

```sh
# 重新生成快照（需 node_modules 中安装精确版本 happy-dom@20.11.11）
npm run compat:snapshot            # 或 bun compat/public-api/generate-snapshot.js [--out <path>]

# 比较两份快照
bun compat/public-api/compare-snapshot-cli.js compat/public-api/snapshot.json <other.json>
bun compat/public-api/compare-snapshot-cli.js a.json b.json --strict   # informational 差异也算失败

# 快照管线自测（fixture 确定性、重生成等价、比较器敏感性、篡改检测）
npm run compat:snapshot:test       # 或 bun test tests/compat
```

## 比较器敏感性

比较器把差异分为 ADR-0002 第 3 节的固定类别：`missing`（期望有实际无，硬失败）、`extra`（实际多出，默认记录可见不判死，`--strict` 下判死）、`shape-mismatch`（结构不同：typeof/类别/原型链/描述符形状/成员集合/meta）、`value-mismatch`（可序列化值不同：枚举值、导出原始值、实例默认值）。symbol 路径（`*Symbols`/`symbols`/`symbolValues`）下的差异标记 `informational: true`，默认不触发硬失败。`tests/compat/public-api-snapshot.test.js` 用 `fake-dom-modified.mjs`（加导出、删原型方法、accessor 改方法、改枚举值、改实例默认值）与 `/tmp` 篡改副本验证每一类都能被发现并报告首个差异路径。

## schema 版本

快照 `meta.schemaVersion` 当前为 `1.0.0`。任何输出结构变化（新增/删除/重命名字段、分类规则变化）都必须升版本并在本节记录；基线升级时按 ADR-0002 第 9 节在同一独立提交中重生成快照并恢复门禁。
