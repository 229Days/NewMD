# NewMD 交接文档（HANDOFF）

> 给下一个 Claude Code 会话用：读完本文件即可接着干，不必重读整个仓库。
> 更新时间：2026-10-16 ｜ HEAD：`b3b3c7f`
> ⚠️ 仓库是 **public** 的 —— 任何文档、注释、提交信息里都不要写本机绝对路径、
> token、密钥、账号。（上一版交接文档里的本机路径已在首次 push 前抹掉，别写回去。）

---

## 1. 项目是什么、现在到哪了

**目标**：仿 Typora 的 Markdown 编辑器（Windows 桌面），真 WYSIWYG + 源码模式切换，
产出的 `.md` 在 GitHub / VS Code / Obsidian 中可读。代号 **NewMD**。

**形态**：Tauri 2 桌面壳 + 纯 Web 核心（React 19 + TS strict + Vite + Zustand + Tailwind 4）。
**架构权威文档**：[docs/adr/0001-typora-like-markdown-editor.md](docs/adr/0001-typora-like-markdown-editor.md)
（ADR-0001，已接受；进度、验收、未决问题都以它为准）。另有四份局部 ADR：
[0002 `[TOC]`](docs/adr/0002-toc-directive.md)、
[0003 重命名引用重写](docs/adr/0003-rename-reference-rewrite.md)、
[0004 多光标范围](docs/adr/0004-multi-cursor-scope.md)、
[0005 M6 导出与体验](docs/adr/0005-export-and-experience.md)。

**进度**（ADR §4 里程碑）：

| 里程碑                                  | 状态                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 壳与文件 IO                          | ✅                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M2 WYSIWYG 核心                         | ✅                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M3 源码模式与多标签                     | ✅                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M4 工作区与外观                         | ✅                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M5 扩展渲染                             | ✅ 七片全部合入（见 §3.1）                                                                                                                                                                                                                                                                                                                                                                                                     |
| **v1.0 功能缺口**（用户本轮圈定的范围） | ✅ **7 项全部收口**：拖拽 `d1c1a1d`、本地路径插入 `146452b`、front matter 编辑 `a370e1a`、Shiki 高亮 `8d7d81c`、`[TOC]` 目录 `190d1cc` + `5e35a48`、重命名引用重写 `bb51e9b` `52198e5` `4ff3af9` `12738ae` `b7d3bbe` `ed5f6b9`（ADR-0003）、**多光标** `3694e03`（ADR-0004 —— 源码模式做，WYSIWYG **明确不做**）。见 §4                                                                                                        |
| M6 导出与体验                           | 🟡 **设计已定案，①②③ 已合入** —— 设计全在 [ADR-0005](docs/adr/0005-export-and-experience.md)（七条决策 + 九片切分，见 §6）。① 号切片（正文样式表）`475c42f`（§3.11），② 号切片（`packages/export` + `@newmd/core/document` + MD→HTML 序列化器）`08cbcb4` `240fd92` `cfbd7f6`（§3.12），③ 号切片（HTML 导出的通路：导出下拉 + 保存对话框 + 写盘）`b3b3c7f`（§3.13），④–⑨ 一行没写。用户明确要求**排在功能缺口之后**，现在排到了 |

**验证基线（HEAD = `b3b3c7f` —— 最后一次改代码的提交）**：

| 检查                       | 结果                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm test`                | core **466** / 40 文件，ui **50** / 7 文件，export **26** / 1 文件（新包） 全绿             |
| `pnpm typecheck`           | core / export / ui / desktop 四处 `tsc --noEmit` 全 0                                       |
| prettier `--check`         | 全绿                                                                                        |
| `cargo check`（src-tauri） | 0                                                                                           |
| `pnpm build`               | 0（有 chunk 体积警告，见 §5.2；Shiki 让产物从 5.2 MB 涨到 16.2 MB，见 §3.5）                |
| golden                     | `packages/core/tests/golden/` **21 个语料**，其中 6 个带 `.expected.md`（③ 不碰语法，未增） |

**每改一行都应复现这一基线**，命令见 §7。

**最近提交**（新到旧）：

```
b3b3c7f Carry the page out of the app (M6 slice ③)
8457f93 Write down what the second slice settled (ADR-0005 §2.4 / §2.6 落地补记)
cfbd7f6 Carry the pictures into the page (M6 slice ②.3)
240fd92 Draw the formulas and the diagrams in the export (M6 slice ②.2)
08cbcb4 Open a second door onto core, and write the HTML export behind it (M6 slice ②.1)
2bf70b5 Bring HANDOFF.md up to date (M6 slice ① merged)
475c42f Give the document a stylesheet, and give the WYSIWYG body its scroll container
ffcf358 Decide how M6 exports, and write down what the milestone actually is (ADR-0005)
a7d84cb Close out HANDOFF.md for the gap list being empty
3694e03 Give source mode more than one caret, and Alt the one key that grows it
9cf78ad Bring HANDOFF.md up to date (6/6 v1.0 gaps, one left)
ed5f6b9 Let a row in the tree be renamed, and refuse the names that cannot be
b7d3bbe Move the tabs, the tree and the disk in the one order that holds
12738ae Land a rename's rewrite where each document actually lives
4ff3af9 Respell a document's links when the file they point at moves
52198e5 Write a destination relative to the document that carries it
bb51e9b Decide how a rename rewrites the references (ADR-0003)
5e35a48 Draw [TOC] as a list the reader can jump from (v1.0 gap: [TOC] 目录)
190d1cc Give [TOC] a node of its own, so a save stops escaping it
163f908 Bring HANDOFF.md up to date (4/6 v1.0 gaps)
8d7d81c Colour fenced code with Shiki (v1.0 gap: Shiki 代码高亮)
a370e1a Let the reader edit front matter in place (v1.0 gap: front matter 可视化编辑)
ccda530 Bring HANDOFF.md up to date (M5 done, 2/6 v1.0 gaps)
146452b Insert an image picked from disk (v1.0 gap: 本地路径插入)
d1c1a1d Accept a dropped image into ./assets/ (v1.0 gap: 拖拽)
167dc62 Save a pasted image beside its file (M5 slice 7)
febc121 Draw mermaid fences as diagrams (M5 slice 6)
eee95f9 Show YAML front matter as a block (M5 slice 5)
cc75d2b Add KaTeX math rendering (M5 slice 4)
138e0d1 Pin footnotes end to end (M5 slice 3)
baa22d8 Add ^sup^ and ~sub~ as editable marks (M5 slice 2)
4241a24 Add ==highlight== as an editable mark (M5 slice 1)
4f84011 Add README
b88df55 Initial commit: NewMD through M4
```

---

## 2. 硬约束（违反即返工）

1. **Milkdown / CodeMirror / ProseMirror 调用全部收敛在 `packages/core/src/editor/`**（ADR §2.3）。
   UI 只能看 `MarkdownSurface` / `MarkdownEditorHandle`，不得 import 引擎包。换引擎只改这一层。
   - **边界画在 `src/`，不在 `tests/`**：`packages/core/tests/multi-cursor.test.ts` 直接 import 了
     `@codemirror/state` / `@codemirror/view`（全仓测试里就这么一处，§3.8 讲了为什么非这样不可）。
     这不违反本条 —— 但它也不该变成习惯：能走 handle 观察的就走 handle。
   - **`@newmd/core/document` 是这条边界的第二道门**（② 号切片立的，ADR-0005 §2.4）：从它出发能走到的
     东西，一律不许 import Milkdown / CodeMirror / ProseMirror。守卫是
     `tests/document-subpath.test.ts`（走 import 图，连 `import()` 也跟）—— 往门里加文件要在它的
     `EXPECTED_FILES` 里登记，否则守卫红。
2. **golden 语料是合并硬门槛**（ADR §2.10）：`md → ProseMirror doc → md` 必须字节级一致。
   **任何新的 _语法_**（不是新的渲染方式）都要：往 `packages/core/tests/golden/` 补语料 +
   在 `tests/golden.ts` 的 `EXERCISES` 里登记对应 mdast 节点类型
   （节点类型必须落在 `parse()` ∪ `parseTransformed()` 的并集里，否则守卫会红）。
3. **不得破坏** open / save / autosave / session / recovery 链路与既有测试
   （当前数量见 §1「验证基线」，别在这里再抄一份会过期的数字）。
4. **文案双 locale 外置**：`packages/core/src/locales/{zh-CN,en-US}.json`，两套 key 集合必须一致
   （`i18n-coverage.test.ts` 守着），新 key 按字母序插入。React 侧只能通过 `useT()` 拿 `t`。
   - **今天踩到的新规则**：`leaves no raw copy in a ternary or nullish operand` 这一条的正则是
     `[?:]` 后紧跟字符串字面量 —— 也就是说 **UI 层（`packages/ui/src`、`apps/desktop/src`）
     里任何一个 `key: "字面量"` 都会被判违规**（今天 `{ name: "Images", … }` 就红了）。
     修法：值走 `t("…")`，或把常量搬到 `packages/core/src`（core 不受这条管）。
   - `name` **不在** `UI_SLOTS` 里，所以 `name: "…"` 触发的是上面那条 ternary 规则，
     不是 UI-slot 规则 —— 两条规则的落点不同，别改错地方。
5. **`packages/core` 不得 import Tauri API** —— 必须能在纯浏览器里跑与测。平台能力走
   `PlatformAdapter`（`packages/core/src/platform/`）。
6. **新增平台能力的固定流程**（有 `readBinaryFile` 的先例可抄）：
   `platform/types.ts` 加签名 → `platform/browser.ts` 与 `apps/desktop/src/platform/tauri.ts` 双侧实现
   → **7 个 fake 适配器**同步补占位：`packages/core/tests/` 下的
   `appdata / file-tree / locale / paste-image / session-tabs / tabs` 六个测试文件，
   外加 `packages/ui/tests/helpers/platform.ts` —— 少一个就编译不过 → 需要 Rust 的话
   `apps/desktop/src-tauri/src/commands/fs.rs` 加命令并在 `lib.rs` 的 `invoke_handler` 里注册。
7. **工程产物用英文**（代码、标识符、注释、测试名、README）；**与用户对话用中文**。
8. **工作方式**：red-green-refactor 纵向切片（`/tdd`），一次一片，先写失败测试。
   按 CLAUDE.md 路由：规划 → `/grill-with-docs`，实现 → `/tdd`，bug → `/diagnose`，
   会话结束 → `/handoff`，快问快答 → `/caveman`；一轮只调一个 skill。

---

## 3. 本轮交付了什么

### 3.1 M5「扩展渲染」七片（全部合入，见 §1 提交列表）

KaTeX 数学、`^sup^` / `~sub~`、`==highlight==`、脚注、YAML front matter 块、Mermaid、
图片粘贴落 `./assets/`。新增测试：`math.test.ts`、`inline-marks.test.ts`、`super-sub.test.ts`、
`footnotes.test.ts`、`front-matter.test.ts`、`mermaid.test.ts`、`paste-image.test.ts`。

### 3.2 v1.0 第 1 片：拖拽落盘（`d1c1a1d`）

| 落点                             | 内容                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `core/src/editor/surface.ts`     | 在 `options.parent` 上挂 **capture** 的 `dragover` / `drop`（连同原有的 `paste`）；`destroy()` 三个都要解绑 |
| `core/src/editor/paste-image.ts` | `imageFilesIn()`（一次拖多张，按选择顺序）、`carriesFiles()`；与 `savePastedImage()` 共用写盘与错误路径     |
| `core/tests/paste-image.test.ts` | `describe.each(["wysiwyg","source"])` 双引擎各 5 条                                                         |

**为什么是 capture 监听挂在 `parent` 上**：两个引擎各自在更深一层的 editable 上绑自己的 handler，
在 host 上用 capture 就一定先于它们跑；`stopPropagation` 一停，对面引擎就听不到。
**一个实现覆盖两个引擎**，不用写两遍。

### 3.3 v1.0 第 2 片：本地路径插入（`146452b`）

| 落点                                                                               | 内容                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/editor/paste-image.ts` `saveLocalImage()`                                | 从盘上读图 → 拷进文档旁的 `./assets/` → 返回相对路径。**保留读者原文件名**（粘贴的字节匿名才用时间戳名）；同名被占才退到 `YYYYMMDD-HHmmss-<hash8>`；源就是目标时不拷 |
| `platform/types.ts` + `browser.ts` + `tauri.ts`                                    | 新增 `readBinaryFile(path): Promise<Uint8Array>`（与 `readTextFile` 分开：图片经字符串就是一次有损转码）                                                             |
| `src-tauri/src/commands/fs.rs` `read_binary_file`                                  | 返回 **`BinaryFileDto { bytes }`** 而不是裸 `Vec<u8>` —— 裸 `Vec<u8>` 在 IPC 上有 `Raw` / `Json` 两种落法，`invoke` 侧不该猜                                         |
| `core/src/stores/ui.ts`                                                            | `imageInsert: { image, seq }` + `requestImageInsert()`，**照抄 `RevealRequest` 的模式**（`seq` 用来区分两次相同请求）                                                |
| `ui/src/components/EditorPane.tsx`                                                 | `useEffect` 订阅 `imageInsert` → `handleRef.current.insertImage(...)`（surface 是 EditorPane 私有的，外部进不去）                                                    |
| `ui/src/actions.ts` `handleInsertLocalImage()`                                     | 未保存的文档直接 toast 拒绝（没有 `./assets/` 可写）；picker 取消什么都不做；失败走 `report()`                                                                       |
| `core/src/hotkeys.ts` + `ui/hooks/useAppHooks.ts`                                  | 新动作 `insertImage`，默认 `Mod+Shift+I`，`firesInEditable: true`                                                                                                    |
| `core/src/editor/index.ts`                                                         | barrel 补导出 `saveLocalImage` / `ImageTarget`（**不是引擎形状的东西**，barrel 的 JSDoc 已写明这个区分）                                                             |
| `core/tests/local-image.test.ts`（5 条）、`ui/tests/insert-image.test.tsx`（4 条） | 保留原名 / 撞名退时间戳名 / 已在 `./assets/` 不重拷 / 读不到 / 没有父目录；以及 UI 四态（写入、未保存拒开 picker、取消无副作用、写失败报错）                         |

