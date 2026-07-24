import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const prepared = spawnSync(process.execPath, ["tests/desktop/prepare.mjs"], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (prepared.status !== 0) {
  process.exit(prepared.status ?? 1);
}

const dataRoot = resolve(".wdio-data");
const projectsPath = resolve(dataRoot, "dev.branchreview.desktop", "projects.json");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  console.error("Could not locate pnpm. Start this command with `pnpm inspect`.");
  process.exit(1);
}

console.log("");
console.log("Opening Branch Review with an isolated smoke repository.");
console.log("Edit app/src files to see changes through Tauri's normal hot reload.");
console.log("Close the desktop window or press Ctrl+C here when you are done.");
console.log("");

const app = spawnSync(process.execPath, [pnpmCli, "tauri", "dev"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APPDATA: dataRoot,
    BRANCH_REVIEW_PROJECTS_PATH: projectsPath,
  },
  stdio: "inherit",
});

if (app.error) {
  console.error(`Could not start Tauri: ${app.error.message}`);
}

process.exit(app.status ?? (app.error ? 1 : 0));
