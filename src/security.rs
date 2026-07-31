use std::{fs, path::Path};

/// Returns an operating-system identity for an existing repository directory.
///
/// Canonical paths alone do not detect a repository that was removed and
/// recreated at the same location between an audit and a remediation handoff.
/// The volume/file identifier (Windows) or device/inode pair (Unix) does.
pub fn repository_path_identity(path: &Path) -> std::io::Result<String> {
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "repository identity target is not a directory",
        ));
    }
    platform_identity(&canonical, &metadata)
}

#[cfg(windows)]
fn platform_identity(canonical: &Path, metadata: &fs::Metadata) -> std::io::Result<String> {
    use std::{
        fs::OpenOptions,
        mem::MaybeUninit,
        os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, GetFileInformationByHandle,
    };

    let directory = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(canonical)?;
    let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    let succeeded =
        unsafe { GetFileInformationByHandle(directory.as_raw_handle() as _, info.as_mut_ptr()) };
    if succeeded == 0 {
        return fallback_identity(canonical, metadata);
    }
    let info = unsafe { info.assume_init() };
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Ok(format!(
        "windows:{:08x}:{index:016x}",
        info.dwVolumeSerialNumber
    ))
}

#[cfg(unix)]
fn platform_identity(_canonical: &Path, metadata: &fs::Metadata) -> std::io::Result<String> {
    use std::os::unix::fs::MetadataExt;

    Ok(format!(
        "unix:{:016x}:{:016x}",
        metadata.dev(),
        metadata.ino()
    ))
}

#[cfg(not(any(windows, unix)))]
fn platform_identity(canonical: &Path, metadata: &fs::Metadata) -> std::io::Result<String> {
    fallback_identity(canonical, metadata)
}

#[cfg(any(windows, not(any(windows, unix))))]
fn fallback_identity(canonical: &Path, metadata: &fs::Metadata) -> std::io::Result<String> {
    use std::time::UNIX_EPOCH;

    let created = metadata
        .created()
        .or_else(|_| metadata.modified())?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(format!(
        "fallback:{}:{created}:{}",
        normalize_identity_path(canonical),
        metadata.len()
    ))
}

#[cfg(any(windows, not(any(windows, unix))))]
fn normalize_identity_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recreated_directory_has_a_different_identity() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repo.git");
        fs::create_dir(&repository).unwrap();
        let first = repository_path_identity(&repository).unwrap();
        fs::rename(&repository, temp.path().join("original.git")).unwrap();
        fs::create_dir(&repository).unwrap();
        let second = repository_path_identity(&repository).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn files_are_not_repository_identities() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("HEAD");
        fs::write(&file, b"ref: refs/heads/main\n").unwrap();
        assert_eq!(
            repository_path_identity(&file).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
    }
}
