/**
 * i18n (ADR-0001 §2.11): i18next, 中文优先, 全部文案外置.
 *
 * Chinese is not just the default — it is the fallback. An English resource
 * that is missing a key renders the Chinese copy rather than a raw key, so an
 * incomplete translation degrades to a language the target user reads instead
 * of to developer jargon.
 */
import i18next, { type i18n as I18nInstance } from "i18next";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import { DEFAULT_SETTINGS, type Locale } from "./types";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en-US"];

const FALLBACK_LOCALE: Locale = "zh-CN";

let instance: I18nInstance | null = null;

/** Test-only: drop the instance so each test starts from a clean init. */
export function resetI18n(): void {
  instance = null;
}

/** Escape hatch for tests that need i18next's own resource APIs. */
export function getI18n(): I18nInstance {
  if (!instance) throw new Error("initI18n() must run before getI18n()");
  return instance;
}

function isSupported(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Bring the i18n instance up in `locale`. Safe to call twice. */
export async function initI18n(locale: Locale = DEFAULT_SETTINGS.locale): Promise<void> {
  if (instance) {
    await instance.changeLanguage(locale);
    return;
  }
  instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
    // Copy is authored HTML-free and rendered as text, so escaping would
    // turn a legitimate `'` or `«` into an entity.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

/** Switch the active language. Initialises first if needed. */
export async function setLocale(locale: Locale): Promise<void> {
  if (!instance) {
    await initI18n(locale);
    return;
  }
  await instance.changeLanguage(locale);
}

export function getLocale(): Locale {
  const current = instance?.resolvedLanguage ?? instance?.language;
  return current && isSupported(current) ? current : DEFAULT_SETTINGS.locale;
}

/**
 * Resolve one piece of copy. Returns the key itself when nothing knows it, so
 * a typo shows up in the UI as a readable breadcrumb instead of blank space.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  if (!instance) return key;
  return instance.t(key, params);
}
