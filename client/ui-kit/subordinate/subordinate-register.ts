/**
 * Підпорядкований регістр у картці власника — ЛОГІКА (контролер + окреме в'ю).
 *
 * ЩО ЦЕ ЗА ФОРМА ДАНИХ. «Значення X для Y, починаючи з дати»: курс валюти в
 * картці валюти, ціна в картці номенклатури, ознака «платник ПДВ» в обліковій
 * політиці організації, параметри амортизації в картці основного засобу.
 * Записи живуть ОКРЕМОЮ моделлю зі своїм екраном — і це правильно, бо в них
 * своя таблиця, свій CRUD і своя дата дії. Але людина, яка відкрила картку
 * організації, шукає «з 1 червня ми платники ПДВ» саме там: це властивість
 * організації, а не окремий запис, який іще треба знайти в меню.
 *
 * ЧОМУ ЦЕ В ЯДРІ. Панель над чужою моделлю пише кожен застосунок, і кожен
 * по-своєму: хтось збереже рядки разом із карткою й дістане половину записаного
 * при відмові, хтось відфільтрує за іменем ПОЛЯ й мовчки покаже рядки всіх
 * власників. Чотири рішення нижче однакові для будь-якого такого регістру, і
 * помиляються в них тихо.
 *
 * ЧОТИРИ РІШЕННЯ, ЗАРАДИ ЯКИХ ЦЕ ІСНУЄ:
 *
 * 1. **Запис іде ОДРАЗУ, а не разом із карткою.** Регістр — окрема модель зі
 *    своїми перевірками й згенерованим CRUD; писати його «разом» означало б або
 *    завести другий набір правил, або зробити двофазний запис, який ламається
 *    посередині й лишає половину.
 * 2. **У нової картки ще немає id**, і чіпляти до неї рядки нема за що. Панель
 *    у такому разі вимкнена, і про це сказано СЛОВАМИ: мовчазно порожній
 *    перелік не відрізнити від «записів немає».
 * 3. **Відбір іде за ІМЕНЕМ ССЫЛКИ** (`organization`), а не поля
 *    (`organizationId`): згенерований `_list` читає його саме так, а ім'я поля
 *    дає «невідомий фільтр». Виводиться тут із `ownerField` тим самим правилом,
 *    що в `x-ref.as` і в колонці табличної частини — суфікс `Id` відкидається.
 * 4. **Рядок, поставлений ДОКУМЕНТОМ, не правиться з картки.** Документ
 *    переписує свої рядки начисто при перепроведенні, тож правка зникла б
 *    мовчки. Ознака — заповнений реєстратор (`documentId`), і це не здогад:
 *    так називається колонка-реєстратор в усьому фреймворку.
 *
 * ЯК ЦЕ ВИГЛЯДАЄ. Тулбар над сіткою й правка ПРЯМО В РЯДКУ — той самий вигляд і
 * та сама клавіатура, що в табличної частини документа. Окремої смуги редактора
 * над таблицею немає: вона повторювала ту саму сітку другим разом, змушувала
 * оголошувати кожне поле двічі (показ і правку) і робила з двох однакових на
 * вигляд таблиць сусідніх екранів два різні способи вводу.
 *
 * Але межа запису лишається ЯВНОЮ: рядок у правці — це чернетка, і вона їде на
 * сервер натисканням (✓ або Enter), а не «сама», коли курсор пішов з рядка.
 * Причина та ж, що й у рішення 1: пише команда чужої моделі, яка МОЖЕ
 * ВІДМОВИТИ, — а мовчазний запис по виходу з рядка означав би, що недописаний
 * рядок зникає без слова саме тоді, коли користувач перемкнув вкладку.
 *
 * ЧОГО ТУТ НЕМАЄ СВІДОМО. Колонки оголошуються ТИПІЗОВАНО в коді форми, а не
 * виводяться з манифеста підпорядкованої моделі. Причина та сама, що в
 * табличної частини: ключі перевіряє компілятор. Друга причина — граф чанків:
 * щоб вивести редактор зі схеми чужої моделі, її схема мусила б приїхати в
 * бандл разом із реєстром, тобто кожен застосунок платив би за схеми всіх своїх
 * моделей на кожному екрані.
 */
import type { ReactiveControllerHost } from "lit";
import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { TemplateResult } from "lit";
import { bus } from "../../bus/bus.ts";
import { t } from "../../locale.ts";

