//! The true-shape nester (port of cad-engine/sheet_metal/nesting.py). See `docs/ASSEMBLY_CORE.md` and the `nester` binary.
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )
)]
pub mod geom;
pub mod nest;

pub use nest::{Nest, Placement, Request, compute};
