//! One upload, start to finish: download -> unzip -> geometry worker -> verify -> store the parts -> mark `analysed`.
//! The API never parses CAD and neither does this file: the worker does, in its own process, and what it writes is checked
//! (typed parse + `domain::verify`) before anything is stored. A wrong number is worse than a missing one.

use std::collections::HashMap;
use std::path::PathBuf;

use archive::Limits;
use domain::{Kind, Node, Report};
use serde::Serialize;

use crate::backend::{Backend, BackendError, Row};
use crate::names::{part_file_name, restore_file_names, wire_name};
use crate::worker::{self, WorkerConfig, WorkerError};

pub const MAX_ATTEMPTS: u32 = 3;
pub const STALE_SECONDS: u32 = 1800;

#[derive(Clone, Debug)]
pub struct Config {
    pub worker: WorkerConfig,
    pub archive: Limits,
}

/// Why an upload did not finish. `Permanent` is the upload's own fault (bad zip, no solids, a worker answer outside the
/// contract); everything else may pass on another attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    Permanent { code: String, message: String },
    Retryable(String),
}

impl Failure {
    fn permanent(code: &str, message: impl Into<String>) -> Self {
        Failure::Permanent {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl From<BackendError> for Failure {
    fn from(error: BackendError) -> Self {
        Failure::Retryable(error.0)
    }
}

impl From<WorkerError> for Failure {
    fn from(error: WorkerError) -> Self {
        match error {
            WorkerError::Permanent { code, message } => Failure::permanent(code, message),
            WorkerError::Retryable(message) => Failure::Retryable(message),
        }
    }
}

#[derive(Serialize)]
struct Skip {
    path: String,
    reason: String,
}

#[derive(Serialize)]
struct Stored<'a> {
    report: &'a Report,
    skipped: Vec<Skip>,
}

struct StepFile {
    /// Path inside the upload (without the archive's own folder).
    name: String,
    bytes: Vec<u8>,
}

/// The STEP files of an upload: a single STEP is itself; a zip is expanded under the caller's limits.
fn step_files(
    row: &Row,
    bytes: Vec<u8>,
    limits: Limits,
) -> Result<(Vec<StepFile>, Vec<Skip>), Failure> {
    if !archive::is_archive_name(&row.file_name) {
        return Ok((
            vec![StepFile {
                name: row.file_name.clone(),
                bytes,
            }],
            vec![],
        ));
    }
    let expanded = archive::expand(&row.file_name, &bytes, limits)
        .map_err(|e| Failure::permanent(e.code(), format!("{e:?}")))?;
    let mut skipped: Vec<Skip> = expanded
        .skipped
        .into_iter()
        .map(|s| Skip {
            path: s.path,
            reason: s.reason.to_string(),
        })
        .collect();
    let mut files = Vec::new();
    for entry in expanded.entries {
        let inner = entry
            .path
            .get(expanded.root.len() + 1..)
            .unwrap_or(&entry.path)
            .to_string();
        let lower = entry.name.to_ascii_lowercase();
        if lower.ends_with(".step") || lower.ends_with(".stp") {
            files.push(StepFile {
                name: inner,
                bytes: entry.bytes,
            });
        } else {
            skipped.push(Skip {
                path: inner,
                reason: "not a STEP file".to_string(),
            });
        }
    }
    if files.is_empty() {
        return Err(Failure::permanent(
            "no_step_files",
            "The archive holds no STEP files.",
        ));
    }
    Ok((files, skipped))
}

/// Part nodes that are a whole uploaded file (a single-part STEP): their stored bytes are the file the customer sent, not a
/// re-export, so nothing in the original (colours, attributes) is lost.
fn own_file_parts(nodes: &[Node], out: &mut HashMap<String, String>) {
    for node in nodes {
        if node.kind == Kind::Part {
            out.insert(node.definition.clone(), node.file.clone());
        }
    }
}

/// Where a part's STEP is kept until the materializer has attached it to a BOM item.
pub fn part_path(row: &Row, definition: &str) -> String {
    format!(
        "cad-uploads/{}/{}/parts/{}",
        row.organization_id,
        row.id,
        part_file_name(definition)
    )
}

pub async fn process<B: Backend>(backend: &B, config: &Config, row: &Row) -> Result<(), Failure> {
    if row.source_deleted_at.is_some() {
        return Err(Failure::permanent(
            "source_expired",
            "The original upload was removed to save space. Upload the file again.",
        ));
    }
    let bytes = backend.download(&row.storage_path).await?;
    let (files, skipped) = step_files(row, bytes, config.archive)?;

    let work = tempfile::tempdir()
        .map_err(|e| Failure::Retryable(format!("cannot create a work folder: {e}")))?;
    let (in_dir, out_dir) = (work.path().join("in"), work.path().join("out"));
    for dir in [&in_dir, &out_dir, &out_dir.join("parts")] {
        std::fs::create_dir_all(dir)
            .map_err(|e| Failure::Retryable(format!("cannot create a work folder: {e}")))?;
    }
    let mut inputs: Vec<PathBuf> = Vec::new();
    for (i, file) in files.iter().enumerate() {
        let path = in_dir.join(wire_name(i, &file.name));
        std::fs::write(&path, &file.bytes)
            .map_err(|e| Failure::Retryable(format!("cannot write a work file: {e}")))?;
        inputs.push(path);
    }

    worker::run(&config.worker, &out_dir, &inputs).await?;

    let raw = std::fs::read(out_dir.join("result.json"))
        .map_err(|e| Failure::Retryable(format!("the worker wrote no result.json: {e}")))?;
    let mut report: Report = serde_json::from_slice(&raw).map_err(|e| {
        Failure::permanent(
            "invalid_engine_result",
            format!("the worker's result is outside its contract: {e}"),
        )
    })?;
    let violations = domain::verify(&report);
    if !violations.is_empty() {
        let shown = violations
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ");
        return Err(Failure::permanent(
            "invalid_engine_result",
            format!("the worker's result disagrees with itself: {shown}"),
        ));
    }
    if report.assembly.is_empty() {
        return Err(Failure::permanent(
            "no_solids",
            "None of the STEP files could be read as a part or assembly.",
        ));
    }
    let names: Vec<String> = files.iter().map(|f| f.name.clone()).collect();
    restore_file_names(&mut report, &names);

    // One stored object per distinct part: the original file for a part that is a whole file, else the worker's export.
    let mut own = HashMap::new();
    own_file_parts(&report.assembly, &mut own);
    let original: HashMap<&str, &[u8]> = files
        .iter()
        .map(|f| (f.name.as_str(), f.bytes.as_slice()))
        .collect();
    let mut stored: Vec<String> = Vec::new();
    for part in &report.parts {
        let bytes = match own
            .get(&part.id)
            .and_then(|file| original.get(file.as_str()))
        {
            Some(bytes) => bytes.to_vec(),
            None => std::fs::read(out_dir.join("parts").join(part_file_name(&part.id))).map_err(
                |e| Failure::Retryable(format!("the worker did not return part {}: {e}", part.id)),
            )?,
        };
        let path = part_path(row, &part.id);
        if let Err(error) = backend.upload(&path, bytes).await {
            cleanup(backend, &stored).await;
            return Err(error.into());
        }
        stored.push(path);
    }

    let value = serde_json::to_value(Stored {
        report: &report,
        skipped,
    })
    .map_err(|e| Failure::Retryable(format!("cannot encode the result: {e}")))?;
    if let Err(error) = backend.mark_analysed(&row.id, &value).await {
        cleanup(backend, &stored).await;
        return Err(error.into());
    }
    Ok(())
}

/// A failed attempt leaves nothing behind. A cleanup that itself fails is only logged: the next attempt overwrites the same paths.
async fn cleanup<B: Backend>(backend: &B, paths: &[String]) {
    if let Err(error) = backend.remove(paths).await {
        eprintln!(
            "could not remove {} partial part file(s): {error}",
            paths.len()
        );
    }
}

/// Claims one upload and processes it. Ok(true) when there was one (done or failed), Ok(false) when the queue was empty.
pub async fn run_once<B: Backend>(backend: &B, config: &Config) -> Result<bool, BackendError> {
    let Some(row) = backend.claim(STALE_SECONDS, MAX_ATTEMPTS).await? else {
        return Ok(false);
    };
    if let Err(failure) = process(backend, config, &row).await {
        let (permanent, code, detail) = match &failure {
            Failure::Permanent { code, message } => (true, code.as_str(), message.as_str()),
            Failure::Retryable(message) => (false, "processing_failed", message.as_str()),
        };
        let retry = !permanent && row.attempts < MAX_ATTEMPTS;
        let detail: String = detail.chars().take(500).collect();
        eprintln!(
            "CAD upload {} {}: {detail}",
            row.id,
            if retry { "will be retried" } else { "failed" }
        );
        backend.mark_failed(&row.id, retry, code, &detail).await?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use super::*;

    // ---- a fake backend that records what the runner does -------------------------------------------------------------

    #[derive(Default)]
    struct Fake {
        queue: RefCell<Option<Row>>,
        source: Vec<u8>,
        /// The Nth upload (0-based) fails.
        fail_upload_at: Option<usize>,
        uploads: RefCell<Vec<(String, Vec<u8>)>>,
        removed: RefCell<Vec<String>>,
        analysed: RefCell<Option<(String, serde_json::Value)>>,
        failed: RefCell<Option<(String, bool, String, String)>>,
    }

    impl Backend for Fake {
        async fn claim(&self, _: u32, _: u32) -> Result<Option<Row>, BackendError> {
            Ok(self.queue.borrow_mut().take())
        }
        async fn download(&self, _: &str) -> Result<Vec<u8>, BackendError> {
            Ok(self.source.clone())
        }
        async fn upload(&self, path: &str, bytes: Vec<u8>) -> Result<(), BackendError> {
            if self.fail_upload_at == Some(self.uploads.borrow().len()) {
                return Err(BackendError("storage is down".into()));
            }
            self.uploads.borrow_mut().push((path.to_string(), bytes));
            Ok(())
        }
        async fn remove(&self, paths: &[String]) -> Result<(), BackendError> {
            self.removed.borrow_mut().extend(paths.iter().cloned());
            Ok(())
        }
        async fn mark_analysed(
            &self,
            id: &str,
            result: &serde_json::Value,
        ) -> Result<(), BackendError> {
            *self.analysed.borrow_mut() = Some((id.to_string(), result.clone()));
            Ok(())
        }
        async fn mark_failed(
            &self,
            id: &str,
            retry: bool,
            code: &str,
            detail: &str,
        ) -> Result<(), BackendError> {
            *self.failed.borrow_mut() =
                Some((id.to_string(), retry, code.to_string(), detail.to_string()));
            Ok(())
        }
    }

    fn row(file_name: &str, attempts: u32) -> Row {
        Row {
            id: "up1".into(),
            organization_id: "org1".into(),
            file_name: file_name.into(),
            storage_path: "cad-uploads/org1/x".into(),
            attempts,
            source_deleted_at: None,
        }
    }

    fn fake(file_name: &str, attempts: u32, source: &[u8]) -> Fake {
        Fake {
            queue: RefCell::new(Some(row(file_name, attempts))),
            source: source.to_vec(),
            ..Fake::default()
        }
    }

    // ---- a fake worker: a shell script using only builtins (the real one runs with an empty environment) ----------------

    /// `body` runs with $out = the output folder; it can write result.json and parts/ and exit with a code.
    fn worker(dir: &std::path::Path, body: &str) -> WorkerConfig {
        let path = dir.join("worker.sh");
        // $1 --deadline-ms, $2 ms, $3 out folder, $4.. the input files
        std::fs::write(&path, format!("#!/bin/sh\nout=\"$3\"\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        WorkerConfig {
            program: path,
            wrapper: vec![],
            deadline: Duration::from_millis(300),
            grace: Duration::from_millis(300),
        }
    }

    fn config(worker: WorkerConfig) -> Config {
        Config {
            worker,
            archive: Limits {
                max_entries: 100,
                max_entry_bytes: 1 << 20,
                max_total_bytes: 8 << 20,
            },
        }
    }

    /// result.json for one single-part file, written by the fake worker as the real one would.
    const ONE_PART: &str = r#"{"schema_version":1,"units":"mm","status":"complete",
      "inputs":[{"file":"0000_plate.step","status":"ok","inside":null}],
      "assembly":[{"definition":"0:1:1:1","name":"Plate","kind":"part","quantity":1,"file":"0000_plate.step","children":[]}],
      "parts":[{"id":"0:1:1:1","name":"Plate","file":"0000_plate.step","quantity_total":1,"volume_mm3":3600.0,"surface_area_mm2":2760.0,
                "bounding_box":{"length":40.0,"width":30.0,"height":3.0,"diagonal":50.0}}],
      "problems":[]}"#;

    fn writes(json: &str) -> String {
        format!(
            "printf '%s' '{}' > \"$out/result.json\"",
            json.replace('\'', "'\\''")
        )
    }

    /// A stored-only zip of (name, bytes) entries.
    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let (mut locals, mut centrals) = (Vec::new(), Vec::new());
        for (name, data) in entries {
            let offset = locals.len() as u32;
            let mut local = vec![0u8; 30];
            local[0..4].copy_from_slice(&0x0403_4b50u32.to_le_bytes());
            local[6..8].copy_from_slice(&0x800u16.to_le_bytes());
            local[18..22].copy_from_slice(&(data.len() as u32).to_le_bytes());
            local[22..26].copy_from_slice(&(data.len() as u32).to_le_bytes());
            local[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
            locals.extend([local, name.as_bytes().to_vec(), data.to_vec()].concat());
            let mut central = vec![0u8; 46];
            central[0..4].copy_from_slice(&0x0201_4b50u32.to_le_bytes());
            central[8..10].copy_from_slice(&0x800u16.to_le_bytes());
            central[20..24].copy_from_slice(&(data.len() as u32).to_le_bytes());
            central[24..28].copy_from_slice(&(data.len() as u32).to_le_bytes());
            central[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            central[42..46].copy_from_slice(&offset.to_le_bytes());
            centrals.extend([central, name.as_bytes().to_vec()].concat());
        }
        let mut end = vec![0u8; 22];
        end[0..4].copy_from_slice(&0x0605_4b50u32.to_le_bytes());
        end[8..10].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[10..12].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[12..16].copy_from_slice(&(centrals.len() as u32).to_le_bytes());
        end[16..20].copy_from_slice(&(locals.len() as u32).to_le_bytes());
        [locals, centrals, end].concat()
    }

    // ---- tests ---------------------------------------------------------------------------------------------------------

    #[tokio::test]
    async fn a_single_part_step_is_stored_as_the_customers_own_file_and_marked_analysed() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("plate.step", 1, b"ISO-10303-21; original bytes");
        let cfg = config(worker(dir.path(), &writes(ONE_PART)));
        assert!(run_once(&backend, &cfg).await.unwrap());

        let uploads = backend.uploads.borrow();
        assert_eq!(uploads.len(), 1);
        assert_eq!(uploads[0].0, "cad-uploads/org1/up1/parts/0_1_1_1.step");
        assert_eq!(uploads[0].1, b"ISO-10303-21; original bytes"); // not a re-export
        let (id, value) = backend.analysed.borrow().clone().unwrap();
        assert_eq!(id, "up1");
        assert_eq!(value["report"]["assembly"][0]["file"], "plate.step"); // wire name mapped back
        assert!(backend.failed.borrow().is_none());
    }

    #[tokio::test]
    async fn a_part_inside_an_assembly_is_stored_from_the_workers_export() {
        let json = r#"{"schema_version":1,"units":"mm","status":"complete",
          "inputs":[{"file":"0000_top.step","status":"ok","inside":null}],
          "assembly":[{"definition":"0:1","name":"Top","kind":"assembly","quantity":1,"file":"0000_top.step","children":[
             {"definition":"0:2","name":"Bolt","kind":"part","quantity":4,"file":"0000_top.step","children":[]}]}],
          "parts":[{"id":"0:2","name":"Bolt","file":"0000_top.step","quantity_total":4,"volume_mm3":1.0,"surface_area_mm2":2.0,
                    "bounding_box":{"length":3.0,"width":2.0,"height":1.0,"diagonal":3.7}}],"problems":[]}"#;
        let dir = tempfile::tempdir().unwrap();
        let body = format!(
            "{}\nprintf 'EXPORTED' > \"$out/parts/0_2.step\"",
            writes(json)
        );
        let backend = fake("top.step", 1, b"original");
        assert!(
            run_once(&backend, &config(worker(dir.path(), &body)))
                .await
                .unwrap()
        );
        let uploads = backend.uploads.borrow();
        assert_eq!(uploads.len(), 1, "{:?}", backend.failed.borrow());
        assert_eq!(uploads[0].0, "cad-uploads/org1/up1/parts/0_2.step");
        assert_eq!(uploads[0].1, b"EXPORTED"); // the worker's export, not the whole assembly file
    }

    #[tokio::test]
    async fn a_zip_is_expanded_non_step_files_are_skipped_and_names_are_mapped_back() {
        let dir = tempfile::tempdir().unwrap();
        let zipped = zip(&[("sub/plate.step", b"STEP"), ("readme.txt", b"hi")]);
        let backend = fake("Pack.zip", 1, &zipped);
        assert!(
            run_once(&backend, &config(worker(dir.path(), &writes(ONE_PART))))
                .await
                .unwrap()
        );
        let (_, value) = backend.analysed.borrow().clone().unwrap();
        assert_eq!(value["report"]["parts"][0]["file"], "sub/plate.step");
        assert_eq!(value["skipped"][0]["path"], "readme.txt");
        assert_eq!(value["skipped"][0]["reason"], "not a STEP file");
    }

    #[tokio::test]
    async fn an_unreadable_step_fails_for_good_with_the_workers_code() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("bad.step", 1, b"garbage");
        assert!(
            run_once(&backend, &config(worker(dir.path(), "exit 2")))
                .await
                .unwrap()
        );
        let (_, retry, code, _) = backend.failed.borrow().clone().unwrap();
        assert!(!retry);
        assert_eq!(code, "unreadable_step");
        assert!(backend.analysed.borrow().is_none());
    }

    #[tokio::test]
    async fn a_worker_failure_is_retried_until_the_attempts_are_used() {
        let dir = tempfile::tempdir().unwrap();
        for (attempts, expect_retry) in [(1, true), (2, true), (3, false)] {
            let backend = fake("a.step", attempts, b"x");
            assert!(
                run_once(&backend, &config(worker(dir.path(), "exit 6")))
                    .await
                    .unwrap()
            );
            let (_, retry, code, _) = backend.failed.borrow().clone().unwrap();
            assert_eq!(retry, expect_retry, "attempt {attempts}");
            assert_eq!(code, "processing_failed");
        }
    }

    #[tokio::test]
    async fn a_result_that_disagrees_with_itself_is_refused_and_nothing_is_stored() {
        let wrong = ONE_PART.replace("\"quantity_total\":1", "\"quantity_total\":7");
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("plate.step", 1, b"x");
        assert!(
            run_once(&backend, &config(worker(dir.path(), &writes(&wrong))))
                .await
                .unwrap()
        );
        let (_, retry, code, detail) = backend.failed.borrow().clone().unwrap();
        assert!(!retry);
        assert_eq!(code, "invalid_engine_result");
        assert!(
            detail.contains("quantity_total is 7 but the tree gives 1"),
            "{detail}"
        );
        assert!(backend.uploads.borrow().is_empty());
    }

    #[tokio::test]
    async fn a_result_outside_the_contract_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("plate.step", 1, b"x");
        assert!(
            run_once(
                &backend,
                &config(worker(
                    dir.path(),
                    "printf '{\"hello\":1}' > \"$out/result.json\""
                ))
            )
            .await
            .unwrap()
        );
        let (_, retry, code, _) = backend.failed.borrow().clone().unwrap();
        assert!(!retry);
        assert_eq!(code, "invalid_engine_result");
    }

