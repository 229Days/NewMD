# NewMD 交接文档（HANDOFF）

> 给下一个 Claude Code 会话用：读完本文件即可接着干，不必重读整个仓库。
> 更新时间：2026-09-30 ｜ HEAD：`146452b`
> ⚠️ 仓库是 **public** 的 —— 任何文档、注释、提交信息里都不要写本机绝对路径、
> token、密钥、账号。（上一版交接文档里的本机路径已在首次 push 前抹掉，别写回去。）

---

## 1. 项目是什么、现在到哪了

**目标**：仿 Typora 的 Markdown 编辑器（Windows 桌面），真 WYSIWYG + 源码模式切换，
产出的 `.md` 在 GitHub / VS Code / Obsidian 中可读。代号 **NewMD**。

**形态**：Tauri 2 桌面壳 + 纯 Web 核心（React 19 + TS strict + Vite + Zustand + Tailwind 4）。
**架构权威文档**：[docs/adr/0001-typora-like-markdown-editor.md](docs/adr/0001-typora-like-markdown-editor.md)
（ADR-0001，已接受；进度、验收、未决问题都以它为准）。

**进度**（ADR §4 里程碑）：

| 里程碑                                  | 状态                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| M1 壳与文件 IO                          | ✅                                                                                                                      |
| M2 WYSIWYG 核心                         | ✅                                                                                                                      |
| M3 源码模式与多标签                     | ✅                                                                                                                      |
| M4 工作区与外观                         | ✅                                                                                                                      |
| M5 扩展渲染                             | ✅ 七片全部合入（见 §3.1）                                                                                              |
| **v1.0 功能缺口**（用户本轮圈定的范围） | 🟡 **4/6**：拖拽 `d1c1a1d`、本地路径插入 `146452b`、front matter 编辑 `a370e1a`、Shiki 高亮 `8d7d81c`；**剩 3 项见 §4** |
| M6 导出与体验                           | ⬜ 未开始 —— 用户明确要求**排在功能缺口之后**                                                                           |

**验证基线（HEAD = `8d7d81c`，全部实测过）**：

| 检查                       | 结果                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `pnpm test`                | core **341** / 30 文件，ui **24** / 4 文件 全绿                              |
| `pnpm typecheck`           | core / ui / desktop 三处 `tsc --noEmit` 全 0                                 |
| prettier `--check`         | 全绿                                                                         |
| `cargo check`（src-tauri） | 0                                                                            |
| `pnpm build`               | 0（有 chunk 体积警告，见 §5.2；Shiki 让产物从 5.2 MB 涨到 16.2 MB，见 §3.5） |
| golden                     | `packages/core/tests/golden/` **20 个语料**，其中 6 个带 `.expected.md`      |

**每改一行都应复现这一基线**，命令见 §7。

**最近提交**（新到旧）：