/**
 * Колонка переліку — вона ж поле редактора.
 *
 * Оголошення ОДНЕ, як у табличної частини: колонка каже, що показує і чим
 * правиться. Доти показ і правка описувалися двома переліками (`columns` і
 * `fields`), і для регістру з двох колонок це було те саме, написане двічі, —
 * з правом мовчки розійтися: колонка є, поля до неї немає, і значення
 * показується, але не правиться.
 */
export interface SubordinateColumn<Row extends object> {
  /** Вид комірки в режимі правки; умовчання — `text`. */
  kind?: "text" | "decimal" | "date" | "checkbox" | "picker" | "select" | "custom";
  key: string;
  /** Заголовок — ключ локалізації (проходить через t()). */
  title: string;
  width?: string;
  align?: "left" | "right" | "center";
  /** Шаблон дати/часу (`dateFormat.date`), як у колонці списку. */
  format?: string;
  /** decimal: кількість знаків (умовчання 2). */
  precision?: number;
  /** picker: маршрут в'ю (`family/model`), як у `<ui-picker url>`. */
  url?: string;
  /** picker: ключ вкладеного об'єкта; умовчання — `key` без суфікса Id. */
  refKey?: string;
  /** picker: поле подання й підказки. */
  displayField?: string;
  hintField?: string;
  showClear?: boolean;
  /** select: перелік значень. */
  options?: () => Array<{ value: string; label: string }>;
  required?: boolean;
  /**
   * Колонка лише показує — у режимі правки лишається текстом (реєстратор,
   * обчислена сума, службова позначка).
   */
  readonly?: boolean;
  /** Показ значення в непорожньому рядку. */
  render?: (row: Row) => TemplateResult | string;
  /** kind: "custom" — розмітка комірки в режимі правки. */
  editor?: (draft: Row) => TemplateResult;
}

export interface SubordinateConfig<Row extends object> {
  /** Ключ підпорядкованої моделі — той самий, що в її манифесті. */
  model: string;
  /** Поле-ссылка на власника в рядку регістру: `organizationId`. */
  ownerField: string;
  /**
   * Ключ відбору, якщо він не виводиться з `ownerField`. Потрібен рівно тоді,
   * коли `x-ref.as` у схемі названо не за конвенцією.
   */
  ownerFilterKey?: string;
  /** Id власника; порожньо — картка ще не збережена. */
  ownerId: () => string | null | undefined;
  columns: Array<SubordinateColumn<Row>>;
  /** Порожній рядок: схема (Value.Create) або фабрика. */
  schema?: TObject;
  createRow?: () => Row;
  /** `sortBy` для `list`; типово — поле періоду за спаданням. */
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /**
   * Поле дати, за яким працює «Перейти до дати». Оголошене — панель показує
   * поле дати в смузі дій; не оголошене — не показує взагалі (fail-closed:
   * кнопка, за якою немає відбору, гірша за відсутню).
   *
   * Вимога до моделі: це поле мусить нести `"x-filter": { "op": "range" }` —
   * саме воно дає згенерованому `_list` ключі `<field>From` / `<field>To`.
   * Панель шле ОДИН із них: при спаданні (умовчання) — `To`, при зростанні —
   * `From`, тобто названа дата завжди стає ПЕРШИМ рядком вікна, а не десь
   * усередині нього.
   */
  dateField?: string;
  /**
   * Скільки рядків показувати за раз (умовчання 10) і на скільки росте вікно
   * по «Показати ще».
   *
   * Перелік у картці — НЕ журнал: курсів валюти за десять років тисячі, і
   * картка, яка вивалює їх усі, перестає бути карткою — форма власника їде за
   * екран, а потрібні майже завжди останні. Тому вікно мале, а решта
   * дістається натисканням; скільки саме записів є, панель каже словами —
   * мовчки обрізаний перелік не відрізнити від «це все».
   */
  pageSize?: number;
  /** Режим перегляду форми-власника (функція: права — сигнал). */
  readonly?: () => boolean;
  /**
   * Чи заблокований рядок. Умовчання — заповнений `documentId`: рядок
   * поставлено документом.
   */
  lockedWhen?: (row: Row) => boolean;
  /** Заголовок панелі — ключ локалізації. */
  titleKey?: string;
  /**
   * Дії ЗАСТОСУНКУ в смузі дій рядка — ліворуч від пари «правка / видалення».
   *
   * Потрібне тому, що панель малює комірку дій сама, і поставити в неї свою
   * кнопку не було куди взагалі. Найчастіший випадок видно наперед: рядок,
   * поставлений документом, не правиться — і перше, що робить людина,
   * побачивши такий рядок, це намагається той документ ВІДКРИТИ. Без слоту
   * кнопка виносилася окремою колонкою, тобто 3rem ширини заради однієї дії, а
   * подання документа посиланням не помістилося б: воно довге за побудовою.
   *
   * Чому це не робить сама панель: маршрут в'ю виводиться з ключа моделі через
   * `view-manifest`, а він генерується з манифестів ЗАСТОСУНКУ — фреймворк його
   * не бачить і бачити не може (залежність іде в один бік). Код типу документа
   * приходить у вкладеному об'єкті ссылки (`{ id, presentation, typeCode }`,
   * `x-ref: { entity: "document" }`), а маршрут із нього складає застосунок.
   *
   * Порядок саме такий — чуже ліворуч: комірка притиснута до правого краю, тож
   * пара «правка / видалення» лишається на місці незалежно від того, є в цьому
   * рядку своя дія чи немає.
   */
  rowActions?: (row: Row) => TemplateResult | string;
}

