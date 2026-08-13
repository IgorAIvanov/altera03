import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { deep } from "signal-utils/deep";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { can } from "@client/auth/session.ts";
import { icons } from "../icons.ts";
import { GlobalStyledLitElement } from "./gsle.ts";
import type { PickerValue } from "../components/ui-picker.ts";

/** Одне повідомлення з конверта відповіді сервера. */
export interface Message {
  type?: "info" | "warn" | "error";
  text?: string;
  /**
   * Поле форми, якого стосується помилка (camelCase, як у схемі). Сервер
   * ставить його, коли знає: `raise exception … using column`, not-null або
   * унікальність — див. `postgresErrorField()`. Клієнт підсвічує це поле
   * замість самого лише банера.
   */
  field?: string;
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

// ── Правила полів форми ──────────────────────────────────────────────────────

/**
 * Власна перевірка значення поля. `null`/`undefined` — усе гаразд, рядок —
 * текст помилки (уже локалізований: правило пише сама форма).
 *
 * Порожнього значення НЕ бачить: «формат» незаповненого поля перевіряти нічого,
 * а «має бути заповнене» — це `required`.
 */
export type FieldCheck = (value: unknown) => string | null | undefined;

/**
 * Правило поля. Коротка форма — сама лише обов'язковість:
 * `{ mfo: item.kind === "bank" }`.
 */
export type FieldRule = boolean | { required?: boolean; check?: FieldCheck };

/** Карта правил форми: ім'я поля основної сутності → правило. */
export type FieldRules = Record<string, FieldRule>;

/**
 * Те, що `BaseUI` вимагає від табличної частини, щоб перевіряти її разом із
 * полями шапки. Тип **структурний** навмисно: база не імпортує
 * `TabularSection`, інакше кожен список і пікер тягли б у свій чанк увесь
 * примітив таблиці. `TabularSection` задовольняє його як є.
 */
export interface FormSection {
  /** Перевірити рядки; повертає кількість помилок і лишає їх у собі. */
  validate(): number;
  /** Скільки помилок зараз — база звіряє це при живому перерахунку. */
  readonly errorCount: number;
  /** Повідомлення для банера: «Рядок 3, «Кількість»: …». */
  firstErrorText(): string;
  /** Перша невалідна комірка — база веде туди фокус. */
  firstErrorCell(): { row: number; col: number } | null;
  /** Куди база кладе ціль фокуса (подання споживає її після рендера). */
  pendingFocus: { row: number; col: number } | null;
  /** Перемалювати подання — після того, як база проставила `pendingFocus`. */
  refresh(): void;
}

/**
 * Чи вважати значення незаповненим. `false` і `0` — заповнені: інакше
 * checkbox «ні» і сума «0» рахувалися б порожніми.
 */
function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
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

/** Значення поля основної сутності — для знімка «на чому сервер спіткнувся». */
function entityValue(root: unknown, key: string, field: string): unknown {
  const entity = (root as Record<string, unknown>)?.[key];
  return entity && typeof entity === "object"
    ? (entity as Record<string, unknown>)[field]
    : undefined;
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

  /** Помилки полів: ім'я поля → текст. Транзієнтний UI-стан. */
  @state() protected fieldErrors: Record<string, string> = {};

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

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    // Реєстр полів збирається наново кожним render(): поле, якого форма цього
    // разу не намалювала (схована гілка розмітки), перевірятися не повинно.
    this.#renderedFields.clear();
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    // Кожен рендер — нагода звірити dirty-стан: введення користувача міняє
    // $root → SignalWatcher перемальовує → сюди. Подія йде лише на ЗМІНІ
    // стану (див. #notifyDirty), а не на кожен символ.
    if (this.dirtyTracking) this.#notifyDirty();
    // Реєстр щойно заповнений завершеним render() — саме тут перерахунок
    // помилок бачить актуальний набір полів. До першої перевірки мовчимо.
    if (this.#validationStarted) this.#syncErrors();
  }

  /** Перерахувати помилки після рендеру; @state чіпаємо лише на зміні. */
  #syncErrors() {
    const next = this.#collectErrors();

    // Вердикт сервера гасне, щойно поле змінили: перевірити його наново
    // клієнт не може, а тримати «код уже зайнятий» на вже іншому коді — гірше,
    // ніж не показати нічого. Наступне збереження скаже правду.
    const key = this.primaryKey ?? "item";
    for (const [field, snapshot] of this.#serverErrors) {
      if (entityValue(this.$root, key, field) !== snapshot.value) {
        this.#serverErrors.delete(field);
        continue;
      }
      next[field] = snapshot.text;
    }

    const keys = Object.keys(next);
    const same = keys.length === Object.keys(this.fieldErrors).length
      && keys.every((k) => this.fieldErrors[k] === next[k]);
    if (!same) this.fieldErrors = next;
    // Поля виправили — знімаємо і банер, інакше він висів би до наступного
    // запиту. Чуже повідомлення (відповідь сервера) не чіпаємо. Рядки секцій
    // перераховують себе самі (на кожну правку), тож тут лише звіряємо лік.
    const inSections = this.sections().reduce((n, s) => n + s.errorCount, 0);
    if (keys.length === 0 && inSections === 0 && this.#bannerShown) {
      this.#bannerShown = false;
      this.messages = [];
    }
  }

