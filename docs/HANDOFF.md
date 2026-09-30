# NewMD 交接文档（HANDOFF）

> 给下一个 Claude Code 会话用。加载本文件即可接着干，无需重读整个仓库。
> 生成时间：2026-09-30（M3 刚收尾）。仓库根：仓库所在目录（本机绝对路径因机器而异）。

---

## 1. 项目是什么、现在到哪了

**目标**：仿 Typora 的 Markdown 编辑器（Windows 桌面），真 WYSIWYG + 源码模式切换，
产出的 `.md` 在 GitHub / VS Code / Obsidian 中可读。项目代号 **NewMD**。

**形态**：Tauri 2 桌面壳 + 纯 Web 核心（React 19.1 + TS strict + Vite + Zustand + Tailwind）。
**架构权威文档**：[docs/adr/0001-typora-like-markdown-editor.md](docs/adr/0001-typora-like-markdown-editor.md)（ADR-0001，已接受）。

**进度**（ADR §4 里程碑）：

| 里程碑              | 状态                             |
| ------------------- | -------------------------------- |
| M1 壳与文件 IO      | ✅ 完成                          |
| M2 WYSIWYG 核心     | ✅ 完成（golden 语料库 16 文件） |
| M3 源码模式与多标签 | ✅ **刚完成**（见 §3）           |
| M4 工作区与外观     | ⬜ 未开始 —— **下一步**          |
| M5 扩展渲染         | ⬜                               |
| M6 导出与体验       | ⬜                               |

**验证基线**（M3 收尾时）：204 测试 / 18 文件全绿；`packages/core`、`packages/ui`、
`apps/desktop` 三处 `tsc --noEmit` 干净；`vite build` 通过。
**每次改动后应复现这一基线**（命令见 §7）。

---

## 2. 硬约束（违反即返工）

1. **Milkdown / CodeMirror 调用全部收敛在 `packages/core/src/editor/`**（ADR §2.3）。
   UI 组件只能看到 `MarkdownSurface` 接口，不得 import 引擎包。
   换引擎应当只改这一层。
2. **golden 语料库是合并硬门槛**（ADR §2.10）：`md → ProseMirror doc → md` 必须字节级一致。
   语料在 `packages/core/tests/golden/`（16 文件）。
3. **不得破坏** open / save / autosave / session / recovery 链路与既有测试。
4. **界面文案默认中文，带英文切换**；全部文案外置到 `packages/core/src/locales/{zh-CN,en-US}.json`。
   有 `i18n-coverage.test.ts` 守着：两套 key 集合必须一致、每个 `t("…")` 必须能解析、
   **源码里不得出现 CJK**、JSX 里不得有裸文案、UI 属性（`placeholder`/`title`/`label`/`aria-label`）不得填裸文案。
   - 例外：`looksLikeCopy()` 对不含 `[A-Za-z一-鿿]` 的字面量返回 false，
     所以纯符号（`✕`、`＋`、`↑`）可以当裸 JSX 文本用。
5. **`packages/core` 不得 import Tauri API** —— 必须能在纯浏览器中运行与测试。
   平台能力走 `PlatformAdapter`（`packages/core/src/platform/`）。
6. **工程产物用英文**（代码、标识符、注释、测试名）；**与用户对话用中文**。
7. **工作方式**：red-green-refactor 纵向切片（`/tdd`），一次一片，先写失败测试。

---

## 3. M3 交付了什么（本轮新增）

| 交付物                | 落点                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| CodeMirror 6 源码模式 | `packages/core/src/editor/codemirror.ts`                              |
| 双向切换（`Ctrl+/`）  | `packages/core/src/editor/surface.ts` `setMode`                       |
| 查找替换              | `packages/core/src/editor/find.ts` + `tests/search.test.ts`（20 条）  |
| 多标签                | `stores/editor.ts` + `ui/components/TabStrip.tsx` + `session.ts`      |
| 撤销重做一致性        | `editor/handle.ts` `undo`/`redo`，双引擎 `tests/undo.test.ts`（8 条） |

