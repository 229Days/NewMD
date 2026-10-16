/**
 * YAML front matter, drawn as rows (ADR-0001 §2.4, ADR-0005 §2.4).
 *
 * mdast hands this over as one string: the lines between the fences with the
 * fences stripped, and the same string is what goes back out. So the panel below
 * only ever *reads* it. Round-tripping the metadata through a YAML parser and
 * back would be lossy in ways the reader meets on their next save — comments
 * dropped, keys reordered, quoting normalised — and every one of those would
 * have to be declared as an accepted rewrite in the corpus.
 *
 * Which is why the write path (ADR-0001 §2.5 可视化编辑) is a *view* and not a
 * parser: the rows split a line into a key and a value so a stylesheet can tell
 * them apart, the reader types into a row, and what goes back into `value` is
 * the rows joined by newlines — the same split `toDOM` makes and `parseDOM`
 * undoes. Nothing here is ever understood as YAML, so nothing can be rewritten
 * by being understood.
 *
 * **Why it is not in `wysiwyg.ts`**, which is where it was written. The export
 * draws the same block, and it must draw the same one: a front matter panel that
 * looked like metadata on screen and like body text in an exported page would be
 * two readings of one document. This module builds the markup and makes no
 * engine call, so it is reachable from both — and the node view that adds the
 * caret to these rows stays behind, because that half is the engine's.
 */

const FRONT_MATTER_FIELD = /^([\w.-]+):(?:[ \t]+(.*))?$/;

/** One `div[data-line]` per source line, key and value split out for styling. */
export function frontMatterRows(value: string): HTMLDivElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-newmd-frontmatter", "");
  for (const line of value.split("\n")) {
    const row = document.createElement("div");
    row.setAttribute("data-line", "");
    const field = FRONT_MATTER_FIELD.exec(line);
    if (field === null) {
      // An indented list item, a comment, a continuation line: shown as it
      // was typed. This reads lines, it does not parse YAML, so a shape it
      // does not recognise shows one row rather than losing the text.
      row.textContent = line;
    } else {
      const key = field[1] ?? "";
      const rawValue = field[2];
      const keyPart = document.createElement("span");
      keyPart.setAttribute("data-key", "");
      keyPart.textContent = key;
      row.append(keyPart);
      if (rawValue === undefined) {
        // A key with nothing after the colon (`tags:`) — the rest of the
        // line is separator, not value.
        row.append(line.slice(key.length));
      } else {
        // The colon and whatever spacing the source used between it and the
        // value. Taken by length rather than re-derived, so the row reads
        // back as the exact line it was split out of.
        const gap = line.length - key.length - rawValue.length;
        row.append(line.slice(key.length, key.length + gap));
        const valuePart = document.createElement("span");
        valuePart.setAttribute("data-value", "");
        valuePart.textContent = rawValue;
        row.append(valuePart);
      }
    }
    panel.append(row);
  }
  return panel;
}
