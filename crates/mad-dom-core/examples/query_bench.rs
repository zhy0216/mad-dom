//! T32 query benchmark: the no-index traversal baseline vs the optional
//! id/class/tag query index.
//!
//! Builds a large document once through the mutation API, then measures the
//! wall-clock time of `QUERIES` repeated lookups — `getElementById`,
//! `getElementsByTagName` (a common tag and a rare tag) and
//! `getElementsByClassName` — first with the index disabled (a fresh traversal
//! per query) and then with it enabled (served from the index). It also
//! reports the document build cost with and without incremental index
//! maintenance, so the read-side gain is weighed against the write-side cost.
//!
//! The reported numbers are the T32 evidence that the index is worth enabling
//! on read-heavy workloads: id lookups drop from a full traversal to a hash
//! lookup, and rare tag/class queries from a full traversal to a key-list
//! copy. Run with `--release` for meaningful timings:
//!
//! ```text
//! cargo run --release -p mad-dom-core --example query_bench
//! ```

use std::time::Instant;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::Document;

/// Number of sections, each carrying `ROWS` div elements plus one span.
const SECTIONS: usize = 40;
/// Div rows per section.
const ROWS: usize = 500;
/// How many repeated lookups each measured query is batched into.
const QUERIES: usize = 2000;
/// Number of lookups in the id micro-batch.
const ID_QUERIES: usize = 20_000;

/// Total element count of the benchmark document.
fn total_elements() -> usize {
    SECTIONS * (ROWS + 1) + 2 // 2 = the html skeleton's head + body
}

/// Builds the benchmark document. Every section is a `<section class="section">`
/// whose children are `ROWS` `<div class="row r{section}">` elements with a
/// unique `id` and one `<span class="sprocket">` element, so tag and class
/// queries exercise both dense keys (`div`, `row`) and sparse keys (`span`,
/// `sprocket`). Building goes through the mutation API; when `indexed` is set
/// the index is enabled on the finished tree (one document-order rebuild), the
/// realistic "enable the index on an existing document" pattern.
fn build(indexed: bool) -> Document {
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
    if indexed {
        doc.set_query_index_enabled(true).unwrap();
    }
    doc
}

/// Runs the measured query batches against `doc` and returns the elapsed
/// `(id, tag-dense, tag-sparse, class-dense, class-sparse)` timings in
/// milliseconds.
fn measure(doc: &Document, root: NodeId) -> (f64, f64, f64, f64, f64) {
    // getElementById: 20k lookups of existing ids.
    let start = Instant::now();
    for i in 0..ID_QUERIES {
        let section = i % SECTIONS;
        let row = i % ROWS;
        let _ = doc.get_element_by_id(&format!("r{section}-{row}"));
    }
    let id_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    for _ in 0..QUERIES {
        let _ = doc.get_elements_by_tag_name(root, "div");
    }
    let tag_dense_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    for _ in 0..QUERIES {
        let _ = doc.get_elements_by_tag_name(root, "span");
    }
    let tag_sparse_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    for _ in 0..QUERIES {
        let _ = doc.get_elements_by_class_name(root, "row");
    }
    let class_dense_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    for _ in 0..QUERIES {
        let _ = doc.get_elements_by_class_name(root, "sprocket");
    }
    let class_sparse_ms = start.elapsed().as_secs_f64() * 1e3;

    (
        id_ms,
        tag_dense_ms,
        tag_sparse_ms,
        class_dense_ms,
        class_sparse_ms,
    )
}

fn main() {
    println!("mad-dom query benchmark (T32): traversal vs optional id/class/tag index");
    println!(
        "document: {} sections x {} divs + 1 span each => {} elements",
        SECTIONS,
        ROWS,
        total_elements()
    );
    println!("batches: {ID_QUERIES} x getElementById, {QUERIES} x each getElementsBy*");
    println!();

    let (mut plain, b0) = build_timed(false);
    let root = plain.document_root();
    let (id0, td0, ts0, cd0, cs0) = measure(&plain, root);

    let (mut indexed_doc, b1) = build_timed(true);
    let root = indexed_doc.document_root();
    let (id1, td1, ts1, cd1, cs1) = measure(&indexed_doc, root);

    let row = |name: &str, traversal: f64, indexed: f64| {
        let speedup = if indexed > 0.0 {
            traversal / indexed
        } else {
            f64::INFINITY
        };
        println!(
            "  {name:<28} traversal {:>10.2} ms   indexed {:>10.2} ms   speedup {:>7.2}x",
            traversal, indexed, speedup
        );
    };

    println!("build (indexed = build + one document-order rebuild):");
    row("build", b0, b1);
    println!();
    println!("queries (read-heavy, tree stable):");
    row("getElementById (20k)", id0, id1);
    row("getElementsByTagName div (dense)", td0, td1);
    row("getElementsByTagName span (sparse)", ts0, ts1);
    row("getElementsByClassName row (dense)", cd0, cd1);
    row("getElementsByClassName sprocket (sparse)", cs0, cs1);
}

/// Builds the document and returns it with the elapsed build time.
fn build_timed(indexed: bool) -> (Document, f64) {
    let start = Instant::now();
    let doc = build(indexed);
    let ms = start.elapsed().as_secs_f64() * 1e3;
    (doc, ms)
}
