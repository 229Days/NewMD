import { beforeEach, describe, expect, it } from "vitest";
import { getLocale, initI18n, resetI18n, t } from "../src/i18n";
import { resetPlatform, setPlatform } from "../src/platform";
import type { JsonValue, PlatformAdapter } from "../src/platform/types";
import { useSettings } from "../src/stores/settings";
import { DEFAULT_SETTINGS } from "../src/types";

function fakeAdapter(seed: Record<string, JsonValue> = {}) {
  const store = new Map<string, JsonValue>(Object.entries(seed));
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  const adapter: PlatformAdapter = {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: unused,
    writeTextFile: unused,
    writeBinaryFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    pathJoin: unused,
    pathParent: unused,
    pathFileName: unused,
    pathExtension: unused,
    readAppData: async (key) => store.get(key) ?? null,
    writeAppData: async (key, value) => {
      store.set(key, value);
    },
    deleteAppData: async (key) => {
      store.delete(key);
    },
  };
  return { adapter, store };
}

beforeEach(async () => {
  resetI18n();
  resetPlatform();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await initI18n();
});

describe("the locale setting drives the interface language", () => {
  it("switches language the moment the setting changes", async () => {
    const { adapter } = fakeAdapter();
    setPlatform(adapter);

    await useSettings.getState().set("locale", "en-US");

    expect(getLocale()).toBe("en-US");
    expect(t("statusBar.ready")).toBe("Ready");
  });

  it("has the new copy in hand before subscribers run", async () => {
    const { adapter } = fakeAdapter();
    setPlatform(adapter);

    // React renders the moment settings change, so `t` has to already be
    // speaking the new language at that instant. Awaiting the switch *after*
    // publishing the state would paint the old copy and never repaint.
    const rendered: string[] = [];
    const stop = useSettings.subscribe(() => rendered.push(t("statusBar.ready")));

    await useSettings.getState().set("locale", "en-US");
    stop();

    expect(rendered.at(-1)).toBe("Ready");
  });

  it("switches back to Chinese when the setting goes home", async () => {
    const { adapter } = fakeAdapter();
    setPlatform(adapter);

    await useSettings.getState().set("locale", "en-US");
    await useSettings.getState().set("locale", "zh-CN");

    expect(getLocale()).toBe("zh-CN");
    expect(t("statusBar.ready")).toBe("就绪");
  });

  it("persists the choice so a restart keeps it", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);

    await useSettings.getState().set("locale", "en-US");

    const stored = store.get("settings") as Record<string, JsonValue>;
    expect(stored.locale).toBe("en-US");
  });

  it("applies the persisted locale at boot", async () => {
    const { adapter } = fakeAdapter({ settings: { ...DEFAULT_SETTINGS, locale: "en-US" } });
    setPlatform(adapter);
    resetI18n();
    await initI18n();

    // Loading settings is what boot does; applying the locale must be part of
    // that, not a step the caller has to remember.
    await useSettings.getState().load();

    expect(getLocale()).toBe("en-US");
    expect(t("titleBar.saveAs")).toBe("Save as");
  });
});
