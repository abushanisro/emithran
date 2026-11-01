//! Keeps the runner's credentials out of reach of the geometry worker it supervises.
//!
//! The worker parses customer STEP files and runs as the same UID as the runner, which holds DB_JWT_SECRET and the S3 keys in
//! its environment. `env_clear` (worker.rs) keeps them out of the worker's own environment, but a same-UID process can still
//! read the runner's `/proc/<pid>/environ` and `/proc/<pid>/mem` while the runner is dumpable. Marking the runner non-dumpable
//! (`prctl(PR_SET_DUMPABLE, 0)`) makes the kernel refuse those reads (and ptrace) to any process without CAP_SYS_PTRACE; the
//! container drops every capability. The flag is not inherited across `execve`, so the worker itself is unaffected.
//!
//! Network: the worker is not moved into its own network namespace. `unshare(CLONE_NEWNET)` needs CAP_SYS_ADMIN, or an
//! unprivileged user namespace, which Docker's default seccomp profile blocks without CAP_SYS_ADMIN; doing it in the child
//! between fork and exec also needs `unsafe` (`pre_exec`), which this workspace forbids. Granting CAP_SYS_ADMIN to the
//! container would weaken it more than it gains. What the worker can reach on the network is limited in
//! docker-compose.prod.yml instead (PostgREST's admin server bound to loopback, cloudflared metrics on loopback).

use std::io;

/// Marks this process non-dumpable so a same-UID child cannot read its environment or memory through `/proc`. Linux only: other
/// systems have no `/proc/<pid>/environ` to protect, and there this does nothing.
pub fn make_non_dumpable() -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use rustix::process::{DumpableBehavior, set_dumpable_behavior};
        set_dumpable_behavior(DumpableBehavior::NotDumpable)?;
    }
    Ok(())
}

/// Whether this process is non-dumpable.
#[cfg(target_os = "linux")]
pub fn is_non_dumpable() -> io::Result<bool> {
    use rustix::process::{DumpableBehavior, dumpable_behavior};
    Ok(dumpable_behavior()? == DumpableBehavior::NotDumpable)
}

/// Always true off Linux (nothing to protect there).
#[cfg(not(target_os = "linux"))]
pub fn is_non_dumpable() -> io::Result<bool> {
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_runner_becomes_non_dumpable() {
        make_non_dumpable().unwrap();
        assert!(is_non_dumpable().unwrap());
    }

    /// The regression the flag exists for: a same-UID child (standing in for a compromised worker) cannot read the parent's
    /// environment. Skipped as root, which holds CAP_SYS_PTRACE and may read it regardless (the container runs as 10003).
    #[cfg(target_os = "linux")]
    #[test]
    fn a_same_uid_child_cannot_read_the_parent_environment() {
        make_non_dumpable().unwrap();
        if rustix::process::getuid().is_root() {
            return;
        }
        let environ = format!("/proc/{}/environ", std::process::id());
        let status = std::process::Command::new("cat")
            .arg(&environ)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(!status.success(), "a child read {environ}");
    }
}
