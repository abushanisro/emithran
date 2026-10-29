//! Runs the geometry worker as a supervised child process: hard deadline, empty environment, bounded output, and an exit code
//! contract (Petrus D109). The worker is the only place CAD is parsed; whatever it does, the runner survives it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

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

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerError {
    /// The files themselves are at fault; trying again cannot help.
    Permanent { code: &'static str, message: String },
    /// A crash, a deadline or an overloaded host: another attempt may succeed.
    Retryable(String),
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

/// The last bytes of the worker's own message, printable and short, so a failure is diagnosable without logging file content.
fn tail_of(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_default();
    let start = bytes.len().saturating_sub(300);
    let text = String::from_utf8_lossy(bytes.get(start..).unwrap_or_default());
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn run(
    config: &WorkerConfig,
    out_dir: &Path,
    inputs: &[PathBuf],
) -> Result<(), WorkerError> {
    let stderr_path = out_dir.join("stderr.txt");
    let stderr = std::fs::File::create(&stderr_path)
        .map_err(|e| WorkerError::Retryable(format!("cannot create the worker log: {e}")))?;

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
        .env_clear() // no credentials ever reach the process that parses customer files
        .envs(config.pass_env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr)
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| WorkerError::Retryable(format!("cannot start the worker: {e}")))?;
    match tokio::time::timeout(config.deadline + config.grace, child.wait()).await {
        Err(_) => {
            let _ = child.kill().await;
            Err(WorkerError::Retryable(
                "the worker did not stop at its deadline and was killed".to_string(),
            ))
        }
        Ok(Err(e)) => Err(WorkerError::Retryable(format!(
            "cannot wait for the worker: {e}"
        ))),
        Ok(Ok(status)) => match status.code() {
            Some(code) => from_exit(code, &tail_of(&stderr_path)),
            None => Err(WorkerError::Retryable(
                "the worker was killed by a signal (a crash or a resource limit)".to_string(),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_follow_the_contract() {
        assert_eq!(from_exit(0, ""), Ok(()));
        assert!(matches!(
            from_exit(2, ""),
            Err(WorkerError::Permanent {
                code: "unreadable_step",
                ..
            })
        ));
        assert!(matches!(
            from_exit(3, ""),
            Err(WorkerError::Permanent {
                code: "no_solids",
                ..
            })
        ));
        assert!(matches!(from_exit(4, ""), Err(WorkerError::Retryable(_))));
        assert!(matches!(from_exit(6, ""), Err(WorkerError::Retryable(_))));
        assert!(matches!(from_exit(139, ""), Err(WorkerError::Retryable(_))));
    }

    #[test]
    fn the_worker_message_is_included_but_short() {
        let Err(WorkerError::Retryable(message)) = from_exit(6, "boom") else {
            panic!("expected a retryable error")
        };
        assert!(message.ends_with(": boom"));
    }
}
