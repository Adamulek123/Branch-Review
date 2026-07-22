import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm version:set <semver>");
  process.exit(1);
}

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(appRoot, "package.json");
const tauriConfigPath = join(appRoot, "src-tauri", "tauri.conf.json");
const cargoPath = join(appRoot, "src-tauri", "Cargo.toml");

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.version = version;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
tauriConfig.version = version;
await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargo = await readFile(cargoPath, "utf8");
await writeFile(cargoPath, cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+("\n)/, `$1${version}$2`));

console.log(`Branch Review version set to ${version}`);
