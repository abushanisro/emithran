//! What the runner needs from the database and file storage, and its Supabase implementation. Over HTTPS only (PostgREST and
//! Storage with the secret key): the runner holds no Postgres connection, like the rest of the backend.

use serde::Deserialize;

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

pub struct Supabase {
    http: reqwest::Client,
    url: String,
    key: String,
}

impl Supabase {
    pub fn new(url: &str, secret_key: &str) -> Result<Self, BackendError> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()?;
        Ok(Self {
            http,
            url: url.trim_end_matches('/').to_string(),
            key: secret_key.to_string(),
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.url))
            .header("apikey", &self.key)
            .bearer_auth(&self.key)
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
            "Supabase answered {status}: {excerpt}"
        )))
    }
}

impl Backend for Supabase {
    async fn claim(
        &self,
        stale_seconds: u32,
        max_attempts: u32,
    ) -> Result<Option<Row>, BackendError> {
        let body =
            serde_json::json!({ "p_stale_seconds": stale_seconds, "p_max_attempts": max_attempts });
        let response = Self::ok(
            self.request(reqwest::Method::POST, "/rest/v1/rpc/claim_next_cad_upload")
                .json(&body)
                .send()
                .await?,
        )
        .await?;
        let rows: Vec<Row> = response.json().await?;
        Ok(rows.into_iter().next())
    }

    async fn download(&self, path: &str) -> Result<Vec<u8>, BackendError> {
        let response = Self::ok(
            self.request(
                reqwest::Method::GET,
                &format!("/storage/v1/object/{BUCKET}/{path}"),
            )
            .send()
            .await?,
        )
        .await?;
        Ok(response.bytes().await?.to_vec())
    }

    async fn upload(&self, path: &str, bytes: Vec<u8>) -> Result<(), BackendError> {
        let request = self.request(
            reqwest::Method::POST,
            &format!("/storage/v1/object/{BUCKET}/{path}"),
        );
        Self::ok(
            request
                .header("x-upsert", "true")
                .header("content-type", "application/octet-stream")
                .body(bytes)
                .send()
                .await?,
        )
        .await?;
        Ok(())
    }

    async fn remove(&self, paths: &[String]) -> Result<(), BackendError> {
        if paths.is_empty() {
            return Ok(());
        }
        let body = serde_json::json!({ "prefixes": paths });
        Self::ok(
            self.request(
                reqwest::Method::DELETE,
                &format!("/storage/v1/object/{BUCKET}"),
            )
            .json(&body)
            .send()
            .await?,
        )
        .await?;
        Ok(())
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
                &format!("/rest/v1/cad_uploads?id=eq.{id}"),
            )
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
                &format!("/rest/v1/cad_uploads?id=eq.{id}"),
            )
            .json(&body)
            .send()
            .await?,
        )
        .await?;
        Ok(())
    }
}
