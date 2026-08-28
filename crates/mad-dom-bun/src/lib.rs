pub fn binding_identity() -> &'static str {
    "mad-dom-bun"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanity() {
        assert_eq!(binding_identity(), "mad-dom-bun");
        assert_eq!(mad_dom_core::core_identity(), "mad-dom-core");
    }
}