interface Envelope {
  ok?: boolean;
  // `totals.count` — усього рядків за відбором; його віддає згенерований
  // `_list` того ж конверта, тож окремої команди «порахуй» не треба.
  data?: { rows?: unknown[]; item?: unknown; totals?: { count?: number } };
  messages?: Array<{ type?: string; text?: string }>;
}

/**
 * Розмір вікна за замовчуванням. Десять, а не «сторінка списку»: у картці
 * дивляться на останні значення, а не гортають історію.
 */
const DEFAULT_PAGE_SIZE = 10;

/**
 * Ім'я ссылки з імені поля: `organizationId` → `organization`.
 *
 * Конвенція одна на два випадки — ключ відбору по власнику й ключ вкладеного
 * об'єкта в колонці-пікері, — і саме тому вона тут одна функцією: розписана
 * двічі, вона розійшлася б на першому ж винятку (`x-ref.as` названо інакше).
 */
export function refNameOf(field: string, explicit?: string): string {
  if (explicit) return explicit;
  return field.endsWith("Id") ? field.slice(0, -2) : field;
}

/** Ключ відбору по власнику. Та сама конвенція, що в `x-ref.as`. */
export function ownerFilterKeyOf(ownerField: string, explicit?: string): string {
  return refNameOf(ownerField, explicit);
}

/**
 * Куди веде перехід до дати: сторінка й номер рядка на ній.
 *
 * `total` — усього рядків у власника, `beyond` — скільки їх по той бік дати
 * (при спаданні — не пізніших за неї). Різниця й є номером ПЕРШОГО рядка, що
 * діяв на цю дату; він же — найближчий заповнений запис, бо порожніх дат у
 * регістрі не існує: значення діє з дати й до наступного запису.
 *
 * Номер притискається до наявного рядка: дата, старша за весь регістр, дає
 * `beyond = 0` і вивела б за межі — треба останній рядок, а не порожня
 * сторінка за ним.
 *
 * Чиста функція заради проби: помилка на одиницю тут не падає, а тихо показує
 * сусідню сторінку — тобто виглядає як «перехід трохи не туди», і причину в
 * такому вигляді не шукають.
 */
export function dateLanding(
  total: number,
  beyond: number,
  pageSize: number,
): { page: number; row: number } {
  const last = Math.max(0, total - 1);
  const index = Math.min(Math.max(0, total - beyond), last);
  return { page: Math.floor(index / pageSize) + 1, row: index % pageSize };
}

/**
 * Чи поставлений рядок документом.
 *
 * Винесено окремою чистою функцією заради проби: правило коротке, а ціна
 * помилки в ньому — мовчки зникла правка користувача.
 */
export function rowLockedByDocument(row: Record<string, unknown>): boolean {
  const id = row.documentId;
  return id !== null && id !== undefined && id !== "";
}

export class SubordinateRegister<Row extends object> {
  readonly config: SubordinateConfig<Row>;

