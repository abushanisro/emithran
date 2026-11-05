use std::path::PathBuf;
use std::time::Duration;

use archive::Limits;
use runner::backend::{Backend, Platform};
use runner::health;
use runner::isolation;
use runner::job::{self, Config};
use runner::remote::{ANSWER_MARGIN, RemoteWorker};
use runner::s3::{S3, S3Settings};
use runner::secrets::{self, Credentials};
use runner::token::SigningKey;

fn setting(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

const MIB: u64 = 1024 * 1024;

/// What a zip may expand to, in MiB: the same setting, default and bounds as the backend (`ARCHIVE_MAX_EXPANDED_MB`, backend/src/common/
/// resource-limits.ts), so one value governs both cores and a zip is accepted or refused the same way whichever core reads it. Unlike the
/// other settings here, a value that is set but not a whole number in range is an error, not a silent default: the backend refuses to start on it too.
fn archive_total_mb(raw: Option<&str>) -> Result<u64, String> {
    const DEFAULT: u64 = 256;
    match raw.map(str::trim) {
        None | Some("") => Ok(DEFAULT),
        Some(v) => match v.parse::<u64>() {
            Ok(n) if (1..=4096).contains(&n) => Ok(n),
            _ => Err(format!(
                "ARCHIVE_MAX_EXPANDED_MB={v} must be a whole number from 1 to 4096 (default {DEFAULT})"
            )),
        },
    }
}

fn config() -> Result<(Config, Duration), String> {
    let max_entry = number("MAX_UPLOAD_MB", 50) * MIB;
    let max_total =
        archive_total_mb(std::env::var("ARCHIVE_MAX_EXPANDED_MB").ok().as_deref())? * MIB;
    let max_entries = 10_000;
    let config = Config {
        worker: RemoteWorker {
            socket: PathBuf::from(
                std::env::var("WORKER_SOCKET")
                    .unwrap_or_else(|_| "/run/cad-worker/worker.sock".to_string()),
            ),
            deadline: Duration::from_secs(number("WORKER_DEADLINE_SECONDS", 600)),
            answer_margin: ANSWER_MARGIN,
            // result.json plus one file per distinct part; the parts are held in memory until they are stored.
            max_outputs: max_entries + 1,
            max_output_bytes: number("WORKER_MAX_OUTPUT_MB", 512) * MIB,
        },
        archive: Limits {
            max_entries,
            max_entry_bytes: max_entry,
            max_total_bytes: max_total,
        },
    };
    Ok((config, Duration::from_secs(number("POLL_SECONDS", 30))))
}

/// The database (PostgREST on plain Postgres) and the S3-compatible file store, from the same settings the backend reads.
/// Each credential is taken out of `credentials` and dropped (wiped) once it is keyed into what uses it.
fn backend(credentials: &mut Credentials) -> Result<Platform, String> {
    let files = S3::new(S3Settings {
        bucket: setting("S3_BUCKET")?,
        region: setting("S3_REGION")?,
        endpoint: std::env::var("S3_ENDPOINT").ok().filter(|v| !v.is_empty()),
        access_key_id: credentials.take("S3_ACCESS_KEY_ID")?.to_string(),
        secret_access_key: credentials.take("S3_SECRET_ACCESS_KEY")?.to_string(),
        path_style: std::env::var("S3_FORCE_PATH_STYLE").as_deref() == Ok("true"),
    })
    .map_err(|e| e.to_string())?;
    let key = SigningKey::new(&credentials.take("DB_JWT_SECRET")?)?;
    Platform::new(&setting("POSTGREST_URL")?, key, files).map_err(|e| e.to_string())
}

fn heartbeat_path() -> PathBuf {
    PathBuf::from(
        std::env::var("HEARTBEAT_FILE").unwrap_or_else(|_| "/tmp/cad-runner.alive".to_string()),
    )
}

fn fail(message: &str) -> ! {
    eprintln!("cad-runner cannot start: {message}");
    std::process::exit(78);
}

fn main() {
    // `cad-runner health`: the container's healthcheck. Exit 0 while the heartbeat is recent.
    if std::env::args().nth(1).as_deref() == Some("health") {
        let alive = health::is_fresh(&heartbeat_path(), health::MAX_AGE);
        std::process::exit(if alive { 0 } else { 1 });
    }
    // Before any credential is read: nothing else may read this process's memory through /proc (isolation.rs).
    if let Err(error) = isolation::make_non_dumpable() {
        fail(&format!("cannot mark the process non-dumpable: {error}"));
    }
    // The first start restarts itself here without the credentials in its environment (secrets.rs); the restart continues.
    let mut credentials = secrets::load().unwrap_or_else(|message| fail(&message));
    let started = config().and_then(|(config, poll)| {
        backend(&mut credentials).map(|backend| (config, poll, backend))
    });
    drop(credentials);
    let (config, poll, backend) = started.unwrap_or_else(|message| fail(&message));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap_or_else(|error| fail(&format!("cannot start the async runtime: {error}")));
    runtime.block_on(serve(&backend, &config, poll));
}

async fn serve<B: Backend>(backend: &B, config: &Config, poll: Duration) {
    let beat_path = heartbeat_path();
    tokio::spawn(async move {
        loop {
            if let Err(error) = health::beat(&beat_path) {
                eprintln!("cad-runner: cannot write the heartbeat: {error}");
            }
            tokio::time::sleep(health::BEAT_EVERY).await;
        }
    });
    eprintln!(
        "cad-runner started (poll every {}s, worker deadline {}s, worker at {})",
        poll.as_secs(),
        config.worker.deadline.as_secs(),
        config.worker.socket.display()
    );
    loop {
        // Drain the queue, then sleep; a stop signal ends the loop between uploads, never in the middle of one.
        match job::run_once(backend, config).await {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => eprintln!("cad-runner: {error}"),
        }
        tokio::select! {
            () = tokio::time::sleep(poll) => {}
            _ = tokio::signal::ctrl_c() => break,
        }
    }
    eprintln!("cad-runner stopped");
}

#[cfg(test)]
mod tests {
    use super::archive_total_mb;

    #[test]
    fn the_expansion_cap_is_the_backends_setting_with_the_backends_default_and_bounds() {
        assert_eq!(archive_total_mb(None), Ok(256));
        assert_eq!(archive_total_mb(Some("")), Ok(256));
        assert_eq!(archive_total_mb(Some(" 512 ")), Ok(512));
        assert_eq!(archive_total_mb(Some("1")), Ok(1));
        assert_eq!(archive_total_mb(Some("4096")), Ok(4096));
        for bad in ["0", "4097", "-1", "256.5", "lots"] {
            assert!(
                archive_total_mb(Some(bad)).is_err(),
                "{bad} should be refused"
            );
        }
    }
}