```
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
2. **golden 语料是合并硬门槛**（ADR §2.10）：`md → ProseMirror doc → md` 必须字节级一致。
   **任何新的 _语法_**（不是新的渲染方式）都要：往 `packages/core/tests/golden/` 补语料 +
   在 `tests/golden.ts` 的 `EXERCISES` 里登记对应 mdast 节点类型
   （节点类型必须落在 `parse()` ∪ `parseTransformed()` 的并集里，否则守卫会红）。
3. **不得破坏** open / save / autosave / session / recovery 链路与既有测试（当前 341 + 24）。
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
测试只能断言 `highlight.css` 里那条规则存在（见 §3.6 最后一条）。

### 3.6 五条可复用手法（下一片多半还要用）

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

  `stopEvent` / `ignoreMutation` / `update` 的取舍见 §3.4 的表格；`update` 返回 `true`
  并且不动 DOM，是「编辑期间光标不被抢走」的关键。

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

---

## 4. 下一步：剩余 3 个功能缺口（**本轮范围**，用户已勾选「功能缺口」这一类）

> 顺序建议：先问用户定范围的（②）→ 再做有 golden 硬门槛的（③）→ 其余按依赖排。
> 每一片都走 `/tdd`：先失败测试，再最小实现，再重构。
>
> ①Shiki 已完成（`8d7d81c`，见 §3.5），下面从 `[TOC]` 起。

### ① `[TOC]` 目录（ADR 行 78「常用扩展」）

- **现状**：全仓搜不到 `[TOC]`，**一条都没有**。
- **这是新语法 → golden 硬门槛**：补语料 + 登记 `EXERCISES`（§2 约束 2）。
- **先回答这个设计问题再写代码**：TOC 是渲染成一个可跳转的目录节点，还是渲染时展开成链接列表？
  **展开会直接打破 md → PM → md 字节一致**。要展开就得在序列化时再折回 `[TOC]`，
  那是另一套往返契约 —— 想清楚再动手。跳转必须走 `MarkdownSurface` 的方法（ADR §2.3），
  UI 不得摸引擎。

### ② 文件重命名/移动的**引用重写**（ADR 行 146）

- **现状（本轮核实）**：`PlatformAdapter.renamePath` 三端都在
  （browser 明确 `throw PlatformError("Rename is not supported…")`、tauri 有 `rename_path` 命令），
  **但全仓没有一个调用方，也没有任何重命名 UI**（`packages/ui/src` 里搜不到 rename）。
  所以这件事是**两段**：先把重命名暴露出来，再在重命名时重写引用。
- ⚠️ **动手前先问用户**：ADR §6 未决问题 **5** 就是它 —— 「只覆盖图片，还是覆盖所有相对链接
  （含跨文件链接）」。范围不同，工作量差一个量级。
- 参考：`paste-image.ts` 已经把「相对路径写法」的规矩写死了（`./assets/…`，从不写绝对路径），
  重写时按同一套语义反解。

### ③ WYSIWYG 多光标（ADR 行 92、行 158）

- **现状（本轮核实）**：源码模式多光标由 CodeMirror 自带（ADR 行 158 明确选型理由就是它）；
  WYSIWYG 侧 `wysiwyg.ts` 的 `.use(...)` 列表（1063–1085 行）**没有任何多光标配置，也没有测试**。
  在 `prosemirror-state@1.4.4` / `prosemirror-view` 的 `dist` 里也搜不到
  `rectangularSelection` / `crosshairCursor` 这类现成导出 —— 可能在别处、要自己写 plugin，
  或者 Milkdown 根本没开。
- **第一步**：查清「ProseMirror 这边能不能开、Milkdown 挡没挡」，**然后再写失败测试**；
  不要在没有红测试的情况下直接改 `.use(...)` 列表。

---

## 5. 用户本轮**没有选**的三类待办（明确留着，别顺手做掉）

### 5.1 质量门槛：E2E / Playwright 基建（ADR §2.10 行 171、行 230）

- 仓库里**没有任何 `*.spec.ts`、没有 playwright 依赖**。
- ADR 要求覆盖：打开/保存/自动保存、WYSIWYG↔源码切换、图片粘贴落盘、查找替换、三种导出；
  Tauri 侧用 `tauri-driver` / WebDriver，或先在浏览器模式跑核心用例。
- ADR 行 230 说每个里程碑结束时「必须跑完 golden + E2E + 中文输入法手测清单」——
  目前 E2E 这半是空的。

### 5.2 小修清账（**逐条本轮核实过**）

| 项                          | 核实结果                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find.openHint` 死 key      | ✅ 成立：`zh-CN.json:60` / `en-US.json:60` 有，**源码无一处引用**。守卫只查 `t(` 能解析，不查反向                                                                |
| `RECOVERY_KEY` 只写不读     | ✅ 成立：`core/src/autosave.ts:15` 声明、`:99` 写入，**全仓无读取** —— 崩溃恢复没接上                                                                            |
| 找替换缺「N/M」计数         | ✅ 成立：`FindReplace.tsx` 只有 `find.noMatches`，没有当前第几个 / 共几个                                                                                        |
| `pnpm build` chunk 体积警告 | ✅ 成立且**变大**：`index` 1.63 MB、`elk` 1.47 MB、`cynefin` 688 KB、`mermaid.core` 669 KB；Shiki 之后产物 371 个 chunk / 16.2 MB（见 §3.5，用户已拍板保持全量） |
| 状态栏 WYSIWYG 光标不更新   | ❌ **不成立，别去修**：`wysiwyg.ts` 的 `changeWatcher` 已在 selection 变化时回调 `onCursorChange`，`EditorPane` 也接了 `setCursor`，两条引擎路径都通             |

### 5.3 文档与合规

- 仓库**没有 `LICENSE`**（public 仓库却没许可，发布前必须补）。
- README 没有截图 / 动图。
- ADR §4 里程碑表还停在 M4/M5 未完成的状态，要同步（M5 已完成）。
- ADR §2.3 里关于插件的描述与实现**有出入**（更早的会话已发现）：**改 ADR，不要照着 ADR 改代码**。

---

## 6. M6「导出与体验」（ADR §4，用户要求排在功能缺口之后）

> 交付物 = PDF/HTML/DOCX/MD 导出、专注模式、打字机模式、拼写检查、i18n、打包安装
> 验收 = 中文 PDF 分页正确；DOCX 在 Word 中可打开且结构正确

- `packages/export` **不存在**，一行都没有。
- 已知风险（ADR §5）：中文 PDF 分页 / 字体嵌入（中等难度，`@page` + 系统字体栈 + 分页符 / 孤行控制）。
- 未决问题 2（签名与自动更新）、3（Word 复杂场景降级）、4（拼写检查深度）都还没答。
- Shiki 已合入（§3.5），M6 导出 HTML 要复用同一套 —— 给 M6 留的口是：
  `highlight(code, lang)` 返回的 `{ offset, text, style }[]` 与编辑器形状无关，导出侧直接可用；
  但**暗色半边在 `highlight.css` 里**，导出的静态 HTML 必须把那条规则一起带上（或按当前主题烘成单色）。
  导出侧**不要**重新 `import("shiki")` 一套自己的 tokenizer，否则两边迟早会分叉。

---

## 7. 环境与命令（Windows 本机，踩过的坑）

```bash
pnpm test                                   # 全仓测试（core + ui）
pnpm typecheck                              # 三处 tsc --noEmit
node node_modules/prettier/bin/prettier.cjs --check "packages/**/*.{ts,tsx,md,css}"

# 单跑一个包 / 一个文件（包内 vitest，别用 npx）
node packages/core/node_modules/vitest/vitest.mjs run --root packages/core tests/local-image.test.ts
node packages/ui/node_modules/vitest/vitest.mjs run --root packages/ui tests/insert-image.test.tsx

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
   除非用户明确改主意。本轮范围是 §4 的 5 个功能缺口，做完才轮到 M6。
6. **不要把本机绝对路径写进任何仓库文件**（public 仓库）。
