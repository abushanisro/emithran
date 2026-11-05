//! Parity harness helper (geometry-worker/tests/real): expands one zip with this crate and describes the result as JSON, so the same zip
//! can be compared with the TypeScript extractor (backend/scripts/cad-parity.ts) and with a plain zip reader, without any geometry.
//!
//!   cargo run -q -p archive --example expand -- <file.zip> <out-dir>
//!
//! Writes each entry's bytes to `<out-dir>/<index>` and prints `{root, entries:[{index,name,path,size}], skipped:[{path,reason}]}`;
//! on a refusal prints `{error:{code,message}}`. The limits are the backend's defaults for CAD uploads (50 MB a file, 256 MB in all).
#![allow(
    clippy::print_stdout,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing
)]

use archive::{Error, Limits, expand};

fn quote(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (zip_path, out_dir) = (&args[1], &args[2]);
    let file_name = std::path::Path::new(zip_path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let bytes = std::fs::read(zip_path).unwrap();
    let limits = Limits {
        max_entries: 10_000,
        max_entry_bytes: 50 * 1024 * 1024,
        max_total_bytes: 256 * 1024 * 1024,
    };
    match expand(&file_name, &bytes, limits) {
        Ok(expanded) => {
            std::fs::create_dir_all(out_dir).unwrap();
            let entries: Vec<String> = expanded
                .entries
                .iter()
                .enumerate()
                .map(|(i, e)| {
                    std::fs::write(std::path::Path::new(out_dir).join(i.to_string()), &e.bytes)
                        .unwrap();
                    format!(
                        "{{\"index\":{i},\"name\":{},\"path\":{},\"size\":{}}}",
                        quote(&e.name),
                        quote(&e.path),
                        e.bytes.len()
                    )
                })
                .collect();
            let skipped: Vec<String> = expanded
                .skipped
                .iter()
                .map(|s| {
                    format!(
                        "{{\"path\":{},\"reason\":{}}}",
                        quote(&s.path),
                        quote(s.reason)
                    )
                })
                .collect();
            println!(
                "{{\"root\":{},\"entries\":[{}],\"skipped\":[{}]}}",
                quote(&expanded.root),
                entries.join(","),
                skipped.join(",")
            );
        }
        Err(e) => {
            let code = match &e {
                Error::Empty => "archive_empty",
                _ => "refused",
            };
            println!(
                "{{\"error\":{{\"code\":{},\"message\":{}}}}}",
                quote(code),
                quote(&format!("{e:?}"))
            );
        }
    }
}
