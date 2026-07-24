import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dataRoot = resolve(".wdio-data");
const repository = resolve(dataRoot, "smoke-repository");
const configDirectory = resolve(dataRoot, "dev.branchreview.desktop");

rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(repository, { recursive: true });
mkdirSync(configDirectory, { recursive: true });
mkdirSync(resolve("test-results"), { recursive: true });

const git = (...args) => execFileSync("git", args, { cwd: repository, stdio: "ignore" });
git("init", "--initial-branch=main");
git("config", "user.name", "Branch Review Smoke");
git("config", "user.email", "smoke@branch-review.invalid");
writeFileSync(resolve(repository, "README.md"), "# Smoke repository\n\nCommitted line.\n", "utf8");
mkdirSync(resolve(repository, "src", "components"), { recursive: true });
mkdirSync(resolve(repository, "docs", "guides"), { recursive: true });
writeFileSync(resolve(repository, "src", "review.ts"), [
  "export type ReviewFile = { path: string; changedLines: number };",
  "export class Reviewer {",
  "  selectFile(activeFile: ReviewFile): ReviewFile {",
  "    return activeFile;",
  "  }",
  "}",
  "",
].join("\n"), "utf8");
writeFileSync(resolve(repository, "src", "theme.rs"), [
  "pub struct Theme { pub name: String }",
  "pub fn resolve_theme(name: &str) -> Theme {",
  "    Theme { name: name.to_string() }",
  "}",
  "",
].join("\n"), "utf8");
writeFileSync(resolve(repository, "docs", "guides", "legacy-review-workflow.md"), "# Legacy workflow\n", "utf8");
writeFileSync(resolve(repository, "old-panel.ts"), "export const panelName = \"old\";\n", "utf8");
git("add", ".");
git("commit", "-m", "Initial smoke fixture");
git("remote", "add", "origin", "https://example.invalid/branch-review-smoke.git");
git("update-ref", "refs/remotes/origin/main", "HEAD");
git("branch", "--set-upstream-to=origin/main", "main");

writeFileSync(resolve(repository, "README.md"), "# Smoke repository\n\nCommitted line.\nChanged in the working tree.\n", "utf8");
writeFileSync(resolve(repository, "src", "review.ts"), [
  "export type ReviewFile = { path: string; changedLines: number };",
  "export class Reviewer {",
  "  selectFile(activeFile: ReviewFile): ReviewFile {",
  "    const normalizedPath = activeFile.path.trim();",
  "    return { ...activeFile, path: normalizedPath, changedLines: activeFile.changedLines + 1 };",
  "  }",
  "}",
  "",
  "export const activeFile: ReviewFile = { path: \"src/review.ts\", changedLines: 8 };",
  "export const selectedFile = new Reviewer().selectFile(activeFile);",
  "",
].join("\n"), "utf8");
writeFileSync(resolve(repository, "src", "theme.rs"), [
  "pub struct Theme { pub name: String, pub dark: bool }",
  "pub fn resolve_theme(name: &str) -> Theme {",
  "    let normalized_name = name.trim().to_string();",
  "    Theme { name: normalized_name, dark: true }",
  "}",
  "",
].join("\n"), "utf8");
renameSync(resolve(repository, "old-panel.ts"), resolve(repository, "src", "components", "review-panel-with-a-deliberately-long-name.ts"));
rmSync(resolve(repository, "docs", "guides", "legacy-review-workflow.md"));
writeFileSync(resolve(repository, "src", "components", "new-file.ts"), "export const smokeFixture = { ready: true, status: \"untracked\" };\n", "utf8");
writeFileSync(resolve(repository, "assets-preview.bin"), Buffer.from([0, 255, 12, 88, 0, 5]));

writeFileSync(resolve(configDirectory, "projects.json"), JSON.stringify({
  schema_version: 1,
  projects: [{
    schema_version: 1,
    project_id: "desktop-smoke",
    name: "Desktop smoke",
    layout: "tabs",
    repositories: [{
      project_repo_id: "smoke-repository",
      display_name: "Smoke repository",
      path: repository,
      display_order: 0,
      default_comparison: { mode: "all_uncommitted", left_full_ref: null, right_full_ref: null },
    }],
  }],
}, null, 2), "utf8");
