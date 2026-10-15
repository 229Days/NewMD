# ADR-0002: `[TOC]` 目录块

- **状态**: 已接受 (Accepted)
- **日期**: 2026-10-15
- **关联**: ADR-0001 §2.4「常用扩展」（行 78）、§2.3（引擎边界）、§2.5（往返序列化）、§2.7（导出）
- **决策性质**: 单项语法扩展的落地设计

---

## 1. 背景

ADR-0001 §2.4 把「目录 `[TOC]`」列进了方言的常用扩展，但仓库里一条实现都没有，`tests/golden/` 里也没有一份含 `[TOC]` 的语料 —— 所以 v1.0 功能缺口清单把它列成 ①。

动手前先探了现场，探到一条**改变了问题形状**的事实：

```
roundTrip("[TOC]\n")            === "\\[TOC]\n"
roundTrip("# [TOC]\n")          === "# \\[TOC]\n"
roundTrip("> [TOC]\n")          === "> \\[TOC]\n"
roundTrip("some [foo] text\n")  === "some \\[foo] text\n"
```

**`[TOC]` 今天就是一个往返 bug，不是「还没做的功能」。** 一个含 `[TOC]` 的文件今天被打开再保存，那 5 个字节就会变成 6 个。

根因在 `mdast-util-to-markdown/lib/unsafe.js`：

```js
{atBreak: true, character: '['},
{character: '[', inConstruct: 'phrasing', notInConstruct: fullPhrasingSpans},
```

第二条对**正文（phrasing）里的每一个 `[`** 生效 —— 不只是 `[TOC]`，任何不成对的方括号都逃不过。这是库的既定行为、对所有使用者一致，本项目不可能也不该去改它。`tests/roundtrip.test.ts` 一直没抓到，只是因为语料里没有一份触发它的文件。

由此推出一条硬结论：**写回那一步必须有一个自己的 stringify handler 直接吐出 `[TOC]`**（绕开 `safe()`），而 handler 必须挂在 mdast 节点类型上 —— 所以 `[TOC]` 必须是一个真节点，不能继续当普通段落。

另外两条探到的边界：

- `[TOC]: https://example.com` 加上独立的 `[TOC]`，会被 `inlineLinkReferences` 解析成**链接**（`linkReference` → `link`）。作者自己定义过 `[TOC]` 时它就不是指令，这个歧义由 transformer 的先后顺序裁决。
- `- [TOC]` 与 `> [TOC]` 里的 `[TOC]` **也是 paragraph**（`listItem` / `blockquote` 的子节点），所以「整段只有 `[TOC]`」这条规则本身不足以定范围。

---

## 2. 决定

### 2.1 文档里保留字面量 `[TOC]`

保存后文件里那 5 个字节就是 `[TOC]`，目录内容是**渲染时算出来的，不落盘**。

理由：往返字节一致是本项目的头号不变量（golden 是合并硬门槛）。展开成真链接列表要让文档承载生成内容，标题一改就过期，换回 Typora / GitHub / Obsidian 会看到一大坨死链接，而且往返要再加一套「展开态 → 折回 `[TOC]`」的契约，那是第二个往返合同。Typora 自己也是这么存的。

**被否决**：`[TOC]` 展开成 `- [标题](#标题)` 列表写进文档。

### 2.2 `[TOC]` 是一个真 mdast 节点类型 `toc`

新增 `packages/core/src/editor/toc.ts`，形状照抄 `editor/inline-marks.ts`（同类问题的既有先例：一对「识别用的 transformer + 写回用的 handler」，两边都导给 `markdown.ts` 与 `wysiwyg.ts` 共用，避免两条管线各长一套）。

- `tocMarker(node)`：识别谓词，唯一真源。
- `remarkToc`：transformer，把标记段落换成 `{ type: "toc", value: "<原样拼写>" }`。
- `tocHandler`：stringify handler，**直接写 `node.value`，不经过 `safe()`**。这正是 §1 那条硬结论要求的。

节点带 `value` 而不是写死 `[TOC]`，是为了**保住作者的拼写**：`[toc]` 必须原样回来，不能被规范化成 `[TOC]`。

`remarkToc` 的注册位置在两处都紧跟在 `inlineLinkReferences` **之后**（`markdown.ts` 的 processor 与 `wysiwyg.ts` 的 `remarkPluginsCtx`），这样「作者定义过 `[TOC]:` 就它是链接」由顺序自动裁决，不需要额外分支。

