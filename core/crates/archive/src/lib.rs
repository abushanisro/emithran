//! Unpacks an uploaded .zip into the files it holds. Pure: bytes in, entries out, nothing touches the filesystem.
//!
//! A port of `backend/src/common/archive/expand-archive.ts` (and its `inspect-zip.ts` measuring step) with the same rules and the
//! same refusals: the whole central directory is measured before anything is inflated (per-file and total limits, no ZIP64, and
//! every entry owning its own bytes: no shared or overlapping local data), then each entry is inflated capped at its stated size,
//! which must be honoured; unsafe paths and encrypted entries are refused. Folders are
//! kept as paths, and entries that are not design files (a nested archive, macOS resource forks) are listed as skipped, never
//! silently dropped.

#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )
)]

use miniz_oxide::inflate::decompress_to_vec_with_limit;

/// What the caller allows: each domain has its own file sizes.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    /// File name (last path segment).
    pub name: String,
    /// `/`-separated path starting with the archive's own name, as a dropped folder would report it.
    pub path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Skipped {
    pub path: String,
    pub reason: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Expanded {
    pub root: String,
    pub entries: Vec<Entry>,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Unreadable(String),
    Encrypted(String),
    EntryTooLarge(String),
    TooLarge(String),
    Empty,
}

impl Error {
    /// The same codes the TypeScript expander and the upload API use.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Unreadable(_) => "archive_unreadable",
            Error::Encrypted(_) => "archive_encrypted",
            Error::EntryTooLarge(_) => "archive_entry_too_large",
            Error::TooLarge(_) => "archive_too_large",
            Error::Empty => "archive_empty",
        }
    }
}

const CENTRAL: u32 = 0x0201_4b50;
const LOCAL: u32 = 0x0403_4b50;
const EOCD: u32 = 0x0605_4b50;

/// The folder name a pack stands for: its file name without the extension, and without characters a path cannot hold.
pub fn root_name(file_name: &str) -> String {
    let stem = if is_archive_name(file_name) {
        &file_name[..file_name.len() - 4]
    } else {
        file_name
    };
    let stem = stem.replace(['\\', '/'], " ");
    let stem = stem.trim();
    if stem.is_empty() {
        "Design pack".to_string()
    } else {
        stem.to_string()
    }
}

pub fn is_archive_name(file_name: &str) -> bool {
    file_name.len() >= 4
        && file_name.is_char_boundary(file_name.len() - 4)
        && file_name[file_name.len() - 4..].eq_ignore_ascii_case(".zip")
}

