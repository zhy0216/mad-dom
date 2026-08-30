//! T27 fragment differential against the pinned happy-dom (acceptance: "与锁定
//! happy-dom 的首批 fragment 场景可差分").
//!
//! `fixtures/t27_fragment_diff.json` is the first batch of fragment scenarios:
//! a 16 context x 16 input matrix (table / template / raw-text / foreign
//! namespace contexts and the "same input, different context" cases). It was
//! produced by running the *pinned* happy-dom 20.11.11 (`compat` baseline) with
//! a Bun script that sets `innerHTML` on each context element and records the
//! resulting tree (`happyDom`); the same matrix was then run through mad-dom's
//! fragment parser (`expected`, the spec-conformant html5ever output), and each
//! scenario was classified:
//!
//! * `pass` — mad-dom's output is byte-for-byte identical to happy-dom's;
//! * `known-gap` — happy-dom deviates from the WHATWG fragment-parsing
//!   algorithm (its raw-text contexts parse markup, its table contexts skip
//!   implied elements and foster parenting, and its foreign-content handling
//!   differs), so the outputs differ; the recorded `expected` tree pins the
//!   spec-conformant result.
//!
//! The test re-runs mad-dom over the whole fixture and checks both halves of
//! the ledger: `pass` scenarios must keep matching happy-dom (a regression in
//! the differential is a failure), and `known-gap` scenarios must keep
//! reproducing the recorded spec-conformant tree without silently matching
//! happy-dom (a gap that has closed must be re-classified, mirroring the
//! project's compat-ledger rules). The fixture is the only long-lived artifact;
//! the generator lives out of tree next to the pinned happy-dom baseline.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::html::{parse_html_fragment, FragmentContext};

// ---- minimal JSON parser for the fixture -----------------------------------

mod json {
    use std::fmt;

    #[derive(Debug, Clone, PartialEq)]
    pub enum Json {
        Null,
        Bool(bool),
        Num(f64),
        Str(String),
        Arr(Vec<Json>),
        Obj(Vec<(String, Json)>),
    }

    impl Json {
        pub fn as_str(&self) -> &str {
            match self {
                Json::Str(s) => s,
                other => panic!("expected string, got {other:?}"),
            }
        }

        pub fn as_arr(&self) -> &[Json] {
            match self {
                Json::Arr(a) => a,
                other => panic!("expected array, got {other:?}"),
            }
        }

        pub fn get(&self, key: &str) -> Option<&Json> {
            self.as_obj().iter().find(|(k, _)| k == key).map(|(_, v)| v)
        }

        pub fn as_obj(&self) -> &[(String, Json)] {
            match self {
                Json::Obj(o) => o,
                other => panic!("expected object, got {other:?}"),
            }
        }
    }

    pub fn parse(input: &str) -> Result<Json, String> {
        let mut p = Parser {
            bytes: input.as_bytes(),
            pos: 0,
        };
        p.skip_ws();
        let value = p.value()?;
        p.skip_ws();
        if p.pos != p.bytes.len() {
            return Err(format!("trailing data at byte {}", p.pos));
        }
        Ok(value)
    }

