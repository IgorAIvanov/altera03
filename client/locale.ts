import { Signal } from "signal-polyfill";
import { CLIENT_LOCALES } from "./_locales.generated.ts";

/**
 * Код мови — вільний рядок, а не перелік.
 *
 * Доти тут стояло `"uk" | "en"`, і це вирішувало за застосунок, якими мовами
 * він має право говорити: додати польську означало б випустити нову версію
 * пакета. Механізм злиття до списку не прив'язаний узагалі — прив'язаний був
 * лише тип, тобто обмеження було чисто декларативним.
 *
 * Ціна вільного рядка одна: значення доїжджає до `Intl.DateTimeFormat`, а той
 * на некоректній мовній мітці кидає `RangeError`. Тому `setLocale` мітку
 * перевіряє — див. нижче.
 */
export type Locale = string;

/**
 * Мова, на яку відкочуються ключі, відсутні в обраній.
 *
 * Англійська, бо саме її фреймворк несе повністю й саме її читає будь-який
 * розробник. Це не «мова за замовчуванням» (нею лишається та, що в
 * `localStorage` застосунку) — це останній рубіж перед тим, як на кнопці
 * з'явиться `common.save`.
 */
export const FALLBACK_LOCALE = "en";

const _locale = new Signal.State<Locale>("uk");
const _translations = new Map<string, string>();

/**
 * Порядок накладання мов: спершу запасна, потім обрана.
 *
 * Чиста функція без DOM і мережі — саме тому, що помилка тут не падає, а тихо
 * дає не ту мову; такі речі в цьому пакеті перевіряються пробами.
 */
export function localeChain(locale: Locale, fallback: Locale | null = FALLBACK_LOCALE): Locale[] {
  if (!fallback || fallback === locale) return [locale];
  return [fallback, locale];
}

/** Чи можна віддати цю мітку в `Intl`. */
export function isValidLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length > 0;
  } catch {
    return false;
  }
}

/**
 * Рядки застосунку для однієї мови. Немає файлу — не помилка: застосунок може
 * не мати власних локалей узагалі, а в неповному перекладі бракує саме тієї
 * мови, заради якої запасна й потрібна.
 */
async function fetchAppStrings(locale: Locale): Promise<Record<string, string>> {
  try {
    const response = await fetch(`/locales/app/${locale}.json`);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * Рядки фреймворку вбудовані (`_locales.generated.ts`), рядки застосунку
 * вантажаться по HTTP. Асиметрія навмисна: у встановленому застосунку локалі
 * фреймворку копіювати нізвідки — з JSR приїжджають лише модулі, а `.json` у
 * пакеті для потребувача недосяжний. Заразом зникає мережевий запит, без якого
 * інтерфейс до першої відповіді показував ключі замість тексту.
 *
 * Порядок накладання — по мовах ланцюжка, всередині кожної спершу фреймворк,
 * потім застосунок. Тобто застосунок може перевизначити будь-який рядок
 * фреймворку (як і раніше), але **мова сильніша за перевизначення**: якщо
 * фреймворк знає обрану мову, а застосунок переклав цей рядок лише запасною,
 * виграє фреймворк. Інакше при неповному перекладі застосунку в польському
 * інтерфейсі проступали б англійські кнопки там, де польський текст є.
 *
 * Файли застосунку тягнуться паралельно: запасна мова не має коштувати другої
 * затримки на старті — саме перед цим запитом застосунок і чекає.
 */
async function loadLocale(locale: Locale, fallback: Locale | null): Promise<void> {
  const chain = localeChain(locale, fallback);
  const appLayers = await Promise.all(chain.map(fetchAppStrings));

  _translations.clear();
  chain.forEach((code, index) => {
    for (const [key, value] of Object.entries(CLIENT_LOCALES[code] ?? {})) {
      _translations.set(key, value);
    }
    for (const [key, value] of Object.entries(appLayers[index])) {
      _translations.set(key, value);
    }
  });
}

export const getLocale = (): Locale => _locale.get();

/**
 * Мови, які фреймворк несе своїми силами. Застосунок додає власні, поклавши
 * `<код>.json` у `_locales/` — оголошувати їх фреймворку не треба.
 */
export const frameworkLocales = (): Locale[] => Object.keys(CLIENT_LOCALES).sort();

let _available: Locale[] | null = null;

/**
 * Мови, які має сенс пропонувати користувачеві.
 *
 * Це мови ЗАСТОСУНКУ (`/locales/app/_index.json`, який складає
 * `deno task locales:build`), а не об'єднання з мовами фреймворку. Об'єднання
 * виглядає щедрішим і хибне по суті: у мові, якої застосунок не переклав,
 * користувач отримає англійські назви документів і рахунків при перекладених
 * кнопках — тобто інтерфейс, який гірший за обидві мови окремо. Пропонувати
 * варто те, що справді перекладене.
 *
 * Переліку немає (старий застосунок, збірка без `locales:build`) — лишаються
 * мови фреймворку: краще дві, ніж жодної.
 *
 * Читається на вимогу й запам'ятовується: список потрібен лише тому, хто
 * відкрив перемикач мови, і платити за нього запитом на старті не варто.
 */
export async function availableLocales(): Promise<Locale[]> {
  if (_available) return _available;

  try {
    const response = await fetch("/locales/app/_index.json");
    if (response.ok) {
      const index = await response.json() as { locales?: unknown };
      const codes = Array.isArray(index.locales) ? index.locales.filter((c) => typeof c === "string") : [];
      if (codes.length) return _available = (codes as Locale[]).sort();
    }
  } catch {
    // Мережа чи старий застосунок — нижче є на що відкотитися.
  }

  return _available = frameworkLocales();
}

/**
 * Назва мови ЦІЄЮ ЖЕ мовою («Українська», «English», «Polski»).
 *
 * Саме ендонім, а не назва мовою інтерфейсу: перемикач читає той, хто поточної
 * мови може й не знати — «українська» в польському списку йому нічого не
 * скаже. Береться з `Intl`, тож словника вести не треба й новий код працює
 * одразу.
 */
export function localeName(locale: Locale): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
    if (!name || name === locale) return locale.toUpperCase();
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale.toUpperCase();
  }
}

