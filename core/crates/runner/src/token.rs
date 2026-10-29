//! The service-role token PostgREST trusts (HS256), signed with the same secret and claims as the NestJS backend's `DbTokenMinter`
//! (`backend/src/common/db/db-token.ts`). The runner is the backend's own worker, so it acts as the service role.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

const ISSUER: &str = "emithran-backend";
const MIN_SECRET_LEN: usize = 32;

/// `iat` and `exp` are seconds since the epoch. Errors only for a secret shorter than the backend accepts.
pub fn service_token(secret: &str, issued_at: u64, lifetime: Duration) -> Result<String, String> {
    if secret.len() < MIN_SECRET_LEN {
        return Err(format!(
            "DB_JWT_SECRET must be at least {MIN_SECRET_LEN} characters"
        ));
    }
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = serde_json::json!({
        "role": "service_role",
        "iss": ISSUER,
        "iat": issued_at,
        "exp": issued_at + lifetime.as_secs(),
    });
    let body = URL_SAFE_NO_PAD.encode(claims.to_string());
    let signing_input = format!("{header}.{body}");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    Ok(format!("{signing_input}.{signature}"))
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

    #[test]
    fn matches_the_signature_node_produces_for_the_same_claims() {
        // The HMAC below was computed independently with Node's crypto.createHmac('sha256', SECRET) over the same header.body
        // (only the signature is kept here: no token-shaped literal belongs in the repository).
        let token =
            service_token(SECRET, 1_700_000_000, Duration::from_secs(300)).unwrap_or_default();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[2], "upbfgRo6oXGyY44AlDaZTtLEbEnn4jC8UYVdHtVggAw");
    }

    #[test]
    fn claims_are_the_service_role_with_a_bounded_lifetime() {
        let token = service_token(SECRET, 100, Duration::from_secs(60)).unwrap_or_default();
        let body = token.split('.').nth(1).unwrap_or_default();
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).unwrap_or_default())
                .unwrap_or_default();
        assert_eq!(claims["role"], "service_role");
        assert_eq!(claims["iat"], 100);
        assert_eq!(claims["exp"], 160);
    }

    #[test]
    fn refuses_a_short_secret() {
        assert!(service_token("short", 1, Duration::from_secs(60)).is_err());
    }
}
