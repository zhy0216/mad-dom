//! Tree invariant checker (T14).
//!
//! This module implements [`Document::check_invariants`], a test-callable
//! verifier that walks the tree reachable from a given root and checks the
//! invariants the mutation API (T15/T16) must maintain:
//!
//! * the parent↔child relation is bidirectional and consistent;
//! * the sibling chain between `first_child` and `last_child` is coherent
//!   (`previous_sibling`/`next_sibling` mirror each other);
//! * sibling chains are acyclic and no node is reached twice from the root;
//! * every relation field points at a live node of the same document.
//!
//! The walk is an iterative DFS with a visited set, so arbitrarily deep trees
//! cannot overflow the call stack. Besides the document module itself, only
//! the unified mutation API (`mutation` module) and in-crate tests consume the
//! raw relation fields; the public API exposes no way to write those fields.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::Document;

use std::collections::HashSet;
use std::error::Error;
use std::fmt;

/// A violation of the tree invariants over the subtree reachable from a root.
///
/// Every variant is *specific*: it names the node (and, where relevant, the
/// relation partner) involved in the broken invariant, so a test or a future
/// mutation API can pinpoint the corrupt link instead of merely learning that
/// the tree is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeViolation {
    /// A handle in a relation field (or the root handle itself) carries a
    /// document id different from the owning document's.
    WrongDocument { id: NodeId },
    /// The relation field of `holder` points at `target`, which is not a live
    /// node in this document's arena (stale or out-of-bounds handle).
    DanglingRelation { holder: NodeId, target: NodeId },
    /// The supplied root has a parent, so it is not a genuine tree root.
    RootHasParent { node: NodeId },
    /// `parent` lists `child` in its child chain, but `child`'s `parent` field
    /// points at a *different* node (a broken back-pointer). Note that a child
    /// whose `parent` is `None` is reported as [`TreeViolation::OrphanChild`].
    ParentChildMismatch { parent: NodeId, child: NodeId },
    /// `node` is listed as a child of some parent, but its own `parent` field
    /// is `None` (and it is not the root): the node is detached from its
    /// back-pointer.
    OrphanChild { node: NodeId },
    /// The `previous_sibling`/`next_sibling` pair between `node` and `sibling`
    /// does not mirror itself (for example `node.next == sibling` but
    /// `sibling.previous != node`, or a non-first child has a previous sibling
    /// outside the chain).
    SiblingMismatch { node: NodeId, sibling: NodeId },
    /// Following `next_sibling` from `node` revisits an earlier node of the
    /// same chain, so the sibling chain contains a cycle.
    SiblingCycle { node: NodeId },
    /// The child chain between `first_child` and `last_child` of `node` is
    /// inconsistent: either one is set without the other, or the chain does not
    /// end at `last_child`.
    FirstLastMismatch { node: NodeId },
    /// `node` is reachable from the root more than once (for example because
    /// two different parents list it as a child), so the reachable subgraph is
    /// not a tree.
    DuplicateReach { node: NodeId },
}

impl fmt::Display for TreeViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongDocument { id } => {
                write!(f, "handle {id} belongs to another document")
            }
            Self::DanglingRelation { holder, target } => {
                write!(f, "relation of {holder} points at non-live node {target}")
            }
            Self::RootHasParent { node } => {
                write!(f, "root {node} has a parent")
            }
            Self::ParentChildMismatch { parent, child } => {
                write!(
                    f,
                    "parent {parent} lists {child}, but {child}.parent points elsewhere"
                )
            }
            Self::OrphanChild { node } => {
                write!(f, "child {node} has no parent back-pointer")
            }
            Self::SiblingMismatch { node, sibling } => {
                write!(
                    f,
                    "sibling link between {node} and {sibling} is inconsistent"
                )
            }
            Self::SiblingCycle { node } => {
                write!(f, "sibling chain starting at {node} contains a cycle")
            }
            Self::FirstLastMismatch { node } => {
                write!(f, "first_child/last_child chain of {node} is inconsistent")
            }
            Self::DuplicateReach { node } => {
                write!(f, "node {node} is reached more than once from the root")
            }
        }
    }
}

