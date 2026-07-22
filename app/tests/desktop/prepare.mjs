import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
git("add", "README.md");
git("commit", "-m", "Initial smoke fixture");
writeFileSync(resolve(repository, "README.md"), "# Smoke repository\n\nCommitted line.\nChanged in the working tree.\n", "utf8");
writeFileSync(resolve(repository, "new-file.ts"), "export const smoke = true;\n", "utf8");

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