新增 locale key：`actions.insertImage`、`editor.needsSaveFirst`、`editor.imageFilter`、
`hotkeys.insertImage`（两套 JSON 各一份）。

**这一片没有加 golden 语料** —— 两种入口产出的都是已有的 `![](./assets/…)` 图片语法，
不构成新语法（见 §2 约束 2 的分界）。

### 3.4 v1.0 第 3 片：front matter 就地编辑（`a370e1a`）

全部落在 `core/src/editor/wysiwyg.ts` + `core/tests/front-matter.test.ts`（新增 3 条，共 6 条）。
**引擎之外一行没动**，也**没有新文案**（行里显示的是读者自己写的字）。

| 落点                                                 | 内容                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `frontMatterRows()` / `editableFrontMatterRows()`    | 从原 `toDOM` 内联体里抽出来的两个函数：前者=`toDOM`（复制/导出走它，**不带光标**），后者给每行加 `contenteditable` |
| `frontMatterView = $view(frontMatterSchema.node, …)` | 节点视图，`.use(frontMatterView)` 注册                                                                             |
| `update`                                             | 只有当「行拼起来」与节点 `value` 不一致时才重建 DOM（撤销 / 切标签 / `setContent` 会不一致，恰好就是该重建的时刻） |
| `stopEvent: () => true`                              | 面板内的事件归读者，不归 ProseMirror                                                                               |
| `onKeyDown`（Enter）                                 | `preventDefault` + 在**行内**插入 `\n` 文本节点 + 手工调 `onInput()`                                               |

**为什么写回仍然是「视图」而不是解析器**：进去的是「各行按 `\n` join」，出来的还是它 ——
和 `toDOM` 拆的、`parseDOM` 拼的是同一次拆分。全程**不把 YAML 当 YAML 读**，所以注释、
缩进列表项、`description` 里的冒号都不会被「理解」掉。golden 的 `front-matter.md` 因此继续字节一致，
**没有新语法 → 没加语料**（§2 约束 2 的分界）。

**Enter 为什么必须自己接**：浏览器的默认行为是把行 `div` **拆成旁边第二个** `div`，
那个兄弟上**没有 `data-line`**，`shown()` 读不到，下一次保存就**静默丢行**。
在行内插 `\n`（面板的 `white-space: pre-wrap` 会继承下来）对读者是同一个换行，
却让 Backspace / Delete 删换行仍然交给浏览器 —— 它们本来就做对了。

**已知未覆盖**：往行里**粘贴多行文本**没接管，Firefox 会把换行变成 `<br>`（`textContent` 读不到）。
要补就在面板上加 `paste` 监听，`preventDefault` 后自己 `insertNode(createTextNode(text))`。
jsdom **没有 `ClipboardEvent` / `DataTransfer`**（实测 `typeof` 均为 `undefined`），
写测试只能用假事件对象，届时自己判断值不值得。

### 3.5 v1.0 第 4 片：Shiki 代码高亮（`8d7d81c`）

`core/src/editor/highlight.ts`（新）+ `highlight.css`（新）+ `wysiwyg.ts` 里的 `codeHighlight()`

- `core/tests/highlight.test.ts`（新，6 条）。依赖 `shiki@^4.5.0` 装在 `packages/core`。
  **没有新语法 → 没加语料**；**没有新文案**（高亮不产生可见文字）。

| 落点                    | 内容                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `highlight(code, lang)` | 走 `codeToTokens`（双主题 `github-light` / `github-dark`），返回 `{ offset, text, style }[]`；**有缓存** |
| `highlighted(...)`      | 同步读缓存，返回 `undefined` = 还没好、`null` = 永远好不了（**两者必须分开**，画帧的人得区分）           |
| `codeHighlight()`       | `$prose` 插件：`Decoration.inline` 逐 token 上色，`data-newmd-token` + `style` 两个属性                  |
| `highlight.css`         | `[data-theme="dark"] [data-newmd-token] { color: var(--shiki-dark) !important }` —— 暗色半边就这一条规则 |
| `ensure(view)`          | 文档变了才去问 Shiki；`Promise.all` 全部回来后才 dispatch 一次刷新                                       |

**为什么是装饰器而不是 NodeView**：代码块必须还是读者自己的文本 —— 原地可编辑、一条撤销栈、
和别的块走同一个序列化器。NodeView 要亲手把这四样一一交还，而第一个会坏的就是 round-trip 门槛。
装饰器只说「这一段怎么画」，文档一个字没动 —— 所以 `getContent()` **根本看不出高亮有没有跑过**，
测试只能问 DOM（这也是 `tests/highlight.test.ts` 的断言全在 DOM 上的原因）。

