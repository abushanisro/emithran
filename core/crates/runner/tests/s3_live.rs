//! The runner's S3 client against a real S3 server that verifies signatures. Skipped unless S3_TEST_ENDPOINT is set
//! (`npm run test:s3` in backend/ starts the server and sets it).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use runner::s3::{S3, S3Settings};

fn store(secret: &str) -> Option<S3> {
    let endpoint = std::env::var("S3_TEST_ENDPOINT").ok()?;
    S3::new(S3Settings {
        bucket: "emithran-test".to_string(),
        region: "us-east-1".to_string(),
        endpoint: Some(endpoint),
        access_key_id: "test".to_string(),
        secret_access_key: secret.to_string(),
        path_style: true,
    })
    .ok()
}

fn now() -> u64 {
    runner::token::now_seconds()
}

#[tokio::test]
async fn puts_gets_and_deletes_with_a_signature_the_server_verifies() {
    let Some(s3) = store("testtesttest") else {
        eprintln!("skipped: S3_TEST_ENDPOINT is not set");
        return;
    };
    // Awkward on purpose: spaces, plus signs and non-ASCII must be encoded exactly the way the server canonicalises them.
    let key = "cad-uploads/org 1/up+1/parts/é part.step";
    let bytes: Vec<u8> = (0..=255u8).cycle().take(300_000).collect();
    s3.put("bom-files", key, bytes.clone(), now())
        .await
        .unwrap();
    assert_eq!(s3.get("bom-files", key, now()).await.unwrap(), bytes);
    s3.delete("bom-files", key, now()).await.unwrap();
    assert!(
        s3.get("bom-files", key, now()).await.is_err(),
        "a deleted object must be gone"
    );
    s3.delete("bom-files", key, now()).await.unwrap(); // deleting twice is fine
}

#[tokio::test]
async fn a_wrong_secret_is_refused_by_the_server() {
    let Some(s3) = store("not-the-secret") else {
        eprintln!("skipped: S3_TEST_ENDPOINT is not set");
        return;
    };
    let error = s3
        .put("bom-files", "x", b"1".to_vec(), now())
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("403"),
        "expected 403, got: {error}"
    );
}

#[tokio::test]
async fn a_skewed_clock_is_refused_by_the_server() {
    let Some(s3) = store("testtesttest") else {
        eprintln!("skipped: S3_TEST_ENDPOINT is not set");
        return;
    };
    let hour_ago = now() - 3600;
    assert!(
        s3.put("bom-files", "x", b"1".to_vec(), hour_ago)
            .await
            .is_err()
    );
}