fn u16_at(buf: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        buf.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn u32_at(buf: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        buf.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

/// One central-directory record, measured but not inflated.
struct Measured {
    raw_name: String,
    flags: u16,
    method: u16,
    size: u64,
    data_start: usize,
    compressed_size: usize,
}

/// Reads the central directory without inflating anything, as `inspect-zip.ts` does: the entry count, each entry's and the
/// total declared size against the caller's limits, and that every entry owns its own bytes. Each entry's local header and data
/// must lie before the central directory and no two entries may share or overlap them: otherwise many records can point at one
/// small deflate stream and the archive expands far past what its real size suggests while every declared number looks fine.
fn measure(buf: &[u8], limits: Limits) -> Result<Vec<Measured>, Error> {
    let unreadable = |message: &str| Error::Unreadable(message.to_string());

    // The end-of-central-directory record is within the last 65 557 bytes (22 + a 65 535-byte comment).
    let eocd = (buf.len().saturating_sub(65_557)..=buf.len().saturating_sub(22))
        .rev()
        .find(|&i| u32_at(buf, i) == Some(EOCD))
        .ok_or_else(|| unreadable("Archive has no central directory."))?;
    let no_dir = || unreadable("Archive has no central directory.");
    let count = u16_at(buf, eocd + 10).ok_or_else(no_dir)?;
    let dir_size = u32_at(buf, eocd + 12).ok_or_else(no_dir)?;
    let dir_offset = u32_at(buf, eocd + 16).ok_or_else(no_dir)?;
    if count == u16::MAX || dir_size == u32::MAX || dir_offset == u32::MAX {
        return Err(unreadable("ZIP64 archives are not accepted."));
    }
    let count = count as usize;
    let (dir_offset, dir_size) = (dir_offset as usize, dir_size as usize);
    if count > limits.max_entries {
        return Err(Error::Unreadable(format!(
            "Archive holds more than {} entries.",
            limits.max_entries
        )));
    }
    let dir_end = dir_offset
        .checked_add(dir_size)
        .filter(|&end| end <= eocd)
        .ok_or_else(|| unreadable("Archive central directory is truncated."))?;

    let mut measured = Vec::with_capacity(count);
    let mut ranges: Vec<(usize, usize)> = Vec::with_capacity(count);
    let mut total: u64 = 0;
    let mut cursor = dir_offset;
    for _ in 0..count {
        let corrupt = || unreadable("Archive central directory is corrupt.");
        if cursor.checked_add(46).is_none_or(|end| end > dir_end)
            || u32_at(buf, cursor) != Some(CENTRAL)
        {
            return Err(corrupt());
        }
        let flags = u16_at(buf, cursor + 8).ok_or_else(corrupt)?;
        let method = u16_at(buf, cursor + 10).ok_or_else(corrupt)?;
        let compressed_size = u32_at(buf, cursor + 20).ok_or_else(corrupt)?;
        let size = u32_at(buf, cursor + 24).ok_or_else(corrupt)?;
        let name_len = u16_at(buf, cursor + 28).ok_or_else(corrupt)? as usize;
        let extra_len = u16_at(buf, cursor + 30).ok_or_else(corrupt)? as usize;
        let comment_len = u16_at(buf, cursor + 32).ok_or_else(corrupt)? as usize;
        let local_offset = u32_at(buf, cursor + 42).ok_or_else(corrupt)?;
        let record_end = cursor + 46 + name_len + extra_len + comment_len;
        if record_end > dir_end {
            return Err(corrupt());
        }
        let raw = buf
            .get(cursor + 46..cursor + 46 + name_len)
            .ok_or_else(corrupt)?;
        // Bit 11 marks a UTF-8 name; older tools write the DOS code page, which is read as latin1 rather than mangled.
        let raw_name: String = if flags & 0x800 != 0 {
            String::from_utf8_lossy(raw).into_owned()
        } else {
            raw.iter().map(|&b| char::from(b)).collect()
        };
        cursor = record_end;

        if size == u32::MAX || compressed_size == u32::MAX || local_offset == u32::MAX {
            return Err(unreadable("ZIP64 archives are not accepted."));
        }
        let size = u64::from(size);
        if size > limits.max_entry_bytes {
            return Err(Error::EntryTooLarge(format!(
                "An entry expands to more than {} MB.",
                limits.max_entry_bytes / (1024 * 1024)
            )));
        }
        total = total.saturating_add(size);
        if total > limits.max_total_bytes {
            return Err(Error::TooLarge(
                "Archive expands beyond the allowed size.".to_string(),
            ));
        }

        // The entry's own bytes: local header, name, extra field and compressed data, all before the central directory.
        let local_offset = local_offset as usize;
        if local_offset
            .checked_add(30)
            .is_none_or(|end| end > dir_offset)
            || u32_at(buf, local_offset) != Some(LOCAL)
        {
            return Err(unreadable("An entry's local header is missing."));
        }
        let local_name = u16_at(buf, local_offset + 26).ok_or_else(corrupt)? as usize;
        let local_extra = u16_at(buf, local_offset + 28).ok_or_else(corrupt)? as usize;
        let data_start = local_offset + 30 + local_name + local_extra;
        let compressed_size = compressed_size as usize;
        let data_end = data_start
            .checked_add(compressed_size)
            .filter(|&end| end <= dir_offset)
            .ok_or_else(|| unreadable("An entry's data is truncated."))?;
        ranges.push((local_offset, data_end));
        measured.push(Measured {
            raw_name,
            flags,
            method,
            size,
            data_start,
            compressed_size,
        });
    }

    ranges.sort_unstable();
    let overlap = || unreadable("Archive entries share or overlap their data.");
    if ranges.windows(2).any(|w| match w {
        [(_, prev_end), (start, _)] => start < prev_end,
        _ => false,
    }) {
        return Err(overlap());
    }
    // Follows from the ranges being disjoint and inside the buffer; kept as the explicit statement of the rule.
    let compressed_total = measured
        .iter()
        .try_fold(0usize, |sum, m| sum.checked_add(m.compressed_size));
    if compressed_total.is_none_or(|sum| sum > buf.len()) {
        return Err(overlap());
    }
    Ok(measured)
}

pub fn expand(file_name: &str, buf: &[u8], limits: Limits) -> Result<Expanded, Error> {
    let unreadable = |message: &str| Error::Unreadable(message.to_string());
    // Everything is measured before anything is inflated.
    let measured = measure(buf, limits)?;

    let root = root_name(file_name);
    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    for entry in measured {
        let inner = entry.raw_name.replace('\\', "/");
        let inner = inner.trim_start_matches('/');
        if inner.is_empty() || inner.ends_with('/') {
            continue; // a directory entry: folders come from the file paths
        }
        let segments: Vec<&str> = inner.split('/').collect();
        if segments
            .iter()
            .any(|s| s.is_empty() || *s == "." || *s == "..")
        {
            return Err(unreadable("Archive contains an unsafe file path."));
        }
        let path = format!("{root}/{inner}");
        let name = segments.last().copied().unwrap_or(inner).to_string();
        if segments.first() == Some(&"__MACOSX")
            || name.starts_with("._")
            || name == ".DS_Store"
            || name == "Thumbs.db"
        {
            skipped.push(Skipped {
                path,
                reason: "system metadata written by the archiving tool",
            });
            continue;
        }
        if entry.flags & 0x1 != 0 {
            return Err(Error::Encrypted(format!(
                "{inner} is encrypted; upload an unencrypted archive."
            )));
        }
        if is_archive_name(&name) {
            skipped.push(Skipped {
                path,
                reason: "an archive inside the archive is not unpacked; upload it on its own",
            });
            continue;
        }

        let data = buf
            .get(entry.data_start..entry.data_start.saturating_add(entry.compressed_size))
            .ok_or_else(|| Error::Unreadable(format!("{inner}: data is truncated.")))?;
        let size = entry.size;
        let bytes = match entry.method {
            0 => data.to_vec(),
            8 => decompress_to_vec_with_limit(
                data,
                usize::try_from(size.max(1)).unwrap_or(usize::MAX),
            )
            .map_err(|_| Error::Unreadable(format!("{inner}: could not be inflated.")))?,
            other => {
                return Err(Error::Unreadable(format!(
                    "{inner}: compression method {other} is not supported (stored and deflate are)."
                )));
            }
        };
        if bytes.len() as u64 != size {
            return Err(Error::Unreadable(format!(
                "{inner}: inflated size does not match the archive's directory."
            )));
        }
        entries.push(Entry { name, path, bytes });
    }
    if entries.is_empty() {
        return Err(Error::Empty);
    }
    Ok(Expanded {
        root,
        entries,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use miniz_oxide::deflate::compress_to_vec;

    use super::*;

    const LIMITS: Limits = Limits {
        max_entries: 5000,
        max_entry_bytes: 25 * 1024 * 1024,
        max_total_bytes: 1024 * 1024 * 1024,
    };
    const GERBER: &str = "%FSLAX25Y25*%\n%MOIN*%\nM02*\n";

    #[derive(Default)]
    struct E {
        name: &'static str,
        data: &'static str,
        deflate: bool,
        encrypted: bool,
        stated_size: Option<u32>,
        /// Bytes stored as the entry body instead of `data` (for a hostile archive).
        body: Option<Vec<u8>>,
    }

    fn e(name: &'static str, data: &'static str) -> E {
        E {
            name,
            data,
            ..E::default()
        }
    }

    /// The smallest well-formed zip that holds the entries (local headers, central directory, end record). Mirrors test-zip.ts.
    fn zip(entries: &[E]) -> Vec<u8> {
        let (mut locals, mut centrals) = (Vec::new(), Vec::new());
        for entry in entries {
            let raw = entry.data.as_bytes();
            let body = match (&entry.body, entry.deflate) {
                (Some(own), _) => own.clone(),
                (None, true) => compress_to_vec(raw, 6),
                (None, false) => raw.to_vec(),
            };
            let flags: u16 = 0x800 | u16::from(entry.encrypted);
            let method: u16 = if entry.deflate { 8 } else { 0 };
            let offset = locals.len() as u32;
            let name = entry.name.as_bytes();

            let mut local = vec![0u8; 30];
            local[0..4].copy_from_slice(&LOCAL.to_le_bytes());
            local[4..6].copy_from_slice(&20u16.to_le_bytes());
            local[6..8].copy_from_slice(&flags.to_le_bytes());
            local[8..10].copy_from_slice(&method.to_le_bytes());
            local[18..22].copy_from_slice(&(body.len() as u32).to_le_bytes());
            local[22..26].copy_from_slice(&(raw.len() as u32).to_le_bytes());
            local[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
            locals.extend([local, name.to_vec(), body.clone()].concat());

            let mut central = vec![0u8; 46];
            central[0..4].copy_from_slice(&CENTRAL.to_le_bytes());
            central[4..6].copy_from_slice(&20u16.to_le_bytes());
            central[6..8].copy_from_slice(&20u16.to_le_bytes());
            central[8..10].copy_from_slice(&flags.to_le_bytes());
            central[10..12].copy_from_slice(&method.to_le_bytes());
            central[20..24].copy_from_slice(&(body.len() as u32).to_le_bytes());
            central[24..28]
                .copy_from_slice(&entry.stated_size.unwrap_or(raw.len() as u32).to_le_bytes());
            central[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            central[42..46].copy_from_slice(&offset.to_le_bytes());
            centrals.extend([central, name.to_vec()].concat());
        }
        let mut end = vec![0u8; 22];
        end[0..4].copy_from_slice(&EOCD.to_le_bytes());
        end[8..10].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[10..12].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[12..16].copy_from_slice(&(centrals.len() as u32).to_le_bytes());
        end[16..20].copy_from_slice(&(locals.len() as u32).to_le_bytes());
        [locals, centrals, end].concat()
    }

    fn code(result: Result<Expanded, Error>) -> &'static str {
        result.expect_err("should have been refused").code()
    }

    #[test]
    fn unpacks_stored_and_deflated_entries_under_a_folder_named_after_the_archive() {
        let bytes = zip(&[
            e("Board A/", ""),
            E {
                deflate: true,
                ..e("Board A/layer.GTL", GERBER)
            },
            e("Board A/notes.txt", "hello"),
            E {
                deflate: true,
                ..e("BOM.csv", "Designator,Comment\n")
            },
        ]);
        let result = expand("Customer pack (1).zip", &bytes, LIMITS).unwrap();
        assert_eq!(result.root, "Customer pack (1)");
        let seen: Vec<(&str, &str, &str)> = result
            .entries
            .iter()
            .map(|x| {
                (
                    x.path.as_str(),
                    x.name.as_str(),
                    std::str::from_utf8(&x.bytes).unwrap(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                ("Customer pack (1)/Board A/layer.GTL", "layer.GTL", GERBER),
                ("Customer pack (1)/Board A/notes.txt", "notes.txt", "hello"),
                (
                    "Customer pack (1)/BOM.csv",
                    "BOM.csv",
                    "Designator,Comment\n"
                ),
            ]
        );
        assert!(result.skipped.is_empty());
    }

    #[test]
    fn lists_macos_metadata_and_nested_archives_as_skipped() {
        let bytes = zip(&[
            e("b/layer.gtl", GERBER),
            e("__MACOSX/b/._layer.gtl", "x"),
            e("b/.DS_Store", "x"),
            e("b/older.zip", "PK"),
        ]);
        let result = expand("p.zip", &bytes, LIMITS).unwrap();
        assert_eq!(
            result
                .entries
                .iter()
                .map(|x| x.path.as_str())
                .collect::<Vec<_>>(),
            ["p/b/layer.gtl"]
        );
        assert_eq!(
            result
                .skipped
                .iter()
                .map(|x| x.path.as_str())
                .collect::<Vec<_>>(),
            ["p/__MACOSX/b/._layer.gtl", "p/b/.DS_Store", "p/b/older.zip"]
        );
    }

    #[test]
    fn refuses_an_encrypted_entry() {
        assert_eq!(
            code(expand(
                "p.zip",
                &zip(&[E {
                    encrypted: true,
                    ..e("secret.gtl", GERBER)
                }]),
                LIMITS
            )),
            "archive_encrypted"
        );
    }

    #[test]
    fn refuses_an_entry_whose_inflated_size_differs_from_the_directory() {
        let bytes = zip(&[E {
            deflate: true,
            stated_size: Some(5),
            ..e("a.gtl", GERBER)
        }]);
        assert_eq!(code(expand("p.zip", &bytes, LIMITS)), "archive_unreadable");
    }

    #[test]
    fn refuses_an_entry_that_claims_to_expand_past_the_limit_before_inflating_it() {
        let bytes = zip(&[E {
            stated_size: Some(26 * 1024 * 1024),
            ..e("a.gtl", GERBER)
        }]);
        assert_eq!(
            code(expand("p.zip", &bytes, LIMITS)),
            "archive_entry_too_large"
        );
    }

    #[test]
    fn refuses_parent_directory_segments_and_empty_ones() {
        assert_eq!(
            code(expand(
                "p.zip",
                &zip(&[e("a/../../etc/x.gtl", GERBER)]),
                LIMITS
            )),
            "archive_unreadable"
        );
        assert_eq!(
            code(expand("p.zip", &zip(&[e("a//x.gtl", GERBER)]), LIMITS)),
            "archive_unreadable"
        );
    }

    #[test]
    fn an_archive_of_folders_only_is_empty() {
        assert_eq!(
            code(expand("p.zip", &zip(&[e("a/", "")]), LIMITS)),
            "archive_empty"
        );
    }

    #[test]
    fn names_the_root_after_the_archive_file() {
        assert_eq!(
            root_name("PCBA + Harness Drawing.ZIP"),
            "PCBA + Harness Drawing"
        );
        assert_eq!(root_name(".zip"), "Design pack");
        assert!(is_archive_name("a.Zip"));
        assert!(!is_archive_name("a.xlsx"));
    }

    #[test]
    fn limits_are_the_callers() {
        let bytes = zip(&[E {
            stated_size: Some(60 * 1024 * 1024),
            ..e("big.step", GERBER)
        }]);
        assert_eq!(
            code(expand("p.zip", &bytes, LIMITS)),
            "archive_entry_too_large"
        );
        // with a bigger allowance the next check catches the stated size lying about the real bytes
        assert_eq!(
            code(expand(
                "p.zip",
                &bytes,
                Limits {
                    max_entry_bytes: 100 * 1024 * 1024,
                    ..LIMITS
                }
            )),
            "archive_unreadable"
        );
    }

    #[test]
    fn refuses_more_entries_than_the_caller_allows_and_a_total_over_budget() {
        let bytes = zip(&[e("a.txt", "x"), e("b.txt", "y")]);
        assert_eq!(
            code(expand(
                "p.zip",
                &bytes,
                Limits {
                    max_entries: 1,
                    ..LIMITS
                }
            )),
            "archive_unreadable"
        );
        assert_eq!(
            code(expand(
                "p.zip",
                &bytes,
                Limits {
                    max_total_bytes: 1,
                    ..LIMITS
                }
            )),
            "archive_too_large"
        );
    }

    #[test]
    fn a_deflate_bomb_stops_at_the_stated_size() {
        // 10 MB of zeros deflates to a few KB; the directory claims 10 bytes, so inflating must stop, not allocate 10 MB.
        let bomb = compress_to_vec(&vec![0u8; 10 * 1024 * 1024], 6);
        let bytes = zip(&[E {
            deflate: true,
            stated_size: Some(10),
            body: Some(bomb),
            ..e("bomb.step", "")
        }]);
        assert_eq!(code(expand("p.zip", &bytes, LIMITS)), "archive_unreadable");
    }

    /// Points the second central record at the first entry's local header, copying its method and sizes (a crafted bomb).
    fn share_first_entry(bytes: &mut [u8]) {
        let eocd = bytes.len() - 22;
        let dir = u32_at(bytes, eocd + 16).unwrap() as usize;
        let first_name_len = u16_at(bytes, dir + 28).unwrap() as usize;
        let second = dir + 46 + first_name_len;
        for field in [10..12, 20..24, 24..28, 42..46] {
            let (from, to) = (dir + field.start..dir + field.end, second + field.start);
            bytes.copy_within(from, to);
        }
    }

    #[test]
    fn refuses_records_that_share_one_local_header_before_inflating_any() {
        // One 20 MB deflate stream of zeros named twice: within every size limit, but the second name has no bytes of its own.
        let zeros = compress_to_vec(&vec![0u8; 20 * 1024 * 1024], 6);
        let mut bytes = zip(&[
            E {
                deflate: true,
                stated_size: Some(20 * 1024 * 1024),
                body: Some(zeros),
                ..e("a.bin", "")
            },
            e("b.bin", "x"),
        ]);
        share_first_entry(&mut bytes);
        let err = expand("p.zip", &bytes, LIMITS).expect_err("shared data must be refused");
        assert_eq!(
            err,
            Error::Unreadable("Archive entries share or overlap their data.".to_string())
        );
    }

    #[test]
    fn refuses_an_entry_whose_data_runs_into_the_next() {
        let mut bytes = zip(&[e("a.txt", "hello"), e("b.txt", "world")]);
        let dir = u32_at(&bytes, bytes.len() - 22 + 16).unwrap() as usize;
        bytes[dir + 20..dir + 24].copy_from_slice(&(5u32 + 30).to_le_bytes()); // a's data now covers b's header
        assert_eq!(
            expand("p.zip", &bytes, LIMITS).expect_err("overlap must be refused"),
            Error::Unreadable("Archive entries share or overlap their data.".to_string())
        );
    }

    #[test]
    fn garbage_and_truncated_input_never_panic() {
        assert_eq!(code(expand("p.zip", b"", LIMITS)), "archive_unreadable");
        assert_eq!(
            code(expand("p.zip", b"not a zip at all", LIMITS)),
            "archive_unreadable"
        );
        let bytes = zip(&[E {
            deflate: true,
            ..e("a.gtl", GERBER)
        }]);
        for cut in 0..bytes.len() {
            let _ = expand("p.zip", &bytes[..cut], LIMITS); // must return, whatever the verdict
        }
    }
}