**异步，而且是「陈旧」而不是「空白」**：一次按键让整块 token 全部作废。等新 token 时先把颜色清掉，
等于每个字符都在光标周围重建 span。所以旧装饰器**跟着 `tr.mapping` 平移**留在屏上，新 token 到了再换。
两个防抖条件：`signature` 变了才重新问；回来时若文档已再度变化就**丢掉这次刷新**（谁持有文档谁刷）。
再有一条：**整个文档的围栏都回来才重绘**，否则慢一拍的块会在邻居刷新时丢掉颜色。

**主题为什么不用重算**：每个 token 同时带 `color`（亮色）与 `--shiki-dark`（暗色），
`[data-theme]` 翻转时由 CSS 读第二个。这比 mermaid 的处境好 —— mermaid 的颜色已经被库烤进 SVG 了，
只能重画（`mermaid.ts` 的 `watchTheme`），代码块是文本，所以能省掉这次重算。
`!important` 是必需的：亮色写在元素自己的 `style` 上，没有选择器能盖过它。
亮色**故意留在行内**，这样即使样式表没加载（把标记复制到别处），块也还是有颜色。

**`highlight.css` 放在 core 是一次有意的例外**：本项目此前的分工是「core 只吐 `data-newmd-*` 属性，
样式在 `packages/ui/src/styles.css`」（front matter、mermaid 都这样）。这里不这么分，是因为
`--shiki-dark` 与读它的那条规则是**同一个机制的两半**，分在两个包里迟早会有一半先发出去，
而缺了规则的暗色文档是「亮色被当成暗色用」且**屏幕上没有任何迹象**。
`math.ts` 自带 KaTeX 样式表是同一个理由。

**已验证的体积代价（用户拍板：保持全量）**：`import()` 生效 —— 1.6 MB 的入口 chunk 里
**Shiki 出现 0 次**，Shiki 自己在 `index-P_WAeC7R.js`（211 KB），文档里没有围栏就一行都不加载。
但全量语言包带来 **309 个按需加载的语法 chunk**：`apps/desktop` 产物从 **5.2 MB → 16.2 MB**
（11 MB 是语法）。启动与内存不受影响，只拉围栏实际点名的那个语言。
要收窄就改用 `shiki/core` + 显式导入语言表（`shiki/bundle/web` **不够**：实测缺 `rust` / `go` /
`diff` / `toml` / `zig`，只适合网页，不适合文档编辑器）。

**未知语言是一种值，不是异常**：Shiki 对没有语法的围栏**抛异常**
（``Language `x` is not included in this bundle``），而 README 里 ` ```output ` / ` ```text `
是日常写法。`tokenize` 把失败 `catch` 成 `null` —— 那是「按纯文本画」，不是「文档打不开」。

**已知未覆盖**：高亮不参与导出（M6 的一半）；`Decoration.inline` 不做 `mark`（代码块 `marks: ""`），
所以是画上去的，不进文档；主题切换只有 CSS 一条路径，**没有测试能覆盖**（jsdom 不解析 `var()`），
测试只能断言 `highlight.css` 里那条规则存在（见 §3.10 最后一条）。

### 3.6 v1.0 第 5 片：`[TOC]` 目录（`190d1cc` + `5e35a48`）

设计全文在 **`docs/adr/0002-toc-directive.md`**（已接受）—— 读它比读这张表快。
两个提交分工：`190d1cc` 是**节点类型**（字节那一半），`5e35a48` 是**渲染**（块那一半）。

**动手前探到的一条改变了问题形状的事实**：`[TOC]` 今天不是「还没做的功能」，**它就是一个往返 bug**。

```
roundTrip("[TOC]\n")   === "\\[TOC]\n"
roundTrip("> [TOC]\n") === "> \\[TOC]\n"
```

根因在 `mdast-util-to-markdown/lib/unsafe.js` 的
`{character: '[', inConstruct: 'phrasing', notInConstruct: fullPhrasingSpans}` —— 正文里**每一个**
`[` 都被转义，`tests/roundtrip.test.ts` 一直没抓到只是因为语料里没有一份触发它的文件。
由此的硬结论：**写回必须有一个自己的 stringify handler 直接吐出 `[TOC]`**（绕开 `safe()`），
而 handler 得挂在 mdast 节点类型上 → `[TOC]` **必须是真节点**。这构成 §2 约束 2 说的「新语法」，
所以补了 `tests/golden/toc.md` 并在 `EXERCISES` 登记 `["toc"]`。

| 落点                                                             | 内容                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/editor/toc.ts`                                         | `tocMarkerText` / `tocMarker` / `remarkToc` / `tocHandlers`。节点是 `{type:"toc", value:"原样拼写"}` —— `[toc]` **不许**被规范化成 `[TOC]`。`remarkToc` 在两处都注册在 `inlineLinkReferences` **之后**，让「作者定义过 `[TOC]:` 就它是链接」由顺序自动裁决 |
| `core/src/editor/toc.ts`（DOM 半边）                             | `TocEntry` / `fillTocList` / `tocEntryTarget`。建元素一次引擎调用都不发，所以留在这个文件（`mermaid.ts` 不在 `wysiwyg.ts` 里是同一个理由）。缩进以 `--newmd-toc-indent` 这个**纯数字**交出去，乘多少是外观                                                 |
| `core/src/editor/toc.css`                                        | 两态机制本身（两条 `display` 规则），由 **`wysiwyg.ts`** 引入而**不是** `toc.ts` —— 归并门槛 `markdown.ts` 也 import `toc.ts`，而往返一行字节都不该依赖样式表                                                                                              |
| `wysiwyg.ts` `headingsIn` / `revealHeadingIn`                    | 从原来内联在 `revealHeading` 里的走法抽出来的**共用标题遍历**。目录条目与跳转目标必须同一套 `(level, text, occurrence)` 算术，否则第二个 `## Same` 会跳到第一个去                                                                                          |
| `wysiwyg.ts` `tocView`                                           | `$view(tocSchema.node, …)`：一次渲两半（`[data-newmd-toc-list]` + `[data-newmd-toc-source]`），`contentDOM` 是 source。**必须显式写 `ignoreMutation`**，见下                                                                                               |
| `wysiwyg.ts` `tocBlock()`                                        | `$prose` + `appendTransaction`：顶层段落内容恰好是标记 → `setNodeMarkup(pos, tocType)`；`toc` 块内容不再是标记 → 退回段落。转换事务带 `setMeta("addToHistory", false)`，撤销链上只留读者自己敲的那一下                                                     |
| `wysiwyg.ts` `tocList()`                                         | 插件级 `view.update`（先比签名），标题变了才重画**所有** `[data-newmd-toc-list]`。签名手法同 §3.5                                                                                                                                                          |
| `wysiwyg.ts` `tocMode()`                                         | `$prose` 的 `props.decorations`：对光标**不在其中**的每个 `toc` 节点打 `data-mode="preview"`                                                                                                                                                               |
| `packages/ui/src/styles.css`                                     | 目录外观 + `--newmd-toc-indent` 的乘数 + `ul:empty { min-height: 1.25em }`                                                                                                                                                                                 |
| `tests/toc.test.ts`（12 条）、`tests/toc-block.test.ts`（20 条） | 前者在 mdast 层；后者全部在 DOM 上（jsdom），用真打字 / 真退格 / 真点按驱动                                                                                                                                                                                |

**为什么一打完就转换，而不是等回车**：回车方案下**粘贴**进来的 `[TOC]` 不会成块，保存时会被序列化成
`\[TOC]` —— 「屏幕上看到什么，文件里就是什么」在那条路径上就破了。`appendTransaction` 不是 Milkdown 的 API，
是 ProseMirror 标准件（`codeHighlight()` 已用过同形态），不越过 ADR-0001 §2.3。

**`ignoreMutation` 是硬要求（实测，不是猜的）**：NodeView 有 `contentDOM` 时默认 `ignoreMutation` 是 `false`，
ProseMirror 于是把 contentDOM 之外的**任何**变更当成「整个节点变了」，标脏后重建 —— 症状是文档里
**任何一处**敲键，块都会被换成一个新元素（块里没变，元素却换了）。`tocView` 的写法是
`(mutation) => !source.contains(mutation.target)`，`tests/toc-block.test.ts` 用**元素同一性**把它钉住了
（断言重画后 `[data-newmd-toc-list]` 还是同一个元素）。
⚠️ 这条曾经**活过**一轮变异测试（改成 `() => false` 时**当时的 12 条全绿**）—— 别因为「改了也不红」就删掉它，
它只是需要一条问 DOM 同一性的断言才看得见。

**为什么两态是 decoration，不是 NodeView 的状态机**：`props.decorations` 每次状态变化都重算
（**含纯选区事务**），而 NodeView 的 `update` **只在这个节点自己变时**被调用 —— 光标移进移出不算，
这个切换它接不住。副产品：两态在 jsdom 里可测（断言 `data-mode` 属性），不必依赖布局。

**缺省是源码态**：`data-mode` 缺失 = 显示那 5 个字符。这是个**安全的默认值** —— decoration 万一丢了，
读者看到的是文件本身，而不是一份「由可能已经变过的文档画出来」的目录。

