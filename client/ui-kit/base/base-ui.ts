import { html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { deep } from "signal-utils/deep";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { GlobalStyledLitElement } from "./gsle.ts";

/** Одне повідомлення з конверта відповіді сервера. */
export interface Message {
  type?: "info" | "warn" | "error";
  text?: string;
}

/** Стандартний конверт відповіді: `{ ok, data, messages }`. */
export interface Envelope<D = Record<string, unknown>> {
  ok: boolean;
  data?: D;
  messages?: Message[];
}

/**
 * Базовий клас UI-компонента моделі.
 *
 * Ідея: `$root` — це типізоване **дзеркало схеми моделі**, а не «мішок даних».
 *  - ініціалізується через `Value.Create(schema)` (з урахуванням `default`),
 *    тож поля існують ще до першого рендеру — жодних `undefined`;
 *  - реактивний завдяки `deep()` (Proxy: реагує на будь-який ключ і вкладеність)
 *    у парі з `SignalWatcher` — читання в `render()` трекаються, запис перемальовує.
 *
 * Транспорт — шина (`data.load` / `data.save`), конверт `{ ok, data, messages }`.
 * `$root` тримає лише дані моделі; транзієнтний UI-стан (`running`, `messages`) —
 * окремо, у Lit `@state`.
 *
 * Підклас зобов'язаний задати `model` і передати схему в `super(...)`.
 */
export abstract class BaseUI<T extends Record<string, unknown>>
  extends SignalWatcher(GlobalStyledLitElement) {

  /** Локалізатор — доступний у render підкласу: `this.t("common.save")`. */
  protected t = t;

  /** Ім'я моделі, напр. `"bank"`. */
  protected abstract readonly model: string;

  /**
   * Ключ основної сутності у `data` — для edit-форм зазвичай `"item"`.
   * Якщо заданий, `loadInto()` вміє відрізнити «запис не знайдено» від
   * «нова порожня форма»: обидва стани виглядають однаково (бо `$root`
   * засіяний зі схеми), але зберігати другий можна, а перший — ні.
   * `null` — перевірка вимкнена (списки, пікери).
   */
  protected primaryKey: string | null = null;

  /** Реактивний контейнер даних форми (побудований зі схеми). */
  protected $root: T;

  /** Запит пройшов, але основної сутності немає — запис видалено/невалідний id. */
  @state() protected notFound = false;

  /** Ім'я команди, що зараз виконується (`null` — простій). Транзієнтний UI-стан. */
  @state() protected running: string | null = null;

  /** Повідомлення з останньої відповіді сервера. Транзієнтний UI-стан. */
  @state() protected messages: Message[] = [];

  /** Чи є команда в польоті. */
  protected get busy(): boolean {
    return this.running !== null;
  }

  constructor(schema: TSchema) {
    super();
    // Value.Create будує валідне значення зі схеми; deep робить його реактивним.
    this.$root = deep(Value.Create(schema) as T);
  }

  /**
   * Виклик команди моделі через шину. Розгортає конверт,
   * наповнює `messages`, керує `running`.
   * @param kind — `"save"` додатково емітить `model.changed` (через data-service).
   */
  protected async run<D = Record<string, unknown>>(
    command: string,
    payload: unknown,
    kind: "load" | "save" = "load",
  ): Promise<Envelope<D>> {
    this.running = command;
    try {
      const env = (await bus.request(
        kind === "save" ? "data.save" : "data.load",
        { model: this.model, command, payload },
      )) as Envelope<D> | undefined;
      this.messages = env?.messages ?? [];
      return env ?? { ok: false };
    } finally {
      this.running = null;
    }
  }

  /**
   * Завантажити дані командою і злити їх у `$root`.
   *
   * Повертає `true`, якщо дані застосовано. Якщо оголошено `primaryKey` і
   * сервер повернув по ньому `null` — це «не знайдено»: злиття не робиться,
   * `$root` лишається засіяним зі схеми, вмикається `notFound`. Так
   * «видалений запис» перестає виглядати як «нова порожня форма».
   */
  protected async loadInto(command: string, payload: unknown): Promise<boolean> {
    this.notFound = false;
    const env = await this.run<Partial<T>>(command, payload);
    if (!env.ok || !env.data) return false;
    if (this.primaryKey && (env.data as Record<string, unknown>)[this.primaryKey] == null) {
      this.notFound = true;
      return false;
    }
    this.assign(env.data);
    return true;
  }

  /**
   * Злиття `data` з відповіді SQL у реактивний `$root` — тільки ключі, що
   * прийшли (partial merge). Модельні поля (`item`, `rows`, `totals`…) і
   * службові (`$query`) зеркаляться однаково; чого сервер не повернув —
   * лишається як є (напр. клієнтський `$query`, якщо БД його не віддала).
   *
   * `null`/`undefined` верхнього рівня ІГНОРУЮТЬСЯ. Конверт SQL завжди несе
   * повний набір ключів (`item`, `rows`, `options`, `totals`, `extra`) і кладе
   * `null` у ті, що не стосуються команди: `list` віддає `item: null`, `get` —
   * `rows: []`. Тому `null` тут означає «даних немає», а не «очистити»:
   * інакше `get` неіснуючого запису затер би засіяний зі схеми `$root.item`
   * і рендер впав би. Значуще очищення приходить УСЕРЕДИНІ об'єкта
   * (напр. `item.counterparty = null`), а не верхнім ключем.
   *
   * Завдяки цьому формам не треба писати захист у кожному `load()`.
   */
  protected assign(patch: Partial<T>): void {
    for (const key of Object.keys(patch) as (keyof T)[]) {
      const value = patch[key];
      if (value == null) continue;
      this.$root[key] = value as T[keyof T];
    }
  }

  /**
   * Прив'язка текстового інпута до поля вкладеного об'єкта `$root`:
   * `.value=${this.$root.item.code ?? ""} @input=${this.bindTo(this.$root.item, "code")}`.
   * Працює для будь-якого вузла (`$root.item`, `$root.$query`) — deep-проксі
   * робить запис реактивним.
   */
  protected bindTo<O extends Record<string, unknown>>(obj: O, field: keyof O) {
    return (e: Event) => {
      obj[field] = (e.target as HTMLInputElement).value as O[keyof O];
    };
  }

  /**
   * Чи можна зберігати: немає команди в польоті і сутність існує.
   * Не даємо «зберегти» неіснуючий запис — інакше `item.id = null` зі схеми
   * пішов би в `save` і мовчки створив НОВИЙ запис замість помилки.
   */
  protected get canSave(): boolean {
    return !this.busy && !this.notFound;
  }

  /**
   * Спільний банер: «запис не знайдено» + помилки з конверта.
   * Підключається одним рядком у render підкласу: `${this.renderNotice()}`.
   */
  protected renderNotice(): TemplateResult | string {
    const errors = this.messages.filter((m) => m.type === "error" || m.type === "warn");
    if (!this.notFound && errors.length === 0) return "";
    return html`
      <div class="mb-3 flex flex-col gap-2">
        ${this.notFound
          ? html`<div class="alert alert-error py-2 text-sm">${t("common.recordNotFound")}</div>`
          : ""}
        ${errors.map((m) => html`<div class="alert alert-error py-2 text-sm">${m.text}</div>`)}
      </div>
    `;
  }
}
