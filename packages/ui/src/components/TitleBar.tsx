import { formatChord, isDocumentDirty, useEditor, useSettings, useUi } from "@newmd/core";
import type { ReactNode } from "react";
import {
  handleCloseDocument,
  handleNewDocument,
  handleOpenFile,
  handleOpenFolder,
  handleSave,
  handleSaveAs,
  toggleSidebar,
  toggleTheme,
} from "../actions";
import { useT } from "../hooks/useT";
import { SettingsPopover } from "./SettingsPanel";

interface ButtonProps {
  label: string;
  onClick: () => void;
  title?: string;
  primary?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

function Button({ label, onClick, title, primary, disabled, children }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={
        primary
          ? "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          : "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40"
      }
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function TitleBar() {
  // Read live, so the tooltip quotes the binding in force rather than the
  // one the panel opened with.
  const saveBinding = useSettings((s) => formatChord(s.settings.hotkeys.save));
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const dirty = useEditor((s) => isDocumentDirty(s.doc));
  const busy = useUi((s) => s.busy);
  const theme = useUi((s) => s.theme);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
      <button
        type="button"
        onClick={toggleSidebar}
        title={sidebarOpen ? t("titleBar.hideSidebar") : t("titleBar.showSidebar")}
        aria-pressed={sidebarOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <path d="M1 3.5A.5.5 0 0 1 1.5 3h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 3.5Zm0 4A.5.5 0 0 1 1.5 7h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 7.5Zm0 4a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Z" />
        </svg>
      </button>

      <div className="mx-2 flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-[var(--fg)]">
          {doc?.fileName ?? t("titleBar.noFile")}
        </span>
        {dirty && (
          <span
            title={t("titleBar.unsaved")}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
          />
        )}
      </div>

      <nav className="ml-auto flex items-center gap-1">
        <Button
          label={t("titleBar.new")}
          onClick={() => void handleNewDocument()}
          disabled={busy}
        />
        <Button label={t("titleBar.open")} onClick={() => void handleOpenFile()} disabled={busy} />
        <Button
          label={t("titleBar.folder")}
          onClick={() => void handleOpenFolder()}
          disabled={busy}
        />
        <Button
          label={t("titleBar.save")}
          onClick={() => void handleSave()}
          disabled={busy || !doc}
          primary
          title={t("titleBar.saveHint", { binding: saveBinding })}
        />
        <Button
          label={t("titleBar.saveAs")}
          onClick={() => void handleSaveAs()}
          disabled={busy || !doc}
        />
        <Button
          label={t("titleBar.close")}
          onClick={() => void handleCloseDocument()}
          disabled={busy || !doc}
        />
        <button
          type="button"
          onClick={() => void toggleTheme()}
          title={theme === "dark" ? t("titleBar.switchToLight") : t("titleBar.switchToDark")}
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 1a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm-.5-11.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0V2a.5.5 0 0 1 .5-.5Zm0 11a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5ZM2 7.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5Zm11 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5ZM3.05 3.05a.5.5 0 0 1 .7 0l.7.7a.5.5 0 0 1-.7.7l-.7-.7a.5.5 0 0 1 0-.7Zm8.5 8.5a.5.5 0 0 1 .7 0l.7.7a.5.5 0 0 1-.7.7l-.7-.7a.5.5 0 0 1 0-.7Zm.7-8.5a.5.5 0 0 1 0 .7l-.7.7a.5.5 0 1 1-.7-.7l.7-.7a.5.5 0 0 1 .7 0Zm-8.5 8.5a.5.5 0 0 1 0 .7l-.7.7a.5.5 0 0 1-.7-.7l.7-.7a.5.5 0 0 1 .7 0Z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278Z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          title={t("settings.title")}
          aria-expanded={settingsOpen}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492ZM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0Z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319Zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319Z" />
          </svg>
        </button>
      </nav>

      <SettingsPopover />
    </header>
  );
}
