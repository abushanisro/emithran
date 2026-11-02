//! `cad-worker-host`: the process in the worker container that runs the geometry worker for the runner. The container has no
//! credential, no network and a read-only root; the host listens on a Unix socket on a volume shared only with the runner, takes
//! one job at a time (wire.rs), writes the inputs to its scratch folder, runs the worker (worker.rs) and streams back how it ended
//! and what it wrote.
//!
//! Between jobs, as the container's first process, it kills every other process in the container and empties the scratch folder,
//! so nothing a worker started or left behind can read or change the next upload (which may belong to another organization).

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};

use crate::wire::{self, FileEntry, PARTS_DIR, RESULT_FILE, Request, Response};
use crate::worker::{self, Ended, Outcome, ResourceLimits, WorkerConfig};

#[derive(Clone, Debug)]
pub struct HostConfig {
    pub program: PathBuf,
    /// `prlimit` and the limits it applies to every run; None runs the worker without them (tests only: the binary refuses).
    pub limits: Option<(PathBuf, ResourceLimits)>,
    /// The only variables the worker sees (LD_LIBRARY_PATH). Never a credential.
    pub pass_env: Vec<(String, String)>,
    pub grace: Duration,
    /// Where jobs are unpacked. Emptied after every job when `sweep` is on, so it must be used for nothing else.
    pub scratch: PathBuf,
    pub max_inputs: usize,
    pub max_input_bytes: u64,
    /// Kill every other process and empty `scratch` after each job. Only as PID 1 of its own container.
    pub sweep: bool,
}

/// Listens at `path`, replacing a socket a previous run left behind, readable and writable by owner and group only (the runner
/// joins the host's group).
pub fn bind(path: &Path) -> io::Result<UnixListener> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    let listener = UnixListener::bind(path)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660))?;
    Ok(listener)
}

/// Serves jobs one after the other, until the listener fails.
pub async fn serve(listener: UnixListener, config: HostConfig) -> io::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        if let Err(error) = handle(stream, &config).await {
            eprintln!("cad-worker-host: {error}");
        }
        if config.sweep {
            sweep(&config.scratch);
        }
    }
}

async fn handle(mut stream: UnixStream, config: &HostConfig) -> Result<(), String> {
    let request: Request = match wire::read_header(&mut stream).await {
        Ok(Some(request)) => request,
        Ok(None) => return Ok(()), // a health probe
        Err(e) => return Err(format!("unreadable request: {e}")),
    };
    if let Err(problem) = wire::check_entries(
        &request.inputs,
        config.max_inputs,
        config.max_input_bytes,
        wire::is_plain_name,
    ) {
        let outcome = Outcome {
            ended: Ended::NotRun(format!("refused the request: {problem}")),
            tail: String::new(),
        };
        return answer(&mut stream, outcome, None).await;
    }
    let work = tempfile::tempdir_in(&config.scratch)
        .map_err(|e| format!("cannot create a work folder: {e}"))?;
    let (in_dir, out_dir) = (work.path().join("in"), work.path().join("out"));
    for dir in [&in_dir, &out_dir, &out_dir.join(PARTS_DIR)] {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create a work folder: {e}"))?;
    }
    let mut inputs = Vec::with_capacity(request.inputs.len());
    for entry in &request.inputs {
        let path = in_dir.join(&entry.name);
        let mut file = tokio::fs::File::create(&path)
            .await
            .map_err(|e| format!("cannot write an input: {e}"))?;
        let copied = tokio::io::copy(&mut (&mut stream).take(entry.len), &mut file)
            .await
            .map_err(|e| format!("cannot receive an input: {e}"))?;
        if copied != entry.len {
            return Err("the request ended before its inputs did".to_string());
        }
        inputs.push(path);
    }

    let deadline = Duration::from_millis(request.deadline_ms);
    let run = WorkerConfig {
        program: config.program.clone(),
        wrapper: config
            .limits
            .as_ref()
            .map(|(prlimit, limits)| limits.wrapper(prlimit, deadline))
            .unwrap_or_default(),
        pass_env: config.pass_env.clone(),
        deadline,
        grace: config.grace,
    };
    let outcome = worker::run(&run, &out_dir, &inputs).await;
    answer(&mut stream, outcome, Some(&out_dir)).await
}