**空目录的可用性陷阱**：文档没有标题时列表是空的，而 `display:none` 的块高为 0，
光标离开后**点不回去**（而「读完条目后光标离开」正是常态）。解法在 `packages/ui/src/styles.css`：
`[data-newmd-toc-list] ul:empty { min-height: 1.25em }`。

**这一片没有新文案**（块上的字全是读者自己的），所以不涉及双 locale。
条目是 `<button type="button">` 而**不是** `<a href="#…">` —— Markdown 标题没有 id，
凭空造一套 id 就是第二个身份系统还得扛往返（ADR-0002 §2.6）；导出 HTML 需要的真锚点留给 M6。

**已知未覆盖**：`display:none` 藏掉的那一半是否真的不干扰读 DOM，**jsdom 测不到**（它不跑层叠也不布局），
要在真浏览器手测一次；`[TOC]` **在列表项 / 引用块里仍会被转义成 `\[TOC]`**（§2.3 范围之外的原库行为，
见 ADR-0002 §3）。

### 3.7 v1.0 第 6 片：重命名时的引用重写（ADR-0003）

设计全在 `docs/adr/0003-rename-reference-rewrite.md`，这里只记**落地与踩到的**。

**六条提交**：`bb51e9b` 定案 → `52198e5` 相对路径写法 → `4ff3af9` 单文档重写 →
`12738ae` 落到每个文档 → `b7d3bbe` 编排顺序 → `ed5f6b9` 树上的入口。

**引擎的核心一步是「算绝对值再重新拼」**：拿**文档移动前**的目录（由 `pathAfterMove(documentPath, to, from)`
反解）把相对目标解成绝对路径，过一遍 `(from, to)`，再相对**新**目录拼回去。两个方向
（文档自己动了 / 文档没动但指向的东西动了）都是这三步。`pathAfterMove` 落在
`platform/path.ts`，是纯算术，**不是适配器方法** —— 加一个适配器方法要同步 browser + tauri + 7 个 fake。

**定点拼接，不走 parse → stringify**：往返会把读者没碰过的格式一起改掉（强制 `-` 列表符、
引用式链接展平）。改成对 `parse()` 的原始树**逐节点量出 span 再 splice**，没碰的字节一个不差。

**三个反直觉处，都写进了测试**：

- **围栏代码块里的链接形状文本**：正则扫全文会改到它，所以必须走树（`code` 节点的 span 包含那些字）。
- **mdast 的 `url` 已经解码了反斜杠转义**（`./a\(b\).md` → `./a(b).md`），**但保留百分号编码**。
  回写时要按作者原来的拼法还原，所以每种拼法（原样 / 转义 / 各自加尖括号）都试一遍。
- **`unrewritten` 不是「没找到」而是「找到了但改不了」**：跨盘符时没有合法相对路径，
  计数并留着原样，比写一个指向虚空的路径诚实。

**编排的顺序是设计本身**，每条都由一个失败模式逼出来（`renameEntry` 的注释里也写着）：
标签先动（自动保存按标签的 `path` 写、Rust 侧 `ensure_parent` 会 `create_dir_all`，
标签留在旧路径就等于**800ms 后把旧文件原地写回来**）→ 磁盘再动（**失败要回滚标签**，
否则标签指着不存在的路径，下一次自动保存把文件写回来）→ 树再动（它的重列必须看见已经
移动过的磁盘）→ 最后重写引用（被改名那篇文档要从**新**目录读，那是它自己链接的解析基准）。

**UI 半边**：双击行进改名态（单击在树里已经有主了：打开 / 折叠），失焦等同 Esc。
判定名字用**重新列一遍文件夹**而不是树里的缓存 —— 缓存里没有刚建的文件，拿它判就是
把已占用的名字交给文件系统，而 POSIX 的 `rename(2)` 会**直接覆盖**。
`checkRename` 是纯函数（`core/src/rename.ts`），所以大小写不敏感这条只在它身上测一次：
`a.md` → `A.md` 按**路径**排除自己，不能判成撞名。

**扫描收窄成只读 Markdown**（ADR-0003 §2.9 记了这条修正）：别的文件里的相对路径在这个
编辑器里根本不会显示成链接。跳过的是**读取**不是**遍历**，目录照常往下走。

**没有新语法 → 没有 golden 语料**（§2 约束 2 的分界）：这一片不碰序列化器，往返语料不动。

### 3.8 v1.0 第 7 片：多光标（ADR-0004）

设计全在 `docs/adr/0004-multi-cursor-scope.md`，这里只记**落地与踩到的**。

**这一片的形状和之前六片都不一样：它大半是在修一个「以为已经有的东西」。** HANDOFF §4 原先写着
「源码模式多光标由 CodeMirror 自带」，而它其实要显式打开一个 facet —— 于是三个手势全都接好了、
又全都不能用，而整整一个项目周期没人测过它们（因为「自带」的东西不需要测）。

**红测试在哪、为什么只有四条。** `packages/core/tests/multi-cursor.test.ts`。四个手势里两个是鼠标
手势，jsdom 没有布局也没有 `caretPositionFromPoint`，驱动不了坐标。所以驱动的是**它们留下的东西**
（一个带多个范围的 transaction）与**应用给的答案**（`clickAddsSelectionRange` 那一个函数读回来调）：

| 手势           | 怎么测                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Alt 拖拽       | 直接派发它落下时那个「一行一个 range」的 transaction                        |
| Alt 点击       | 读回 facet，问 `{altKey:true}` / `{altKey:false}` / `{ctrlKey:true}`        |
| `Mod-d`        | 在 `contentDOM` 上**真派发 keydown**，走 `codemirror.ts` 注册的键位         |
| 打字落在每一处 | `handle.insertImage(...)` —— 它是 handle 上唯一走 `replaceSelection` 的调用 |

**jsdom 测不到的三件事（手测清单）**：Alt+点击、Alt 拖拽、以及 `crosshairCursor()` 那个十字提示。
最后一条尤其值得记：**删掉 `crosshairCursor()`，450 条测试一条都不会红** —— 纯视觉的东西在 jsdom 里
就是不可见的，别指望测试兜住它。

**还有一件本机跑不了的事**：三个手势在 Mac 上读的是同一个修饰键（Alt = Option），三个组件的默认值
都**不随平台变**，所以逻辑上一致 —— 但**没有真机跑过**。哪天有 Mac 就先试这三个手势。

**测试里第一次出现引擎符号**（`EditorSelection` / `EditorView`），之前 core 的测试一条都没有直接
import 过 `@codemirror/*`。理由是 `MarkdownEditorHandle` 故意比两个引擎都窄（ADR-0001 §2.3），
要读回选区，剩下的路只有 `EditorView.findFromDOM(host)`。**给 handle 加一个方法好让测试能看进去**
是另一条路，代价是把同一个口子开给所有调用方。约束管的是 `src/editor/`，测试文件不在其中。

**没有新文案。** 这两个手势**故意不进**快捷键设置面板：`HotkeyActionId` 是应用级动作的表，写进去
就等于要求 WYSIWYG 也认这个绑定，而 WYSIWYG 没有这个能力 —— 半个矩阵会撒谎的设置项比没有更糟。
所以双 locale 约束（§2 约束 4）在这一片不适用。

**顺带活过来的两个命令**：`defaultKeymap` 里的 `Mod-Alt-↑` / `Mod-Alt-↓`（`addCursorAbove/Below`）
在同一个 facet 之下，之前按下去同样没反应。

### 3.9 M6 的规划（`/grill-with-docs` → ADR-0005）

**没有代码**，只有决定。十一问全记在 `docs/adr/0005-export-and-experience.md`，这里只记**规划期间探到
的、会改变做法的事实**（这些是本次现场核实的，不是回忆）：

- **i18n 早就做完了**（M4 的 `zh-CN` / `en-US` + key 同构守卫），M6 那一项名存实亡 —— 已从交付物里划掉。
- **拼写检查只剩一个开关**：`setSpellcheck` 从 handle 一路通到两个引擎的 `contentDOM.spellcheck`，
  **一个调用方都没有**。
- **E2E 从未执行过**：ADR §4 给每个里程碑尾巴都挂着它，而仓里没有 `*.spec.ts`、没有 playwright，
  M1–M5 照样全标 ✅。已从门槛里移出（见 §5.1）。
- **core 的 barrel 够不到 remark 链**：`editor/index.ts` 故意只导出一个工厂 + 一个契约，所以
  `packages/export` 拿不到 `parse` / `parseTransformed` / toc 节点 / 三个渲染器 —— 而它们没有一个是
  引擎形状的。**切片 ② 已开 `@newmd/core/document` 这道窄门**（§3.12）。
- **仓里没有任何正文排版样式**：`--editor-font-size` / `--editor-line-height` / `--font-editor` /
  `--editor-max-width` 四个设置项**只有 CodeMirror 在用**（`codemirror.ts:66-77`），WYSIWYG 一个都没接。
  「屏幕上什么样导出就什么样」此前**无内容可依**。**切片 ① 已补上（§3.11）。**
- **ADR §2.7 里 DOCX 那一行的输入与另外三行不同**（说的是 ProseMirror 节点映射，而 ProseMirror doc 只
  在活着的 WYSIWYG 里存在）—— 已统一成 mdast。
- **实测数字**：KaTeX 字体目录 1.2MB 里三份格式重复，**woff2 子集只有 20 个文件 296KB**；
  `highlight()` 已经往每个 token 写内联 `color`，所以导出物为代码块**不需要带任何 CSS**，只差
  `highlight.css` 那一行。
