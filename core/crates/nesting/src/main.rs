//! `nester`: reads one JSON request on stdin (the body of cad-engine's `POST /nest`, plus optional `max_evaluations`) and writes one
//! JSON answer on stdout:  {"ok": true, "result": {...}}  or  {"ok": false, "reason": "..."}  (the Python endpoint's 422).
//! Exit codes: 0 answered (either way), 64 bad arguments, 65 the request was not valid JSON for the contract.
//!   nester [--deadline-ms <ms>]    past the deadline it stops and answers with what it placed, `capped: true`.
use std::io::{Read, Write};
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let deadline = match args.as_slice() {
        [] => None,
        [flag, ms] if flag == "--deadline-ms" => match ms.parse::<u64>() {
            Ok(ms) if ms > 0 => Some(Instant::now() + Duration::from_millis(ms)),
            _ => return usage(),
        },
        _ => return usage(),
    };
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("cannot read the request: {error}");
        std::process::exit(65);
    }
    let request: nesting::Request = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("the request is outside the contract: {error}");
            std::process::exit(65);
        }
    };
    let answer = match nesting::compute(&request, deadline) {
        Ok(result) => serde_json::json!({ "ok": true, "result": result }),
        Err(reason) => serde_json::json!({ "ok": false, "reason": reason }),
    };
    // A reader that goes away early (a closed pipe) is not a panic: report it and stop.
    if writeln!(std::io::stdout(), "{answer}").is_err() {
        std::process::exit(74);
    }
}

fn usage() {
    eprintln!("usage: nester [--deadline-ms <ms>]   (request JSON on stdin)");
    std::process::exit(64);
}
