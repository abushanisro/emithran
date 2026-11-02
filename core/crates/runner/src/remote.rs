//! The runner's side of the socket to `cad-worker-host` (wire.rs). The runner never runs the worker and never reads a path the
//! worker side chose: it sends the input bytes, and receives the outputs into memory under a count and size limit, with every
//! name checked. Whatever arrives is then parsed and verified by job.rs like any worker output.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;

use crate::wire::{self, FileEntry, PARTS_DIR, RESULT_FILE, Request, Response};
use crate::worker::{self, WorkerError};

/// How long, past the worker's deadline, the runner waits for the whole answer: the host's grace before it kills the worker
/// (worker::GRACE) plus a minute to move the files across the socket.
pub const ANSWER_MARGIN: Duration = Duration::from_secs(75);

#[derive(Clone, Debug)]
pub struct RemoteWorker {
    pub socket: PathBuf,
    pub deadline: Duration,
    /// Past the deadline, how long to wait for the answer before giving up on this attempt.
    pub answer_margin: Duration,
    pub max_outputs: usize,
    pub max_output_bytes: u64,
}

/// What the worker wrote: `result.json` (None when it wrote none) and the part files by name.
#[derive(Debug, Default)]
pub struct Output {
    pub result: Option<Vec<u8>>,
    pub parts: HashMap<String, Vec<u8>>,
}

impl RemoteWorker {
    /// Runs the worker on `inputs` (wire name, bytes) and returns what it wrote, or what its ending means for the upload.
    pub async fn run(&self, inputs: &[(String, &[u8])]) -> Result<Output, WorkerError> {
        let answer =
            tokio::time::timeout(self.deadline + self.answer_margin, self.exchange(inputs))
                .await
                .map_err(|_| {
                    WorkerError::Retryable(
                        "the geometry worker host did not answer in time".to_string(),
                    )
                })?
                .map_err(WorkerError::Retryable)?;
        let (response, output) = answer;
        worker::classify(&response.outcome)?;
        Ok(output)
    }

    async fn exchange(&self, inputs: &[(String, &[u8])]) -> Result<(Response, Output), String> {
        let mut stream = UnixStream::connect(&self.socket).await.map_err(|e| {
            format!(
                "cannot reach the geometry worker host at {}: {e}",
                self.socket.display()
            )
        })?;
        let request = Request {
            deadline_ms: u64::try_from(self.deadline.as_millis()).unwrap_or(u64::MAX),
            inputs: inputs
                .iter()
                .map(|(name, bytes)| FileEntry {
                    name: name.clone(),
                    len: bytes.len() as u64,
                })
                .collect(),
        };
        let sent: std::io::Result<()> = async {
            wire::write_header(&mut stream, &request).await?;
            for (_, bytes) in inputs {
                stream.write_all(bytes).await?;
            }
            stream.flush().await
        }
        .await;
        sent.map_err(|e| format!("cannot send the files to the geometry worker host: {e}"))?;

        let response: Response = wire::read_header(&mut stream)
            .await
            .map_err(|e| format!("unreadable answer from the geometry worker host: {e}"))?
            .ok_or("the geometry worker host closed the connection without answering")?;
        wire::check_entries(
            &response.outputs,
            self.max_outputs,
            self.max_output_bytes,
            wire::is_output_name,
        )
        .map_err(|e| format!("the geometry worker host's answer is outside its contract: {e}"))?;
        let mut output = Output::default();
        for entry in &response.outputs {
            let bytes = wire::read_body(&mut stream, entry.len)
                .await
                .map_err(|e| format!("the geometry worker host's answer was cut short: {e}"))?;
            match entry
                .name
                .strip_prefix(PARTS_DIR)
                .and_then(|r| r.strip_prefix('/'))
            {
                Some(part) => {
                    output.parts.insert(part.to_string(), bytes);
                }
                None if entry.name == RESULT_FILE => output.result = Some(bytes),
                None => {}
            }
        }
        Ok((response, output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::{Ended, Outcome};
    use tokio::io::AsyncReadExt;
    use tokio::net::UnixListener;

    fn remote(socket: PathBuf) -> RemoteWorker {
        RemoteWorker {
            socket,
            deadline: Duration::from_millis(200),
            answer_margin: Duration::from_millis(500),
            max_outputs: 3,
            max_output_bytes: 100,
        }
    }

    /// A stand-in for a compromised host: reads the request, then answers with `outputs` (names, declared sizes) and `body`.
    fn hostile_host(
        dir: &std::path::Path,
        outputs: &[(&str, u64)],
        body: &'static [u8],
    ) -> PathBuf {
        let socket = dir.join("h.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let outputs: Vec<FileEntry> = outputs
            .iter()
            .map(|(name, len)| FileEntry {
                name: (*name).to_string(),
                len: *len,
            })
            .collect();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request: Request = wire::read_header(&mut stream).await.unwrap().unwrap();
            let total: u64 = request.inputs.iter().map(|e| e.len).sum();
            wire::read_body(&mut stream, total).await.unwrap();
            let response = Response {
                outcome: Outcome {
                    ended: Ended::Exited(0),
                    tail: String::new(),
                },
                outputs,
            };
            wire::write_header(&mut stream, &response).await.unwrap();
            stream.write_all(body).await.unwrap();
            let _ = stream.read_u8().await; // hold the connection open until the runner hangs up
        });
        socket
    }

    fn retryable(result: Result<Output, WorkerError>) -> String {
        match result {
            Err(WorkerError::Retryable(message)) => message,
            other => panic!("expected a retryable error, got {other:?}"),
        }
    }

    const INPUT: &[u8] = b"A";

    fn inputs() -> [(String, &'static [u8]); 1] {
        [("0000_a.step".to_string(), INPUT)]
    }

    #[tokio::test]
    async fn outputs_arrive_in_memory_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let socket = hostile_host(
            dir.path(),
            &[("result.json", 2), ("parts/0_1.step", 4)],
            b"{}STEP",
        );
        let output = remote(socket).run(&inputs()).await.unwrap();
        assert_eq!(output.result.as_deref(), Some(&b"{}"[..]));
        assert_eq!(
            output.parts.get("0_1.step").map(Vec::as_slice),
            Some(&b"STEP"[..])
        );
    }

    #[tokio::test]
    async fn an_output_name_that_leaves_its_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let socket = hostile_host(dir.path(), &[("parts/../../etc/x", 1)], b"x");
        let message = retryable(remote(socket).run(&inputs()).await);
        assert!(message.contains("outside its contract"), "{message}");
    }

    #[tokio::test]
    async fn outputs_beyond_the_size_limit_are_refused_before_they_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let socket = hostile_host(dir.path(), &[("result.json", 1 << 40)], b"");
        let message = retryable(remote(socket).run(&inputs()).await);
        assert!(message.contains("more than the 100 allowed"), "{message}");
    }

    #[tokio::test]
    async fn an_answer_that_stops_short_is_given_up_at_the_time_limit() {
        let dir = tempfile::tempdir().unwrap();
        let socket = hostile_host(dir.path(), &[("result.json", 50)], b"{}");
        let message = retryable(remote(socket).run(&inputs()).await);
        assert!(message.contains("did not answer in time"), "{message}");
    }

    #[tokio::test]
    async fn no_host_listening_is_retryable() {
        let dir = tempfile::tempdir().unwrap();
        let message = retryable(remote(dir.path().join("missing.sock")).run(&inputs()).await);
        assert!(
            message.contains("cannot reach the geometry worker host"),
            "{message}"
        );
    }
}