    #[tokio::test]
    async fn a_worker_that_never_stops_is_killed_at_its_deadline_and_the_upload_retried() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("plate.step", 1, b"x");
        let started = std::time::Instant::now();
        assert!(
            run_once(&backend, &config(worker(dir.path(), "while :; do :; done")))
                .await
                .unwrap()
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        let (_, retry, code, detail) = backend.failed.borrow().clone().unwrap();
        assert!(retry);
        assert_eq!(code, "processing_failed");
        assert!(detail.contains("killed"), "{detail}");
    }

    #[tokio::test]
    async fn the_worker_gets_an_empty_environment() {
        // This test process has HOME set (cargo needs it). The fake worker exits 9 if it can see it, so the pass proves env_clear.
        assert!(
            std::env::var_os("HOME").is_some(),
            "the test needs HOME in its own environment"
        );
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("plate.step", 1, b"x");
        let body = format!("[ -n \"${{HOME+x}}\" ] && exit 9\n{}", writes(ONE_PART));
        assert!(
            run_once(&backend, &config(worker(dir.path(), &body)))
                .await
                .unwrap()
        );
        assert!(
            backend.analysed.borrow().is_some(),
            "{:?}",
            backend.failed.borrow()
        );
    }

    #[tokio::test]
    async fn a_failed_upload_removes_the_parts_already_stored_and_is_retried() {
        let json = r#"{"schema_version":1,"units":"mm","status":"complete",
          "inputs":[{"file":"0000_a.step","status":"ok","inside":null},{"file":"0001_b.step","status":"ok","inside":null}],
          "assembly":[{"definition":"0:1","name":"A","kind":"part","quantity":1,"file":"0000_a.step","children":[]},
                      {"definition":"1:1","name":"B","kind":"part","quantity":1,"file":"0001_b.step","children":[]}],
          "parts":[{"id":"0:1","name":"A","file":"0000_a.step","quantity_total":1,"volume_mm3":1.0,"surface_area_mm2":1.0,"bounding_box":{"length":1.0,"width":1.0,"height":1.0,"diagonal":1.7}},
                   {"id":"1:1","name":"B","file":"0001_b.step","quantity_total":1,"volume_mm3":1.0,"surface_area_mm2":1.0,"bounding_box":{"length":1.0,"width":1.0,"height":1.0,"diagonal":1.7}}],
          "problems":[]}"#;
        let dir = tempfile::tempdir().unwrap();
        let zipped = zip(&[("a.step", b"A"), ("b.step", b"B")]);
        let backend = Fake {
            fail_upload_at: Some(1),
            ..fake("Pack.zip", 1, &zipped)
        };
        assert!(
            run_once(&backend, &config(worker(dir.path(), &writes(json))))
                .await
                .unwrap()
        );
        assert_eq!(
            *backend.removed.borrow(),
            vec!["cad-uploads/org1/up1/parts/0_1.step".to_string()]
        );
        let (_, retry, _, _) = backend.failed.borrow().clone().unwrap();
        assert!(retry);
        assert!(backend.analysed.borrow().is_none());
    }

    #[tokio::test]
    async fn an_expired_source_and_an_empty_queue_are_handled() {
        let dir = tempfile::tempdir().unwrap();
        let expired = fake("a.step", 1, b"x");
        expired
            .queue
            .borrow_mut()
            .as_mut()
            .unwrap()
            .source_deleted_at = Some("2026-10-01".into());
        assert!(
            run_once(&expired, &config(worker(dir.path(), "exit 0")))
                .await
                .unwrap()
        );
        assert_eq!(expired.failed.borrow().clone().unwrap().2, "source_expired");

        let empty = Fake::default();
        assert!(
            !run_once(&empty, &config(worker(dir.path(), "exit 0")))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn an_archive_with_no_step_files_fails_for_good() {
        let dir = tempfile::tempdir().unwrap();
        let backend = fake("Pack.zip", 1, &zip(&[("readme.txt", b"hi")]));
        assert!(
            run_once(&backend, &config(worker(dir.path(), "exit 0")))
                .await
                .unwrap()
        );
        assert_eq!(backend.failed.borrow().clone().unwrap().2, "no_step_files");
    }
}
