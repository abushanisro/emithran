use std::path::PathBuf;
use std::time::Duration;

use archive::Limits;
use runner::backend::Supabase;
use runner::job::{self, Config};
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

fn config() -> Result<(Config, Supabase, Duration), String> {
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
    let config = Config {
        worker: WorkerConfig {
            program: PathBuf::from(
                std::env::var("WORKER_BIN")
                    .unwrap_or_else(|_| "/usr/local/bin/geometry-worker".to_string()),
            ),
            wrapper,
            deadline,
            grace: Duration::from_secs(15),
        },
        archive: Limits {
            max_entries: 10_000,
            max_entry_bytes: max_entry,
            max_total_bytes: max_entry * 8,
        },
    };
    let backend = Supabase::new(&setting("SUPABASE_URL")?, &setting("SUPABASE_SECRET_KEY")?)
        .map_err(|e| e.to_string())?;
    Ok((
        config,
        backend,
        Duration::from_secs(number("POLL_SECONDS", 30)),
    ))
}

#[tokio::main]
async fn main() {
    let (config, backend, poll) = match config() {
        Ok(parts) => parts,
        Err(message) => {
            eprintln!("cad-runner cannot start: {message}");
            std::process::exit(78);
        }
    };
    eprintln!(
        "cad-runner started (poll every {}s, worker deadline {}s)",
        poll.as_secs(),
        config.worker.deadline.as_secs()
    );
    loop {
        // Drain the queue, then sleep; a stop signal ends the loop between uploads, never in the middle of one.
        match job::run_once(&backend, &config).await {
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
