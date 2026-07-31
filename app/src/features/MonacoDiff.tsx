import { useEffect, useState } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { branchReviewFallbackSyntaxTheme, branchReviewSyntaxTheme, syntaxLanguageIds } from "./syntax-theme";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript" || label === "tsx" || label === "jsx") return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

const fallbackTheme: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "identifier", foreground: "D7C995" },
    { token: "type.identifier", foreground: "7EB7FF" },
    { token: "keyword", foreground: "C7A0FF" },
    { token: "string", foreground: "A8D58D" },
    { token: "number", foreground: "E5B36A" },
    { token: "comment", foreground: "777C87", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#111113",
    "editor.foreground": "#D9D9DE",
    "editorGutter.background": "#111113",
    "diffEditor.insertedTextBackground": "#22663A55",
    "diffEditor.removedTextBackground": "#8C343A55",
    "diffEditor.insertedLineBackground": "#17382488",
    "diffEditor.removedLineBackground": "#3B202388",
    "diffEditor.diagonalFill": "#242428",
    "editor.lineHighlightBackground": "#171719",
    "editorLineNumber.foreground": "#585860",
    "editorLineNumber.activeForeground": "#A5A5AD",
    "editor.selectionBackground": "#294D78",
    "editor.inactiveSelectionBackground": "#233C59",
    "editorIndentGuide.background1": "#28282D",
    "editorIndentGuide.activeBackground1": "#45454C",
  },
};

monaco.editor.defineTheme("branch-review-dark-fallback", fallbackTheme);

let highlighterPromise: Promise<unknown> | null = null;

export function initializeSyntaxHighlighting(): Promise<unknown> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([import("shiki"), import("@shikijs/monaco")]).then(async ([shiki, integration]) => {
      const highlighter = await shiki.createHighlighter({
        themes: [branchReviewSyntaxTheme, branchReviewFallbackSyntaxTheme],
        langs: [...syntaxLanguageIds],
      });
      for (const id of syntaxLanguageIds) {
        if (!monaco.languages.getLanguages().some((language) => language.id === id)) monaco.languages.register({ id });
      }
      integration.shikiToMonaco(highlighter, monaco);
      return highlighter;
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise!;
}

interface Props {
  fileId: string;
  path: string;
  original: string;
  modified: string;
  language: string;
  split: boolean;
  wrapLines: boolean;
  ignoreTrimWhitespace: boolean;
  collapseUnchanged: boolean;
  focusLine?: number | null;
  onLineCounts?(counts: { added: number; removed: number }): void;
}

export function countChangedLines(changes: monaco.editor.ILineChange[] | null): { added: number; removed: number } {
  return (changes ?? []).reduce(
    (counts, change) => ({
      added: counts.added + (change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1),
      removed: counts.removed + (change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1),
    }),
    { added: 0, removed: 0 },
  );
}

export default function MonacoDiff(props: Props) {
  const [theme, setTheme] = useState("branch-review-dark-fallback");
  const encodedPath = encodeURIComponent(props.path.replaceAll("\\", "/"));
  const originalModelPath = `inmemory://branch-review/${props.fileId}/left/${encodedPath}`;
  const modifiedModelPath = `inmemory://branch-review/${props.fileId}/right/${encodedPath}`;

  useEffect(() => {
    let active = true;
    void initializeSyntaxHighlighting().then(() => {
      if (active) setTheme("branch-review-dark");
    }).catch(() => {
      if (active) setTheme("branch-review-dark-fallback");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    const originalUri = monaco.Uri.parse(originalModelPath);
    const modifiedUri = monaco.Uri.parse(modifiedModelPath);
    window.setTimeout(() => {
      monaco.editor.getModel(originalUri)?.dispose();
      monaco.editor.getModel(modifiedUri)?.dispose();
    }, 0);
  }, [modifiedModelPath, originalModelPath]);

  return (
    <DiffEditor
      key={`${props.fileId}:${encodedPath}:${props.ignoreTrimWhitespace}`}
      original={props.original}
      modified={props.modified}
      language={props.language}
      originalLanguage={props.language}
      modifiedLanguage={props.language}
      originalModelPath={originalModelPath}
      modifiedModelPath={modifiedModelPath}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      theme={theme}
      onMount={(instance) => {
        instance.layout();
        const reportLineCounts = () => props.onLineCounts?.(countChangedLines(instance.getLineChanges()));
        reportLineCounts();
        instance.onDidUpdateDiff(reportLineCounts);
        if (props.focusLine) {
          const editor = instance.getModifiedEditor();
          const line = Math.max(1, Math.min(props.focusLine, editor.getModel()?.getLineCount() ?? 1));
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: 1 });
          editor.deltaDecorations([], [{
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: "audit-line-highlight" },
          }]);
        }
      }}
      options={{
        readOnly: true,
        domReadOnly: true,
        originalEditable: false,
        renderSideBySide: props.split,
        ignoreTrimWhitespace: props.ignoreTrimWhitespace,
        minimap: { enabled: false },
        folding: true,
        glyphMargin: false,
        lineNumbersMinChars: 3,
        fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
        fontLigatures: true,
        fontSize: 13,
        lineHeight: 21,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: props.wrapLines ? "on" : "off",
        wrappingIndent: "same",
        renderOverviewRuler: false,
        overviewRulerLanes: 0,
        diffAlgorithm: "advanced",
        renderIndicators: true,
        renderMarginRevertIcon: false,
        enableSplitViewResizing: true,
        hideUnchangedRegions: {
          enabled: props.collapseUnchanged,
          contextLineCount: 3,
          minimumLineCount: 5,
          revealLineCount: 14,
        },
        padding: { top: 12, bottom: 24 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        unicodeHighlight: { ambiguousCharacters: false },
      }}
    />
  );
}