impl Error for TreeViolation {}

impl Document {
    /// Verifies the tree invariants over the subtree reachable from `root`.
    ///
    /// Returns `Ok(())` when every invariant holds, or the first
    /// [`TreeViolation`] encountered. `root` must be a live node of this
    /// document and must not have a parent of its own; the walk is iterative so
    /// arbitrarily deep trees are supported.
    pub fn check_invariants(&self, root: NodeId) -> Result<(), TreeViolation> {
        self.check_root(root)?;

        let mut visited: HashSet<NodeId> = HashSet::new();
        let mut stack: Vec<NodeId> = vec![root];
        while let Some(n) = stack.pop() {
            // A node pushed twice means two subtrees overlap.
            if !visited.insert(n) {
                return Err(TreeViolation::DuplicateReach { node: n });
            }
            self.expand_children(n, &mut visited, &mut stack)?;
        }
        Ok(())
    }

    /// Validates the root: it must be a live node of this document without a
    /// parent.
    fn check_root(&self, root: NodeId) -> Result<(), TreeViolation> {
        match self.get(root) {
            Err(CoreError::WrongDocument { id, .. }) => {
                return Err(TreeViolation::WrongDocument { id });
            }
            Err(_) => {
                return Err(TreeViolation::DanglingRelation {
                    holder: root,
                    target: root,
                })
            }
            Ok(_) => {}
        }
        match self.get(root).expect("root validated live above").parent() {
            Some(_) => Err(TreeViolation::RootHasParent { node: root }),
            None => Ok(()),
        }
    }

    /// Checks `n`'s relation fields point at live nodes of this document, then
    /// walks `n`'s child chain validating the bidirectional, sibling and
    /// first/last invariants. Pushable children are added to `stack`.
    fn expand_children(
        &self,
        n: NodeId,
        visited: &mut HashSet<NodeId>,
        stack: &mut Vec<NodeId>,
    ) -> Result<(), TreeViolation> {
        let node = self.get(n).expect("popped nodes were validated live");
        self.validate_relation(n, node.parent())?;
        self.validate_relation(n, node.first_child())?;
        self.validate_relation(n, node.last_child())?;
        self.validate_relation(n, node.previous_sibling())?;
        self.validate_relation(n, node.next_sibling())?;

        match node.first_child() {
            None => {
                if node.last_child().is_some() {
                    return Err(TreeViolation::FirstLastMismatch { node: n });
                }
                Ok(())
            }
            Some(first) => {
                // `prev` is the node the walk expects `cur.previous_sibling` to be.
                let mut chain_seen: HashSet<NodeId> = HashSet::new();
                let mut prev: Option<NodeId> = None;
                let mut cur = first;
                loop {
                    // A chain that revisits a node is a cycle; a node already
                    // processed from another subtree is a duplicate reach.
                    if !chain_seen.insert(cur) {
                        return Err(TreeViolation::SiblingCycle { node: cur });
                    }
                    if visited.contains(&cur) {
                        return Err(TreeViolation::DuplicateReach { node: cur });
                    }

                    let cur_node = self.get(cur).expect("chain nodes were validated live");
                    let actual_prev = cur_node.previous_sibling();
                    match prev {
                        None => {
                            if let Some(sib) = actual_prev {
                                return Err(TreeViolation::SiblingMismatch {
                                    node: cur,
                                    sibling: sib,
                                });
                            }
                        }
                        Some(p) => {
                            if actual_prev != Some(p) {
                                return Err(TreeViolation::SiblingMismatch {
                                    node: p,
                                    sibling: cur,
                                });
                            }
                        }
                    }

                    match cur_node.parent() {
                        None => return Err(TreeViolation::OrphanChild { node: cur }),
                        Some(p) if p == n => {}
                        Some(_) => {
                            return Err(TreeViolation::ParentChildMismatch {
                                parent: n,
                                child: cur,
                            });
                        }
                    }

                    let next = cur_node.next_sibling();
                    if let Some(nxt) = next {
                        self.validate_relation(cur, Some(nxt))?;
                    }
                    stack.push(cur);
                    prev = Some(cur);
                    match next {
                        Some(nxt) => cur = nxt,
                        None => break,
                    }
                }
                let last = prev.expect("the chain has at least its first child");
                if node.last_child() != Some(last) {
                    return Err(TreeViolation::FirstLastMismatch { node: n });
                }
                Ok(())
            }
        }
    }

