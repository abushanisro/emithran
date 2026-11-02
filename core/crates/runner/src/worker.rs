//! Runs the geometry worker as a supervised child process: hard deadline, empty environment, resource limits, and an exit code
//! contract (Petrus D109). The worker is the only place CAD is parsed. It runs inside `cad-worker-host` (host.rs), in the worker
//! container that holds no credential and has no network; the runner only receives the `Outcome` over the socket (wire.rs) and
//! decides what it means with `classify`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// How long past its own deadline the worker may take to exit before it is killed.
pub const GRACE: Duration = Duration::from_secs(15);

/// How much of the end of the worker's stderr is kept for a failure message.
const TAIL_BYTES: usize = 300;

#[derive(Clone, Debug)]
pub struct WorkerConfig {
    pub program: PathBuf,
    /// A command that wraps the worker to limit it, e.g. `prlimit --as=4294967296 --cpu=630 --fsize=2147483648 --`. Empty: none.
    pub wrapper: Vec<String>,
    pub deadline: Duration,
    /// The only variables the worker sees (e.g. LD_LIBRARY_PATH for the shared libraries it links). Never a credential.
    pub pass_env: Vec<(String, String)>,
    /// How long past its own deadline the worker may take to exit before it is killed.
    pub grace: Duration,
}

/// Resource limits applied to every worker run with `prlimit` (Linux).
#[derive(Clone, Copy, Debug)]
pub struct ResourceLimits {
    pub memory_bytes: u64,
    pub file_bytes: u64,
}

impl ResourceLimits {
    /// The `prlimit` wrapper for one run: address space, CPU seconds (the deadline plus 30 s) and the size of any one file.
    pub fn wrapper(&self, prlimit: &Path, deadline: Duration) -> Vec<String> {
        vec![
            prlimit.display().to_string(),
            format!("--as={}", self.memory_bytes),
            format!("--cpu={}", deadline.as_secs() + 30),
            format!("--fsize={}", self.file_bytes),
            "--".to_string(),
        ]
    }
}

