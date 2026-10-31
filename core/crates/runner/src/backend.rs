//! What the runner needs from the database and file storage, and its implementation `Platform`: PostgREST on plain Postgres with a
//! token signed here, and files in an S3-compatible bucket. Over HTTPS only: the runner holds no Postgres connection, like the rest of
//! the backend.

use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;

use crate::s3::S3;
use crate::token::{now_seconds, service_token};

pub const BUCKET: &str = "bom-files";

/// The columns of `cad_uploads` the runner reads from `claim_next_cad_upload()`.
#[derive(Clone, Debug, Deserialize)]
pub struct Row {
    pub id: String,
    pub organization_id: String,
    pub file_name: String,
    pub storage_path: String,
    pub attempts: u32,
    #[serde(default)]
    pub source_deleted_at: Option<String>,
}

#[derive(Debug)]
pub struct BackendError(pub String);

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<reqwest::Error> for BackendError {
    fn from(error: reqwest::Error) -> Self {
        // reqwest errors can carry the request URL; the path of a stored upload is not a secret, a key never is part of it.
        BackendError(error.without_url().to_string())
    }
}

pub trait Backend {
    /// The oldest queued upload (or one a dead runner left running), already marked running; None when there is nothing to do.
    fn claim(
        &self,
        stale_seconds: u32,
        max_attempts: u32,
    ) -> impl Future<Output = Result<Option<Row>, BackendError>>;
    fn download(&self, path: &str) -> impl Future<Output = Result<Vec<u8>, BackendError>>;
    fn upload(&self, path: &str, bytes: Vec<u8>) -> impl Future<Output = Result<(), BackendError>>;
    fn remove(&self, paths: &[String]) -> impl Future<Output = Result<(), BackendError>>;
    /// Stores the validated report and moves the upload to `analysed`, where the materializer takes over.
    fn mark_analysed(
        &self,
        id: &str,
        result: &serde_json::Value,
    ) -> impl Future<Output = Result<(), BackendError>>;
    /// `retry` puts it back in the queue; otherwise it is failed for good with the code and detail.
    fn mark_failed(
        &self,
        id: &str,
        retry: bool,
        code: &str,
        detail: &str,
    ) -> impl Future<Output = Result<(), BackendError>>;
}

/// A short-lived service-role token signed with the shared secret (what the backend's own client uses), cached until near expiry.
struct Auth {
    secret: String,
    cached: Mutex<Option<(String, u64)>>,
}

const TOKEN_LIFETIME: Duration = Duration::from_secs(300);
const REFRESH_BEFORE_SECONDS: u64 = 30;

/// The database half: the three calls on `cad_uploads`, over PostgREST.
struct Rest {
    http: reqwest::Client,
    url: String,
    auth: Auth,
}

impl Rest {
    fn new(url: &str, auth: Auth) -> Result<Self, BackendError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()?;
        Ok(Self {
            http,
            url: url.trim_end_matches('/').to_string(),
            auth,
        })
    }

    fn bearer(&self) -> Result<String, BackendError> {
        let Auth { secret, cached } = &self.auth;
        let now = now_seconds();
        if let Ok(guard) = cached.lock()
            && let Some((token, expires)) = guard.as_ref()
            && *expires > now + REFRESH_BEFORE_SECONDS
        {
            return Ok(token.clone());
        }
        let token = service_token(secret, now, TOKEN_LIFETIME).map_err(BackendError)?;
        if let Ok(mut guard) = cached.lock() {
            *guard = Some((token.clone(), now + TOKEN_LIFETIME.as_secs()));
        }
        Ok(token)
    }

    /// `path` is relative to the PostgREST root.
    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<reqwest::RequestBuilder, BackendError> {
        let bearer = self.bearer()?;
        Ok(self
            .http
            .request(method, format!("{}{path}", self.url))
            .bearer_auth(&bearer))
    }

    async fn ok(response: reqwest::Response) -> Result<reqwest::Response, BackendError> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = response.text().await.unwrap_or_default();
        let excerpt: String = body
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(200)
            .collect();
        Err(BackendError(format!(
            "the database answered {status}: {excerpt}"
        )))
    }

    async fn claim(
        &self,
        stale_seconds: u32,
        max_attempts: u32,
    ) -> Result<Option<Row>, BackendError> {
        let body =
            serde_json::json!({ "p_stale_seconds": stale_seconds, "p_max_attempts": max_attempts });
        let response = Self::ok(
            self.request(
                reqwest::Method::POST,
                "/rpc/claim_next_cad_upload",
            )?
            .json(&body)
            .send()
            .await?,
        )
        .await?;
        let rows: Vec<Row> = response.json().await?;
        Ok(rows.into_iter().next())
    }

    async fn mark_analysed(
        &self,
        id: &str,
        result: &serde_json::Value,
    ) -> Result<(), BackendError> {
        let body = serde_json::json!({ "status": "analysed", "result": result, "error_code": null, "error_detail": null });
        Self::ok(
            self.request(
                reqwest::Method::PATCH,
                &format!("/cad_uploads?id=eq.{id}"),
            )?
            .json(&body)
            .send()
            .await?,
        )
        .await?;
        Ok(())
    }

    async fn mark_failed(
        &self,
        id: &str,
        retry: bool,
        code: &str,
        detail: &str,
    ) -> Result<(), BackendError> {
        let body = if retry {
            serde_json::json!({ "status": "queued", "error_detail": detail })
        } else {
            serde_json::json!({ "status": "failed", "error_code": code, "error_detail": detail, "finished_at": "now" })
        };
        Self::ok(
            self.request(
                reqwest::Method::PATCH,
                &format!("/cad_uploads?id=eq.{id}"),
            )?
            .json(&body)
            .send()
            .await?,
        )
        .await?;
        Ok(())
    }
}

/// PostgREST on plain Postgres (token signed here) and an S3-compatible bucket.
pub struct Platform {
    rest: Rest,
    files: S3,
}

impl Platform {
    pub fn new(postgrest_url: &str, jwt_secret: &str, files: S3) -> Result<Self, BackendError> {
        // Fail at start, not on the first upload, when the secret could not sign a token.
        service_token(jwt_secret, now_seconds(), TOKEN_LIFETIME).map_err(BackendError)?;
        Ok(Self {
            rest: Rest::new(
                postgrest_url,
                Auth {
                    secret: jwt_secret.to_string(),
                    cached: Mutex::new(None),
                },
            )?,
            files,
        })
    }
}

impl Backend for Platform {
    async fn claim(
        &self,
        stale_seconds: u32,
        max_attempts: u32,
    ) -> Result<Option<Row>, BackendError> {
        self.rest.claim(stale_seconds, max_attempts).await
    }

    async fn download(&self, path: &str) -> Result<Vec<u8>, BackendError> {
        self.files.get(BUCKET, path, now_seconds()).await
    }

    async fn upload(&self, path: &str, bytes: Vec<u8>) -> Result<(), BackendError> {
        self.files.put(BUCKET, path, bytes, now_seconds()).await
    }

    async fn remove(&self, paths: &[String]) -> Result<(), BackendError> {
        for path in paths {
            self.files.delete(BUCKET, path, now_seconds()).await?;
        }
        Ok(())
    }

    async fn mark_analysed(
        &self,
        id: &str,
        result: &serde_json::Value,
    ) -> Result<(), BackendError> {
        self.rest.mark_analysed(id, result).await
    }

    async fn mark_failed(
        &self,
        id: &str,
        retry: bool,
        code: &str,
        detail: &str,
    ) -> Result<(), BackendError> {
        self.rest.mark_failed(id, retry, code, detail).await
    }
}
