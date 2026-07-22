use std::path::{Path, PathBuf};

use crate::{AppError, ChangeKind, FileId, Result, StatusEntry, WorkingTreeStatus};

#[derive(Debug, Clone, Default)]
pub struct ParsedStatus {
    pub branch_oid: Option<String>,
    pub branch_head: Option<String>,
    pub entries: Vec<ParsedStatusEntry>,
}

#[derive(Debug, Clone)]
pub struct ParsedStatusEntry {
    pub path: PathBuf,
    pub old_path: Option<PathBuf>,
    pub status: ChangeKind,
    pub index_status: Option<char>,
    pub worktree_status: Option<char>,
    pub submodule: bool,
    pub similarity: Option<u8>,
    pub head_mode: Option<String>,
    pub index_mode: Option<String>,
    pub worktree_mode: Option<String>,
    pub head_oid: Option<String>,
    pub index_oid: Option<String>,
}

pub fn parse_porcelain_v2_z(output: &[u8]) -> Result<ParsedStatus> {
    let records: Vec<&[u8]> = output.split(|b| *b == 0).collect();
    let mut result = ParsedStatus::default();
    let mut i = 0;
    while i < records.len() {
        let record = records[i];
        i += 1;
        if record.is_empty() {
            continue;
        }
        match record[0] {
            b'#' => parse_header(record, &mut result)?,
            b'1' => result.entries.push(parse_ordinary(record)?),
            b'2' => {
                let old = records
                    .get(i)
                    .ok_or_else(|| malformed("rename/copy is missing original path"))?;
                i += 1;
                if old.is_empty() {
                    return Err(malformed("rename/copy has an empty original path"));
                }
                let mut entry = parse_rename(record)?;
                entry.old_path = Some(bytes_to_path(old));
                result.entries.push(entry);
            }
            b'u' => result.entries.push(parse_unmerged(record)?),
            b'?' => result.entries.push(simple(record, ChangeKind::Untracked)?),
            b'!' => {} // ignored files are not requested, but are valid porcelain v2
            byte => {
                return Err(malformed(&format!(
                    "unknown porcelain record type {:?}",
                    byte as char
                )));
            }
        }
    }
    Ok(result)
}

pub fn into_working_tree_status(parsed: ParsedStatus, generation: u64) -> WorkingTreeStatus {
    WorkingTreeStatus {
        generation,
        branch_oid: parsed.branch_oid,
        branch_head: parsed.branch_head,
        entries: parsed.entries.into_iter().map(to_dto).collect(),
    }
}

fn parse_header(record: &[u8], out: &mut ParsedStatus) -> Result<()> {
    let text = utf8(record, "header")?;
    if let Some(value) = text.strip_prefix("# branch.oid ") {
        out.branch_oid = (value != "(initial)").then(|| value.to_owned());
    } else if let Some(value) = text.strip_prefix("# branch.head ") {
        out.branch_head = (value != "(detached)").then(|| value.to_owned());
    }
    Ok(())
}

fn parse_ordinary(record: &[u8]) -> Result<ParsedStatusEntry> {
    let f = split_prefix(record, 8, "ordinary")?;
    build(
        f[1],
        f[2],
        f[3],
        f[4],
        f[5],
        f[6],
        f[7],
        None,
        bytes_to_path(f[8]),
    )
}
fn parse_rename(record: &[u8]) -> Result<ParsedStatusEntry> {
    let f = split_prefix(record, 9, "rename/copy")?;
    let score = utf8(f[8], "rename score")?;
    let similarity = score
        .get(1..)
        .ok_or_else(|| malformed("missing rename score"))?
        .parse::<u8>()
        .map_err(|_| malformed("invalid rename score"))?;
    let mut entry = build(
        f[1],
        f[2],
        f[3],
        f[4],
        f[5],
        f[6],
        f[7],
        Some(similarity),
        bytes_to_path(f[9]),
    )?;
    entry.status = if score.starts_with('R') {
        ChangeKind::Renamed
    } else if score.starts_with('C') {
        ChangeKind::Copied
    } else {
        return Err(malformed("invalid rename/copy score"));
    };
    Ok(entry)
}
fn parse_unmerged(record: &[u8]) -> Result<ParsedStatusEntry> {
    let f = split_prefix(record, 10, "unmerged")?;
    let mut entry = build(
        f[1],
        f[2],
        f[3],
        f[4],
        f[5],
        f[7],
        f[8],
        None,
        bytes_to_path(f[10]),
    )?;
    entry.status = ChangeKind::Unmerged;
    Ok(entry)
}
fn simple(record: &[u8], status: ChangeKind) -> Result<ParsedStatusEntry> {
    if record.len() < 3 || record[1] != b' ' {
        return Err(malformed("malformed path record"));
    }
    Ok(ParsedStatusEntry {
        path: bytes_to_path(&record[2..]),
        old_path: None,
        status,
        index_status: None,
        worktree_status: None,
        submodule: false,
        similarity: None,
        head_mode: None,
        index_mode: None,
        worktree_mode: None,
        head_oid: None,
        index_oid: None,
    })
}

