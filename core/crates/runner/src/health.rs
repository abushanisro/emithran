//! Liveness for a process with no HTTP port: a background task rewrites a heartbeat file every few seconds, independent of what the
//! current upload is doing, and `cad-runner health` (the container's healthcheck) succeeds only while that file is recent. A wedged
//! async runtime or a dead process stops the beat; a long CAD analysis does not.

use std::path::Path;
use std::time::{Duration, SystemTime};

pub const BEAT_EVERY: Duration = Duration::from_secs(10);
pub const MAX_AGE: Duration = Duration::from_secs(60);

pub fn beat(path: &Path) -> std::io::Result<()> {
    std::fs::write(path, b"alive")
}

/// True when the heartbeat file exists and was written less than `max_age` ago.
pub fn is_fresh(path: &Path, max_age: Duration) -> bool {
    let Ok(modified) = std::fs::metadata(path).and_then(|m| m.modified()) else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age < max_age)
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_beat_is_alive_a_missing_or_old_one_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("alive");
        assert!(!is_fresh(&path, MAX_AGE), "no file yet");
        beat(&path).unwrap();
        assert!(is_fresh(&path, MAX_AGE));
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(120))
            .unwrap();
        assert!(
            !is_fresh(&path, MAX_AGE),
            "a stale beat means the process is wedged or gone"
        );
    }
}
