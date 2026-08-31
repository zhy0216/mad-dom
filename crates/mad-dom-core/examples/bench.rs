//! T50 performance / memory baseline benchmark for mad-dom-core.
//!
//! Measures the Core-side workloads the stable gate tracks (plan §6): arena
//! allocation/removal/reuse throughput and capacity retention, the unified
//! mutation API, HTML parsing and serialization throughput, and selector
//! cold/hot query latency. It reports a machine-readable JSON document
//! (`mad-dom-core-bench/1`) that `scripts/bench.mjs` merges with the FFI/GC
//! bench and gates against `bench/baseline.json`.
//!
//! Timing is wall-clock over fixed-size workloads with enough iterations to be
//! stable; the gate uses generous relative thresholds so single-run noise does
//! not fail CI. Run with `--release` for meaningful numbers:
//!
//! ```text
//! cargo run --release -p mad-dom-core --example bench -- --json
//! ```

use std::time::Instant;

use mad_dom_core::arena::{Arena, NodeId};
use mad_dom_core::dom::{Document, Node};
use mad_dom_core::html;
use mad_dom_core::serialize;

/// Sections in the benchmark document (same shape as the T32 query bench).
const SECTIONS: usize = 40;
/// Div rows per section.
const ROWS: usize = 500;

/// Fixed medium HTML corpus for parse/serialize throughput.
const HTML_CORPUS: &str = "<!doctype html><html><head><title>bench</title></head>\
<body><main><section class=\"card\"><h2>Title</h2>\
<p class=\"lead\">intro <em>text</em></p><ul>\
<li data-id=\"1\">one</li><li data-id=\"2\">two</li>\
<li data-id=\"3\">three</li></ul>\
</section><section class=\"card\"><p>second</p></section></main></body></html>";

/// Measures `f` over `iterations` fresh runs; `f` returns the number of
/// operations it performed, and the result is the aggregate ops/s rate.
fn rate_per_sec(iterations: usize, f: impl FnMut() -> usize) -> f64 {
    let start = Instant::now();
    let mut f = f;
    let mut ops = 0usize;
    for _ in 0..iterations {
        ops += f();
    }
    let secs = start.elapsed().as_secs_f64();
    if secs == 0.0 {
        f64::INFINITY
    } else {
        ops as f64 / secs
    }
}

/// Arena alloc/remove/reuse throughput plus capacity retention.
fn bench_arena() -> (f64, f64, f64, f64) {
    const N: usize = 200_000;
    let alloc = rate_per_sec(8, || {
        let mut arena: Arena<u64> = Arena::new();
        for i in 0..N {
            arena.allocate(0, i as u64);
        }
        N
    });

    let remove = rate_per_sec(8, || {
        let mut arena: Arena<u64> = Arena::new();
        let ids: Vec<NodeId> = (0..N).map(|i| arena.allocate(0, i as u64)).collect();
        for id in &ids {
            let _ = arena.remove(*id);
        }
        N
    });

    // alloc -> remove half -> realloc (slot reuse churn).
    let reuse = rate_per_sec(8, || {
        let mut arena: Arena<u64> = Arena::new();
        let ids: Vec<NodeId> = (0..N).map(|i| arena.allocate(0, i as u64)).collect();
        for id in ids.iter().step_by(2) {
            let _ = arena.remove(*id);
        }
        for _ in 0..(N / 2) {
            arena.allocate(0, 1);
        }
        N + N / 2
    });

    // Capacity retention after removing half of N: the arena should not grow
    // unboundedly during the reuse churn above.
    let mut arena: Arena<u64> = Arena::new();
    let ids: Vec<NodeId> = (0..N).map(|i| arena.allocate(0, i as u64)).collect();
    for id in ids.iter().step_by(2) {
        let _ = arena.remove(*id);
    }
    let capacity_after = arena.capacity() as f64;
    let retention_ratio = capacity_after / N as f64;

    (alloc, remove, reuse, retention_ratio)
}

/// Builds the standard benchmark document (query_bench shape) and returns it
/// with the document root.
fn build_document() -> Document {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let body = doc.document_body().unwrap().unwrap();
    for section in 0..SECTIONS {
        let sec = doc.create_element("section").unwrap();
        doc.set_attribute(sec, "class", "section").unwrap();
        doc.append_child(body, sec).unwrap();
        for row in 0..ROWS {
            let div = doc.create_element("div").unwrap();
            doc.set_attribute(div, "id", &format!("r{section}-{row}"))
                .unwrap();
            doc.set_attribute(div, "class", &format!("row r{section}"))
                .unwrap();
            doc.append_child(sec, div).unwrap();
        }
        let span = doc.create_element("span").unwrap();
        doc.set_attribute(span, "class", "sprocket").unwrap();
        doc.append_child(sec, span).unwrap();
    }
    doc
}

