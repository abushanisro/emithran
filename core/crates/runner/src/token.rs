//! The token PostgREST trusts (HS256), signed with the same secret and in the same form as the NestJS backend's `DbTokenMinter`
//! (`backend/src/common/db/db-token.ts`), for the runner's own database role `cad_runner` (migration 951): it may claim a queued
//! upload and finish the one it claimed, nothing else.
//!
//! The secret is turned into a `SigningKey` once at start and the text is dropped (and wiped); the key is wiped when dropped.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

const ISSUER: &str = "emithran-backend";
const MIN_SECRET_LEN: usize = 32;
/// The database role the runner acts as (migration 951).
pub const ROLE: &str = "cad_runner";

/// DB_JWT_SECRET, keyed into HMAC-SHA256 once.
#[derive(Clone)]
pub struct SigningKey(Hmac<Sha256>);

impl SigningKey {
    /// Errors only for a secret shorter than the backend accepts.
    pub fn new(secret: &str) -> Result<Self, String> {
        if secret.len() < MIN_SECRET_LEN {
            return Err(format!(
                "DB_JWT_SECRET must be at least {MIN_SECRET_LEN} characters"
            ));
        }
        Hmac::<Sha256>::new_from_slice(secret.as_bytes())
            .map(SigningKey)
            .map_err(|e| e.to_string())
    }
}

/// A token for `ROLE`. `iat` and `exp` are seconds since the epoch.
pub fn runner_token(key: &SigningKey, issued_at: u64, lifetime: Duration) -> String {
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = serde_json::json!({
        "role": ROLE,
        "iss": ISSUER,
        "iat": issued_at,
        "exp": issued_at + lifetime.as_secs(),
    });
    let body = URL_SAFE_NO_PAD.encode(claims.to_string());
    let signing_input = format!("{header}.{body}");
    let mut mac = key.0.clone();
    mac.update(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{signing_input}.{signature}")
}

pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "0123456789abcdef0123456789abcdef-secret";

    fn token(issued_at: u64, lifetime: u64) -> String {
        let key = SigningKey::new(SECRET).unwrap();
        runner_token(&key, issued_at, Duration::from_secs(lifetime))
    }

    #[test]
    fn matches_the_signature_node_produces_for_the_same_claims() {
        // The HMAC below was computed independently with Node's crypto.createHmac('sha256', SECRET) over the same header.body
        // (only the signature is kept here: no token-shaped literal belongs in the repository).
        let token = token(1_700_000_000, 300);
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[2], "0kCN7JfwpE9iTTS-zyNi8wgZdEENMGDdXq4x83w1uAA");
    }

    #[test]
    fn claims_are_the_runner_role_with_a_bounded_lifetime() {
        let token = token(100, 60);
        let body = token.split('.').nth(1).unwrap_or_default();
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).unwrap_or_default())
                .unwrap_or_default();
        assert_eq!(claims["role"], "cad_runner");
        assert_ne!(claims["role"], "service_role");
        assert_eq!(claims["iat"], 100);
        assert_eq!(claims["exp"], 160);
    }

    #[test]
    fn refuses_a_short_secret() {
        assert!(SigningKey::new("short").is_err());
    }
}
