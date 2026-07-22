use std::path::{Path, PathBuf};

use crate::{AppError, GitReference, RefId, ReferenceKind, ResolvedRevision, Result};

const FIELD_COUNT: usize = 6;

/// Format used with `git for-each-ref`. Every field, including the final one,
/// is NUL terminated, so whitespace and newlines in worktree paths are safe.
pub const FOR_EACH_REF_FORMAT: &str =
    "%(refname)%00%(refname:short)%00%(objectname)%00%(upstream)%00%(HEAD)%00%(worktreepath)%00";

pub fn parse_for_each_ref(output: &[u8]) -> Result<Vec<GitReference>> {
    let mut fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    if fields
        .last()
        .is_some_and(|field| field.is_empty() || *field == b"\n" || *field == b"\r\n")
    {
        fields.pop();
    }
    if !fields.len().is_multiple_of(FIELD_COUNT) {
        return Err(AppError::MalformedGitOutput(format!(
            "for-each-ref returned {} fields (expected a multiple of {FIELD_COUNT})",
            fields.len()
        )));
    }

    fields
        .chunks_exact(FIELD_COUNT)
        .map(parse_reference)
        .collect()
}

fn parse_reference(fields: &[&[u8]]) -> Result<GitReference> {
    let full_field = fields[0]
        .strip_prefix(b"\r\n")
        .or_else(|| fields[0].strip_prefix(b"\n"))
        .unwrap_or(fields[0]);
    let full_name = text(full_field, "reference name")?;
    let kind = if full_name.starts_with("refs/heads/") {
        ReferenceKind::LocalBranch
    } else if full_name.starts_with("refs/remotes/") {
        ReferenceKind::RemoteBranch
    } else {
        return Err(AppError::MalformedGitOutput(format!(
            "unexpected reference {full_name}"
        )));
    };
    let display_name = text(fields[1], "short reference name")?;
    let commit_oid = object_id(fields[2])?;
    let upstream = text(fields[3], "upstream")?;
    let head = text(fields[4], "HEAD marker")?;
    let worktree = bytes_to_path(fields[5]);
    Ok(GitReference {
        id: RefId::new(),
        full_name,
        display_name,
        kind,
        commit_oid,
        upstream_full_name: (!upstream.is_empty()).then_some(upstream),
        is_head: head == "*",
        checked_out_worktree: (!fields[5].is_empty()).then_some(worktree),
    })
}

/// Parses `<full-ref>\0<object-id>\0`, suitable for a NUL-delimited
/// `rev-parse --symbolic-full-name`/`rev-parse --verify` resolution result.
pub fn parse_resolved_revision(output: &[u8]) -> Result<ResolvedRevision> {
    let mut fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let full_ref = fields
        .next()
        .ok_or_else(|| malformed("missing resolved reference"))?;
    let commit_oid = fields
        .next()
        .ok_or_else(|| malformed("missing resolved object id"))?;
    if fields.next().is_some() {
        return Err(malformed("extra resolved revision fields"));
    }
    Ok(ResolvedRevision {
        full_ref: text(full_ref, "resolved reference")?,
        commit_oid: object_id(commit_oid)?,
    })
}

fn object_id(bytes: &[u8]) -> Result<String> {
    let value = text(bytes, "object id")?;
    if (4..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(value)
    } else {
        Err(malformed("invalid object id"))
    }
}
fn text(bytes: &[u8], name: &str) -> Result<String> {
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| malformed(&format!("{name} is not UTF-8")))
}

fn malformed(message: &str) -> AppError {
    AppError::MalformedGitOutput(message.into())
}

#[cfg(unix)]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}
#[cfg(not(unix))]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    Path::new(&String::from_utf8_lossy(bytes).into_owned()).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_nul_records_without_line_assumptions() {
        let raw = b"refs/heads/main\0main\0abc123\0refs/remotes/origin/main\0*\0C:/trees/a\nworktree\0refs/remotes/origin/main\0origin/main\0def456\0\0 \0\0";
        let refs = parse_for_each_ref(raw).unwrap();
        assert_eq!(refs.len(), 2);
        assert!(refs[0].is_head);
        assert_eq!(
            refs[0].checked_out_worktree.as_ref().unwrap(),
            Path::new("C:/trees/a\nworktree")
        );
        assert_eq!(refs[1].kind, ReferenceKind::RemoteBranch);
        assert_eq!(refs[1].upstream_full_name, None);
    }
    #[test]
    fn rejects_partial_record() {
        assert!(parse_for_each_ref(b"refs/heads/a\0a\0").is_err());
    }
}