新增测试文件：`tabs.test.ts`(10)、`undo.test.ts`(8)、`session-tabs.test.ts`(7)、
`mode-switch.test.ts`(7，含 1000 行文档往返)。

### 关键模型：多标签

`stores/editor.ts` 是唯一真相源：

```ts
tabs: OpenDocument[];      // 顺序即标签顺序，真相
activeIndex: number;       // 无打开时 -1
doc: OpenDocument | null;  // 镜像 tabs[activeIndex]，非第二真相
```

- **标签身份是 `(path, fileName)`**，不是数组下标。`openPath` 对已打开路径只聚焦不重复开。
  React key 用 `JSON.stringify([tab.path, tab.fileName])`。
- 所有写入走 `commit(set, tabs, activeIndex)`，同时发布三个字段。
- `doc` 的存在是为了让二十几处读「当前文档」的代码不用改。

### 撤销栈契约（易踩）

`MarkdownEditorHandle.setContent(text)` 是 **文档替换**，不是对当前文档的编辑：
**撤销历史随被替换的文档一起丢弃**。理由与实现细节写在 `handle.ts` 的 JSDoc 里，别改回去。

- CodeMirror 侧：`view.setState(EditorState.create({doc, extensions}))`。
  **不能**用全量 `changes` dispatch —— 那会把旧文档留在 history 里，Ctrl+Z 会串回上一个标签。
- Milkdown 侧：`replaceAll(text, true)`；**不做 equal-text 早返回** —— 两个空标签是同一段文本但不是同一个文档。
- `EditorPane.tsx` 的内容推送同时按 `docKey`（标签身份）与文本 keying，
  否则两个同文本标签会共用一个撤销栈。
- **换模式（`setMode`）必然重置撤销栈** —— 引擎被整体换掉。这是 ADR §2.9 的必然结果，不是 bug，不要"修"。

### 行为变更（有意为之，别当 bug 修）

- **打开文件 / 新建文档不再弹「是否保存」** —— 多标签下没有内容被丢弃。
  只有 `handleCloseTab` 会按标签弹确认。
- 会话快照存 `tabs[]` + `activeIndex`；恢复按「当时显示的是哪个文档」聚焦，不按槽位。
  前 tabs 时代的旧快照（无 `tabs` 字段）仍按单缓冲区恢复。

---

## 4. 下一步：M4「工作区与外观」

ADR §4 原文：

> 交付物 = 文件树、大纲侧栏、用户自定义 CSS、字体/字号设置、快捷键配置
> 验收 = **主题切换即时生效；大纲点击可跳转**

### 各交付物现状盘点（务必先读这段，别重做已有工作）

| 项                           | 现状                                      | 说明                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **文件树**                   | ❌ 完全没有                               | `Sidebar.tsx` 现在只有「工作区文件列表（扁平）+ 最近打开」，非树形，无目录展开。`workspace.ts` 的 `files` 只收 `kind === "file"` 且是 markdown 的项。**需要新建真正的树**（目录递归、展开折叠）。`PlatformAdapter.listDir` 已存在可用。     |
| **大纲侧栏**                 | ❌ 完全没有                               | 需要从当前文档抽出标题树，并支持点击跳转到编辑器对应位置。注意 ADR §2.3：跳转必须走 `MarkdownSurface` 的方法（该加就加接口），UI 不得直接摸 ProseMirror / CodeMirror。                                                                      |
| **用户自定义 CSS**           | ❌ 完全没有                               | ADR §2.11 写明：「用户 CSS 文件以 `<style>` 注入并可实时预览」。`AppSettings` 里目前**没有**这个字段，要加。                                                                                                                                |
| **字体/字号设置**            | ⚠️ **数据与生效链路已通，缺设置面板**     | `AppSettings` 已有 `fontFamily` / `fontSize` / `lineHeight` / `editorMaxWidth`，`useAppHooks.useTypographyVariables()` 已把它们写成 CSS 变量（`--font-editor`、`--editor-font-size` 等）。但 **`SettingsPanel` 组件根本不存在** —— 见下条。 |
| **快捷键配置**               | ⚠️ **快捷键在用但不可配置**               | `useAppHooks.ts` 的 `useHotkeys()` 里是一张**硬编码**的 switch：`Ctrl+N/O/S/Shift+S/// F/H/W/B/R/,`。**用户无法改**。要做成可配置（ADR §2.11「默认对齐 Typora / VS Code 习惯，设置面板可改」）。                                            |
| **主题切换即时生效**（验收） | ⚠️ 大概率已满足，但**没有针对这条的测试** | 主题走 CSS 变量层。M4 收尾时需要一条测试把它钉住。                                                                                                                                                                                          |

