//! T05 spike：验证 HTML 解析器可直接写入自定义槽位存储、选择器可在同一存储上
//! 匹配，并对比两种字符串存储方案。
//!
//! 本 crate 是隔离原型（与 [spikes/native-binding](../../native-binding) 相同的
//! workspace-exclude 模式），仅服务于 [T05](../../todos/05-parser-selector-string-adr.md)
//! 与 [ADR-0004](../../adr/0004-parser-selector-and-string-storage.md)。
//! 生产 arena 属于 T12/T13（代际句柄、槽位复用），生产解析/选择器模块属于
//! T26–T31；这里的代码不直接迁移。
//!
//! 模块：
//! - [`store`]：最小 Vec 槽位存储（原型，无代际句柄）。
//! - [`parse`]：html5ever `TreeSink` 实现，把解析结果直接写入 [`store`]，
//!   覆盖 document / fragment + 上下文元素。
//! - [`selector`]：`selectors` crate 的最小 `SelectorImpl` / `Element` 实现，
//!   在同一份 spike 树上做匹配（tag / class / id / 组合器 / namespace）。
//! - [`strings`]：owned String 存储与 interning 表的最小对比。
//!
//! 运行：`npm run spike2:build` / `npm run spike2:test`
//! （即 `cd spikes/parser-selector-string && cargo build/test`）。

pub mod parse;
pub mod selector;
pub mod store;
pub mod strings;
