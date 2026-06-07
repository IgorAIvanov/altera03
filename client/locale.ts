import { Signal } from "signal-polyfill";

export type Locale = "uk" | "en";

const _locale = new Signal.State<Locale>("uk");
const _translations = new Map<string, string>();

async function loadLocale(locale: Locale) {
  _translations.clear();
  const results = await Promise.allSettled([
    fetch(`/locales/client/${locale}.json`).then((r) => r.json()),
    fetch(`/locales/app/${locale}.json`).then((r) => r.json()),
  ]);

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const [k, v] of Object.entries<string>(result.value)) {
        _translations.set(k, v);
      }
    }
  }
}

export const getLocale = (): Locale => _locale.get();

export const setLocale = async (locale: Locale): Promise<void> => {
  await loadLocale(locale);
  _locale.set(locale);
};

export const t = (key: string): string => _translations.get(key) ?? key;
