//! `cad-worker-host`: runs the geometry worker for `cad-runner`, inside the worker container (no credential, no network, read-only
//! root, its own UID). See host.rs and docs/ASSEMBLY_CORE.md "Isolation".

use std::path::PathBuf;

use runner::host::{self, HostConfig};
use runner::secrets;
use runner::worker::{GRACE, ResourceLimits};

fn number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

const MIB: u64 = 1024 * 1024;
const PRLIMIT: &str = "/usr/bin/prlimit";

fn socket_path() -> PathBuf {
    PathBuf::from(
        std::env::var("WORKER_SOCKET")
            .unwrap_or_else(|_| "/run/cad-worker/worker.sock".to_string()),
    )
}

fn config() -> Result<HostConfig, String> {
    // This container must not hold a credential: refuse to run where one was passed in by mistake.
    if let Some(name) = secrets::NAMES
        .iter()
        .find(|n| std::env::var_os(n).is_some())
    {
        return Err(format!(
            "{name} is set; the worker container must hold no credential"
        ));
    }
    // As the container's first process the host can remove whatever a worker leaves behind between jobs (host.rs).
    if !host::is_namespace_init() {
        return Err("it must be the container's first process (PID 1)".to_string());
    }
    let prlimit = PathBuf::from(PRLIMIT);
    if !prlimit.exists() {
        return Err(format!(
            "{PRLIMIT} is missing; the worker never runs without limits"
        ));
    }
    let max_upload = number("MAX_UPLOAD_MB", 50) * MIB;
    Ok(HostConfig {
        program: PathBuf::from(
            std::env::var("WORKER_BIN")
                .unwrap_or_else(|_| "/usr/local/bin/geometry-worker".to_string()),
        ),
        limits: Some((
            prlimit,
            ResourceLimits {
                memory_bytes: number("WORKER_MEMORY_MB", 4096) * MIB,
                // An upload expands to at most 8x its size (core/crates/archive limits), and no output file can be larger.
                file_bytes: max_upload * 8,
            },
        )),
        // Only what the worker needs to start: where its shared libraries are.
        pass_env: ["LD_LIBRARY_PATH"]
            .iter()
            .filter_map(|n| std::env::var(n).ok().map(|v| ((*n).to_string(), v)))
            .collect(),
        grace: GRACE,
        scratch: std::env::temp_dir(),
        max_inputs: 10_000,
        max_input_bytes: max_upload * 8,
        sweep: true,
    })
}

fn fail(message: &str) -> ! {
    eprintln!("cad-worker-host cannot start: {message}");
    std::process::exit(78);
}

#[tokio::main]
async fn main() {
    // `cad-worker-host health`: the container's healthcheck. Exit 0 while the socket accepts connections.
    if std::env::args().nth(1).as_deref() == Some("health") {
        std::process::exit(if host::is_listening(&socket_path()).await {
            0
        } else {
            1
        });
    }
    let config = config().unwrap_or_else(|message| fail(&message));
    let socket = socket_path();
    let listener = host::bind(&socket)
        .unwrap_or_else(|error| fail(&format!("cannot listen at {}: {error}", socket.display())));
    eprintln!("cad-worker-host listening at {}", socket.display());
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .unwrap_or_else(|error| fail(&format!("cannot watch for SIGTERM: {error}")));
    // As PID 1 the default signal actions do not apply, so a stop request is handled here.
    tokio::select! {
        served = host::serve(listener, config) => {
            if let Err(error) = served {
                eprintln!("cad-worker-host stopped: {error}");
                std::process::exit(1);
            }
        }
        _ = terminate.recv() => eprintln!("cad-worker-host stopped"),
        _ = tokio::signal::ctrl_c() => eprintln!("cad-worker-host stopped"),
    }
}
