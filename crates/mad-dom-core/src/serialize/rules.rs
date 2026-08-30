//! Element-classification rules the serializer needs (T28).
//!
//! Two HTML5 rules drive serialization, both applying only to HTML-namespace
//! elements:
//!
//! * *void elements* — an element in the "serializes as void" set emits only a
//!   start tag: no children and no end tag;
//! * *raw text elements* — the text children of a `style`/`script`/`xmp`/
//!   `iframe`/`noembed`/`noframes`/`plaintext` element are written literally
//!   instead of escaped, and a `noscript` element joins the set while scripting
//!   is enabled (WHATWG "serialising HTML fragments").
//!
//! Names are matched ASCII-case-insensitively, so the rules hold for
//! parser-built (lowercase) names and for programmatically created elements
//! with other casings.

use crate::dom::HTML_NAMESPACE;

/// The element names that "serialize as void" (WHATWG §13.3): the void
/// elements plus the legacy `basefont`/`bgsound`/`frame`/`keygen`/`param`.
const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "input",
    "keygen", "link", "meta", "param", "source", "track", "wbr",
];

/// The raw text elements whose text children are written literally.
const RAW_TEXT_ELEMENTS: &[&str] = &[
    "style",
    "script",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
];

/// Returns whether an element "serializes as void". Only HTML-namespace
/// elements can be void; foreign (SVG/MathML) elements always get an end tag.
pub(crate) fn is_void_element(namespace: &str, name: &str) -> bool {
    namespace == HTML_NAMESPACE && VOID_ELEMENTS.iter().any(|v| name.eq_ignore_ascii_case(v))
}

/// Returns whether the text children of `name` are written literally.
pub(crate) fn is_raw_text_element(namespace: &str, name: &str, scripting_enabled: bool) -> bool {
    namespace == HTML_NAMESPACE
        && (RAW_TEXT_ELEMENTS
            .iter()
            .any(|r| name.eq_ignore_ascii_case(r))
            || (scripting_enabled && name.eq_ignore_ascii_case("noscript")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::{MATHML_NAMESPACE, SVG_NAMESPACE};

    #[test]
    fn void_elements_are_the_whatwg_set() {
        for name in [
            "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img",
            "input", "keygen", "link", "meta", "param", "source", "track", "wbr",
        ] {
            assert!(is_void_element(HTML_NAMESPACE, name), "{name} must be void");
        }
        for name in ["div", "span", "p", "template", "svg"] {
            assert!(
                !is_void_element(HTML_NAMESPACE, name),
                "{name} must not be void"
            );
        }
    }

    #[test]
    fn void_rules_are_case_insensitive_and_html_only() {
        assert!(is_void_element(HTML_NAMESPACE, "BR"));
        assert!(
            !is_void_element(SVG_NAMESPACE, "br"),
            "foreign elements never void"
        );
        assert!(!is_void_element(MATHML_NAMESPACE, "img"));
    }

    #[test]
    fn raw_text_elements_apply_to_html_namespace_only() {
        for name in [
            "style",
            "script",
            "xmp",
            "iframe",
            "noembed",
            "noframes",
            "plaintext",
        ] {
            assert!(is_raw_text_element(HTML_NAMESPACE, name, true));
            assert!(is_raw_text_element(HTML_NAMESPACE, name, false));
        }
        // Foreign elements are never raw text, even with an HTML-like name.
        assert!(!is_raw_text_element(SVG_NAMESPACE, "script", true));
        assert!(!is_raw_text_element(MATHML_NAMESPACE, "style", true));
    }

    #[test]
    fn noscript_depends_on_scripting() {
        assert!(is_raw_text_element(HTML_NAMESPACE, "noscript", true));
        assert!(!is_raw_text_element(HTML_NAMESPACE, "noscript", false));
    }
}