  rows: Row[] = [];
  /** Скільки рядків у власника всього — не лише на сторінці. */
  total = 0;
  /** Поточна сторінка, від 1. */
  page = 1;
  /** Дата останнього переходу — показується в полі; відбором вона НЕ є. */
  anchorDate = "";
  loading = false;
  /**
   * Чернетка рядка, який зараз правлять; `null` — правки немає.
   *
   * Правка йде В СІТЦІ (рядок перетворюється на контроли), але чернетка все
   * одно окрема: рядок пишеться командою чужої моделі й сервер може
   * відмовити — тоді в таблиці мусить лишитися ЗАПИСАНЕ значення, а на екрані
   * те, що набрали. Правка «прямо в рядку» цієї різниці не тримає.
   */
  draft: Row | null = null;
  /** Id рядка, що правиться; `null` — новий рядок. */
  editingId: string | null = null;
  /**
   * Номер відкриття правки — росте на кожен `startAdd`/`startEdit`.
   *
   * Потрібен в'ю, щоб поставити фокус ОДИН раз на відкриття. Сама чернетка для
   * цього не годиться: `patch` пересобирає її на кожне натискання клавіші, тож
   * порівняння по об'єкту повертало б курсор у першу комірку під час набору, а
   * порівняння по `editingId` не розрізняло б два «Додати» поспіль.
   */
  draftSeq = 0;
  /** Поточний рядок переліку — на нього дивляться дії панелі. */
  currentIndex = -1;
  /** Повідомлення відмови сервера — показується в панелі, а не ковтається. */
  error = "";

  #hosts = new Set<ReactiveControllerHost>();
  /** Власник, під якого вже завантажено перелік. */
  #loadedFor: string | null = null;
  /** Рядок, який треба виділити після завантаження (перехід до дати). */
  #pendingSelect: number | null = null;

  constructor(host: ReactiveControllerHost, config: SubordinateConfig<Row>) {
    this.config = config;
    this.#hosts.add(host);
  }

  bind(host: ReactiveControllerHost) {
    this.#hosts.add(host);
  }

  unbind(host: ReactiveControllerHost) {
    this.#hosts.delete(host);
  }

  #notify() {
    for (const host of this.#hosts) host.requestUpdate();
  }

  // ── Читання стану ──────────────────────────────────────────────────────────

  get ownerId(): string {
    return String(this.config.ownerId() ?? "");
  }

  /** Картку вже збережено — з рядками можна працювати. */
  get ready(): boolean {
    return this.ownerId !== "";
  }

  get readonly(): boolean {
    return this.config.readonly?.() ?? false;
  }

  get filterKey(): string {
    return ownerFilterKeyOf(this.config.ownerField, this.config.ownerFilterKey);
  }

  locked(row: Row): boolean {
    return this.config.lockedWhen
      ? this.config.lockedWhen(row)
      : rowLockedByDocument(row as Record<string, unknown>);
  }

  /** Чому рядок не правиться — текст для підказки; порожньо — правиться. */
  lockedReason(row: Row): string {
    return this.locked(row) ? t("core.subordinate.lockedByDocument") : "";
  }

  /** Поточний рядок; `null` — не вибрано або перелік порожній. */
  get current(): Row | null {
    return this.rows[this.currentIndex] ?? null;
  }

  /** Чи цей рядок зараз правлять (чернетка накрила його в сітці). */
  editing(row: Row): boolean {
    if (!this.draft || this.editingId === null) return false;
    return String((row as Record<string, unknown>).id ?? "") === this.editingId;
  }

  /** Вибір рядка мишею або клавіатурою. */
  select(index: number) {
    if (this.currentIndex === index) return;
    this.currentIndex = index;
    this.#notify();
  }

  /** Колонки, які приймають ввід: правка йде по них, і по них же — перевірка. */
  editableColumns(): Array<SubordinateColumn<Row>> {
    return this.config.columns.filter((column) => !column.readonly);
  }

  // ── Завантаження ───────────────────────────────────────────────────────────

