/**
 * Яким конверт бази доїжджає до агента.
 *
 * Модуль чистий навмисно: тут вирішується, що саме осяде в контексті розмови, і
 * помилка в цьому місці не падає, а тихо коштує грошей — щоразу, коли до
 * повідомлення повертаються. Такі місця в репозиторії тримаються окремо й під
 * пробами (та сама причина, що в `split-geometry.ts` на боці ui-kit).
 *
 * Правило одне: РІЗАТИ ЕХО, НЕ РІЗАТИ ВІДПОВІДЬ НА ПИТАННЯ. `save` і `post`
 * повертають той самий документ, який агент щойно надіслав, — усю табличну
 * частину, усі поля, вдруге й утретє. `list`, `get` та `index` повертають те,
 * заради чого їх і кликали, і вкорочувати їх означало б вкорочувати саму
 * роботу.
 */

/** Команди, чия відповідь — ехо надісланого, а не відповідь на питання. */
const ECHOING_COMMANDS = new Set([
  "save",
  "post",
  "unpost",
  "delete",
  "undelete",
]);

export function isEchoingCommand(command: string): boolean {
  return ECHOING_COMMANDS.has(command);
}

/** `result.data` конверта агента — або `null`, якщо його там немає. */
function commandData(answer: unknown): Record<string, unknown> | null {
  const data = (answer as { result?: { data?: unknown } } | null)?.result?.data;
  return data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
}

/**
 * Відповідь команди без вбудованих байтів.
 *
 * `printPdf` можна покликати й через `altera_call` — він оголошений моделі як
 * звичайна команда, — і тоді ста́ла б у контекст уся друкована форма в base64:
 * сотня-друга кілобайтів, які агент навіть не може ні відкрити, ні зберегти.
 * Тому байти звідси зрізаються, а на їхньому місці лишається вказівка на
 * інструмент, який зробить те, чого агент насправді хотів.
 */
export function withoutInlineBytes(answer: unknown): unknown {
  const extra = commandData(answer)?.extra as
    | Record<string, unknown>
    | undefined;

  if (extra && typeof extra.pdfBase64 === "string") {
    extra.pdfBase64 = "⟨PDF вирізано: щоб отримати файл, поклич altera_print⟩";
  }
  return answer;
}

/**
 * Скаляри лишити, вкладене — зрізати.
 *
 * Межа саме за формою значення, а не за переліком полів: перелік знав би склад
 * конкретного застосунку, а обгортка працює з будь-яким. Заразом він і не
 * потрібен — вага сидить у вкладеному: шапка документа це десяток скалярів на
 * пів кілобайта, а табличної частини на вісім рядків — кілька кілобайтів.
 */
function condenseRecord(
  record: Record<string, unknown>,
): { value: Record<string, unknown>; cut: number } {
  const value: Record<string, unknown> = {};
  let cut = 0;

  for (const [key, item] of Object.entries(record)) {
    if (item === null || typeof item !== "object") {
      value[key] = item;
      continue;
    }
    cut++;
    value[key] = Array.isArray(item)
      ? `⟨вирізано рядків: ${item.length}⟩`
      : "⟨вирізано вкладений об'єкт⟩";
  }

  return { value, cut };
}

/**
 * Стислий вигляд відповіді-ехо: `item` без вкладеного.
 *
 * Повертає `true`, якщо щось справді зрізали, — щоб приписка про `verbose`
 * з'являлася лише там, де є про що казати. `delete`, який віддає самий лише
 * `id`, приписки не заслуговує: вона була б шумом рівно там, де шуму й так
 * немає.
 */
