use std::path::{Path, PathBuf};

use crate::{
    error::{AppError, Result},
    model::{ChangeKind, ComparisonMode, ContentSource, FileDescriptor, FileId},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffEndpoint {
    Commit(String),
    Index,
    Worktree,
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffPlan {
    pub mode: ComparisonMode,
    pub args: Vec<String>,
    pub left: DiffEndpoint,
    pub right: DiffEndpoint,
}

pub fn numstat_args(plan: &DiffPlan) -> Vec<String> {
    plan.args
        .iter()
        .map(|arg| {
            if arg == "--name-status" {
                "--numstat".to_owned()
            } else {
                arg.clone()
            }
        })
        .collect()
}

pub fn parse_numstat_totals_z(output: &[u8]) -> Result<(usize, usize)> {
    let mut added = 0usize;
    let mut deleted = 0usize;
    for record in output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let mut fields = record.splitn(3, |byte| *byte == b'\t');
        let (Some(raw_added), Some(raw_deleted), Some(_path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            // Rename/copy records can carry their paths in the following NUL
            // fields. Those path-only fields do not contain line counts.
            continue;
        };
        added = added.saturating_add(parse_numstat_count(raw_added)?);
        deleted = deleted.saturating_add(parse_numstat_count(raw_deleted)?);
    }
    Ok((added, deleted))
}

fn parse_numstat_count(value: &[u8]) -> Result<usize> {
    if value == b"-" {
        return Ok(0);
    }
    std::str::from_utf8(value)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| malformed("invalid numstat count"))
}

/// Produces the complete, closed set of supported comparison command lines.
pub fn comparison_plan(
    mode: ComparisonMode,
    left: Option<&str>,
    right: Option<&str>,
) -> Result<DiffPlan> {
    let common = [
        "diff",
        "--name-status",
        "-z",
        "--find-renames=50%",
        "--no-ext-diff",
        "--no-textconv",
    ];
    let (tail, lhs, rhs) = match mode {
        ComparisonMode::Direct => {
            let l = required(left, "left revision")?;
            let r = required(right, "right revision")?;
            (
                vec![l.clone(), r.clone(), "--".into()],
                DiffEndpoint::Commit(l),
                DiffEndpoint::Commit(r),
            )
        }
        ComparisonMode::SinceMergeBase => {
            let l = required(left, "left revision")?;
            let r = required(right, "right revision")?;
            (
                vec![format!("{l}...{r}"), "--".into()],
                DiffEndpoint::Commit(l),
                DiffEndpoint::Commit(r),
            )
        }
        ComparisonMode::Unstaged => (
            vec!["--".into()],
            DiffEndpoint::Index,
            DiffEndpoint::Worktree,
        ),
        ComparisonMode::Staged => {
            let endpoint = left.map_or(DiffEndpoint::Empty, |head| {
                DiffEndpoint::Commit(head.into())
            });
            let mut args = vec!["--cached".into()];
            if let Some(head) = left {
                args.push(head.into());
            }
            args.push("--".into());
            (args, endpoint, DiffEndpoint::Index)
        }
        ComparisonMode::AllUncommitted => {
            let head = required(left, "HEAD commit")?;
            (
                vec![head.clone(), "--".into()],
                DiffEndpoint::Commit(head),
                DiffEndpoint::Worktree,
            )
        }
    };
    Ok(DiffPlan {
        mode,
        args: common.into_iter().map(str::to_owned).chain(tail).collect(),
        left: lhs,
        right: rhs,
    })
}

fn required(value: Option<&str>, name: &str) -> Result<String> {
    value
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::MalformedGitOutput(format!("missing {name}")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameStatusEntry {
    pub kind: ChangeKind,
    pub old_path: Option<Vec<u8>>,
    pub path: Vec<u8>,
    pub similarity: Option<u8>,
}

/// Parses `git diff --name-status -z`; paths remain bytes and can contain tabs/newlines.
pub fn parse_name_status_z(output: &[u8]) -> Result<Vec<NameStatusEntry>> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    if !output.ends_with(&[0]) {
        return Err(malformed("unterminated name-status output"));
    }
    let fields: Vec<&[u8]> = output[..output.len() - 1].split(|b| *b == 0).collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let (status, inline_path) = match fields[i].iter().position(|b| *b == b'\t') {
            Some(n) => (&fields[i][..n], Some(&fields[i][n + 1..])),
            None => (fields[i], None),
        };
        i += 1;
        let code = *status.first().ok_or_else(|| malformed("empty status"))?;
        let similarity = if matches!(code, b'R' | b'C') {
            Some(
                std::str::from_utf8(&status[1..])
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .filter(|v: &u8| *v <= 100)
                    .ok_or_else(|| malformed("invalid similarity"))?,
            )
        } else {
            None
        };
        let first = match inline_path {
            Some(p) if !p.is_empty() => p,
            _ => take(&fields, &mut i)?,
        };
        let (old_path, path) = if matches!(code, b'R' | b'C') {
            (Some(first.to_vec()), take(&fields, &mut i)?.to_vec())
        } else {
            (None, first.to_vec())
        };
        if path.is_empty() || old_path.as_ref().is_some_and(Vec::is_empty) {
            return Err(malformed("empty path"));
        }
        entries.push(NameStatusEntry {
            kind: change_kind(code),
            old_path,
            path,
            similarity,
        });
    }
    Ok(entries)
}

fn take<'a>(fields: &'a [&'a [u8]], i: &mut usize) -> Result<&'a [u8]> {
    let value = fields
        .get(*i)
        .copied()
        .ok_or_else(|| malformed("missing path"))?;
    *i += 1;
    Ok(value)
}
fn malformed(s: &str) -> AppError {
    AppError::MalformedGitOutput(s.into())
}
fn change_kind(c: u8) -> ChangeKind {
    match c {
        b'A' => ChangeKind::Added,
        b'M' => ChangeKind::Modified,
        b'D' => ChangeKind::Deleted,
        b'R' => ChangeKind::Renamed,
        b'C' => ChangeKind::Copied,
        b'T' => ChangeKind::TypeChanged,
        b'U' => ChangeKind::Unmerged,
        _ => ChangeKind::Unknown,
    }
}

pub fn descriptor_for(
    entry: &NameStatusEntry,
    left: &DiffEndpoint,
    right: &DiffEndpoint,
    root: &Path,
) -> FileDescriptor {
    if entry.kind == ChangeKind::Unmerged {
        let repo_path = bytes_to_path(&entry.path);
        return FileDescriptor {
            file_id: FileId::new(),
            left: ContentSource::ConflictStage {
                stage: 2,
                repo_path: repo_path.clone(),
            },
            right: ContentSource::ConflictStage {
                stage: 3,
                repo_path,
            },
        };
    }
    let old = entry.old_path.as_deref().unwrap_or(&entry.path);
    let left_source = if matches!(entry.kind, ChangeKind::Added | ChangeKind::Untracked) {
        ContentSource::Empty
    } else {
        source(left, root, old)
    };
    let right_source = if entry.kind == ChangeKind::Deleted {
        ContentSource::Empty
    } else {
        source(right, root, &entry.path)
    };
    FileDescriptor {
        file_id: FileId::new(),
        left: left_source,
        right: right_source,
    }
}

fn source(endpoint: &DiffEndpoint, _root: &Path, path: &[u8]) -> ContentSource {
    let repo_path = bytes_to_path(path);
    match endpoint {
        DiffEndpoint::Commit(oid) => ContentSource::Commit {
            commit_oid: oid.clone(),
            repo_path,
        },
        DiffEndpoint::Index => ContentSource::Index { repo_path },
        DiffEndpoint::Worktree => ContentSource::Worktree { repo_path },
        DiffEndpoint::Empty => ContentSource::Empty,
    }
}

#[cfg(unix)]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}
#[cfg(not(unix))]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_nul_safe_rename_and_odd_path() {
        let x = parse_name_status_z(b"R087\0old\nname\0new\tname\0M\0a\tb\0").unwrap();
        assert_eq!(x.len(), 2);
        assert_eq!(x[0].similarity, Some(87));
        assert_eq!(x[1].path, b"a\tb");
    }
    #[test]
    fn rejects_truncation() {
        assert!(parse_name_status_z(b"R100\0old\0").is_err());
    }
    #[test]
    fn parses_numstat_totals_and_ignores_binary_entries() {
        let totals = parse_numstat_totals_z(b"12\t4\tsrc/main.rs\0-\t-\tasset.bin\0").unwrap();
        assert_eq!(totals, (12, 4));
    }
    #[test]
    fn plans_all_modes() {
        for m in [
            ComparisonMode::Direct,
            ComparisonMode::SinceMergeBase,
            ComparisonMode::Unstaged,
            ComparisonMode::Staged,
            ComparisonMode::AllUncommitted,
        ] {
            assert!(comparison_plan(m, Some("a"), Some("b")).is_ok());
        }
    }
}
