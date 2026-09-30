import { anyDocumentDirty, flushAutosave, stopSessionPersistence, useUi } from "@newmd/core";
import { useEffect } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditorPane } from "./EditorPane";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TabStrip } from "./TabStrip";
import { TitleBar } from "./TitleBar";
import { Toast } from "./Toast";
import {
  useHotkeys,
  useTypographyVariables,
  useUserCss,
  useWindowTitle,
} from "../hooks/useAppHooks";
import { useT } from "../hooks/useT";

export function AppShell() {
  const t = useT();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const ready = useUi((s) => s.ready);

  useHotkeys();
  useWindowTitle();
  useTypographyVariables();
  useUserCss();

  // Last line of defence against losing work: warn before the window goes away,
  // and push the session snapshot + any pending autosave out the door first.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Any tab, not just the one showing: the edited tabs the reader has
      // forgotten are open are exactly the ones this guard exists for.
      if (anyDocumentDirty()) {
        void flushAutosave();
        void stopSessionPersistence();
        event.preventDefault();
        event.returnValue = "";
        return;
      }
      void stopSessionPersistence();
    };

    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          <TabStrip />
          <EditorPane />
        </main>
      </div>
      <StatusBar />
      <Toast />
      <ConfirmDialog />
      {!ready && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--bg)]">
          <span className="text-[13px] text-[var(--fg-muted)]">{t("common.loading")}</span>
        </div>
      )}
    </div>
  );
}
