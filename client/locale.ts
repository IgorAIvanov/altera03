import { Signal } from "signal-polyfill";
import { CLIENT_LOCALES } from "./_locales.generated.ts";

export type Locale = "uk" | "en";

const _locale = new Signal.State<Locale>("uk");
const _translations = new Map<string, string>();

/**
 * Рядки фреймворку вбудовані (`_locales.generated.ts`), рядки застосунку
 * вантажаться по HTTP. Асиметрія навмисна: у встановленому застосунку локалі
 * фреймворку копіювати нізвідки — з JSR приїжджають лише модулі, а `.json` у
 * пакеті для потребувача недосяжний. Заразом зникає мережевий запит, без якого
 * інтерфейс до першої відповіді показував ключі замість тексту.
 *
 * Порядок важливий: застосунок накладається поверх, тож може перевизначити
 * будь-який рядок фреймворку.
 */
async function loadLocale(locale: Locale) {
  _translations.clear();

  for (const [k, v] of Object.entries(CLIENT_LOCALES[locale] ?? {})) {
    _translations.set(k, v);
  }

  try {
    const appStrings = await fetch(`/locales/app/${locale}.json`).then((r) => r.json());
    for (const [k, v] of Object.entries<string>(appStrings)) {
      _translations.set(k, v);
    }
  } catch {
    // Застосунок без власних локалей — не помилка.
  }
}

export const getLocale = (): Locale => _locale.get();

export const setLocale = async (locale: Locale): Promise<void> => {
  await loadLocale(locale);
  _locale.set(locale);
};

export const t = (key: string): string => _translations.get(key) ?? key;