    struct Parser<'a> {
        bytes: &'a [u8],
        pos: usize,
    }

    impl<'a> Parser<'a> {
        fn skip_ws(&mut self) {
            while self.pos < self.bytes.len()
                && matches!(self.bytes[self.pos], b' ' | b'\t' | b'\n' | b'\r')
            {
                self.pos += 1;
            }
        }

        fn peek(&self) -> Option<u8> {
            self.bytes.get(self.pos).copied()
        }

        fn value(&mut self) -> Result<Json, String> {
            self.skip_ws();
            match self.peek().ok_or("unexpected end of input")? {
                b'{' => self.object(),
                b'[' => self.array(),
                b'"' => Ok(Json::Str(self.string()?)),
                b't' | b'f' => self.bool(),
                b'n' => self.null(),
                _ => self.number(),
            }
        }

        fn object(&mut self) -> Result<Json, String> {
            self.pos += 1;
            let mut out = Vec::new();
            loop {
                self.skip_ws();
                match self.peek().ok_or("unterminated object")? {
                    b'}' => {
                        self.pos += 1;
                        break;
                    }
                    b'"' => {
                        let key = self.string()?;
                        self.skip_ws();
                        if self.peek() != Some(b':') {
                            return Err(format!("expected ':' at byte {}", self.pos));
                        }
                        self.pos += 1;
                        let value = self.value()?;
                        out.push((key, value));
                        self.skip_ws();
                        match self.peek().ok_or("unterminated object")? {
                            b',' => self.pos += 1,
                            b'}' => {
                                self.pos += 1;
                                break;
                            }
                            other => {
                                return Err(format!("unexpected byte {other:?} at {}", self.pos))
                            }
                        }
                    }
                    other => return Err(format!("unexpected byte {other:?} at {}", self.pos)),
                }
            }
            Ok(Json::Obj(out))
        }

        fn array(&mut self) -> Result<Json, String> {
            self.pos += 1;
            let mut out = Vec::new();
            loop {
                self.skip_ws();
                match self.peek().ok_or("unterminated array")? {
                    b']' => {
                        self.pos += 1;
                        break;
                    }
                    _ => {
                        out.push(self.value()?);
                        self.skip_ws();
                        match self.peek().ok_or("unterminated array")? {
                            b',' => self.pos += 1,
                            b']' => {
                                self.pos += 1;
                                break;
                            }
                            other => {
                                return Err(format!("unexpected byte {other:?} at {}", self.pos))
                            }
                        }
                    }
                }
            }
            Ok(Json::Arr(out))
        }

        fn string(&mut self) -> Result<String, String> {
            self.pos += 1;
            let mut out = String::new();
            loop {
                let b = self.peek().ok_or("unterminated string")?;
                match b {
                    b'"' => {
                        self.pos += 1;
                        break;
                    }
                    b'\\' => {
                        self.pos += 1;
                        let esc = self.peek().ok_or("unterminated escape")?;
                        self.pos += 1;
                        match esc {
                            b'"' => out.push('"'),
                            b'\\' => out.push('\\'),
                            b'/' => out.push('/'),
                            b'b' => out.push('\u{8}'),
                            b'f' => out.push('\u{c}'),
                            b'n' => out.push('\n'),
                            b'r' => out.push('\r'),
                            b't' => out.push('\t'),
                            b'u' => {
                                let hex = self.hex4()?;
                                out.push(char::from_u32(hex).ok_or("invalid unicode escape")?);
                            }
                            other => return Err(format!("invalid escape \\{}", other as char)),
                        }
                    }
                    _ => {
                        let start = self.pos;
                        self.pos += 1;
                        out.push_str(
                            std::str::from_utf8(&self.bytes[start..self.pos])
                                .map_err(|_| "invalid utf-8")?,
                        );
                    }
                }
            }
            Ok(out)
        }

        fn hex4(&mut self) -> Result<u32, String> {
            let mut v = 0u32;
            for _ in 0..4 {
                let b = self.peek().ok_or("truncated unicode escape")?;
                self.pos += 1;
                let d = match b {
                    b'0'..=b'9' => b - b'0',
                    b'a'..=b'f' => b - b'a' + 10,
                    b'A'..=b'F' => b - b'A' + 10,
                    _ => return Err(format!("invalid hex digit {b:?}")),
                };
                v = v * 16 + d as u32;
            }
            Ok(v)
        }

        fn bool(&mut self) -> Result<Json, String> {
            if self.bytes[self.pos..].starts_with(b"true") {
                self.pos += 4;
                Ok(Json::Bool(true))
            } else if self.bytes[self.pos..].starts_with(b"false") {
                self.pos += 5;
                Ok(Json::Bool(false))
            } else {
                Err(format!("invalid literal at byte {}", self.pos))
            }
        }

        fn null(&mut self) -> Result<Json, String> {
            if self.bytes[self.pos..].starts_with(b"null") {
                self.pos += 4;
                Ok(Json::Null)
            } else {
                Err(format!("invalid literal at byte {}", self.pos))
            }
        }

        fn number(&mut self) -> Result<Json, String> {
            let start = self.pos;
            while self.pos < self.bytes.len()
                && matches!(
                    self.bytes[self.pos],
                    b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'
                )
            {
                self.pos += 1;
            }
            let text =
                std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| "invalid number")?;
            text.parse::<f64>()
                .map(Json::Num)
                .map_err(|_| format!("invalid number {text:?}"))
        }
    }

    impl fmt::Display for Json {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Json::Null => write!(f, "null"),
                Json::Bool(b) => write!(f, "{b}"),
                Json::Num(n) => write!(f, "{n}"),
                Json::Str(s) => write!(f, "{s:?}"),
                Json::Arr(a) => {
                    write!(f, "[")?;
                    for (i, v) in a.iter().enumerate() {
                        if i > 0 {
                            write!(f, ",")?;
                        }
                        write!(f, "{v}")?;
                    }
                    write!(f, "]")
                }
                Json::Obj(o) => {
                    write!(f, "{{")?;
                    for (i, (k, v)) in o.iter().enumerate() {
                        if i > 0 {
                            write!(f, ",")?;
                        }
                        write!(f, "{k:?}:{v}")?;
                    }
                    write!(f, "}}")
                }
            }
        }
    }
}

