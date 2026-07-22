import { Signal } from "signal-polyfill";

/**
 * Поточна організація застосунку — наскрізний контекст, який:
 *  - показується у верхній панелі (`app-header`) і змінюється звідти;
 *  - за замовчуванням підставляється у фільтр звітів і в нові документи;
 *  - переживає перезавантаження й новий вхід (як відкриті вкладки —
 *    зберігається в localStorage).
 *
 * Реактивність — через `signal-polyfill` (та сама механіка, що в `locale.ts`):
 * компоненти-`SignalWatcher` перемальовуються, коли організація змінюється.
 */

export interface OrgRef {
  id: string;
  name: string;
}

const STORAGE_KEY = "altera.current-organization";

function load(): OrgRef | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

const _current = new Signal.State<OrgRef | null>(load());

/** Поточна організація (реактивно) або `null`, якщо ще не обрана. */
export function currentOrg(): OrgRef | null {
  return _current.get();
}

/** Задати поточну організацію й зберегти її у сховищі. `null` — скинути. */
export function setCurrentOrg(org: OrgRef | null): void {
  _current.set(org);
  try {
    if (org) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(org));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // приватний режим / переповнене сховище — не критично для роботи
  }
}
