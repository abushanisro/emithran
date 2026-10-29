//! The runner's database half against a real PostgREST on a real Postgres, with a token signed by the runner itself.
//! Skipped unless POSTGREST_TEST_URL and DB_JWT_SECRET are set (`npm run test:postgrest` in backend/ sets them and seeds 3 queued uploads).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use runner::backend::{Backend, Platform};
use runner::s3::{S3, S3Settings};

fn platform(secret: &str) -> Option<Platform> {
    let url = std::env::var("POSTGREST_TEST_URL").ok()?;
    let files = S3::new(S3Settings {
        bucket: "unused".to_string(),
        region: "us-east-1".to_string(),
        endpoint: Some("http://127.0.0.1:1".to_string()),
        access_key_id: "x".to_string(),
        secret_access_key: "y".to_string(),
        path_style: true,
    })
    .ok()?;
    Platform::new(&url, secret, files).ok()
}

#[tokio::test]
async fn claims_oldest_first_and_records_each_outcome() {
    let (Some(backend), true) = (
        std::env::var("DB_JWT_SECRET")
            .ok()
            .and_then(|s| platform(&s)),
        std::env::var("POSTGREST_TEST_URL").is_ok(),
    ) else {
        eprintln!("skipped: POSTGREST_TEST_URL / DB_JWT_SECRET are not set");
        return;
    };
    let a = backend.claim(900, 3).await.unwrap().unwrap();
    assert_eq!(
        a.id, "a0000000-0000-4000-8000-000000000001",
        "the oldest queued upload comes first"
    );
    assert_eq!(a.storage_path, "p/a.step");
    assert_eq!(a.attempts, 1);
    backend
        .mark_analysed(&a.id, &serde_json::json!({ "schema_version": 1 }))
        .await
        .unwrap();

    let b = backend.claim(900, 3).await.unwrap().unwrap();
    assert_eq!(b.id, "a0000000-0000-4000-8000-000000000002");
    backend
        .mark_failed(&b.id, false, "bad_step", "the STEP file is broken")
        .await
        .unwrap();

    // A retry goes back in the queue, so the very next claim returns it again with one more attempt.
    let c = backend.claim(900, 3).await.unwrap().unwrap();
    assert_eq!(c.id, "a0000000-0000-4000-8000-000000000003");
    backend
        .mark_failed(&c.id, true, "engine_busy", "try again")
        .await
        .unwrap();
    let again = backend.claim(900, 3).await.unwrap().unwrap();
    assert_eq!((again.id.as_str(), again.attempts), (c.id.as_str(), 2));

    assert!(
        backend.claim(900, 3).await.unwrap().is_none(),
        "nothing else is waiting"
    );
}

#[tokio::test]
async fn a_token_signed_with_the_wrong_secret_is_refused() {
    let Some(_) = std::env::var("POSTGREST_TEST_URL").ok() else {
        eprintln!("skipped: POSTGREST_TEST_URL is not set");
        return;
    };
    let Some(backend) = platform("a-different-secret-of-more-than-32-characters") else {
        panic!("platform should build");
    };
    let error = backend.claim(900, 3).await.unwrap_err();
    assert!(
        error.to_string().contains("401"),
        "expected 401, got: {error}"
    );
}