/// Sends how the worker ended and what it wrote under `out_dir`: `result.json` and the regular files in `parts/`. Links, folders
/// and anything else are left out.
async fn answer(
    stream: &mut UnixStream,
    outcome: Outcome,
    out_dir: Option<&Path>,
) -> Result<(), String> {
    let files = out_dir.map(outputs).unwrap_or_default();
    let response = Response {
        outcome,
        outputs: files.iter().map(|(entry, _)| entry.clone()).collect(),
    };
    wire::write_header(stream, &response)
        .await
        .map_err(|e| format!("cannot answer: {e}"))?;
    for (entry, path) in &files {
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|e| format!("cannot read {}: {e}", entry.name))?;
        let sent = tokio::io::copy(&mut (&mut file).take(entry.len), stream)
            .await
            .map_err(|e| format!("cannot send {}: {e}", entry.name))?;
        if sent != entry.len {
            return Err(format!("{} changed size while it was sent", entry.name));
        }
    }
    stream
        .flush()
        .await
        .map_err(|e| format!("cannot answer: {e}"))
}

fn regular_file(path: &Path) -> Option<u64> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    meta.file_type().is_file().then_some(meta.len())
}

fn outputs(out_dir: &Path) -> Vec<(FileEntry, PathBuf)> {
    let mut found = Vec::new();
    let result = out_dir.join(RESULT_FILE);
    if let Some(len) = regular_file(&result) {
        found.push((
            FileEntry {
                name: RESULT_FILE.to_string(),
                len,
            },
            result,
        ));
    }
    let mut parts: Vec<(FileEntry, PathBuf)> = std::fs::read_dir(out_dir.join(PARTS_DIR))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let len = regular_file(&entry.path())?;
            wire::is_plain_name(&name).then(|| {
                (
                    FileEntry {
                        name: format!("{PARTS_DIR}/{name}"),
                        len,
                    },
                    entry.path(),
                )
            })
        })
        .collect();
    parts.sort_by(|a, b| a.0.name.cmp(&b.0.name));
    found.extend(parts);
    found
}

/// Kills every other process in this PID namespace, reaps them, and empties the scratch folder.
fn sweep(scratch: &Path) {
    kill_others();
    empty(scratch);
}

fn empty(folder: &Path) {
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            let removed = match entry.file_type() {
                Ok(kind) if kind.is_dir() => std::fs::remove_dir_all(&path),
                _ => std::fs::remove_file(&path),
            };
            if let Err(error) = removed {
                eprintln!("cad-worker-host: cannot remove {}: {error}", path.display());
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn kill_others() {
    use rustix::process::{Pid, Signal, WaitOptions, kill_process, wait};
    let me = std::process::id();
    // A process may fork while the list is read; repeat until a pass finds nobody (bounded, as a fork bomb hits the pids limit).
    for _ in 0..100 {
        let others: Vec<Pid> = std::fs::read_dir("/proc")
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
            .filter(|pid| u32::try_from(*pid).ok() != Some(me))
            .filter_map(Pid::from_raw)
            .collect();
        if others.is_empty() {
            break;
        }
        for pid in others {
            let _ = kill_process(pid, Signal::KILL);
        }
        while let Ok(Some(_)) = wait(WaitOptions::NOHANG) {}
    }
}

#[cfg(not(target_os = "linux"))]
fn kill_others() {}

/// Whether this process is the first one of its PID namespace (a container's init), the only place `sweep` is safe.
pub fn is_namespace_init() -> bool {
    std::process::id() == 1
}

/// `cad-worker-host health`: the socket accepts a connection.
pub async fn is_listening(path: &Path) -> bool {
    UnixStream::connect(path).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_result_json_and_regular_part_files_are_sent() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path();
        std::fs::create_dir_all(out.join("parts/nested")).unwrap();
        std::fs::write(out.join("result.json"), b"{}").unwrap();
        std::fs::write(out.join("stderr.txt"), b"log").unwrap();
        std::fs::write(out.join("parts/0_1.step"), b"STEP").unwrap();
        std::fs::write(out.join("parts/nested/x.step"), b"no").unwrap();
        std::os::unix::fs::symlink("/etc/hosts", out.join("parts/link.step")).unwrap();
        let names: Vec<(String, u64)> = outputs(out)
            .into_iter()
            .map(|(e, _)| (e.name, e.len))
            .collect();
        assert_eq!(
            names,
            [("result.json".into(), 2), ("parts/0_1.step".into(), 4)]
        );
    }

    #[test]
    fn a_result_json_link_is_not_followed() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.path().join("result.json")).unwrap();
        assert!(outputs(dir.path()).is_empty());
    }

    #[test]
    fn emptying_the_scratch_folder_removes_files_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("job/out")).unwrap();
        std::fs::write(dir.path().join("job/out/x"), b"x").unwrap();
        std::fs::write(dir.path().join("stash"), b"x").unwrap();
        empty(dir.path());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(dir.path().exists());
    }
}