/// How a worker run ended, as the host saw it. Carries no meaning of its own: `classify` decides what each one means.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ended {
    /// Exited by itself with this code.
    Exited(i32),
    /// Killed by a signal (a crash or a resource limit).
    Signalled,
    /// Still running `grace` after its deadline, so it was killed.
    Overran,
    /// Never ran, or could not be waited for (the reason, without file content).
    NotRun(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub ended: Ended,
    /// The end of the worker's stderr: printable, whitespace collapsed, at most `TAIL_BYTES`.
    pub tail: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerError {
    /// The files themselves are at fault; trying again cannot help.
    Permanent { code: &'static str, message: String },
    /// A crash, a deadline or an overloaded host: another attempt may succeed.
    Retryable(String),
}

/// What an outcome means for the upload. The runner calls this on what the host reported. The text is cleaned again here: the
/// host shares its container with the worker, so its answer is trusted no further than the worker's.
pub fn classify(outcome: &Outcome) -> Result<(), WorkerError> {
    let tail = clean_tail(outcome.tail.as_bytes());
    match &outcome.ended {
        Ended::Exited(code) => from_exit(*code, &tail),
        Ended::Signalled => Err(WorkerError::Retryable(
            "the worker was killed by a signal (a crash or a resource limit)".to_string(),
        )),
        Ended::Overran => Err(WorkerError::Retryable(
            "the worker did not stop at its deadline and was killed".to_string(),
        )),
        Ended::NotRun(reason) => Err(WorkerError::Retryable(clean_tail(reason.as_bytes()))),
    }
}

/// Exit codes of the worker contract.
fn from_exit(code: i32, tail: &str) -> Result<(), WorkerError> {
    let detail = |what: &str| {
        if tail.is_empty() {
            what.to_string()
        } else {
            format!("{what}: {tail}")
        }
    };
    match code {
        0 => Ok(()),
        2 => Err(WorkerError::Permanent {
            code: "unreadable_step",
            message: detail("None of the STEP files could be read"),
        }),
        3 => Err(WorkerError::Permanent {
            code: "no_solids",
            message: detail("The STEP files hold no solids"),
        }),
        4 => Err(WorkerError::Retryable(detail(
            "the worker hit its deadline",
        ))),
        6 => Err(WorkerError::Retryable(detail(
            "the worker's analysis failed",
        ))),
        other => Err(WorkerError::Retryable(detail(&format!(
            "the worker exited with code {other}"
        )))),
    }
}

/// The last bytes of a message, printable and short, so a failure is diagnosable without logging file content.
fn clean_tail(bytes: &[u8]) -> String {
    let start = bytes.len().saturating_sub(TAIL_BYTES);
    let text = String::from_utf8_lossy(bytes.get(start..).unwrap_or_default());
    text.split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn not_run(what: &str, error: impl std::fmt::Display) -> Outcome {
    Outcome {
        ended: Ended::NotRun(format!("{what}: {error}")),
        tail: String::new(),
    }
}

/// Runs the worker once on `inputs`, writing into `out_dir`, and reports how it ended.
pub async fn run(config: &WorkerConfig, out_dir: &Path, inputs: &[PathBuf]) -> Outcome {
    let stderr_path = out_dir.join("stderr.txt");
    let stderr = match std::fs::File::create(&stderr_path) {
        Ok(file) => file,
        Err(e) => return not_run("cannot create the worker log", e),
    };

    let (program, prefix): (&Path, &[String]) = match config.wrapper.split_first() {
        Some((first, rest)) => (Path::new(first), rest),
        None => (&config.program, &[]),
    };
    let mut command = Command::new(program);
    command.args(prefix);
    if !config.wrapper.is_empty() {
        command.arg(&config.program);
    }
    command
        .arg("--deadline-ms")
        .arg(config.deadline.as_millis().to_string())
        .arg(out_dir)
        .args(inputs)
        .env_clear() // nothing from the host's environment (which holds no credential either)
        .envs(config.pass_env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr)
        .kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => return not_run("cannot start the worker", e),
    };
    let ended = match tokio::time::timeout(config.deadline + config.grace, child.wait()).await {
        Err(_) => {
            let _ = child.kill().await;
            Ended::Overran
        }
        Ok(Err(e)) => return not_run("cannot wait for the worker", e),
        Ok(Ok(status)) => status.code().map_or(Ended::Signalled, Ended::Exited),
    };
    let tail = clean_tail(&std::fs::read(&stderr_path).unwrap_or_default());
    Outcome { ended, tail }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exited(code: i32) -> Result<(), WorkerError> {
        classify(&Outcome {
            ended: Ended::Exited(code),
            tail: String::new(),
        })
    }

    #[test]
    fn exit_codes_follow_the_contract() {
        assert_eq!(exited(0), Ok(()));
        assert!(matches!(
            exited(2),
            Err(WorkerError::Permanent {
                code: "unreadable_step",
                ..
            })
        ));
        assert!(matches!(
            exited(3),
            Err(WorkerError::Permanent {
                code: "no_solids",
                ..
            })
        ));
        assert!(matches!(exited(4), Err(WorkerError::Retryable(_))));
        assert!(matches!(exited(6), Err(WorkerError::Retryable(_))));
        assert!(matches!(exited(139), Err(WorkerError::Retryable(_))));
    }

    #[test]
    fn a_signal_an_overrun_or_no_run_is_retryable() {
        for ended in [Ended::Signalled, Ended::Overran, Ended::NotRun("x".into())] {
            let outcome = Outcome {
                ended,
                tail: String::new(),
            };
            assert!(matches!(classify(&outcome), Err(WorkerError::Retryable(_))));
        }
    }

    #[test]
    fn the_worker_message_is_included_but_short_and_printable() {
        let outcome = Outcome {
            ended: Ended::Exited(6),
            tail: format!("{}\u{1b}[31mboom\n", "x".repeat(1000)),
        };
        let Err(WorkerError::Retryable(message)) = classify(&outcome) else {
            panic!("expected a retryable error")
        };
        assert!(message.ends_with(" [31mboom"), "{message}");
        assert!(message.len() < 400, "{}", message.len());
        assert!(!message.contains('\u{1b}'));
    }

    #[test]
    fn the_wrapper_limits_cpu_to_the_deadline_plus_a_margin() {
        let limits = ResourceLimits {
            memory_bytes: 10,
            file_bytes: 20,
        };
        assert_eq!(
            limits.wrapper(Path::new("/usr/bin/prlimit"), Duration::from_secs(600)),
            [
                "/usr/bin/prlimit",
                "--as=10",
                "--cpu=630",
                "--fsize=20",
                "--"
            ]
        );
    }
}
