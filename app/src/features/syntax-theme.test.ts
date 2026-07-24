import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHighlighter, type HighlighterGeneric } from "shiki";
import { branchReviewSyntaxTheme } from "./syntax-theme";

type TestHighlighter = HighlighterGeneric<"rust" | "typescript" | "javascript", "branch-review-dark">;
let highlighter: TestHighlighter;

beforeAll(async () => {
  highlighter = await createHighlighter({
    themes: [branchReviewSyntaxTheme],
    langs: ["rust", "typescript", "javascript"],
  }) as unknown as TestHighlighter;
});

afterAll(() => highlighter.dispose());

describe("Branch Review syntax theme", () => {
  it.each([
    ["rust", "fn render_review(active_file: &str) { active_file.trim(); }"],
    ["typescript", "const activeFile: ReviewFile = reviewer.selectFile();"],
    ["javascript", "const activeFile = reviewer.selectFile();"],
  ] as const)("applies distinct semantic colors to %s identifiers and calls", (lang, code) => {
    const result = highlighter.codeToTokens(code, { lang, theme: "branch-review-dark" });
    const coloredTokens = result.tokens.flat().filter((token) => token.content.trim()).map((token) => token.color);

    expect(new Set(coloredTokens).size).toBeGreaterThanOrEqual(4);
    expect(coloredTokens).toContain("#82D2CE");
    expect(coloredTokens).toContain("#D7C995");
  });
});
