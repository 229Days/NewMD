import { create } from "zustand";
import { setLocale } from "../i18n";
import { mergeHotkeys } from "../hotkeys";
import { getPlatform } from "../platform";
import { DEFAULT_SETTINGS, type AppSettings } from "../types";

const SETTINGS_KEY = "settings";

export interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  /** Merge a partial settings object and persist it. */
  patch(partial: Partial<AppSettings>): Promise<void>;
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  /** Load persisted settings, falling back to defaults. Idempotent. */
  load(): Promise<void>;
}

function sanitize(raw: unknown): Partial<AppSettings> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Partial<AppSettings> = {};
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const value = src[key];
    const expected = typeof DEFAULT_SETTINGS[key];
    if (typeof value === expected) {
      // Safe: the runtime type matches the declared type for every key above.
      (out as Record<string, unknown>)[key] = value;
    }
  }
  // `hotkeys` is a map rather than a scalar, so matching the type of the
  // default only proves it is an object. Every chord in it is checked instead,
  // and what does not survive falls back to the default binding — the one thing
  // that must never happen is an action with no key left to reach it.
  const storedHotkeys = out.hotkeys;
  if (storedHotkeys !== undefined) out.hotkeys = mergeHotkeys(storedHotkeys);
  return out;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async patch(partial) {
    const settings = { ...get().settings, ...partial };
    // Language first, state second: subscribers render on the state change, so
    // copy still sitting in the old language at that instant gets painted and
    // nothing repaints it afterwards.
    await setLocale(settings.locale);
    set({ settings });
    await getPlatform().writeAppData(SETTINGS_KEY, settings);
  },

  async set(key, value) {
    await get().patch({ [key]: value } as Partial<AppSettings>);
  },

  async load() {
    const platform = getPlatform();
    try {
      const stored = await platform.readAppData(SETTINGS_KEY);
      const persisted = sanitize(stored);
      const settings = { ...DEFAULT_SETTINGS, ...persisted };
      await setLocale(settings.locale);
      set({ settings, loaded: true });

      // ADR-0001 §2.11: first launch writes the defaults into the store.
      if (Object.keys(persisted).length === 0) {
        await platform.writeAppData(SETTINGS_KEY, settings);
      }
    } catch {
      // Corrupt or unreadable settings should never block startup.
      await setLocale(DEFAULT_SETTINGS.locale);
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },
}));
