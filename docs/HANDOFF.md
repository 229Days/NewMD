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

| 里程碑                                  | 状态                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| M1 壳与文件 IO                          | ✅                                                                   |
| M2 WYSIWYG 核心                         | ✅                                                                   |
| M3 源码模式与多标签                     | ✅                                                                   |
| M4 工作区与外观                         | ✅                                                                   |
| M5 扩展渲染                             | ✅ 七片全部合入（见 §3.1）                                           |
| **v1.0 功能缺口**（用户本轮圈定的范围） | 🟡 **2/6**：拖拽 `d1c1a1d`、本地路径插入 `146452b`；**剩 5 项见 §4** |
| M6 导出与体验                           | ⬜ 未开始 —— 用户明确要求**排在功能缺口之后**                        |

**验证基线（HEAD = `146452b`，全部实测过）**：

| 检查                       | 结果                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm test`                | core **332** / 29 文件，ui **24** / 4 文件 全绿                         |
| `pnpm typecheck`           | core / ui / desktop 三处 `tsc --noEmit` 全 0                            |
| prettier `--check`         | 全绿                                                                    |
| `cargo check`（src-tauri） | 0                                                                       |
| `pnpm build`               | 0（有 chunk 体积警告，见 §5.2）                                         |
| golden                     | `packages/core/tests/golden/` **20 个语料**，其中 6 个带 `.expected.md` |

**每改一行都应复现这一基线**，命令见 §7。

**最近提交**（新到旧）：

```
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
3. **不得破坏** open / save / autosave / session / recovery 链路与既有测试（当前 332 + 24）。
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

### 3.4 三条可复用手法（下一片多半还要用）

- **双引擎共用一个行为** → 在 `options.parent` 上挂 capture 监听（§3.2）。测试时注意：
  **`dragover` 要派发在 host 上**（ProseMirror 的 `editHandlers.dragover` 无条件 `preventDefault`，
  派发在 editable 上会「假绿」），**`drop` 派发在 editable 上**（这才证明监听能听到冒泡上来的事件）。
- **外部命令要碰到 EditorPane 私有的 surface** → 走 `useUi` 的 `{ ..., seq }` 请求 + EditorPane 里
  一个订阅 `useEffect`（`reveal`、`imageInsert` 都是这个路子）。
- **平台能力扩三端 + 7 个 fake**（§2 约束 6）。

---

## 4. 下一步：剩余 5 个功能缺口（**本轮范围**，用户已勾选「功能缺口」这一类）

> 顺序建议：先问用户定范围的（④）→ 再做有 golden 硬门槛的（③）→ 其余按依赖排。
> 每一片都走 `/tdd`：先失败测试，再最小实现，再重构。

### ① Shiki 代码高亮（ADR §2.5、§2.11，行 94 / 117 / 189）

- **现状**：全仓**没有任何 `shiki` 依赖**。WYSIWYG 侧是 `wysiwyg.ts:326` 的 `codeBlockSchema`
  （普通代码块，无高亮）；源码模式是 CodeMirror 自带高亮。ADR 要求「WYSIWYG 与导出 HTML 共用
  同一套高亮」「主题随应用主题联动」。
- **落点**：`packages/core/src/editor/`（引擎层）+ 依赖装在 `packages/core`。
- **注意**：只改 DOM 不改序列化 → **不用**加语料；一旦语言元信息参与序列化就必须补语料并登记
  `EXERCISES`。M6 导出 HTML 要复用同一套，别写成只服务编辑器的一次性渲染。
- **先想清楚**：整块重渲染 vs 逐 token；模式切换（`setMode`）后高亮状态怎么活下来。

### ② YAML front matter 可视化**编辑**（ADR 行 96）

- **现状**：`wysiwyg.ts:232` `frontMatterSchema` 是 **`atom: true` 的只读块** —— 显示✅、编辑❌。
  `toDOM` 按行 split、`parseDOM` 按 `[data-line]` join，**是可逆的**，注释、列表项、续行都能原样回来
  （`tests/front-matter.test.ts` 钉住了「注释存活」）。
- **要做成可编辑**：改回 `value` attr 必须**逐行字节级还原**，否则 golden 的 `front-matter.md` 会红。
- **注意**：`atom` 节点在 ProseMirror 里光标当整体处理；要编辑就得想清楚是改成可编辑节点，
  还是开一个编辑态（后者更稳，但要新文案 → 双 locale）。

### ③ `[TOC]` 目录（ADR 行 78「常用扩展」）

- **现状**：全仓搜不到 `[TOC]`，**一条都没有**。
- **这是新语法 → golden 硬门槛**：补语料 + 登记 `EXERCISES`（§2 约束 2）。
- **先回答这个设计问题再写代码**：TOC 是渲染成一个可跳转的目录节点，还是渲染时展开成链接列表？
  **展开会直接打破 md → PM → md 字节一致**。要展开就得在序列化时再折回 `[TOC]`，
  那是另一套往返契约 —— 想清楚再动手。跳转必须走 `MarkdownSurface` 的方法（ADR §2.3），
  UI 不得摸引擎。

### ④ 文件重命名/移动的**引用重写**（ADR 行 146）

- **现状（本轮核实）**：`PlatformAdapter.renamePath` 三端都在
  （browser 明确 `throw PlatformError("Rename is not supported…")`、tauri 有 `rename_path` 命令），
  **但全仓没有一个调用方，也没有任何重命名 UI**（`packages/ui/src` 里搜不到 rename）。
  所以这件事是**两段**：先把重命名暴露出来，再在重命名时重写引用。
- ⚠️ **动手前先问用户**：ADR §6 未决问题 **5** 就是它 —— 「只覆盖图片，还是覆盖所有相对链接
  （含跨文件链接）」。范围不同，工作量差一个量级。
- 参考：`paste-image.ts` 已经把「相对路径写法」的规矩写死了（`./assets/…`，从不写绝对路径），
  重写时按同一套语义反解。

### ⑤ WYSIWYG 多光标（ADR 行 92、行 158）

- **现状（本轮核实）**：源码模式多光标由 CodeMirror 自带（ADR 行 158 明确选型理由就是它）；
  WYSIWYG 侧 `wysiwyg.ts` 的 `.use(...)` 列表（815–832 行）**没有任何多光标配置，也没有测试**。
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

| 项                          | 核实结果                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find.openHint` 死 key      | ✅ 成立：`zh-CN.json:60` / `en-US.json:60` 有，**源码无一处引用**。守卫只查 `t(` 能解析，不查反向                                                    |
| `RECOVERY_KEY` 只写不读     | ✅ 成立：`core/src/autosave.ts:15` 声明、`:99` 写入，**全仓无读取** —— 崩溃恢复没接上                                                                |
| 找替换缺「N/M」计数         | ✅ 成立：`FindReplace.tsx` 只有 `find.noMatches`，没有当前第几个 / 共几个                                                                            |
| `pnpm build` chunk 体积警告 | ✅ 成立：`index` 1.63 MB、`elk` 1.47 MB、`cynefin` 688 KB、`mermaid.core` 669 KB                                                                     |
| 状态栏 WYSIWYG 光标不更新   | ❌ **不成立，别去修**：`wysiwyg.ts` 的 `changeWatcher` 已在 selection 变化时回调 `onCursorChange`，`EditorPane` 也接了 `setCursor`，两条引擎路径都通 |

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
- Shiki（§4 ①）与导出 HTML 是同一套高亮 —— **做 ① 时给 M6 留口**。

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