export function condense(answer: unknown): boolean {
  const data = commandData(answer);
  const item = data?.item;
  if (!data || !item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  const { value, cut } = condenseRecord(item as Record<string, unknown>);
  if (cut === 0) return false;

  data.item = value;
  return true;
}

/** Приписка, без якої зрізане виглядало б як відсутнє. */
export const CONDENSED_NOTE =
  "Відповідь стисла: у ній лишилися лише прості поля запису. " +
  'Потрібен документ цілком — повтори виклик із "verbose": true.';

/**
 * Звуження каталогу моделей.
 *
 * Каталог приїжджає з бази цілим — інакше `GET /api/agent/tools` не вміє, — але
 * в КОНТЕКСТ має лягати те, про що питали. Різниця не теоретична: рішення на
 * півтори сотні моделей це десятки кілобайтів у кожній розмові, де агенту
 * потрібні три довідники.
 *
 * Збіг шукається за технічним іменем, назвами всіма мовами й синонімами —
 * тобто рівно за тим, чим модель називають люди: агент приходить зі словом
 * «контрагент», а не з іменем `counterparty`.
 */
export interface CatalogEntry {
  model: string;
  type?: string;
  titles?: Record<string, string>;
  aliases?: string[];
}

export function filterModels<T extends CatalogEntry>(
  rows: T[],
  query: string | undefined,
  types: string[],
): T[] {
  const needle = query?.trim().toLowerCase() ?? "";
  const wanted = new Set(
    types.map((type) => type.trim().toLowerCase()).filter(Boolean),
  );
  if (!needle && wanted.size === 0) return rows;

  return rows.filter((row) => {
    if (wanted.size && !wanted.has((row.type ?? "").toLowerCase())) {
      return false;
    }
    if (!needle) return true;

    const words = [
      row.model,
      ...Object.values(row.titles ?? {}),
      ...(row.aliases ?? []),
    ];
    return words.some((word) =>
      typeof word === "string" && word.toLowerCase().includes(needle)
    );
  });
}

/**
 * Посилання на вкладку — абсолютне, бо агент бази не бачить.
 *
 * Сервер віддає ШЛЯХ (`/catalog/bank/edit/5`), і правильно робить: свого
 * публічного адреса він не знає — `AUTH_PUBLIC_BASE_URL` за умовчанням
 * порожній. Знає його обгортка, і тільки вона: `ALTERA_URL` живе в оточенні ЇЇ
 * процесу, а оточення в контекст розмови не потрапляє ніколи. Тому склеїти дві
 * половинки може лише це місце — агент, до якого доїхав самий шлях, чесно дає
 * людині «/catalog/bank/edit/5», і клікнути там нема по чому.
 *
 * Замінюємо НА МІСЦІ, а не додаємо друге поле поруч: друге поле це і зайві
 * байти в кожній відповіді, і вибір, у якому агент помилятиметься.
 */
export function absoluteRoute(origin: string, route: string): string {
  // Абсолютне лишаємо як є: якщо база колись почне віддавати повну адресу —
  // свою, з `AUTH_PUBLIC_BASE_URL`, — вона знає її точніше за нас.
  if (/^https?:\/\//i.test(route)) return route;
  return `${origin}${route.startsWith("/") ? "" : "/"}${route}`;
}

/** Те саме у відповіді команди: посилання лежить у `result.route`. */
export function absolutizeAnswer(answer: unknown, origin: string): unknown {
  const result = (answer as { result?: Record<string, unknown> } | null)?.result;
  if (result && typeof result.route === "string") {
    result.route = absoluteRoute(origin, result.route);
  }
  return answer;
}

/**
 * Те саме в каталозі: `route` кожного рядка — маршрут списку моделі.
 *
 * Каталог теж носить посилання, і саме ним агент відповідає на «де подивитися
 * банки», нічого не викликаючи. Дописувати після звуження, а не до: платимо за
 * те, що лягає в контекст, а не за те, що приїхало з бази.
 */
export function absolutizeCatalog<T extends { route?: string }>(
  rows: T[],
  origin: string,
): T[] {
  return rows.map((row) =>
    typeof row.route === "string"
      ? { ...row, route: absoluteRoute(origin, row.route) }
      : row
  );
}
