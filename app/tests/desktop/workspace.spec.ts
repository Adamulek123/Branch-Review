import { strict as assert } from "node:assert";

describe("Branch Review Windows desktop smoke", () => {
  it("opens a real repository and renders its working-tree comparison", async () => {
    const shell = await $(".app-shell");
    await shell.waitForDisplayed();
    await browser.waitUntil(async () => (await shell.getText()).includes("Smoke repository"));
    await browser.waitUntil(async () => (await shell.getText()).includes("README.md"));

    const text = await shell.getText();
    assert.match(text, /Branch Review/);
    assert.match(text, /Desktop smoke/);
    assert.match(text, /Working tree/i);
    assert.match(text, /README\.md/);
    assert.match(text, /new-file\.ts/);
    assert.match(text, /read.only/i);

    const reviewFile = await $('[title="src/review.ts"]');
    await reviewFile.click();
    const diffViewer = await $(".diff-viewer");
    await browser.waitUntil(async () => (await diffViewer.getAttribute("aria-label")) === "Comparison for src/review.ts");
    const browserLogs = await browser.getLogs("browser") as Array<{ level: string; message: string }>;
    const severeLogs = browserLogs.filter((item) => item.level === "SEVERE");
    for (const entry of severeLogs) console.error("WebView:", entry.message);
    assert.equal(severeLogs.length, 0, "the WebView should not emit renderer errors");
    assert.equal(await $(".diff-render-error").isExisting(), false, "the Monaco diff renderer should remain available");

    await browser.setWindowSize(1024, 680);
    await browser.saveScreenshot("test-results/desktop-smoke-1024.png");
    await browser.setWindowSize(1600, 1000);
    await browser.saveScreenshot("test-results/desktop-smoke.png");
  });
});
