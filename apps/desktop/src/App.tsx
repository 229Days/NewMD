import { bootstrapCore, createBrowserAdapter } from "@newmd/core";
import { AppShell, useT } from "@newmd/ui";
import { useEffect, useState } from "react";
import { createTauriAdapter, isTauri } from "./platform/tauri";

export default function App() {
  const t = useT();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const adapter = isTauri() ? createTauriAdapter() : createBrowserAdapter();
    bootstrapCore(adapter).catch((err: unknown) => {
      setBootError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg)] p-8">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-[16px] font-semibold text-[var(--danger)]">
            {t("app.bootFailed")}
          </h1>
          <p className="text-[13px] leading-relaxed text-[var(--fg-muted)]">{bootError}</p>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