  // ── Обов'язковість полів і перевірка ───────────────────────────────────────

  /**
   * Правила полів форми: обов'язковість і власні перевірки.
   *
   * Метод, а не константа, навмисно: він викликається на кожен рендер і перед
   * збереженням, тож умова вільно читає поточні дані — це і є **умовна**
   * обов'язковість.
   *
   * ```ts
   * protected override fieldRules(): FieldRules {
   *   const item = this.$root.item;
   *   return {
   *     edrpou: item.kind === "legal_entity",              // умовно обов'язкове
   *     prefix: false,                                     // зняти обов'язковість зі схеми
   *     iban: { check: (v) => isIban(v) ? null : t("bank.badIban") },
   *   };
   * }
   * ```
   *
   * Ключ — ім'я поля основної сутності (`primaryKey`, зазвичай `item`).
   * Поле, якого тут немає, бере обов'язковість зі схеми — як і раніше.
   */
  protected fieldRules(): FieldRules {
    return {};
  }

  /**
   * Табличні частини форми — щоб `validate()` перевіряв і їх. Правила самих
   * колонок оголошені в конфізі секції (`required` / `check`), тут форма лише
   * називає секції:
   *
   * ```ts
   * protected override sections() { return [this.lines]; }
   * ```
   */
  protected sections(): FormSection[] {
    return [];
  }

  /**
   * Поля, віддані в `renderField` у поточному циклі рендеру: ім'я → чи
   * намальована зірочка. Реєстр і робить інваріант «зірочка == перевірка»
   * нерозривним: перевіряється рівно те, що бачить користувач.
   *
   * Заповнюється під час `render()`, очищується в `willUpdate()` — тому поле
   * зі схованої гілки розмітки не перевіряється (підсвітити його все одно
   * нікуди).
   */
  #renderedFields = new Map<string, boolean>();

  /**
   * Перевірка вже спрацьовувала хоч раз. Доти помилок не показуємо взагалі:
   * порожня нова форма не повинна зустрічати користувача червоним.
   */
  #validationStarted = false;

  /** Чи обов'язкове поле за схемою: у TypeBox це все, що не `Type.Optional`. */
  private schemaRequired(field: string): boolean {
    const entity = this.rootSchema?.properties?.[this.primaryKey ?? "item"] as
      | { required?: string[] }
      | undefined;
    return entity?.required?.includes(field) ?? false;
  }

  /**
   * Чи є поле обов'язковим: правило форми, інакше схема. Публічний для форми —
   * компоненти з власним підписом (`<ui-picker label>`) малюють зірочку самі:
   * `?required=${this.isRequired("counterparty")}`.
   */
  protected isRequired(field: string): boolean {
    const rule = this.fieldRules()[field];
    if (typeof rule === "boolean") return rule;
    if (rule && rule.required !== undefined) return rule.required;
    return this.schemaRequired(field);
  }

  /** Текст помилки поля — для компонентів із власним підписом: `.invalid=`. */
  protected fieldError(field: string): string {
    return this.fieldErrors[field] ?? "";
  }