### 2.3 识别范围：文档顶层的独立段

只有**直接是文档根的子节点**、且整段恰好是 `[TOC]` / `[toc]`、且段内只有一个**无标记**的文本节点时才算。

- `- [TOC]` / `> [TOC]` 不算。理由：「列出整篇文档的标题」放进列表项或引用块里语义站不住，而且规则一句话能说完，mdast 侧与引擎侧两个实现逐字对得上、好测。
- 段内带标记（`**[TOC]**`）不算，行内代码 `` `[TOC]` `` 也不算 —— **行内代码是写这个字面量的逃生口**（见 §3）。
- 大小写不敏感（`[toc]` 也算）。

### 2.4 引擎侧：一打完就转换，反向自动降级

WYSIWYG 里 `[TOC]` 一旦成为独立段就立刻变成 `toc` 节点 —— 不等回车。由一个 ProseMirror 插件 `appendTransaction` 在**每一个** docChanged 事务之后跑同一个谓词：

- 顶层 `paragraph`，内容恰好是无标记文本 `[TOC]` → `setNodeMarkup(pos, tocType)`；
- `toc` 节点，内容不再是标记 → `setNodeMarkup(pos, paragraphType)`（读者删掉一个字符就退回普通段落，这是 Typora 的手感，也是「节点内容恒为标记」这条不变量的守卫）。

`setNodeMarkup` 换类型**保留内容**，两边的 nodeSize 相同，所以光标位置天然不动。转换事务带 `setMeta("addToHistory", false)`，撤销链上只留下读者自己敲的那一下。

选「一打完就转换」而不是「回车确认」，是为了让**打字和粘贴走同一条路**。回车方案下，粘贴进来的 `[TOC]` 不会成块，保存时会被序列化成 `\[TOC]` —— 「屏幕上看到什么，文件里就是什么」这条不变量在那条路径上就破了。

`appendTransaction` 是 ProseMirror 标准 API（不是 Milkdown 的），不越过 ADR-0001 §2.3 的引擎边界；`wysiwyg.ts` 里的 `codeHighlight()` 已经用 `$prose` 注册过同样形态的插件。

### 2.5 渲染：NodeView，选区驱动「预览 / 源码」两态

节点是 `content: "text*"` 的**可编辑**块（不是 atom），内容就是那 5 个字符。NodeView 一次把两半都渲染出来：

```html
<div data-newmd-toc>
  <div data-newmd-toc-list>…目录…</div>
  <div data-newmd-toc-source>[TOC]</div>
  <!-- contentDOM -->
</div>
```

哪一半可见由一个 **node decoration** 决定：一个插件在 `props.decorations` 里，对**光标不在其中**的每个 `toc` 节点打上 `data-mode="preview"`。CSS 里：

- `[data-newmd-toc][data-mode="preview"] [data-newmd-toc-source] { display: none }`
- 没有该属性时反过来藏掉 `[data-newmd-toc-list]`

**缺省是源码态** —— decoration 缺失时的样子就是文件里的样子，这是个安全的默认值。光标一进块就变回裸 `[TOC]`，可以逐字符删；删到不再是标记时 §2.4 的降级接手。

用 decoration + CSS 而不是 NodeView 自己的状态机，是因为 `props.decorations` 每次状态变化都会重算（含纯选区事务），而 NodeView 的 `update` 只在**这个节点自己**变时被调用 —— 光标移进移出不算，这个模式切换它接不住。这也让两态在 jsdom 里可测（断言 `data-mode` 属性），不必依赖布局。

### 2.6 目录内容与跳转

- 条目由**与 `revealHeading` 同一份**标题遍历产出。现状 `wysiwyg.ts` 的 `revealHeading` 里内联着 `(level, textContent, occurrence)` 的走法；本片把它抽成一个共用函数，让目录条目和跳转目标不可能各说各话。
- 条目渲染成 `<button type="button" data-newmd-toc-entry data-level data-text data-occurrence>`，**不发明 heading id**。Markdown 的标题没有 id，而 `(level, text, occurrence)` 是 `handle.ts` 已经定下的锚（ADR-0001 §2.3 / M4 大纲），再造一套 id 方案就有了第二个身份系统，还要让它扛住往返。按钮而不是 `<a>`：不需要 id、不改变 URL、键盘可聚焦是白拿的。（代价见 §3 导出。）
- 点击在 `mousedown` 上 `preventDefault` 再在 `click` 里处理，焦点不会被按钮抢走。
- 缩进按 `level - minLevel`。
- 目录**不落盘、不参与撤销**：它是这个节点的渲染结果，不是文档内容。

