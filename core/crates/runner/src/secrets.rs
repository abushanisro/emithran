//! The runner's credentials (DB_JWT_SECRET and the S3 keys) live in its memory only, never in its process environment.
//!
//! Compose hands them over as environment variables. At start the runner reads them, writes them into a pipe and replaces itself
//! (`exec`, same PID) with a fresh copy of its own program, started without those variables and reading them from the pipe on its
//! stdin. From then on neither `/proc/<pid>/environ` nor anything the process could start holds a credential, and each value
//! is wiped from memory when it is dropped. Removing the variables in place is not an option: in Rust 2024
//! `std::env::remove_var` is `unsafe`, which this workspace forbids, and the kernel's copy in `/proc/<pid>/environ` would keep
//! the values anyway.

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::process::Command;

use zeroize::Zeroizing;

/// Every credential the runner reads. Nothing else is handed over; the other settings stay ordinary environment variables.
pub const NAMES: [&str; 3] = ["DB_JWT_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

/// The argument the runner restarts itself with: read the credentials from stdin.
pub const HANDOFF_ARG: &str = "--credentials-on-stdin";

/// Far above three keys, and below the 64 KiB a pipe holds, so writing it before `exec` never blocks.
const MAX_HANDOFF_BYTES: usize = 16 * 1024;

#[derive(Debug, Default)]
pub struct Credentials(HashMap<String, Zeroizing<String>>);

impl Credentials {
    /// Removes and returns one credential; the caller keeps it no longer than it needs it.
    pub fn take(&mut self, name: &str) -> Result<Zeroizing<String>, String> {
        self.0
            .remove(name)
            .ok_or_else(|| format!("{name} is not set"))
    }
}

/// The credentials present in `values`, as the bytes written to the pipe.
fn encode(values: &[(&str, Zeroizing<String>)]) -> Result<Zeroizing<Vec<u8>>, String> {
    let map: BTreeMap<&str, &str> = values.iter().map(|(n, v)| (*n, v.as_str())).collect();
    let bytes = Zeroizing::new(serde_json::to_vec(&map).map_err(|e| e.to_string())?);
    if bytes.len() > MAX_HANDOFF_BYTES {
        return Err(format!(
            "the credentials take more than {MAX_HANDOFF_BYTES} bytes"
        ));
    }
    Ok(bytes)
}

fn decode(bytes: &[u8]) -> Result<Credentials, String> {
    let map: HashMap<String, String> =
        serde_json::from_slice(bytes).map_err(|_| "the credentials handed over are unreadable")?;
    let mut credentials = Credentials::default();
    for (name, value) in map {
        let value = Zeroizing::new(value);
        if !NAMES.contains(&name.as_str()) {
            return Err(format!("{name:?} is not a credential the runner reads"));
        }
        credentials.0.insert(name, value);
    }
    Ok(credentials)
}

/// Returns the credentials. On the first start this does not return: it restarts the program without them in its environment
/// (or returns the error that prevented it). After the restart it reads them from stdin.
pub fn load() -> Result<Credentials, String> {
    if std::env::args().nth(1).as_deref() == Some(HANDOFF_ARG) {
        let mut payload = Zeroizing::new(Vec::new());
        std::io::stdin()
            .take(MAX_HANDOFF_BYTES as u64 + 1)
            .read_to_end(&mut payload)
            .map_err(|e| format!("cannot read the credentials: {e}"))?;
        if payload.len() > MAX_HANDOFF_BYTES {
            return Err("the credentials handed over are too large".to_string());
        }
        if let Some(name) = NAMES.iter().find(|n| std::env::var_os(n).is_some()) {
            return Err(format!(
                "{name} is still in the environment after the restart"
            ));
        }
        return decode(&payload);
    }
    let present: Vec<(&str, Zeroizing<String>)> = NAMES
        .iter()
        .filter_map(|n| std::env::var(n).ok().map(|v| (*n, Zeroizing::new(v))))
        .collect();
    let payload = encode(&present)?;
    drop(present);
    let program =
        std::env::current_exe().map_err(|e| format!("cannot find the program to restart: {e}"))?;
    let (reader, mut writer) =
        std::io::pipe().map_err(|e| format!("cannot hand over the credentials: {e}"))?;
    writer
        .write_all(&payload)
        .map_err(|e| format!("cannot hand over the credentials: {e}"))?;
    drop(writer); // the new program reads to the end of the pipe
    drop(payload);
    let mut command = Command::new(program);
    command.arg(HANDOFF_ARG).stdin(reader);
    for name in NAMES {
        command.env_remove(name);
    }
    let error = command.exec(); // returns only if the restart failed
    Err(format!(
        "cannot restart without the credentials in the environment: {error}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_round_trip_and_are_taken_once() {
        let bytes = encode(&[
            ("DB_JWT_SECRET", Zeroizing::new("s".repeat(40))),
            ("S3_ACCESS_KEY_ID", Zeroizing::new("id".to_string())),
        ])
        .unwrap();
        let mut credentials = decode(&bytes).unwrap();
        assert_eq!(
            credentials.take("DB_JWT_SECRET").unwrap().as_str(),
            "s".repeat(40)
        );
        assert_eq!(
            credentials.take("DB_JWT_SECRET").unwrap_err(),
            "DB_JWT_SECRET is not set"
        );
        assert_eq!(
            credentials.take("S3_SECRET_ACCESS_KEY").unwrap_err(),
            "S3_SECRET_ACCESS_KEY is not set"
        );
    }

    #[test]
    fn only_known_credentials_are_accepted() {
        assert!(decode(br#"{"LD_PRELOAD":"/tmp/x.so"}"#).is_err());
        assert!(decode(b"not json").is_err());
    }

    #[test]
    fn a_handoff_larger_than_a_pipe_can_hold_is_refused() {
        let huge = Zeroizing::new("x".repeat(MAX_HANDOFF_BYTES));
        assert!(encode(&[("DB_JWT_SECRET", huge)]).is_err());
    }
}
