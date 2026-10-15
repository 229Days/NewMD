# ADR-0004: 多光标 —— 源码模式有，WYSIWYG 不做

- **状态**: 已接受 (Accepted)
- **日期**: 2026-10-15
- **关联**: ADR-0001 §2.5（行 92 的「多光标」）、§2.9（行 158 的 CodeMirror 选型理由）、
  §2.3（引擎边界）、ADR-0002 §5 未决问题 3、ADR-0003 §3 与 §5
- **决策性质**: 把一句承诺收窄到一个模式，并补上真正让它成立的那一个 facet

---

## 1. 背景

动手前核实了两件事，各改变了一半的做法。

**① 源码模式的多光标一直是坏的，而文档一直说它是好的。** `EditorState.allowMultipleSelections`
是一个 facet，`@codemirror/state` 的 `applyTransaction` 这样读它：

```js
let selection = tr.startState.facet(allowMultipleSelections)
  ? tr.newSelection
  : tr.newSelection.asSingle();
```

`asSingle()` 只留 `mainIndex` 那一个范围，其余丢掉。**`@codemirror/*` 里没有任何一个包设置它**，
本仓也从来没设过。于是三个手势全都接好了、又全都不能用：

| 手势                     | 谁提供的                                    | 没有 facet 时                   |
| ------------------------ | ------------------------------------------- | ------------------------------- |
| Alt 拖拽出一列           | `rectangularSelection()`（早就装了）        | 拖出一列，落下时只剩一个光标    |
| Alt 点击加一个光标       | 要自己给 `clickAddsSelectionRange`          | 走默认键（Ctrl / Mac 上是 Cmd） |
| `Mod-d` 选中下一处       | `keymap.of([{ key: "Mod-d", … }])`          | 第二下看起来什么都没发生        |
| `Mod-Alt-↑` / `↓` 加光标 | `defaultKeymap` 里的 `addCursorAbove/Below` | 同上                            |

HANDOFF §4 当时写的是「源码模式多光标由 CodeMirror 自带」—— 正是这句话把它藏了整整一个项目周期。
**一个「自带」的能力不会有人去测，而它其实要显式打开。**

**② WYSIWYG 那边没有现成方案，而且缺的不止一点。** 实测：

- Milkdown 7.22.2 的 `plugin-*` 里没有任何多光标导出；
- `EditorState.selection` 是**一个** `Selection`，内置的几个 Selection 类没有一个会产出多于一个
  `SelectionRange`；
- `prosemirror-view@1.42.6` 没有 `drawSelection` / `drawSelectionCursor`，而且它会主动把多范围的
  DOM 选区按 min/max **收敛成一个**；
- `prosemirror-gapcursor@1.4.1` 在依赖树里（Milkdown 带进来的），但本仓没有直接依赖、源码里也没有
  一处 import —— 而且它是**单**光标。

要补就是一整套：自定义 `Selection` 子类（要能穿过每个 transaction 的 mapping）+ decoration 画光标 +
每条命令逐范围应用。

---

## 2. 决定

### 2.1 v1.0 的「多光标」指源码模式

ADR-0001 §2.5 那一行列了「多光标」，没说在哪个模式。现在写明：**源码模式**。WYSIWYG 不做。

### 2.2 一个 facet，三个手势同时成立

`packages/core/src/editor/codemirror.ts` 的 `createMarkdownExtensions` 里加三行：

```ts
EditorState.allowMultipleSelections.of(true),
EditorView.clickAddsSelectionRange.of((event) => event.altKey),
crosshairCursor(),
```

facet 是全部要点。没有它，上面三个手势每一个都是「动了一下又收回」，而**收回发生在造出它的那个
transaction 里** —— 所以它看起来不像坏了，只像没反应。

### 2.3 Alt 是唯一的键，而且不分平台

CodeMirror 各部分自己的默认值是**三个不同的键，其中一个还随平台变**：

| 部件                      | 默认值                                      |
| ------------------------- | ------------------------------------------- |
| `clickAddsSelectionRange` | 空 facet → `mac ? metaKey : ctrlKey`        |
| `rectangularSelection()`  | `e.altKey && e.button == 0`（**不分平台**） |
| `crosshairCursor()`       | `options.key \|\| "Alt"`（**不分平台**）    |

统一成 Alt。所以这一片只改了 `clickAddsSelectionRange` 那一半 —— 另外两个本来就在说 Alt，是
**点击**那一半在说 Ctrl。Mac 上 Alt 就是 Option，在这个编辑器里没有别的东西占用它。

### 2.4 不做 WYSIWYG 的理由

**① 引擎切换本来就是这类能力的出口。** `Ctrl+/`（ADR-0001 §2.2、§2.9）。

**② 多光标最常见的真实用途已经覆盖了。** 「改一处、处处改」在两种模式下都是「全部替换」，
`packages/core/tests/search.test.ts` 对两个引擎都钉着。缺的只是那个**手势**，不是那个**能力**。

**③ 自研插件的失败模式是静默改坏选区。** 一个 Selection 子类要能穿过每个 transaction 的 mapping，
要和 Milkdown 自己的插件、IME、undo 都对上。它的 bug 不会报错，只会让光标落在别处。这是「一片
里程碑」而不是「一片切片」，而收益（在一个一键就能切换走的模式里少按一个键）不成比例。

