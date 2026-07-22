# Releasing Branch Review

Branch Review checks the latest GitHub Release shortly after startup. Published installers and updater metadata are produced by GitHub Actions and signed with the updater key configured for this repository.

## Publish a version

From the repository root:

```powershell
cd app
pnpm version:set 0.2.0
cd ..
git add app/package.json app/src-tauri/Cargo.toml app/src-tauri/tauri.conf.json
git commit -m "release: Branch Review 0.2.0"
git tag app-v0.2.0
git push origin master --follow-tags
```

Use the same semantic version in both commands. The release workflow rejects mismatched tags, runs all tests, builds the Windows NSIS installer, signs the updater bundle, and publishes `latest.json` with the release.

## Signing key

The private updater key is stored in GitHub Actions as `TAURI_SIGNING_PRIVATE_KEY`. Keep a secure backup of the local private key under `%APPDATA%\Branch Review\signing`. Never commit it. If that key is lost, already-installed copies cannot trust updates signed by a replacement key without a manual reinstall.
