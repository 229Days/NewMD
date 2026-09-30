import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getI18n,
  getLocale,
  initI18n,
  resetI18n,
  setLocale,
  SUPPORTED_LOCALES,
  t,
} from "../src/i18n";

beforeEach(() => {
  resetI18n();
});

afterEach(() => {
  resetI18n();
});

describe("i18n (ADR-0001 §2.11)", () => {
  it("defaults to Chinese", async () => {
    await initI18n();
    expect(getLocale()).toBe("zh-CN");
    expect(t("titleBar.save")).toBe("保存");
  });

  it("switches to English when the locale changes", async () => {
    await initI18n();
    await setLocale("en-US");
    expect(getLocale()).toBe("en-US");
    expect(t("titleBar.save")).toBe("Save");
  });

  it("falls back to Chinese for a key the active locale is missing", async () => {
    await initI18n();
    // A real translation gap, injected so production resources stay complete:
    // when English is missing a key it must fall through to Chinese rather
    // than render the raw key.
    getI18n().addResource("zh-CN", "translation", "test.zhOnly", "只在中文资源里");
    await setLocale("en-US");
    expect(t("test.zhOnly")).toBe("只在中文资源里");
  });

  it("renders the key itself when no locale knows it", async () => {
    await initI18n();
    expect(t("nope.not.a.real.key")).toBe("nope.not.a.real.key");
  });

  it("interpolates parameters into the copy", async () => {
    await initI18n();
    expect(t("statusBar.lines", { count: 3 })).toBe("3 行");
    await setLocale("en-US");
    expect(t("statusBar.lines", { count: 3 })).toBe("3 lines");
  });

  it("keeps the same key set across locales so a switch never drops copy", async () => {
    await initI18n();
    for (const locale of SUPPORTED_LOCALES) {
      await setLocale(locale);
      for (const key of ["titleBar.new", "titleBar.save", "sidebar.recent", "statusBar.ready"]) {
        expect(t(key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });
});