- **`docx` 与任何 zip 库都不在依赖树里**，M6 要新增两个依赖。

### 3.10 可复用手法（下一片多半还要用）

- **双引擎共用一个行为** → 在 `options.parent` 上挂 capture 监听（§3.2）。测试时注意：
  **`dragover` 要派发在 host 上**（ProseMirror 的 `editHandlers.dragover` 无条件 `preventDefault`，
  派发在 editable 上会「假绿」），**`drop` 派发在 editable 上**（这才证明监听能听到冒泡上来的事件）。
- **外部命令要碰到 EditorPane 私有的 surface** → 走 `useUi` 的 `{ ..., seq }` 请求 + EditorPane 里
  一个订阅 `useEffect`（`reveal`、`imageInsert` 都是这个路子）。
- **平台能力扩三端 + 7 个 fake**（§2 约束 6）。
- **给一个节点挂 NodeView** → Milkdown 的 `$view`（`@milkdown/utils`）注册在 `.use(...)` 里，
  然后 `.use(那个 view)`。三个坑，全部实测过：
  1. **节点 spec 上写 `view:` 是死代码** —— ProseMirror 只认 editor view 的 `nodeViews` prop
     （`NodeViewDesc.create` 里读的是 `view.nodeViews[node.type.name]`）。写得再对也不会被调用，
     而且不报错、不类型报错。
  2. **必须传 `$nodeSchema(...).node`，不能传 `$nodeSchema(...)` 本身**。后者返回的是
     `[schemaCtx, $Node]` 数组，`.id` 是**构造时就拷过来的**，而 `$Node` 要等自己的 plugin 跑完
     才知道 id —— 于是 `$view` 把 node view 登记在 `undefined` 这个 key 下，
     `nodeViews["yaml"]` 永远查不到。**症状极具迷惑性：不报错，节点照常渲染，只是走的 `toDOM`。**
  3. 想确认 node view 到底有没有生效，别信 `contenteditable` 之类的探针：**jsdom 的
     `contentEditable` setter 不写回 attribute**（`el.contentEditable="true"` 之后
     `getAttribute("contenteditable")` 仍是 `null`，实测）。用 `setAttribute` 写、用
     `getAttribute` 读，或者在 node view 工厂里临时打一行 log。
  4. **有 `contentDOM` 就必须自己写 `ignoreMutation`**，默认 `false` = 「contentDOM 之外的
     任何变更都算整个节点变了」，于是文档里别处敲一个键，这个块就被整个重建（§3.6 实测）。
     症状隐蔽：不报错，只是块的元素每敲一下换一个；**要断言元素同一性才看得见**。

  `stopEvent` / `ignoreMutation` / `update` 的取舍见 §3.4 的表格；`update` 返回 `true`
  并且不动 DOM，是「编辑期间光标不被抢走」的关键。

- **「这个节点现在长什么样」取决于光标在哪** → 用插件 `props.decorations` 打一个属性，
  不要用 NodeView 自己的状态。`props.decorations` **每次状态变化都重算（含纯选区事务）**，
  而 NodeView 的 `update` **只在这个节点自己变时**才被调用 —— 光标移进移出根本轮不到它。
  用 decoration 的副产品：状态在 jsdom 里可直接断言（属性在不在），不必依赖布局（§3.6）。

- **异步结果画进 ProseMirror** → 插件 `state` 存 `DecorationSet`，`props.decorations` 读它；
  文档变了先 `previous.map(tr.mapping, tr.doc)`（陈旧但不动光标），结果回来再
  `view.dispatch(tr.setMeta(key, true).setMeta("addToHistory", false))`，`apply` 见 meta 才重建。
  两个坑：**meta 事务不改 doc，所以 `changeWatcher` 不会误报编辑**（它比对 `view.state.doc`），
  但也**别忘 `addToHistory: false`**；`view.update` 里要用 `updated.state.doc !== previous.doc`
  挡掉纯选择变化，否则每次移动光标都全文档走一遍。
- **给「异步之后的 DOM」写测试**：`vi.waitFor` 等正向信号；断言「没有东西」时要找一个
  确定性的时钟（这里是**同一文档里另一个能高亮的围栏** —— 全回来才重绘，所以它上色就代表另一个也问完了）。
  另外 **ProseMirror 不监听 `input` 事件**，它靠 MutationObserver；`wysiwyg-input.test.ts` 的
  `await new Promise(r => setTimeout(r, 0))` 不是凑数，是等 flush，照抄。
  **`import.meta.url` 在 jsdom 环境下不是 `file:` URL**，测试里 `readFile` 要用包根相对路径。
- **只存在于 CSS 级联里的半边**（`var()`）：jsdom 不解析自定义属性，写不出行为测试。
  退而求其次断言**文件内容**（规则存在），并在注释里讲清为什么只能做到这一步 ——
  比假装它被覆盖了强。
- **要给一个模块立规矩（「这里不许 import X」）** → 别比对依赖清单，**走 import 图**：从入口出发，
  正则抓说明符（`/(?:from|import)\s*\(?\s*["']([^"']+)["']/g` 能同时捞到静态与动态两种），相对的
  按文件解析、BFS，裸的只收集不解析。清单会漏掉刚加的那一行，import 图不会
  （`packages/core/tests/document-subpath.test.ts`，§3.12）。
- **「没有发生的事」也要断言**：假适配器把每次调用记进数组，然后断言它**是空的**（比如远程图片
  「没有被去取」、未知扩展名「没有被打开」）。这类断言钉的是意图，比断言结果更难得 ——
  结果对了但顺手多读一次文件，只有它看得见（§3.12）。

### 3.11 M6 第 ① 片：正文样式表 `core/src/document.css`（`475c42f`）

**做什么**：新建 `packages/core/src/document.css`，一份**只管文档、不管窗口**的样式表。它挂在一个属性
上 —— **`[data-newmd-document]`** —— WYSIWYG 引擎把它设在自己的可编辑元素上（不是外壳给的宿主）。
里面两半：

1. **新写的正文排版**：`--editor-font-size` / `--editor-line-height` / `--font-editor` /
   `--editor-max-width` 四个设置项终于接到 WYSIWYG 上，加上 h1–h6 / p / ul / ol / li / 引用 / 表格 /
   分割线 / 行内代码 / 围栏块 / 链接 / 图片的规则。字号与缩进一律用 `em`，所以调大字体是整个页面一起
   变大，不是只有段落。
2. **从 `ui/src/styles.css` 搬过来的那一半**：front matter / mermaid / `[TOC]` 三个块的**阅读向**
   规则，原件已删。`ui/src/styles.css` 用 `@import "../../core/src/document.css"` 取回给编辑器用。

**三条要记住的形状**：

- **这一份里不出现 `height: 100%` / `overflow` / `vh`。** 它要给两种东西用：一块视口（编辑器）和
  一页纸（导出的 HTML），而这两者对高度与滚动的答案正好相反。滚动归外壳。
- **导出侧包正文的那个元素必须带 `[data-newmd-document]`**，否则内联进去的规则一条都不生效。
- **它自带 reset**（`box-sizing: border-box` 那一组）：导出物里没有 Tailwind preflight，它不能依赖
  任何别的东西。

**顺带撞出来的一个 bug（不是计划内的）**：WYSIWYG **根本没有滚动容器**。`body` 是 `overflow: hidden`、
外壳也是，CodeMirror 自带 `.cm-scroller`、Milkdown 一个都不带 —— 比窗口高的文档在 WYSIWYG 下够不到
后半段（源码模式没事）。修法是把滚动放在外壳：`EditorPane` 的宿主 div 加 `overflow-y-auto`。
**没在真浏览器里量过**，进手测清单。

**记下来但没做**：GFM 任务列表在 WYSIWYG 里**没有勾选框**（preset 只有 `checked` 属性、没有 view）。
CSS 能画一个，但那会是一个点不动的框，与 ADR-0004 §2.5 同一条理由没画。见 ADR-0005 §3 与 §5 第 6 条。

**测试**：core `tests/document-styles.test.ts`（7 条）+ ui `tests/document-styles.test.ts`（2 条）。
jsdom 不跑层叠，所以这一片的可测部分是这样切的：

- **能行为断言的是「规则圈住了该圈的 DOM」** —— 挂一个含全部块类型的文档，断言 `[data-newmd-document]`
  就是那个 `contenteditable`，且它底下真能找到 h1–h6 / table / img / 三个搬过来的块。这一条比文件断言
  值钱：作用域挂错位置时，屏幕上是一条规则都不生效、而且**不报错**。
- **只能断言文件内容的是「规则存在」** —— 照抄 `highlight.test.ts` / `toc-block.test.ts` 的先例。
- ui 那两条钉的是「谁拥有这些规则」：`@import` 在不在（掉了编辑器就没样式，且没有测试会红）、
  搬走的四组选择器有没有留在 ui（留着就会两边慢慢分叉，而 ui 那份是编辑器看得见的）。

**验过 `@import` 真能穿过去**：Tailwind v4 + Vite 处理 CSS `@import` 是这一片唯一的机械风险（core 的
CSS 文件在另一个包里）。`pnpm build` 之后在 `apps/desktop/dist/assets/index-*.css` 里数到 54 处
`data-newmd-document`，搬过来的三块也都在 —— 不是推断，是数出来的。

