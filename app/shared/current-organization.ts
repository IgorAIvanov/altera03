import { Signal } from "signal-polyfill";
import { readUserScoped, writeUserScoped, removeUserScoped } from "@client/shared/user-storage.ts";

/**
 * Поточна організація застосунку — наскрізний контекст, який:
 *  - показується у верхній панелі (`app-header`) і змінюється звідти;
 *  - за замовчуванням підставляється у фільтр звітів і в нові документи;
 *  - переживає перезавантаження й новий вхід (як відкриті вкладки —
 *    зберігається в localStorage, окремо для кожного користувача).
 *
 * Реактивність — через `signal-polyfill` (та сама механіка, що в `locale.ts`):
 * компоненти-`SignalWatcher` перемальовуються, коли організація змінюється.
 */

export interface OrgRef {
  id: string;
  name: string;
}

const STORAGE_KEY = "altera.current-organization";

function parse(value: unknown): OrgRef | null {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.name === "string") {
      return { id: record.id, name: record.name };
    }
  }
  return null;
}

const _current = new Signal.State<OrgRef | null>(null);

/**
 * Прочитати збережену організацію поточного користувача.
 *
 * Окремий виклик, а не читання при завантаженні модуля, бо ключ сховища тепер
 * залежить від користувача, а модуль імпортується задовго до входу — на той
 * момент читати не було б з чого. Місце виклику одне: composition root
 * застосунку, одразу після того, як сесія відновилася (`app/main.ts`).
 */
export function hydrateCurrentOrg(): void {
  _current.set(parse(readUserScoped(STORAGE_KEY)));
}

/** Поточна організація (реактивно) або `null`, якщо ще не обрана. */
export function currentOrg(): OrgRef | null {
  return _current.get();
}

/** Задати поточну організацію й зберегти її у сховищі. `null` — скинути. */
export function setCurrentOrg(org: OrgRef | null): void {
  _current.set(org);
  if (org) writeUserScoped(STORAGE_KEY, org);
  else removeUserScoped(STORAGE_KEY);
}
