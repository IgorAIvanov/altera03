import { Signal } from "signal-polyfill";
import { readUserScoped, writeUserScoped, removeUserScoped } from "@client/shared/user-storage.ts";
import { bus } from "@client/bus/bus.ts";

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

// ── Перелік організацій ──────────────────────────────────────────────────────
//
// Живе тут, а не в шапці, з двох причин. Перша: його питає не лише меню вибору
// — фреймворк бере з нього рішення, показувати відбір за організацією в журналі
// документів чи мовчати (одна організація — механізму немає). Друга: у шапці
// він перечитувався на КОЖНЕ відкриття меню, а перелік організацій міняється
// приблизно ніколи.

const _orgs = new Signal.State<OrgRef[]>([]);
const _orgsError = new Signal.State<string>("");

/** Відомі організації (реактивно). Порожньо — ще не завантажено або відмова. */
export function knownOrgs(): OrgRef[] {
  return _orgs.get();
}

/** Текст відмови завантаження — шапка показує його замість порожнього меню. */
export function orgsError(): string {
  return _orgsError.get();
}

/**
 * Завантажити перелік. Кличеться в composition root після відновлення сесії;
 * повторний виклик (наприклад після заведення нової організації) припустимий.
 *
 * Обов'язково шиною, а не власним `fetch`: заголовок `X-Requested-With`, без
 * якого сервер відкидає POST із cookie (захист від CSRF), ставить лише
 * `apiFetch`. Голий `fetch` тут колись повертав 401, а гілка `?? []` мовчки
 * давала порожній масив — список організацій виглядав просто порожнім.
 */
export async function loadOrgs(): Promise<void> {
  _orgsError.set("");
  try {
    // `pageSize`, а не `limit`: саме це ім'я читає `app.organization_lookup`.
    // З `limit` payload мовчки ігнорувався, і перелік обрізався на десятій
    // організації — при двох наявних це було непомітно.
    const envelope = await bus.request("data.load", {
      model: "organization",
      command: "lookup",
      payload: { pageSize: 100 },
    }) as { data?: { rows?: unknown[] } } | undefined;

    _orgs.set((envelope?.data?.rows ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return { id: String(record.id), name: String(record.name) };
    }));
  } catch (e) {
    console.error("[current-organization] не вдалося завантажити організації:", e);
    _orgs.set([]);
    _orgsError.set(e instanceof Error ? e.message : String(e));
  }
}