export interface SetLocaleOptions {
  /** Мова, з якої беруться відсутні ключі. `null` — не відкочуватися. */
  fallback?: Locale | null;
}

export const setLocale = async (locale: Locale, options: SetLocaleOptions = {}): Promise<void> => {
  const fallback = options.fallback === undefined ? FALLBACK_LOCALE : options.fallback;

  // Мітка приїжджає зі сховища, тобто ззовні, і зіпсувати її може будь-хто.
  // Валити застосунок через це не варто — але й мовчати не можна: далі вона йде
  // в `Intl`, де дасть `RangeError` десь у календарі, за півсотні кадрів звідси.
  if (!isValidLocale(locale)) {
    console.warn(`[locale] некоректний код мови «${locale}» — беремо ${fallback ?? FALLBACK_LOCALE}`);
    locale = fallback ?? FALLBACK_LOCALE;
  }

  await loadLocale(locale, fallback);
  _locale.set(locale);
};

/** Значення підстановок: усе, що вміє стати рядком. */
export type TranslationParams = Record<string, string | number>;

/**
 * Переклад за ключем, з підстановкою `{name}`.
 *
 * Підстановка іменована, а не позиційна: перекладач переставляє слова, і `{0}`
 * при цьому мовчки міняє зміст. Невідомий ключ повертається як є — саме на
 * цьому тримається маркер сервера (див. `resolveText`) і назви пунктів меню,
 * куди адміністратор міг вписати власний текст.
 */
export const t = (key: string, params?: TranslationParams): string => {
  const text = _translations.get(key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
};

/**
 * Маркер перекладу в даних, що приїхали з сервера: `@[ключ]` або
 * `@[ключ]{"параметр":"значення"}`.
 *
 * Сервер тексту НЕ перекладає й не може: мову користувача він не знає — вона
 * лежить у сховищі браузера. Тому він текст **називає**, а розгортає його
 * клієнт. Це стосується і повідомлень (`messages[].text`), і назв у самих даних
 * (пункти меню).
 *
 * Хвіст — JSON, а не `|ключ=значення`: у підстановки їде назва рахунку чи
 * субконто, тобто довільний текст користувача, і роздільник у ньому рано чи
 * пізно трапиться. `jsonb_build_object(...)::text` у plpgsql пишеться так само
 * коротко, а зламатися не може.
 *
 * Рядок без маркера повертається недоторканим — і це головне: маркер відрізняє
 * текст, призначений користувачеві, від діагностики для розробника, яку
 * перекладати не треба взагалі.
 */
export function resolveText(text: string): string {
  if (typeof text !== "string" || !text.startsWith("@[")) return text;

  const end = text.indexOf("]");
  if (end < 0) return text;

  const key = text.slice(2, end);
  const tail = text.slice(end + 1).trim();
  if (!tail) return t(key);

  try {
    return t(key, JSON.parse(tail) as TranslationParams);
  } catch {
    // Хвіст є, але не JSON — показуємо хоч переклад ключа, не сирий маркер.
    return t(key);
  }
}