### 3.12 M6 第 ② 片：`packages/export` + `@newmd/core/document` + MD→HTML 序列化器（`08cbcb4` `240fd92` `cfbd7f6`）

**做什么**：新包 `packages/export`，把一串 Markdown 变成**一个自包含的 HTML 文件**。三小片：

- **②.1**（`08cbcb4`）—— 包起壳、core 开 `@newmd/core/document` 这道窄门、`renderDocumentHtml` 写出
  正文结构（标题带位置 id、`[TOC]` 展开、表格对齐、脚注、front matter 面板、Shiki 上色的围栏块），
  四份 CSS 内联成 `<style>`，**调色板从 ui 搬进 `core/src/theme.css`**（导出不能依赖 `packages/ui` ——
  为了一个十六进制色去 import 一个 React 组件包，就是把导出变回「应用的一次构建」）。
- **②.2**（`240fd92`）—— 两个要带资源的渲染器跑起来。KaTeX：`?raw` 读样式表（`?inline` 会被 Vite 把
  `url()` 改写成构建产物引用，而读这份页面的机器上没有那个构建），20 个 woff2 用**显式 import** 收
  （`import.meta.glob` 进不去 `node_modules`，实测 0 条），`core/src/document/katex-assets.ts` 把
  60 处 `url(fonts/…)` 换成 data URI。Mermaid：从 `editor/mermaid.ts` 抽出 `renderMermaid(source, dark)`，
  **编辑器与导出共用**，导出侧写编辑器写的同一个 `data-rendered`。
- **②.3**（`cfbd7f6`）—— 图片读字节写进页面（`src/images.ts`），新增 `docPath` 选项与四种失败理由。

**六条要记住的形状**：

1. **`packages/export` 的依赖恰好两个**：`@newmd/core` 的公共 barrel 与 `@newmd/core/document`。
   三个渲染器全走这道门，导出侧一个都不自己 import。**这道门有一条守卫测试**：
   `packages/core/tests/document-subpath.test.ts` 走 **import 图**（相对说明符 BFS，连动态 `import()`
   也跟），因为门被拆掉的方式就是一次次「顺手再 re-export 一个东西」。
2. **两处挂点缺一不可**：`data-theme` 在 `<html>` 上（`theme.css` / `highlight.css` 读它），正文元素带
   `[data-newmd-document]`（§3.11 那个属性）。少任何一个，内联进去的规则**一条都不生效且不报错** ——
   这是「导出物没样式」最可能的两种死法。
3. **`page.css` 是导出独有的一段**（纸张、页边、打印规则），所以它留在 `packages/export` 而不是 core；
   内联顺序是 `themeCss / pageCss / documentCss / highlightCss / lookCss`，公式出现过才追加 KaTeX。
4. **公式按需有两个方向**：导出物不白带 395KB，应用入口分块也不白背它 —— `katexStylesheet()` 走
   `import()` 而不是 re-export。
5. **两份东西故意不画**：`definition`（链接定义是绑定不是内容）与**裸 `html`**（让文档把标记写进一个
   别人从桌面打开的文件里，是转义问题反过来）。**这不是「所见即所得」的破例**：这份一致性指的是文档
   **语义**由同一套渲染器画出来，不是编辑器里每个装饰都得跟着走。已记进 ADR-0005 §3。
6. **图片四种理由 + `docPath`**：`remote`（URL 一律**不去取**）、`unresolved`（没保存过的文档没有目录
   可相对）、`unreadable`（路径解析出来了、读失败）、`unknown-type`（data URI 必须带媒体类型，而
   `application/octet-stream` 是个什么都画不出来的标签，所以类型在开文件**之前**由扩展名定下）。四种
   都**保留作者原来的路径**并进 `report.images`，不猜也不留白（ADR-0003 §2.7 同一条原则）。`docPath`
   形状照抄 `ImageTarget`；字节走平台适配器 `readBinaryFile`，导出包不碰文件系统、不 import Tauri。

**这一片新撞出来的形状**：**`packages/export` 不能解析 `mermaid` / `katex`**（pnpm 严格 node_modules）——
这不是障碍，正是 §2.4 那条「依赖只有两个」在类型检查阶段就替你执行的证据。探针因此挪回
`packages/core` 里跑。

**测试**：export `tests/html.test.ts`（26 条，全在一个文件里）。jsdom 够不到的地方是这样切的：

- **能行为断言的是结构**：位置 id、`[TOC]` 的 `href` 与缩进变量、表格对齐、脚注、front matter 面板、
  Shiki token 的颜色、图片 base64 **解码后逐字节比对**。
- **只能断言文件内容的是样式**：stylesheets 被内联、`[data-newmd-document]` 在正文上、KaTeX 的
  `.katex-mathml` 那条 `clip-path:inset(50%)` 在（KaTeX 每个公式发两遍，少了它公式印两遍）。
- **只能钉失败那一支的是 Mermaid**：jsdom 里 Mermaid 起不来（要 `getBBox`，jsdom 没有布局），所以自动化
  只能断言「画不出来就保留源码并标错」，画成功进手测清单。
- **「不去做」也要断言**：远程图片与未知扩展名的用例断言 `asked`（假平台记下的读取请求）为空 ——
  这条比断言结果更有价值，它钉的是「没有发生的事」。

**记下来但没做**：跨文档相对链接在导出物里仍是相对路径（ADR-0005 §5 第 4 条）；任务列表勾选框仍是
§3.11 那个缺口。

### 3.13 M6 第 ③ 片：HTML 导出的通路（`b3b3c7f`）

**做什么**：让 ② 写好的 `renderDocumentHtml` 变成读者按得到的东西 —— `handleExportHtml`、
工具栏一个新下拉、`Mod+Shift+E`、保存对话框、写盘。

**五条要记住的形状**：

1. **编排住 `packages/ui/src/actions.ts`，于是多了一条依赖边：ui → `@newmd/export`**（ui 的第一个）。
   这一条决定了另外两条路都走不通：编排不能住 `packages/export`（那要够到几个 store，而 core 不能依赖
   export），也不该在组件里现写（`actions.ts` 开头那句「每个用户命令都从这里走」就是为了不让忙闲光标、
   失败提示、脏状态守卫各写一遍）。
2. **动作里的顺序就是读者经历的顺序**：读文档 → 问路径 → 生成 → 写盘。**读在对话框之前**，与
   `persistDoc` 取正文同一个理由：原生对话框弹着的时候切了标签页或改了几个字，不该改到已经在路上的
   那一份。
3. **默认名换扩展名不换主名**：`/notes/todo.md` 提议 `todo.html`。用 `platform.pathExtension` 切，
   不自己找最后一个点（路径逻辑一律走适配器）。
4. **图片没带全 = `info` 而不是 `success`，并把张数说出来**。两种情况下文件都写成了，所以一句「已导出」
   会让读者没法知道手里的不是全文。张数走 `{{count}}` 参数，不拼进句子（两种语言的语序不一样）。
5. **`Mod+Shift+E`，且 `firesInEditable: true`**：没有人带着这个键来，选的是「记得住」不是「眼熟」——
   E 是 export，Shift 是因为光秃秃的 `Mod+E` 归平台已有用途。`firesInEditable` 与保存同理：读者在正文
   里打字时想导出，不该先点开外面。**下拉今天只有一行**（HTML），这是对的：§2.14 定了下拉，而四个后端
   里三个还没落地，**一行点了没反应的菜单比一行菜单更糟**（ADR-0004 §2.5 同一条理由）。④⑤⑥ 落地时是
   往 `formats` 数组里加行，不是改组件。

**顺带修好一个真缺陷（不是计划内的）**：`pick_file` / `pick_save_path` 在 Rust 侧给**每个**筛选器都
写死 `"Markdown"`，而 `tauri.ts` 把 `FileFilter.name` 扔掉了 —— 也就是说那是应用用 `t(...)` 要来的、
读者会看见的文案，却没有人读它。表现：插图时对话框说「打开 Markdown 文件」，导出时说「保存 Markdown
文件」。修法是两头都接上（`filter_name` 参数 + `add_filter`；没有筛选器的调用方拿的兜底词也走 `t`）。
**这一类自动化一条都测不到**（假适配器只看得见「应用交给了平台什么」），所以进手测清单 —— 写进
ADR-0005 §3。

**`/// <reference path="./css.d.ts" />`（core 与 export 的 `src/index.ts` 各一行）**：工作区包发的是
TypeScript，消费者在自己的 program 里连它一起类型检查，于是 `page.css?inline` 要在 ui 的 program 里
能解析。**环境声明不会自己跟着 `import` 走** —— 这一行才是让形状随包旅行的那一步，它省掉了 ui 手抄
第三份 `css.d.ts`。（另一种解法是在 ui 的 tsconfig 里 include 到 export 的源码，那是把包的边界写进
构建配置，更差。）

**测试**：ui `tests/export-html.test.tsx`（8 条，新文件）。这一片的可测部分这样切：

- **能行为断言的是「应用交给平台什么、写下去什么」**：假平台记下 `asked`（默认名 `todo.html`、扩展名
  `html`/`htm`）与 `written`（路径 + 内容）。断言内容时把页面 `DOMParser` 回来，断 `data-theme`、
  `[data-newmd-document]`、正文文字、`<style>` 里真有那组规则。
- **「没有发生的事」也要断言**：取消对话框 → 一个字节都不写、**一条 toast 都没有**；写盘失败 → 报错而
  不是报成功。
