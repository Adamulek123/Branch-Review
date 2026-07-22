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
    assert.match(text, /All changes/i);
    assert.match(text, /README\.md/);
    assert.match(text, /new-file\.ts/);
    assert.match(text, /Changed in the working tree/);
    assert.match(text, /read.only/i);
    await browser.saveScreenshot("test-results/desktop-smoke.png");
  });
});