  /**
   * Синхронізувати перелік із власником. Кличе в'ю на кожному оновленні:
   * картка могла щойно зберегтися й дістати id, і панель має ожити сама, а не
   * після перевідкриття вкладки.
   */
  syncOwner() {
    const owner = this.ownerId;
    if (owner === this.#loadedFor) return;
    this.#loadedFor = owner;
    this.draft = null;
    this.editingId = null;
    // Інший власник — інший перелік: ані сторінка попереднього, ані його дата
    // до нього стосунку не мають.
    this.page = 1;
    this.anchorDate = "";
    this.total = 0;
    if (!owner) {
      this.rows = [];
      this.#notify();
      return;
    }
    void this.load();
  }

  /** Рядків на сторінці. */
  get pageSize(): number {
    return this.config.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  /** Скільки сторінок — щонайменше одна, навіть коли рядків немає. */
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** Перейти на сторінку; номер поза межами притискається до найближчої. */
  async goToPage(page: number): Promise<void> {
    const target = Math.min(Math.max(1, Math.trunc(page)), this.pageCount);
    if (target === this.page) return;
    this.page = target;
    await this.load();
  }

  /** Напрям перегляду: за спаданням (умовчання) — від найсвіжішого запису. */
  get descending(): boolean {
    return (this.config.sortDir ?? "desc") === "desc";
  }

  /**
   * Ключ відбору, яким рахується позиція дати: `periodTo` при спаданні,
   * `periodFrom` при зростанні. Обидва дає `x-filter: { op: "range" }` того ж
   * поля.
   */
  get anchorFilterKey(): string {
    return `${this.config.dateField ?? ""}${this.descending ? "To" : "From"}`;
  }

  /**
   * Перейти до дати.
   *
   * ЩО ЦЕ ОЗНАЧАЄ. Не «показати рядки з цієї дати» і не пошук рядка з такою
   * датою: у регістрі значення діє З дати, тож запису рівно на названий день
   * може не бути взагалі. Перехід стає на найближчий ЗАПОВНЕНИЙ запис — той,
   * що діяв на цю дату (при перегляді за спаданням це найближчий не пізніший;
   * якщо таких немає взагалі, тобто дата старша за весь регістр — найстаріший
   * запис, тобто остання сторінка).
   *
   * ЧОМУ СТОРІНКА, А НЕ ВІДБІР. Відбір за датою сховав би все, що новіше, і з
   * дати не було б виходу гортанням — а людина переходить до дати саме щоб
   * подивитися, що навколо неї. Тому дата шукає СТОРІНКУ, а сама вибірка
   * лишається повною.
   *
   * Рахується це двома лічильними викликами (`pageSize: 1`, потрібне тільки
   * `totals.count`): скільки рядків усього й скільки їх по той бік дати.
   * Різниця — номер рядка, з нього виходить сторінка. Окремої SQL-команди для
   * цього немає навмисно: згенерований `_list` уже вміє і відбір, і рахунок.
   */
  async goToDate(date: string): Promise<void> {
    if (!this.config.dateField || !this.ready) return;
    this.anchorDate = date;

    if (!date) {
      this.page = 1;
      await this.load();
      return;
    }

    const total = await this.#count();
    const beyond = await this.#count(date);
    // Відмову вже названо в `error` — мовчазний стрибок на першу сторінку
    // виглядав би так, ніби перехід відпрацював.
    if (total === null || beyond === null) return;

    this.total = total;
    const landing = dateLanding(total, beyond, this.pageSize);
    this.page = landing.page;
    // Рядок, заради якого переходили, ще й виділяється: інакше людина отримує
    // сторінку й мусить шукати на ній дату очима.
    this.#pendingSelect = landing.row;
    await this.load();
  }

  /**
   * Скільки рядків у власника (за потреби — по той бік дати).
   *
   * `null` — запит не вдався; відмова вже лежить в `error`.
   */
  async #count(anchor?: string): Promise<number | null> {
    const filters: Record<string, unknown> = { [this.filterKey]: { id: this.ownerId } };
    if (anchor) filters[this.anchorFilterKey] = anchor;

    const env = await this.#call("list", { page: 1, pageSize: 1, filters });
    if (!env?.ok) return null;
    return Number(env.data?.totals?.count ?? 0);
  }

  async load(): Promise<void> {
    if (!this.ready) return;
    this.loading = true;
    this.error = "";
    this.#notify();

    const env = await this.#call("list", {
      page: this.page,
      pageSize: this.pageSize,
      sortBy: this.config.sortBy,
      sortDir: this.config.sortDir ?? "desc",
      filters: { [this.filterKey]: { id: this.ownerId } },
    });

    this.rows = (env?.data?.rows ?? []) as Row[];
    // Скільки їх усього — з того самого конверта (`totals.count`
    // згенерованого `_list`). Без цього не порахувати ані сторінок, ані
    // позиції дати, і обрізаний перелік не відрізнити від повного.
    this.total = Number(env?.data?.totals?.count ?? this.rows.length);
    this.loading = false;

    // Сторінка могла зникнути під ногами: останній рядок видалили тут або в
    // сусідній вкладці. Порожня сторінка посеред непорожнього переліку
    // виглядає як «записів немає» — тому відступаємо на наявну.
    if (this.page > this.pageCount) {
      this.page = this.pageCount;
      await this.load();
      return;
    }

    // Рядок, до якого переходили за датою; інакше — старий номер, якого на
    // новій сторінці може не бути.
    this.currentIndex = this.#pendingSelect !== null
      ? Math.min(this.#pendingSelect, this.rows.length - 1)
      : Math.min(this.currentIndex, this.rows.length - 1);
    this.#pendingSelect = null;
    this.#notify();
  }

