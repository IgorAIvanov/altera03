import { html, type PropertyValues, type TemplateResult } from "lit";
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

/**
 * Стандартний конверт відповіді: `{ ok, data, messages }`.
 *
 * `messages` приходить у двох виглядах: SQL-функції віддають об'єкти
 * `{ type, text }`, а обробник помилок бекенду — просто рядок з тексту
 * винятку. Нормалізує `normalizeMessages()`, тому UI бачить один формат.
 */
export interface Envelope<D = Record<string, unknown>> {
  ok: boolean;
  data?: D;
  messages?: (Message | string)[];
}

/**
 * Рядок → повідомлення. Голий рядок з'являється лише коли команда впала
 * (див. modelError у model-runtime.controller.ts), тому це помилка.
 */
function normalizeMessages(raw: (Message | string)[] | undefined, ok: boolean): Message[] {
  return (raw ?? []).map((m) =>
    typeof m === "string" ? { type: ok ? "info" as const : "error" as const, text: m } : m
  );
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
/**
 * Базовий клас винесений у константу з явним типом навмисно: виклик міксина
 * прямо в `extends` JSR розібрати не може («super class expression was too
 * complex») і публікує пакет повільними типами. `SignalWatcher<T>(Base: T): T`
 * повертає той самий тип, тому анотація точна, а не звужена.
 */
const SignalWatchingElement: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export abstract class BaseUI<T extends Record<string, unknown>>
  extends SignalWatchingElement {

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

  /**
   * Id власної вкладки — проставляє tab-controller при створенні елемента.
   * Потрібен, щоб форма могла закрити саму себе (`closeSelf`).
   */
  tabId: string | null = null;

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

  /** Схема `$root` — потрібна вже після конструктора, щоб знати обов'язкові поля. */
  private rootSchema?: TSchema & { properties?: Record<string, unknown> };

  constructor(schema: TSchema) {
    super();
    // Value.Create будує валідне значення зі схеми; deep робить його реактивним.
    this.$root = deep(Value.Create(schema) as T);
    this.rootSchema = schema as TSchema & { properties?: Record<string, unknown> };
  }

  // ── Незбережені зміни (dirty) ──────────────────────────────────────────────

  /**
   * Трекінг незбережених змін. Вимкнений у списках/пікерах/звітах: їх `$root`
   * міняється кожним завантаженням, а зберігати там нічого.
   */
  protected dirtyTracking = true;

  /** Знімок «чистих» даних; null — ще не знято (до першого рендера). */
  #cleanSnapshot: string | null = null;

  /** Дані `$root` без службових `$`-ключів ($query — не дані форми). */
  #dataSnapshot(): string {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(this.$root)) {
      if (key.startsWith("$")) continue;
      data[key] = (this.$root as Record<string, unknown>)[key];
    }
    return JSON.stringify(data);
  }

  /**
   * Зафіксувати поточний стан як «чистий». База кличе це сама після першого
   * рендера, `loadInto` і `saveItem`; форма, що НОРМАЛІЗУЄ дані після цих
   * викликів (десяткові в табличній частині), мусить покликати ще раз після
   * нормалізації — інакше форма виглядатиме зміненою одразу після відкриття.
   */
  protected markClean() {
    this.#cleanSnapshot = this.dirtyTracking ? this.#dataSnapshot() : null;
    this.#notifyDirty();
  }

  /** Останнє повідомлене значення — шоб не спамити шину кожним рендером. */
  #lastDirtyNotified = false;

  /** Повідомити оболонку про зміну dirty-стану — «*» на вкладці. */
  #notifyDirty() {
    if (!this.tabId) return;
    const dirty = this.isDirty;
    if (dirty === this.#lastDirtyNotified) return;
    this.#lastDirtyNotified = dirty;
    bus.emit({ type: "tab.dirty", tabId: this.tabId, dirty });
  }

  /**
   * Чи є незбережені зміни. Публічний (без protected) навмисно: tab-controller
   * питає це в елемента вкладки перед закриттям і LRU-витісненням.
   */
  get isDirty(): boolean {
    if (!this.dirtyTracking || this.#cleanSnapshot === null) return false;
    return this.#dataSnapshot() !== this.#cleanSnapshot;
  }

  protected override firstUpdated(changed: PropertyValues) {
    super.firstUpdated(changed);
    // Після першого рендера синхронні дефолти (applyDefaultOrg тощо) вже
    // застосовані — це і є «чистий» стан нової форми. Асинхронний load()
    // перезніме знімок сам, коли завершиться.
    this.markClean();
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    // Кожен рендер — нагода звірити dirty-стан: введення користувача міняє
    // $root → SignalWatcher перемальовує → сюди. Подія йде лише на ЗМІНІ
    // стану (див. #notifyDirty), а не на кожен символ.
    if (this.dirtyTracking) this.#notifyDirty();
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
      this.messages = normalizeMessages(env?.messages, env?.ok ?? false);
      return env ?? { ok: false };
    } catch (error) {
      // Мережа лягла або бекенд віддав не-200: без цього гілка падала німо —
      // форма просто «нічого не робила» у відповідь на натискання.
      this.messages = [{
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      }];
      return { ok: false };
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
    this.markClean();
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
  protected bindTo<O extends Record<string, unknown>>(obj: O, field: keyof O): (e: Event) => void {
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

  // ── Спільна розкладка форми ────────────────────────────────────────────────

  /**
   * Поле форми: підпис над контролом. Розмітка навмисно та сама, що в
   * `ui-picker` і `ui-date` (`<span class="label text-sm">` + контрол), інакше
   * підписи звичайних інпутів і компонентів ui-kit виглядають по-різному в
   * одній формі.
   *
   * Класу `form-control` тут немає свідомо: у daisyUI 5 його не існує (це
   * клас четвертої версії), і саме він ламав вирівнювання підписів.
   */
  protected renderField(
    label: string,
    control: TemplateResult,
    opts: { class?: string; field?: string; required?: boolean } = {},
  ): TemplateResult {
    // Обов'язковість беремо зі схеми (`field`), а не з окремого прапорця в
    // розмітці: інакше зірочка й реальна перевірка в БД розходяться при першій
    // же зміні схеми.
    const required = opts.required ?? (opts.field ? this.isRequired(opts.field) : false);
    return html`
      <div class="flex flex-col gap-px ${opts.class ?? ""}">
        <span class="label text-sm leading-none">
          ${label}${required ? html`<span class="text-error ml-0.5">*</span>` : ""}
        </span>
        ${control}
      </div>
    `;
  }

  /**
   * Чи є поле основної сутності обов'язковим за схемою. У TypeBox обов'язкове
   * все, що не загорнуте в `Type.Optional`, тож окремих анотацій не треба.
   */
  protected isRequired(field: string): boolean {
    const entity = this.rootSchema?.properties?.[this.primaryKey ?? "item"] as
      | { required?: string[] }
      | undefined;
    return entity?.required?.includes(field) ?? false;
  }

  /**
   * Запис форми. На відміну від «просто run(save)» вливає відповідь у `$root`:
   * новий запис одразу отримує свій `id`, тому повторне збереження оновлює
   * той самий рядок, а не створює дубль.
   *
   * Підклас перевизначає, якщо перед записом треба підготувати дані
   * (нормалізація десяткових у табличній частині тощо).
   */
  protected async saveItem(): Promise<boolean> {
    const key = this.primaryKey ?? "item";
    const env = await this.run<Partial<T>>(
      "save",
      { [key]: (this.$root as Record<string, unknown>)[key] },
      "save",
    );
    if (!env.ok || !env.data) return false;
    this.assign(env.data);
    this.markClean();
    return true;
  }

  /**
   * Параметри відкриття вкладки (`bus.emit({ type: "tab.open", params })`).
   * Викликається ДО вставки в DOM, а для вже відкритої вкладки — повторно.
   *
   * За замовчуванням вливаються в службовий `$query`: цього достатньо звітам
   * і спискам з фільтром. Екран із іншою логікою (наприклад «сформувати
   * одразу після переходу») перевизначає метод.
   */
  applyParams(params: Record<string, unknown>) {
    const query = (this.$root as Record<string, unknown>).$query;
    if (!query || typeof query !== "object") return;
    Object.assign(query as Record<string, unknown>, params);
  }

  /**
   * Публічний виклик збереження — для оболонки: «Зберегти» у діалозі
   * закриття брудної вкладки. Проходить через saveItem(), тож перевизначення
   * форм (нормалізація табличних частин) спрацьовують і тут.
   */
  async save(): Promise<boolean> {
    return await this.saveItem();
  }

  /** Закрити власну вкладку. `tabId` проставляє tab-controller при створенні. */
  protected closeSelf() {
    if (this.tabId) bus.emit({ type: "tab.close", tabId: this.tabId });
  }

  private async saveAndClose() {
    if (await this.saveItem()) this.closeSelf();
  }

  /**
   * Стандартний підвал форми редагування: «Зберегти й закрити» (основна дія),
   * «Зберегти», «Закрити». `extra` — місце для дій конкретного документа
   * (провести, друк).
   */
  protected renderFormActions(extra?: TemplateResult | string): TemplateResult {
    return html`
      <div class="flex gap-2 mt-6">
        <button class="btn btn-primary" ?disabled=${!this.canSave} @click=${this.saveAndClose}>
          ${this.running === "save" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
          ${t("common.saveAndClose")}
        </button>
        <button class="btn btn-outline" ?disabled=${!this.canSave} @click=${this.saveItem}>
          ${t("common.save")}
        </button>
        <button class="btn btn-ghost" ?disabled=${this.busy} @click=${this.closeSelf}>
          ${t("common.close")}
        </button>
        ${extra ?? ""}
      </div>
    `;
  }
}
