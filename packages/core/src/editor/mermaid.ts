/**
 * Drawing a ` ```mermaid ` fence (ADR-0001 §2.4 可选扩展, §4 M5).
 *
 * Kept out of `wysiwyg.ts` for the reason `math.ts` is out of it: that file's
 * contract is that every *Milkdown* call in the project lives in it, and this
 * module makes none — it turns a string into markup.
 *
 * Two things it is careful about:
 *
 * - **The import is dynamic.** Mermaid outweighs everything else the editor
 *   ships; bundled into the entry chunk it would land on the critical path of
 *   opening a file with no diagrams in it. Vite gives it its own chunk, fetched
 *   the first fence that needs it.
 * - **Failure is a state, not an exception.** A fence that does not parse
 *   unwinds out of `mermaid.render`, and there is no caller to hand that to —
 *   `toDOM` is synchronous and returned long ago. It is caught here and shown
 *   over the source, which is the fallback §2.4 互操作策略 asks for anyway.
 *
 * The diagram is baked colours rather than CSS variables, so it cannot follow
 * the theme the rest of the app does. It is drawn in the theme that is current
 * when it is drawn, and drawn again when `[data-theme]` moves.
 */

/** Every host that has asked for a diagram, so one observer can redraw them. */
const hosts = new Set<HTMLElement>();

/**
 * Draw counter per host.
 *
 * Without it a theme change landing mid-render lets the superseded draw finish
 * last and put a stale diagram on top of the new one.
 */
const draws = new WeakMap<HTMLElement, number>();

let themeObserver: MutationObserver | null = null;

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `newmd-mermaid-${sequence}`;
}

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

/**
 * Redraw every live diagram when the theme changes.
 *
 * Attached once, on the first draw, and never torn down: an editor's diagrams
 * outlive any single one of them, and the set is pruned as hosts leave the
 * document.
 */
function watchTheme(): void {
  if (themeObserver !== null) return;
  themeObserver = new MutationObserver(() => {
    for (const host of [...hosts]) {
      if (!host.isConnected) {
        hosts.delete(host);
        continue;
      }
      // The source is still in the host behind the drawing — that is what this
      // redraws from, and what the reader falls back to if it fails again.
      void drawMermaid(host, host.querySelector("pre code")?.textContent ?? "");
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/**
 * Draw `source` into `host`, which is expected to already hold the source in a
 * `<pre>` that stays on screen until a drawing replaces it.
 */
export function drawMermaid(host: HTMLElement, source: string): Promise<void> {
  const token = (draws.get(host) ?? 0) + 1;
  draws.set(host, token);
  hosts.add(host);
  watchTheme();

  host.querySelectorAll("[data-diagram]").forEach((node) => node.remove());
  host.removeAttribute("data-rendered");

  return (async () => {
    try {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        // Strict is Mermaid's default and the reason `innerHTML` below is
        // safe: diagrams cannot reach for scripts or external resources.
        securityLevel: "strict",
        theme: isDark() ? "dark" : "default",
      });
      const { svg } = await mermaid.render(nextId(), source);
      if (draws.get(host) !== token) return;
      const holder = document.createElement("div");
      holder.setAttribute("data-diagram", "");
      holder.innerHTML = svg;
      host.setAttribute("data-rendered", "ok");
      host.append(holder);
    } catch {
      if (draws.get(host) !== token) return;
      host.setAttribute("data-rendered", "error");
    }
  })();
}
