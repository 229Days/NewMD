# NewMD

A Typora-like Markdown editor for the desktop: a real WYSIWYG surface when you want to write, a real Markdown source view when you need one, and the same document in both — switched without losing a byte.

Built with **Tauri 2** + **React 19** + **TypeScript**. The editor core is plain web code with no Tauri dependency, so it also runs in a browser.

**Status:** milestone 4 of 6 complete · active development · [design record →](docs/adr/0001-typora-like-markdown-editor.md)

---

## What works today

**Editing**

- WYSIWYG ↔ source mode, both ways, on the same document (round trip verified on a 1000-line file)
- Headings, paragraphs, ordered / unordered / task lists, blockquotes, horizontal rules, inline code, fenced code blocks, tables, images
- Undo and redo
- Find and replace

**Files and workspace**

- Open a folder as a workspace and browse it in a file tree
- Multiple tabs with dirty-state indicators
- Autosave (800 ms debounce, plus on blur) and recovery of unsaved work after a crash
- Session restore: open tabs, the active tab, and unsaved content come back after a restart

**Appearance and control**

- Light / dark / system theme, applied the moment you pick it
- Font family, font size, line height, editor max width
- Your own CSS, injected live as you type it
- File tree and outline sidebars — clicking an outline heading jumps the caret to it
- Rebindable keyboard shortcuts (defaults follow Typora and VS Code)
- Chinese and English UI, all copy externalised through i18next

**Not yet**

- KaTeX math, Mermaid, footnotes, `==highlight==`, super/subscript, front matter editing, image paste to `./assets/` → **M5**
- PDF / HTML / DOCX export, focus mode, typewriter mode, spell check, installers → **M6**

---

## Getting started

### Requirements

- Node.js 20 or newer (developed on 24)
- [pnpm](https://pnpm.io) 10
- Desktop app only: a Rust toolchain, and WebView2 (preinstalled on Windows 11)

### Browser mode — the quickest way to look at it

```bash
pnpm install
pnpm dev:web
```

Serves at <http://localhost:5173>. File access degrades to the browser's File System Access API, so desktop-only features are limited here.

### Desktop app

```bash
pnpm install
pnpm dev
```

The first run compiles the Rust side and takes a few minutes.

### Scripts

| command          | what it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | desktop app with hot reload (Tauri)  |
| `pnpm dev:web`   | browser-only dev server              |
| `pnpm build`     | typecheck, then production web build |
| `pnpm test`      | every package's test suite           |
| `pnpm typecheck` | `tsc --noEmit` across the workspace  |
| `pnpm format`    | Prettier write                       |

---

## Layout

```
apps/desktop/            Tauri shell + Vite entry point
  src-tauri/             Rust side: filesystem commands, window, settings store
packages/core/           the editor: engines, stores, i18n, platform adapters
  src/editor/            Milkdown + CodeMirror — the only place they are imported
packages/ui/             React components: shell, sidebars, settings, dialogs
docs/adr/                architecture decision records
```

`@newmd/core` never imports from `@newmd/ui`, and nothing outside `packages/core/src/editor` may call Milkdown or CodeMirror. That boundary is what keeps the two engines replaceable and lets everything else be tested without a browser.

---

## Quality gates

Four rules are enforced by tests rather than by convention:

1. **Golden round trip — merge gate.** `md → ProseMirror document → md` must come back byte-identical across the corpus in [`packages/core/tests/golden/`](packages/core/tests/golden/): headings, lists, tables, blockquotes, fenced code, images, and the awkward edges around trailing blank lines. Both editing engines are checked against the same corpus, so one cannot drift away from the other.
2. **Engine calls stay in the adapter layer.** All Milkdown and CodeMirror usage lives under `packages/core/src/editor/`.
3. **i18n coverage.** Identical key sets in both locales, every `t("…")` call resolves to a real key, no hardcoded copy in components, no raw text nodes in JSX.
4. **LF everywhere.** [`.gitattributes`](.gitattributes) pins line endings — the golden files are compared byte for byte, and `core.autocrlf=true` would otherwise rewrite them on clone and fail the gate on someone else's machine.

Not in place yet, but required by the ADR: Playwright end-to-end tests, and a Chinese-IME manual test pass before each release.

---

## Documentation

- [ADR-0001 — overall architecture](docs/adr/0001-typora-like-markdown-editor.md) (Chinese): why Tauri over Electron, why Milkdown, what is in and out of v1.0, and the milestone boundaries.
- [HANDOFF](docs/HANDOFF.md) (Chinese): where the project stands and what to pick up next.

---

## Known gaps

- No end-to-end test infrastructure yet.
- No installer package — only the web build is wired up.
- No screenshots in this README; the UI has moved on since the last capture.
- Bundle size: the main chunk is over 500 kB.
- No license file has been chosen.
