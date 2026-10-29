//! Files in an S3-compatible bucket (AWS S3, Cloudflare R2, any S3 server), over HTTPS with Signature Version 4. Three calls only
//! (GET, PUT, DELETE of one object), so the signer is small enough to read and is checked against AWS's published example.
//! Keys match the NestJS adapter (`backend/src/common/storage/s3-object-store.ts`): `<logical bucket>/<key>` inside one real bucket.

use std::fmt::Write as _;

use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

use crate::backend::BackendError;

const SERVICE: &str = "s3";

#[derive(Clone)]
pub struct S3Settings {
    pub bucket: String,
    pub region: String,
    /// Only for S3-compatible services; None means AWS.
    pub endpoint: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub path_style: bool,
}

pub struct S3 {
    http: reqwest::Client,
    settings: S3Settings,
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    match Hmac::<Sha256>::new_from_slice(key) {
        Ok(mut mac) => {
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }
        // HMAC accepts any key length, so this cannot happen; an empty signature would simply be rejected by the server.
        Err(_) => Vec::new(),
    }
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// `YYYYMMDDTHHMMSSZ` for seconds since the epoch (UTC), without a date library.
pub fn amz_date(epoch_seconds: u64) -> String {
    let days = epoch_seconds / 86_400;
    let rest = epoch_seconds % 86_400;
    // Civil-from-days (Howard Hinnant), valid for the whole range we will ever see.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// RFC 3986 encoding of one path segment, as SigV4 requires (everything but unreserved characters).
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte))
            }
            other => {
                let _ = write!(out, "%{other:02X}");
            }
        }
    }
    out
}

fn encode_path(path: &str) -> String {
    path.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

/// The `Authorization` header value. `headers` are (lowercase name, trimmed value) and must include everything to be signed
/// (host, x-amz-content-sha256, x-amz-date at least); `canonical_uri` is already encoded.
pub fn authorization(
    settings: &S3Settings,
    method: &str,
    canonical_uri: &str,
    headers: &[(&str, &str)],
    payload_hash: &str,
    amz_date: &str,
) -> String {
    let mut sorted: Vec<(&str, &str)> = headers.to_vec();
    sorted.sort_by(|a, b| a.0.cmp(b.0));
    let canonical_headers: String = sorted.iter().map(|(n, v)| format!("{n}:{v}\n")).collect();
    let signed_headers = sorted.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(";");
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let day = amz_date.get(..8).unwrap_or_default();
    let scope = format!("{day}/{}/{SERVICE}/aws4_request", settings.region);
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(
        format!("AWS4{}", settings.secret_access_key).as_bytes(),
        day.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, settings.region.as_bytes());
    let k_service = hmac_sha256(&k_region, SERVICE.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope},SignedHeaders={signed_headers},Signature={signature}",
        settings.access_key_id
    )
}

