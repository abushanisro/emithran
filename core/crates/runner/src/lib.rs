//! `cad-runner`: claims queued CAD uploads, runs the geometry worker on them under a deadline, verifies what it wrote and hands
//! the result to the NestJS materializer. See `docs/ASSEMBLY_CORE.md`.
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )
)]
pub mod backend;
pub mod job;
pub mod names;
pub mod worker;