### 2.7 重画时机

目录内容依赖整篇文档的标题，而 NodeView 的 `update` 只在自身变化时触发（同 §2.5）。所以由一个插件级的 `view.update` 在标题签名变化时，重画 DOM 里所有 `[data-newmd-toc-list]`。签名与 Shiki 那片用的是同一个手法（把标题拼成一个字符串比较），重画函数与 NodeView 创建时调用的是同一个。这与 `mermaid.ts` 的模块级 `hosts` 集合是同一个模式。

### 2.8 样式归属

核心只发射 `data-newmd-toc*` 属性，**样式写在 `packages/ui`**，与 `data-newmd-mermaid` / `data-newmd-frontmatter` 一致。这一片不引入任何面向读者的文案，因此不涉及双 locale。

唯一例外是 §2.5 那两条 `display` 规则 —— 它们是这个两态机制本身，不是外观偏好，跟 Shiki 那片的 `highlight.css` 同理，需要随核心一起走。

---

## 3. 代价与已知缺口

- **写不出独立成段的字面量 `[TOC]`。** 想要它，就用行内代码 `` `[TOC]` `` —— 那在另一个节点里，既不被识别也不被转义。这与 Typora 一致。
- **段内不再能自由编辑而不触发降级。** 在 `toc` 块里敲一个字符，块立刻退回普通段落（再次删掉那个字符又会变回目录块）。这是 §2.4 不变量的直接后果，也是 Typora 的行为。
- **条目是 `<button>` 而不是 `<a href="#…">`**（§2.6）。导出的 HTML 需要真锚点，M6 得在导出管线里把条目展开成带 id 的链接 —— 那是导出侧的事，届时 id 的生成规则要有自己的一份决定。
- **空目录**（文档里没有标题）渲染成一个空的 `<ul>`，不加任何文案。读者自己敲的 `[TOC]`，他知道那是什么。要不要有无标题提示，留给以后。
- **`display:none` 藏 contentDOM 是浏览器行为，jsdom 测不到。** 测试只能断言 decoration 打出的 `data-mode`；「藏起来的那一半不会干扰读 DOM」这条要在真浏览器里手测一次。
- **`[TOC]` 在列表项/引用块里仍然会被转义成 `\[TOC]`**（§2.3 的范围之外）。这是 §1 那条库行为的普遍后果，不是本片引入的；本片只对顶层独立段做了豁免。

---

## 4. 被否决的方案

| 方案                                                          | 否决理由                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `[TOC]` 展开成真链接列表写进文档                              | 打破往返字节一致；文档载生成内容；换工具看到死链接；见 §2.1                                                                             |
| 保持 paragraph，只加一个 `paragraph` 级别的 stringify handler | 要整个重写 remark-stringify 的 `paragraph` handler（tracker / `containerPhrasing` / 边界），与上游漂移的风险大于新增一个节点类型；见 §1 |
| atom 节点（像 mermaid 那样，源码只在源码模式可见）            | 读者拿不到「点进去看 `[TOC]`」的手感；选的正是可编辑块                                                                                  |
| 回车确认才成块                                                | 粘贴路径漏网，且会静默写出 `\[TOC]`；见 §2.4                                                                                            |
| 给标题生成 id，目录条目用 `<a href="#id">`                    | 在 `(level, text, occurrence)` 之外再造一套身份系统，还要扛往返；见 §2.6                                                                |
| 只在渲染层做（decoration 挂 widget，mdast 不动）              | 序列化侧的转义问题必须靠 handler 解决，而 handler 需要节点类型；见 §1                                                                   |

---

## 5. 未决问题

1. **嵌套目录 / 深度上限** —— 目前列全部标题、按 `level - minLevel` 缩进。要不要支持 `[TOC levels=1-3]` 这类参数？Typora 的 `[TOC]` 不带参数。
2. **导出 HTML 的锚点方案** —— 见 §3，留给 M6。
3. **多光标下 `toc` 块的降级行为** —— 依赖 v1.0 缺口 ③ 的结论，届时补测。
