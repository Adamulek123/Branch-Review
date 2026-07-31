import { strict as assert } from "node:assert";

describe("Branch Review Windows desktop smoke", () => {
  afterEach(async () => {
    await browser.setWindowSize(1600, 1000);
  });

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
    const severeLogs = browserLogs.filter((item) => {
      if (item.level !== "SEVERE") return false;
      // Monaco rejects outstanding tokenization/model work with its canonical
      // cancellation error when a selected diff is replaced. The renderer
      // remains healthy and is asserted independently below.
      return !/\/assets\/MonacoDiff-[^ ]+\.js .* Uncaught \$r: Canceled$/.test(item.message);
    });
    for (const entry of severeLogs) console.error("WebView:", entry.message);
    assert.equal(severeLogs.length, 0, "the WebView should not emit renderer errors");
    assert.equal(await $(".diff-render-error").isExisting(), false, "the Monaco diff renderer should remain available");

    await browser.setWindowSize(1024, 680);
    await browser.saveScreenshot("test-results/desktop-smoke-1024.png");
    await browser.setWindowSize(1600, 1000);
    await browser.saveScreenshot("test-results/desktop-smoke.png");
  });

  it("runs the deterministic audit-to-agent handoff with approvals and responsive layouts", async () => {
    console.log("[handoff] opening audit setup");
    const auditWork = await $("button=Audit work");
    await auditWork.waitForClickable();
    await auditWork.click();
    console.log("[handoff] filling setup");
    await $('[name="work_description"]').setValue("Exercise the complete desktop handoff");
    await $('[name="acceptance_criteria"]').setValue("The agent must revalidate, request approval, and report validation");
    await $("button=Start audit").click();

    console.log("[handoff] waiting for deterministic audit");
    const auditWorkspace = await $(".audit-workspace");
    await auditWorkspace.waitForDisplayed();
    await $(".audit-status--completed").waitForDisplayed({ timeout: 90_000 });
    console.log("[handoff] selecting confirmed finding");
    const findingCheckbox = await $('.finding-select input[type="checkbox"]');
    await findingCheckbox.waitForClickable();
    await findingCheckbox.click();
    await $("button=Send findings to agent").click();

    console.log("[handoff] confirming permission profile");
    const handoff = await $(".handoff-confirm");
    await handoff.waitForDisplayed();
    const handoffText = await handoff.getText();
    assert.match(handoffText, /Workspace write/i);
    assert.match(handoffText, /Network off/i);
    assert.match(handoffText, /\.git/);
    await $("button=Start agent").click();

    console.log("[handoff] waiting for approval request");
    const agent = await $(".agent-workspace");
    await agent.waitForDisplayed();
    await $(".agent-status--waiting_approval").waitForDisplayed({ timeout: 60_000 });
    const approvalCommand = await $(".agent-request code");
    await approvalCommand.waitForDisplayed();
    assert.match(await approvalCommand.getText(), /cargo test --all-targets/);
    assert.match(await $(".agent-security-state").getText(), /Agent can edit workspace/);
    assert.match(await $(".agent-security-state small").getText(), /network off/i);
    await $("button=Approve once").click();
    console.log("[handoff] waiting for completion");
    await $(".agent-status--completed").waitForDisplayed({ timeout: 60_000 });
    assert.match(await $(".agent-event--command").getText(), /Validation completed/i);
    assert.match(await $(".agent-summary").getText(), /deterministic fake passed/i);
    assert.match(await $(".agent-event--file_change").getText(), /src\/review\.ts/);

    console.log("[handoff] checking narrow panes");
    await browser.setWindowSize(1024, 680);
    await $(".agent-mobile-tabs").waitForDisplayed({ timeout: 30_000 });
    const narrowOverflow = await browser.execute(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    assert.equal(narrowOverflow, false, "agent view must not create horizontal page scrolling");
    await $("button=Plan").click();
    await $("#agent-pane-plan").waitForDisplayed();
    assert.match(await $("#agent-pane-plan").getText(), /Security boundary/);
    await $("button=Result").click();
    await $("#agent-pane-result").waitForDisplayed();
    assert.match(await $("#agent-pane-result").getText(), /deterministic fake passed/i);
    await $("button=Conversation").click();
    await $("#agent-pane-timeline").waitForDisplayed();
    await browser.saveScreenshot("test-results/agent-handoff-1024.png");
    await browser.setWindowSize(1600, 1000);
    await browser.saveScreenshot("test-results/agent-handoff-1600.png");

    console.log("[handoff] returning to working-tree review");
    await $("button=Review agent changes").click();
    await $(".diff-viewer").waitForDisplayed();
  });
});
