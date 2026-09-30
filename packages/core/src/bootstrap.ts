/**
 * App startup sequence: settings -> recent list -> previous session -> watchers.
 * Deliberately ordered so a failure at any step leaves the app usable.
 */
import { startAutosave } from "./autosave";
import { initI18n } from "./i18n";
import { setPlatform } from "./platform/registry";
import type { PlatformAdapter } from "./platform/types";
import { restoreSession, startSessionPersistence } from "./session";
import { useEditor } from "./stores/editor";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";
import type { ResolvedTheme, ThemePreference } from "./types";

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  return media?.matches ? "dark" : "light";
}

/** Keep the painted theme in sync with the preference and the OS. */
export function watchTheme(): () => void {
  const apply = () => {
    useUi.getState().setTheme(resolveTheme(useSettings.getState().settings.theme));
  };

  apply();
  const unSettings = useSettings.subscribe(apply);
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", apply);

  return () => {
    unSettings();
    media?.removeEventListener("change", apply);
  };
}

export interface BootstrapResult {
  stop: () => void;
}

let inFlight: Promise<BootstrapResult> | null = null;

export async function bootstrapCore(adapter: PlatformAdapter): Promise<BootstrapResult> {
  // React StrictMode double-invokes effects in development; a second call must
  // join the boot already in flight rather than registering watchers twice.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Copy must exist before anything that can fail, or the boot-error screen
    // would render raw keys. The persisted locale is applied by `load()` next.
    await initI18n();
    setPlatform(adapter);

    await useSettings.getState().load();
    await useEditor.getState().loadRecent();
    await restoreSession();

    const stopAutosaveWatch = startAutosave();
    const stopSessionWatch = startSessionPersistence();
    const stopThemeWatch = watchTheme();

    useUi.getState().setReady(true);

    return {
      stop() {
        stopAutosaveWatch();
        stopSessionWatch();
        stopThemeWatch();
      },
    };
  })();

  return inFlight;
}