### 2.5 这两个 Alt 手势不进快捷键设置面板

`HotkeyActionId`（`packages/core/src/hotkeys.ts`）是**应用级动作**的表（打开、保存、查找…），面板
一行一个 id。编辑器内部的手势不是它：写进去就等于要求 WYSIWYG 也认这个绑定，而 WYSIWYG 根本没有
这个能力 —— **一个只在半个矩阵里成立的设置项比没有这个设置项更糟**。

所以本片**没有新增任何用户可见文案**，HANDOFF §2 约束 4（双 locale）因此不适用。

### 2.6 与既有功能的接缝

- **查找替换的「选中这一处」与 outline 跳转会把多光标收敛回一个**：两者都派发
  `EditorSelection.single(...)`。这是对的 —— 一次查找的落点是**一个**位置。
- **状态栏不用改**：`selection.main.head` 在多范围下仍然良定义，`main` 就是主范围。
- **`insertImage` 会在每一处各插一个**：它走 `view.state.replaceSelection(...)`，这是多光标的正常
  语义。它也是这一片唯一能测「打字落在每一处」的入口（见 §3）。
- **`Escape` 收敛回一个光标**：`defaultKeymap` 里的 `simplifySelection`，本来就是干这个的。

### 2.7 无新语法 → 无 golden 语料

这一片不碰序列化器，也不引入新的 Markdown 写法（HANDOFF §2 约束 2 的分界）。

---

## 3. 代价与已知缺口

- **三个手势里两个是鼠标手势，jsdom 测不到。** 没有布局、没有 `caretPositionFromPoint`，Alt+点击与
  Alt 拖拽都驱动不了。测试驱动的是**它们留下的东西**（一个带多个范围的 transaction）与**应用给的
  答案**（把 `clickAddsSelectionRange` 那个 facet 读回来调用）。手势本身留手测：
  1. 按住 Alt 在正文里点一下 → 出现第二个光标；
  2. 按住 Alt 从左上拖到右下 → 留下**一列**光标；
  3. 按住 Alt 时鼠标变十字（`crosshairCursor()`，纯视觉，任何测试都看不见 —— 删掉它，
     整个 core 450 条测试一条都不会红）。
- **Mac 真机未实测。** Alt 在 Mac 上是 Option，三个手势读同一个修饰键，但没跑过。
- **WYSIWYG 没有多光标**（§2.1）。出口是 `Ctrl+/`。
- **`Mod-d` 的语义是 CodeMirror 的**，不是本仓定的：光标在词内先选词，已选词再按才找下一处。
  见 §5。
- 逆向记一条：**没有这一片，源码模式里 `Mod-d` 的第二下永远没有反应**。写在这里是因为它曾经
  看起来像 CodeMirror 的 bug，而不是像本仓漏了一个 facet。

---

## 4. 被否决的方案

| 方案                                                     | 否决理由                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自研 ProseMirror 多光标插件                              | Selection 子类要穿过每个 transaction 的 mapping，还要和 Milkdown 插件 / IME / undo 对上；失败是静默的，规模是一片里程碑；见 §2.4                                      |
| 只做「选中所有匹配」（decoration 高亮 + 一条命令改全部） | **省不掉自定义 Selection**（ProseMirror 装不下多个 range，「选中的样子」仍要自己画），而且它给不了多光标手势 —— 那只是一个「改全部」的入口，正是「全部替换」；见 §2.4 |
| 保留 CodeMirror 的 Ctrl+点击，只把拖拽说成 Alt           | 三个手势三个键，其中一个还随平台变；读者要记三个；见 §2.3                                                                                                             |
| 把 Alt 手势写进快捷键设置面板                            | 一个 WYSIWYG 兑现不了的绑定，等于面板上有半个矩阵在撒谎；见 §2.5                                                                                                      |
| 让 WYSIWYG 也开多光标，用 `Ctrl+/` 兜底                  | 兜底已经在；多写一整套插件换不来一个新的能力；见 §2.4                                                                                                                 |

---

## 5. 未决问题

1. **Mac 真机手测** —— 见 §3。
2. **`Mod-d` 之后的期望** —— 已经选了三个词再按一下，是加第四个还是全部选中？CodeMirror 给的是
   前者（`selectNextOccurrence` 一直加）。本片没有讨论过这条边界。
3. **表格与代码块里的 `Alt+点击` / 行尾 `Mod-d`** —— 归 CodeMirror 管，本片没有观察。

**两项因本片而关闭的挂账：**

- **ADR-0002 §5 未决问题 3**（「多光标下 `toc` 块的降级行为」）**不再存在**：`toc` 块只在 WYSIWYG 里
  是块，而 WYSIWYG 没有多光标，这个组合到不了。（顺带修正：那一条原文写的是「依赖 v1.0 缺口 ③」，
  编号指的是多光标这一项。）
- **ADR-0003 §3 与 §5** 里「等 WYSIWYG 多光标那一片的结论」的那些句子**不再是等它**：结论是这边
  不做，所以「稳定的标签身份」变成一个**没人认领的独立问题**，而不是一项被挡住的工作。
