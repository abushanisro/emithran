//! Keeps the runner's memory (its signing key and S3 keys) unreadable by other processes.
//!
//! The geometry worker no longer runs beside the runner: it is in its own container, with its own UID and PID namespace and no
//! network (docs/ASSEMBLY_CORE.md "Isolation"), and the runner's credentials are not in its environment (secrets.rs). As defence
//! in depth the runner stays non-dumpable (`prctl(PR_SET_DUMPABLE, 0)`): the kernel then refuses `/proc/<pid>/mem`, `environ`
//! and ptrace to any process without CAP_SYS_PTRACE, which the container drops. The flag is reset by `execve`, so the runner sets
//! it again after restarting itself in secrets.rs.

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