### 设置面板：已有雏形，缺的是完整面板

**勘误**：齿轮按钮**是**能用的。`TitleBar.tsx` 内部有 `SettingsPopover`，消费 `settingsOpen`
`Ctrl+,` 也通着。原稿说「没有任何组件消费」是错的 —— 那次 grep 排除了 TitleBar，
而 popover 恰好定义在 TitleBar 里面。

真实的缺口在它自己的注释里：

> Minimal settings surface. The full settings surface is an M4 deliverable; this
> carries only the language switch the copy layer needs to be demonstrable.

也就是：**面板只放了语言切换**。主题走 TitleBar 上的独立按钮（`toggleTheme`，
只能在 light/dark 之间翻，**选不回 "system"**），排版四项没有 UI 入口。

M4 的面板工作 = 把这个 popover 扩成完整面板：外观（主题三选 + 字体/字号/行高/宽度）、
自定义 CSS、快捷键配置。底座 `SettingsState`（`patch`/`set`/`load`/`sanitize`，
持久化到 `SETTINGS_KEY`）是完整的，缺的只是 UI。

---

## 5. 已知缺口 / 技术债（未指派，按需取用）

- **`packages/ui` 没有测试运行器** —— `actions.ts`、`TabStrip.tsx`、`EditorPane.tsx`、
  `AppShell.tsx` 的 React 接线全无测试。core 有 204 条，ui 是 0。
- **E2E 基础设施从未搭建**，尽管 ADR §2.10 要求 Playwright / tauri-driver。
  里程碑收尾的「跑完 golden + E2E + 中文输入法手测」这条例行检查因此**每次都会欠账**。
- **中文输入法手测清单**（微软拼音 / 搜狗）只能人工做，未做。
- **崩溃恢复缓冲 `RECOVERY_KEY`**（`autosave.ts`）**只写不读** —— 从没被读回来过。
- **构建告警**：chunk 1,323 kB（> 500 kB 阈值），既有问题，非本次引入。
- **`packages/export` 未创建**（M6 的事）。
- **无 README**；`.m1-screenshot.png` 未跟踪。
- emphasis/strong 的 `*` / `_` 标记保留未做（M2 遗留）。
- 查找替换遗留项：无跨匹配高亮、无 `N/M` 计数、查找栏开着时 `Ctrl+F` 不会重选查询文本。
- 标签页无快捷键切换；`Ctrl+W` 绑的是关**当前**标签（`handleCloseDocument`）。

---

## 6. 不要动的东西

- **`handle.ts` 里 `setContent` 的撤销历史契约**（见 §3）。注释写得很完整，是踩过坑换来的。
- **`stores/editor.ts` 的 `commit()` 单写入口**，以及 `doc` 作为 `tabs[activeIndex]` 镜像的设计。
  直接 `useEditor.setState()` 绕过它会让三个字段不一致。
- **`i18n-coverage.test.ts` 的规则**。想往 UI 里塞裸中文文案会被它拦，这是有意的。
  要加文案 → 先进两个 locale 文件。
