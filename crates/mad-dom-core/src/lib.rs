pub mod arena;
pub mod dom;
pub mod error;
pub mod html;
pub mod selectors;
pub mod serialize;
pub mod traversal;

pub fn core_identity() -> &'static str {
    "mad-dom-core"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanity() {
        assert_eq!(core_identity(), "mad-dom-core");
    }
}
