/**
 * The editor adapter layer (ADR-0001 §2.3).
 *
 * What a caller may use is one factory and one contract. The engine modules are
 * deliberately *not* re-exported here: `EditorPane` reaches this package
 * through `@newmd/core/editor`, so a barrel that only names the surface makes it
 * impossible for UI code to grow an opinion about which engine is running.
 * Tests that need an engine in isolation import its module directly
 * (`src/editor/wysiwyg.ts`) and say so in their own headers.
 *
 * Everything engine-shaped — a CodeMirror `EditorView`, a Milkdown `Ctx` —
 * stays inside its own module, so replacing an engine is a change to that file
 * and to nothing above it.
 */
export type {
  ImageInsertion,
  MarkdownEditorHandle,
  MarkdownEditorMode,
  MarkdownEditorOptions,
  MarkdownSurface,
} from "./handle";
export { createMarkdownEditor } from "./surface";
/**
 * Not engine-shaped: this is the trip from a picker to a file beside the
 * document, and it would be the same trip whichever engine rendered the line.
 * The UI needs it because the picker lives on the UI side, next to the menu
 * and the hotkey that opens it.
 */
export { saveLocalImage } from "./paste-image";
export type { ImageTarget } from "./paste-image";