/// Mutation API throughput: append, remove and attribute writes.
fn bench_mutation() -> (f64, f64, f64) {
    const N: usize = 50_000;

    let append = rate_per_sec(8, || {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        for _ in 0..N {
            let child = doc.create_element("span").unwrap();
            doc.append_child(parent, child).unwrap();
        }
        N
    });

    let remove = rate_per_sec(8, || {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let children: Vec<NodeId> = (0..N)
            .map(|_| {
                let child = doc.create_element("span").unwrap();
                doc.append_child(parent, child).unwrap();
                child
            })
            .collect();
        for child in &children {
            doc.remove_child(parent, *child).unwrap();
        }
        N
    });

    let attr = rate_per_sec(8, || {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        for i in 0..N {
            doc.set_attribute(el, "data-i", &format!("{i}")).unwrap();
        }
        N
    });

    (append, remove, attr)
}

/// Parser + serializer throughput over the fixed corpus.
fn bench_parse_serialize() -> (f64, f64, f64, f64) {
    const N: usize = 4_000;
    let parse = rate_per_sec(N, || {
        let _ = html::parse_html_document(HTML_CORPUS);
        1
    });

    let serialize = rate_per_sec(N, || {
        let parsed = html::parse_html_document(HTML_CORPUS).unwrap();
        let root = parsed.root;
        let _ = serialize::serialize_children(&parsed.document, root);
        1
    });

    let parsed = html::parse_html_document(HTML_CORPUS).unwrap();
    let root = parsed.root;
    let html_len = serialize::serialize_children(&parsed.document, root)
        .unwrap()
        .len();
    let parse_bytes = parse * html_len as f64;
    let serialize_bytes = serialize * html_len as f64;

    (parse, parse_bytes, serialize, serialize_bytes)
}

/// Selector throughput: cold traversal (index disabled) vs the id/class/tag
/// query index, plus `matches`.
fn bench_selectors() -> (f64, f64, f64) {
    let mut doc = build_document();
    let root = doc.document_root();
    const Q: usize = 2_000;
    let _ = root;

    // Cold: no index, a full traversal per query.
    let cold = rate_per_sec(Q, || {
        let _ = doc.get_elements_by_class_name(root, "row");
        1
    });

    // Hot: index enabled (one rebuild), repeated id lookups served from it.
    doc.set_query_index_enabled(true).unwrap();
    let hot = rate_per_sec(20_000, || {
        let _ = doc.get_element_by_id("r7-42");
        1
    });

    let matches = rate_per_sec(20_000, || {
        let _ = doc.matches(root, ".row");
        1
    });

    (cold, hot, matches)
}

/// Node payload size (bytes per node) and document node count for the
/// standard bench document — the Core-side memory baseline.
fn bench_memory() -> (usize, usize) {
    let mut doc = build_document();
    let bytes_per_node = std::mem::size_of::<Node>();
    // Count live nodes by walking the tree through the public API.
    let root = doc.document_root();
    let mut stack = vec![root];
    let mut count = 0usize;
    while let Some(id) = stack.pop() {
        count += 1;
        for child in doc.children(id).unwrap() {
            stack.push(child);
        }
    }
    (bytes_per_node, count)
}

fn main() {
    let json = std::env::args().any(|arg| arg == "--json");
    let host = std::env::consts::OS.to_string();

    let (a_alloc, a_remove, a_reuse, a_retention) = bench_arena();
    let (m_append, m_remove, m_attr) = bench_mutation();
    let (p_parse, p_parse_bytes, p_ser, p_ser_bytes) = bench_parse_serialize();
    let (s_cold, s_hot, s_matches) = bench_selectors();
    let (mem_bytes, mem_nodes) = bench_memory();

    let metrics = [
        ("arena_alloc_ops_s", a_alloc),
        ("arena_remove_ops_s", a_remove),
        ("arena_reuse_ops_s", a_reuse),
        ("arena_capacity_retention_ratio", a_retention),
        ("mutation_append_ops_s", m_append),
        ("mutation_remove_ops_s", m_remove),
        ("mutation_attr_ops_s", m_attr),
        ("parser_ops_s", p_parse),
        ("parser_bytes_s", p_parse_bytes),
        ("serializer_ops_s", p_ser),
        ("serializer_bytes_s", p_ser_bytes),
        ("selector_cold_ops_s", s_cold),
        ("selector_hot_ops_s", s_hot),
        ("selector_matches_ops_s", s_matches),
    ];

    if json {
        let node_bytes = mem_bytes.to_string();
        let node_count = mem_nodes.to_string();
        let rows: Vec<String> = metrics
            .iter()
            .map(|(name, value)| format!("    {name:?}: {value:?}"))
            .collect();
        println!(
            "{{\n  \"schema\": \"mad-dom-core-bench/1\",\n  \"host\": {host:?},\n  \
             \"node_bytes_per_node\": {node_bytes},\n  \"bench_doc_nodes\": {node_count},\n  \"metrics\": {{\n{}\n  }}\n}}",
            rows.join(",\n")
        );
    } else {
        println!("mad-dom-core benchmark (T50)");
        println!("host: {host} · arena churn capacity retention ratio: {a_retention:.3}");
        println!("per-node payload: {mem_bytes} bytes · bench document: {mem_nodes} nodes");
        println!();
        for (name, value) in metrics {
            println!("  {name:<32} {value:>14.1}");
        }
    }
}
