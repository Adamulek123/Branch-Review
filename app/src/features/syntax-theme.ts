import type { ThemeRegistrationRaw } from "shiki";

export const syntaxLanguageIds = [
  "rust",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "scss",
  "html",
  "markdown",
  "python",
  "toml",
  "yaml",
  "shellscript",
  "powershell",
  "sql",
] as const;

export const branchReviewSyntaxTheme = {
  name: "branch-review-dark",
  type: "dark",
  colors: {
    "editor.background": "#111113",
    "editor.foreground": "#D9D9DE",
    "editorLineNumber.foreground": "#585860",
    "editorLineNumber.activeForeground": "#A5A5AD",
    "editor.selectionBackground": "#294D78",
  },
  settings: [
    { settings: { background: "#111113", foreground: "#D9D9DE" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#777C87", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#A8D58D" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#E5B36A" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#C7A0FF" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#7EB7FF" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"], settings: { foreground: "#82D2CE" } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#D7C995" } },
    { scope: ["entity.name.namespace", "entity.name.module"], settings: { foreground: "#9BB9F0" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#A9A9B1" } },
    { scope: ["keyword.operator", "punctuation.accessor"], settings: { foreground: "#E49BA5" } },
    { scope: ["markup.heading", "entity.name.section"], settings: { foreground: "#75B7FF", fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  ],
} satisfies ThemeRegistrationRaw;

export const branchReviewFallbackSyntaxTheme = {
  ...branchReviewSyntaxTheme,
  name: "branch-review-dark-fallback",
} satisfies ThemeRegistrationRaw;