  /**
   * Зібрати помилки. Перевіряється об'єднання двох множин:
   *  - поля, оголошені у `fieldRules()` — хай як їх малює форма;
   *  - поля, віддані в `renderField` — вони беруть обов'язковість зі схеми.
   *
   * Решта схеми не перевіряється свідомо: `id` обов'язковий за TypeBox
   * (`Union([String, Null])` — не `Optional`), але в новому записі він порожній,
   * і суцільна перевірка схеми блокувала б збереження завжди.
   */
  #collectErrors(): Record<string, string> {
    const rules = this.fieldRules();
    const entity = (this.$root as Record<string, unknown>)[this.primaryKey ?? "item"];
    const item = (entity && typeof entity === "object" ? entity : {}) as Record<string, unknown>;

    const names = new Set<string>([...Object.keys(rules), ...this.#renderedFields.keys()]);
    const errors: Record<string, string> = {};

    for (const name of names) {
      const rule = rules[name];
      const value = item[name];

      // Реєстр рендеру попереду правил навмисно: у ньому вже враховані і
      // правила, і перекриття прапорцем прямо в renderField, а головне — це
      // рівно та обов'язковість, яку показала зірочка.
      const required = this.#renderedFields.get(name)
        ?? (typeof rule === "boolean" ? rule : rule?.required)
        ?? this.schemaRequired(name);

      if (isEmptyValue(value)) {
        if (required) errors[name] = t("common.fieldRequired");
        continue;
      }
      const message = typeof rule === "object" ? rule?.check?.(value) : undefined;
      if (message) errors[name] = message;
    }
    return errors;
  }

  /**
   * Перевірити поля форми. Заповнює `fieldErrors`, показує банер і веде до
   * першого невалідного поля. Далі помилки перераховуються на кожен рендер,
   * тож зникають щойно поле заповнили — а не з наступним натисканням.
   *
   * Викликається автоматично перед збереженням; форма кличе сама, якщо своя
   * дія теж вимагає заповнених полів (наприклад «Провести»).
   */
  protected validate(): boolean {
    this.#validationStarted = true;
    const errors = this.#collectErrors();
    this.fieldErrors = errors;
    const first = Object.keys(errors)[0];

    // Секції перевіряємо ЗАВЖДИ, навіть коли шапка вже завалилася: інакше
    // користувач правив би форму за два заходи — спершу поля, потім рядки.
    let sectionText = "";
    let sectionErrors = 0;
    for (const section of this.sections()) {
      const count = section.validate();
      sectionErrors += count;
      if (count && !sectionText) sectionText = section.firstErrorText();
    }

    if (!first && !sectionErrors) return true;

    // Поля шапки в пріоритеті: вони вище на екрані, і банер має говорити про
    // те, куди зараз поїде фокус.
    this.messages = [{ type: "error", text: first ? t("common.fixFields") : sectionText }];
    this.#bannerShown = true;
    if (first) this.updateComplete.then(() => this.#focusField(first));
    else this.#focusSection();
    return false;
  }

  /**
   * Навести фокус на першу невалідну комірку табличної частини. Синхронно й
   * із власним `refresh()`: подання забирає `pendingFocus` у своєму
   * `updated()`, тож ціль має стояти ДО перемальовування, а не після.
   */
  #focusSection() {
    for (const section of this.sections()) {
      const cell = section.firstErrorCell();
      if (!cell) continue;
      section.pendingFocus = cell;
      section.refresh();
      return;
    }
  }

  /** Банер «заповніть поля» поставили ми — значить нам його й прибирати. */
  #bannerShown = false;

  /**
   * Помилки, які назвав сервер: поле → текст і значення, на якому він
   * спіткнувся. Тримаються ОКРЕМО від локальних правил, бо перерахувати їх
   * клієнт не може — «код уже зайнятий» знає лише база. Знімок значення й
   * відповідає на питання «коли гасити»: щойно поле змінили, вердикт застарів.
   */
  #serverErrors = new Map<string, { text: string; value: unknown }>();

  /**
   * Розкласти повідомлення сервера: те, що названо полем, — на саме поле,
   * решта — в банер.
   *
   * Прив'язується лише поле, яке форма справді показує (віддане в `renderField`
   * або оголошене в `fieldRules`). Інакше повідомлення про поле, якого на
   * екрані немає, зникло б безслідно — тому таке лишається в банері.
   */
  #routeMessages(messages: Message[]): Message[] {
    const key = this.primaryKey ?? "item";
    const rules = this.fieldRules();
    const rest: Message[] = [];

    for (const message of messages) {
      const field = message.field;
      const known = !!field && (this.#renderedFields.has(field) || field in rules);
      if (!field || !known || !message.text) {
        rest.push(message);
        continue;
      }
      this.#serverErrors.set(field, {
        text: message.text,
        value: entityValue(this.$root, key, field),
      });
    }

