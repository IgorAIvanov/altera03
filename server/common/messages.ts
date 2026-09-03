/**
 * Розгортання маркерів перекладу на боці СЕРВЕРА — рівно там, де їх нема кому
 * розгорнути.
 *
 * Сервер тексту не перекладає, а НАЗИВАЄ його (`@[core.documentNotFound]{…}`),
 * і це правильно для браузера: мова лежить у сховищі клієнта, тож розгортає
 * клієнт (`client/locale.ts`, `resolveText`). Але той самий конверт їде і в
 * канал зовнішнього агента (`POST /api/agent/call`), а там браузера немає
 * взагалі — і туди роками приїжджало внутрішнє ім'я ключа замість речення:
 *
 *     @[core.lookupUnknownFilter]{"model": "report_form_version", "filter": "bogus"}
 *
 * замість «Підбір «report_form_version» не знає відбору «bogus»». Причому
 * значення підстановок їхали, а фрази — ні: губилося саме те, заради чого
 * повідомлення й писали. Ціна конкретна: правила обліку живуть у SQL (в одному
 * прикладному рішенні це кількасот `raise exception '@[…]'`), тобто канал
 * втрачав РІВНО той клас повідомлень, який пояснює, чому документ не
 * проводиться.
 *
 * Межа проходить не по важливості повідомлення, а по тому, кому воно їде:
 * **сервер називає ключ усім, крім того, кому нема кому його розгорнути.**
 * Браузерний канал (`POST /api/model/:model/:command`) маркери отримує й далі —
 * інакше зникла б друга мова.
 *
 * Модуль чистий навмисно: помилка тут не падає, а тихо дає не той текст (або
 * не ту мову), тож він тримається окремо й під пробами — та сама причина, що в
 * `mcp/answer.ts` і `client/ui-kit/split-geometry.ts`.
 */

/** Словники за кодом мови: `{ uk: { "core.x": "…" }, en: {…} }`. */
export type MessageDictionaries = Record<string, Record<string, string>>;

/** Значення підстановок — усе, що вміє стати рядком (як у клієнта). */
export type MessageParams = Record<string, string | number>;

export interface MessagesConfig {
  dictionaries: MessageDictionaries;
  /** Мова, якою говорить агентський канал. */
  locale: string;
  /** Мова, з якої беруться відсутні ключі; `null` — не відкочуватися. */
  fallback: string | null;
}

/** Що вийшло з маркера. `key` лишається й після розгортання — див. нижче. */
export interface ResolvedMessage {
  text: string;
  /**
   * Ключ маркера, якщо текст ним був.
   *
   * Віддається ПОРУЧ із розгорнутим текстом навмисно: ключ — це ідентифікатор
   * правила, і саме за нього чіпляється те, що прийде далі (сказати, де
   * правило налаштоване; знайти його в переліку оголошених обмежень). Гола
   * заміна тексту на текст цю можливість викидає.
   */
  key?: string;
  params?: MessageParams;
}

/** Порядок пошуку ключа: обрана мова сильніша за запасну (як у клієнта). */
export function lookup(
  key: string,
  dictionaries: MessageDictionaries,
  locale: string,
  fallback: string | null,
): string | undefined {
  return dictionaries[locale]?.[key] ??
    (fallback && fallback !== locale ? dictionaries[fallback]?.[key] : undefined);
}

/**
 * Підстановка іменована, а не позиційна — точно як у `t()` клієнта: перекладач
 * переставляє слова, і `{0}` при цьому мовчки міняє зміст. Значення, якого
 * немає, лишається видимим (`{line}`), тобто мовчазним бути не може.
 */
function substitute(text: string, params?: MessageParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Маркер → речення. Рядок без маркера повертається недоторканим: маркер і
 * відрізняє текст, призначений людині, від діагностики для розробника.
 *
 * Ключа немає в словнику — повертається ВИХІДНИЙ маркер, а не голий ключ (чим
 * задовольняється клієнт). Різниця важлива саме для агента: `core.foo` він
 * прочитає як текст і перекаже людині, а `@[core.foo]{…}` видно як несправність
 * — до того ж разом із параметрами, які інакше зникли б.
 */
/**
 * Текст за ключем, без маркера навколо.
 *
 * Потрібен там, де ключ уже відомий сам собою — у переліку оголошених
 * обмежень моделі: там зберігається саме ключ, а рядок береться в рантаймі,
 * тому мова працює тим самим механізмом і перекладу ніде не дублюється.
 */
export function messageText(key: string, config: MessagesConfig): string | undefined {
  return lookup(key, config.dictionaries, config.locale, config.fallback);
}

export function resolveMarker(text: unknown, config: MessagesConfig): ResolvedMessage {
  if (typeof text !== "string" || !text.startsWith("@[")) {
    return { text: typeof text === "string" ? text : String(text ?? "") };
  }

  const end = text.indexOf("]");
  if (end < 0) return { text };

  const key = text.slice(2, end);
  const tail = text.slice(end + 1).trim();

  let params: MessageParams | undefined;
  if (tail) {
    try {
      params = JSON.parse(tail) as MessageParams;
    } catch {
      // Хвіст є, але не JSON — беремо хоч переклад ключа, як і клієнт.
    }
  }

  const template = lookup(key, config.dictionaries, config.locale, config.fallback);
  if (template === undefined) return { text, key, params };

  return { text: substitute(template, params), key, params };
}

/**
 * Один елемент `messages` конверта. Форма зберігається: рядок лишається
 * рядком, об'єкт — об'єктом із тими самими полями плюс `key`.
 *
 * Це не косметика: `messages[].field` підсвічує поле на формі, а споживачі
 * каналу (обгортка MCP, чужі скрипти) уже вміють читати обидві форми. Заміна
 * однієї на іншу зламала б їх мовчки.
 */
export function resolveMessage(message: unknown, config: MessagesConfig): unknown {
  if (typeof message === "string") return resolveMarker(message, config).text;

  if (message && typeof message === "object") {
    const record = message as Record<string, unknown>;
    if (typeof record.text !== "string") return message;

    const resolved = resolveMarker(record.text, config);
    return resolved.key
      ? { ...record, text: resolved.text, key: resolved.key }
      : { ...record, text: resolved.text };
  }

  return message;
}

/** Усі повідомлення конверта. Не масив — порожній масив, а не падіння. */
export function resolveMessages(messages: unknown, config: MessagesConfig): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => resolveMessage(message, config));
}

/**
 * Злити словники в один: пізніший перекриває раніший, ключ за ключем.
 *
 * Порядок той самий, що в клієнта: спершу фреймворк, потім застосунок — тобто
 * застосунок може перевизначити будь-який рядок ядра. Мови не змішуються:
 * злиття йде всередині кожного коду окремо, тож англійський словник не
 * підмінить українського ключа.
 */
export function mergeMessageDictionaries(
  ...sources: MessageDictionaries[]
): MessageDictionaries {
  const merged: MessageDictionaries = {};
  for (const source of sources) {
    for (const [locale, strings] of Object.entries(source ?? {})) {
      merged[locale] = { ...merged[locale], ...strings };
    }
  }
  return merged;
}
