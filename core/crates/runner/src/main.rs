use std::path::PathBuf;
use std::time::Duration;

use archive::Limits;
use runner::backend::{Backend, Platform};
use runner::health;
use runner::job::{self, Config};
use runner::s3::{S3, S3Settings};
use runner::worker::WorkerConfig;

fn setting(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn config() -> Result<(Config, Duration), String> {
    let max_upload_mb = number("MAX_UPLOAD_MB", 50);
    let max_entry = max_upload_mb * 1024 * 1024;
    let deadline = Duration::from_secs(number("WORKER_DEADLINE_SECONDS", 600));
    // Limit the worker's memory, CPU time and file size where `prlimit` exists (Linux); the deadline kills it either way.
    let wrapper = if number("WORKER_LIMITS", 1) == 1 && PathBuf::from("/usr/bin/prlimit").exists() {
        let mem = number("WORKER_MEMORY_MB", 4096) * 1024 * 1024;
        vec![
            "/usr/bin/prlimit".to_string(),
            format!("--as={mem}"),
            format!("--cpu={}", deadline.as_secs() + 30),
            format!("--fsize={}", max_entry * 8),
            "--".to_string(),
        ]
    } else {
        vec![]
    };
    // Only what the worker needs to start: where its shared libraries are. Everything else (keys, URLs) stays out.
    let pass_env: Vec<(String, String)> = ["LD_LIBRARY_PATH"]
        .iter()
        .filter_map(|n| std::env::var(n).ok().map(|v| ((*n).to_string(), v)))
        .collect();
    let config = Config {
        worker: WorkerConfig {
            program: PathBuf::from(
                std::env::var("WORKER_BIN")
                    .unwrap_or_else(|_| "/usr/local/bin/geometry-worker".to_string()),
            ),
            wrapper,
            pass_env,
            deadline,
            grace: Duration::from_secs(15),
        },
        archive: Limits {
            max_entries: 10_000,
            max_entry_bytes: max_entry,
            max_total_bytes: max_entry * 8,
        },
    };
    Ok((config, Duration::from_secs(number("POLL_SECONDS", 30))))
}

/// The database (PostgREST on plain Postgres) and the S3-compatible file store, from the same settings the backend reads.
fn backend_from_env() -> Result<Platform, String> {
    let files = S3::new(S3Settings {
        bucket: setting("S3_BUCKET")?,
        region: setting("S3_REGION")?,
        endpoint: std::env::var("S3_ENDPOINT").ok().filter(|v| !v.is_empty()),
        access_key_id: setting("S3_ACCESS_KEY_ID")?,
        secret_access_key: setting("S3_SECRET_ACCESS_KEY")?,
        path_style: std::env::var("S3_FORCE_PATH_STYLE").as_deref() == Ok("true"),
    })
    .map_err(|e| e.to_string())?;
    Platform::new(
        &setting("POSTGREST_URL")?,
        &setting("DB_JWT_SECRET")?,
        files,
    )
    .map_err(|e| e.to_string())
}

fn heartbeat_path() -> PathBuf {
    PathBuf::from(
        std::env::var("HEARTBEAT_FILE").unwrap_or_else(|_| "/tmp/cad-runner.alive".to_string()),
    )
}

#[tokio::main]
async fn main() {
    // `cad-runner health`: the container's healthcheck. Exit 0 while the heartbeat is recent.
    if std::env::args().nth(1).as_deref() == Some("health") {
        let alive = health::is_fresh(&heartbeat_path(), health::MAX_AGE);
        std::process::exit(if alive { 0 } else { 1 });
    }
    let started = config()
        .and_then(|(config, poll)| backend_from_env().map(|backend| (config, poll, backend)));
    let (config, poll, backend) = match started {
        Ok(parts) => parts,
        Err(message) => {
            eprintln!("cad-runner cannot start: {message}");
            std::process::exit(78);
        }
    };
    serve(&backend, &config, poll).await;
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
        "cad-runner started (poll every {}s, worker deadline {}s)",
        poll.as_secs(),
        config.worker.deadline.as_secs()
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
