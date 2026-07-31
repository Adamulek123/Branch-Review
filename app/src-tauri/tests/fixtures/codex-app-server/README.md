# Codex app-server schema fixtures

These fixtures are the smallest generated subset used by Branch Review's
app-server protocol contract tests. They were generated with Codex CLI
`0.145.0`; the application accepts compatible `0.145.x` installations.

Refresh them from the repository root:

```powershell
.\scripts\refresh-codex-app-server-schemas.ps1
```

The refresh script generates the complete schema bundle in a unique temporary
directory, copies only the allowlisted fixtures into `0.145`, and removes the
temporary directory even when generation or copying fails. Do not edit the JSON
fixtures by hand.