    /// Rejects relation targets that are not live nodes of this document.
    fn validate_relation(
        &self,
        holder: NodeId,
        target: Option<NodeId>,
    ) -> Result<(), TreeViolation> {
        match target {
            None => Ok(()),
            Some(target) => match self.get(target) {
                Ok(_) => Ok(()),
                Err(CoreError::WrongDocument { id, .. }) => {
                    Err(TreeViolation::WrongDocument { id })
                }
                Err(_) => Err(TreeViolation::DanglingRelation { holder, target }),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::NodeId;
    use crate::dom::node::NodeType;

    /// Builds a chain `root -> c1 -> c2 -> ... -> cN` and returns the ids.
    fn build_chain(doc: &mut Document, depth: usize) -> Vec<NodeId> {
        let mut ids = Vec::with_capacity(depth);
        for _ in 0..depth {
            ids.push(doc.create_element("n").unwrap());
        }
        for i in 0..depth - 1 {
            doc.append_child_for_test(ids[i], ids[i + 1]);
        }
        ids
    }

    #[test]
    fn lone_node_has_no_relations_and_passes() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();

        assert_eq!(doc.parent(root).unwrap(), None);
        assert_eq!(doc.first_child(root).unwrap(), None);
        assert_eq!(doc.last_child(root).unwrap(), None);
        assert_eq!(doc.previous_sibling(root).unwrap(), None);
        assert_eq!(doc.next_sibling(root).unwrap(), None);
        assert_eq!(doc.children(root).unwrap(), Vec::<NodeId>::new());
        assert!(!doc.is_descendant_of(root, root).unwrap());
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn deep_tree_navigates_and_passes() {
        let mut doc = Document::new();
        let chain = build_chain(&mut doc, 200_000);

        assert_eq!(doc.parent(chain[1]).unwrap(), Some(chain[0]));
        assert_eq!(doc.first_child(chain[0]).unwrap(), Some(chain[1]));
        assert_eq!(doc.last_child(chain[0]).unwrap(), Some(chain[1]));
        assert_eq!(doc.previous_sibling(chain[1]).unwrap(), None);
        assert_eq!(doc.next_sibling(chain[1]).unwrap(), None);
        for i in 2..chain.len() {
            assert_eq!(doc.parent(chain[i]).unwrap(), Some(chain[i - 1]));
            assert_eq!(doc.first_child(chain[i - 1]).unwrap(), Some(chain[i]));
            assert_eq!(doc.last_child(chain[i - 1]).unwrap(), Some(chain[i]));
        }
        assert!(doc
            .is_descendant_of(chain[chain.len() - 1], chain[0])
            .unwrap());
        assert!(!doc
            .is_descendant_of(chain[0], chain[chain.len() - 1])
            .unwrap());
        assert_eq!(doc.check_invariants(chain[0]).unwrap(), ());
    }

    #[test]
    fn wide_tree_navigates_and_passes() {
        let mut doc = Document::new();
        let root = doc.create_element("ul").unwrap();
        let mut children = Vec::new();
        for _ in 0..50_000 {
            children.push(doc.create_element("li").unwrap());
        }
        for &c in &children {
            doc.append_child_for_test(root, c);
        }

        assert_eq!(doc.first_child(root).unwrap(), Some(children[0]));
        assert_eq!(
            doc.last_child(root).unwrap(),
            Some(*children.last().unwrap())
        );
        assert_eq!(doc.children(root).unwrap(), children);
        for (i, &c) in children.iter().enumerate() {
            assert_eq!(doc.parent(c).unwrap(), Some(root));
            assert_eq!(
                doc.previous_sibling(c).unwrap(),
                if i == 0 { None } else { Some(children[i - 1]) }
            );
            assert_eq!(doc.next_sibling(c).unwrap(), children.get(i + 1).copied());
        }
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn valid_small_tree_navigates_correctly() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child_for_test(root, a);
        doc.append_child_for_test(root, b);
        doc.append_child_for_test(root, c);
        let b1 = doc.create_element("b1").unwrap();
        doc.append_child_for_test(b, b1);

        assert_eq!(doc.children(root).unwrap(), vec![a, b, c]);
        assert_eq!(doc.first_child(root).unwrap(), Some(a));
        assert_eq!(doc.last_child(root).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(c).unwrap(), None);
        assert!(doc.is_descendant_of(c, root).unwrap());
        assert!(!doc.is_descendant_of(root, a).unwrap());
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn broken_child_parent_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child_for_test(root, c);
        let other = doc.create_element("x").unwrap();

        doc.node_mut(c).unwrap().parent = Some(other);
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::ParentChildMismatch {
                parent: root,
                child: c
            })
        );
    }

    #[test]
    fn missing_child_parent_back_pointer_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child_for_test(root, c);

        doc.node_mut(c).unwrap().parent = None;
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::OrphanChild { node: c })
        );
    }

    #[test]
    fn sibling_cycle_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.append_child_for_test(root, x);
        doc.append_child_for_test(root, y);

        doc.node_mut(x).unwrap().next_sibling = Some(y);
        doc.node_mut(y).unwrap().next_sibling = Some(x);
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::SiblingCycle { node: x })
        );
    }

    #[test]
    fn duplicate_reach_is_detected() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let root = doc.create_element("root").unwrap();
        doc.append_child_for_test(root, p1);
        doc.append_child_for_test(root, p2);
        let shared = doc.create_element("shared").unwrap();
        doc.append_child_for_test(p1, shared);
        doc.append_child_for_test(p2, shared);

        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::DuplicateReach { node: shared })
        );
    }

    #[test]
    fn root_with_parent_that_omits_it_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("root").unwrap();
        let p = doc.create_element("p").unwrap();
        doc.append_child_for_test(p, root);

        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::RootHasParent { node: root })
        );
    }

    #[test]
    fn broken_sibling_mirror_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        let w = doc.create_element("w").unwrap();
        doc.append_child_for_test(root, x);
        doc.append_child_for_test(root, y);
        let w1 = doc.create_element("w1").unwrap();
        doc.append_child_for_test(w, w1);

        doc.node_mut(y).unwrap().previous_sibling = Some(w);
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::SiblingMismatch {
                node: x,
                sibling: y
            })
        );
    }

    #[test]
    fn first_last_chain_mismatch_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child_for_test(root, a);
        doc.append_child_for_test(root, b);

        doc.node_mut(root).unwrap().last_child = Some(a);
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::FirstLastMismatch { node: root })
        );
    }

    #[test]
    fn dangling_relation_is_detected() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child_for_test(root, c);
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);

        doc.node_mut(root).unwrap().first_child = Some(bogus);
        assert_eq!(
            doc.check_invariants(root),
            Err(TreeViolation::DanglingRelation {
                holder: root,
                target: bogus
            })
        );
    }

    #[test]
    fn wrong_document_root_is_detected() {
        let mut a = Document::new();
        let b = Document::new();
        let foreign = a.create_element("div").unwrap();

        assert_eq!(
            b.check_invariants(foreign),
            Err(TreeViolation::WrongDocument { id: foreign })
        );
    }

    #[test]
    fn navigation_rejects_wrong_document_handles() {
        let mut a = Document::new();
        let b = Document::new();
        let el = a.create_element("div").unwrap();

        for read in [
            b.parent(el),
            b.first_child(el),
            b.last_child(el),
            b.previous_sibling(el),
            b.next_sibling(el),
        ] {
            assert!(matches!(read, Err(CoreError::WrongDocument { .. })));
        }
        assert!(matches!(
            b.children(el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.is_descendant_of(el, el),
            Err(CoreError::WrongDocument { .. })
        ));
    }

    #[test]
    fn node_type_still_works_for_tree_built_nodes() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child_for_test(root, c);
        let li = doc.create_element("li").unwrap();
        doc.append_child_for_test(root, li);
        assert_eq!(doc.node_type(root).unwrap(), NodeType::Element);
        assert_eq!(doc.children(root).unwrap().len(), 2);
    }
}
