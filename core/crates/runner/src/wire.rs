//! The only channel between the runner and the geometry worker: a Unix socket on a volume that only the two containers mount
//! (docs/ASSEMBLY_CORE.md "Isolation"). One connection carries one job:
//!
//!   runner -> host   header `Request` (the inputs' names and sizes, the deadline), then each input's bytes in that order
//!   host -> runner   header `Response` (how the worker ended, the outputs' names and sizes), then each output's bytes
//!
//! A header is a 4-byte big-endian length followed by that much JSON. Bodies have exactly the declared lengths. Names are plain
//! file names (no folders), so neither side ever builds a path the other chose; outputs are `result.json` or `parts/<name>`.

use std::io;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::worker::Outcome;

/// A header is a list of names and sizes; 1 MiB holds far more entries than any limit allows.
pub const MAX_HEADER_BYTES: u32 = 1 << 20;
pub const RESULT_FILE: &str = "result.json";
pub const PARTS_DIR: &str = "parts";
const MAX_NAME_BYTES: usize = 255;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub len: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub deadline_ms: u64,
    pub inputs: Vec<FileEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Response {
    pub outcome: Outcome,
    pub outputs: Vec<FileEntry>,
}

/// A single file name: not empty, not `.` or `..`, no `/` or NUL, at most 255 bytes.
pub fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && name != "."
        && name != ".."
        && !name.contains(['/', '\0'])
}

/// `result.json`, or `parts/<plain name>`.
pub fn is_output_name(name: &str) -> bool {
    name == RESULT_FILE
        || name
            .strip_prefix(PARTS_DIR)
            .and_then(|rest| rest.strip_prefix('/'))
            .is_some_and(is_plain_name)
}

/// Checks a list of entries against a count and a total size, and every name against `valid`, each name once.
pub fn check_entries(
    entries: &[FileEntry],
    max_count: usize,
    max_total_bytes: u64,
    valid: fn(&str) -> bool,
) -> Result<(), String> {
    if entries.len() > max_count {
        return Err(format!(
            "{} files, more than the {max_count} allowed",
            entries.len()
        ));
    }
    let total = entries
        .iter()
        .try_fold(0u64, |sum, e| sum.checked_add(e.len))
        .unwrap_or(u64::MAX);
    if total > max_total_bytes {
        return Err(format!(
            "{total} bytes, more than the {max_total_bytes} allowed"
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        if !valid(&entry.name) {
            return Err(format!("{:?} is not an allowed file name", entry.name));
        }
        if !seen.insert(entry.name.as_str()) {
            return Err(format!("{:?} is listed twice", entry.name));
        }
    }
    Ok(())
}

pub async fn write_header<W: AsyncWrite + Unpin, T: Serialize>(
    writer: &mut W,
    value: &T,
) -> io::Result<()> {
    let json = serde_json::to_vec(value).map_err(io::Error::other)?;
    let len = u32::try_from(json.len())
        .ok()
        .filter(|n| *n <= MAX_HEADER_BYTES)
        .ok_or_else(|| io::Error::other("the header is too large"))?;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&json).await
}

/// Reads one header. `Ok(None)` when the peer closed the connection before sending anything (a health probe).
pub async fn read_header<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
) -> io::Result<Option<T>> {
    let mut len = [0u8; 4];
    let first = reader.read(&mut len).await?;
    if first == 0 {
        return Ok(None);
    }
    reader
        .read_exact(len.get_mut(first..).unwrap_or_default())
        .await?;
    let len = u32::from_be_bytes(len);
    if len > MAX_HEADER_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("a header of {len} bytes is larger than {MAX_HEADER_BYTES}"),
        ));
    }
    let mut json = vec![0u8; len as usize];
    reader.read_exact(&mut json).await?;
    serde_json::from_slice(&json)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Reads exactly `len` bytes into memory.
pub async fn read_body<R: AsyncRead + Unpin>(reader: &mut R, len: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(usize::try_from(len).map_err(io::Error::other)?);
    let read = reader.take(len).read_to_end(&mut bytes).await?;
    if read as u64 != len {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::Ended;

    #[test]
    fn names_never_leave_their_folder() {
        for good in ["0000_plate.step", "a b.STEP", "..x", "x.."] {
            assert!(is_plain_name(good), "{good}");
        }
        for bad in ["", ".", "..", "../x", "a/b", "/etc/passwd", "a\0b"] {
            assert!(!is_plain_name(bad), "{bad:?}");
        }
        assert!(!is_plain_name(&"x".repeat(256)));
        assert!(is_output_name("result.json"));
        assert!(is_output_name("parts/0_1.step"));
        for bad in [
            "stderr.txt",
            "parts/",
            "parts/../x",
            "parts/a/b",
            "partsx",
            "../result.json",
        ] {
            assert!(!is_output_name(bad), "{bad}");
        }
    }

    #[test]
    fn entries_are_bounded_and_unique() {
        let entry = |name: &str, len| FileEntry {
            name: name.into(),
            len,
        };
        let ok = [entry("a", 1), entry("b", 2)];
        assert!(check_entries(&ok, 2, 3, is_plain_name).is_ok());
        assert!(check_entries(&ok, 1, 3, is_plain_name).is_err());
        assert!(check_entries(&ok, 2, 2, is_plain_name).is_err());
        assert!(check_entries(&[entry("a", 1), entry("a", 1)], 9, 9, is_plain_name).is_err());
        assert!(check_entries(&[entry("../a", 1)], 9, 9, is_plain_name).is_err());
        let overflow = [entry("a", u64::MAX), entry("b", 2)];
        assert!(check_entries(&overflow, 9, u64::MAX - 1, is_plain_name).is_err());
    }

    #[tokio::test]
    async fn a_header_round_trips_and_an_oversized_one_is_refused() {
        let response = Response {
            outcome: Outcome {
                ended: Ended::Exited(0),
                tail: String::new(),
            },
            outputs: vec![FileEntry {
                name: "result.json".into(),
                len: 3,
            }],
        };
        let mut buffer = Vec::new();
        write_header(&mut buffer, &response).await.unwrap();
        let back: Option<Response> = read_header(&mut buffer.as_slice()).await.unwrap();
        assert_eq!(back, Some(response));

        let empty: Option<Response> = read_header(&mut [].as_slice()).await.unwrap();
        assert_eq!(empty, None);

        let huge = (MAX_HEADER_BYTES + 1).to_be_bytes();
        let refused: io::Result<Option<Response>> = read_header(&mut huge.as_slice()).await;
        assert!(refused.is_err());
    }

    #[tokio::test]
    async fn a_short_body_is_an_error() {
        assert_eq!(read_body(&mut b"abc".as_slice(), 3).await.unwrap(), b"abc");
        assert!(read_body(&mut b"ab".as_slice(), 3).await.is_err());
    }
}