- **两条入口各一条用例**：`Ctrl+Shift+E`（挂 `useHotkeys()`）与工具栏下拉点两下
  （`getByRole("button", {name: t("titleBar.export")})` → `findByRole("menuitem", …)`）。
- **`packages/ui/vitest.config.ts` 打开了 `css: true`**：它的桩件对样式导入回**空串**，而导出物九成是
  样式表 —— 不开的话「把页面读回来断言样式」那条测试什么都没证（这一片第一次跑就是这么红的）。

**记下来但没做**：其他三个后端（PDF / Markdown+zip / DOCX）与下拉里对应的三行；导出通路里的 E2E。

---

## 4. v1.0 功能缺口：7 项全部收口（**本轮范围已走完**）

> 每一片都走 `/tdd`：先失败测试，再最小实现，再重构。

前六片：拖拽（§3.2）、本地路径插入（§3.3）、front matter 编辑（§3.4）、Shiki 高亮（§3.5）、
`[TOC]` 目录（§3.6）、重命名引用重写（§3.7）。

**第七项（多光标）是收窄，不是实现**：源码模式做了，WYSIWYG 明确不做 —— 决定与理由全在
`docs/adr/0004-multi-cursor-scope.md`，落地记录见 §3.8。所以这一栏从「6/6 中 5 项」变成
**「7 项 6 实现 + 1 收窄」**，而**下一件该做的事是 M6**（§6），不是补 WYSIWYG 多光标。

**收口时新冒出来的一条孤儿**（原先被这一项挡着，现在没人认领）：`sameTab` 按 `(path, fileName)`
认标签，所以一次重命名会**清掉那个标签的撤销历史**（ADR-0003 §2.8）。原先写的是「等多光标那一片
做完、标签有了稳定身份再修」，而多光标已经决为不做 —— 于是它变成一件**独立**的事，跟多光标无关。
要修就是给标签一个稳定身份（例如一个不随路径变的 id），**别顺手修**：它会碰到 `EditorPane` 的
文档切换判定，属于该单开一片的活儿。

原先留在这里的 ② 里有一条**已经证明是错的**，留着当教训：

- ~~「源码模式多光标由 CodeMirror 自带（ADR 行 158 明确选型理由就是它）」~~ —— **错**。
  CodeMirror 要显式打开 `EditorState.allowMultipleSelections`，没有任何 `@codemirror/*` 包替调用方
  打开，本仓也从没打开过。ADR-0001 行 158 说的是**选型理由**（它确实比自研强），不是「装了就生效」。
- 另一条只是**行号错了**：`wysiwyg.ts` 的 `.use(...)` 列表在 **1439–1471 行**，不是 1063–1085
  （那个文件一共 1548 行）。WYSIWYG 侧确实没有任何多光标配置，这部分结论仍然成立。

<details>
<summary>② 原文留档（已结案，别再照着做）</summary>

- 现状（当时核实）：WYSIWYG 侧 `wysiwyg.ts` 的 `.use(...)` 列表**没有任何多光标配置，也没有测试**。
  在 `prosemirror-state@1.4.4` / `prosemirror-view` 的 `dist` 里也搜不到
  `rectangularSelection` / `crosshairCursor` 这类现成导出 —— 可能在别处、要自己写 plugin，
  或者 Milkdown 根本没开。
- **第一步**：查清「ProseMirror 这边能不能开、Milkdown 挡没挡」，**然后再写失败测试**；
  不要在没有红测试的情况下直接改 `.use(...)` 列表。

</details>

---

## 5. 用户本轮**没有选**的三类待办（明确留着，别顺手做掉）

### 5.1 质量门槛：E2E / Playwright 基建（ADR §2.10 行 171）

- 仓库里**没有任何 `*.spec.ts`、没有 playwright 依赖**。
- ADR 要求覆盖：打开/保存/自动保存、WYSIWYG↔源码切换、图片粘贴落盘、查找替换、三种导出；
  Tauri 侧用 `tauri-driver` / WebDriver，或先在浏览器模式跑核心用例。
- **2026-10-16 起，这条从里程碑门槛里正式移出**：ADR-0001 §4 那句「每个里程碑结束时必须：跑完 golden +
  **E2E** + 中文输入法手测」已删掉 E2E 三个字（[ADR-0005](docs/adr/0005-export-and-experience.md) §2.2）。
  理由是它**从来没有被执行过** —— M1–M5 一次都没跑，五个里程碑照样全标了 ✅，而一条从不被执行的
  要求只会训练读者忽略要求。**M1–M5 的 ✅ 也都不含 E2E。**
- 于是它和 §5.2 / §5.3 一样，是一件**独立、没人认领**的工作，而不是某一片的尾巴。

### 5.2 小修清账（**逐条本轮核实过**）

