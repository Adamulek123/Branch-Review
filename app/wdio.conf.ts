import { resolve } from "node:path";

const appBinary = resolve("src-tauri/target/debug/branch-review.exe");
const isolatedAppData = resolve(".wdio-data");
const isolatedProjects = resolve(isolatedAppData, "dev.branchreview.desktop", "projects.json");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/desktop/**/*.spec.ts"],
  maxInstances: 1,
  logLevel: "error",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: appBinary,
    driverProvider: "external",
    autoInstallTauriDriver: true,
    autoDownloadEdgeDriver: true,
    logLevel: "error",
    env: {
      APPDATA: isolatedAppData,
      BRANCH_REVIEW_PROJECTS_PATH: isolatedProjects,
      BRANCH_REVIEW_AUDIT_MOCK: "1",
      BRANCH_REVIEW_AUDIT_MOCK_FINDING: "1",
      BRANCH_REVIEW_REMEDIATION_MOCK: "1",
    },
    logDir: resolve("test-logs"),
    startTimeout: 90_000,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": { application: appBinary },
  } as unknown as WebdriverIO.Capabilities],
  framework: "mocha",
  reporters: ["spec"],
  // Windows WebView startup and first Monaco interaction can be slow on
  // constrained CI hosts; individual UI waits remain tightly bounded.
  mochaOpts: { ui: "bdd", timeout: 900_000 },
};
