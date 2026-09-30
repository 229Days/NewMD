import { outlineOf, useEditor, useWorkspace, visibleTree } from "@newmd/core";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  handleOpenFolder,
  handleOpenPath,
  handleRefreshWorkspace,
  handleRevealHeading,
  handleToggleDir,
} from "../actions";
import { useT } from "../hooks/useT";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-center px-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
        {children}
      </h2>
    </div>
  );
}

/** Which half of the sidebar is showing: the workspace, or the document. */
type SidebarTab = "files" | "outline";

function tabClass(active: boolean): string {
  return active
    ? "text-[11px] font-semibold uppercase tracking-wide text-[var(--fg)]"
    : "text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]";
}

export function Sidebar() {
  const t = useT();
  const rootName = useWorkspace((s) => s.rootName);
  const rootPath = useWorkspace((s) => s.rootPath);
  const entries = useWorkspace((s) => s.entries);
  const expanded = useWorkspace((s) => s.expanded);
  const loading = useWorkspace((s) => s.loading);
  const recent = useEditor((s) => s.recent);
  const currentPath = useEditor((s) => s.doc?.path ?? null);
  const content = useEditor((s) => s.doc?.content ?? "");
  const [tab, setTab] = useState<SidebarTab>("files");

  // Derived, not stored: what shows is a function of (what each directory
  // holds, which are open), so the panel cannot drift from its own state.
  const rows = visibleTree(entries, expanded, rootPath);
  // Parsed only while the outline is showing. It is a full parse of the
  // document on every change to it, and a reader who never opens the outline
  // should not pay for one.
  const outline = useMemo(() => (tab === "outline" ? outlineOf(content) : []), [tab, content]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <div className="flex h-8 items-center justify-between px-3">
        <div role="tablist" aria-label={t("sidebar.tabsLabel")} className="flex items-center gap-3">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            title={rootName ? t("sidebar.filesIn", { name: rootName }) : undefined}
            onClick={() => setTab("files")}
            className={tabClass(tab === "files")}
          >
            {t("sidebar.tabFiles")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "outline"}
            onClick={() => setTab("outline")}
            className={tabClass(tab === "outline")}
          >
            {t("sidebar.tabOutline")}
          </button>
        </div>
        {tab === "files" && rootPath ? (
          <button
            type="button"
            onClick={() => void handleRefreshWorkspace()}
            title={t("sidebar.refreshHint")}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--fg-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            {t("sidebar.refresh")}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {tab === "outline" ? (
          outline.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-[var(--fg-subtle)]">
              {t("sidebar.outlineEmpty")}
            </p>
          ) : (
            <ul>
              {outline.map((heading) => (
                <li key={`${heading.level}-${heading.occurrence}-${heading.text}`}>
                  <button
                    type="button"
                    onClick={() => handleRevealHeading(heading)}
                    style={{ paddingLeft: `${12 + (heading.level - 1) * 12}px` }}
                    className="flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className="truncate">
                      {heading.text === "" ? t("sidebar.untitledHeading") : heading.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : !rootPath ? (
          <div className="px-3 py-2">
            <p className="mb-2 text-[12px] leading-relaxed text-[var(--fg-subtle)]">
              {t("sidebar.openFolderHint")}
            </p>
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              {t("sidebar.openFolder")}
            </button>
          </div>
        ) : loading ? (
          <p className="px-3 py-2 text-[12px] text-[var(--fg-subtle)]">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--fg-subtle)]">
            {t("sidebar.emptyFolder")}
          </p>
        ) : (
          <ul>
            {rows.map((row) => {
              // One indent for both kinds: depth is what the tree encodes, and a
              // row that does not move with it reads as a different tree.
              const indent = { paddingLeft: `${12 + row.depth * 12}px` };

              if (row.kind === "dir") {
                const open = expanded.includes(row.path);
                return (
                  <li key={row.path}>
                    <button
                      type="button"
                      aria-expanded={open}
                      title={row.path}
                      onClick={() => void handleToggleDir(row.path)}
                      style={indent}
                      className="flex w-full items-center gap-1.5 py-1 pr-3 text-left text-[13px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                    >
                      <span aria-hidden="true" className="w-3 shrink-0 text-[10px]">
                        {open ? "▾" : "▸"}
                      </span>
                      <span className="truncate">{row.name}</span>
                    </button>
                  </li>
                );
              }

              const active = row.path === currentPath;
              return (
                <li key={row.path}>
                  <button
                    type="button"
                    onClick={() => void handleOpenPath(row.path)}
                    style={indent}
                    className={
                      active
                        ? "flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[13px] text-[var(--accent)]"
                        : "flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
                    }
                  >
                    <span className="truncate">{row.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SectionHeading>{t("sidebar.recent")}</SectionHeading>
      <div className="max-h-56 shrink-0 overflow-y-auto border-t border-[var(--border-subtle)] pb-2">
        {recent.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--fg-subtle)]">{t("sidebar.nothingYet")}</p>
        ) : (
          <ul>
            {recent.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => void handleOpenPath(entry.path)}
                  title={entry.path}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                >
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
