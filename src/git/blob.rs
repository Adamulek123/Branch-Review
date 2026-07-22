use std::{
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Component, Path},
};

use crate::{
    error::{AppError, Result},
    model::FileContent,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobCommand {
    pub args: Vec<OsString>,
}

pub fn commit_blob_command(commit_oid: &str, repo_path: &Path) -> Result<BlobCommand> {
    validate_repo_path(repo_path)?;
    let mut spec = OsString::from(format!("{commit_oid}:"));
    spec.push(repo_path.as_os_str());
    Ok(BlobCommand {
        args: vec![OsString::from("cat-file"), OsString::from("blob"), spec],
    })
}
pub fn index_blob_command(repo_path: &Path) -> Result<BlobCommand> {
    validate_repo_path(repo_path)?;
    let mut spec = OsString::from(":");
    spec.push(repo_path.as_os_str());
    Ok(BlobCommand {
        args: vec![OsString::from("cat-file"), OsString::from("blob"), spec],
    })
}
fn validate_repo_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::FileOutsideRepository);
    }
    Ok(())
}

/// Reads a regular worktree file with a hard allocation bound and symlink rejection.
pub fn read_worktree_file(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let before = std::fs::symlink_metadata(path)?;
    if before.file_type().is_symlink() {
        return Err(AppError::FileOutsideRepository);
    }
    if !before.is_file() {
        return Err(AppError::ContentMissing);
    }
    if before.len() > limit {
        return Err(AppError::ContentTooLarge {
            size: before.len(),
            limit,
        });
    }
    let mut file = File::open(path)?;
    if file.metadata()?.file_type().is_symlink() {
        return Err(AppError::FileOutsideRepository);
    }
    let cap = usize::try_from(limit.min(usize::MAX as u64)).unwrap_or(usize::MAX);
    let mut bytes = Vec::with_capacity(cap.min(64 * 1024));
    file.by_ref()
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::ContentTooLarge {
            size: bytes.len() as u64,
            limit,
        });
    }
    let after = file.metadata()?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err(AppError::ContentChangedDuringRead);
    }
    Ok(bytes)
}

pub fn classify_content(bytes: Vec<u8>, limit: u64) -> FileContent {
    let size = bytes.len() as u64;
    if size > limit {
        return FileContent::TooLarge { size, limit };
    }
    if bytes.starts_with(&[0xff, 0xfe])
        || bytes.starts_with(&[0xfe, 0xff])
        || bytes.starts_with(&[0xff, 0xfe, 0, 0])
        || bytes.starts_with(&[0, 0, 0xfe, 0xff])
    {
        return FileContent::UnsupportedEncoding { size };
    }
    if bytes.contains(&0) {
        return FileContent::Binary { size };
    }
    let payload = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    match std::str::from_utf8(payload) {
        Ok(text) => FileContent::Text {
            text: text.to_owned(),
            encoding: if payload.len() == bytes.len() {
                "utf-8"
            } else {
                "utf-8-bom"
            }
            .into(),
            size,
        },
        Err(_) => FileContent::UnsupportedEncoding { size },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_text_bom_binary_encoding_and_large() {
        assert!(matches!(
            classify_content(b"hi".to_vec(), 2),
            FileContent::Text { .. }
        ));
        assert!(
            matches!(classify_content(b"\xef\xbb\xbfhi".to_vec(), 8), FileContent::Text { encoding, .. } if encoding == "utf-8-bom")
        );
        assert!(matches!(
            classify_content(b"a\0b".to_vec(), 8),
            FileContent::Binary { .. }
        ));
        assert!(matches!(
            classify_content(vec![0xff], 8),
            FileContent::UnsupportedEncoding { .. }
        ));
        assert!(matches!(
            classify_content(vec![1; 9], 8),
            FileContent::TooLarge { .. }
        ));
    }
    #[test]
    fn bounded_read_and_path_validation() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x");
        std::fs::write(&p, b"123").unwrap();
        assert_eq!(read_worktree_file(&p, 3).unwrap(), b"123");
        assert!(matches!(
            read_worktree_file(&p, 2),
            Err(AppError::ContentTooLarge { .. })
        ));
        assert!(index_blob_command(Path::new("../x")).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x");
        std::fs::write(&p, b"x").unwrap();
        let l = d.path().join("l");
        symlink(&p, &l).unwrap();
        assert!(read_worktree_file(&l, 5).is_err());
    }
}