  // ── Правка рядка ───────────────────────────────────────────────────────────

  startAdd() {
    if (!this.ready || this.readonly) return;
    this.editingId = null;
    this.draft = this.#createRow();
    this.draftSeq++;
    // Новий рядок стає єдиним виділеним: підсвічений «поточний» рядок нижче
    // означав би два місця, куди дивиться Enter.
    this.currentIndex = -1;
    this.error = "";
    this.#notify();
  }

  /** Правити рядок; без аргументу — поточний (дія панелі). */
  startEdit(row: Row | null = this.current) {
    if (!row || this.readonly || this.locked(row)) return;
    this.editingId = String((row as Record<string, unknown>).id ?? "");
    this.draft = { ...row };
    this.draftSeq++;
    const index = this.rows.indexOf(row);
    if (index >= 0) this.currentIndex = index;
    this.error = "";
    this.#notify();
  }

  cancel() {
    this.draft = null;
    this.editingId = null;
    this.error = "";
    this.#notify();
  }

  /** Правка чернетки: в'ю кличе на кожну зміну поля. */
  patch(key: string, value: unknown) {
    if (!this.draft) return;
    this.draft = { ...this.draft, [key]: value } as Row;
    this.#notify();
  }

  /** Незаповнені обов'язкові комірки чернетки — ключі колонок. */
  missingFields(): string[] {
    const draft = this.draft as Record<string, unknown> | null;
    if (!draft) return [];
    return this.editableColumns()
      .filter((column) => column.required)
      .filter((column) => {
        const value = draft[column.key];
        return value === null || value === undefined || value === "";
      })
      .map((column) => column.key);
  }

  /**
   * Записати чернетку — ОДРАЗУ, командою підпорядкованої моделі.
   *
   * Власник підставляється тут, а не в формі: це єдине поле рядка, про яке
   * панель знає більше за того, хто її поставив.
   */
  async submit(): Promise<boolean> {
    if (!this.draft || !this.ready || this.readonly) return false;
    if (this.missingFields().length) {
      this.error = t("common.fixFields");
      this.#notify();
      return false;
    }

    const item = { ...this.draft, [this.config.ownerField]: this.ownerId };
    const env = await this.#call("save", { item }, "save");
    if (!env?.ok) return false;

    this.draft = null;
    this.editingId = null;
    await this.load();
    return true;
  }

  /** Видалити рядок; без аргументу — поточний (дія панелі). */
  async remove(row: Row | null = this.current): Promise<boolean> {
    if (!row || this.readonly || this.locked(row)) return false;
    if (!await bus.confirm(t("common.confirmDelete"), "common.delete", "warning")) return false;

    const env = await this.#call("delete", { id: String((row as Record<string, unknown>).id ?? "") }, "save");
    if (!env?.ok) return false;

    await this.load();
    return true;
  }

  // ── Внутрішнє ──────────────────────────────────────────────────────────────

  #createRow(): Row {
    if (this.config.createRow) return this.config.createRow();
    if (this.config.schema) return Value.Create(this.config.schema) as Row;
    return {} as Row;
  }

  /**
   * Виклик команди ЧУЖОЇ моделі.
   *
   * Не через `BaseUI.run` навмисно: той прив'язаний до `this.model` форми, а
   * тут модель інша — у цьому вся суть панелі. Відмова не ковтається: її текст
   * лягає в `error` і показується в самій панелі, бо банер форми говорить про
   * власника, і чуже повідомлення в ньому читалося б як помилка картки.
   */
  async #call(command: string, payload: unknown, kind: "load" | "save" = "load"): Promise<Envelope | null> {
    try {
      const env = await bus.request(
        kind === "save" ? "data.save" : "data.load",
        { model: this.config.model, command, payload },
      ) as Envelope | undefined;

      if (!env?.ok) {
        this.error = env?.messages?.find((message) => message.type !== "info")?.text ??
          t("common.requestFailed", { status: "" }).trim();
        this.#notify();
        return env ?? null;
      }

      this.error = "";
      return env;
    } catch (error) {
      // Мережа лягла або бекенд віддав не-200. Без цього гілка падала німо —
      // панель просто «нічого не робила» у відповідь на натискання.
      this.error = error instanceof Error ? error.message : String(error);
      this.loading = false;
      this.#notify();
      return null;
    }
  }
}