#[allow(clippy::too_many_arguments)]
fn build(
    xy: &[u8],
    sub: &[u8],
    mh: &[u8],
    mi: &[u8],
    mw: &[u8],
    hh: &[u8],
    hi: &[u8],
    similarity: Option<u8>,
    path: PathBuf,
) -> Result<ParsedStatusEntry> {
    let xy = utf8(xy, "XY")?;
    let mut chars = xy.chars();
    let x = chars
        .next()
        .ok_or_else(|| malformed("missing index status"))?;
    let y = chars
        .next()
        .ok_or_else(|| malformed("missing worktree status"))?;
    if chars.next().is_some() {
        return Err(malformed("invalid XY status"));
    }
    let status = kind(x, y);
    Ok(ParsedStatusEntry {
        path,
        old_path: None,
        status,
        index_status: (x != '.').then_some(x),
        worktree_status: (y != '.').then_some(y),
        submodule: sub.first() == Some(&b'S'),
        similarity,
        head_mode: some_text(mh)?,
        index_mode: some_text(mi)?,
        worktree_mode: some_text(mw)?,
        head_oid: some_text(hh)?,
        index_oid: some_text(hi)?,
    })
}

fn kind(x: char, y: char) -> ChangeKind {
    let c = if y != '.' { y } else { x };
    match c {
        'A' => ChangeKind::Added,
        'M' => ChangeKind::Modified,
        'D' => ChangeKind::Deleted,
        'R' => ChangeKind::Renamed,
        'C' => ChangeKind::Copied,
        'T' => ChangeKind::TypeChanged,
        'U' => ChangeKind::Unmerged,
        _ => ChangeKind::Unknown,
    }
}
fn split_prefix<'a>(record: &'a [u8], spaces: usize, name: &str) -> Result<Vec<&'a [u8]>> {
    let fields: Vec<_> = record.splitn(spaces + 1, |b| *b == b' ').collect();
    if fields.len() != spaces + 1 {
        return Err(malformed(&format!("incomplete {name} record")));
    }
    Ok(fields)
}
fn some_text(value: &[u8]) -> Result<Option<String>> {
    if value == b"." {
        Ok(None)
    } else {
        Ok(Some(utf8(value, "metadata")?.to_owned()))
    }
}
fn utf8<'a>(v: &'a [u8], field: &str) -> Result<&'a str> {
    std::str::from_utf8(v).map_err(|_| malformed(&format!("{field} is not UTF-8")))
}
fn malformed(msg: &str) -> AppError {
    AppError::MalformedGitOutput(msg.into())
}
fn to_dto(e: ParsedStatusEntry) -> StatusEntry {
    let staged = e.index_status.is_some();
    let unstaged = e.worktree_status.is_some();
    let conflicted = e.status == ChangeKind::Unmerged;
    StatusEntry {
        file_id: FileId::new(),
        display_path: e.path.to_string_lossy().into_owned(),
        old_display_path: e.old_path.map(|p| p.to_string_lossy().into_owned()),
        status: e.status,
        index_status: e.index_status,
        worktree_status: e.worktree_status,
        staged,
        unstaged,
        conflicted,
        submodule: e.submodule,
        similarity: e.similarity,
        head_mode: e.head_mode,
        index_mode: e.index_mode,
        worktree_mode: e.worktree_mode,
        head_oid: e.head_oid,
        index_oid: e.index_oid,
    }
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
    fn parses_every_requested_record() {
        let raw = b"# branch.oid abc\0# branch.head main\x001 M. N... 100644 100644 100644 a b ordinary name\n.txt\x002 R. N... 100644 100644 100644 a b R087 new name\0old name\0u UU N... 100644 100644 100644 100644 a b c conflict\0? untracked file\0";
        let parsed = parse_porcelain_v2_z(raw).unwrap();
        assert_eq!(parsed.branch_head.as_deref(), Some("main"));
        assert_eq!(parsed.entries.len(), 4);
        assert_eq!(
            parsed.entries[1].old_path.as_deref(),
            Some(Path::new("old name"))
        );
        assert_eq!(parsed.entries[1].similarity, Some(87));
        assert_eq!(parsed.entries[2].status, ChangeKind::Unmerged);
        assert_eq!(parsed.entries[3].status, ChangeKind::Untracked);
    }
    #[test]
    fn handles_unborn_and_detached_headers() {
        let p =
            parse_porcelain_v2_z(b"# branch.oid (initial)\0# branch.head (detached)\0").unwrap();
        assert!(p.branch_oid.is_none() && p.branch_head.is_none());
    }
    #[test]
    fn rejects_rename_without_source() {
        assert!(parse_porcelain_v2_z(b"2 R. N... 1 1 1 a b R100 new\0").is_err());
    }
}