- **golden 语料的期望文件**（`*.expected.md`）。它们是字节级基准；
  只有当序列化规则**有意**变更时才改，且必须说明理由。
- **`packages/core` 不 import Tauri** 的边界（见 §2 约束 5）。
- 旧版会话快照的兼容路径（`session.ts` 里 `snapshot.tabs ?? …` 的 fold-in）。
  有测试守着，删了会丢老用户的会话。

---

## 7. 环境与命令（Windows，工具链有坑）

**npx / npm 的 shim 在这台机器上是坏的**，一律直接调入口文件。

| 用途             | 命令（在仓库根执行）                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| core 测试        | `node packages/core/node_modules/vitest/vitest.mjs run --root packages/core` |
| core 类型检查    | `node node_modules/typescript/bin/tsc --noEmit -p packages/core`             |
| ui 类型检查      | `node node_modules/typescript/bin/tsc --noEmit -p packages/ui`               |
| desktop 类型检查 | `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop`              |
| 格式化           | `node node_modules/prettier/bin/prettier.cjs -w <path>`                      |
| 构建             | `cd apps/desktop && node node_modules/vite/bin/vite.js build`                |

注意：**vitest / vite 在包本地 `node_modules`，tsc / prettier 在工作区根**（pnpm 不提升）。

**写文件的坑（都踩过）**：

- Bash heredoc 里的反斜杠会被二次反转义 —— 含转义序列的内容用 Write 工具写，别用 `python <<'PY'`。
- **Write 工具的 `content` 里写 `\uXXXX` 会落地成真实控制字符**。曾把一个 NUL 字节写进
  `TabStrip.tsx` 的模板字符串，之后 `grep` 全报 "Binary file matches"。
  写完含特殊字符的文件后用 `file <path>` 确认是 "UTF-8 text"。

---

## 8. 仓库结构速查

```
apps/desktop/          Tauri 2 壳（src/App.tsx, main.tsx, platform/）
packages/core/
  src/editor/          ← 引擎适配层（Milkdown / CodeMirror），UI 禁止越界
    handle.ts          MarkdownEditorHandle + MarkdownSurface 契约
    surface.ts         引擎切换 + 转发
    wysiwyg.ts         Milkdown
    codemirror.ts      CodeMirror 6
    find.ts            查找替换
  src/stores/          zustand: editor / settings / ui / workspace
  src/platform/        PlatformAdapter + browser 实现（无 Tauri 依赖）
  src/session.ts       会话快照/恢复（多标签）
  src/autosave.ts      800ms debounce + 失焦即存
  src/locales/         zh-CN.json / en-US.json
  tests/               204 条测试；golden/ 16 个语料文件
packages/ui/
  src/components/      AppShell / TitleBar / Sidebar / TabStrip / EditorPane
                       FindReplace / StatusBar / Toast / ConfirmDialog
  src/actions.ts       业务动作（打开/保存/关标签…）
  src/hooks/           useAppHooks（快捷键、标题、排版变量）、useT
```

**当前 git 状态**：全部未跟踪（`?? apps/ packages/ docs/ …`），**没有任何提交**。
仓库刚初始化，建议下个会话开始前先做一次初始 commit，方便回滚。

---

## 9. 用户的工作偏好

- **对话用中文**，工程产物（代码/注释/测试名）用英文。
- 用户会直接给管理员权限 / 环境放行，遇到权限问题可以再试。
- 倾向于「继续吧」式推进 —— 一次一个里程碑往下走，遇到需要拍板的再问。

---

## 10. 未决问题（ADR §6，非紧急）

1. 产品正式名称与图标（当前用 `NewMD` 作代号）
2. Windows 代码签名与自动更新（Tauri updater？）
3. DOCX 复杂表格/数学的降级策略
4. 拼写检查深度（系统词典 vs 自建）
5. 文件重命名/移动的引用重写范围（只图片 vs 所有相对链接）
6. 是否为插件系统预留扩展点（v1.0 明确不做）