impl S3 {
    pub fn new(settings: S3Settings) -> Result<Self, BackendError> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()?;
        Ok(Self { http, settings })
    }

    /// (url, host header, canonical uri) for one object. Path-style: `<endpoint>/<bucket>/<key>`; otherwise the bucket is in the host.
    fn locate(
        &self,
        logical_bucket: &str,
        key: &str,
    ) -> Result<(String, String, String), BackendError> {
        if key.split('/').any(|part| part == "..") || key.starts_with('/') {
            return Err(BackendError("invalid storage key".to_string()));
        }
        let object = format!("{logical_bucket}/{key}");
        let (scheme, host) = match &self.settings.endpoint {
            Some(endpoint) => {
                let trimmed = endpoint.trim_end_matches('/');
                trimmed
                    .split_once("://")
                    .map(|(s, h)| (s.to_string(), h.to_string()))
                    .ok_or_else(|| {
                        BackendError("S3_ENDPOINT must start with http:// or https://".to_string())
                    })?
            }
            None => (
                "https".to_string(),
                format!("s3.{}.amazonaws.com", self.settings.region),
            ),
        };
        if self.settings.path_style {
            let uri = encode_path(&format!("/{}/{object}", self.settings.bucket));
            return Ok((format!("{scheme}://{host}{uri}"), host, uri));
        }
        let virtual_host = format!("{}.{host}", self.settings.bucket);
        let uri = encode_path(&format!("/{object}"));
        Ok((format!("{scheme}://{virtual_host}{uri}"), virtual_host, uri))
    }

    async fn send(
        &self,
        method: reqwest::Method,
        logical_bucket: &str,
        key: &str,
        body: Vec<u8>,
        now: u64,
    ) -> Result<reqwest::Response, BackendError> {
        let (url, host, uri) = self.locate(logical_bucket, key)?;
        let date = amz_date(now);
        let payload_hash = sha256_hex(&body);
        let auth = authorization(
            &self.settings,
            method.as_str(),
            &uri,
            &[
                ("host", &host),
                ("x-amz-content-sha256", &payload_hash),
                ("x-amz-date", &date),
            ],
            &payload_hash,
            &date,
        );
        let response = self
            .http
            .request(method, url)
            .header("x-amz-date", date)
            .header("x-amz-content-sha256", payload_hash)
            .header("authorization", auth)
            .body(body)
            .send()
            .await?;
        Ok(response)
    }

    async fn checked(
        response: reqwest::Response,
        what: &str,
    ) -> Result<reqwest::Response, BackendError> {
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
            "S3 {what} answered {status}: {excerpt}"
        )))
    }

    pub async fn get(&self, bucket: &str, key: &str, now: u64) -> Result<Vec<u8>, BackendError> {
        let response = self
            .send(reqwest::Method::GET, bucket, key, Vec::new(), now)
            .await?;
        Ok(Self::checked(response, "get")
            .await?
            .bytes()
            .await?
            .to_vec())
    }

    pub async fn put(
        &self,
        bucket: &str,
        key: &str,
        bytes: Vec<u8>,
        now: u64,
    ) -> Result<(), BackendError> {
        let response = self
            .send(reqwest::Method::PUT, bucket, key, bytes, now)
            .await?;
        Self::checked(response, "put").await.map(|_| ())
    }

    /// A missing key is fine (S3 answers 204 either way).
    pub async fn delete(&self, bucket: &str, key: &str, now: u64) -> Result<(), BackendError> {
        let response = self
            .send(reqwest::Method::DELETE, bucket, key, Vec::new(), now)
            .await?;
        Self::checked(response, "delete").await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aws_example() -> S3Settings {
        S3Settings {
            bucket: "examplebucket".to_string(),
            region: "us-east-1".to_string(),
            endpoint: None,
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
            path_style: false,
        }
    }

    #[test]
    fn reproduces_the_signature_in_awss_get_object_example() {
        // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html ("Example: GET Object")
        let empty = sha256_hex(b"");
        let auth = authorization(
            &aws_example(),
            "GET",
            "/test.txt",
            &[
                ("host", "examplebucket.s3.amazonaws.com"),
                ("range", "bytes=0-9"),
                ("x-amz-content-sha256", &empty),
                ("x-amz-date", "20130524T000000Z"),
            ],
            &empty,
            "20130524T000000Z",
        );
        assert_eq!(
            auth,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    #[test]
    fn formats_dates_including_leap_days_and_year_ends() {
        assert_eq!(amz_date(0), "19700101T000000Z");
        assert_eq!(amz_date(1_369_353_600), "20130524T000000Z");
        assert_eq!(amz_date(1_709_164_800 + 86_399), "20240229T235959Z");
        assert_eq!(amz_date(1_798_761_599), "20261231T235959Z");
        assert_eq!(amz_date(1_798_761_600), "20270101T000000Z");
    }

    #[test]
    fn encodes_keys_the_way_sigv4_expects() {
        assert_eq!(encode_path("/a b/c+d/é.step"), "/a%20b/c%2Bd/%C3%A9.step");
        assert_eq!(encode_path("/safe-name_1.~x"), "/safe-name_1.~x");
    }

    #[test]
    fn addresses_path_style_and_virtual_hosted_buckets() {
        let mut s = aws_example();
        s.endpoint = Some("http://localhost:9000/".to_string());
        s.path_style = true;
        let store = S3::new(s.clone()).unwrap();
        let (url, host, uri) = store.locate("bom-files", "u/p/f.step").unwrap();
        assert_eq!(
            (url.as_str(), host.as_str(), uri.as_str()),
            (
                "http://localhost:9000/examplebucket/bom-files/u/p/f.step",
                "localhost:9000",
                "/examplebucket/bom-files/u/p/f.step"
            )
        );
        s.path_style = false;
        let store = S3::new(s).unwrap();
        assert_eq!(
            store.locate("bom-files", "k").unwrap().1,
            "examplebucket.localhost:9000"
        );
        let aws = S3::new(aws_example()).unwrap();
        assert_eq!(
            aws.locate("bom-files", "k").unwrap().0,
            "https://examplebucket.s3.us-east-1.amazonaws.com/bom-files/k"
        );
    }

    #[test]
    fn refuses_keys_that_could_leave_their_bucket() {
        let store = S3::new(aws_example()).unwrap();
        assert!(store.locate("b", "../x").is_err());
        assert!(store.locate("b", "/abs").is_err());
    }
}
