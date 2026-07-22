import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

export default function MonacoDiff({ original, modified, language, split }: { original: string; modified: string; language: string; split: boolean }) {
  return <DiffEditor
    original={original}
    modified={modified}
    language={language}
    theme="branch-review-dark"
    onMount={(instance, api) => {
      api.editor.defineTheme("branch-review-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#0d0f12", "editorGutter.background": "#0d0f12",
          "diffEditor.insertedTextBackground": "#1f6f433d", "diffEditor.removedTextBackground": "#a33a3a3d",
          "diffEditor.insertedLineBackground": "#193d2c66", "diffEditor.removedLineBackground": "#45252666",
          "editor.lineHighlightBackground": "#15181d", "editorLineNumber.foreground": "#555b66",
          "editorLineNumber.activeForeground": "#a8afbb",
        },
      });
      api.editor.setTheme("branch-review-dark");
      instance.layout();
    }}
    options={{
      readOnly: true, originalEditable: false, renderSideBySide: split, minimap: { enabled: false },
      folding: true, glyphMargin: false, lineNumbersMinChars: 3,
      fontFamily: "'Berkeley Mono', 'Cascadia Code', Consolas, monospace", fontSize: 12.5, lineHeight: 20,
      scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "off", renderOverviewRuler: false,
      overviewRulerLanes: 0, diffAlgorithm: "advanced",
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5, revealLineCount: 12 },
      padding: { top: 8, bottom: 16 },
    }}
  />;
}
