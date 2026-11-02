//! The real `cad-runner` binary restarts itself without its credentials in the environment and still has them (src/secrets.rs).
//! The restarted program refuses to run if any credential is still in its environment, so reaching the later check on the
//! secret's value proves both halves: the variables are gone and the value arrived through the pipe.
#![allow(clippy::unwrap_used)]

use std::process::{Command, Output};

fn run(db_jwt_secret: Option<&str>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_cad-runner"));
    command
        .env_clear()
        .env("S3_BUCKET", "bucket")
        .env("S3_REGION", "us-east-1")
        .env("S3_ACCESS_KEY_ID", "id")
        .env("S3_SECRET_ACCESS_KEY", "key")
        .env("POSTGREST_URL", "http://127.0.0.1:1");
    if let Some(secret) = db_jwt_secret {
        command.env("DB_JWT_SECRET", secret);
    }
    command.output().unwrap()
}

#[test]
fn the_secret_reaches_the_restarted_runner_through_the_pipe() {
    let output = run(Some("too-short"));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(78), "{stderr}");
    assert!(
        stderr.contains("DB_JWT_SECRET must be at least 32 characters"),
        "{stderr}"
    );
}

#[test]
fn a_missing_secret_is_named() {
    let output = run(None);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(78), "{stderr}");
    assert!(stderr.contains("DB_JWT_SECRET is not set"), "{stderr}");
}
