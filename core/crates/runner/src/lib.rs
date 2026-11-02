//! `cad-runner`: claims queued CAD uploads, has the geometry worker analyse them in its own container (`cad-worker-host`, over a
//! Unix socket), verifies what it returns and hands the result to the NestJS materializer. See `docs/ASSEMBLY_CORE.md`.
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
pub mod health;
pub mod host;
pub mod isolation;
pub mod job;
pub mod names;
pub mod remote;
pub mod s3;
pub mod secrets;
pub mod token;
pub mod wire;
pub mod worker;
