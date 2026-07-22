use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use tokio::{io::AsyncReadExt, process::Command};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, Result};

const STDERR_LIMIT: usize = 64 * 1024;

// Prevent console applications such as git.exe from allocating a visible
// console window when Branch Review launches them from its GUI process.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct GitRunner {
    executable: PathBuf,
    timeout: Duration,
    stdout_limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: i32,
    pub elapsed: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitInstallation {
    pub executable: PathBuf,
    pub version: String,
}

impl GitRunner {
    pub fn new(executable: impl Into<PathBuf>, timeout: Duration, stdout_limit: usize) -> Self {
        Self {
            executable: executable.into(),
            timeout,
            stdout_limit,
        }
    }

    pub fn system() -> Self {
        Self::new("git", Duration::from_secs(30), 10 * 1024 * 1024)
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }
    pub fn stdout_limit(&self) -> usize {
        self.stdout_limit
    }

    pub async fn detect(&self) -> Result<GitInstallation> {
        let output = self
            .run(None, [OsStr::new("--version")], &CancellationToken::new())
            .await?;
        let text = std::str::from_utf8(&output.stdout)
            .map_err(|_| AppError::UnsupportedGit("version output is not UTF-8".into()))?
            .trim();
        let version = text
            .strip_prefix("git version ")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::UnsupportedGit(text.to_owned()))?;
        Ok(GitInstallation {
            executable: self.executable.clone(),
            version: version.to_owned(),
        })
    }

    pub async fn run<I, S>(
        &self,
        cwd: Option<&Path>,
        args: I,
        cancel: &CancellationToken,
    ) -> Result<GitOutput>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let started = Instant::now();
        let args: Vec<OsString> = args
            .into_iter()
            .map(|arg| arg.as_ref().to_owned())
            .collect();
        let operation = args
            .first()
            .map(|arg| arg.to_string_lossy().into_owned())
            .unwrap_or_else(|| "git".into());
        let mut command = Command::new(&self.executable);
        command.arg("--no-pager").arg("--no-optional-locks");
        if let Some(cwd) = cwd {
            command.arg("-C").arg(cwd);
        }
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        suppress_child_console(&mut command);
        sanitize_environment(&mut command);

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::GitNotFound
            } else {
                AppError::Io(error)
            }
        })?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let stdout_limit = self.stdout_limit;
        let stdout_task = tokio::spawn(async move { read_limited(stdout, stdout_limit).await });
        let stderr_task = tokio::spawn(async move { read_truncated(stderr, STDERR_LIMIT).await });

        let status = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                stdout_task.abort(); stderr_task.abort();
                tracing::debug!(operation = %operation, elapsed_ms = started.elapsed().as_millis(), outcome = "cancelled", "git operation finished");
                return Err(AppError::GitCancelled);
            }
            result = tokio::time::timeout(self.timeout, child.wait()) => match result {
                Ok(status) => status?,
                Err(_) => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    stdout_task.abort(); stderr_task.abort();
                    tracing::debug!(operation = %operation, elapsed_ms = started.elapsed().as_millis(), outcome = "timed_out", "git operation finished");
                    return Err(AppError::GitTimedOut(self.timeout));
                }
            },
        };

        let stdout = stdout_task.await.map_err(join_error)??;
        let stderr = stderr_task.await.map_err(join_error)??;
        let exit_code = status.code().unwrap_or(-1);
        let elapsed = started.elapsed();
        tracing::debug!(operation = %operation, elapsed_ms = elapsed.as_millis(), exit_code, stdout_bytes = stdout.len(), stderr_bytes = stderr.len(), "git operation finished");
        if !status.success() {
            return Err(classify_failure(exit_code, &stderr));
        }
        Ok(GitOutput {
            stdout,
            stderr,
            exit_code,
            elapsed,
        })
    }

    pub async fn run_text<I, S>(
        &self,
        cwd: Option<&Path>,
        args: I,
        cancel: &CancellationToken,
    ) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.run(cwd, args, cancel).await?;
        String::from_utf8(output.stdout)
            .map_err(|_| AppError::MalformedGitOutput("stdout is not UTF-8".into()))
    }
}

#[cfg(windows)]
fn suppress_child_console(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_child_console(_: &mut Command) {}

fn sanitize_environment(command: &mut Command) {
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_PREFIX",
        "GIT_CONFIG_COUNT",
    ] {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_CONFIG_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("LC_ALL", "C")
        .env("LANG", "C");
}

async fn read_limited(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut chunk = [0_u8; 8192];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(count) > limit {
            return Err(AppError::GitOutputTooLarge { limit });
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
}

async fn read_truncated(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len() < limit {
            let keep = count.min(limit - bytes.len());
            bytes.extend_from_slice(&chunk[..keep]);
        }
    }
}

fn join_error(error: tokio::task::JoinError) -> AppError {
    AppError::Io(std::io::Error::other(error.to_string()))
}

fn classify_failure(exit_code: i32, stderr: &[u8]) -> AppError {
    let stderr = String::from_utf8_lossy(stderr).trim().to_owned();
    if stderr.contains("detected dubious ownership") || stderr.contains("unsafe repository") {
        AppError::UnsafeRepository
    } else {
        AppError::GitCommandFailed { exit_code, stderr }
    }
}

pub(crate) fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn limited_reader_rejects_oversized_data() {
        let error = read_limited(&b"1234"[..], 3).await.unwrap_err();
        assert!(matches!(error, AppError::GitOutputTooLarge { limit: 3 }));
    }

    #[tokio::test]
    async fn pre_cancelled_command_is_killed_and_reaped() {
        let token = CancellationToken::new();
        token.cancel();
        let error = GitRunner::system()
            .run(None, ["--version"], &token)
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::GitCancelled));
    }

    #[tokio::test]
    async fn zero_timeout_is_enforced() {
        let runner = GitRunner::new("git", Duration::ZERO, 1024);
        let error = runner
            .run(None, ["--version"], &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::GitTimedOut(_)));
    }

    #[tokio::test]
    async fn subprocess_output_limit_is_enforced() {
        let runner = GitRunner::new("git", Duration::from_secs(5), 1);
        let error = runner
            .run(None, ["--version"], &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::GitOutputTooLarge { limit: 1 }));
    }

    #[tokio::test]
    async fn arguments_with_shell_characters_arrive_literally() {
        let value = "quotes' ; $(never) Unicode-zażółć";
        let output = GitRunner::system()
            .run_text(
                None,
                ["rev-parse", "--sq-quote", value],
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert!(output.contains("$(never)"));
        assert!(output.contains("zażółć"));
    }

    #[cfg(windows)]
    #[test]
    fn git_processes_use_the_no_window_creation_flag() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert!(include_str!("runner.rs").contains("command.creation_flags(CREATE_NO_WINDOW)"));
    }

    #[test]
    fn unsafe_repository_is_typed() {
        assert!(matches!(
            classify_failure(128, b"fatal: detected dubious ownership in repository"),
            AppError::UnsafeRepository
        ));
    }
}