| 项                          | 核实结果                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find.openHint` 死 key      | ✅ 成立：`zh-CN.json:68` / `en-US.json:68` 有，**源码无一处引用**。守卫只查 `t(` 能解析，不查反向                                                                |
| `RECOVERY_KEY` 只写不读     | ✅ 成立：`core/src/autosave.ts:15` 声明、`:99` 写入，**全仓无读取** —— 崩溃恢复没接上                                                                            |
| 找替换缺「N/M」计数         | ✅ 成立：`FindReplace.tsx` 只有 `find.noMatches`，没有当前第几个 / 共几个                                                                                        |
| `pnpm build` chunk 体积警告 | ✅ 成立且**变大**：`index` 1.63 MB、`elk` 1.47 MB、`cynefin` 688 KB、`mermaid.core` 669 KB；Shiki 之后产物 371 个 chunk / 16.2 MB（见 §3.5，用户已拍板保持全量） |
| 状态栏 WYSIWYG 光标不更新   | ❌ **不成立，别去修**：`wysiwyg.ts` 的 `changeWatcher` 已在 selection 变化时回调 `onCursorChange`，`EditorPane` 也接了 `setCursor`，两条引擎路径都通             |

**这张表之外还有一条，③ 号切片撞上时顺手修了**（记在这里是免得下一个人再发现一遍）：原生对话框的
筛选名。Rust 侧 `pick_file` / `pick_save_path` 给每个筛选器都写死 `"Markdown"`，`tauri.ts` 又把
`FileFilter.name` 扔掉，于是插图时说「打开 Markdown 文件」。名字现在两头都传（§3.13），但**它只有在
真窗口里才看得见**，所以同时也进了 ADR-0005 §3 的手测清单。

### 5.3 文档与合规

- 仓库**没有 `LICENSE`**（public 仓库却没许可，发布前必须补）。
- README 没有截图 / 动图。
- ADR §4 里程碑表还停在 M4/M5 未完成的状态，要同步（M5 已完成）。
- ADR §2.3 里关于插件的描述与实现**有出入**（更早的会话已发现）：**改 ADR，不要照着 ADR 改代码**。

---

## 6. M6「导出与体验」（**ADR-0005 已定案；①②③ 已合入，④ 起一行没写**）

> 设计全文：`docs/adr/0005-export-and-experience.md`。**动手前读它，别读这一节。**
> 交付物 = HTML / PDF / DOCX / Markdown 四种导出、专注模式、打字机模式、拼写检查**开关**、打包安装
> （**i18n 删掉了** —— M4 就已完成）
> 验收 = 中文 PDF 分页正确；DOCX 在 Word 中可打开且结构正确

**切片的次序**（ADR-0005 §2.15）：

| #   | 切片                                                                        | 为什么在这个位置                                            |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| ①   | ✅ 正文样式表（`core/src/document.css` + ui 接上 + 搬 front matter 那几段） | 同时是 HTML 导出的输入与专注模式的前提（§3.11）             |
| ②   | ✅ `packages/export` 起壳 + `@newmd/core/document` + MD→HTML 序列化器       | 定形状：渲染器怎么复用、CSS 怎么内联、图片怎么内联（§3.12） |
| ③   | ✅ HTML 导出的通路（工具栏「导出」下拉 + 保存对话框 + 写盘）                | 让 ② 变成读者能按到的东西，也是 ④ 的基座（§3.13）           |
| ④   | PDF（隐藏 iframe + 系统打印）                                               | 撞 ADR-0001 §5 唯一那条「中」风险，也是两条验收之一         |
| ⑤   | Markdown + zip                                                              | 独立于 HTML 序列化器，最便宜的一条后端                      |
| ⑥   | DOCX                                                                        | 最大的一块，已知取舍                                        |
| ⑦   | 专注模式 / 打字机模式                                                       | 与导出无关，唯一可以自由挪的两片                            |
| ⑧   | 拼写检查开关                                                                | 一片，接上现成的通路（`setSpellcheck` 今天零调用方）        |
| ⑨   | 打包安装                                                                    | 收口（`pnpm tauri build` 从来没跑过）                       |

**形状一句话**：四条后端**共用一棵 mdast** —— 输入统一是 `getContent()` 那串 Markdown，导出侧自己
parse（复用 core 已定的 remark 链）。HTML 是自包含单文件（CSS 内联、图片 base64、公式按需带 KaTeX
woff2 字体）；PDF 就是把那份 HTML 塞进隐藏 iframe 打印；DOCX 里图走 PNG、公式降级为 LaTeX 源码；
Markdown 是原文 + 图片打 zip。

**必须记住的四件事**：

1. **`packages/export` 已经在了**（② 号切片），HTML 后端就是 `renderDocumentHtml(markdown, options)`，
   而 ③ 号切片已经把它接到了工具栏与保存对话框上（`handleExportHtml`，§3.13）—— **④ 号切片就照着
   这条现成的通路走**：一个新 `hotkeys.ts` 条目 + `formats` 数组里一行，编排仍住 `actions.ts`，
   导出下拉不要再写第二个组件。`docx` 与任何 zip 库仍不在依赖树里（两个新依赖）。图片写盘的通路走
   平台适配器（`writeBinaryFile`），别在 UI 里直接碰 Tauri 插件。
2. **core 的 barrel 故意够不到 remark 链** —— 已经开了 `@newmd/core/document`，守卫测试是
   `packages/core/tests/document-subpath.test.ts`（走 import 图）。往里加东西前先读它，加完在
   `EXPECTED_FILES` 里登记。
3. **导出 HTML 复用的是 §3.5 那套 Shiki**：`highlight(code, lang)` 返回的 `{ offset, text, style }[]` 与
   编辑器形状无关，直接可用。**别**在导出侧重新 `import("shiki")` 一套自己的 tokenizer（两边迟早分叉）。
   代码块**不需要带 CSS**（颜色已经写在每个 token 的行内 style 上），只差 `highlight.css` 那一行。
4. **主题跟随当前、写死一份**；`[TOC]` 展开成 `<a href="#newmd-h-N">`，标题一律发位置 id。

ADR-0001 的 §2.7、§4、§6 未决问题 3/4 与 ADR-0002 的 §2.8、§3、§5 都已经跟着改过一遍了，
**别按旧版本的理解去做**。

---

## 7. 环境与命令（Windows 本机，踩过的坑）

```bash
pnpm test                                   # 全仓测试（core + ui + export）
pnpm typecheck                              # 四处 tsc --noEmit
# prettier：packages 与 docs 两处都要查（docs 里的表格 prettier 会重排）
node node_modules/prettier/bin/prettier.cjs --check "packages/**/*.{ts,tsx,md,css}" "docs/**/*.md"

# 单跑一个包 / 一个文件（包内 vitest，别用 npx）
# ⚠️ 必须**先 cd 进包**，不能从仓库根加 --root：highlight.test.ts 与 toc-block.test.ts
#    按 cwd 读 CSS，cwd 在包外时这两条会挂。
cd packages/core   && node node_modules/vitest/vitest.mjs run tests/local-image.test.ts
cd packages/ui     && node node_modules/vitest/vitest.mjs run tests/insert-image.test.tsx
cd packages/export && node node_modules/vitest/vitest.mjs run tests/html.test.ts

cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm build                                  # vite 产物体检
```

- ⚠️ **`npx` / `npm` 的 shim 在这台机器上是坏的** —— 所有工具都用上面这种绝对路径调用。
- vitest 是**包内**依赖；prettier / tsc 在**根** `node_modules`。
- **Bash heredoc 会二次反转义反斜杠** → 含转义的内容用文件工具写，别塞进 `python <<'PY'`。
- 文件写入工具会把内容里的反斜杠转义序列写成真实控制字符 → **内容里别放这种序列**，
  写完确认一下文件没混进 NUL。
- `git commit` 传多行信息用 `-F 文件`（PowerShell 的 here-string 语法在 Bash 里会炸）。

---

## 8. 已知坑（照抄会踩）

- **jsdom 缺 API**：`document.elementFromPoint`、`Range.prototype.getClientRects`、
  `ClipboardEvent` 构造函数。前两个已在 `packages/core/tests/setup.ts` 里打了桩
  （`vitest.config.ts` 的 `setupFiles` 挂着）；剪贴板事件要手搓 `new Event("paste")` +
  `Object.defineProperty(event, "clipboardData", …)`。
  ProseMirror 的 `handleDrop` 会先调 `view.posAtCoords` → `elementFromPoint`，不打桩直接崩。
- **`openPath` 对已打开的路径只聚焦不重读** → 上一个测试用例的编辑会漏到下一个。
  每个用例开头先把 tab 关干净：
  `while (useEditor.getState().tabs.length > 0) useEditor.getState().closeTab(0);`
- **zustand 的 `getState()` 是快照** → 循环里要**每次重取**；拿一个 `const editor = getState()`
  然后 `while (editor.tabs.length)` 会**死循环**（今天真把测试跑挂了）。
- **`lib.rs` 是 CRLF，`fs.rs` 是 LF** → 打补丁时锚点的换行在 `lib.rs` 上匹配不上，
  要先用 `JSON.stringify` 看清那行长什么样再动。
- **Tauri IPC**：`invoke` 会把 `Uint8Array` 序列化成数字数组，Rust 侧直接收 `Vec<u8>`；
  但**返回**方向 `Vec<u8>` 有 `Raw` / `Json` 两种落法，所以要包一层 struct（`BinaryFileDto`）。
- **ProseMirror `someProp` 不合并 `handleDOMEvents`** —— 只带 `paste` / `drop` 的 plugin 永远轮不到，
  因为 Milkdown 的 preset-commonmark 已经占了这个槽。这就是为什么图片入口放在 host 的 capture 监听上。
- **golden 的 `singleTilde: false`**（GFM 关掉单波浪线）—— 别「顺手」打开，往返会红。
- **`tests/highlight.test.ts` 在整仓跑的时候会偶发超时**（实测：`colours the text by the language on
the fence` 报 `expected 0 to be greater than 0`，而单跑这个文件 386ms 就绿）。原因是 Shiki 的语法走
  `import()` 惰性加载，而那句断言在 `vi.waitFor` 里 —— **默认超时 1000ms**，整仓 36 个文件并行时不够。
  它是**预先就有的 flake，不是哪一片引入的**：重跑整仓即绿。要治就是给那一条 `waitFor` 显式加长
  超时（或把 Shiki 的预加载提到 `beforeAll`），别去改高亮实现。
- **ADR 的措辞与仓库的事实会分叉，动手前先核现场**：规划 M6 时一次就核出四处 —— i18n 其实早就
  做完了、拼写检查的通路**零调用方**、E2E 对着五个 ✅ 里程碑**从未跑过**、core 的 barrel 够不到
  remark 链。四处都是「文档说 A、代码是 B」，而**照着文档做会白做功**。核现场的成本是几条
  `grep` / `ls`，收益是整片工作不白做。
- **Vite 的 `?inline` 会把样式表里的 `url()` 改写掉**：拿 `katex/dist/katex.min.css?inline` 得到的是
  `url(/@fs/…)` 或构建产物的资源链接，而读导出页面的机器上没有那个构建 —— 要**原样**的文本就用
  `?raw`。同理 **`import.meta.glob` 进不去 `node_modules`**（实测 0 条），KaTeX 那 20 个字体只能一行行
  显式 import。两条都是「看起来更优雅的写法在这里恰好不成立」。
- **穿过平台边界的那一层最容易把文案丢掉**：`FileFilter.name` 是应用用 `t(...)` 要来的、读者会在原生
  对话框上看见的一句话，而 Rust 侧曾经给每个筛选器都写死 `"Markdown"`、`tauri.ts` 又把名字扔了 ——
  两边谁都没读它，症状是「插图时对话框说打开 Markdown 文件」（切片 ③ 修，ADR-0005 §3）。**平台适配器
  里的每个参数都问一句「谁在读它」**，答案不该是「没人」；而这一类**没有任何自动化看得见**，只有人眼
  能验收。
- **CodeMirror 的多选区是 opt-in，而且是静默的**：`EditorState.allowMultipleSelections` 没开时
  `applyTransaction` 会把 `tr.newSelection` 收敛成一个范围 —— **在造出这个范围的同一个 transaction
  里**。所以症状不是报错，是「手势没反应/只生效一半」（§3.8、ADR-0004 §1）。同类要先查的还有
  `tabSize` / `indentUnit` 这类 state facet：`Facet.define()` 出来的东西一律要有人 `.of()`。

---

## 9. 不要动什么

1. **不要改 golden 语料去迁就实现** —— 语料是规格，实现是实现。要改语料先说清语法为什么变。
2. **不要把引擎调用搬出 `packages/core/src/editor/`**，也不要在 UI 里 import 引擎包。
3. **不要「修」这些有意为之的行为**：
   - 换模式（`setMode`）必然重置撤销栈（引擎被整体换掉，ADR §2.9）；
   - `setContent()` 是文档替换，撤销历史随被替换的文档一起丢；
   - 打开文件 / 新建文档不弹「是否保存」（多标签下没有内容被丢弃）；
   - 状态栏在 WYSIWYG 里报的是**文档文本**的行列，不是源码行列（`changeWatcher` 注释写明了理由）。
4. **不要动 locale JSON 的结构**（两套 key 必须同构、按字母序），也不要在源码里塞裸文案。
5. **不要在这三类未选工作里顺手推进**：E2E/Playwright、§5.2 小修、§5.3 文档合规 ——
   除非用户明确改主意。**§4 的 7 项功能缺口已经全部收口，M6 的 ①②③ 号切片也已合入（§3.11、§3.12、
   §3.13）**，所以下一件该做的是 **M6 的 ④ 号切片：PDF**（隐藏 iframe + 系统打印，零新 Rust 命令；
   §6 的表），不是补 WYSIWYG 多光标（ADR-0004 明确不做），也不是回头去动 §3.8 那三个 Alt 手势。
6. **不要把本机绝对路径写进任何仓库文件**（public 仓库）。
