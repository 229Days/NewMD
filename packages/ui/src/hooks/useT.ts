import { t as translate, useSettings } from "@newmd/core";

/**
 * The copy function, subscribed to the active locale.
 *
 * i18next has no React binding in this project, so core's `t` on its own would
 * keep rendering the old language after a switch: changing the locale writes
 * store state, and only components that read that state re-render. This hook is
 * both halves at once — it hands back `t` and subscribes the caller.
 *
 * It is deliberately the only way for `.tsx` code to get `t`, so forgetting the
 * subscription is a compile error rather than a silent stale screen.
 */
export function useT(): typeof translate {
  useSettings((s) => s.settings.locale);
  return translate;
}