// ---- tree model shared by the mad-dom parse and the fixture -----------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tree {
    Text(String),
    Comment(String),
    Element {
        tag: String,
        ns: String,
        attrs: Vec<(String, String)>,
        children: Vec<Tree>,
    },
}

fn tree_from_document(doc: &Document, id: NodeId) -> Tree {
    let data = doc.get(id).unwrap().data();
    match data.node_type() {
        NodeType::Element => {
            let mut attrs: Vec<(String, String)> = data
                .element_attributes()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            attrs.sort();
            Tree::Element {
                tag: data.element_name().unwrap().to_string(),
                ns: data.element_namespace().unwrap().to_string(),
                attrs,
                children: doc
                    .children(id)
                    .unwrap()
                    .iter()
                    .map(|&c| tree_from_document(doc, c))
                    .collect(),
            }
        }
        NodeType::Text => Tree::Text(data.text_data().unwrap().to_string()),
        NodeType::Comment => Tree::Comment(data.comment_data().unwrap().to_string()),
        other => panic!("unexpected fragment node kind {other:?}"),
    }
}

fn tree_from_json(v: &json::Json) -> Tree {
    match v.get("t").unwrap().as_str() {
        "text" => Tree::Text(v.get("d").unwrap().as_str().to_string()),
        "comment" => Tree::Comment(v.get("d").unwrap().as_str().to_string()),
        "element" => {
            let mut attrs: Vec<(String, String)> = v
                .get("attrs")
                .unwrap()
                .as_obj()
                .iter()
                .map(|(k, val)| (k.clone(), val.as_str().to_string()))
                .collect();
            attrs.sort();
            Tree::Element {
                tag: v.get("tag").unwrap().as_str().to_string(),
                ns: v.get("ns").unwrap().as_str().to_string(),
                attrs,
                children: v
                    .get("c")
                    .unwrap()
                    .as_arr()
                    .iter()
                    .map(tree_from_json)
                    .collect(),
            }
        }
        other => panic!("unexpected fixture node kind {other:?}"),
    }
}

fn children_of(v: &json::Json) -> Vec<Tree> {
    v.as_arr().iter().map(tree_from_json).collect()
}

// ---- differential ----------------------------------------------------------

