/**
 * Формат посилання на вкладку — в одному місці, окремо від контролера.
 *
 * Вкладка описується парою `route` + `modelId` — рівно тим, чим вона описана
 * у сховищі (`StoredTab`), тобто з чого її й так уміють відтворити після
 * перезавантаження. Нової сутності посилання не вводить.
 *
 * Адреса звичайна, без `#`: `/catalog/currency/edit/2`. Це можливо, бо
 * застосунок уже віддає `index.html` на будь-який GET не з `/api`, у якого в
 * останньому сегменті немає точки (`app/server.ts`); Vite у деві робить те
 * саме. **Звідси й вимога до розгортання:** такий самий фолбек має бути й на
 * зворотному проксі, інакше посилання ззовні впаде в 404.
 *
 * Застосунок живе в корені (`base` у пресеті Vite не переозначено), тому шлях
 * будується від origin.
 *
 * Модуль без DOM навмисно — щоб формат перевірявся пробами (`tab-url_test.ts`),
 * а не очима в браузері.
 */

/** Скільки сегментів у маршруті в'ю: `family/model/view` (див. resolveChunk). */
const ROUTE_SEGMENTS = 3;

/** Посилання на вкладку: `<origin>/catalog/bank/edit/5`. */
export function buildTabUrl(origin: string, route: string, modelId: string | null): string {
  const path = modelId ? `${route}/${modelId}` : route;
  return `${origin.replace(/\/$/, "")}/${path}`;
}

/**
 * Розбір шляху назад у вкладку. `null` — адреса вкладки не називає: корінь
 * застосунку або обрізаний маршрут. Мовчазна відмова тут доречна: на цей шлях
 * застосунок міг потрапити й не за нашим посиланням.
 */
export function parseTabPath(pathname: string): { route: string; modelId: string | null } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < ROUTE_SEGMENTS) return null;
  return {
    route: parts.slice(0, ROUTE_SEGMENTS).join("/"),
    // Зайві сегменти відкидаємо: id — один, а решта означала б інший формат,
    // якого ми не розуміємо, і краще відкрити список, ніж вгадувати.
    modelId: parts[ROUTE_SEGMENTS] ?? null,
  };
}