    if (this.#serverErrors.size > 0) {
      this.#validationStarted = true;
      const first = [...this.#serverErrors.keys()][0];
      this.updateComplete.then(() => this.#focusField(first));
    }
    return rest;
  }

  /**
   * Прокрутити до поля й поставити в нього фокус. Працює по `data-field`, який
   * ставить `renderField`; поле, намальоване формою власноруч, підхопиться так
   * само, якщо форма проставить цей атрибут на обгортці.
   */
  #focusField(field: string) {
    const host = this.renderRoot.querySelector(`[data-field="${field}"]`);
    if (!host) return;
    host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Контрол ui-kit живе у власному shadow root — селектор туди не дістає,
    // але сам компонент має delegatesFocus, тож focus() на ньому спрацює.
    const control = host.querySelector<HTMLElement>("input, select, textarea")
      ?? [...host.querySelectorAll<HTMLElement>("*")].find((el) => el.localName.includes("-"));
    control?.focus();
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
    // Нова команда — попередній вердикт сервера більше не діє.
    this.#serverErrors.clear();
    try {
      const env = (await bus.request(
        kind === "save" ? "data.save" : "data.load",
        { model: this.model, command, payload },
      )) as Envelope<D> | undefined;
      this.messages = this.#routeMessages(
        normalizeMessages(env?.messages, env?.ok ?? false),
      );
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
   *
   * `kind: "save"` — для команд, які запис МІНЯЮТЬ, а не лише читають
   * (проведення документа): тоді летить `model.changed`, і список, відкритий
   * у сусідній вкладці, перемальовує значок стану. Без цього форма показувала
   * б проведений документ, а журнал поруч — непроведений, доки його не
   * перезавантажать руками.
   */
  protected async loadInto(
    command: string,
    payload: unknown,
    kind: "load" | "save" = "load",
  ): Promise<boolean> {
    this.notFound = false;
    const env = await this.run<Partial<T>>(command, payload, kind);
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
   * Записати ссылку, вибрану пікером: сам об'єкт і його id — з одного значення.
   *
   * `<ui-picker>` віддає ссылку так, як її віддає база (`{ id, name }`), а в
   * даних вона живе двома полями: об'єкт для показу й `<name>Id` для `save`.
   * Тримати обидва в кожній формі — це рівно та пара, яку раніше треба було
   * писати руками й можна було розсинхронити; тепер вони пишуться разом.
   *
   * ```ts
   * .value=${item.counterparty ?? null}
   * @value-changed=${(e: PickerChangeEvent) => this.setRef("counterparty", e.detail.value)}
   * ```
   *
   * Ім'я id-поля виводиться як `<key>Id`; коли конвенція не діє — третім
   * аргументом.
   */
  protected setRef(key: string, value: PickerValue, idKey = `${key}Id`): void {
    const entity = (this.$root as Record<string, unknown>)[this.primaryKey ?? "item"] as
      | Record<string, unknown>
      | null;
    if (!entity) return;
    entity[key] = value;
    entity[idKey] = value?.id == null ? "" : String(value.id);
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
   * Запис замкнений СТАНОМ, а не правами: проведений документ.
   *
   * Окремо від `maySave` навмисно — це різні причини й різні ліки. Прав немає
   * назавжди (їх дає адміністратор), а замок знімає сам користувач сусідньою
   * кнопкою («Розпровести»), тож ховати її разом з рештою не можна: кнопки
   * командної панелі й так живуть поза `fieldset[disabled]`.
   *
   * Умовчання — «не замкнений»: довідники такого стану не мають зовсім.
   */
  protected get locked(): boolean {
    return false;
  }

  /**
   * Чи можна зараз правити запис: є право на запис і стан не замкнений.
   * Саме це, а не голе право, вирішує долю кнопок запису й полів форми.
   */
  protected get mayEdit(): boolean {
    return this.maySave && !this.locked;
  }

  /**
   * Режим перегляду: запис відкритий, а змінити його не можна — або немає
   * права, або документ проведений.
   *
   * Реактивний задарма — `maySave` читає сигнал прав, а `locked` — `$root`;
   * обидва перемальовують форму самі, без підписок і `requestUpdate`.
   */
  protected get readonlyMode(): boolean {
    return this.primaryKey !== null && !this.mayEdit;
  }

  /**
   * Обгортка полів форми. У режимі перегляду гасить усе всередині:
   *  - нативні `input`/`select`/`textarea`/`button` — каскадом самого
   *    `fieldset[disabled]`, без жодного JS;
   *  - компоненти ui-kit — ні: каскад не проходить у shadow DOM, тому їм
   *    форма передає `?disabled=${this.readonlyMode}` явно.
   *
   * `display: contents` — щоб обгортка не з'явилася в розкладці: у fieldset є
   * власні поля й рамка, а форми покладаються на свої flex/grid. На каскад
   * `disabled` це не впливає — він семантичний, не візуальний.
   *
   * ПІДВАЛ СЮДИ НЕ КЛАДЕМО: disabled гасить і кнопки, тож «Закрити» перестала
   * б працювати — і переглядач не зміг би вийти з форми.
   */
  protected renderFields(content: TemplateResult): TemplateResult {
    return html`<fieldset class="contents" ?disabled=${this.readonlyMode}>${content}</fieldset>`;
  }

  /**
   * Чи має користувач право на дію над ЦІЄЮ моделлю — для кнопок форми:
   * `${this.may("post") ? … : ""}`.
   *
   * Нестандартні команди оголошують своє право в `manifest.commands.access`, і
   * клієнт цих оголошень НЕ бачить (у `view-manifest` їде тільки маршрут і
   * заголовок). Тому для власних кнопок дію називає сама форма — тим самим
   * словом, що в манифесті.
   */
  protected may(action: string): boolean {
    return can(this.model, action);
  }

  /**
   * Чи має користувач право зберегти ЦЕЙ запис.
   *
   * `save` — це два різні права: новий запис вимагає `create`, наявний —
   * `edit`. Сервер вирішує так само, за наявністю `item.id`
   * (`resolveRequiredAction`), тож рахувати треба тим самим способом — інакше
   * ховали б не ту кнопку.
   *
   * Це підказка інтерфейсу, а не захист: відмовляє все одно сервер, і
   * fail-closed. Тому помилка тут не небезпечна — лише незручна.
   */
  protected get maySave(): boolean {
    if (this.primaryKey === null) return false;
    const entity = (this.$root as Record<string, unknown>)[this.primaryKey];
    const id = (entity && typeof entity === "object")
      ? (entity as Record<string, unknown>).id
      : undefined;
    const isNew = id === null || id === undefined || id === "";
    return can(this.model, isNew ? "create" : "edit");
  }

  /**
   * Спільний банер: «запис не знайдено» + помилки з конверта.
   * Підключається одним рядком у render підкласу: `${this.renderNotice()}`.
   */
  protected renderNotice(): TemplateResult | string {
    // Показуємо ВСІ повідомлення, а не лише помилки. Раніше `info` мовчки
    // відкидалося, і успішна операція, яка мала що сказати («користувача
    // деактивовано, а не видалено»), виглядала так само, як безсловесна.
    const shown = this.messages.filter((m) => m.text);
    if (!this.notFound && shown.length === 0) return "";
    const style = (m: Message) =>
      m.type === "error" ? "alert-error" : m.type === "warn" ? "alert-warning" : "alert-info";
    // role="alert" на кожному повідомленні, а не на контейнері: контейнер живе
    // в DOM постійно, і читалка озвучує лише те, що з'явилося ВСЕРЕДИНІ вже
    // оголошеної живої області — а тут з'являється саме повідомлення. Без цього
    // відмова сервера після «Зберегти» проходила беззвучно: фокус лишався на
    // кнопці, а текст падав вище по сторінці.
    return html`
      <div class="mb-3 flex flex-col gap-2">
        ${this.notFound
          ? html`<div class="alert alert-error py-2 text-sm" role="alert">${t("common.recordNotFound")}</div>`
          : ""}
        ${shown.map((m) => html`
          <div class="alert ${style(m)} py-2 text-sm" role="alert">${m.text}</div>
        `)}
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
   *
   * Обгортка — `<label>`, а не `<div>`, і це не про доступність «взагалі».
   * Контрол лежить УСЕРЕДИНІ підпису, тобто зв'язок неявний — жодних `id` і
   * `for`, які довелося б вигадувати й тримати унікальними. Дає це дві речі
   * одразу: клік по підпису ставить фокус у поле (ціль натискання росте втричі,
   * і виграють усі, не лише читалки екрана), а сам підпис нарешті стає ім'ям
   * поля для допоміжних технологій — доти поле не мало імені взагалі.
   *
   * Через це ж контрол сюди передають ГОЛИЙ (`<input>`, `<select>`): вкладений
   * `<label>` зробив би розмітку невалідною, і клік пішов би не туди.
   */
  protected renderField(
    label: string,
    control: TemplateResult,
    opts: { class?: string; field?: string; required?: boolean } = {},
  ): TemplateResult {
    // Порядок джерел: прапорець у розмітці → правило форми → схема. Що б не
    // перемогло, воно ж і піде в перевірку: обов'язковість запам'ятовується в
    // реєстрі рендеру, тому зірочка й перевірка розійтися не можуть.
    const required = opts.required ?? (opts.field ? this.isRequired(opts.field) : false);
    if (opts.field) this.#renderedFields.set(opts.field, required);

    const error = opts.field ? this.fieldErrors[opts.field] : undefined;
    return html`
      <label class="flex flex-col gap-px ${opts.class ?? ""} ${error ? "field-invalid" : ""}"
        data-field=${opts.field ?? nothing}>
        <span class="label text-sm leading-none">
          ${label}${required ? html`<span class="field-required">*</span>` : ""}
        </span>
        ${control}
        ${error ? html`<span class="field-error" role="alert">${error}</span>` : ""}
      </label>
    `;
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
   * Збереження з перевіркою полів — саме це вішається на кнопки.
   *
   * Перевірка навмисно ЗОВНІ `saveItem()`, а не всередині: `saveItem` — це
   * «як саме відправити» (форми його перевизначають, і не всі кличуть super),
   * а перевірити треба незалежно від того, як відправляють.
   */
  protected async trySave(): Promise<boolean> {
    if (!this.validate()) return false;
    return await this.saveItem();
  }

  /**
   * Публічний виклик збереження — для оболонки: «Зберегти» у діалозі
   * закриття брудної вкладки. Проходить через trySave(), тож і перевірка,
   * і перевизначення форм (нормалізація табличних частин) працюють і тут:
   * незаповнене обов'язкове поле лишає вкладку відкритою з підсвіткою.
   */
  async save(): Promise<boolean> {
    return await this.trySave();
  }

  /**
   * Ctrl+S від оболонки (`ShortcutTarget`).
   *
   * Оголошено тут, а не в кожній формі, але діє лише там, де є що зберігати:
   * `primaryKey` і є ознака «екран редагує один запис» — у списків, пікерів і
   * звітів він `null`. Проходить через `trySave()`, тож перевірка полів
   * спрацює так само, як по кнопці.
   */
  hotkeySave(): void {
    // mayEdit — щоб клавіша не робила того, чого кнопки на екрані немає.
    if (!this.canSave || !this.mayEdit) return;
    void this.trySave();
  }

  /**
   * Ctrl+Enter від оболонки — кнопка за замовчуванням форми, тобто
   * «Зберегти й закрити» (у командній панелі вона `btn-primary`, перша).
   * Невдале збереження вкладку не закриває: `saveAndClose` закриває лише
   * після успіху.
   *
   * Головною лишається саме запис, а не проведення — попри те, що в 1С головна
   * кнопка документа «Провести й закрити». Тут інша технологія й інші
   * очікування, а проведення має побічні дії в регістрах: клавіша, що мовчки
   * проводить, коштувала б дорожче за звичку.
   */
  hotkeyDefault(): void {
    if (!this.canSave || !this.mayEdit) return;
    void this.saveAndClose();
  }

  /** Закрити власну вкладку. `tabId` проставляє tab-controller при створенні. */
  protected closeSelf() {
    if (this.tabId) bus.emit({ type: "tab.close", tabId: this.tabId });
  }

  private async saveAndClose() {
    if (await this.trySave()) this.closeSelf();
  }

  /**
   * Свої кнопки ЛІВОРУЧ — одразу за стандартними (запис). Сюди йдуть дії над
   * самим записом: провести, розпровести, скопіювати.
   *
   * Розмітка, а не перелік описів: кнопка не завжди кнопка. У редакторі
   * шаблонів «Додати блок» — це `<details class="dropdown">`, імпорт —
   * `<label class="btn">` з файловим полем. Опис виду (`{label, icon, click}`)
   * усе це огородив би, і довелося б винаходити `kind: "dropdown"` — та сама
   * помилка, яку вже зробили з фільтрами.
   *
   * Порожній рядок означає «нічого немає» — саме за ним панель розуміє, що
   * лишилася порожньою, і не малюється.
   */
  protected renderActions(): TemplateResult | string { return ""; }

  /**
   * Кнопки ЗА РОЗДІЛЬНИКОМ: те, що не змінює запис, а видає назовні — друк,
   * вивантаження, обмін файлами.
   *
   * Саме роздільник, а не розпірка на всю ширину. Розпірка відкидала друк до
   * правого краю, і на широкому екрані його доводилося ШУКАТИ — велика порожнеча
   * не читається як групування, вона читається як «тут нічого немає».
   */
  protected renderAuxActions(): TemplateResult | string { return ""; }

  /**
   * Командна панель форми — зверху, а не в підвалі.
   *
   * Чому зверху: у документі з табличною частиною на 30 рядків підвал їде за
   * екран, тобто «Зберегти» зникає саме там, де форма найдовша. Списки й звіти
   * і так тримають тулбар угорі, тож форма стає з ними в один ряд.
   *
   * Чому без «Закрити»: вкладка закривається хрестиком на ярлику і по Esc,
   * причому з діалогом про незбережене. Окрема кнопка дублювала б це втретє.
   * Через це ж панель, у якій нічого не лишилося (немає права на запис і форма
   * не додала своїх дій), не малюється зовсім — порожня смуга гірша за її
   * відсутність.
   *
   * `no-print` — панель не належить паперу.
   */
  protected renderFormActions(): TemplateResult | string {
    const main = this.renderActions();
    const aux = this.renderAuxActions();
    if (!this.mayEdit && main === "" && aux === "") return "";

    return html`
      <div class="form-actions no-print">
        ${this.mayEdit
          ? html`
            <button class="btn btn-sm btn-primary" ?disabled=${!this.canSave} @click=${this.saveAndClose}>
              ${this.running === "save"
                ? html`<span class="loading loading-spinner loading-xs"></span>`
                : icons.saveClose}
              ${t("common.saveAndClose")}
            </button>
            <button class="btn btn-sm btn-outline" ?disabled=${!this.canSave} @click=${this.trySave}>
              ${icons.save} ${t("common.save")}
            </button>`
          : ""}
        ${main}
        ${aux === "" ? "" : html`<span class="toolbar-sep"></span>`}
        ${aux}
      </div>
    `;
  }

  /** Ширина колонки полів. Проста картка — вужча, документ — ширший. */
  protected formWidth = "max-w-3xl";

  /**
   * Каркас форми редагування: командна панель, банер, поля.
   *
   * Розкладку тримає БАЗА, а не кожна форма. Доти кожна складала `render()`
   * сама й кликала `renderFormActions()` де хотіла — і саме тому редактор
   * шаблонів друку поїхав своїм шляхом: ніхто йому не заважав. Домовленість,
   * яку нема чим підтримати, одного разу вже не втрималася.
   *
   * Це УМОВЧАННЯ, а не клітка: форма з незвичайною розкладкою просто не кличе
   * `renderForm()` і будує свій `render()`, як і раніше.
   *
   * Прокручується САМЕ ОБЛАСТЬ ПОЛІВ, а панель стоїть над нею. Тому їй не
   * потрібен ані `position: sticky`, ані z-index, ані непрозорий фон під
   * рядками, що проїжджають (порівняй `.report-head`, де прокручується вся
   * панель вкладки й без липкості не обійтися).
   *
   * `renderFields()` навколо полів лишає в силі старий інваріант: панель
   * НЕ всередині `fieldset[disabled]`, тож у режимі перегляду її кнопки живі.
   * Тепер це виходить саме собою — панель просто вище за поля.
   */
  protected renderForm(fields: TemplateResult): TemplateResult {
    return html`
      <div class="flex flex-col h-full">
        ${this.renderFormActions()}
        <div class="flex-1 overflow-auto">
          <div class="px-4 py-3 ${this.formWidth}">
            ${this.renderNotice()}
            ${this.renderFields(fields)}
          </div>
        </div>
      </div>
    `;
  }
}
