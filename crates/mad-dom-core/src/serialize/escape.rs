//! Text and attribute escaping for the HTML serializer (T28).
//!
//! Implements the WHATWG "escaping a string" steps of the HTML fragment
//! serialization algorithm: `&` → `&amp;`, U+00A0 → `&nbsp;`, `<` → `&lt;`,
//! `>` → `&gt;`; attribute mode additionally escapes `"` → `&quot;` (attribute
//! values are always emitted double-quoted).

/// Writes `text` escaped for element text content.
pub(crate) fn write_escaped_text(out: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '\u{00A0}' => out.push_str("&nbsp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
}

/// Writes `value` escaped for a double-quoted attribute value.
pub(crate) fn write_escaped_attr(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '\u{00A0}' => out.push_str("&nbsp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_escaping_matches_whatwg() {
        let mut out = String::new();
        write_escaped_text(&mut out, "a & b < c > d \u{00A0} e");
        assert_eq!(out, "a &amp; b &lt; c &gt; d &nbsp; e");
    }

    #[test]
    fn text_escaping_leaves_ordinary_characters_alone() {
        let mut out = String::new();
        write_escaped_text(&mut out, "plain ünïcode 中文 \"'");
        assert_eq!(out, "plain ünïcode 中文 \"'");
    }

    #[test]
    fn attribute_escaping_also_escapes_the_quote() {
        let mut out = String::new();
        write_escaped_attr(&mut out, "a & b < c > d \" e \u{00A0}");
        assert_eq!(out, "a &amp; b &lt; c &gt; d &quot; e &nbsp;");
    }
}
