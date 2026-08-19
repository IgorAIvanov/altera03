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
 * ЧОГО ТУТ НЕМАЄ СВІДОМО. Колонки й поля редактора оголошуються ТИПІЗОВАНО в
 * коді форми, а не виводяться з манифеста підпорядкованої моделі. Причина та
 * сама, що в табличної частини: ключі перевіряє компілятор. Друга причина —
 * граф чанків: щоб вивести редактор зі схеми чужої моделі, її схема мусила б
 * приїхати в бандл разом із реєстром, тобто кожен застосунок платив би за
 * схеми всіх своїх моделей на кожному екрані.
 */
import type { ReactiveControllerHost } from "lit";
import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { TemplateResult } from "lit";
import { bus } from "../../bus/bus.ts";
import { t } from "../../locale.ts";

/** Колонка переліку. Те саме, що в списку моделі, лише без сортування. */
export interface SubordinateColumn<Row extends object> {
  key: string;
  /** Заголовок — ключ локалізації (проходить через t()). */
  title: string;
  width?: string;
  align?: "left" | "right" | "center";
  /** Шаблон дати/часу (`dateFormat.date`), як у колонці списку. */
  format?: string;
  render?: (row: Row) => TemplateResult | string;
}

/** Поле редактора рядка. */
export interface SubordinateField<Row extends object> {
  kind: "text" | "decimal" | "date" | "checkbox" | "picker" | "select" | "custom";
  key: string;
  title: string;
  width?: string;
  /** decimal: кількість знаків (умовчання 2). */
  precision?: number;
  /** picker: маршрут в'ю (`family/model`), як у `<ui-picker url>`. */
  url?: string;
  /** picker: ключ вкладеного об'єкта; умовчання — `key` без суфікса Id. */
  refKey?: string;
  /** select: перелік значень. */
  options?: () => Array<{ value: string; label: string }>;
  required?: boolean;
  /** custom: повна розмітка поля. */
  render?: (draft: Row) => TemplateResult;
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
  fields: Array<SubordinateField<Row>>;
  /** Порожній рядок: схема (Value.Create) або фабрика. */
  schema?: TObject;
  createRow?: () => Row;
  /** `sortBy` для `list`; типово — поле періоду за спаданням. */
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Скільки рядків показувати. Перелік у картці — не журнал. */
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
}

interface Envelope {
  ok?: boolean;
  data?: { rows?: unknown[]; item?: unknown };
  messages?: Array<{ type?: string; text?: string }>;
}

const DEFAULT_PAGE_SIZE = 50;

/** Ключ відбору з імені поля: `organizationId` → `organization`. */
export function ownerFilterKeyOf(ownerField: string, explicit?: string): string {
  if (explicit) return explicit;
  return ownerField.endsWith("Id") ? ownerField.slice(0, -2) : ownerField;
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
  loading = false;
  /** Рядок, який зараз редагують; `null` — редактор закритий. */
  draft: Row | null = null;
  /** Id рядка, що редагується; порожньо — новий. */
  editingId: string | null = null;
  /** Повідомлення відмови сервера — показується в панелі, а не ковтається. */
  error = "";

  #hosts = new Set<ReactiveControllerHost>();
  /** Власник, під якого вже завантажено перелік. */
  #loadedFor: string | null = null;

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
    if (!owner) {
      this.rows = [];
      this.#notify();
      return;
    }
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.ready) return;
    this.loading = true;
    this.error = "";
    this.#notify();

    const env = await this.#call("list", {
      page: 1,
      pageSize: this.config.pageSize ?? DEFAULT_PAGE_SIZE,
      sortBy: this.config.sortBy,
      sortDir: this.config.sortDir ?? "desc",
      filters: { [this.filterKey]: { id: this.ownerId } },
    });

    this.rows = (env?.data?.rows ?? []) as Row[];
    this.loading = false;
    this.#notify();
  }

  // ── Редактор ───────────────────────────────────────────────────────────────

  startAdd() {
    if (!this.ready || this.readonly) return;
    this.editingId = null;
    this.draft = this.#createRow();
    this.error = "";
    this.#notify();
  }

  startEdit(row: Row) {
    if (this.readonly || this.locked(row)) return;
    this.editingId = String((row as Record<string, unknown>).id ?? "");
    this.draft = { ...row };
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

  /** Незаповнені обов'язкові поля чернетки — ключі. */
  missingFields(): string[] {
    const draft = this.draft as Record<string, unknown> | null;
    if (!draft) return [];
    return this.config.fields
      .filter((field) => field.required)
      .filter((field) => {
        const value = draft[field.key];
        return value === null || value === undefined || value === "";
      })
      .map((field) => field.key);
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

  async remove(row: Row): Promise<boolean> {
    if (this.readonly || this.locked(row)) return false;
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