#[test]
fn first_batch_fragment_scenarios_diff_against_happy_dom() {
    let fixture = json::parse(include_str!("fixtures/t27_fragment_diff.json")).unwrap();
    let scenarios = fixture.as_arr();

    let mut pass = 0usize;
    let mut known_gap = 0usize;
    let mut failures = Vec::new();

    for sc in scenarios {
        let context = sc.get("context").unwrap().as_str();
        let ns = sc.get("ns").unwrap().as_str();
        let input = sc.get("input").unwrap().as_str();
        let status = sc.get("status").unwrap().as_str();
        let happy_dom = children_of(sc.get("happyDom").unwrap());
        let expected = children_of(sc.get("expected").unwrap());

        let ctx = FragmentContext {
            name: context,
            namespace: ns,
            attributes: &[],
            allows_scripting: true,
        };
        let parsed = parse_html_fragment(input, &ctx).unwrap();
        let our: Vec<Tree> = parsed
            .nodes
            .iter()
            .map(|&n| tree_from_document(&parsed.document, n))
            .collect();

        // Every scenario must reproduce the recorded spec-conformant output.
        if our != expected {
            failures.push(format!(
                "{context} ({ns}) {input:?}: output drifted from the recorded expected tree"
            ));
        }

        match status {
            "pass" => {
                if our != happy_dom {
                    failures.push(format!(
                        "{context} ({ns}) {input:?}: recorded pass but output no longer matches happy-dom"
                    ));
                }
                pass += 1;
            }
            "known-gap" => {
                if our == happy_dom {
                    failures.push(format!(
                        "{context} ({ns}) {input:?}: recorded known-gap but output now matches happy-dom \
                         — re-classify this scenario to pass"
                    ));
                }
                known_gap += 1;
            }
            other => failures.push(format!(
                "scenario {context} {input:?}: unknown status {other:?}"
            )),
        }
    }

    // First batch scope: the recorded matrix is non-trivial in both halves.
    assert!(
        pass >= 100,
        "expected a substantial first batch of pass scenarios, got {pass}"
    );
    assert!(
        known_gap >= 100,
        "expected a substantial set of recorded gaps, got {known_gap}"
    );

    assert!(
        failures.is_empty(),
        "{} differential failure(s) out of {} scenarios:\n{}",
        failures.len(),
        scenarios.len(),
        failures.join("\n")
    );
}

#[test]
fn canonical_context_differences_are_pass_scenarios() {
    // The core "same input, different context" acceptance cases must be exact
    // differential matches with happy-dom: table row markup in div vs table
    // contexts, entity expansion, comments and plain text.
    let fixture = json::parse(include_str!("fixtures/t27_fragment_diff.json")).unwrap();
    let scenarios = fixture.as_arr();

    let canonical = [
        ("div", "<tr><td>cell</td></tr>"),
        ("table", "<tr><td>cell</td></tr>"),
        ("tbody", "<tr><td>cell</td></tr>"),
        ("div", "<b>bold</b> and <i>italic</i>"),
        ("div", "a &amp; b < c"),
        ("div", "<!-- comment -->text"),
        ("div", "<table><tr><td>in</td></tr></table>"),
        ("div", "<template><p>inner</p></template>"),
        ("script", "plain text"),
    ];

    for (context, input) in canonical {
        let sc = scenarios
            .iter()
            .find(|s| {
                s.get("context").unwrap().as_str() == context
                    && s.get("input").unwrap().as_str() == input
            })
            .unwrap_or_else(|| panic!("scenario {context} {input:?} missing from fixture"));
        assert_eq!(
            sc.get("status").unwrap().as_str(),
            "pass",
            "{context} {input:?} must be a differential pass with happy-dom"
        );
    }
}

#[test]
fn canonical_happy_dom_deviations_are_recorded_gaps() {
    // The known happy-dom deviations from the WHATWG algorithm stay recorded
    // as known-gaps: raw-text contexts parse markup, table contexts skip
    // implied elements / foster parenting, and foreign-content handling
    // differs.
    let fixture = json::parse(include_str!("fixtures/t27_fragment_diff.json")).unwrap();
    let scenarios = fixture.as_arr();

    let canonical = [
        // script context: happy-dom parses markup instead of keeping raw text.
        ("script", "<script>if (a < b) { x(); }</script>"),
        // textarea context: RCDATA markup kept literal by mad-dom, parsed by happy-dom.
        ("textarea", "<textarea><b>x</b> &amp; y</textarea>"),
        // table context: bare td gets implied tbody/tr (mad-dom) vs flattened (happy-dom).
        ("table", "<td>cell</td>"),
        // table context: phrasing content is fostered out (mad-dom) vs flattened (happy-dom).
        ("table", "<div>a<p>b</div>c"),
        // foreign content: svg context keeps <div> breakout to HTML (mad-dom) vs SVG (happy-dom).
        ("svg", "<div>a<p>b</div>c"),
    ];

    for (context, input) in canonical {
        let sc = scenarios
            .iter()
            .find(|s| {
                s.get("context").unwrap().as_str() == context
                    && s.get("input").unwrap().as_str() == input
            })
            .unwrap_or_else(|| panic!("scenario {context} {input:?} missing from fixture"));
        assert_eq!(
            sc.get("status").unwrap().as_str(),
            "known-gap",
            "{context} {input:?} must remain a recorded known-gap"
        );
    }
}
